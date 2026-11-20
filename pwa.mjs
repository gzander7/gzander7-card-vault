// Registers the service worker that makes the vault installable and usable offline.
//
// The worker starts after the first page load, so the files that page already
// fetched never passed through it. Once it is ready, send it the site's own
// files from this load so the very next launch can open offline.
function warmCache(worker) {
  const urls = [
    location.href.split('#')[0],
    ...performance.getEntriesByType('resource').map(entry => entry.name),
  ].filter(url => new URL(url).origin === location.origin);
  worker?.postMessage({ type: 'cache-urls', urls: [...new Set(urls)] });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('./sw.js', import.meta.url), { scope: './' })
      .then(() => navigator.serviceWorker.ready)
      .then(registration => warmCache(registration.active))
      .catch(() => {});
  });
}
