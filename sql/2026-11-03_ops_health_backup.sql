-- Daily health check + nightly backup support (Nov 3 2026).
-- Additive only: one private settings table and three read-only functions.
-- Nothing existing is changed, so this is safe to apply before or after the deploy.
--
--   ops_settings        private key/value store (Drive connection, last backup,
--                       last health check). RLS on, no policies: the browser can
--                       never read it; only the server (service role) can.
--   ops_health()        data sanity checks for the 6 AM report.
--   ops_schema_ddl()    a full CREATE script of the public schema, saved inside
--                       every backup so a restore never depends on remembering
--                       how the tables were built.
--   ops_backup_tables() list of tables to copy each night.

-- ── 1. Private settings ─────────────────────────────────────────────────────
create table if not exists public.ops_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ops_settings enable row level security;
revoke all on table public.ops_settings from anon, authenticated;
grant select, insert, update, delete on table public.ops_settings to service_role;

-- ── 2. Health checks ────────────────────────────────────────────────────────
-- Today in the stores' time zone. pickup_date is stored as text YYYY-MM-DD.
create or replace function public.ops_health()
returns jsonb
language sql stable security definer set search_path = public as $$
with t as (select (now() at time zone 'America/New_York')::date as today),
active as (
  select o.* from orders o where coalesce(o.status, 'pending') <> 'cancelled'
)
select jsonb_build_object(
  'today', (select today from t),
  -- Two live orders in the same store + pickup month holding the same number
  'duplicate_numbers', coalesce((
    select jsonb_agg(d order by d->>'location_id', d->>'month', (d->>'number')::int) from (
      select jsonb_build_object(
        'location_id', location_id,
        'month', substr(pickup_date, 1, 7),
        'number', daily_number,
        'customers', jsonb_agg(customer_name order by created_at)
      ) as d
      from active
      group by location_id, substr(pickup_date, 1, 7), daily_number
      having count(*) > 1
    ) x), '[]'::jsonb),
  -- Live orders not linked to a customer record
  'orders_without_customer', coalesce((
    select jsonb_agg(jsonb_build_object('location_id', a.location_id, 'number', a.daily_number,
                                        'pickup_date', a.pickup_date, 'customer', a.customer_name))
    from active a left join customers c on c.id = a.customer_id
    where c.id is null), '[]'::jsonb),
  -- Upcoming live orders with no items
  'orders_without_items', coalesce((
    select jsonb_agg(jsonb_build_object('location_id', a.location_id, 'number', a.daily_number,
                                        'pickup_date', a.pickup_date, 'customer', a.customer_name))
    from active a, t
    where a.pickup_date >= t.today::text
      and not exists (select 1 from order_items oi where oi.order_id = a.id)), '[]'::jsonb),
  -- Counted items that are oversold
  'negative_inventory', coalesce((
    select jsonb_agg(jsonb_build_object('location_id', i.location_id, 'item', coalesce(it.name, i.item_id), 'stock', i.stock))
    from inventory i left join items it on it.id = i.item_id
    where i.stock < 0), '[]'::jsonb),
  -- Informational
  'upcoming_without_email', (select count(*) from active a, t where a.pickup_date >= t.today::text and coalesce(a.customer_email, '') = ''),
  'new_orders_yesterday', coalesce((
    select jsonb_object_agg(location_id, n) from (
      select o.location_id, count(*) as n from orders o, t
      where (o.created_at at time zone 'UTC' at time zone 'America/New_York')::date = t.today - 1
      group by o.location_id) y), '{}'::jsonb),
  'upcoming_pickups', coalesce((
    select jsonb_object_agg(location_id, n) from (
      select a.location_id, count(*) as n from active a, t
      where a.pickup_date >= t.today::text group by a.location_id) u), '{}'::jsonb),
  'totals', jsonb_build_object(
    'orders', (select count(*) from orders),
    'customers', (select count(*) from customers),
    'users', (select count(*) from users))
);
$$;

-- ── 3. Which tables get backed up ───────────────────────────────────────────
-- Everything in public except connection keys and noise.
create or replace function public.ops_backup_tables()
returns setof text
language sql stable security definer set search_path = public as $$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname not in ('gmail_tokens', 'ops_settings', 'login_attempts')
  order by 1;
$$;

-- ── 4. Schema snapshot ──────────────────────────────────────────────────────
-- Rebuilds tables, keys, indexes, functions, views, security rules and grants
-- for the public schema. Run it on a fresh Supabase project (or a Postgres with
-- anon/authenticated/service_role roles) before loading the data.
create or replace function public.ops_schema_ddl()
returns text
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  out text := '';
  r record;
  cols text;
