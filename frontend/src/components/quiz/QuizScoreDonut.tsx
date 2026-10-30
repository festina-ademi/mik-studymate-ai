import { motion } from 'framer-motion';
import { Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';

import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

interface QuizScoreDonutProps {
  /** 0-100. */
  percentage: number;
}

/**
 * Correct-vs-incorrect donut with the percentage in the center (an absolutely-positioned
 * overlay, not a recharts label -- centering text inside a donut via recharts' own API is
 * fiddly and this is simpler and just as reliable). Colors are CSS custom properties, not
 * literal hex, so they follow the page's light/dark theme like everything else; SVG
 * presentation attributes have accepted `var()` in evergreen browsers for years.
 */
export function QuizScoreDonut({ percentage }: QuizScoreDonutProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  // `fill` directly on each datum (rather than the deprecated `Cell` component) is how recharts
  // has always colored individual Pie sectors; the default `Sector` shape reads it from here.
  const data = [
    { name: t('workspace.quizDonutCorrect'), value: clamped, fill: 'var(--primary)' },
    { name: t('workspace.quizDonutIncorrect'), value: 100 - clamped, fill: 'var(--error)' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.15 : 0.5 }}
      role="img"
      aria-label={t('workspace.quizDonutChartLabel', { percentage: clamped })}
      className="relative mx-auto size-40"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={!prefersReducedMotion}
            animationDuration={700}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold text-fg">{clamped}%</span>
      </div>
    </motion.div>
  );
}
