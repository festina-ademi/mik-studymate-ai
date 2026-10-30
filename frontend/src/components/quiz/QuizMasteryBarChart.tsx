import { Bar, BarChart, LabelList, Rectangle, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { BarShapeProps, RenderableText } from 'recharts';
import { useTranslation } from 'react-i18next';

import type { MasteryLevel, MasteryOverviewEntry } from '../../lib/api';
import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';
import { sortMasteryWeakestFirst } from './masteryBarData';

// Per the Phase 6 spec: amber for strong, amber-soft for developing, soft muted red for weak --
// a deliberate, ticket-specified palette, not the pre-existing success/warning/error one
// `MasteryPanel` still uses elsewhere on this same page (kept as-is; see its own file).
const FILL_BY_LEVEL: Record<MasteryLevel, string> = {
  strong: 'var(--primary)',
  developing: 'var(--primary-soft)',
  weak: 'var(--error)',
};

const ROW_HEIGHT = 44;

interface QuizMasteryBarChartProps {
  entries: MasteryOverviewEntry[];
}

/** Horizontal per-topic mastery bars, weakest first, so the learner sees what to focus on. */
export function QuizMasteryBarChart({ entries }: QuizMasteryBarChartProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();

  if (entries.length === 0) {
    return null;
  }

  const data = sortMasteryWeakestFirst(entries);

  return (
    <div
      role="img"
      aria-label={t('workspace.quizMasteryChartLabel')}
      style={{ height: data.length * ROW_HEIGHT + 16 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="topic"
            width={128}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--fg-muted)', fontSize: 12 }}
          />
          <Bar
            dataKey="percentage"
            isAnimationActive={!prefersReducedMotion}
            animationDuration={600}
            // `shape` (not the deprecated `Cell`) is how recharts v3 wants per-bar styling: a
            // custom renderer reading the original datum back off `payload`.
            shape={(props: BarShapeProps) => {
              const level = (props.payload as { level: MasteryLevel }).level;
              return <Rectangle {...props} radius={[0, 8, 8, 0]} fill={FILL_BY_LEVEL[level]} />;
            }}
          >
            <LabelList
              dataKey="percentage"
              position="right"
              formatter={(value: RenderableText) => `${String(value ?? '')}%`}
              fill="var(--fg)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
