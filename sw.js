// Service worker: lets the vault open offline and keeps the ~10 MB text
// recognition download from repeating.
//
// - The site's own files are network-first: online visits always get the
//   latest deploy (there is no build step or version hash), and the last copy
//   is used when offline.
// - Pinned jsDelivr files (Tesseract's WASM core and English model) never
//   change at a given version, so they are cache-first.
// - Supabase, CardPricer and anything else go straight to the network.
const SITE_CACHE = 'card-vault-site-v1';
const CDN_CACHE = 'card-vault-cdn-v1';
const CACHES = [SITE_CACHE, CDN_CACHE];
// Every GitHub Pages site under gzander7.github.io shares this origin and its
// caches. Only ever remove this app's own outdated caches.
const OWN_CACHE = /^card-vault-/;
const PINNED_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+\//;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SITE_CACHE)
      .then(cache => cache.addAll(['./', 'index.html', 'styles.css', 'app.js', 'favicon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => OWN_CACHE.test(key) && !CACHES.includes(key)).map(key => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SITE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// The page lists the site files it loaded before this worker took over.
self.addEventListener('message', event => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter(url => {
    try {
      return new URL(url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches
      .open(SITE_CACHE)
      .then(cache =>
        Promise.all(
          urls.map(url =>
            cache.match(url).then(hit => hit || fetch(url).then(response => response.ok && cache.put(url, response))),
          ),
        ).catch(() => {}),
      ),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (PINNED_CDN.test(request.url)) event.respondWith(cacheFirst(request));
});
