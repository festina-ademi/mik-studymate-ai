import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../hooks/useTheme';
import { THEME_PREFERENCES, type ThemePreference } from '../lib/theme';
import { SegmentedControl } from './SegmentedControl';

const ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** System / light / dark switch. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  return (
    <SegmentedControl
      label={t('header.themeLabel')}
      value={preference}
      options={THEME_PREFERENCES.map((option) => {
        const Icon = ICONS[option];
        return {
          value: option,
          label: <Icon aria-hidden className="size-4" />,
          ariaLabel: t(`theme.${option}`),
        };
      })}
      onChange={setPreference}
    />
  );
}
