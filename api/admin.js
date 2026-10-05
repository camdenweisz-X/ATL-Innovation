// GET /api/admin — owner-only dashboard data: who signed up and what kind of activity happened, without content.
// Only signed-in people whose confirmed email is listed in ADMIN_EMAILS (comma-separated, set in Vercel) get data.
// Everyone else gets 404, so the endpoint doesn't reveal that an admin view exists.
import { send, authUser, sendAuthError, adminClient } from "./_lib/server.js";
import { buildAdminReport, isAdmin, parseAdminEmails } from "../shared/admin.js";

const LIMIT = 2000;

async function allUsers(admin) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const list = data?.users || [];
    out.push(...list);
    if (list.length < 200) break;
  }
  return out;
}

async function rows(admin, table, cols, order = "created_at") {
  const { data, error } = await admin.from(table).select(cols).order(order, { ascending: false }).limit(LIMIT);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  const a = await authUser(req);
  if (!a.user) return sendAuthError(res, a);
  if (!isAdmin(a.user, parseAdminEmails(process.env.ADMIN_EMAILS))) return send(res, 404, { error: "Not found" });
  if (/[?&]probe=1(&|$)/.test(req.url || "")) return send(res, 200, { admin: true }); // lets Settings show the link
  const admin = adminClient();
  if (!admin) return send(res, 503, { error: "The admin view needs SUPABASE_SERVICE_ROLE_KEY on the server." });

  try {
    // Only metadata columns: no names, addresses, descriptions, message text, photos or contact details.
    const [users, profiles, properties, memberships, places, requests, events, usage] = await Promise.all([
      allUsers(admin),
      rows(admin, "profiles", "id, onboarded, lang, created_at"),
      rows(admin, "properties", "id, created_by, created_at"),
      rows(admin, "memberships", "user_id, property_id, role, created_at"),
      rows(admin, "external_places", "user_id, created_at"),
      rows(admin, "requests", "id, resident_id, created_at, urgency, ai_urgency, category, has_photo, after_hours, manual_review"),
      rows(admin, "request_events", "request_id, actor_id, kind, status, created_at"),
      rows(admin, "api_usage", "user_id, kind, created_at"),
    ]);
    const slim = users.map((u) => ({
      id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
      app_metadata: { provider: u.app_metadata?.provider, providers: u.app_metadata?.providers },
    }));
    return send(res, 200, buildAdminReport({ users: slim, profiles, properties, memberships, places, requests, events, usage }));
  } catch (e) {
    console.error("admin report", e?.message || e);
    return send(res, 500, { error: "Couldn't load the dashboard. Try again." });
  }
}
