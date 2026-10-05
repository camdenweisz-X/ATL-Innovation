// GET or POST /api/escalate — run every minute by Supabase pg_cron (see supabase/cron.sql).
// Requires "Authorization: Bearer <CRON_SECRET>".
//  1. An emergency whose first alert never went out (the resident's phone lost signal right after sending)
//     gets that alert now.
//  2. An emergency nobody acknowledged within the property's delay (default 10 minutes) is escalated:
//     the backup contact gets a text and email, managers get a reminder, and the resident is told to call.
import { send, adminClient, appUrl } from "./_lib/server.js";
import { loadContext, alertManagers, escalate } from "./_lib/alerts.js";

export default async function handler(req, res) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const h = String(req.headers?.authorization || "");
  if (!secret || h !== `Bearer ${secret}`) return send(res, 401, { error: "Not allowed" });
  const admin = adminClient();
  if (!admin) return send(res, 503, { error: "SUPABASE_SERVICE_ROLE_KEY is not set" });

  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: rows, error } = await admin.from("requests").select("*")
    .eq("status", "new").is("escalated_at", null).not("property_id", "is", null).gte("created_at", since)
    .or("mgr_urgency.eq.Emergency,and(urgency.eq.Emergency,mgr_urgency.is.null)")
    .order("created_at").limit(50);
  if (error) { console.error("escalate", error.message); return send(res, 500, { error: "Query failed" }); }

  const origin = appUrl(req);
  const out = { checked: rows?.length || 0, alerted: 0, escalated: 0 };
  for (const q of rows || []) {
    const ageMin = (Date.now() - Date.parse(q.created_at)) / 6e4;
    const ctx = await loadContext(admin, q);
    const delay = ctx.settings?.escalate_after_min || 10;
    try {
      if (!q.alerted_at && ageMin >= 1) {
        await alertManagers(admin, q, ctx, origin);
        await admin.rpc("server_mark_request", { p_request: q.id, p_what: "alerted" });
        out.alerted++;
      }
      if (ageMin >= delay) { await escalate(admin, q, ctx, origin); out.escalated++; }
    } catch (e) {
      console.error("escalate request", q.id, e?.message || e);
    }
  }
  return send(res, 200, out);
}
