import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudiencePhoto } from './AudiencePhoto';

const ALT = 'A student at a desk with a laptop and colorful sticky notes';

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

describe('AudiencePhoto', () => {
  it('renders lazily with alt text and its intrinsic size, to reserve layout space', () => {
    stubReducedMotion(false);
    render(<AudiencePhoto alt={ALT} />);

    const photo = screen.getByRole('img', { name: ALT });
    expect(photo).toHaveAttribute('src', '/images/audience-student.jpg');
    expect(photo).toHaveAttribute('width', '600');
    expect(photo).toHaveAttribute('height', '862');
    expect(photo).toHaveAttribute('loading', 'lazy');
  });

  it('renders without the scroll-linked parallax style under reduced motion', () => {
    stubReducedMotion(true);
    render(<AudiencePhoto alt={ALT} />);

    // Under reduced motion the component passes `style={undefined}`, so framer-motion never
    // sets a `transform` for the (disabled) scroll-linked y value.
    expect(screen.getByRole('img', { name: ALT }).style.transform).toBe('');
  });
});
