/**
 * Score-band logic for the quiz results screen (Phase 6): which band a percentage falls into,
 * and whether it's strong enough to celebrate. Kept free of React/recharts/canvas-confetti so
 * it's trivial to unit test on its own; `QuizResultsView` pairs each band with its i18n keys
 * and lucide icon.
 */

export type ScoreBand = 'excellent' | 'great' | 'onTrack' | 'gettingThere' | 'newMaterial';

/** The score bands, in order, each with its lower bound (inclusive) as a 0-100 percentage. */
export const SCORE_BANDS: { band: ScoreBand; min: number }[] = [
  { band: 'excellent', min: 90 },
  { band: 'great', min: 75 },
  { band: 'onTrack', min: 60 },
  { band: 'gettingThere', min: 40 },
  { band: 'newMaterial', min: 0 },
];

/** Which band a 0-100 percentage falls into (clamped, so NaN/out-of-range never throws). */
export function getScoreBand(percentage: number): ScoreBand {
  const clamped = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
  const match = SCORE_BANDS.find((entry) => clamped >= entry.min);
  return match?.band ?? 'newMaterial';
}

/** The celebration (confetti + avatar "celebrating" mood) threshold: the "great" band and up. */
export const CELEBRATION_THRESHOLD = 75;

export function shouldCelebrate(percentage: number, prefersReducedMotion: boolean): boolean {
  return percentage >= CELEBRATION_THRESHOLD && !prefersReducedMotion;
}
