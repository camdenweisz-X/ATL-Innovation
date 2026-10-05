import { supabase } from "./supabase";
import { blobToDataURL } from "./image";
import type { Triage } from "../../shared/triage.js";
import type { Lang } from "./i18n";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * POST to one of our /api functions with the signed-in person's token. If the server says the session is
 * invalid, refresh it once and retry: phones that wake from sleep often still hold an expired token.
 */
async function postApi(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const go = async () => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body), signal });
  const r = await go();
  if (r.status !== 401) return r;
  const { error } = await supabase.auth.refreshSession();
  if (error) {
    // The session was ended elsewhere (for example, signed out on another device), so the saved token can
    // never work again. Clear it on this device only, which sends the person back to the sign-in screen.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return r;
  }
  return go();
}

export interface TriageInput {
  description: string; checklist: Record<string, string | undefined>; localTime: string; afterHours: boolean;
  locationInHome?: string; photo?: Blob | null; lang: Lang;
}
export class ApiError extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

async function triageOnce(inp: TriageInput, signal: AbortSignal): Promise<Triage> {
  const body: Record<string, unknown> = {
    description: inp.description, checklist: inp.checklist, localTime: inp.localTime, afterHours: inp.afterHours, locationInHome: inp.locationInHome, lang: inp.lang,
  };
  if (inp.photo) body.image = { mediaType: "image/jpeg", data: (await blobToDataURL(inp.photo)).split(",")[1] };
  const r = await postApi("/api/triage", body, signal);
  if (r.ok) return (await r.json()) as Triage;
  const j = await r.json().catch(() => ({} as { code?: string }));
  if (r.status === 401) throw new ApiError("auth");
  if (r.status === 503) throw new ApiError("config", j.code || "config");
  if (r.status === 429) throw new ApiError("busy");
  throw new ApiError("unavailable");
}

function waitVisible(): Promise<void> {
  return new Promise((res) => {
    if (!document.hidden) return res();
    const f = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", f); res(); } };
    document.addEventListener("visibilitychange", f);
  });
}

/**
 * Runs the AI check and survives the resident switching apps: phones pause background tabs and cut
 * requests, so a request that fails (or hangs) while hidden is retried when the page is visible again.
 */
export async function runTriage(inp: TriageInput, opts: { signal: AbortSignal; onResume?: () => void }): Promise<Triage> {
  let hiddenRetries = 0, otherRetries = 0;
  for (;;) {
    if (opts.signal.aborted) throw new ApiError("cancelled");
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    opts.signal.addEventListener("abort", onAbort);
    let wasHidden = document.hidden, restarted = false;
    const onVis = () => {
      if (document.hidden) { wasHidden = true; return; }
      if (wasHidden) setTimeout(() => { if (!ctl.signal.aborted) { restarted = true; ctl.abort(); } }, 3000);
    };
    document.addEventListener("visibilitychange", onVis);
    try {
      return await triageOnce(inp, ctl.signal);
    } catch (e) {
      if (opts.signal.aborted) throw new ApiError("cancelled");
      const code = e instanceof ApiError ? e.code : "network";
      if (code === "auth" || code === "config") throw e; // retrying won't help
      const leftApp = restarted || wasHidden || document.hidden;
      if (leftApp && hiddenRetries < 3) hiddenRetries++;
      else if ((code === "network" || code === "unavailable") && otherRetries < 1) otherRetries++;
      else throw e instanceof ApiError ? e : new ApiError("unavailable");
      await waitVisible();
      opts.onResume?.();
    } finally {
      document.removeEventListener("visibilitychange", onVis);
      opts.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Ask the server to notify the right people about an event (email, phone push, SMS). Never blocks or fails the UI. */
export function notify(eventId: string | null | undefined) {
  if (!eventId) return;
  void (async () => {
    try { await postApi("/api/notify", { event_id: eventId }); } catch { /* best-effort */ }
  })();
}

/** Translate a few texts into `target`. Returns them in the same order. */
export async function translateTexts(texts: string[], target: Lang): Promise<string[]> {
  const r = await postApi("/api/translate", { texts, target });
  if (!r.ok) throw new ApiError(r.status === 429 ? "busy" : "unavailable");
  const j = (await r.json()) as { texts: string[] };
  return j.texts;
}
