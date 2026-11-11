// End to end, over HTTP, against a running server with an empty data folder:
//
//   SUBSTER_DATA_DIR=$(mktemp -d) npm run dev -- --port 3100
//   BASE=http://localhost:3100 npm run test:e2e
//
// It walks the path a real person takes: the first account becomes the administrator, a second
// person signs up, finishes the welcome steps into the demo, uses the assistant, decides a
// proposal, ends the demo and lands on their own empty data. It also checks that one person
// cannot see another's data and that an administrator's switches actually bite.

import crypto from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:3100';
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
};

/** A browser, as far as the server can tell: it keeps the session cookie between calls. */
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, text };
  };
}

const secret = () => crypto.randomBytes(12).toString('base64url');
const tag = Date.now().toString(36);
const admin = client();
const user = client();
const stranger = client();
const adminLogin = { email: `admin-${tag}@example.test`, name: 'Asha Admin', password: secret() };
const userLogin = { email: `user-${tag}@example.test`, name: 'Uma User', password: secret() };

// ---- Accounts ----------------------------------------------------------------------------------
let me = (await stranger('GET', '/api/auth/me')).data;
check('a fresh server asks to be set up', me.setup === true && me.user === null, JSON.stringify(me));
check('nothing is readable signed out', (await stranger('GET', '/api/state')).status === 401);

let r = await admin('POST', '/api/auth/session', { ...adminLogin, create: true });
check('the first account is the administrator', r.status === 200 && r.data.user.role === 'admin', r.text);
r = await user('POST', '/api/auth/session', { ...userLogin, create: true, currency: 'EUR' });
check('the second account is a member', r.status === 200 && r.data.user.role === 'user', r.text);
const userId = r.data.user.id;

check('a short password is refused', (await stranger('POST', '/api/auth/session', { email: `x-${tag}@example.test`, name: 'X', password: 'short', create: true })).status === 400);
check('a taken email is refused', (await stranger('POST', '/api/auth/session', { ...userLogin, create: true })).status === 400);
check('a wrong password is refused', (await stranger('POST', '/api/auth/session', { email: userLogin.email, password: 'not-the-password' })).status === 401);
check('a member cannot read the logs', (await user('GET', '/api/logs')).status === 403);
check('a member cannot list accounts', (await user('GET', '/api/admin/users')).status === 403);

// ---- Welcome, then the demo --------------------------------------------------------------------
me = (await user('GET', '/api/auth/me')).data;
check('a new account has not been welcomed yet', !me.user.onboardedAt);
r = await user('POST', '/api/auth/onboard', { name: 'Uma', demo: true });
check('finishing the welcome works', r.status === 200, r.text);
me = (await user('GET', '/api/auth/me')).data;
check('the welcome is remembered, with the new name', Boolean(me.user.onboardedAt) && me.user.name === 'Uma');

let state = (await user('GET', '/api/state')).data;
check('the demo opens with sample subscriptions', state.demo === true && state.portfolio.insights.length > 5, `demo=${state.demo} subs=${state.portfolio?.insights?.length}`);
const adminState = (await admin('GET', '/api/state')).data;
check("one person's demo is not another's data", adminState.demo !== true && adminState.portfolio.insights.length === 0);

// ---- The assistant, with its conversation kept on the server ------------------------------------
r = await user('POST', '/api/chat/sessions', {});
const chat = r.data.id;
check('a conversation starts', r.status === 201 && Boolean(chat), r.text);
r = await user('POST', `/api/chat/sessions/${chat}/messages`, { message: 'Subscribe to Disney+ Basic with ads' });
const events = r.text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const proposed = events.find((e) => e.type === 'step' && e.step.actionId);
check('the assistant answers', events.some((e) => e.type === 'text' && e.text), r.text.slice(0, 200));
check('asking to subscribe prepares a proposal', Boolean(proposed), r.text.slice(0, 300));
r = await user('GET', `/api/chat/sessions/${chat}`);
check('both turns are kept with the conversation', r.data.turns?.length === 2 && r.data.turns[1].steps.length > 0);
check('another account cannot open that conversation', (await admin('GET', `/api/chat/sessions/${chat}`)).status === 404);

r = await user('POST', `/api/chat/sessions/${chat}/messages`, { message: 'What can I cancel to save money?' });
check('a savings question shows a checklist', r.text.includes('"type":"checklist"'), r.text.slice(0, 200));

