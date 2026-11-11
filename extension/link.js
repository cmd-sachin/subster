// Runs only on the user's own Subster site (localhost, or the address they connected). It lets the
// site set this extension up by itself: the site hands over the device key for the signed-in
// account, and this script tells the site whether the extension is installed and linked.
//
// The key is only accepted from the page this script is running in, and the background worker
// checks it against that same server before keeping it.
(() => {
  const APP = 'subster-app';
  const EXTENSION = 'subster-extension';

  async function announce() {
    try {
      const { deviceKey = '', serverUrl = '' } = await chrome.storage.local.get(['deviceKey', 'serverUrl']);
      window.postMessage({ source: EXTENSION, type: 'ready', version: chrome.runtime.getManifest().version, linked: Boolean(deviceKey) && serverUrl === location.origin, keyHint: deviceKey.slice(-6) }, location.origin);
    } catch {
      // The extension was reloaded while this page stayed open. A page refresh reconnects.
    }
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== APP) return;
    if (message.type === 'hello') return announce();
    if (message.type === 'link' && typeof message.deviceKey === 'string' && /^sk_[\w-]{20,80}$/.test(message.deviceKey)) {
      try {
        const result = await chrome.runtime.sendMessage({ type: 'link', serverUrl: location.origin, deviceKey: message.deviceKey });
        window.postMessage({ source: EXTENSION, type: 'linked', ok: Boolean(result?.ok) }, location.origin);
      } catch {
        window.postMessage({ source: EXTENSION, type: 'linked', ok: false }, location.origin);
      }
      await announce();
    }
  });

  void announce();
})();
