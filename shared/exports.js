// Export formats for managers who also use other property-management software (AppFolio, Buildium, Yardi…):
// a CSV of requests and a plain-text work order to paste into another system. Pure functions, tested in tests/exports.test.js.
import { finalUrgency } from "./workorders.js";

const yn = (v) => (v === true ? "Yes" : v === false ? "No" : "");

/** One CSV cell: quoted when needed, and guarded against spreadsheet formula injection. */
export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "2026-10-05 14:30" in the given time zone (default: the device's). */
export function stamp(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const CSV_COLUMNS = [
  "Reference", "Created", "Property", "Unit", "Resident", "Category", "Priority", "AI urgency", "Resident urgency",
  "Urgency change reason", "Title", "Description", "Location in home", "Permission to enter", "Entry notes", "Access notes",
  "Pets", "Best times", "Status", "Scheduled visit", "Technician", "Fixed on first visit", "After hours", "Language", "Photo", "Video",
];

/**
 * CSV of requests. `ctx`: { propName(id), residentName(id), reason(id) → reason code or "", timeZone? }.
 * Headers stay in English because most property-management imports expect them.
 */
export function requestsCSV(rows, ctx = {}) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const cells = [
      r.ref, stamp(r.created_at, ctx.timeZone), ctx.propName?.(r.property_id) || "", r.unit || "", ctx.residentName?.(r.resident_id) || "",
      r.category, finalUrgency(r), r.ai_urgency || "", r.urgency, ctx.reason?.(r.id) || "", r.title, r.body, r.location_in_home || "",
      yn(r.entry_permission), r.entry_notes || "", r.access_notes || "", yn(r.has_pets), r.availability || "", r.status,
      stamp(r.scheduled_for, ctx.timeZone), r.tech || "", yn(r.first_visit), yn(r.after_hours), r.lang || "en",
      yn(!!(r.photo_path || r.has_photo)), yn(!!r.video_path),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens accents (Spanish) correctly
}

/**
 * Plain-text work order. `t(s, vars)` translates labels into the reader's language; `ctx`: { property, resident, phone, link, when }.
 */
export function workOrderText(r, ctx, t = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s)) {
  const lvl = finalUrgency(r);
  const out = [];
  out.push(`${t("WORK ORDER")} ${r.ref} · ${t(lvl).toUpperCase()}`);
  out.push([ctx.property, r.unit].filter(Boolean).join(" · "));
  if (ctx.resident) out.push(`${t("Resident")}: ${ctx.resident}${ctx.phone ? ` · ${ctx.phone}` : ""}`);
  out.push(`${t("Reported")}: ${ctx.when || stamp(r.created_at)}${r.after_hours ? ` (${t("after hours")})` : ""}`);
  out.push(`${t("Category")}: ${t(r.category)}${r.location_in_home ? ` · ${t("Where")}: ${t(r.location_in_home)}` : ""}`);
  out.push("", r.title, "", r.body);
  if (r.answers?.length) { out.push("", `${t("Details")}:`); for (const a of r.answers) out.push(`- ${a.q} ${a.a}`); }
  const access = [];
  if (r.entry_permission !== null && r.entry_permission !== undefined) access.push(`${t("Permission to enter")}: ${t(yn(r.entry_permission))}${r.entry_notes ? ` (${r.entry_notes})` : ""}`);
  if (r.has_pets !== null && r.has_pets !== undefined) access.push(`${t("Pets")}: ${t(yn(r.has_pets))}`);
  if (r.access_notes) access.push(`${t("Access notes")}: ${r.access_notes}`);
  if (r.availability) access.push(`${t("Best times")}: ${r.availability.split(", ").map((x) => t(x)).join(", ")}`);
  if (access.length) out.push("", ...access);
  if (r.ai_urgency) out.push("", `${t("AI check")}: ${t(r.ai_urgency)}${r.ai_reason ? `. ${r.ai_reason}` : ""}`);
  if (r.photo_path || r.video_path || r.has_photo) out.push(`${t("Photo or video attached in CanItWait")}${ctx.link ? `: ${ctx.link}` : ""}`);
  else if (ctx.link) out.push(ctx.link);
  return out.join("\n");
}
