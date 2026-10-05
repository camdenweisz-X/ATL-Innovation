// Helpers for the serverless functions. Files in api/_lib are not routes.
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export async function readJSON(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return null; } }
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 8e6) return null; }
  try { return JSON.parse(raw || "{}"); } catch { return null; }
}

/** Returns the signed-in Supabase user for this request, or null. */
export async function getUser(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch { return null; }
}

let admin = null;
/** Service-role client. Bypasses RLS, so every use must check permissions itself. */
export function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!admin) admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/**
 * Rate limit: at most `max` calls of `kind` per user in `windowMs`.
 * Counts live in the database (api_usage) so they hold across serverless instances;
 * without the service-role key it falls back to a per-instance memory count.
 */
const buckets = new Map();
export async function rateLimited(userId, kind, max, windowMs) {
  const admin = adminClient();
  if (admin) {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await admin.from("api_usage").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", kind).gte("created_at", since);
    if (!error) {
      if ((count || 0) >= max) return true;
      await admin.from("api_usage").insert({ user_id: userId, kind });
      // Opportunistic cleanup of old rows.
      if (Math.random() < 0.02) await admin.from("api_usage").delete().lt("created_at", new Date(Date.now() - 86400e3).toISOString());
      return false;
    }
  }
  const key = kind + ":" + userId, now = Date.now();
  const b = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (b.length >= max) { buckets.set(key, b); return true; }
  b.push(now); buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return false;
}

/** Public URL of the app for links in emails. Set APP_URL in production. */
export function appUrl(req) {
  const fromEnv = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (fromEnv || `https://${req.headers.host}`).replace(/\/$/, "");
}
