import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getServerPort(): string {
  const fallback = process.env.API_PORT ?? process.env.PORT ?? '3000';
  try {
    const envPath = resolve(__dirname, '../server/.env');
    const env = readFileSync(envPath, 'utf8');
    const match = env.match(/^PORT=(.+)$/m);
    return match?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

const serverPort = getServerPort();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@zemingengine\/shared$/,
        replacement: resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    ],
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
