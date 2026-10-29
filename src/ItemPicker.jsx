import { useState } from "react";
import { Button, Pill, Input, Icon, cx } from "./ui";
import { qtyPrefix, lineName, unitOf, isDecimalQty } from "./orderFmt";

// Drill-down item picker: category → product → (plain / oven ready) → quantity + note.
// lines: [{ item_id, quantity, note }]. Pools (items with children) are never a
// line themselves — the child is. Stock is checked against the pool.

const CAT_ORDER = ["Turkeys", "Turkey Breast", "Chop Meat", "Other"];

export function poolIdFor(item, items) {
  return item?.parent_id || item?.id;
}
export function poolFor(item, items) {
  return item?.parent_id ? items.find(i => i.id === item.parent_id) : item;
}
// Stock left in the pool after the lines already on this order (excluding line `skip`).
export function poolAvailable(item, items, inv, locationId, lines, skip = -1) {
  const pool = poolFor(item, items);
  if (!pool?.tracked) return null;
  const key = `${locationId}_${pool.id}`;
  if (!(key in inv)) return null;
  const used = lines.reduce((n, l, i) => i === skip ? n : n + (poolIdFor(items.find(x => x.id === l.item_id), items) === pool.id ? Number(l.quantity) || 0 : 0), 0);
  return inv[key] - used;
}

function Stepper({ value, onChange, decimal, min, max }) {
  const step = decimal ? 0.5 : 1;
  const lo = min ?? (decimal ? 0.5 : 1);
  const clamp = (v) => { let n = Number(v); if (!Number.isFinite(n)) n = lo; n = Math.max(lo, n); if (max != null) n = Math.min(max, n); return decimal ? Math.round(n * 100) / 100 : Math.round(n); };
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(Number(value) - step))} aria-label="Less">−</button>
      <Input type="number" inputMode={decimal ? "decimal" : "numeric"} step={step} min={lo} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(clamp(e.target.value))} style={{ width: 72 }} />
      <button type="button" onClick={() => onChange(clamp(Number(value) + step))} aria-label="More">+</button>
    </div>
  );
}

