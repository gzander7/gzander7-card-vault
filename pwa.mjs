// Registers the service worker that makes the vault installable and usable offline.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' }).catch(() => {});
  });
}
