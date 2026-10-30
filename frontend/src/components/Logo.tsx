import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * The MIK logo (bot mark with its "MIK" wordmark), linking home. The artwork is near-black on a
 * transparent background, so the dark theme inverts it to white rather than needing a second
 * file; `logo-cropped.png` is `logo.png` with its empty margins trimmed, so the mark stays
 * legible at header size.
 */
export function Logo() {
  const { t } = useTranslation();

  return (
    <Link
      to="/"
      aria-label={t('app.goHome')}
      className="inline-flex items-center rounded-2xl transition-transform duration-200 hover:-translate-y-0.5"
    >
      <img
        src="/images/logo-cropped.png"
        alt={t('app.name')}
        width={441}
        height={575}
        className="h-12 w-auto dark:invert"
      />
    </Link>
  );
}
