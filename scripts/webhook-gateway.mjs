// Webhook gateway. PayPal (and Plaid, Setu, Spotify) need a public HTTPS address to call back,
// but the app itself has no login and must not be on the internet. This small proxy is the only
// thing a tunnel should point at: it forwards an explicit list of webhook and callback paths to
// the app on localhost and answers 404 to everything else.
//
//   npm run gateway            # listens on http://localhost:3001, forwards to :3000
//   then point a tunnel at 3001, e.g.  npx cloudflared tunnel --url http://localhost:3001
//
// The forwarded routes protect themselves: the PayPal webhook is signature-verified, the bank
// webhook only triggers a sync using our own token, and the callbacks check a state or reference
// that this app issued.

import http from 'node:http';

const PORT = Number(process.env.GATEWAY_PORT ?? 3001);
const APP = new URL(process.env.GATEWAY_TARGET ?? 'http://localhost:3000');
const MAX_BODY = 1024 * 1024;

const ALLOWED = [
  ['POST', '/api/paypal/webhook'],
  ['POST', '/api/bank/webhook'],
  ['GET', '/api/paypal/return'],
  ['GET', '/api/bank/callback'],
  ['GET', '/api/accounts/spotify/callback'],
];

const stamp = () => new Date().toISOString();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://gateway');
  const allowed = ALLOWED.some(([method, path]) => method === req.method && path === url.pathname);
  if (!allowed) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Not found"}');
    console.log(`${stamp()} 404 ${req.method} ${url.pathname} (not forwarded)`);
    return;
  }

  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    // The app sees itself as localhost, so the pages it redirects a browser to after a callback
    // are on localhost too, never on the public address.
    const headers = { ...req.headers, host: APP.host };
    const upstream = http.request({ hostname: APP.hostname, port: APP.port, path: url.pathname + url.search, method: req.method, headers }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
      console.log(`${stamp()} ${reply.statusCode} ${req.method} ${url.pathname}`);
    });
    upstream.on('error', (error) => {
      res.writeHead(502, { 'Content-Type': 'application/json' }).end('{"error":"The app is not running"}');
      console.log(`${stamp()} 502 ${req.method} ${url.pathname} (${error.message})`);
    });
    upstream.end(Buffer.concat(chunks));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Webhook gateway on http://localhost:${PORT} -> ${APP.origin}`);
  console.log(`Forwarding only: ${ALLOWED.map(([m, p]) => `${m} ${p}`).join(', ')}`);
});
