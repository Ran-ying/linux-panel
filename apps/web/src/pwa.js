// A PWA registration must never block panel auth or startup.
export function registerPanelServiceWorker(navigatorObject = globalThis.navigator) {
  if (!navigatorObject?.serviceWorker) return;
  const secure = globalThis.isSecureContext ||
    ['localhost','127.0.0.1','[::1]'].includes(globalThis.location?.hostname);
  if (!secure) return;
  // The scope intentionally covers only this origin. SW itself never
  // intercepts authenticated API/OAuth/MCP traffic.
  navigatorObject.serviceWorker.register('/sw.js', {scope:'/'})
    .catch(() => { /* Unsupported / restricted browser: normal Web stays usable. */ });
}
