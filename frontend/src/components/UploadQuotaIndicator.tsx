import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useQuota } from '../lib/quota';

/** "X of 5 documents used today", warning-colored once the upload quota is used up. */
export function UploadQuotaIndicator({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const quota = useQuota()?.uploads;
  if (!quota) {
    return null;
  }
  const exhausted = quota.used >= quota.limit;
  return (
    <p
      data-testid="upload-quota"
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${exhausted ? 'text-warning' : 'text-fg-muted'} ${className}`}
    >
      <Gauge aria-hidden className="size-3.5" />
      {t('quota.usedToday', { used: Math.min(quota.used, quota.limit), limit: quota.limit })}
    </p>
  );
}
