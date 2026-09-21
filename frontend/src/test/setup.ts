import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import i18n from '../i18n';

// jsdom has no matchMedia; report "light" and accept listeners.
window.matchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
