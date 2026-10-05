import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until the Supabase URL and public key are set (see SETUP.md). */
export const configured = !!(url && anon);

export const supabase: SupabaseClient = createClient(url || "https://example.supabase.co", anon || "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export const PHOTO_BUCKET = "request-photos";

/** Turn Supabase/Postgres errors into short, human messages. */
export function friendly(e: unknown): string {
  const msg = String((e as { message?: string })?.message || e || "Something went wrong");
  if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
  if (/Email not confirmed/i.test(msg)) return "Confirm your email first. Check your inbox for the link.";
  if (/User already registered/i.test(msg)) return "An account with that email already exists. Sign in instead.";
  if (/Password should be at least/i.test(msg)) return "Use a password with at least 8 characters.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "You're offline or the server can't be reached. Try again.";
  if (/row-level security|permission denied/i.test(msg)) return "You don't have access to do that.";
  return msg.replace(/^.*?ERROR:\s*/, "");
}
