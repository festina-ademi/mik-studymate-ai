import type { MasteryLevel, MasteryOverviewEntry } from '../../lib/api';

export interface MasteryBarDatum {
  topic: string;
  percentage: number;
  level: MasteryLevel;
}

/**
 * The mastery bar chart's data preparation, kept as its own pure function (no recharts, no
 * React, and in its own module so Fast Refresh doesn't object to a non-component export living
 * alongside `QuizMasteryBarChart`) so the weakest-first ordering is trivial to unit test
 * without depending on recharts' own rendering -- jsdom has no real layout engine, which makes
 * asserting on recharts' actual painted SVG output unreliable in a test environment.
 */
export function sortMasteryWeakestFirst(entries: MasteryOverviewEntry[]): MasteryBarDatum[] {
  return [...entries]
    .sort((a, b) => a.mastery - b.mastery)
    .map((entry) => ({
      topic: entry.topic,
      percentage: Math.round(entry.mastery * 100),
      level: entry.level,
    }));
}
