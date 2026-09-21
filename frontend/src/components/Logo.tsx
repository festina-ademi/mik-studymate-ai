import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** Placeholder logo: a rounded mark next to the product name. */
export function Logo() {
  const { t } = useTranslation();

  return (
    <Link
      to="/"
      aria-label={t('app.goHome')}
      className="flex items-center gap-2 rounded-xl text-fg"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-contrast">
        <Sparkles aria-hidden className="size-5" />
      </span>
      <span className="hidden text-lg font-semibold tracking-tight sm:inline">{t('app.name')}</span>
    </Link>
  );
}
