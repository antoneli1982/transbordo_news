// Update this version when changing the offline shell.
const CACHE = "transbordo-shell-20261127-sync-recovery";
const HOME = new URL("index.html", self.registration.scope).href;
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(HOME, {cache: "reload"}));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("transbordo-shell-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const root = new URL(self.registration.scope);
  if (req.destination === "image" && url.protocol === "https:") {
    event.respondWith((async () => {
      const cache = await caches.open("transbordo-images-v1");
      try {
        const response = await fetch(req);
        if (response.ok || response.type === "opaque") {
          try {
            if (!/no-store/i.test(response.headers.get("cache-control") || "")) {
              await cache.put(req, response.clone());
              const keys = await cache.keys();
              if (keys.length > 100) await cache.delete(keys[0]);
            }
          } catch (_) { /* Quota reached. The image still opens online. */ }
          return response;
        }
        return await cache.match(req) || response;
      } catch (err) {
        const saved = await cache.match(req);
        if (saved) return saved;
        throw err;
      }
    })());
    return;
  }
  if (req.mode === "navigate" && url.origin === root.origin &&
      (url.pathname === root.pathname || url.pathname === new URL(HOME).pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(req);
        if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
          await cache.put(HOME, response.clone());
          return response;
        }
        return await cache.match(HOME) || response;
      } catch (err) {
        const saved = await cache.match(HOME);
        if (saved) return saved;
        throw err;
      }
    })());
  }
});
