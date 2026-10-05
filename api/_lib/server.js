// Helpers for the serverless functions. Files in api/_lib are not routes.
import { createClient } from "@supabase/supabase-js";

// Values pasted into Vercel sometimes carry a trailing newline or slash, which breaks every auth check.
const env = (k) => String(process.env[k] || "").trim();
export const SUPABASE_URL = (env("SUPABASE_URL") || env("VITE_SUPABASE_URL")).replace(/\/+$/, "");
const ANON_KEY = env("SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

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

/**
 * Checks the caller's Supabase session. Returns { user } when signed in, otherwise { error, status }:
 *   401 "auth"   — no token, or Supabase says the token is invalid or expired
 *   503 "config" — the server is missing the Supabase URL or public key (a setup problem, not the user's)
 *   502 "upstream" — Supabase couldn't be reached
 */
export async function authUser(req) {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("auth check: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set for the server functions");
    return { error: "config", status: 503 };
  }
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return { error: "auth", status: 401 };
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    if (r.status === 401 || r.status === 403) {
      let why = ""; try { why = await r.text(); } catch { /* no body */ }
      console.warn(`auth check: Supabase rejected the session (${r.status}): ${why.slice(0, 200)}`);
      return { error: "auth", status: 401 };
    }
    if (!r.ok) { console.error(`auth check: Supabase returned ${r.status}`); return { error: "upstream", status: 502 }; }
    const u = await r.json();
    return u?.id ? { user: u } : { error: "auth", status: 401 };
  } catch (e) {
    console.error("auth check: couldn't reach Supabase", e?.message || e);
    return { error: "upstream", status: 502 };
  }
}

/** Returns the signed-in Supabase user for this request, or null. */
export async function getUser(req) { return (await authUser(req)).user || null; }

/** Sends the right error for a failed auth check. */
export function sendAuthError(res, a) {
  const msg = a.error === "config" ? "The server isn't connected to Supabase. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel."
    : a.error === "upstream" ? "Couldn't check your sign-in. Try again." : "Sign in again";
  return send(res, a.status, { error: msg, code: a.error });
}

let admin = null;
/** Service-role client. Bypasses RLS, so every use must check permissions itself. */
export function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!admin) admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Which optional server features are set up (names only, never values). */
export function configStatus() {
  return {
    supabase: !!(SUPABASE_URL && ANON_KEY), serviceRole: !!SERVICE_KEY, ai: !!env("GEMINI_API_KEY"),
    email: !!env("RESEND_API_KEY"), push: !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")),
    sms: !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM")), escalation: !!env("CRON_SECRET"),
    appUrl: !!env("APP_URL"),
  };
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
  const fromEnv = env("APP_URL") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (fromEnv || `https://${req?.headers?.host || "canitwait.net"}`).replace(/\/$/, "");
}
