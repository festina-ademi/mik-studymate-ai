import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env: Record<string, string | undefined> = loadEnv(mode, process.cwd(), '');
  // 127.0.0.1 rather than "localhost": Node may resolve localhost to IPv6 (::1) on Windows,
  // while uvicorn listens on IPv4 by default.
  const backendUrl = env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
