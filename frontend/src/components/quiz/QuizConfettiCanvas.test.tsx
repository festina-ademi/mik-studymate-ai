import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuizConfettiCanvas } from './QuizConfettiCanvas';

interface FireOptions {
  colors: string[];
}
const fireMock = vi
  .fn<(options: FireOptions) => Promise<undefined>>()
  .mockReturnValue(Promise.resolve(undefined));
const resetMock = vi.fn();
const fireWithReset = Object.assign(fireMock, { reset: resetMock });
const createMock = vi.fn((): typeof fireWithReset => fireWithReset);
// Recorded separately from `createMock`'s own call args, so the mock's signature doesn't need
// to carry an otherwise-unused parameter just to satisfy the test's assertion on it.
let lastCanvasArg: HTMLCanvasElement | undefined;

vi.mock('canvas-confetti', () => ({
  default: {
    create: (canvas?: HTMLCanvasElement): typeof fireWithReset => {
      lastCanvasArg = canvas;
      return createMock();
    },
  },
}));

let reducedMotion = false;
vi.mock('../../hooks/useReducedMotion', () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

describe('QuizConfettiCanvas', () => {
  afterEach(() => {
    reducedMotion = false;
    lastCanvasArg = undefined;
    createMock.mockClear();
    fireMock.mockClear();
    resetMock.mockClear();
  });

  it('fires confetti, scoped to its own canvas, when active and motion is not reduced', () => {
    render(<QuizConfettiCanvas active />);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(lastCanvasArg).toBeInstanceOf(HTMLCanvasElement);
    expect(fireMock).toHaveBeenCalled();
    // Warm palette only -- never the library's rainbow default.
    const [options] = fireMock.mock.calls[0] ?? [];
    expect(options?.colors).toEqual(['#9c6325', '#f5b55c', '#f9ce81', '#f5e3c8', '#7a4318']);
  });

  it('does not fire when inactive (score below the celebration threshold)', () => {
    render(<QuizConfettiCanvas active={false} />);

    expect(createMock).not.toHaveBeenCalled();
    expect(fireMock).not.toHaveBeenCalled();
  });

  it('does not fire under prefers-reduced-motion, even when active', () => {
    reducedMotion = true;
    render(<QuizConfettiCanvas active />);

    expect(createMock).not.toHaveBeenCalled();
    expect(fireMock).not.toHaveBeenCalled();
  });
});
