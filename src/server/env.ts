// Loads .env.local and .env into process.env for the server. Vite only exposes VITE_-prefixed
// variables to the browser bundle, so secrets read here never reach the client. Import this before
// reading process.env at module scope.
//
// A key left blank in one file (as in the copied template) does not block a value given in the
// other: the first non-empty value wins, with .env.local ahead of .env, and a variable already
// set in the real environment ahead of both.

import fs from 'node:fs';
import { parseEnv } from 'node:util';

for (const file of ['.env.local', '.env']) {
  let parsed: Record<string, string | undefined>;
  try {
    parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  } catch {
    continue; // The file is optional.
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (value && !process.env[key]) process.env[key] = value;
  }
}

export {};
