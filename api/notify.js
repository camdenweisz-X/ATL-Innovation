// POST /api/notify — emails people about a request event. Signed-in users only.
// Body: { event_id }  (a row in request_events: 'created', 'status' or 'message')
// The caller must be the person who created that event, and each event is emailed at most once.
// Without RESEND_API_KEY this does nothing and returns { skipped: true }, so the app works without email.
import { STATUS_LABEL } from "../shared/triage.js";
import { send, readJSON, getUser, adminClient, rateLimited, appUrl } from "./_lib/server.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function emailOf(admin, userId) {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

function layout({ heading, lines, link, linkText }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2430">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #dde2e8;border-radius:12px">
  <tr><td style="padding:24px">
    <div style="font-weight:700;font-size:15px;color:#1f5a96;margin-bottom:16px">FixCheck</div>
    <div style="font-size:19px;font-weight:700;margin-bottom:12px">${esc(heading)}</div>
    ${lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${l}</p>`).join("")}
    <a href="${esc(link)}" style="display:inline-block;margin-top:12px;background:#1f5a96;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${esc(linkText)}</a>
  </td></tr></table>
  <div style="font-size:12px;color:#6b7684;margin-top:12px">You get these because email updates are on in FixCheck settings.</div>
  </td></tr></table></body></html>`;
}

async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM || "FixCheck <onboarding@resend.dev>", to: [to], subject, html }),
  });
  if (!r.ok) console.error("Resend error", r.status, (await r.text().catch(() => "")).slice(0, 300));
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const user = await getUser(req);
  if (!user) return send(res, 401, { error: "Sign in first" });
  const admin = adminClient();
  if (!admin || !process.env.RESEND_API_KEY) return send(res, 200, { skipped: true });
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
  if (!q || !q.property_id) return send(res, 200, { skipped: "no property" }); // external places are emailed by the resident's own app
  const { data: prop } = await admin.from("properties").select("name").eq("id", q.property_id).maybeSingle();
  const origin = appUrl(req);

  // Who should hear about it: managers when the resident acts, the resident when a manager acts.
  const actorIsResident = ev.actor_id === q.resident_id;
  let recipients = [];
  if (actorIsResident) {
    const { data: mgrs } = await admin.from("memberships").select("user_id").eq("property_id", q.property_id).eq("role", "manager");
    recipients = (mgrs || []).map((m) => m.user_id).filter((id) => id !== user.id);
  } else {
    recipients = [q.resident_id];
  }
  if (!recipients.length) return send(res, 200, { sent: 0 });
  const { data: profs } = await admin.from("profiles").select("id, full_name, notify_email").in("id", recipients.concat(ev.actor_id));
  const nameOf = (id) => profs?.find((p) => p.id === id)?.full_name || "Someone";
  const wants = (id) => profs?.find((p) => p.id === id)?.notify_email !== false;

  const where = `${esc(prop?.name || "Your property")}${q.unit ? `, ${esc(q.unit)}` : ""}`;
  let sent = 0;
  for (const rid of recipients) {
    if (!wants(rid)) continue;
    const to = await emailOf(admin, rid);
    if (!to) continue;
    const isMgr = rid !== q.resident_id;
    const link = `${origin}/${isMgr ? "m" : "r"}/requests/${q.id}`;
    let subject, heading, lines;
    if (ev.kind === "created") {
      subject = `[${q.urgency}] ${q.title} · ${prop?.name || ""}${q.unit ? ` ${q.unit}` : ""}`;
      heading = `New ${q.urgency.toLowerCase()} request: ${q.title}`;
      lines = [`${esc(nameOf(q.resident_id))} · ${where}`, esc(q.body).replace(/\n/g, "<br>")];
      if (q.ai_reason) lines.push(`<span style="color:#6b7684">AI check: ${esc(q.ai_reason)}</span>`);
    } else if (ev.kind === "status") {
      const label = STATUS_LABEL[ev.status] || ev.status;
      subject = `${label}: ${q.title}`;
      heading = isMgr
        ? (ev.status === "canceled" ? `${nameOf(ev.actor_id)} canceled their request` : `${nameOf(ev.actor_id)} marked their request ${label.toLowerCase()}`)
        : `Your request is now: ${label}`;
      lines = [`${esc(q.title)} · ${where}`];
      if (ev.body) lines.push(`Note from ${esc(nameOf(ev.actor_id))}: ${esc(ev.body)}`);
    } else {
      subject = `New message: ${q.title}`;
      heading = `${nameOf(ev.actor_id)} sent a message`;
      lines = [`${esc(q.title)} · ${where}`, `“${esc(ev.body)}”`];
    }
    if (await sendEmail(to, subject, layout({ heading, lines, link, linkText: "Open in FixCheck" }))) sent++;
  }
  // If every email failed (e.g., Resend was down), release the claim so a later call can retry.
  if (sent === 0) await admin.from("request_events").update({ notified_at: null }).eq("id", eventId);
  return send(res, 200, { sent });
}
