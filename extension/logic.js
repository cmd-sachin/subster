// Pure matching rules, kept apart from the Chrome APIs so they can be tested with node.

/** Local calendar day, YYYY-MM-DD: usage belongs to the day the user lived it. */
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The tracked site a page belongs to. The most specific domain wins (music.youtube.com over youtube.com). */
export function matchSite(url, sites) {
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    host = parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  let best = null;
  let bestLength = 0;
  for (const site of sites) {
    for (const domain of site.domains) {
      if ((host === domain || host.endsWith(`.${domain}`)) && domain.length > bestLength) {
        best = site;
        bestLength = domain.length;
      }
    }
  }
  return best;
}

/**
 * Which tracked site is in use right now, if any.
 * tabs: { url, audible, focused } where focused means the active tab of the focused window.
 * The focused tab counts while the user is active or the tab is playing. Otherwise a tracked
 * tab that is playing sound counts, which is how music in the background is measured.
 */
export function pickSite(tabs, sites, userActive) {
  const focused = tabs.find((tab) => tab.focused);
  const front = focused ? matchSite(focused.url, sites) : null;
  if (front && (userActive || focused.audible)) return front;
  for (const tab of tabs) {
    if (!tab.audible) continue;
    const playing = matchSite(tab.url, sites);
    if (playing) return playing;
  }
  return null;
}

const SESSION_LIKE = /(^|[_.-])(session|sess|sid|auth|token|login|logged[_-]?in)([_.-]|id$|$)/i;

/**
 * Whether a site's cookies show a signed-in session. Only names, flags and expiry are looked at;
 * values are never read. `known` are the cookie names the site sets only while signed in: with
 * them the answer is definite, without them a session-like cookie can only mean "likely".
 * cookies: { name, expirationDate (seconds, absent for a browser-session cookie), httpOnly, secure }
 */
export function authFromCookies(cookies, known, nowSeconds) {
  const current = cookies.filter((c) => c.expirationDate === undefined || c.expirationDate > nowSeconds);
  const named = (cookie) => known.some((name) => cookie.name === name || cookie.name.startsWith(`${name}.`));
  const matches = known.length > 0 ? current.filter(named) : current.filter((c) => SESSION_LIKE.test(c.name) && (c.httpOnly || c.secure));
  if (matches.length === 0) return { auth: known.length > 0 || current.length === 0 ? 'signed_out' : 'unknown' };
  // The session lasts as long as its longest-lived cookie; a browser-session cookie has no date.
  const expiry = matches.every((c) => c.expirationDate !== undefined) ? Math.max(...matches.map((c) => c.expirationDate)) : undefined;
  return { auth: known.length > 0 ? 'signed_in' : 'likely', ...(expiry !== undefined && { sessionExpiresAt: new Date(expiry * 1000).toISOString() }) };
}

/** The host permission patterns that cover a site's domains. */
export const originsFor = (sites) => [...new Set(sites.flatMap((site) => site.domains.flatMap((domain) => [`https://${domain}/*`, `https://*.${domain}/*`])))];
