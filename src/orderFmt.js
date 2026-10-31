// Order formatting shared by every screen. api/_order.js is the Node twin —
// keep the two in step.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const monthOf = (ymd) => MONTHS[parseInt(String(ymd || "").slice(5, 7), 10) - 1] || "";
export const ymOf = (ymd) => String(ymd || "").slice(0, 7);

// The number the customer was given. New orders: daily_number === order_seq.
// Orders taken before monthly numbering keep the number the customer was told
// (daily_number); order_seq is then only the internal unique key.
export const orderSeq = (o) => o?.daily_number ?? o?.order_seq ?? "";
export const orderNumberText = (o) => `${monthOf(o?.pickup_date)} #${orderSeq(o)}`.trim();

const trimNum = (q) => {
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q ?? "");
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
};

// "4 lb" / "× 4" / "4 people"
export function qtyText(item, qty, { times = "× " } = {}) {
  const sb = item?.sold_by || "each";
  const q = trimNum(qty);
  if (sb === "lb") return `${q} lb`;
  if (sb === "person") return Number(qty) === 1 ? "1 person" : `${q} people`;
  return `${times}${q}`;
}
// Short form for a line summary: "2× B&E Large" / "4 lb Cutlets"
export function qtyPrefix(item, qty) {
  const sb = item?.sold_by || "each";
  const q = trimNum(qty);
  if (sb === "lb") return `${q} lb `;
  if (sb === "person") return `${q}p `;
  return Number(qty) > 1 ? `${q}× ` : "";
}
export const unitOf = (item) => (item?.sold_by === "lb" ? "lb" : item?.sold_by === "person" ? "people" : "");
export const isDecimalQty = (item) => item?.sold_by === "lb";

// Display name for an item inside the picker / line summary.
// "B&E Medium, Oven Ready" for a child; the item's own short name otherwise.
export function lineName(item, items) {
  if (!item) return "";
  const parent = item.parent_id ? items.find(i => i.id === item.parent_id) : null;
  if (parent) return `${parent.short_name || parent.name}, ${item.short_name || item.name}`;
  return item.short_name || item.name;
}
