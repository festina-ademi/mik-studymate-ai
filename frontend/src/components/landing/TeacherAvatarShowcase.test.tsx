import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeacherAvatarShowcase } from './TeacherAvatarShowcase';

const PHRASES = ['First phrase', 'Second phrase', 'Third phrase', 'Fourth phrase'];

let reducedMotion = false;
vi.mock('../../hooks/useReducedMotion', () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

describe('TeacherAvatarShowcase', () => {
  afterEach(() => {
    reducedMotion = false;
  });

  it('renders the avatar and the first phrase', () => {
    render(<TeacherAvatarShowcase phrases={PHRASES} />);

    expect(
      screen.getByRole('img', {
        name: 'A friendly virtual learning companion, currently speaking',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('First phrase')).toBeInTheDocument();
  });

  it('cycles through every phrase over time, looping back to the start', async () => {
    // `AnimatePresence mode="wait"` fades the outgoing phrase out (300ms) before mounting the
    // next one and fading it in (300ms): a ~600ms round trip per switch. The interval must clear
    // that, or a new tick fires mid-transition and the rotation can never visibly catch up.
    const intervalMs = 700;
    render(<TeacherAvatarShowcase phrases={PHRASES} intervalMs={intervalMs} />);
    expect(screen.getByText('First phrase')).toBeInTheDocument();

    for (const expected of ['Second phrase', 'Third phrase', 'Fourth phrase', 'First phrase']) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs + 100));
      expect(await screen.findByText(expected)).toBeInTheDocument();
    }
  });

  it('shows only the first phrase, statically, under prefers-reduced-motion', async () => {
    reducedMotion = true;
    render(<TeacherAvatarShowcase phrases={PHRASES} intervalMs={20} />);

    expect(screen.getByText('First phrase')).toBeInTheDocument();
    // Give it a few intervals' worth of time; it must never advance.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByText('First phrase')).toBeInTheDocument();
    expect(screen.queryByText('Second phrase')).not.toBeInTheDocument();
  });
});