begin
  out := out || '-- IB Butcher App schema snapshot ' || to_char(now(), 'YYYY-MM-DD HH24:MI TZ') || E'\n';
  out := out || E'create schema if not exists extensions;\ncreate extension if not exists pgcrypto with schema extensions;\n\n';

  -- Sequences (before tables that use them as defaults)
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S' order by 1
  loop
    out := out || format(E'create sequence if not exists public.%I;\n', r.relname);
  end loop;

  -- Tables
  for r in
    select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 2
  loop
    select string_agg(
             format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
                    case
                      when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
                      when a.attidentity = 'a' then ' generated always as identity'
                      when a.attidentity = 'd' then ' generated by default as identity'
                      when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid)
                      else '' end,
                    case when a.attnotnull then ' not null' else '' end),
             E',\n' order by a.attnum)
      into cols
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped;
    out := out || format(E'\ncreate table if not exists public.%I (\n%s\n);\n', r.relname, cols);
  end loop;

  -- Sequence ownership
  for r in
    select s.relname as seq, t.relname as tbl, a.attname as col
    from pg_depend dp
    join pg_class s on s.oid = dp.objid and s.relkind = 'S'
    join pg_class t on t.oid = dp.refobjid
    join pg_namespace n on n.oid = s.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = t.oid and a.attnum = dp.refobjsubid
    where dp.deptype = 'a'
  loop
    out := out || format(E'alter sequence public.%I owned by public.%I.%I;\n', r.seq, r.tbl, r.col);
  end loop;

  -- Constraints: primary/unique/check first, foreign keys last
  out := out || E'\n';
  for r in
    select con.conname, c.relname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and con.contype in ('p', 'u', 'c', 'x', 'f')
    order by case con.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 when 'x' then 3 else 4 end, c.relname, con.conname
  loop
    out := out || format(E'alter table public.%I add constraint %I %s;\n', r.relname, r.conname, r.def);
  end loop;

  -- Indexes not created by a constraint
  out := out || E'\n';
  for r in
    select i.indexdef from pg_indexes i
    where i.schemaname = 'public'
      and not exists (select 1 from pg_constraint con where con.conname = i.indexname)
    order by i.tablename, i.indexname
  loop
    out := out || r.indexdef || E';\n';
  end loop;

  -- Functions
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by p.proname
  loop
    out := out || E'\n' || pg_get_functiondef(r.oid) || E';\n';
  end loop;

  -- Views
  for r in
    select c.relname, c.reloptions, pg_get_viewdef(c.oid, true) as def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' order by 1
  loop
    out := out || format(E'\ncreate or replace view public.%I%s as\n%s\n',
                         r.relname,
                         case when r.reloptions is not null then ' with (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
                         r.def);
  end loop;

  -- Row level security + policies
  out := out || E'\n';
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity order by 1
  loop
    out := out || format(E'alter table public.%I enable row level security;\n', r.relname);
  end loop;
  for r in select * from pg_policies where schemaname = 'public' order by tablename, policyname loop
    out := out || format(E'create policy %I on public.%I as %s for %s to %s%s%s;\n',
      r.policyname, r.tablename, lower(r.permissive), lower(r.cmd),
      (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(r.roles) x),
      case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
      case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
  end loop;

  -- Triggers
  for r in
    select pg_get_triggerdef(tg.oid) as def from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not tg.tgisinternal order by c.relname, tg.tgname
  loop
    out := out || r.def || E';\n';
  end loop;

  -- Grants for the app roles (tables, views, sequences, functions)
  out := out || E'\n';
  for r in
    select c.relname, case c.relkind when 'S' then 'sequence' else 'table' end as kind, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'S') order by 1
  loop
    out := out || format(E'revoke all on %s public.%I from anon, authenticated, service_role;\n', r.kind, r.relname);
    out := out || coalesce((
      select string_agg(format(E'grant %s on %s public.%I to %I;\n', ax.privs, r.kind, r.relname, ax.grantee), '')
      from (
        select g.rolname as grantee, string_agg(acl.privilege_type, ', ' order by acl.privilege_type) as privs
        from aclexplode(r.relacl) acl join pg_roles g on g.oid = acl.grantee
        where g.rolname in ('anon', 'authenticated', 'service_role')
          and acl.privilege_type <> 'MAINTAIN'   -- Postgres 17 only; not needed
        group by g.rolname
      ) ax), '');
  end loop;
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1
  loop
    if r.proacl is not null then
      out := out || format(E'revoke all on function public.%I(%s) from public, anon, authenticated, service_role;\n', r.proname, r.args);
      out := out || coalesce((
        select string_agg(format(E'grant execute on function public.%I(%s) to %s;\n', r.proname, r.args,
                                 case when acl.grantee = 0 then 'public' else quote_ident(g.rolname) end), '')
        from aclexplode(r.proacl) acl left join pg_roles g on g.oid = acl.grantee
        where acl.grantee = 0 or g.rolname in ('anon', 'authenticated', 'service_role')), '');
    end if;
  end loop;

  return out;
end;
$$;

-- Server only. The browser (anon / signed-in staff) can't call these.
revoke all on function public.ops_health() from public, anon, authenticated;
revoke all on function public.ops_backup_tables() from public, anon, authenticated;
revoke all on function public.ops_schema_ddl() from public, anon, authenticated;
grant execute on function public.ops_health() to service_role;
grant execute on function public.ops_backup_tables() to service_role;
grant execute on function public.ops_schema_ddl() to service_role;
