import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { Card } from '../Card';
import { ErrorState } from '../ErrorState';
import { Skeleton } from '../Skeleton';
import { getAdminResults, type AdminParticipantResult } from '../../lib/api';
import { describeError } from '../../lib/errors';

const HISTOGRAM_BIN_COUNT = 5;
const EXPERIMENTAL_COLOR = 'var(--primary)';
const CONTROL_COLOR = 'var(--secondary)';

interface HistogramBin {
  bin: string;
  experimental: number;
  control: number;
}

function fraction(score: number | null, maxScore: number | null): number | null {
  if (score === null || maxScore === null || maxScore === 0) return null;
  return score / maxScore;
}

function computeHistogram(experimental: number[], control: number[]): HistogramBin[] {
  const bins: HistogramBin[] = Array.from({ length: HISTOGRAM_BIN_COUNT }, (_, index) => ({
    bin: `${String(Math.round((index / HISTOGRAM_BIN_COUNT) * 100))}–${String(
      Math.round(((index + 1) / HISTOGRAM_BIN_COUNT) * 100),
    )}%`,
    experimental: 0,
    control: 0,
  }));
  const place = (values: number[], key: 'experimental' | 'control'): void => {
    for (const value of values) {
      const clamped = Math.min(0.999999, Math.max(0, value));
      const index = Math.floor(clamped * HISTOGRAM_BIN_COUNT);
      const bin = bins[index];
      if (bin) bin[key] += 1;
    }
  };
  place(experimental, 'experimental');
  place(control, 'control');
  return bins;
}

function meanAndSd(values: number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return { mean, sd: Math.sqrt(variance) };
}

interface AdminResultsChartsProps {
  /** Bumped by the parent whenever materials/tests/participants might have changed. */
  refreshToken: number;
}

/**
 * Score distribution charts for the admin dashboard: a histogram (score buckets per group)
 * and a mean +/- SD comparison. Recharts has no built-in box-and-whisker chart, so a jittered
 * scatter of every participant's score stands in for a boxplot, showing the same spread and
 * any outliers directly.
 */
export function AdminResultsCharts({ refreshToken }: AdminResultsChartsProps) {
  const { t } = useTranslation();
  const [results, setResults] = useState<AdminParticipantResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAdminResults()
      .then(setResults)
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  }, [refreshToken, t]);

  const { immediateHistogram, meanSdRows, scatterRows } = useMemo(() => {
    const rows = results ?? [];
    const experimentalImmediate = rows
      .filter((row) => row.group === 'experimental')
      .map((row) => fraction(row.immediate_score, row.immediate_max_score))
      .filter((value): value is number => value !== null);
    const controlImmediate = rows
      .filter((row) => row.group === 'control')
      .map((row) => fraction(row.immediate_score, row.immediate_max_score))
      .filter((value): value is number => value !== null);
    const experimentalRetention = rows
      .filter((row) => row.group === 'experimental')
      .map((row) => fraction(row.retention_score, row.retention_max_score))
      .filter((value): value is number => value !== null);
    const controlRetention = rows
      .filter((row) => row.group === 'control')
      .map((row) => fraction(row.retention_score, row.retention_max_score))
      .filter((value): value is number => value !== null);

    const expImmediateStats = meanAndSd(experimentalImmediate);
    const ctrlImmediateStats = meanAndSd(controlImmediate);
    const expRetentionStats = meanAndSd(experimentalRetention);
    const ctrlRetentionStats = meanAndSd(controlRetention);

    return {
      immediateHistogram: computeHistogram(experimentalImmediate, controlImmediate),
      meanSdRows: [
        {
          name: t('admin.chartImmediate'),
          experimental: expImmediateStats.mean,
          experimentalSd: expImmediateStats.sd,
          control: ctrlImmediateStats.mean,
          controlSd: ctrlImmediateStats.sd,
        },
        {
          name: t('admin.chartRetention'),
          experimental: expRetentionStats.mean,
          experimentalSd: expRetentionStats.sd,
          control: ctrlRetentionStats.mean,
          controlSd: ctrlRetentionStats.sd,
        },
      ],
      scatterRows: {
        experimental: experimentalImmediate.map((value, index) => ({ x: index, y: value })),
        control: controlImmediate.map((value, index) => ({ x: index, y: value })),
      },
    };
  }, [results, t]);

  if (error) {
    return <ErrorState title={t('workspace.errorTitle')} description={error} />;
  }
  if (!results) {
    return (
      <Card className="p-6">
        <Skeleton lines={6} />
      </Card>
    );
  }

  return (
    <Card className="space-y-8 p-6">
      <h2 className="text-lg font-semibold text-fg">{t('admin.chartsTitle')}</h2>

      <div>
        <p className="mb-2 text-sm font-medium text-fg-muted">{t('admin.chartHistogramTitle')}</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={immediateHistogram}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="bin" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="experimental"
              name={t('admin.group_experimental')}
              fill={EXPERIMENTAL_COLOR}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="control"
              name={t('admin.group_control')}
              fill={CONTROL_COLOR}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-fg-muted">{t('admin.chartMeanSdTitle')}</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={meanSdRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="experimental"
              name={t('admin.group_experimental')}
              fill={EXPERIMENTAL_COLOR}
            >
              <ErrorBar
                dataKey="experimentalSd"
                width={4}
                strokeWidth={1.5}
                stroke="var(--fg-muted)"
              />
            </Bar>
            <Bar dataKey="control" name={t('admin.group_control')} fill={CONTROL_COLOR}>
              <ErrorBar dataKey="controlSd" width={4} strokeWidth={1.5} stroke="var(--fg-muted)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-fg-muted">{t('admin.chartScatterTitle')}</p>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="x" name={t('admin.chartParticipantAxis')} hide />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 1]}
              name={t('admin.chartImmediate')}
              tick={{ fontSize: 12 }}
            />
            <ZAxis range={[60, 60]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            <Scatter
              name={t('admin.group_experimental')}
              data={scatterRows.experimental}
              fill={EXPERIMENTAL_COLOR}
            />
            <Scatter
              name={t('admin.group_control')}
              data={scatterRows.control}
              fill={CONTROL_COLOR}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
