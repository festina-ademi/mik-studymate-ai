import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

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
      // CSS stays unprocessed in tests, except the print stylesheet: its print-export test
      // imports it as `?raw` text, which `css: false` would turn into an empty string.
      css: { include: [/styles\/print\.css/] },
      testTimeout: 20_000,
      // e2e/**/*.spec.ts are Playwright tests (run via `npm run test:e2e`), not Vitest's; without
      // this they'd otherwise match Vitest's default *.spec.ts discovery too and fail to load,
      // since they call Playwright's test() rather than Vitest's.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  };
});
