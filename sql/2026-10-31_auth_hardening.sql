-- Auth hardening (Oct 31 2026).
-- Before: every table had `using (true)` for anon, and users.password / users.pin
-- were plain text — anyone with the (public) anon key could read staff credentials
-- and the whole customer list straight from the REST API.
-- After: credentials are bcrypt-hashed and checked inside Postgres; the app gets a
-- signed JWT from /api/auth/login; RLS requires that token for every table; the
-- users table is unreadable from the client (a `staff` view exposes safe columns).
--
-- APPLY TOGETHER WITH THE MATCHING APP DEPLOY. The old app cannot log in once
-- this runs (it read users directly), and the new app cannot run on the old policies.

create extension if not exists pgcrypto;

-- ── 1. Hash credentials ───────────────────────────────────────────────────
alter table public.users
  add column if not exists password_hash text,
  add column if not exists pin_hash text;

update public.users set password_hash = crypt(password, gen_salt('bf', 10))
  where password is not null and password_hash is null;
update public.users set pin_hash = crypt(pin, gen_salt('bf', 8))
  where pin is not null and pin_hash is null;

-- Plain text goes away for good.
alter table public.users drop column if exists password;
alter table public.users drop column if exists pin;

-- ── 2. Login attempts (rate limit online guessing, esp. 4-digit PINs) ─────
create table if not exists public.login_attempts (
  id bigserial primary key,
  ip text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on public.login_attempts (ip, at desc);
alter table public.login_attempts enable row level security;   -- no policies: service role only

-- ── 3. Login functions (SECURITY DEFINER, called by the API with service role) ──
-- Returns the matched user's safe columns, or nothing. Never exposes hashes.
create or replace function public.login_with_pin(p_pin text, p_ip text)
returns table (id uuid, name text, username text, role text, location_id text)
language plpgsql security definer set search_path = public as $$
declare
  recent_fail int;
  u record;
begin
  select count(*) into recent_fail from public.login_attempts a
    where a.ip = p_ip and a.ok = false and a.at > now() - interval '15 minutes';
  if recent_fail >= 10 then
    raise exception 'too_many_attempts';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    insert into public.login_attempts (ip, ok) values (p_ip, false);
    return;
  end if;
  for u in select x.id, x.name, x.username, x.role, x.location_id, x.pin_hash from public.users x where x.pin_hash is not null loop
    if u.pin_hash = crypt(p_pin, u.pin_hash) then
      insert into public.login_attempts (ip, ok) values (p_ip, true);
      return query select u.id, u.name, u.username, u.role, u.location_id;
      return;
    end if;
  end loop;
  insert into public.login_attempts (ip, ok) values (p_ip, false);
  return;
end $$;

create or replace function public.login_with_password(p_username text, p_password text, p_ip text)
returns table (id uuid, name text, username text, role text, location_id text)
language plpgsql security definer set search_path = public as $$
declare
  recent_fail int;
  u record;
begin
  select count(*) into recent_fail from public.login_attempts a
    where a.ip = p_ip and a.ok = false and a.at > now() - interval '15 minutes';
  if recent_fail >= 10 then
    raise exception 'too_many_attempts';
  end if;
  select x.id, x.name, x.username, x.role, x.location_id, x.password_hash into u
    from public.users x where lower(x.username) = lower(trim(p_username)) limit 1;
  if u.id is not null and u.password_hash is not null and u.password_hash = crypt(p_password, u.password_hash) then
    insert into public.login_attempts (ip, ok) values (p_ip, true);
    return query select u.id, u.name, u.username, u.role, u.location_id;
    return;
  end if;
  insert into public.login_attempts (ip, ok) values (p_ip, false);
  return;
end $$;

-- Set / change credentials (API only). Null leaves a value unchanged; '' clears the PIN.
create or replace function public.set_user_credentials(p_user uuid, p_password text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_password is not null and p_password <> '' then
    update public.users set password_hash = crypt(p_password, gen_salt('bf', 10)) where id = p_user;
  end if;
  if p_pin is not null then
    if p_pin = '' then
      update public.users set pin_hash = null where id = p_user;
    else
      if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits.'; end if;
      if exists (select 1 from public.users x where x.id <> p_user and x.pin_hash is not null and x.pin_hash = crypt(p_pin, x.pin_hash)) then
        raise exception 'That PIN is already in use.';
      end if;
      update public.users set pin_hash = crypt(p_pin, gen_salt('bf', 8)) where id = p_user;
    end if;
  end if;
end $$;

-- Only the API (service role) may call these.
revoke all on function public.login_with_pin(text, text) from public, anon, authenticated;
revoke all on function public.login_with_password(text, text, text) from public, anon, authenticated;
revoke all on function public.set_user_credentials(uuid, text, text) from public, anon, authenticated;
grant execute on function public.login_with_pin(text, text) to service_role;
grant execute on function public.login_with_password(text, text, text) to service_role;
grant execute on function public.set_user_credentials(uuid, text, text) to service_role;
grant select, insert, update, delete on public.users to service_role;
grant select, insert on public.login_attempts to service_role;

-- ── 4. Safe staff view for the app (no hashes) ────────────────────────────
-- Managers and up only (the view bypasses RLS, so the role check lives in the view itself).
create or replace view public.staff with (security_invoker = false) as
  select id, name, username, role, location_id, (pin_hash is not null) as has_pin, created_at
  from public.users
  where coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'app_role', '') in ('manager', 'admin', 'master_admin')
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user) = 'service_role'   -- the API
     or current_setting('request.jwt.claims', true) is null;                                                      -- direct SQL
grant select on public.staff to authenticated, service_role;
revoke all on public.staff from anon;

-- ── 5. RLS: token required everywhere; users table closed to clients ──────
-- Helper: the app role carried in the JWT minted by /api/auth/login.
create or replace function public.app_role() returns text
language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'app_role', '') $$;
create or replace function public.is_manager() returns boolean
language sql stable as $$ select public.app_role() in ('manager', 'admin', 'master_admin') $$;
create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.app_role() in ('admin', 'master_admin') $$;

-- users: nothing from the client. All access goes through the API (service role).
drop policy if exists "allow all" on public.users;
revoke all on public.users from anon, authenticated;

-- Everything else: signed-in users only; writes to reference/config data need manager+.
do $$
declare t text;
begin
  foreach t in array array['orders','order_items','customers','inventory','items','printer_settings','app_settings'] loop
    execute format('drop policy if exists "allow all" on public.%I', t);
    execute format('drop policy if exists "customers_auth_read" on public.%I', t);
    execute format('drop policy if exists "customers_auth_write" on public.%I', t);
    execute format('drop policy if exists "signed in read" on public.%I', t);
    execute format('drop policy if exists "signed in write" on public.%I', t);
    execute format('drop policy if exists "manager write" on public.%I', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "signed in read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Order taking: any signed-in user
create policy "signed in write" on public.orders       for all to authenticated using (true) with check (true);
create policy "signed in write" on public.order_items  for all to authenticated using (true) with check (true);
create policy "signed in write" on public.customers    for all to authenticated using (true) with check (true);
-- Inventory moves with orders, so any signed-in user may update it
create policy "signed in write" on public.inventory    for all to authenticated using (true) with check (true);
-- Config: managers and up
create policy "manager write" on public.items            for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "manager write" on public.printer_settings for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "manager write" on public.app_settings     for all to authenticated using (public.is_admin())   with check (public.is_admin());

-- Order numbers: signed-in only
revoke all on function public.next_order_seq(text, text) from public, anon;
grant execute on function public.next_order_seq(text, text) to authenticated;

-- order_counters stays closed (function is security definer)
