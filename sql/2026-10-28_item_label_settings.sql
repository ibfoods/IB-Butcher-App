-- Item label settings for Zebra label printing (10/28/26).
-- sold_by:    how the item is sold — each | lb | person
-- label_mode: default (follow sold_by) | each (label each piece) | line (one label per line)
alter table public.items add column if not exists sold_by text not null default 'each';
alter table public.items add column if not exists label_mode text not null default 'default';
alter table public.items drop constraint if exists items_sold_by_check;
alter table public.items add constraint items_sold_by_check check (sold_by in ('each','lb','person'));
alter table public.items drop constraint if exists items_label_mode_check;
alter table public.items add constraint items_label_mode_check check (label_mode in ('default','each','line'));
