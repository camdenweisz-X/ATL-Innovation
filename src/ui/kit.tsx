import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";
import type { Status, Urgency } from "../lib/types";
import { STATUS_LABEL } from "../../shared/triage.js";

export function Button({ variant = "primary", size, block, loading, icon, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-outline"; size?: "sm"; block?: boolean; loading?: boolean; icon?: IconName }) {
  const cls = ["btn", variant !== "primary" && variant, size, block && "block", rest.className].filter(Boolean).join(" ");
  return (
    <button {...rest} className={cls} disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, optional, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}{optional && <span className="opt"> (optional)</span>}</label>
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <p className="err" role="alert"><Icon name="alert" width={16} height={16} />{error}</p>}
    </div>
  );
}

export function useFieldId() { return useId(); }

export function UrgencyBadge({ u }: { u: Urgency }) {
  const icon: IconName = u === "Emergency" ? "alert" : u === "Urgent" ? "clock" : "calendar";
  return <span className={`badge ${u}`}><Icon name={icon} />{u}</span>;
}
export function StatusBadge({ s, manager }: { s: Status; manager?: boolean }) {
  return <span className={`badge status ${s}`}>{manager ? MANAGER_LABEL[s] : STATUS_LABEL[s]}</span>;
}
export const MANAGER_LABEL: Record<Status, string> = { ...STATUS_LABEL, new: "New", acknowledged: "Seen" };

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} /></div>
      <div className="h3">{title}</div>
      {children && <div className="muted small" style={{ maxWidth: 360 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 72, n = 3 }: { h?: number; n?: number }) {
  return <div className="stack-sm" aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="row muted" style={{ justifyContent: "center", padding: 32 }} role="status"><span className="spinner" />{label}</div>;
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !ref.current) return;
      // Keep keyboard focus inside the dialog.
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus(), 30);
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy || tid} ref={ref}>
        <div className="grab" />
        {title && (
          <div className="between" style={{ marginBottom: 16 }}>
            <h2 className="h2" id={tid}>{title}</h2>
            <button className="icon-btn" data-close onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`} role={t.kind === "error" ? "alert" : "status"}>
            <Icon name={t.kind === "error" ? "alert" : t.kind === "info" ? "bell" : "check"} />{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function CopyButton({ text, label = "Copy", size = "sm" }: { text: string; label?: string; size?: "sm" }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" size={size} icon={done ? "check" : "copy"} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : label}</Button>
  );
}

export function YesNo({ value, onChange, labelledBy, neutral }: { value: boolean | null | undefined; onChange: (v: boolean | null) => void; labelledBy?: string; neutral?: boolean }) {
  return (
    <span className={`yn ${neutral ? "neutral" : ""}`} role="group" aria-labelledby={labelledBy}>
      <button type="button" className="yes" aria-pressed={value === true} onClick={() => onChange(value === true ? null : true)}>Yes</button>
      <button type="button" className="no" aria-pressed={value === false} onClick={() => onChange(value === false ? null : false)}>No</button>
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <span className="switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></span>;
}
