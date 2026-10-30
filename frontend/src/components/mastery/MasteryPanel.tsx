import { useTranslation } from 'react-i18next';

import { ProgressBar, type ProgressBarTone } from '../ProgressBar';
import { Skeleton } from '../Skeleton';
import type { MasteryLevel, MasteryOverviewEntry } from '../../lib/api';

const TONE_BY_LEVEL: Record<MasteryLevel, ProgressBarTone> = {
  weak: 'error',
  developing: 'warning',
  strong: 'success',
};

const BADGE_CLASSES_BY_LEVEL: Record<MasteryLevel, string> = {
  weak: 'border-error/30 bg-error/10 text-error',
  developing: 'border-warning/30 bg-warning/10 text-warning',
  strong: 'border-success/30 bg-success/10 text-success',
};

interface MasteryPanelProps {
  entries: MasteryOverviewEntry[];
  isLoading?: boolean;
}

/** Per-topic mastery bars, color-coded weak/developing/strong. */
export function MasteryPanel({ entries, isLoading = false }: MasteryPanelProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <Skeleton lines={3} />;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-fg-muted">{t('workspace.masteryEmpty')}</p>;
  }

  return (
    <div className="space-y-3" data-testid="mastery-panel">
      <p className="text-sm font-medium text-fg-muted">{t('workspace.masteryTitle')}</p>
      {entries.map((entry) => (
        <div key={entry.topic} className="rounded-2xl border border-border bg-surface-muted p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm text-fg">
            <span>{entry.topic}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${BADGE_CLASSES_BY_LEVEL[entry.level]}`}
            >
              {t(`workspace.masteryLevel_${entry.level}`)}
            </span>
          </div>
          <ProgressBar
            value={entry.mastery * 100}
            tone={TONE_BY_LEVEL[entry.level]}
            label={`${String(Math.round(entry.mastery * 100))}%`}
          />
        </div>
      ))}
    </div>
  );
}
