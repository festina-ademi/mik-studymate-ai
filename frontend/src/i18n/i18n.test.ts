import { describe, expect, it, vi } from 'vitest';

import { detectLanguage } from '.';
import en from './en.json';
import sq from './sq.json';

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  return Object.entries(tree).reduce<Record<string, unknown>>((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      return { ...flat, ...flatten(value as Record<string, unknown>, path) };
    }
    return { ...flat, [path]: value };
  }, {});
}

describe('translation files', () => {
  it('define exactly the same keys in Albanian and English, all non-empty', () => {
    const english = flatten(en);
    const albanian = flatten(sq);

    expect(Object.keys(albanian).sort()).toEqual(Object.keys(english).sort());
    for (const value of [...Object.values(english), ...Object.values(albanian)]) {
      expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
    }
  });
});

describe('detectLanguage', () => {
  it('picks Albanian when the browser prefers it', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['sq-AL', 'en-US']);

    expect(detectLanguage()).toBe('sq');
  });

  it('skips unsupported browser languages and falls back to English', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE', 'fr']);

    expect(detectLanguage()).toBe('en');
  });

  it('prefers a saved choice over the browser language', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['sq-AL']);
    window.localStorage.setItem('studymate.language', 'en');

    expect(detectLanguage()).toBe('en');
  });
});
