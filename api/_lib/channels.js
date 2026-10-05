// Delivery channels for notifications. Each one is optional and does nothing until its keys are set:
//   email  RESEND_API_KEY (+ RESEND_FROM)
//   push   VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ VAPID_SUBJECT)   — free phone/browser notifications
//   SMS    TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM      — emergencies only
import webpush from "web-push";

const env = (k) => String(process.env[k] || "").trim();
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const hasEmail = () => !!env("RESEND_API_KEY");
export const hasPush = () => !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
export const hasSMS = () => !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"));

/* ---------------- email ---------------- */
export function emailLayout({ heading, lines, link, linkText, foot, alarm }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2430">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${alarm ? "#b42318" : "#dde2e8"};border-radius:12px">
  <tr><td style="padding:24px">
    <div style="font-weight:700;font-size:15px;color:${alarm ? "#b42318" : "#1f5a96"};margin-bottom:16px">CanItWait</div>
    <div style="font-size:19px;font-weight:700;margin-bottom:12px">${esc(heading)}</div>
    ${lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${l}</p>`).join("")}
    ${link ? `<a href="${esc(link)}" style="display:inline-block;margin-top:12px;background:${alarm ? "#b42318" : "#1f5a96"};color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${esc(linkText)}</a>` : ""}
  </td></tr></table>
  ${foot ? `<div style="font-size:12px;color:#6b7684;margin-top:12px">${esc(foot)}</div>` : ""}
  </td></tr></table></body></html>`;
}

export async function sendEmail(to, subject, html, text) {
  if (!hasEmail() || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("RESEND_FROM") || "CanItWait <onboarding@resend.dev>", to: [to], subject, html, ...(text ? { text } : {}) }),
    });
    if (!r.ok) console.error("Resend error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return r.ok;
  } catch (e) { console.error("Resend", e?.message || e); return false; }
}

/* ---------------- push ---------------- */
let vapidSet = false;
function setupPush() {
  if (vapidSet) return true;
  if (!hasPush()) return false;
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:support@canitwait.net", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  vapidSet = true;
  return true;
}

/**
 * Push to every device of `userId`. `msg`: { title, body, url, tag, urgent }.
 * Devices that unsubscribed (404/410) are removed. Returns how many devices accepted it.
 */
export async function sendPush(admin, userId, msg) {
  if (!setupPush()) return 0;
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let ok = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg),
        { TTL: msg.urgent ? 3600 : 86400, urgency: msg.urgent ? "high" : "normal", topic: msg.tag ? String(msg.tag).replace(/[^\w-]/g, "").slice(0, 32) : undefined });
      ok++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push", e?.statusCode, String(e?.body || e?.message || "").slice(0, 200));
    }
  }
  return ok;
}

/* ---------------- SMS ---------------- */
/** US numbers to E.164: "(404) 555-0100" → "+14045550100". Returns null when it can't tell. */
export function toE164(phone) {
  const raw = String(phone || "").trim();
  const d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && d.length >= 10 && d.length <= 15) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}

export async function sendSMS(phone, body) {
  const to = toE164(phone);
  if (!hasSMS() || !to) return false;
  const sid = env("TWILIO_ACCOUNT_SID");
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: env("TWILIO_FROM"), Body: body.slice(0, 600) }).toString(),
    });
    if (!r.ok) console.error("Twilio error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return r.ok;
  } catch (e) { console.error("Twilio", e?.message || e); return false; }
}
