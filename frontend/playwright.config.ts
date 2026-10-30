import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * One deterministic end-to-end flow (PROJECT_SPEC.md section 3/11): upload -> summary -> quiz ->
 * tutor with citation -> language switch -> Study Mode smoke test, against real backend and
 * frontend dev servers. Determinism comes from two backend settings, never used outside tests:
 * `LLM_PROVIDER=mock` with a schema-keyed fixture file (see app.llm.mock.MockProvider and
 * backend/e2e_fixtures/mock_llm_responses.json) instead of a real model, and
 * `EMBEDDING_PROVIDER=hash` (app.rag.embeddings.HashingEmbeddingProvider) instead of downloading
 * a real embedding model, so retrieval works instantly and offline.
 */

const frontendRoot: string = import.meta.dirname;
const backendDir = path.resolve(frontendRoot, '../backend');
const pythonBin =
  process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python');

const BACKEND_PORT = 8010;
// A dedicated port, distinct from the normal dev server's 5173, so the e2e run never collides
// with a `npm run dev` a developer already has open.
const FRONTEND_PORT = 5183;
// A fresh, unique data directory per Playwright run (rather than deleting a fixed path, which
// would race against webServer/globalSetup ordering) so every run starts from a clean database,
// vector store and upload directory with no leftover state from a previous run.
const RUN_DATA_DIR = path.join(backendDir, 'data', `e2e-${String(Date.now())}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(FRONTEND_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `"${pythonBin}" -m uvicorn app.main:app --host 127.0.0.1 --port ${String(BACKEND_PORT)}`,
      cwd: backendDir,
      url: `http://127.0.0.1:${String(BACKEND_PORT)}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        APP_ENV: 'test',
        LOG_LEVEL: 'WARNING',
        LLM_PROVIDER: 'mock',
        MOCK_LLM_FIXTURES_PATH: path.join(backendDir, 'e2e_fixtures', 'mock_llm_responses.json'),
        EMBEDDING_PROVIDER: 'hash',
        DATABASE_URL: `sqlite:///${path.join(RUN_DATA_DIR, 'e2e.db').split(path.sep).join('/')}`,
        CHROMA_DIR: path.join(RUN_DATA_DIR, 'chroma'),
        UPLOAD_DIR: path.join(RUN_DATA_DIR, 'uploads'),
        RATE_LIMIT_ENABLED: 'false',
        ADMIN_PASSWORD: 'e2e-test-password',
        STUDY_RETENTION_DELAY_DEV_MINUTES: '1',
      },
    },
    {
      // --host 127.0.0.1 rather than the default "localhost": on Windows, Vite/Node can resolve
      // "localhost" to the IPv6 loopback (::1) only, which this config's IPv4 URLs then can't
      // reach at all (see vite.config.ts's own comment on the same issue for the backend proxy).
      command: `npm run dev -- --port ${String(FRONTEND_PORT)} --host 127.0.0.1`,
      cwd: frontendRoot,
      url: `http://127.0.0.1:${String(FRONTEND_PORT)}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        // Vite's dev-server proxy (vite.config.ts) forwards /api to this origin, so the browser
        // itself only ever talks to FRONTEND_PORT — no CORS configuration is needed for e2e.
        VITE_BACKEND_URL: `http://127.0.0.1:${String(BACKEND_PORT)}`,
      },
    },
  ],
});
