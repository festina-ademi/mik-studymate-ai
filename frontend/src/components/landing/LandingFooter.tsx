import { useTranslation } from 'react-i18next';

/** Landing-page footer: a single centered credit line. */
export function LandingFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border">
      <p className="mx-auto max-w-7xl px-4 py-6 text-center text-sm text-fg-muted sm:px-6">
        {t('landing.footer.credit')}
      </p>
    </footer>
  );
}
