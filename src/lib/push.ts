import { supabase } from "./supabase";

export type PushState = "unsupported" | "needs-install" | "unconfigured" | "denied" | "on" | "off";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Registers the notification service worker. Safe to call on every load. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* notifications just won't be offered */ }); });
}

let keyPromise: Promise<string> | null = null;
function serverKey(): Promise<string> {
  keyPromise ||= fetch("/api/push-key").then((r) => (r.ok ? r.json() : { key: "" })).then((j: { key?: string }) => j.key || "").catch(() => "");
  return keyPromise;
}

function b64ToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => undefined);
  return (await reg?.pushManager.getSubscription()) || null;
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !standalone()) return "needs-install";
  if (!supported()) return "unsupported";
  if (!(await serverKey())) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  return (await currentSub()) && Notification.permission === "granted" ? "on" : "off";
}

/** Asks for permission, subscribes this device and saves it to the signed-in account. */
export async function enablePush(): Promise<PushState> {
  const key = await serverKey();
  if (!key) return "unconfigured";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = (await navigator.serviceWorker.getRegistration("/sw.js")) || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) as BufferSource });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw error;
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSub();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}
