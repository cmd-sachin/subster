import { localDate, originsFor } from './logic.js';

const DEFAULT_SERVER = 'http://localhost:3000';
const $ = (id) => document.getElementById(id);

function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function duration(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

async function render() {
  const { sites = [], totals = {}, current, lastSync, auth = {}, serverUrl = DEFAULT_SERVER } = await chrome.storage.local.get(['sites', 'totals', 'current', 'lastSync', 'auth', 'serverUrl']);
  if (document.activeElement !== $('url')) $('url').value = serverUrl;

  const today = totals[localDate(new Date())] ?? {};
  const list = $('sites');
  list.replaceChildren();
  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing to measure yet. Add a subscription in Subster, then sync.';
    list.append(empty);
  }
  for (const site of sites) {
    const item = document.createElement('li');
    if (current?.site === site.id) item.className = 'now';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = site.name;
    name.title = site.domains.join(', ');
    const time = document.createElement('span');
    time.className = 'num';
    time.textContent = duration(today[site.id] ?? 0);
    const state = auth[site.id]?.auth;
    if (state) {
      const badge = document.createElement('span');
      badge.className = `auth ${state}`;
      badge.textContent = { signed_in: 'signed in', likely: 'session found', signed_out: 'signed out', unknown: 'sign-in unknown' }[state];
      name.append(badge);
    }
    item.append(name, time);
    list.append(item);
  }

  // Sign-in monitoring needs the user's permission for each site; ask only for what is missing.
  const missing = [];
  for (const site of sites) if (!(await chrome.permissions.contains({ origins: originsFor([site]) }))) missing.push(site);
  $('signin').hidden = missing.length === 0;
  $('signin').textContent = `Monitor sign-in on ${missing.length} site${missing.length === 1 ? '' : 's'}`;
  $('signin').onclick = async () => {
    if (await chrome.permissions.request({ origins: originsFor(missing) })) await sync();
  };
  $('signin-note').hidden = missing.length === 0;

  const status = $('status');
  status.className = lastSync && !lastSync.ok ? 'bad' : '';
  status.textContent = lastSync ? `${lastSync.ok ? 'Synced' : 'Sync failed'} ${ago(lastSync.at)}. ${lastSync.message}` : 'Not synced yet.';
}

async function sync() {
  $('sync').disabled = true;
  $('sync').textContent = 'Syncing';
  await chrome.runtime.sendMessage({ type: 'sync' });
  $('sync').disabled = false;
  $('sync').textContent = 'Sync now';
  await render();
}

// The device key ties this browser's reports to one Subster account. It is kept in this browser
// and sent only to the Subster server.
$('key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({ deviceKey: $('key').value.trim() });
  $('key').value = '';
  $('key').placeholder = 'Saved';
  await sync();
});

$('server').addEventListener('submit', async (event) => {
  event.preventDefault();
  let url;
  try {
    url = new URL($('url').value.trim());
  } catch {
    return;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!local) {
    if (url.protocol !== 'https:') {
      $('status').className = 'bad';
      $('status').textContent = 'A server that is not on this machine must use https.';
      return;
    }
    // Asked for here, on the click, for this one address only.
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) return;
  }
  await chrome.storage.local.set({ serverUrl: url.origin });
  await sync();
});

$('sync').addEventListener('click', sync);
chrome.storage.onChanged.addListener(render);
await chrome.runtime.sendMessage({ type: 'settle' });
await render();
