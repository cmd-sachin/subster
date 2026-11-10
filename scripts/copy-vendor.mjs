// Copies Bryntum's prebuilt stylesheets and icon fonts into public/vendor so they are served as
// static files. They are large, already compiled, and gain nothing from going through the app's
// CSS pipeline, which keeps builds fast and light on memory. Runs before dev and build.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', '@bryntum', 'scheduler');
const to = path.join(root, 'public', 'vendor', 'bryntum');

if (!existsSync(from)) {
  console.warn('[copy-vendor] @bryntum/scheduler is not installed yet; skipping.');
  process.exit(0);
}

mkdirSync(to, { recursive: true });
for (const entry of ['scheduler.css', 'svalbard-dark.css', 'fontawesome', 'fonts']) {
  if (existsSync(path.join(from, entry))) cpSync(path.join(from, entry), path.join(to, entry), { recursive: true });
}
console.log('[copy-vendor] Bryntum styles copied to public/vendor/bryntum');
