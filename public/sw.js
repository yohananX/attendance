const CACHE_PREFIX = "gh-attendance-";
const CACHE_VERSION = "gh-attendance-shell-v1";
const SHELL_CACHE = CACHE_VERSION;
const SHELL_ASSETS = [
  "/",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.open(SHELL_CACHE).then((c) => c.match("/").then((m) => m || c.match("/offline")))),
    );
    return;
  }

  const isNextStatic = url.pathname.startsWith("/_next/static/");
  const isShellAsset = SHELL_ASSETS.includes(url.pathname);

  if (!isNextStatic && !isShellAsset) return;

  event.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (!res || !res.ok) return res;
          cache.put(req, res.clone());
          return res;
        });
      }),
    ),
  );
});
