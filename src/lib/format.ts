export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
export function agoLong(iso: string): string {
  const a = ago(iso);
  if (a === "just now") return a;
  if (/^\d+[mhd]$/.test(a)) {
    const n = parseInt(a); const u = a.slice(-1);
    const word = u === "m" ? "minute" : u === "h" ? "hour" : "day";
    return `${n} ${word}${n === 1 ? "" : "s"} ago`;
  }
  return a;
}
export function when(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
