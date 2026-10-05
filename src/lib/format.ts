import { getLang, locale, tt } from "./i18n";

const es = () => getLang() === "es";

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return tt("just now");
  const m = Math.floor(s / 60); if (m < 60) return es() ? `${m} min` : `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return es() ? `${h} h` : `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return es() ? `${d} d` : `${d}d`;
  return new Date(iso).toLocaleDateString(locale(), { month: "short", day: "numeric" });
}
/** "3 hours ago" / "hace 3 horas". */
export function agoLong(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return tt("just now");
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 30) return new Date(iso).toLocaleDateString(locale(), { month: "short", day: "numeric" });
  const W = /* i18n */["{n} minute ago", "{n} minutes ago", "{n} hour ago", "{n} hours ago", "{n} day ago", "{n} days ago"];
  const [n, one, many] = m < 60 ? [m, W[0], W[1]] : h < 24 ? [h, W[2], W[3]] : [d, W[4], W[5]];
  return tt(n === 1 ? one : many, { n });
}
export function when(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/** Full date and time with time zone, for records: "Mon, Oct 5, 2026, 2:41 AM EDT". */
export function stampLong(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
export function isAfterHours(d = new Date()): boolean { const h = d.getHours(), day = d.getDay(); return day === 0 || day === 6 || h < 8 || h >= 18; }
export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}
export function telHref(phone: string): string { return "tel:" + phone.replace(/[^\d+]/g, ""); }
/** Hours an open request has waited, judged against its urgency. */
export function ageLevel(created: string, urgency: string, status: string): "" | "slow" | "late" {
  if (!["new", "acknowledged"].includes(status)) return "";
  const h = (Date.now() - new Date(created).getTime()) / 3600e3;
  const limit = urgency === "Emergency" ? 0.5 : urgency === "Urgent" ? 12 : 72;
  if (h > limit * 2) return "late";
  if (h > limit) return "slow";
  return "";
}

/** "Tue, Oct 6 at 9:00 AM" / "mar, 6 oct a las 9:00 a. m." */
export function visitTime(iso: string): string {
  const d = new Date(iso);
  return tt("{date} at {time}", {
    date: d.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }),
  });
}
/** Short human duration: "15m", "3.5h", "2.1d". */
export function duration(ms: number | null): string {
  if (ms == null) return "—";
  const m = ms / 6e4;
  const num = (x: number) => x.toLocaleString(locale(), { maximumFractionDigits: 1 });
  if (m < 60) return es() ? `${Math.max(1, Math.round(m))} min` : `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 48) return `${num(h < 10 ? Math.round(h * 10) / 10 : Math.round(h))}${es() ? " h" : "h"}`;
  const d = h / 24;
  return `${num(d < 10 ? Math.round(d * 10) / 10 : Math.round(d))}${es() ? " d" : "d"}`;
}
export const money = (n: number) => n.toLocaleString(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export function ordinal(n: number): string {
  if (es()) return `${n}.º`;
  const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string { const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
