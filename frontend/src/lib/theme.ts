import { readStorage, STORAGE_KEYS, writeStorage } from './storage';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Whether ``value`` is a valid theme preference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

/** The saved preference, or ``system`` on first visit. */
export function readThemePreference(): ThemePreference {
  const stored = readStorage(STORAGE_KEYS.theme);
  return isThemePreference(stored) ? stored : 'system';
}

/** Save the preference so it survives reloads. */
export function saveThemePreference(preference: ThemePreference): void {
  writeStorage(STORAGE_KEYS.theme, preference);
}

/** Turn a preference into the concrete theme to render. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

/** Apply the theme to the document; CSS variables in styles/index.css react to it. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}
