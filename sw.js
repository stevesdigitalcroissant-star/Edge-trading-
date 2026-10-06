// Edge service worker: shows push notifications and opens the right screen when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Edge", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Edge", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: !!d.sticky, // "act now" and A+ setups stay until you tap them
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.focus(); if ("navigate" in c) c.navigate(url).catch(() => {}); return; } }
    await self.clients.openWindow(url);
  })());
});
