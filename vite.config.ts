import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  // tanstackStart() must come before the React plugin.
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // On Vercel nothing stays running, so the daily background work is a scheduled call.
    nitro({ vercel: { config: { version: 3, crons: [{ path: '/api/cron', schedule: '30 2 * * *' }] } } }),
    viteReact(),
  ],
});
