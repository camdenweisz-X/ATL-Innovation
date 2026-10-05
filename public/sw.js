// CanItWait service worker: phone/browser notifications only. It doesn't cache pages, so new versions load right away.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const path = typeof d.url === "string" && d.url.startsWith("/") && !d.url.startsWith("//") ? d.url : "/";
  e.waitUntil(self.registration.showNotification(d.title || "CanItWait", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!(d.tag && d.urgent),
    requireInteraction: !!d.urgent, // emergencies stay on screen until tapped
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: d.urgent ? [400, 150, 400, 150, 400] : [120],
    data: { url: path },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate?.(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
