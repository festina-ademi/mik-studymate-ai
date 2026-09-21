import { useTranslation } from 'react-i18next';

import { useHealth } from '../hooks/useHealth';
import { describeError } from '../lib/errors';

/** Small indicator showing whether the backend answers ``/api/health``. */
export function BackendStatus() {
  const { t } = useTranslation();
  const health = useHealth();

  let label = t('status.checking');
  let dotClass = 'bg-fg-muted animate-pulse';
  let hint: string | undefined;

  if (health.isSuccess) {
    label = t('status.connected');
    dotClass = 'bg-success';
    hint = health.data.version;
  } else if (health.isError) {
    label = t('status.unavailable');
    dotClass = 'bg-error';
    hint = describeError(t, health.error);
  }

  return (
    <p role="status" title={hint} className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <span aria-hidden className={`size-2 rounded-full ${dotClass}`} />
      {label}
    </p>
  );
}
