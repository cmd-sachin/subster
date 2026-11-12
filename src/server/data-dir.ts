// Where everything is kept on disk. Set SUBSTER_DATA_DIR to a persistent volume when deploying;
// the default is a .data folder beside the app. Serverless hosts such as Vercel only allow writing
// to /tmp, and nothing written there lasts, so that is used only so the app starts at all.

import path from 'node:path';

export const DATA_DIR = process.env.SUBSTER_DATA_DIR ? path.resolve(process.env.SUBSTER_DATA_DIR) : process.env.VERCEL ? '/tmp/subster' : path.join(process.cwd(), '.data');

/** False where the disk is wiped between requests, so accounts and data would not last. */
export const dataPersists = !process.env.VERCEL || Boolean(process.env.SUBSTER_DATA_DIR) || Boolean(process.env.MONGODB_URI && (process.env.DB_PASSWORD || !process.env.MONGODB_URI.includes('<db_password>'))) || Boolean((process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN));
