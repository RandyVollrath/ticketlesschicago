// SnowSOS Service Worker for Push Notifications

self.addEventListener("install", (event) => {
  console.log("SnowSOS SW installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("SnowSOS SW activated");
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "New notification",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
    tag: data.tag || "snowsos-notification",
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || "/",
      jobId: data.jobId,
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "SnowSOS", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  // Handle action buttons
  if (event.action === "view") {
    event.waitUntil(clients.openWindow(url));
  } else if (event.action === "claim" && event.notification.data?.jobId) {
    event.waitUntil(
      clients.openWindow(`/plower/dashboard?claim=${event.notification.data.jobId}`)
    );
  } else {
    // Default click
    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        // Try to focus an existing window
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus().then(() => client.navigate(url));
          }
        }
        // No existing window, open a new one
        return clients.openWindow(url);
      })
    );
  }
});

// Background sync for offline job claims (future feature)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-claims") {
    console.log("Background sync triggered");
  }
});
