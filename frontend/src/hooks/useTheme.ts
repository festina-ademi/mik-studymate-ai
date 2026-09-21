import { useCallback, useEffect, useState } from 'react';

import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  type ThemePreference,
} from '../lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Theme preference (system / light / dark), persisted, applied to the document. */
export function useTheme(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = (): void => {
      applyTheme(resolveTheme(preference, media.matches));
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
