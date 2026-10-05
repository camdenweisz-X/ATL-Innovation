// POST /api/notify — tells people about a request event. Signed-in users only.
// Body: { event_id }  (a row in request_events: 'created', 'status' or 'message')
// The caller must be the person who created that event, and each event is delivered at most once.
// Channels (each optional, see api/_lib/channels.js): email, phone push, and SMS for emergencies.
// Everyone gets messages in their own language (profiles.lang).
import { STATUS_LABEL } from "../shared/triage.js";
import { tr } from "../shared/i18n.js";
import { send, readJSON, authUser, sendAuthError, adminClient, rateLimited, appUrl } from "./_lib/server.js";
import { esc, emailLayout, sendEmail, sendPush } from "./_lib/channels.js";
import { loadContext, alertManagers, forwardCopy, emailOf, placeOf, timeIn } from "./_lib/alerts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const a = await authUser(req);
  if (!a.user) return sendAuthError(res, a);
  const user = a.user;
  const admin = adminClient();
  if (!admin) return send(res, 200, { skipped: true });
  if (await rateLimited(user.id, "notify", 30, 10 * 60 * 1000)) return send(res, 429, { error: "Too many notifications" });

  const body = await readJSON(req);
  const eventId = String(body?.event_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return send(res, 400, { error: "Missing event" });

  const { data: ev } = await admin.from("request_events").select("*").eq("id", eventId).maybeSingle();
  if (!ev) return send(res, 404, { error: "Event not found" });
  if (ev.actor_id !== user.id) return send(res, 403, { error: "Not your event" });
  if (ev.notified_at) return send(res, 200, { already: true });
  if (Date.now() - new Date(ev.created_at).getTime() > 10 * 60 * 1000) return send(res, 200, { skipped: "too old" });

  // Claim the event first so two calls can't both send.
  const { data: claimed } = await admin.from("request_events").update({ notified_at: new Date().toISOString() })
    .eq("id", eventId).is("notified_at", null).select("id");
  if (!claimed?.length) return send(res, 200, { already: true });

  const { data: q } = await admin.from("requests").select("*").eq("id", ev.request_id).maybeSingle();
  if (!q || !q.property_id) return send(res, 200, { skipped: "no property" }); // outside landlords are contacted by the resident's own app
  const ctx = await loadContext(admin, q);
  const origin = appUrl(req);
  const actorIsResident = ev.actor_id === q.resident_id;
  let delivered = 0;

  // A new emergency: every manager on every channel, right away.
  if (ev.kind === "created" && (q.mgr_urgency || q.urgency) === "Emergency") {
    delivered += await alertManagers(admin, q, ctx, origin, { skip: [user.id] });
    await admin.rpc("server_mark_request", { p_request: q.id, p_what: "alerted" });
  }
  if (ev.kind === "created" && await forwardCopy(admin, q, ctx, origin)) delivered++;

  // Everything else: managers hear when the resident acts, the resident hears when a manager acts.
  const recipients = actorIsResident ? ctx.managerIds.filter((id) => id !== user.id) : [q.resident_id];
  const emergencyCreated = ev.kind === "created" && (q.mgr_urgency || q.urgency) === "Emergency";
  for (const rid of emergencyCreated ? [] : recipients) {
    const p = ctx.prof(rid), L = p.lang === "es" ? "es" : "en", t = (s, v) => tr(L, s, v);
    const actor = ctx.prof(ev.actor_id);
    const actorName = actor.full_name || t("Someone");
    const isMgr = rid !== q.resident_id;
    const path = `/${isMgr ? "m" : "r"}/requests/${q.id}`;
    const where = esc(placeOf(ctx, q) || t("Your property"));
    const lvl = t(q.mgr_urgency || q.urgency);
    let subject, heading, lines, pushBody;
    if (ev.kind === "created") {
      subject = `[${lvl}] ${q.title} · ${placeOf(ctx, q)}`;
      heading = t("New request ({level}): {title}", { level: lvl.toLowerCase(), title: q.title });
      lines = [`${esc(ctx.prof(q.resident_id).full_name || t("Resident"))} · ${where}`, esc(q.body).replace(/\n/g, "<br>")];
      if (q.ai_reason) lines.push(`<span style="color:#6b7684">${esc(t("AI check"))}: ${esc(q.ai_reason)}</span>`);
      if (q.lang !== L) lines.push(`<span style="color:#6b7684">${esc(t("Written in {language}. Open it in CanItWait to translate.", { language: t(q.lang === "es" ? "Spanish" : "English") }))}</span>`);
      pushBody = `${placeOf(ctx, q)} · ${ctx.prof(q.resident_id).full_name || ""}`;
    } else if (ev.kind === "status") {
      const label = t(STATUS_LABEL[ev.status] || ev.status);
      subject = `${label}: ${q.title}`;
      heading = isMgr
        ? (ev.status === "canceled" ? t("{name} canceled their request", { name: actorName }) : t("{name} marked their request {status}", { name: actorName, status: label.toLowerCase() }))
        : t("Your request is now: {status}", { status: label });
      lines = [`${esc(q.title)} · ${where}`];
      if (ev.status === "scheduled" && ev.detail?.scheduled_for) {
        lines.push(`<b>${esc(t("Visit: {time}", { time: timeIn(ev.detail.scheduled_for, L) }))}</b>${ev.detail.tech ? ` · ${esc(ev.detail.tech)}` : ""}`);
      }
      if (ev.body) lines.push(`${esc(t("Note from {name}", { name: actorName }))}: ${esc(ev.body)}`);
      pushBody = ev.status === "scheduled" && ev.detail?.scheduled_for ? t("Visit: {time}", { time: timeIn(ev.detail.scheduled_for, L) }) : q.title;
    } else {
      subject = t("New message: {title}", { title: q.title });
      heading = t("{name} sent a message", { name: actorName });
      lines = [`${esc(q.title)} · ${where}`, `“${esc(ev.body)}”`];
      pushBody = String(ev.body || "").slice(0, 140);
    }
    delivered += await sendPush(admin, rid, { title: heading, body: pushBody, url: path, tag: `req-${q.id}` });
    if (p.notify_email !== false) {
      const to = await emailOf(admin, rid);
      const html = emailLayout({ heading, lines, link: origin + path, linkText: t("Open in CanItWait"), foot: t("You get these because email updates are on in CanItWait settings.") });
      if (to && await sendEmail(to, subject, html)) delivered++;
    }
  }
  // If nothing was delivered (for example email was down), release the claim so a later call can retry.
  if (delivered === 0 && !emergencyCreated) await admin.from("request_events").update({ notified_at: null }).eq("id", eventId);
  return send(res, 200, { sent: delivered });
}
