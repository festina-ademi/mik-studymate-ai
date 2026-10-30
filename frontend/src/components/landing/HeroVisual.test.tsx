import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeroVisual } from './HeroVisual';

const PROPS = {
  photoAlt: 'A student taking notes next to a laptop',
  summaryLabel: 'Summary',
  quizLabel: 'Quiz',
  explanationLabel: 'Explanation',
  tutorLabel: 'Chat',
};

/** Overrides `window.matchMedia` for the reduced-motion query only. */
function stubReducedMotion(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HeroVisual', () => {
  it('renders the photo with alt text and its intrinsic size, to reserve layout space', () => {
    stubReducedMotion(false);
    render(<HeroVisual {...PROPS} />);

    const photo = screen.getByRole('img', { name: PROPS.photoAlt });
    expect(photo).toHaveAttribute('src', '/images/hero-study.jpg');
    expect(photo).toHaveAttribute('width', '600');
    expect(photo).toHaveAttribute('height', '400');
    expect(photo).toHaveAttribute('loading', 'eager');
  });

  it('orbits the four feature pills around the photo by default', () => {
    stubReducedMotion(false);
    const { container } = render(<HeroVisual {...PROPS} />);

    // The rotating group carries the orbit-radius custom property; the static corner fallback
    // does not, so its presence is a reliable proxy for "orbit mode".
    expect(container.innerHTML).toContain('--orbit-r');
    for (const label of [
      PROPS.summaryLabel,
      PROPS.quizLabel,
      PROPS.explanationLabel,
      PROPS.tutorLabel,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('settles the pills into static corners under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<HeroVisual {...PROPS} />);

    expect(container.innerHTML).not.toContain('--orbit-r');
    expect(screen.getByText(PROPS.tutorLabel)).toBeInTheDocument();
  });

  it('hides the pill layer from assistive technology in both modes', () => {
    for (const reduced of [false, true]) {
      stubReducedMotion(reduced);
      const { unmount } = render(<HeroVisual {...PROPS} />);
      expect(screen.getByText(PROPS.summaryLabel).closest('[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});
