import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import i18n from '../i18n';

// Async queries wait a little longer than the 1s default: with many test files running in
// parallel on a busy machine, lazy route chunks and animated step changes can exceed it.
configure({ asyncUtilTimeout: 4000 });

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

// jsdom has no IntersectionObserver (framer-motion's `whileInView` needs one). Report every
// observed element as visible at once so scroll-reveal content is in its final state.
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    const entry = { isIntersecting: true, target } as IntersectionObserverEntry;
    this.callback([entry], this);
  }
  unobserve = (): void => undefined;
  disconnect = (): void => undefined;
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
window.IntersectionObserver = ImmediateIntersectionObserver;

// jsdom has no layout engine, so every element reports a 0x0 box, and no ResizeObserver either.
// recharts' <ResponsiveContainer> (the quiz results' donut/bar charts) treats a missing
// ResizeObserver as "never measured" and renders nothing inside it as a result -- a fake,
// fixed, non-zero size (and an observer that reports it once, synchronously, like the
// IntersectionObserver fake above) lets those charts actually render their real content.
const FAKE_CHART_RECT = { width: 320, height: 240, top: 0, left: 0, bottom: 240, right: 320 };
Element.prototype.getBoundingClientRect = () => ({
  ...FAKE_CHART_RECT,
  x: 0,
  y: 0,
  toJSON: () => FAKE_CHART_RECT,
});
class ImmediateResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    const entry = { target, contentRect: FAKE_CHART_RECT } as ResizeObserverEntry;
    this.callback([entry], this);
  }
  unobserve = (): void => undefined;
  disconnect = (): void => undefined;
}
window.ResizeObserver = ImmediateResizeObserver;

// jsdom does not implement scrolling; landing-page anchor links call scrollIntoView.
Element.prototype.scrollIntoView = () => undefined;

// jsdom has no real Canvas 2D rendering context (`getContext('2d')` returns null), but
// canvas-confetti (the quiz results' celebration effect) calls straight into one without a
// null check, same as it safely can in every real browser. A Proxy that no-ops any method and
// accepts any property write stands in for the whole API surface without enumerating it.
function createNoopCanvasContext(): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  return new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : noop,
      set: (target: Record<string, unknown>, prop: string, value: unknown) => {
        target[prop] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}
HTMLCanvasElement.prototype.getContext = ((contextId: string) =>
  contextId === '2d'
    ? createNoopCanvasContext()
    : null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom has no Web Speech API either (used by Explainer Mode's default voice engine). No
// installed voices by default, matching a common real "no voice for this language" case;
// individual tests can `vi.spyOn(window.speechSynthesis, 'getVoices')` to simulate one.
class FakeSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
window.SpeechSynthesisUtterance =
  FakeSpeechSynthesisUtterance as unknown as typeof SpeechSynthesisUtterance;
window.speechSynthesis = {
  getVoices: () => [],
  speak: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  cancel: () => undefined,
} as unknown as SpeechSynthesis;

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
