// Shared UI primitives. Styles live in App.css under the same names.
// Anything visual that repeats across screens belongs here, not inline.

const NOFILL = { autoComplete: "one-time-code", name: "nofill", "data-lpignore": "true", "data-1p-ignore": "true" };

export const cx = (...a) => a.filter(Boolean).join(" ");

// ── Buttons ───────────────────────────────────────────────────────────────
// variant: primary | secondary | outline | danger | danger-soft | ok-soft | ghost | link
// size: sm | md | lg
export function Button({ variant = "secondary", size = "md", full, icon, className, children, ...rest }) {
  const cls = cx("btn", `btn-${variant}`, size !== "md" && `btn-${size}`, full && "btn-full", className);
  return <button type="button" className={cls} {...rest}>{icon && <Icon name={icon} />}{children}</button>;
}

export function Card({ tight, row, tappable, className, children, ...rest }) {
  return <div className={cx("card", tight && "tight", row && "row", tappable && "tappable", className)} {...rest}>{children}</div>;
}

export function Pill({ on, count, children, ...rest }) {
  return <button type="button" className={cx("pill", on && "on")} {...rest}>{children}{count !== undefined && <span className="count">{count}</span>}</button>;
}

export function Chip({ tone = "neutral", children }) {
  return <span className={cx("chip", `chip-${tone}`)}>{children}</span>;
}

export function Toggle({ on, onChange, label }) {
  return (
    <span className={cx("toggle", on && "on")} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      {label && <span>{label}</span>}
      <span className="track"><span className="knob" /></span>
    </span>
  );
}

// ── Fields ────────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, className }) {
  return (
    <div className={cx("field", className)}>
      {label && <label className="field-label">{label}</label>}
      {children}
      {error ? <p className="field-err">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, bad, mono, inline, ...rest }) {
  return <input {...NOFILL} className={cx("input", bad && "bad", mono && "mono", inline && "inline", className)} {...rest} />;
}
export function Select({ className, inline, children, ...rest }) {
  return <select className={cx("input", inline && "inline", className)} {...rest}>{children}</select>;
}
export function Textarea({ className, ...rest }) {
  return <textarea {...NOFILL} className={cx("input", className)} {...rest} />;
}
export function PasswordInput({ className, ...rest }) {
  return <input autoComplete="new-password" type="password" className={cx("input", className)} {...rest} />;
}

// ── Feedback ──────────────────────────────────────────────────────────────
export function Banner({ tone = "info", children, style }) {
  return <div className={cx("banner", `banner-${tone}`)} style={style}>{children}</div>;
}
export function Loading({ text = "Loading…" }) {
  return <div className="loading"><div className="spinner" /><p>{text}</p></div>;
}
export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

// ── Modal ─────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="h2">{title}</div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Icons (inline SVG, currentColor) ──────────────────────────────────────
const PATHS = {
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 2 8 6 8-6",
  printer: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  plus: "M12 5v14M5 12h14",
  back: "M15 18l-6-6 6-6",
  chevron: "M9 6l6 6-6 6",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm9 16-4-4",
  x: "M6 6l12 12M18 6 6 18",
};
export function Icon({ name, size = 18, style }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function MadeBy() {
  return (
    <a className="madeby" href="https://orderhq.app" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <span>Made by</span><img src="/brand/orderhq-wordmark.svg" alt="OrderHQ" />
    </a>
  );
}
