-- 2026-11-13 — Stock changes happen inside the database, one store at a time.
--
-- Before: each iPad read the count, did the math, and wrote the new number back.
-- Two iPads saving the same item at the same moment could both read 14 and both
-- write 13, losing one deduction (and both could pass the "is it in stock?" check
-- for the last one).
--
-- After: the app sends the change ("take 1 off pool-be-sm") and this function
-- locks those inventory rows, checks there's enough, and applies every change in
-- one step. A second save on the same items waits its turn and sees the new count.
--
-- p_changes: {"pool-be-sm": -1, "pool-ib-md": 2}   negative = take off, positive = give back
-- Items with no inventory row at that store are untracked there and are skipped.
-- Taking off more than is left is refused (nothing changes) unless
-- p_allow_negative is true (manager override, edits, give-backs).
--
-- Returns {"ok": true, "stock": {"pool-be-sm": 13}}
--      or {"ok": false, "short": [{"item_id": "...", "available": 0, "requested": 1}]}
--
-- Additive only: no tables or rows are changed by running this file.

create or replace function public.apply_stock_changes(
  p_location text,
  p_changes jsonb,
  p_allow_negative boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  chg integer;
  short jsonb := '[]'::jsonb;
  result jsonb := '{}'::jsonb;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'p_changes must be a JSON object of {item_id: change}';
  end if;

  -- Lock the rows in a fixed order so two saves on the same items queue up
  for r in
    select i.item_id, i.stock
    from public.inventory i
    where i.location_id = p_location
      and i.item_id in (select jsonb_object_keys(p_changes))
    order by i.item_id
    for update
  loop
    chg := round((p_changes ->> r.item_id)::numeric)::int;
    if chg < 0 and not p_allow_negative and r.stock + chg < 0 then
      short := short || jsonb_build_object('item_id', r.item_id, 'available', r.stock, 'requested', -chg);
    end if;
  end loop;

  if jsonb_array_length(short) > 0 then
    return jsonb_build_object('ok', false, 'short', short);
  end if;

  for r in
    update public.inventory i
       set stock = i.stock + round((p_changes ->> i.item_id)::numeric)::int
     where i.location_id = p_location
       and i.item_id in (select jsonb_object_keys(p_changes))
    returning i.item_id, i.stock
  loop
    result := result || jsonb_build_object(r.item_id, r.stock);
  end loop;

  return jsonb_build_object('ok', true, 'stock', result);
end
$$;

revoke all on function public.apply_stock_changes(text, jsonb, boolean) from public, anon;
grant execute on function public.apply_stock_changes(text, jsonb, boolean) to authenticated, service_role;
