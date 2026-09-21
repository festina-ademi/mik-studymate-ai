/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Empty by default so requests go through the Vite dev proxy. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
