// VERSION names the cache. The release build replaces the next line with the tag, so every release reaches installed phones.
const VERSION = "nitrox-fill-dev";
const PREFIX = "nitrox-fill-"; // only caches with this prefix belong to this app (the github.io origin is shared with other Pages sites)
const FILES = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-500-normal.woff2", "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2"
];
// Relative paths resolve against this file's URL, so under /nitrox-fill/ these are /nitrox-fill/... .
const SHELL = new URL("index.html", self.location).href;
const SCOPE_PATH = new URL("./", self.location).pathname;
const NET_TIMEOUT_MS = 4000; // weak signal at the fill station: fall back to the cached page instead of hanging

self.addEventListener("install", e => {
  // cache: "reload" skips the HTTP cache (GitHub Pages sends max-age=600), so a new release never precaches the old files.
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const fromCache = req => caches.open(VERSION).then(c => c.match(req));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Pages: network first, revalidated past the HTTP cache so a new release shows up at once.
    // Offline, slow or failing: the cached app page, whatever the path or query (e.g. a start_url with ?source=).
    const network = fetch(req, { cache: "no-cache" });
    const isShell = url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + "index.html";
    e.waitUntil(network.then(r => {
      if (!r.ok || !isShell) return; // never store a 404 or a redirect as the app page
      const copy = r.clone();
      return caches.open(VERSION).then(c => c.put(SHELL, copy));
    }).catch(() => {}));
    e.respondWith((async () => {
      try {
        return await Promise.race([network, new Promise((_, reject) => setTimeout(reject, NET_TIMEOUT_MS))]);
      } catch {
        return (await fromCache(SHELL)) || network; // nothing cached yet: keep waiting for the network
      }
    })());
    return;
  }

  // Everything else (fonts, icons, manifest): cache first, network for anything not precached.
  e.respondWith(fromCache(req).then(hit => hit || fetch(req)));
});
