# IB Butcher App — rules for Claude

Read `PROJECT_KNOWLEDGE.md` (start with **RULES** and **Start here**) before doing anything.

**Wantagh is LIVE** (2026 Thanksgiving season trial). Every Wantagh order is a real customer order.

1. Nothing on a live order changes — numbers, items, dates, times, customers, status — and no
   backfills, renumbering or cleanup, unless Mike asks for that specific change.
2. Even when Mike asks, confirm before running it: show exactly what changes (order, field,
   old → new) and wait for a clear yes.
3. Database changes are additive only; confirm they rewrite no existing order rows.
4. Tests never touch Wantagh data — use a made-up store id not in `LOCS`, or Woodbury, and
   clean up. Never create test items (items are shared by every store).
5. Save old values in the private `backup` schema before any data change.
6. App changes go live only when Mike says go: branch → test → report → fast-forward `main` →
   confirm the Vercel production deploy is READY.
7. Butcher App only — never touch OrderHQ resources. Explain to Mike in plain English; give
   numbered one-action steps for anything he must do himself.

Supabase project ref: `gajafjiphrsvztcwofhe` (double-check — a past typo caused bugs).
Commit as Mike Bottari <bottari.mike@gmail.com>.
