import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';
import en from './en.json';
import sq from './sq.json';

export const SUPPORTED_LANGUAGES = ['sq', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const FALLBACK_LANGUAGE: Language = 'en';

/** Whether ``value`` is one of the supported UI languages. */
export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value);
}

/**
 * Choose the initial language: a saved choice wins; otherwise the first browser language that
 * is supported; otherwise English.
 */
export function detectLanguage(): Language {
  const stored = readStorage(STORAGE_KEYS.language);
  if (isLanguage(stored)) {
    return stored;
  }
  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) {
      return primary;
    }
  }
  return FALLBACK_LANGUAGE;
}

// Registered before init so the detected language is also applied and saved on first load.
i18n.on('languageChanged', (language: string) => {
  writeStorage(STORAGE_KEYS.language, language);
  document.documentElement.lang = language;
  document.title = `${i18n.t('app.name')} — ${i18n.t('app.tagline')}`;
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, sq: { translation: sq } },
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18n;
