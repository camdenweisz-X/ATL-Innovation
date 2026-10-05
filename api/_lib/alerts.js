// Emergency alerting shared by /api/notify (right after a resident reports) and /api/escalate (the every-minute check).
import { tr, LOCALE } from "../../shared/i18n.js";
import { workOrderText } from "../../shared/exports.js";
import { esc, emailLayout, sendEmail, sendPush, sendSMS } from "./channels.js";

const TZ = "America/New_York";

export async function emailOf(admin, userId) {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

/** Everything needed to describe a request to people: property, settings, managers and profiles. */
export async function loadContext(admin, q) {
  const [{ data: prop }, { data: settings }, { data: mgrs }] = await Promise.all([
    admin.from("properties").select("id, name, after_hours_phone").eq("id", q.property_id).maybeSingle(),
    admin.from("property_settings").select("*").eq("property_id", q.property_id).maybeSingle(),
    admin.from("memberships").select("user_id").eq("property_id", q.property_id).eq("role", "manager"),
  ]);
  const managerIds = (mgrs || []).map((m) => m.user_id);
  const { data: profs } = await admin.from("profiles").select("id, full_name, phone, lang, notify_email, notify_sms").in("id", [...managerIds, q.resident_id]);
  const prof = (id) => profs?.find((p) => p.id === id) || { id, full_name: "", phone: null, lang: "en", notify_email: true, notify_sms: true };
  return { prop, settings, managerIds, prof };
}

export const placeOf = (ctx, q) => `${ctx.prop?.name || ""}${q.unit ? `, ${q.unit}` : ""}`;
export const timeIn = (iso, lang) => new Date(iso).toLocaleString(LOCALE[lang] || "en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Tell every manager about an emergency on all their channels: push (stays on screen), SMS and email.
 * `reminder` is the "still not acknowledged" version sent by the escalation check.
 */
export async function alertManagers(admin, q, ctx, origin, { reminder = false, skip = [] } = {}) {
  const resident = ctx.prof(q.resident_id);
  let delivered = 0;
  for (const id of ctx.managerIds) {
    if (skip.includes(id)) continue;
    const p = ctx.prof(id), L = p.lang === "es" ? "es" : "en", t = (s, v) => tr(L, s, v);
    const link = `${origin}/m/requests/${q.id}`;
    const title = reminder ? t("Emergency still not acknowledged: {title}", { title: q.title }) : t("Emergency: {title}", { title: q.title });
    const who = `${resident.full_name || t("Resident")}${resident.phone ? ` · ${resident.phone}` : ""}`;
    delivered += await sendPush(admin, id, { title, body: `${placeOf(ctx, q)} · ${who}. ${t("Open to acknowledge.")}`, url: `/m/requests/${q.id}`, tag: `emer-${q.id}`, urgent: true });
    if (p.notify_sms !== false && p.phone) {
      if (await sendSMS(p.phone, `CanItWait ${title.toUpperCase()} · ${placeOf(ctx, q)} · ${who}. ${link}`)) delivered++;
    }
    if (p.notify_email !== false) {
      const to = await emailOf(admin, id);
      const html = emailLayout({ alarm: true, heading: title, link, linkText: t("Open in CanItWait"),
        foot: t("You get these because email updates are on in CanItWait settings."),
        lines: [`${esc(who)} · ${esc(placeOf(ctx, q))}`, esc(q.body).replace(/\n/g, "<br>"),
          `<b>${esc(t("Reported {time}", { time: timeIn(q.created_at, L) }))}</b>`] });
      if (await sendEmail(to, `[${t("Emergency").toUpperCase()}] ${q.title} · ${placeOf(ctx, q)}`, html)) delivered++;
    }
  }
  return delivered;
}

/** Escalate an unacknowledged emergency: backup contact, reminder to managers, and a heads-up to the resident. */
export async function escalate(admin, q, ctx, origin) {
  const after = ctx.settings?.escalate_after_min || 10;
  const resident = ctx.prof(q.resident_id);
  const s = ctx.settings || {};
  let backup = 0;
  if (s.backup_phone || s.backup_email) {
    const msg = tr("en", "CanItWait: EMERGENCY not acknowledged after {n} min — {title} at {place}. Resident: {who}.", {
      n: after, title: q.title, place: placeOf(ctx, q), who: `${resident.full_name || "Resident"}${resident.phone ? ` ${resident.phone}` : ""}`,
    });
    if (s.backup_phone && await sendSMS(s.backup_phone, msg)) backup++;
    if (s.backup_email) {
      const html = emailLayout({ alarm: true, heading: `Emergency not acknowledged after ${after} minutes`, link: `${origin}/m/requests/${q.id}`, linkText: "Open in CanItWait",
        lines: [`<b>${esc(q.title)}</b> · ${esc(placeOf(ctx, q))}`, `Resident: ${esc(resident.full_name || "Resident")}${resident.phone ? ` · <a href="tel:${esc(resident.phone)}">${esc(resident.phone)}</a>` : ""}`,
          esc(q.body).replace(/\n/g, "<br>"), `You're the backup contact for ${esc(ctx.prop?.name || "this property")} in CanItWait. Nobody on the team has acknowledged this emergency yet.`] });
      if (await sendEmail(s.backup_email, `[EMERGENCY · NOT ACKNOWLEDGED] ${q.title} · ${placeOf(ctx, q)}`, html)) backup++;
    }
  }
  const reminders = await alertManagers(admin, q, ctx, origin, { reminder: true });
  // Let the resident know, so they call instead of waiting.
  const L = resident.lang === "es" ? "es" : "en";
  const line = ctx.prop?.after_hours_phone;
  await sendPush(admin, q.resident_id, {
    title: tr(L, "Your emergency hasn't been seen yet"),
    body: line ? tr(L, "If anyone is in danger, call 911. Otherwise call the after-hours line: {phone}.", { phone: line }) : tr(L, "If anyone is in danger, call 911. Otherwise call your property's after-hours line."),
    url: `/r/requests/${q.id}`, tag: `esc-${q.id}`, urgent: true,
  });
  await admin.from("request_events").insert({ request_id: q.id, actor_id: null, kind: "escalated", notified_at: new Date().toISOString(),
    detail: { after_min: after, backup: s.backup_name || (s.backup_phone || s.backup_email ? "backup" : null), backup_reached: backup > 0, reminders } });
  await admin.rpc("server_mark_request", { p_request: q.id, p_what: "escalated" });
  return { backup, reminders };
}

/** Copy of a new request for a team that also works in other software (AppFolio, Buildium…). */
export async function forwardCopy(admin, q, ctx, origin) {
  const to = ctx.settings?.forward_email;
  if (!to) return false;
  const resident = ctx.prof(q.resident_id);
  const lvl = q.mgr_urgency || q.urgency;
  const text = workOrderText(q, { property: ctx.prop?.name, resident: resident.full_name, phone: resident.phone, link: `${origin}/m/requests/${q.id}`, when: timeIn(q.created_at, "en") });
  const html = emailLayout({ alarm: lvl === "Emergency", heading: `Work order ${q.ref}: ${q.title}`, link: `${origin}/m/requests/${q.id}`, linkText: "Open in CanItWait",
    lines: [`<pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0">${esc(text)}</pre>`],
    foot: "Sent because this address is set to receive copies of new requests in CanItWait property settings." });
  return sendEmail(to, `[${lvl}] ${q.ref} ${q.title} · ${placeOf(ctx, q)}`, html, text);
}
