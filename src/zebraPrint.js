// Zebra GK420t label printing via Zebra Browser Print (ZPL, no print dialog).
// Layout facts come from the OrderHQ handoff (10/28/26), proven on real paper:
//   203 dpi, 4.25 x 2.75 in stock feeding the WIDE way (no rotation),
//   print head 4.09 in = 831 dots (^PW831), 0.12 in margins,
//   lowest text at least 0.22 in above the bottom edge.

// ---------- Browser Print client ----------
const BP = 'http://localhost:9100'

// text/plain avoids a CORS preflight; Browser Print whitelists the
// origin on first contact (it prompts the user once).
async function bp(path, body) {
  const res = await fetch(BP + path, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
  if (!res.ok) throw new Error(`BrowserPrint ${path}: ${res.status}`)
  return res.text()
}

// Find a Zebra to talk to. Prefers the service's default printer,
// falls back to the first available one. Returns the device object
// Browser Print expects back in /write, or null if the helper isn't
// running / no printer is connected.
export async function findZebraPrinter(timeoutMs = 1500) {
  const withTimeout = (p) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
  ])
  try {
    const txt = await withTimeout(bp('/default?type=printer'))
    const dev = JSON.parse(txt)
    if (dev && dev.uid) return dev
  } catch { /* fall through to /available */ }
  try {
    const txt = await withTimeout(bp('/available'))
    const list = JSON.parse(txt)
    const dev = (list.printer || [])[0]
    return dev && dev.uid ? dev : null
  } catch {
    return null
  }
}

export async function printZpl(device, zpl) {
  await bp('/write', JSON.stringify({ device, data: zpl }))
}

// ---------- Which labels to print (OrderHQ rule) ----------
// 1. Sold by the piece ("each") -> one label per piece, "1 of 3".
//    Sold by weight or measure (lb, per person) -> one label for the line, "5 LB".
// 2. Item override label_mode: "default" | "each" | "line".
// 3. Safety: quantity under 2, or any decimal quantity -> exactly one label.
export function labelCountFor(item, qty) {
  const q = Number(qty)
  if (!Number.isFinite(q) || q < 2 || !Number.isInteger(q)) return 1
  const mode = item?.label_mode || 'default'
  if (mode === 'each') return q
  if (mode === 'line') return 1
  return (item?.sold_by || 'each') === 'each' ? q : 1
}

function amountText(item, qty) {
  const q = Number(qty) || 1
  const sb = item?.sold_by || 'each'
  if (sb === 'lb') return `${q} LB`
  if (sb === 'person') return q === 1 ? '1 PERSON' : `${q} PEOPLE`
  return q > 1 ? `QTY ${q}` : ''
}

// Expand orders into one payload per physical label.
// fmt = { date: fn(yyyy-mm-dd), time: fn(hh:mm) }
export function buildLabels(orders, orderItemsMap, items, locs, fmt) {
  const out = []
  for (const o of orders) {
    const loc = locs.find(l => l.id === o.location_id)
    for (const li of (orderItemsMap[o.id] || [])) {
      const item = items.find(i => i.id === li.item_id)
      const n = labelCountFor(item, li.quantity)
      const base = {
        customer: o.customer_name || '',
        dailyNumber: o.daily_number ?? '',
        itemName: item?.name || '',
        note: o.notes || '',
        pickup: `${fmt.date(o.pickup_date)} ${fmt.time(o.pickup_time)}`.trim(),
        invoice: `#${o.invoice_number ?? ''}`,
        location: loc?.name || '',
      }
      if (n > 1) {
        for (let i = 1; i <= n; i++) out.push({ ...base, tag: `${i} of ${n}` })
      } else {
        out.push({ ...base, tag: amountText(item, li.quantity) })
      }
    }
  }
  return out
}

// ---------- Text measuring (OrderHQ approach: real canvas widths) ----------
let _ctx = null
function measureIn(text, pt, bold = true) {
  try {
    if (!_ctx) { _ctx = document.createElement('canvas').getContext('2d') }
    _ctx.font = `${bold ? 800 : 400} ${pt * 96 / 72}px Arial, Helvetica, sans-serif`
    return _ctx.measureText(text).width / 96
  } catch {
    return String(text).length * pt * (bold ? 0.72 : 0.6) / 72
  }
}
function wrapLinesMeasured(text, pt, availIn, bold = true) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? line + ' ' + w : w
    if (measureIn(next, pt, bold) <= availIn) line = next
    else { if (line) lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}
