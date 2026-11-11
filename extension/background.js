// Subster usage: watches the sites of subscriptions the user tracks, and nothing else.
//
// Three things are reported to the user's own Subster server:
//   presence  the moment a tracked site is opened or left, and once a minute while it stays open
//   usage     daily totals per subscription
//   sign-in   whether a signed-in session exists on a site, where the user allowed that check
//
// The server says which domains belong to tracked subscriptions. Time is counted for one of them
// while it is in the focused tab and the user is active, or while its tab is playing sound (a
// film or music keeps counting with no keyboard or mouse input, and music keeps counting in a
// background tab). Only daily totals per subscription are stored and sent: no page addresses,
// titles or content.

import { authFromCookies, localDate, originsFor, pickSite } from './logic.js';

const DEFAULT_SERVER = 'http://localhost:3000';

/** The headers for a call to the server: the device key says whose usage this is. */
async function headersFor(json) {
  const { deviceKey } = await store.get('deviceKey');
  return { ...(json ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' }), ...(deviceKey ? { Authorization: `Bearer ${deviceKey}` } : {}) };
}
const TICK_MINUTES = 1;
const SYNC_MINUTES = 5;
// One settle never credits more than this, so a sleeping laptop or a stopped worker adds nothing.
const MAX_CREDIT_MS = 90_000;
const IDLE_AFTER_SECONDS = 60;
const KEEP_DAYS = 35;
const SEND_DAYS = 7;

const store = chrome.storage.local;

// Chrome events arrive concurrently; storage reads and writes must not interleave.
let queue = Promise.resolve();
const serial = (work) => (queue = queue.then(work, work));

async function siteInUse(sites) {
  const idle = await chrome.idle.queryState(IDLE_AFTER_SECONDS);
  if (idle === 'locked') return null;
  const tabs = await chrome.tabs.query({});
  const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
  return pickSite(
    tabs.map((tab) => ({ url: tab.url, audible: Boolean(tab.audible), focused: Boolean(tab.active && focusedWindow?.focused && tab.windowId === focusedWindow.id) })),
    sites,
    idle === 'active',
  );
}

/** Credits the time since the last settle to whatever was in use, then notes what is in use now. */
async function settle() {
  const now = Date.now();
  const { current, totals = {}, sites = [], installedOn } = await store.get(['current', 'totals', 'sites', 'installedOn']);
  if (current?.site && sites.some((s) => s.id === current.site)) {
    const credit = Math.min(Math.max(0, now - current.since), MAX_CREDIT_MS);
    const day = localDate(new Date(now));
    totals[day] ??= {};
    totals[day][current.site] = (totals[day][current.site] ?? 0) + credit;
  }
  const cutoff = localDate(new Date(now - KEEP_DAYS * 86_400_000));
  for (const day of Object.keys(totals)) if (day < cutoff) delete totals[day];
  const next = await siteInUse(sites);
  await store.set({ totals, current: { site: next?.id ?? null, since: now }, installedOn: installedOn ?? localDate(new Date(now)) });

  // Live: say so the moment a site is opened or left, and keep saying so while it stays open.
  const was = current?.site ?? null;
  const is = next?.id ?? null;
  const day = localDate(new Date(now));
  const reports = [];
  if (was && was !== is) reports.push({ site: was, active: false, date: day, minutes: Math.round((totals[day]?.[was] ?? 0) / 60_000) });
  if (is) reports.push({ site: is, active: true, date: day, minutes: Math.round((totals[day]?.[is] ?? 0) / 60_000) });
  if (reports.length > 0) await postPresence(reports);
}

async function postPresence(sites) {
  const { serverUrl = DEFAULT_SERVER } = await store.get('serverUrl');
  try {
    await fetch(`${serverUrl}/api/presence`, { method: 'POST', headers: await headersFor(true), body: JSON.stringify({ sites }) });
  } catch {
    // The server is not running. The next sync reports the totals; presence is only ever current.
  }
}

/**
 * Looks for a signed-in session on each tracked site the user allowed, by cookie name and expiry
 * only, and reports signed in or signed out. Sites without permission are left alone.
 */
async function checkSignIn() {
  const { sites = [] } = await store.get('sites');
  const auth = {};
  const reports = [];
  for (const site of sites) {
    if (!(await chrome.permissions.contains({ origins: originsFor([site]) }))) continue;
    const cookies = (await Promise.all(site.domains.map((domain) => chrome.cookies.getAll({ domain })))).flat();
    const result = authFromCookies(cookies, site.sessionCookies ?? [], Date.now() / 1000);
    auth[site.id] = { ...result, checkedAt: Date.now() };
    reports.push({ site: site.id, ...result });
  }
  await store.set({ auth });
  if (reports.length > 0) await postPresence(reports);
}

/** Asks the server what to measure and sends the recent daily totals. */
async function sync() {
  const { serverUrl = DEFAULT_SERVER } = await store.get('serverUrl');
  try {
    const listed = await fetch(`${serverUrl}/api/usage`, { headers: await headersFor(false) });
    if (!listed.ok) throw new Error(`Server answered ${listed.status}`);
    const sites = (await listed.json()).sites ?? [];
    await store.set({ sites });
    trackedDomains = null;

    const { totals = {}, installedOn } = await store.get(['totals', 'installedOn']);
    const days = [];
    for (let back = 0; back < SEND_DAYS; back++) {
      const day = localDate(new Date(Date.now() - back * 86_400_000));
      if (installedOn && day < installedOn) break;
      // A tracked site with no time is reported as zero: that is evidence of no use.
      for (const site of sites) days.push({ site: site.id, date: day, minutes: Math.round((totals[day]?.[site.id] ?? 0) / 60_000) });
    }
    let accepted = 0;
    if (days.length > 0) {
      const sent = await fetch(`${serverUrl}/api/usage`, { method: 'POST', headers: await headersFor(true), body: JSON.stringify({ source: 'web', days }) });
      if (!sent.ok) throw new Error(`Server answered ${sent.status}`);
      accepted = (await sent.json()).accepted ?? 0;
    }
    await store.set({ lastSync: { at: Date.now(), ok: true, message: `${sites.length} site${sites.length === 1 ? '' : 's'} tracked, ${accepted} day totals sent` } });
    await checkSignIn();
  } catch (error) {
    await store.set({ lastSync: { at: Date.now(), ok: false, message: `Could not reach ${serverUrl}: ${error.message ?? error}` } });
  }
}

// Cookies change constantly across the whole browser; only tracked sites matter here.
let trackedDomains = null;
async function onCookieChanged(domain) {
  trackedDomains ??= ((await store.get('sites')).sites ?? []).flatMap((site) => site.domains);
  if (!trackedDomains.some((tracked) => domain === tracked || domain.endsWith(`.${tracked}`))) return;
  // One check shortly after the first change; later changes in the burst do not push it back.
  if (!(await chrome.alarms.get('signin'))) chrome.alarms.create('signin', { delayInMinutes: 0.5 });
}

function schedule() {
  chrome.idle.setDetectionInterval(IDLE_AFTER_SECONDS);
  chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES });
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES, delayInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  schedule();
  void serial(settle).then(() => serial(sync));
});
chrome.runtime.onStartup.addListener(() => {
  schedule();
  void serial(settle);
});
chrome.alarms.onAlarm.addListener((alarm) => void serial(alarm.name === 'sync' ? () => settle().then(sync) : alarm.name === 'signin' ? checkSignIn : settle));
chrome.tabs.onActivated.addListener(() => void serial(settle));
chrome.tabs.onRemoved.addListener(() => void serial(settle));
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url !== undefined || change.audible !== undefined) void serial(settle);
});
// Signing in or out changes cookies. A burst of changes becomes one check a few seconds later.
chrome.cookies.onChanged.addListener(({ cookie }) => void onCookieChanged(cookie.domain.replace(/^\./, '')));
chrome.permissions.onAdded.addListener(() => void serial(checkSignIn));
chrome.windows.onFocusChanged.addListener(() => void serial(settle));
chrome.idle.onStateChanged.addListener(() => void serial(settle));

// The popup asks for a fresh state, a sync, or what the current tab counts as.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'sync') void serial(() => settle().then(sync)).then(() => reply({ done: true }));
  else if (message?.type === 'settle') void serial(settle).then(() => reply({ done: true }));
  else return false;
  return true;
});

