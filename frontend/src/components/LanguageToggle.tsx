import { useTranslation } from 'react-i18next';

import { isLanguage, SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { SegmentedControl } from './SegmentedControl';

/** SQ | EN switch. The choice is saved by the i18n language listener. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const current: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <SegmentedControl
      label={t('header.languageLabel')}
      value={current}
      options={SUPPORTED_LANGUAGES.map((code) => ({
        value: code,
        label: t(`language.${code}.short`),
        ariaLabel: t(`language.${code}.label`),
      }))}
      onChange={(language) => {
        void i18n.changeLanguage(language);
      }}
    />
  );
}
