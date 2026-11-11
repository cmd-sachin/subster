// Sets the browser extension up from the website. When a signed-in person opens Subster, the page
// asks whether the extension is here; if it is and is not yet linked to this account, the page
// hands it the device key. Nothing is typed or pasted. The same exchange tells the rest of the
// app whether this browser has the extension, so pages can say so.

import { useEffect, useSyncExternalStore } from 'react';
import { notify } from './notifications';
import { useSession } from './session';

const APP = 'subster-app';
const EXTENSION = 'subster-extension';

interface Status {
  /** The extension answered on this page. */
  installed: boolean;
  /** It reports for the account that is signed in. */
  linked: boolean;
  version?: string;
}
const NONE: Status = { installed: false, linked: false };
let status = NONE;
const listeners = new Set<() => void>();
const set = (next: Status) => {
  if (next.installed === status.installed && next.linked === status.linked && next.version === status.version) return;
  status = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Whether this browser has the extension, and whether it reports for this account. */
export const useExtension = () => useSyncExternalStore(subscribe, () => status, () => NONE);

/** Mounted once for a signed-in person. Renders nothing. */
export function ExtensionLink() {
  const { me } = useSession();
  const key = me?.deviceKey;

  useEffect(() => {
    if (!key) return;
    const say = (message: Record<string, unknown>) => window.postMessage({ source: APP, ...message }, window.location.origin);
    let offered = false;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as { source?: string; type?: string; version?: string; linked?: boolean; keyHint?: string; ok?: boolean } | null;
      if (!message || message.source !== EXTENSION) return;
      if (message.type === 'ready') {
        const linked = message.linked === true && message.keyHint === key.slice(-6);
        set({ installed: true, linked, version: message.version });
        // Offered once per visit: if the extension declines, the page does not keep asking.
        if (!linked && !offered) {
          offered = true;
          say({ type: 'link', deviceKey: key });
        }
      }
      if (message.type === 'linked' && message.ok) notify({ tone: 'good', title: 'Browser extension connected', body: 'Usage from this browser now reaches your account.' });
    };

    window.addEventListener('message', onMessage);
    say({ type: 'hello' });
    // The extension's script may load a moment after the page does.
    const again = setTimeout(() => say({ type: 'hello' }), 1500);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(again);
    };
  }, [key]);

  return null;
}
