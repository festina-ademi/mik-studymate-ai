import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuizScoreDonut } from './QuizScoreDonut';

describe('QuizScoreDonut', () => {
  it('shows the percentage in the center and labels the chart with the same ratio', () => {
    render(<QuizScoreDonut percentage={75} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '75% correct' })).toBeInTheDocument();
  });

  it('reflects a different ratio in both the center label and the chart aria-label', () => {
    render(<QuizScoreDonut percentage={40} />);

    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '40% correct' })).toBeInTheDocument();
  });

  it('clamps and rounds an out-of-range or fractional percentage', () => {
    render(<QuizScoreDonut percentage={123.6} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
