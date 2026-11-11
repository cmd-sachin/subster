// Checks the browser extension's matching rules. Run with: npm run test:extension
import { localDate, matchSite, pickSite } from '../extension/logic.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` | got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (ok) passed++;
  else failed++;
}

const sites = [
  { id: 'am', name: 'Apple Music', domains: ['music.apple.com'] },
  { id: 'yt', name: 'YouTube Premium', domains: ['youtube.com'] },
  { id: 'ytm', name: 'YouTube Music', domains: ['music.youtube.com'] },
  { id: 'hs', name: 'JioHotstar', domains: ['hotstar.com', 'jiohotstar.com'] },
];
const id = (site) => site?.id ?? null;
const tab = (url, flags = {}) => ({ url, audible: false, focused: false, ...flags });

check('apple music player', id(matchSite('https://music.apple.com/in/browse', sites)), 'am');
check('other apple pages are not apple music', id(matchSite('https://www.apple.com/in/apple-music/', sites)), null);
check('www is ignored', id(matchSite('https://www.youtube.com/watch?v=x', sites)), 'yt');
check('most specific domain wins', id(matchSite('https://music.youtube.com/', sites)), 'ytm');
check('second domain of a service', id(matchSite('https://www.jiohotstar.com/in', sites)), 'hs');
check('lookalike domain does not match', id(matchSite('https://notyoutube.com/', sites)), null);
check('domain in the path does not match', id(matchSite('https://example.com/music.apple.com', sites)), null);
check('browser pages do not match', id(matchSite('chrome://extensions', sites)), null);
check('missing url does not match', id(matchSite(undefined, sites)), null);

check('focused tab while active', id(pickSite([tab('https://music.apple.com/', { focused: true })], sites, true)), 'am');
check('focused tab, idle and silent', id(pickSite([tab('https://music.apple.com/', { focused: true })], sites, false)), null);
check('focused tab, idle but playing', id(pickSite([tab('https://www.youtube.com/watch', { focused: true, audible: true })], sites, false)), 'yt');
check('music playing behind other work', id(pickSite([tab('https://docs.example.com/', { focused: true }), tab('https://music.apple.com/', { audible: true })], sites, true)), 'am');
check('silent background tab is not use', id(pickSite([tab('https://docs.example.com/', { focused: true }), tab('https://music.apple.com/')], sites, true)), null);
check('focused tracked tab beats a playing one', id(pickSite([tab('https://www.youtube.com/', { focused: true }), tab('https://music.apple.com/', { audible: true })], sites, true)), 'yt');
check('untracked sound is not use', id(pickSite([tab('https://radio.example.com/', { focused: true, audible: true })], sites, true)), null);

check('local date', localDate(new Date(2026, 10, 11, 23, 59)), '2026-11-11');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
