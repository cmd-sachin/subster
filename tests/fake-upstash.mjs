// A stand-in for the Upstash Redis REST interface, for testing the serverless storage path
// without an account: node tests/fake-upstash.mjs [port]. It keeps everything in memory and
// understands the three commands the app uses, sent to /pipeline.
import http from 'node:http';

const port = Number(process.argv[2] ?? 8079);
const data = new Map();
const run = ([command, key, value]) => {
  switch (String(command).toUpperCase()) {
    case 'GET':
      return { result: data.get(key) ?? null };
    case 'SET':
      data.set(key, value);
      return { result: 'OK' };
    case 'DEL':
      return { result: data.delete(key) ? 1 : 0 };
    default:
      return { error: `unknown command ${command}` };
  }
};

http
  .createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') return res.writeHead(401).end('{"error":"Unauthorized"}');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const commands = JSON.parse(body || '[]');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(req.url === '/pipeline' ? commands.map(run) : run(commands)));
    });
  })
  .listen(port, () => console.log(`fake upstash on ${port}`));
