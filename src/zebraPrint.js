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
  const n = Number(qty) || 1
  const q = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)))
  const sb = item?.sold_by || 'each'
  if (sb === 'lb') return `${q} LB`
  if (sb === 'person') return n === 1 ? '1 PERSON' : `${q} PEOPLE`
  return n > 1 ? `QTY ${q}` : ''
}
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const monthOf = (d) => MONTHS[parseInt(String(d || '').slice(5, 7), 10) - 1] || ''

// Expand orders into one payload per physical label.
// fmt = { date: fn(yyyy-mm-dd), time: fn(hh:mm) }
export function buildLabels(orders, orderItemsMap, items, locs, fmt) {
  const out = []
  for (const o of orders) {
    const loc = locs.find(l => l.id === o.location_id)
    let first = true
    for (const li of (orderItemsMap[o.id] || [])) {
      const item = items.find(i => i.id === li.item_id)
      const n = labelCountFor(item, li.quantity)
      // Item note goes on that item's label(s); the order-level note only on the
      // first label of the order so it isn't repeated on every piece.
      const base = {
        customer: o.customer_name || '',
        month: monthOf(o.pickup_date),
        dailyNumber: o.daily_number ?? o.order_seq ?? '',   // the number the customer was given
        itemName: item?.name || '',
        note: li.note || '',
        pickup: `${fmt.date(o.pickup_date)} ${fmt.time(o.pickup_time)}`.trim(),
        phone: o.customer_phone || '',
        location: loc?.name || '',
      }
      if (n > 1) {
        for (let i = 1; i <= n; i++) out.push({ ...base, tag: `${i} of ${n}` })
      } else {
        out.push({ ...base, tag: amountText(item, li.quantity) })
      }
      // Order-level note rides on the very first label of the order only.
      if (first && o.notes) { const f = out[out.length - (n > 1 ? n : 1)]; f.note = [f.note, o.notes].filter(Boolean).join(' · ') }
      first = false
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

// ---- Label logo -------------------------------------------------------------
// Which logo prints on labels. To go back to the original solid-black logo,
// change 'light' to 'dark' — that's the only line to touch. (The browser-print
// backup in App.jsx follows this same setting.)
export const LABEL_LOGO_STYLE = 'light'

// Both are IB round logos, 136 x 132 dots (~0.67 x 0.65 in), converted once.
// Do not convert per print.
// DARK  = original solid black disc, white letters (/zpl/logo_to_zpl.py).
//         Printed too dark on the GK420t and lost its detail.
// LIGHT = black letters and rings on a white disc, from the 2024 white
//         monogram (/zpl/logo_light_to_zpl.py). Added Nov 2026.
const LOGO_GFA_DARK = '^GFA,2244,2244,17,000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000FFF800000000000000000000000000003FFFFFF000000000000000000000000003FFFFFFFF0000000000000000000000001FFFFB7FFFE000000000000000000000007FFCDB6CFFF80000000000000000000003FF6FFFFFDBFF000000000000000000000FFBFFFFFFFF7FC00000000000000000003FDFFFFFFFFFEFF0000000000000000000FFDFFFFFFFFFEFF8000000000000000001FEFFFFFFFFFFFDFE000000000000000007F3FFFE3FFBFFFFBF80000000000000000FFFFFFEFFFBC7FFFFC0000000000000001FDFFF1E7FFBDBFFEFE0000000000000007FFFFE7EFFFBC3FFFFF800000000000000FEFFFEFE1FFBF3C7FDFC00000000000001FFFFDE6F7FFFC7FBFFFE00000000000003F3FEEF1FFFFFFF83FF3F00000000000007FFFE2FFFFFFFFF1F9FFF8000000000000FDFFF47FFFFFFFFC7E7EFC000000000001FFFEF7FFFFFFFFFFFE7FFE000000000003F7FEFBFFFFFFFFFFF9FFBF000000000007FFFF7FFFE00007FFFBFFFF80000000000FFFFF3FFF0FFFF0FFFFFFFFC0000000000FDFCFBFF87FFFFE1FFFFFEFC0000000001FFFB7FFE3FFFFFFC7FFEFFFE0000000003E7F83FF8FFFFFFFF1FFE7F9F0000000007FFFDBFE3FFFFFFFFC7FF3FFF8000000007FFFE7FCFFFFFFFFFF3FF9FFF800000000FDFFEFF9FFFFFFFFFF9FFCFEFC00000001FFFFFFE7FFFFFFFFFFE7FE7FFC00000001F7F9FFCFFFFFFFFFFFF3FF3FFE00000003F7FBFF9FFFFFFFFFFFF9FFBFBF00000003FFF7FF3FFFC00007FFFCFFDFFF00000007DFE7FE7FFF000003FFFE7FCFEF80000007FFEFFCFFFF000007FFFF3FEFFF8000000FFFDFF9FFFFFC01FFFFFFBFF7FFC000000FBF9FFBFFFFFC03FFFFFFDFF3F7C000000FFFBFF7FFFFF803FFFFFFEFFBF7C000001FFF3FE7FFFFF807FFFFFFE7F9FFE000001F7F7FEFFFFFF007FFFFFFF7FDFBE000003FFE7FDFFFFFF00FFFFFFFFBFCFBF000003FFEFFDFFFFFE00FFFFFFFFBFEFFF000003EFEFFBFFFFFE01FFFFFFFFDFEFFF000007FFCFFBFFFFFC01FFFFFFFFDFE7DF000007FFDFF7FFFFFC03FFFFFFFFEFF7FF800007FF9FF7FFFFF803F0000FFFEFF7FF800007DF9FEFFFFFF807F00001FFE7F3EF80000FFFBFEFFFFFF007F00000FFF7FBFF80000FFFBFEFFFFFF00FFE03C07FF7FBFFC0000FBF3FDFFFFFE00FFE07F03FF3F9F7C0000FFF3FDFFFFFE01FFE07F83FFBF9FFC0000FFF7FDFFFFFC01FFC0FF81FFBFDFFC0000F3F7F9FFFFFC03FFC0FF81FFBFDF7C0001FFF7FBFFFFF803FF81FF81FF9FDFFC0001FFF7FBFFFFF807FF81FF81FFDFDFFE0001F7E7FBFFFFF007FF03FF81FFDFCFBE0001FFE7FBFFFFF00FFF03FF03FFDFCFBE0001FFE7FBFFFFE00FFE07FF03FFDFCFFE0001FFE7FBFFFFE01FFE07FE07FFDFCFFE0001F7E7FBFFFFC01FFC07FE07FFDFCFBE0001FFE7FBFFFFC03FFC0FFC0FFFDFCFFE0001FFE7FBFFFF803FF80FF81FFFDFCFFE0001F7E7FBFFFF807FF81FF03FFFDFCFBE0001FFE7FBFFFF007FF000007FFFDFCFFE0001FFE7FBFFFF00FFF00003FFFFDFCFFE0001F7E7FBFFFE00FFE01F03FFFFDFCFBE0001FFF7FBFFFE01FFE07FC0FFFFDFDFFC0000FFF7FBFFFC01FFC07FE07FFFDFDFFC0000FBF7FBFFFC03FFC0FFE03FFF9FDF7C0000FBF7F9FFF803FF80FFE03FFFBFDF7C0000FFF3FDFFF003FF80FFE01FFFBF9FFC0000FFF3FDFFE003FF01FFE01FFFBFBFFC0000FBFBFDFC00003F01FFE01FFFBFBE7800007FFBFEF800003E03FFE00FFF7FBFF800007FF9FEF800003E03FFC01FFF7F3FF800007DFDFEFFFFFFFC07FFC01FFE7F7EF800007FFDFF7FFFFFFC07FF801FFEFF7FF000003FFCFF7FFFFFF80FFF001FFEFE7FF000003EFEFF3FFFFFF80FFF003FFDFEFDF000003FFE7FBFFFFFF01FFE007FFDFCFFF000001FFF7F9FFFFFE01FFC00FFFBFDFFE000001F7F3FDFFFFFE01FF801FFFBF9FBE000000FFFFFEFFFFFC03FE003FFF7F9FFC000000FFFFFE7FFFFC03F8007FFE7FFFFC000000F9FFFF7FFFF803E001FFFEFFFEFC0000007FFFBFBFFF0000000FFFFDFFFFF80000007FFF3F9FFF000000FFFFF9E7FFF80000003EFCFFCFFFFFFFFFFFFFF3C8FDF00000003FFFFFE7FFFFFFFFFFFFE7C6FFF00000001FFFFFF3FFFFFFFFFFFFCFFDFFE00000001FBFF3F9FFFFFFFFFFFF9FFBF7C00000000FFF83FCFFFFFFFFFFFF3FFFFFC000000007FFC3FE7FFFFFFFFFFE7C3FFF8000000007FFE7FF3FFFFFFFFFFDFD9FDF8000000003FFF7BFCFFFFFFFFFF3F9DFFF0000000001F3FFBFE3FFFFFFFFC7FDBF7E0000000000FFFF7FF9FFFFFFFF1FFE3FFC0000000000FFFF67FE3FFFFFFC7F9FFFFC00000000007EFF1FFF8FFFFFF1FF4FFDF800000000003FFF7FFFF0FFFF0FFE4FFFF000000000001FBFFE7FFE00007FFF27F7E000000000000FFFFC7FFFFC3FFFEFBFFFC0000000000007EFF07FFFFFFFFF87BFDF80000000000003FFFE78FFFFFFFFA7FFFF00000000000001FDFF7A7FFFFFFF9BFEFE00000000000000FFFFF97DFFFFFFD3FFFC000000000000007F7FF470F770FFCFF3F8000000000000001FFFF6F77373FFFFFFE0000000000000000FEFFEF77171FFFFDFC00000000000000007FDFFF27473FFFEFF800000000000000001FFFFF9F678FFFEFE000000000000000000FFBFFFFFFFFFF7F80000000000000000003FF7FFFFFFFFBFF00000000000000000000FFEFFFFFFFDFFC000000000000000000003FFDFFFFFEFFF00000000000000000000007FFB6FDB7FF800000000000000000000001FFFFFFFFFE0000000000000000000000003FFFFFFFF000000000000000000000000003FFFFFF000000000000000000000000000007FF8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const LOGO_GFA_LIGHT = '^GFA,2244,2244,17,000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000FFFFE0000000000000000000000000001FFFFFFF00000000000000000000000001FFFFFFFFF000000000000000000000000FFFC9B27FFE00000000000000000000003FF6FDB7EDFF8000000000000000000000FF3740005D9FE000000000000000000007F9B0000001B3F80000000000000000000FED8000000036FE0000000000000000003FEC00000000063F800000000000000000FE600000000000CFE00000000000000001FB00007C01C0001BF00000000000000007E30000FC038F8018F8000000000000000FC8003CF8018F80027E000000000000001F00007C78018F8E001F000000000000003E4004707C018F8F00CF800000000000007C000C767C018F8F8007C0000000000001F0007E7E70000F1F9803E0000000000003E0007E3C0000003F9C00F0000000000007C0007F000000003F1F007800000000000780067F000000000F0F003C00000000000F000F3A0003FE00021F001E00000000001E000718007FFFF0003C000F00000000003C00038007FFFFFF0038000780000000007800E3801FF0007FC0000007C000000000F801F9807F000007F0007003C000000000F001F801F8000000FC007801E000000001E001F807E00000003F007C00F000000003C000F80F800000000F803C007000000003C000703E0000000003E01E0078000000078008607C0000000001F00F003C00000007001C00F000000000007807801C0000000F003C01E000000000003C03C01E0000001E003803C001FFFFF0001E01C00E0000001E0070078003FFFFF8000F01E00F0000001C00F00F0003FFFFF8000780F0070000003C00E01E0003FFFFF00003C070078000003801C03C00001FFE000001C078038000007801C03800001FF8000000E03803C000007003807000001FF8000000F01C01C00000F00380F000003FF0000000701C01C00000E00700E000003FF0000000380E01E00000E00701C000007FE00000003C0E00E00001E00E01C000007FE00000001C0F00E00001C00E03800000FFC00000000E0700F00001C00E03800000FFC00000000E0700700001C01C07000001FF83FFFF00060380700003C01C07000001FF87FFFFC0070380780003801C07000003FF07FFFFE007038038000380380E000003FF07FFFFF003818038000380380E000007FE007F8FF80381C038000380380E000007FE00FF03FC0381C038000780380C00000FFC00FF01FC0181C038000700301C00000FFC01FE01FC01C1C03C000700301C00001FF801FE01FC01C0C01C000700701C00001FF803FC01FC01C0E01C000700701800003FF003FC03FC00C0E01C000700701800003FF007F803FC00C0E01C000700701800007FE007F803F800C0E01C00070070180000FFE00FF807F800C0E01C00070070380000FFC00FF00FF000C0E01C00070070380001FFC01FF00FF000C0E01C00070070380001FF801FE01FE000C0E01C00070070380003FF803FE03FC000C0E01C00070070380003FF003FFFFF8000C0E01C00070070180007FF007FFFFF0000C0E01C00070070180007FE007FFFFC0000C0E01C0007007018000FFE00FFE7FE0000C0E01C0007007018000FFC00FF80FF0000C0C01C000700301C001FFC01FF007F8001C0C03C000780381C001FFC01FF007FC001C1C038000380381C003FF803FE007FC001C1C038000380380C00FFF803FE007FC00181C038000380380E1FFFFF87FC007FE00381C0380003801C0E1FFFFF87FC00FFE0038380780003C01C0E1FFFFF8FF800FFE0030380700001C01C071FFFFF8FF800FFE0070380700001C01C070000001FF001FFC0070700700001C00E070000001FF003FFC00E0700F00001E00E038000003FE007FFC00E0700E00000E007038000003FE007FF800E0E00E00000F00701C000007FE01FFF001C0E01E00000F00781C000007FC03FFF003C1E01C00000700380E00000FFC07FFE00381C01C00000780300F00001FF81FFF800701C03C00000380000700003FFDFFFF000F000038000003C001C38003FFFFFFFC000E300078000001C007C1C003FFFFFFE0001C7C0070000001E00F81E003FFFFFF00003CFE00F0000000E00F00F000000000000078FE00E0000000F00C0078000000000000F0FE01E00000007000383C000000000001E07C03C00000007801F81E000000000003C01803C00000003C03F80F0000000000078F8007800000003C01F807C0000000001F1FC00F000000001E007183E0000000003E1DC00F000000000F007380F800000000F81FC01E00000000078063A07E00000003F00FC03C00000000078003F01F8000000FC1EF807C0000000003C007F007F000007F07E000780000000001E007C201FF0007FC07E000F00000000000F00307007FFFFFE007F801E0000000000078001F0007FFFF00E3F003C000000000003C003F08001FC003F3C0078000000000001E003F1E00000003F9C01F0000000000000F80071F00000003F8003E00000000000007C8073F1E000E01F8027C00000000000003E0033F3F333E01F800F800000000000001F3003F3F3F3E00E019F000000000000000FC4036333F3C0000C7E0000000000000003E60063F3F3E0000DF80000000000000001F9C003F3F3F00063F00000000000000000FEB001E373E0036FC000000000000000003F9A000120000B3F8000000000000000000FE740000000D8FE00000000000000000003FCEC000006C7F800000000000000000000FF8DB001B67FE0000000000000000000003FF9B6FFB3FF800000000000000000000007FFE649FFFC000000000000000000000000FFFFFFFFE00000000000000000000000001FFFFFFE00000000000000000000000000007FFFC0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const LOGO_GFA = LABEL_LOGO_STYLE === 'dark' ? LOGO_GFA_DARK : LOGO_GFA_LIGHT
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
  const shares = [0.38, 0.34, 0.28]
  const cols = [['PICKUP', p.pickup], ['PHONE', p.phone], ['LOCATION', p.location]]
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
  textC(boxX, topY + dots(0.06), boxW, 7, p.month ? `${p.month} ORDER` : 'ORDER', true)
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
