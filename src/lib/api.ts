import { supabase } from "./supabase";
import { blobToDataURL } from "./image";
import type { Triage } from "../../shared/triage.js";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface TriageInput {
  description: string; checklist: Record<string, string | undefined>; localTime: string; afterHours: boolean;
  locationInHome?: string; photo?: Blob | null;
}
export class ApiError extends Error { constructor(public code: string, msg?: string) { super(msg || code); } }

async function triageOnce(inp: TriageInput, signal: AbortSignal): Promise<Triage> {
  const body: Record<string, unknown> = {
    description: inp.description, checklist: inp.checklist, localTime: inp.localTime, afterHours: inp.afterHours, locationInHome: inp.locationInHome,
  };
  if (inp.photo) body.image = { mediaType: "image/jpeg", data: (await blobToDataURL(inp.photo)).split(",")[1] };
  const r = await fetch("/api/triage", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body), signal });
  if (r.status === 401) throw new ApiError("auth", "Sign in again to use the urgency check.");
  if (r.status === 429) throw new ApiError("busy", "The urgency check is busy. Try again in a minute.");
  if (!r.ok) throw new ApiError("unavailable", "The urgency check couldn't be reached.");
  return (await r.json()) as Triage;
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
      const leftApp = restarted || wasHidden || document.hidden;
      if (leftApp && hiddenRetries < 3) hiddenRetries++;
      else if ((code === "network" || code === "unavailable") && otherRetries < 1) otherRetries++;
      else throw e instanceof ApiError ? e : new ApiError("unavailable", "The urgency check couldn't be reached.");
      await waitVisible();
      opts.onResume?.();
    } finally {
      document.removeEventListener("visibilitychange", onVis);
      opts.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Ask the server to email the right people about an event. Never blocks or fails the UI. */
export function notify(eventId: string | null | undefined) {
  if (!eventId) return;
  void (async () => {
    try { await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ event_id: eventId }) }); }
    catch { /* email is best-effort */ }
  })();
}
