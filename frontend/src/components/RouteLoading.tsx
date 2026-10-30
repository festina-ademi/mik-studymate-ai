import { useTranslation } from 'react-i18next';

import { Skeleton } from './Skeleton';

/** Suspense fallback for a lazily-loaded route, while its code chunk is still downloading. */
export function RouteLoading() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-12">
      <p className="text-center text-sm text-fg-muted">{t('common.loadingPage')}</p>
      <Skeleton lines={5} />
    </div>
  );
}