export default function ItemPicker({ items, inv, locationId, lines, onChange, canOverride = false, autoStart = true }) {
  const active = items.filter(i => i.active !== false);
  const hasChildren = (it) => active.some(c => c.parent_id === it.id);
  const products = active.filter(i => !i.parent_id);                     // pools + standalones
  const cats = [...new Set(products.map(p => p.category || "Other"))]
    .sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

  // step: null (show lines) | "cat" | "product" | "prep" | "qty"
  const [step, setStep] = useState(autoStart && lines.length === 0 ? "cat" : null);
  const [cat, setCat] = useState(cats.length === 1 ? cats[0] : null);
  const [product, setProduct] = useState(null);     // pool or standalone item
  const [draft, setDraft] = useState(null);         // { item_id, quantity, note }
  const [editIdx, setEditIdx] = useState(-1);

  const reset = () => { setStep(null); setCat(null); setProduct(null); setDraft(null); setEditIdx(-1); };
  const start = () => { reset(); setStep("cat"); };
  const pickCat = (c) => { setCat(c); setStep("product"); };
  const pickProduct = (p) => {
    setProduct(p);
    if (hasChildren(p)) setStep("prep");
    else { setDraft({ item_id: p.id, quantity: isDecimalQty(p) ? 1 : 1, note: "" }); setStep("qty"); }
  };
  const pickPrep = (child) => { setDraft({ item_id: child.id, quantity: 1, note: "" }); setStep("qty"); };
  const editLine = (i) => {
    const l = lines[i]; const it = active.find(x => x.id === l.item_id);
    setEditIdx(i); setProduct(poolFor(it, items)); setCat(poolFor(it, items)?.category || null);
    setDraft({ ...l }); setStep("qty");
  };
  const commit = () => {
    const it = active.find(x => x.id === draft.item_id);
    const q = Number(draft.quantity);
    if (!it || !Number.isFinite(q) || q <= 0) return;
    const line = { item_id: it.id, quantity: q, note: (draft.note || "").trim() };
    const next = editIdx >= 0 ? lines.map((l, i) => i === editIdx ? line : l) : [...lines, line];
    onChange(next);
    reset();
  };
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i));

  const stockFor = (p) => poolAvailable(p, items, inv, locationId, lines, editIdx);
  const draftItem = draft ? active.find(x => x.id === draft.item_id) : null;
  const draftAvail = draftItem ? stockFor(draftItem) : null;
  const over = draftAvail != null && Number(draft?.quantity) > draftAvail;

  const crumb = (
    <div className="hstack" style={{ marginBottom: 10, gap: 4 }}>
      <button type="button" className="btn-link" onClick={start}>Items</button>
      {cat && step !== "cat" && <><Icon name="chevron" size={14} style={{ color: "var(--faint)" }} /><button type="button" className="btn-link" onClick={() => { setProduct(null); setStep("product"); }}>{cat}</button></>}
      {product && (step === "prep" || step === "qty") && <><Icon name="chevron" size={14} style={{ color: "var(--faint)" }} /><span className="small" style={{ fontWeight: 600 }}>{product.short_name || product.name}</span></>}
    </div>
  );

  return (
    <div className="picker">
      {lines.length > 0 && step !== "qty" && (
        <div className="stack" style={{ marginBottom: 10 }}>
          {lines.map((l, i) => {
            const it = items.find(x => x.id === l.item_id);
            const avail = poolAvailable(it, items, inv, locationId, lines, i);
            const short = avail != null && avail < 0;
            return (
              <div key={i} className="line">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontWeight: 600 }}><span className="brand">{qtyPrefix(it, l.quantity) || ""}</span>{lineName(it, items)}</p>
                  {l.note && <p className="xs muted">{l.note}</p>}
                  {short && <p className="xs danger">Only {Math.max(0, avail + Number(l.quantity))} left in the pool{canOverride ? " — manager override on submit" : ""}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => editLine(i)}>Edit</Button>
                <button type="button" className="close" style={{ margin: 0 }} onClick={() => remove(i)} aria-label="Remove">×</button>
              </div>
            );
          })}
        </div>
      )}

      {step === null && <Button variant="outline" icon="plus" onClick={start}>{lines.length ? "Add another item" : "Add item"}</Button>}

      {step === "cat" && (
        <div>
          {lines.length > 0 && crumb}
          <p className="field-label">What are they ordering?</p>
          <div className="pills">
            {cats.map(c => <Pill key={c} on={cat === c} onClick={() => pickCat(c)}>{c}</Pill>)}
          </div>
          {lines.length > 0 && <Button variant="ghost" size="sm" className="muted" style={{ marginTop: 8 }} onClick={reset}>Cancel</Button>}
        </div>
      )}

      {step === "product" && (
        <div>
          {crumb}
          <div className="pills">
            {products.filter(p => (p.category || "Other") === cat).map(p => {
              const avail = stockFor(p);
              const out = avail != null && avail <= 0;
              const low = avail != null && avail > 0 && avail <= 5;
              return (
                <button key={p.id} type="button" className={cx("pill", "pill-stock", out && "out")} disabled={out && !canOverride} onClick={() => pickProduct(p)}>
                  <span>{p.short_name || p.name}</span>
                  {out && <span className="sub danger">Sold out</span>}
                  {low && <span className="sub warn">{avail} left</span>}
                </button>
              );
            })}
          </div>
          {!canOverride && products.some(p => (p.category || "Other") === cat && (stockFor(p) ?? 1) <= 0) && <p className="xs muted" style={{ marginTop: 8 }}>Sold-out items need a manager.</p>}
        </div>
      )}

      {step === "prep" && product && (
        <div>
          {crumb}
          <p className="field-label">{product.short_name || product.name} — how do they want it?</p>
          <div className="pills">
            {active.filter(c => c.parent_id === product.id).map(c => <Pill key={c.id} onClick={() => pickPrep(c)}>{c.short_name || c.name}</Pill>)}
          </div>
        </div>
      )}

      {step === "qty" && draft && draftItem && (
        <div className="card tight" style={{ background: "var(--brand-tint)", borderColor: "#efe1e4" }}>
          {editIdx < 0 && crumb}
          <p style={{ fontWeight: 600, marginBottom: 10 }}>{lineName(draftItem, items)}<span className="muted" style={{ fontWeight: 400 }}> · {draftItem.name}</span></p>
          <div className="hstack" style={{ marginBottom: 10 }}>
            <Stepper value={draft.quantity} onChange={v => setDraft(d => ({ ...d, quantity: v }))} decimal={isDecimalQty(draftItem)} max={!canOverride && draftAvail != null ? Math.max(draftAvail, 0) : undefined} />
            <span className="small muted">{unitOf(draftItem) || (Number(draft.quantity) === 1 ? "piece" : "pieces")}</span>
            {draftAvail != null && <span className={cx("xs", over ? "danger" : draftAvail <= 5 ? "warn" : "ok")} style={{ marginLeft: "auto" }}>{draftAvail <= 0 ? "Sold out" : `${draftAvail} left in pool`}{over && canOverride ? " — override" : ""}</span>}
          </div>
          <Input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="Note for this item (optional) — e.g. thin sliced, no skin" style={{ marginBottom: 10 }} />
          <div className="hstack" style={{ flexWrap: "nowrap" }}>
            <Button variant="primary" style={{ flex: 1 }} onClick={commit} disabled={!canOverride && draftAvail != null && draftAvail <= 0}>{editIdx >= 0 ? "Save" : "Add to order"}</Button>
            <Button onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
