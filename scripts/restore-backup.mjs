// Turns a nightly backup file into one SQL script that rebuilds the database.
//
//   node scripts/restore-backup.mjs ib-butcher-backup-2026-11-04-0205.json > restore.sql
//
// Then run restore.sql against an EMPTY database — a brand-new Supabase project
// (SQL Editor → paste → Run, or psql) — never against the live one.
// See docs/RESTORE.md for the full steps.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/restore-backup.mjs <backup.json> > restore.sql"); process.exit(1); }
const b = JSON.parse(readFileSync(file, "utf8"));
if (b.format !== "ib-butcher-backup/1") { console.error(`Unknown backup format: ${b.format}`); process.exit(1); }

// Dollar-quote JSON safely (pick a tag that doesn't appear in the data)
const quote = (text) => {
  let tag = "ib"; while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
};

const out = [];
out.push(`-- IB Butcher App restore from ${file}`);
out.push(`-- Backup taken ${b.created_at} (${b.created_et?.date} ${b.created_et?.hm} New York)`);
out.push(`-- Rows: ${Object.entries(b.counts).map(([t, n]) => `${t} ${n}`).join(", ")}`);
out.push("begin;");
out.push(b.schema_sql);
out.push("-- Data. Triggers and foreign-key checks are paused while loading, then turned back on.");
out.push("set session_replication_role = replica;");
// Loads rows into every column except ones the database computes itself
// (e.g. customers.phone_digits, which is generated from phone).
out.push(`create function pg_temp.load(tbl text, data json) returns void language plpgsql as $f$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
  from pg_attribute where attrelid = ('public.' || quote_ident(tbl))::regclass
    and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a';
  execute format('insert into public.%I (%s) select %s from json_populate_recordset(null::public.%I, $1)', tbl, cols, cols, tbl) using data;
end $f$;`);
for (const [table, rows] of Object.entries(b.tables)) {
  if (!rows.length) continue;
  out.push(`select pg_temp.load(${quote(table)}, ${quote(JSON.stringify(rows))});`);
}
out.push("set session_replication_role = origin;");
out.push(`-- Move any id counters past the restored rows
do $$ declare r record; begin
  for r in select s.relname as seq, t.relname as tbl, a.attname as col
           from pg_depend d join pg_class s on s.oid = d.objid and s.relkind = 'S'
           join pg_class t on t.oid = d.refobjid join pg_namespace n on n.oid = s.relnamespace and n.nspname = 'public'
           join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid where d.deptype = 'a' loop
    execute format('select setval(%L, greatest(coalesce((select max(%I) from public.%I), 0), 1))', 'public.' || r.seq, r.col, r.tbl);
  end loop;
end $$;`);
out.push("commit;");
out.push(`-- Check: these counts should match the backup.\nselect ${Object.keys(b.counts).map(t => `(select count(*) from public.${JSON.stringify(t)}) as ${JSON.stringify(t)}`).join(", ")};`);
process.stdout.write(out.join("\n\n") + "\n");
