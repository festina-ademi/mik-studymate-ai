import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MasteryPanel } from './MasteryPanel';
import type { MasteryOverviewEntry } from '../../lib/api';

const ENTRIES: MasteryOverviewEntry[] = [
  { topic: 'Recursion', mastery: 0.9, level: 'strong', attempts: 4, correct: 4 },
  { topic: 'Sorting', mastery: 0.6, level: 'developing', attempts: 3, correct: 2 },
  { topic: 'Big-O', mastery: 0.2, level: 'weak', attempts: 3, correct: 0 },
];

describe('MasteryPanel', () => {
  it('shows a loading skeleton instead of content while loading', () => {
    render(<MasteryPanel entries={[]} isLoading />);

    expect(screen.queryByTestId('mastery-panel')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there is no mastery data yet', () => {
    render(<MasteryPanel entries={[]} />);

    expect(
      screen.getByText('Answer a few quiz questions to start building a mastery picture.'),
    ).toBeInTheDocument();
  });

  it('renders one row per topic with its percentage and weak/developing/strong label', () => {
    render(<MasteryPanel entries={ENTRIES} />);

    expect(screen.getByText('Recursion')).toBeInTheDocument();
    expect(screen.getByText('Sorting')).toBeInTheDocument();
    expect(screen.getByText('Big-O')).toBeInTheDocument();

    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Developing')).toBeInTheDocument();
    expect(screen.getByText('Weak')).toBeInTheDocument();

    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });
});
