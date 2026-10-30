import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { quotaTone, useQuota, type QuotaTone } from '../lib/quota';
import { Tooltip } from './Tooltip';

const BAR_CLASSES: Record<QuotaTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
};

/** "✨ 23 of 50 requests today" with a colored progress bar; the tooltip explains the reset. */
export function AiQuotaBadge() {
  const { t } = useTranslation();
  const tooltipId = useId();
  const quota = useQuota();
  if (!quota) {
    return null;
  }
  const { used, limit } = quota.ai_requests;
  const shown = Math.min(used, limit);
  const percent = limit > 0 ? Math.round((shown / limit) * 100) : 100;
  const label = t('quota.aiRequestsToday', { used: shown, limit });

  return (
    <Tooltip id={tooltipId} content={t('quota.resetsAtMidnight')} placement="bottom" align="end">
      <div
        tabIndex={0}
        aria-describedby={tooltipId}
        data-testid="ai-quota-badge"
        className="w-52 rounded-2xl border border-border bg-surface px-3 py-2 shadow-soft"
      >
        <p className="text-xs font-medium text-fg">{label}</p>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={shown}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            data-tone={quotaTone(used, limit)}
            className={`h-full rounded-full transition-[width] duration-500 ${BAR_CLASSES[quotaTone(used, limit)]}`}
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      </div>
    </Tooltip>
  );
}