// Item name: normal capitalization (Mike, 10/28), hard 2-line limit.
export function fitName(name, availIn) {
  const text = String(name || '—')
  for (const s of [28, 24, 21]) {
    if (measureIn(text, s) <= availIn) return { pt: s, lines: [text] }
  }
  for (const s of [21, 18, 16]) {
    const lines = wrapLinesMeasured(text, s, availIn)
    if (lines.length <= 2) return { pt: s, lines }
  }
  return { pt: 14, lines: wrapLinesMeasured(text, 14, availIn).slice(0, 2) }
}
// Single line: shrink through sizes, then trim with an ellipsis.
function fitOneLine(text, sizes, availIn, bold = true) {
  const t = String(text || '')
  for (const s of sizes) if (measureIn(t, s, bold) <= availIn) return { pt: s, text: t }
  const s = sizes[sizes.length - 1]
  let cut = t
  while (cut.length > 1 && measureIn(cut + '…', s, bold) > availIn) cut = cut.slice(0, -1)
  return { pt: s, text: cut.trimEnd() + '…' }
}

// ---------- ZPL renderer: the butcher label layout ----------
const DPI = 203
const dots = (inches) => Math.round(inches * DPI)
const pt = (p) => Math.round(p * DPI / 72) // font pt -> dot height
const HEAD = 831 // GK420t printable width: 4.09in
const LABEL_W_IN = 4.25
const LABEL_H_IN = 2.75

function esc(s) {
  return String(s ?? '').replace(/[\^~\\]/g, ' ')
}

