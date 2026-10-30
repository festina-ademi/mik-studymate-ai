import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';

import { Header } from './Header';
import { QuotaExceededModal } from './QuotaExceededModal';

/** Page frame shared by every route: header and content area. */
export function AppShell() {
  const { t } = useTranslation();
  // The landing page lays out its own full-width sections; every other page gets a padded column.
  const isLanding = useLocation().pathname === '/';

  return (
    <div className="app-shell flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-xl bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20"
      >
        {t('app.skipToContent')}
      </a>
      <Header />
      <main
        id="main"
        tabIndex={-1}
        className={`app-shell__main w-full flex-1 ${
          isLanding ? '' : 'mx-auto max-w-6xl px-4 py-12 sm:px-6'
        }`}
      >
        <Outlet />
      </main>
      <QuotaExceededModal />
    </div>
  );
}
