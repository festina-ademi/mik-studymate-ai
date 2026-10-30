import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../Badge';
import { Card } from '../Card';
import { ErrorState } from '../ErrorState';
import { SegmentedControl } from '../SegmentedControl';
import { Skeleton } from '../Skeleton';
import {
  getAdminStatistics,
  type GroupComparison,
  type StudyStatisticsReport,
} from '../../lib/api';
import { describeError } from '../../lib/errors';

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function effectSizeLabel(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude < 0.2) return 'negligible';
  if (magnitude < 0.5) return 'small';
  if (magnitude < 0.8) return 'medium';
  return 'large';
}

function OutcomeSection({ title, comparison }: { title: string; comparison: GroupComparison }) {
  const { t } = useTranslation();
  const chosenPValue =
    comparison.recommended_test === 'student_t'
      ? comparison.student_t?.p_value
      : comparison.recommended_test === 'welch_t'
        ? comparison.welch_t?.p_value
        : comparison.recommended_test === 'mann_whitney'
          ? comparison.mann_whitney?.p_value
          : null;
  const significant = chosenPValue !== null && chosenPValue !== undefined && chosenPValue < 0.05;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface-muted p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        <Badge className={significant ? 'border-success/30 bg-success/10 text-success' : ''}>
          {significant ? t('admin.statsSignificant') : t('admin.statsNotSignificant')}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            [
              'experimental',
              comparison.descriptive_experimental,
              comparison.normality_experimental,
            ],
            ['control', comparison.descriptive_control, comparison.normality_control],
          ] as const
        ).map(([group, descriptive, normality]) => (
          <div key={group} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">
              {t(`admin.group_${group}`)}
            </p>
            <dl className="mt-2 space-y-1 text-xs text-fg">
              <div className="flex justify-between">
                <dt>{t('admin.statsN')}</dt>
                <dd>{descriptive.n}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.statsMean')}</dt>
                <dd>{formatPercent(descriptive.mean)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.statsSd')}</dt>
                <dd>{formatNumber(descriptive.sd, 3)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.statsMedian')}</dt>
                <dd>{formatPercent(descriptive.median)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('admin.statsNormal')}</dt>
                <dd>
                  {normality.is_normal === null
                    ? t('admin.statsNotComputable')
                    : normality.is_normal
                      ? t('admin.statsYes')
                      : t('admin.statsNo')}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <p className="text-sm leading-6 text-fg">
        {t('admin.statsRecommendation', {
          test: t(`admin.testName_${comparison.recommended_test}`),
        })}
      </p>

      <div className="grid gap-3 text-xs text-fg-muted sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="font-semibold text-fg">{t('admin.testName_student_t')}</p>
          <p>p = {formatNumber(comparison.student_t?.p_value ?? null, 4)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="font-semibold text-fg">{t('admin.testName_welch_t')}</p>
          <p>p = {formatNumber(comparison.welch_t?.p_value ?? null, 4)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="font-semibold text-fg">{t('admin.testName_mann_whitney')}</p>
          <p>p = {formatNumber(comparison.mann_whitney?.p_value ?? null, 4)}</p>
        </div>
      </div>

      {comparison.cohens_d ? (
        <p className="text-sm text-fg">
          {t('admin.statsEffectSize', {
            value: formatNumber(comparison.cohens_d.value),
            low: formatNumber(comparison.cohens_d.ci_low),
            high: formatNumber(comparison.cohens_d.ci_high),
            label: t(`admin.effect_${effectSizeLabel(comparison.cohens_d.value)}`),
          })}
        </p>
      ) : null}
    </div>
  );
}

interface AdminStatisticsPanelProps {
  refreshToken: number;
}

/** The statistics report, in plain language alongside the numbers (PROJECT_SPEC.md section 9). */
export function AdminStatisticsPanel({ refreshToken }: AdminStatisticsPanelProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<StudyStatisticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'all' | 'en' | 'sq'>('all');

  useEffect(() => {
    void getAdminStatistics()
      .then(setReport)
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  }, [refreshToken, t]);

  if (error) {
    return <ErrorState title={t('workspace.errorTitle')} description={error} />;
  }
  if (!report) {
    return (
      <Card className="p-6">
        <Skeleton lines={8} />
      </Card>
    );
  }

  const comparisons =
    language === 'all'
      ? {
          immediate: report.immediate_score,
          retention: report.retention_score,
          change: report.retention_change,
        }
      : {
          immediate: report.by_language[language]?.immediate_score ?? report.immediate_score,
          retention: report.by_language[language]?.retention_score ?? report.retention_score,
          change: report.by_language[language]?.retention_change ?? report.retention_change,
        };

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">{t('admin.statsTitle')}</h2>
        <SegmentedControl
          label={t('admin.statsLanguageFilter')}
          value={language}
          onChange={setLanguage}
          options={[
            {
              value: 'all',
              label: t('admin.statsAllLanguages'),
              ariaLabel: t('admin.statsAllLanguages'),
            },
            { value: 'en', label: 'English', ariaLabel: 'English' },
            { value: 'sq', label: 'Shqip', ariaLabel: 'Shqip' },
          ]}
        />
      </div>
      <OutcomeSection title={t('admin.chartImmediate')} comparison={comparisons.immediate} />
      <OutcomeSection title={t('admin.chartRetention')} comparison={comparisons.retention} />
      <OutcomeSection title={t('admin.statsRetentionChange')} comparison={comparisons.change} />
    </Card>
  );
}