// ---- Deciding ----------------------------------------------------------------------------------
state = (await user('GET', '/api/state')).data;
const subscribe = state.actions.find((a) => a.type === 'subscribe' && a.status === 'pending');
check('the proposal waits for a decision', Boolean(subscribe));
if (subscribe) {
  r = await user('POST', `/api/actions/${subscribe.id}`, { decision: 'reject' });
  check('declining it changes nothing else', r.status === 200 && r.data.actions.find((a) => a.id === subscribe.id).status === 'rejected', r.text.slice(0, 200));
}
r = await user('POST', '/api/agent', { mode: 'chat', engine: 'rules', message: 'cancel Audible' });
state = (await user('GET', '/api/state')).data;
const cancel = state.actions.find((a) => a.type === 'cancel' && a.status === 'pending');
check('asking to cancel prepares a proposal', Boolean(cancel));
if (cancel) {
  r = await user('POST', `/api/actions/${cancel.id}`, { decision: 'approve' });
  const after = r.data.actions?.find((a) => a.id === cancel.id);
  check('approving a card-billed cancel guides to the provider', r.status === 200 && after?.status === 'guided', r.text.slice(0, 200));
}

// ---- What an administrator controls -------------------------------------------------------------
r = await admin('GET', '/api/admin/users');
check('the administrator sees every account', r.status === 200 && r.data.users.length >= 2);
check('and that one of them is in the demo', r.data.users.some((u) => u.id === userId && u.demo === true));
await admin('POST', `/api/admin/users/${userId}`, { permissions: { assistant: false } });
check('switching the assistant off stops it', (await user('POST', '/api/agent', { mode: 'chat', message: 'hello' })).status === 403);
await admin('POST', `/api/admin/users/${userId}`, { permissions: { assistant: true } });
check('and switching it back on restores it', (await user('POST', '/api/agent', { mode: 'chat', engine: 'rules', message: 'hello' })).status === 200);
const adminId = (await admin('GET', '/api/auth/me')).data.user.id;
check('the only administrator cannot be demoted', (await admin('POST', `/api/admin/users/${adminId}`, { role: 'user' })).status === 400);
check('the logs are readable by the administrator', (await admin('GET', '/api/logs?limit=5')).data.entries?.length > 0);

// ---- Devices -----------------------------------------------------------------------------------
const key = (await user('GET', '/api/auth/me')).data.deviceKey;
check('the device key lets the extension ask what to measure', (await stranger('GET', '/api/usage', undefined, { Authorization: `Bearer ${key}` })).status === 200);
check('a wrong device key is refused', (await stranger('GET', '/api/usage', undefined, { Authorization: 'Bearer sk_wrong' })).status === 401);
check('a device key does not open the rest', (await stranger('GET', '/api/state', undefined, { Authorization: `Bearer ${key}` })).status === 401);

// ---- Ending the demo ---------------------------------------------------------------------------
r = await user('POST', '/api/demo', { open: false });
check('ending the demo returns to their own, empty data', r.status === 200 && r.data.demo !== true && r.data.portfolio.insights.length === 0, r.text.slice(0, 200));
r = await user('POST', '/api/upi', { vpa: 'uma.test@okhdfcbank' });
check('their own data takes a UPI ID', r.status === 200 && r.data.upiIds.length === 1, r.text.slice(0, 200));
check('a malformed UPI ID is refused', (await user('POST', '/api/upi', { vpa: 'not a upi id' })).status === 400);

// ---- Other ways to sign in ---------------------------------------------------------------------
check('the currency chosen at sign-up is kept', (await user('GET', '/api/state')).data.settings.currency === 'EUR');

