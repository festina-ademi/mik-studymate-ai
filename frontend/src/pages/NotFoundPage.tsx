import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** Shown for any URL that no route matches. */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="text-fg-muted">{t('notFound.text')}</p>
      <Link
        to="/"
        className="rounded-xl bg-primary px-4 py-2 font-medium text-primary-contrast transition-colors hover:bg-primary-hover"
      >
        {t('notFound.backHome')}
      </Link>
    </section>
  );
}