// IB round logo, 136 x 132 dots (~0.67 x 0.65 in), converted once from the
// brand SVG (see /zpl/logo_to_zpl.py). Do not convert per print.
const LOGO_GFA = '^GFA,2244,2244,17,000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000FFF800000000000000000000000000003FFFFFF000000000000000000000000003FFFFFFFF0000000000000000000000001FFFFB7FFFE000000000000000000000007FFCDB6CFFF80000000000000000000003FF6FFFFFDBFF000000000000000000000FFBFFFFFFFF7FC00000000000000000003FDFFFFFFFFFEFF0000000000000000000FFDFFFFFFFFFEFF8000000000000000001FEFFFFFFFFFFFDFE000000000000000007F3FFFE3FFBFFFFBF80000000000000000FFFFFFEFFFBC7FFFFC0000000000000001FDFFF1E7FFBDBFFEFE0000000000000007FFFFE7EFFFBC3FFFFF800000000000000FEFFFEFE1FFBF3C7FDFC00000000000001FFFFDE6F7FFFC7FBFFFE00000000000003F3FEEF1FFFFFFF83FF3F00000000000007FFFE2FFFFFFFFF1F9FFF8000000000000FDFFF47FFFFFFFFC7E7EFC000000000001FFFEF7FFFFFFFFFFFE7FFE000000000003F7FEFBFFFFFFFFFFF9FFBF000000000007FFFF7FFFE00007FFFBFFFF80000000000FFFFF3FFF0FFFF0FFFFFFFFC0000000000FDFCFBFF87FFFFE1FFFFFEFC0000000001FFFB7FFE3FFFFFFC7FFEFFFE0000000003E7F83FF8FFFFFFFF1FFE7F9F0000000007FFFDBFE3FFFFFFFFC7FF3FFF8000000007FFFE7FCFFFFFFFFFF3FF9FFF800000000FDFFEFF9FFFFFFFFFF9FFCFEFC00000001FFFFFFE7FFFFFFFFFFE7FE7FFC00000001F7F9FFCFFFFFFFFFFFF3FF3FFE00000003F7FBFF9FFFFFFFFFFFF9FFBFBF00000003FFF7FF3FFFC00007FFFCFFDFFF00000007DFE7FE7FFF000003FFFE7FCFEF80000007FFEFFCFFFF000007FFFF3FEFFF8000000FFFDFF9FFFFFC01FFFFFFBFF7FFC000000FBF9FFBFFFFFC03FFFFFFDFF3F7C000000FFFBFF7FFFFF803FFFFFFEFFBF7C000001FFF3FE7FFFFF807FFFFFFE7F9FFE000001F7F7FEFFFFFF007FFFFFFF7FDFBE000003FFE7FDFFFFFF00FFFFFFFFBFCFBF000003FFEFFDFFFFFE00FFFFFFFFBFEFFF000003EFEFFBFFFFFE01FFFFFFFFDFEFFF000007FFCFFBFFFFFC01FFFFFFFFDFE7DF000007FFDFF7FFFFFC03FFFFFFFFEFF7FF800007FF9FF7FFFFF803F0000FFFEFF7FF800007DF9FEFFFFFF807F00001FFE7F3EF80000FFFBFEFFFFFF007F00000FFF7FBFF80000FFFBFEFFFFFF00FFE03C07FF7FBFFC0000FBF3FDFFFFFE00FFE07F03FF3F9F7C0000FFF3FDFFFFFE01FFE07F83FFBF9FFC0000FFF7FDFFFFFC01FFC0FF81FFBFDFFC0000F3F7F9FFFFFC03FFC0FF81FFBFDF7C0001FFF7FBFFFFF803FF81FF81FF9FDFFC0001FFF7FBFFFFF807FF81FF81FFDFDFFE0001F7E7FBFFFFF007FF03FF81FFDFCFBE0001FFE7FBFFFFF00FFF03FF03FFDFCFBE0001FFE7FBFFFFE00FFE07FF03FFDFCFFE0001FFE7FBFFFFE01FFE07FE07FFDFCFFE0001F7E7FBFFFFC01FFC07FE07FFDFCFBE0001FFE7FBFFFFC03FFC0FFC0FFFDFCFFE0001FFE7FBFFFF803FF80FF81FFFDFCFFE0001F7E7FBFFFF807FF81FF03FFFDFCFBE0001FFE7FBFFFF007FF000007FFFDFCFFE0001FFE7FBFFFF00FFF00003FFFFDFCFFE0001F7E7FBFFFE00FFE01F03FFFFDFCFBE0001FFF7FBFFFE01FFE07FC0FFFFDFDFFC0000FFF7FBFFFC01FFC07FE07FFFDFDFFC0000FBF7FBFFFC03FFC0FFE03FFF9FDF7C0000FBF7F9FFF803FF80FFE03FFFBFDF7C0000FFF3FDFFF003FF80FFE01FFFBF9FFC0000FFF3FDFFE003FF01FFE01FFFBFBFFC0000FBFBFDFC00003F01FFE01FFFBFBE7800007FFBFEF800003E03FFE00FFF7FBFF800007FF9FEF800003E03FFC01FFF7F3FF800007DFDFEFFFFFFFC07FFC01FFE7F7EF800007FFDFF7FFFFFFC07FF801FFEFF7FF000003FFCFF7FFFFFF80FFF001FFEFE7FF000003EFEFF3FFFFFF80FFF003FFDFEFDF000003FFE7FBFFFFFF01FFE007FFDFCFFF000001FFF7F9FFFFFE01FFC00FFFBFDFFE000001F7F3FDFFFFFE01FF801FFFBF9FBE000000FFFFFEFFFFFC03FE003FFF7F9FFC000000FFFFFE7FFFFC03F8007FFE7FFFFC000000F9FFFF7FFFF803E001FFFEFFFEFC0000007FFFBFBFFF0000000FFFFDFFFFF80000007FFF3F9FFF000000FFFFF9E7FFF80000003EFCFFCFFFFFFFFFFFFFF3C8FDF00000003FFFFFE7FFFFFFFFFFFFE7C6FFF00000001FFFFFF3FFFFFFFFFFFFCFFDFFE00000001FBFF3F9FFFFFFFFFFFF9FFBF7C00000000FFF83FCFFFFFFFFFFFF3FFFFFC000000007FFC3FE7FFFFFFFFFFE7C3FFF8000000007FFE7FF3FFFFFFFFFFDFD9FDF8000000003FFF7BFCFFFFFFFFFF3F9DFFF0000000001F3FFBFE3FFFFFFFFC7FDBF7E0000000000FFFF7FF9FFFFFFFF1FFE3FFC0000000000FFFF67FE3FFFFFFC7F9FFFFC00000000007EFF1FFF8FFFFFF1FF4FFDF800000000003FFF7FFFF0FFFF0FFE4FFFF000000000001FBFFE7FFE00007FFF27F7E000000000000FFFFC7FFFFC3FFFEFBFFFC0000000000007EFF07FFFFFFFFF87BFDF80000000000003FFFE78FFFFFFFFA7FFFF00000000000001FDFF7A7FFFFFFF9BFEFE00000000000000FFFFF97DFFFFFFD3FFFC000000000000007F7FF470F770FFCFF3F8000000000000001FFFF6F77373FFFFFFE0000000000000000FEFFEF77171FFFFDFC00000000000000007FDFFF27473FFFEFF800000000000000001FFFFF9F678FFFEFE000000000000000000FFBFFFFFFFFFF7F80000000000000000003FF7FFFFFFFFBFF00000000000000000000FFEFFFFFFFDFFC000000000000000000003FFDFFFFFEFFF00000000000000000000007FFB6FDB7FF800000000000000000000001FFFFFFFFFE0000000000000000000000003FFFFFFFF000000000000000000000000003FFFFFF000000000000000000000000000007FF8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const LOGO_W = 136
const LOGO_H = 132