// An authenticator app: the same sum the phone does (RFC 6238), so the server's check is tested
// against an independent implementation.
function totp(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
r = await user('POST', '/api/auth/security', { action: 'totp-start' });
const totpSecret = r.data.secret;
check('setting up an authenticator app gives a key and a QR code', r.status === 200 && /^[A-Z2-7]{32}$/.test(totpSecret) && r.data.qr.startsWith('<svg'), r.text.slice(0, 120));
check('a wrong code does not turn it on', (await user('POST', '/api/auth/security', { action: 'totp-confirm', code: '000000' })).status === 400);
r = await user('POST', '/api/auth/security', { action: 'totp-confirm', code: totp(totpSecret) });
check('the right code turns it on', r.status === 200 && r.data.user.security.totp === true, r.text.slice(0, 160));

const phone = client();
r = await phone('POST', '/api/auth/session', { email: userLogin.email, password: userLogin.password });
check('the password alone no longer signs in', r.status === 200 && r.data.step === 'authenticator' && !r.data.user, r.text.slice(0, 160));
check('and opens nothing yet', (await phone('GET', '/api/state')).status === 401);
check('a wrong authenticator code is refused', (await phone('POST', '/api/auth/session', { ticket: r.data.ticket, code: '123456' })).status === 401);
const second = await phone('POST', '/api/auth/session', { ticket: r.data.ticket, code: totp(totpSecret) });
check('the right authenticator code signs in', second.status === 200 && Boolean(second.data.user) && (await phone('GET', '/api/state')).status === 200, second.text.slice(0, 160));
check('turning it off needs a current code', (await user('POST', '/api/auth/security', { action: 'totp-remove', code: '000000' })).status === 400);
r = await user('POST', '/api/auth/security', { action: 'totp-remove', code: totp(totpSecret) });
check('with one, it turns off', r.status === 200 && r.data.user.security.totp === false);

// A code by email. Only when the server was started with the test outbox (SUBSTER_EMAIL_OUTBOX=1)
// and this test is told where its data folder is.
const outbox = process.env.SUBSTER_DATA_DIR && `${process.env.SUBSTER_DATA_DIR}/outbox.json`;
if ((await stranger('GET', '/api/auth/me')).data.emailCodes && outbox) {
  const fs = await import('node:fs');
  check('asking for a code for an unknown address looks the same', (await stranger('PUT', '/api/auth/session', { email: `nobody-${tag}@example.test` })).status === 200);
  r = await stranger('PUT', '/api/auth/session', { email: userLogin.email });
  const mail = JSON.parse(fs.readFileSync(outbox, 'utf8'));
  const emailed = mail.text.match(/\b(\d{6})\b/)?.[1];
  check('a sign-in code is emailed to the account', r.status === 200 && mail.to === userLogin.email && Boolean(emailed));
  const inbox = client();
  check('a wrong emailed code is refused', (await inbox('POST', '/api/auth/session', { email: userLogin.email, code: emailed === '111111' ? '222222' : '111111' })).status === 401);
  r = await inbox('POST', '/api/auth/session', { email: userLogin.email, code: emailed });
  check('the emailed code signs in without the password', r.status === 200 && Boolean(r.data.user), r.text.slice(0, 160));
  check('and cannot be used twice', (await client()('POST', '/api/auth/session', { email: userLogin.email, code: emailed })).status === 401);
} else console.log('SKIP email codes (start the server with SUBSTER_EMAIL_OUTBOX=1 and pass SUBSTER_DATA_DIR to this test)');

check('passkey sign-in offers a challenge', (await stranger('POST', '/api/auth/security', { action: 'passkey-signin-options' })).data.options?.challenge?.length > 10);
check('security settings need a signed-in account', (await stranger('POST', '/api/auth/security', { action: 'totp-start' })).status === 401);

// ---- The demo without an account ---------------------------------------------------------------
const guest = client();
r = await guest('POST', '/api/auth/guest', {});
const guestId = r.data.user?.id;
check('a visitor can open the demo without an account', r.status === 200 && r.data.user.guest === true, r.text.slice(0, 160));
state = (await guest('GET', '/api/state')).data;
check('the guest sees sample data', state.demo === true && state.portfolio.insights.length > 5);
check('the guest is given no device key', (await guest('GET', '/api/auth/me')).data.deviceKey === undefined);
check('the guest cannot link anything real', (await guest('POST', '/api/upi', { vpa: 'guest.test@okaxis' })).status === 403);
check('the guest cannot set up sign-in security', (await guest('POST', '/api/auth/security', { action: 'totp-start' })).status === 403);
check('the guest cannot reach the admin page', (await guest('GET', '/api/admin/users')).status === 403);
check('the guest cannot swap the demo for stored data', (await guest('POST', '/api/demo', { open: false })).status === 400);
check('the guest can use the assistant', (await guest('POST', '/api/agent', { mode: 'chat', engine: 'rules', message: 'What renews this week?' })).status === 200);
check('the administrator sees the guest', (await admin('GET', '/api/admin/users')).data.users.some((u) => u.id === guestId && u.guest));
await guest('DELETE', '/api/auth/session');
check('ending the demo signs the guest out', (await guest('GET', '/api/state')).status === 401);
check('and deletes the guest', !(await admin('GET', '/api/admin/users')).data.users.some((u) => u.id === guestId));
await admin('POST', '/api/admin/users', { guestDemo: false });
check('the administrator can switch the demo login off', (await client()('POST', '/api/auth/guest', {})).status === 403 && (await stranger('GET', '/api/auth/me')).data.guestDemo === false);
await admin('POST', '/api/admin/users', { guestDemo: true });
check('and back on', (await stranger('GET', '/api/auth/me')).data.guestDemo === true);

// ---- Suspension and signing out ----------------------------------------------------------------
await admin('POST', `/api/admin/users/${userId}`, { status: 'suspended' });
check('a suspended account is signed out', (await user('GET', '/api/state')).status === 401);
check('and cannot sign back in', (await user('POST', '/api/auth/session', { email: userLogin.email, password: userLogin.password })).status === 403);
await admin('POST', `/api/admin/users/${userId}`, { status: 'active' });
check('once restored, it can', (await user('POST', '/api/auth/session', { email: userLogin.email, password: userLogin.password })).status === 200);
await user('DELETE', '/api/auth/session');
check('signing out ends the session', (await user('GET', '/api/state')).status === 401);
r = await admin('DELETE', `/api/admin/users/${userId}`);
check('deleting an account removes it', r.status === 200 && !(await admin('GET', '/api/admin/users')).data.users.some((u) => u.id === userId));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
