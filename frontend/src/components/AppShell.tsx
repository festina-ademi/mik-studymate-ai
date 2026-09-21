import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';

import { BackendStatus } from './BackendStatus';
import { Header } from './Header';

/** Page frame shared by every route: header, content area and footer. */
export function AppShell() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-xl bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20"
      >
        {t('app.skipToContent')}
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
          <BackendStatus />
        </div>
      </footer>
    </div>
  );
}