export function zplForLabel(p) {
  const W = Math.min(dots(LABEL_W_IN), HEAD) // 831
  const H = dots(LABEL_H_IN)                 // 558
  const M = dots(0.12)                       // 24
  const R = W - M                            // right edge of content
  const CW = R - M                           // content width
  const z = []
  // Same font-width pairing OrderHQ proved on paper against the canvas measure.
  const text = (x, y, sizePt, str, bold = false) => {
    const fh = pt(sizePt)
    const fw = Math.round(fh * (bold ? 0.62 : 0.5))
    z.push(`^FO${Math.max(0, Math.round(x))},${Math.max(0, Math.round(y))}^A0N,${fh},${fw}^FD${esc(str)}^FS`)
    return fh
  }
  // Centered text inside a field block of width w.
  const textC = (x, y, w, sizePt, str, bold = false) => {
    const fh = pt(sizePt)
    const fw = Math.round(fh * (bold ? 0.62 : 0.5))
    z.push(`^FO${Math.round(x)},${Math.round(y)}^A0N,${fh},${fw}^FB${Math.round(w)},1,0,C,0^FD${esc(str)}^FS`)
    return fh
  }
  const rule = (y) => z.push(`^FO${M},${Math.round(y)}^GB${CW},3,3^FS`)
  const inOf = (d) => d / DPI

  z.push('^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0')

  // ---- bottom band FIRST, so the item section can never run into it ----
  const valPtMax = 11
  const valY = H - dots(0.22) - pt(valPtMax)   // lowest text bottom = 0.22in above edge
  const capY = valY - pt(7.5) - dots(0.03)
  const rule2Y = capY - dots(0.06)
  // Pickup (date + time) is the longest value, so it gets the widest column.
  const shares = [0.42, 0.22, 0.36]
  const cols = [['PICKUP', p.pickup], ['INVOICE', p.invoice], ['LOCATION', p.location]]
  let colX = M
  cols.forEach(([cap, val], i) => {
    const colW = Math.floor(CW * shares[i])
    const x = colX
    colX += colW
    text(x, capY, 7.5, cap, true)
    const f = fitOneLine(val, [11, 10, 9, 8], inOf(colW - dots(0.06)))
    text(x, valY + (pt(valPtMax) - pt(f.pt)), f.pt, f.text, true)
  })
  rule(rule2Y)

  // ---- top band ----
  const topY = M
  z.push(`^FO${M},${topY}${LOGO_GFA}^FS`)
  text(M + 4, topY + LOGO_H + dots(0.01), 7, 'ibfoods.com')

  // ORDER box, fully inside the right margin
  const num = String(p.dailyNumber)
  const numPt = num.length >= 3 ? 26 : 32
  const boxW = dots(0.85)
  const boxH = dots(0.72)
  const boxX = R - boxW
  z.push(`^FO${boxX},${topY}^GB${boxW},${boxH},4^FS`)
  textC(boxX, topY + dots(0.06), boxW, 7, 'ORDER', true)
  textC(boxX, topY + dots(0.06) + pt(7) + dots(0.04), boxW, numPt, num, true)

  // CUSTOMER block, centered between logo and box
  const cx = M + LOGO_W + dots(0.08)
  const cw = boxX - dots(0.08) - cx
  textC(cx, topY + dots(0.08), cw, 7.5, 'CUSTOMER', true)
  const cf = fitOneLine(p.customer, [20, 18, 16, 14, 12], inOf(cw))
  textC(cx, topY + dots(0.08) + pt(7.5) + dots(0.06), cw, cf.pt, cf.text, true)

  const rule1Y = topY + LOGO_H + dots(0.01) + pt(7) + dots(0.05)
  rule(rule1Y)

  // ---- item section: between the two rules ----
  const yMax = rule2Y - dots(0.04)
  let y = rule1Y + dots(0.07)
  text(M, y, 7.5, 'ITEM', true)
  if (p.tag) {
    const tf = fitOneLine(p.tag, [12], 1.5)
    const tagW = Math.round(measureIn(tf.text, 12) * DPI)
    text(R - tagW, y - dots(0.02), 12, tf.text, true)
  }
  y += pt(7.5) + dots(0.05)
  const fit = fitName(p.itemName, inOf(CW))
  for (const ln of fit.lines) {
    y += text(M, y, fit.pt, ln, true) + dots(0.02)
  }
  if (p.note) {
    const lines = wrapLinesMeasured(p.note, 11, inOf(CW), false).slice(0, 2)
    for (const ln of lines) {
      if (y + dots(0.02) + pt(11) > yMax) break
      y += text(M, y + dots(0.02), 11, ln) + dots(0.01)
    }
  }

  z.push('^XZ')
  return z.join('')
}

// All labels in one job.
export function zplForLabels(labels) {
  return labels.map(zplForLabel).join('\n')
}
