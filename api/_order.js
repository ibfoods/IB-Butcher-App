// Shared order formatting for the serverless functions. Mirrors src/orderFmt.js
// (kept separate because /api runs in Node without the Vite bundle).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov #12" — the monthly order number as spoken to a customer.
export function orderNumberText(order) {
  const seq = order?.order_seq ?? order?.daily_number;
  const m = parseInt(String(order?.pickup_date || "").slice(5, 7), 10);
  const mon = MONTHS[m - 1] || "";
  return `${mon ? mon + " " : ""}#${seq ?? ""}`.trim();
}
// "Nov" for the small label above the number.
export function orderMonthText(order) {
  const m = parseInt(String(order?.pickup_date || "").slice(5, 7), 10);
  return MONTHS[m - 1] || "";
}
export function orderSeqText(order) {
  return String(order?.order_seq ?? order?.daily_number ?? "");
}

const trimNum = (q) => {
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q ?? "");
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
};

// "4 lb" / "× 4" / "4 people" — unit-aware quantity.
export function qtyText(item, qty, { times = "× " } = {}) {
  const sb = item?.sold_by || "each";
  const q = trimNum(qty);
  if (sb === "lb") return `${q} lb`;
  if (sb === "person") return Number(qty) === 1 ? "1 person" : `${q} people`;
  return `${times}${q}`;
}
