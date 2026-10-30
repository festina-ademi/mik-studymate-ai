import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuizMasteryBarChart } from './QuizMasteryBarChart';
import { sortMasteryWeakestFirst } from './masteryBarData';
import type { MasteryOverviewEntry } from '../../lib/api';

const ENTRIES: MasteryOverviewEntry[] = [
  { topic: 'Strong topic', mastery: 0.9, level: 'strong', attempts: 4, correct: 4 },
  { topic: 'Weakest topic', mastery: 0.1, level: 'weak', attempts: 3, correct: 0 },
  { topic: 'Middle topic', mastery: 0.5, level: 'developing', attempts: 2, correct: 1 },
];

describe('sortMasteryWeakestFirst', () => {
  it('orders topics by ascending mastery, regardless of input order', () => {
    const sorted = sortMasteryWeakestFirst(ENTRIES);

    expect(sorted.map((entry) => entry.topic)).toEqual([
      'Weakest topic',
      'Middle topic',
      'Strong topic',
    ]);
  });

  it('converts mastery (0-1) to a rounded 0-100 percentage and keeps the level', () => {
    const [weakest] = sortMasteryWeakestFirst(ENTRIES);

    expect(weakest).toEqual({ topic: 'Weakest topic', percentage: 10, level: 'weak' });
  });

  it('returns an empty array for no entries, without throwing', () => {
    expect(sortMasteryWeakestFirst([])).toEqual([]);
  });
});

describe('QuizMasteryBarChart', () => {
  it('renders the chart region when there is at least one topic', () => {
    render(<QuizMasteryBarChart entries={ENTRIES} />);

    expect(screen.getByRole('img', { name: 'Topic mastery, weakest first' })).toBeInTheDocument();
  });

  it('renders nothing when there are no mastery entries yet', () => {
    const { container } = render(<QuizMasteryBarChart entries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
