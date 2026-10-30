import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import { StudyAvatar, type AvatarMood } from './StudyAvatar';

const MOODS: AvatarMood[] = ['speaking', 'listening', 'thinking', 'celebrating'];

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

describe('StudyAvatar', () => {
  it.each(MOODS)('renders the %s mood with an accessible title', (mood) => {
    const { container } = render(<StudyAvatar mood={mood} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-mood', mood);
    expect(
      screen.getByRole('img', {
        name: `A friendly virtual learning companion, currently ${mood}`,
      }),
    ).toBe(svg);
    for (const part of ['head', 'hair', 'eyes', 'eyebrows', 'nose', 'mouth', 'neck', 'torso']) {
      expect(container.querySelector(`[data-avatar-part="${part}"]`)).not.toBeNull();
    }
  });

  it('defaults to the listening mood at 320px', () => {
    const { container } = render(<StudyAvatar />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('data-mood', 'listening');
    expect(svg).toHaveAttribute('width', '320');
    expect(svg).toHaveAttribute('height', '320');
    expect(svg).toHaveAttribute('viewBox', '0 0 240 240');
  });

  it('scales with the size prop and forwards className', () => {
    const { container } = render(<StudyAvatar size={120} className="custom" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '120');
    expect(svg).toHaveClass('custom');
  });

  it('updates the title when the mood changes and follows the UI language', async () => {
    const { rerender } = render(<StudyAvatar mood="listening" />);
    rerender(<StudyAvatar mood="thinking" />);
    expect(
      screen.getByRole('img', {
        name: 'A friendly virtual learning companion, currently thinking',
      }),
    ).toBeInTheDocument();

    await i18n.changeLanguage('sq');
    expect(
      await screen.findByRole('img', {
        name: 'Një shok mësimi virtual dhe miqësor, aktualisht duke menduar',
      }),
    ).toBeInTheDocument();
  });

  it('freezes all motion when paused', () => {
    stubReducedMotion(false);
    const running = render(<StudyAvatar mood="speaking" />);
    expect(running.container.querySelector('svg')).toHaveAttribute('data-frozen', 'false');
    running.unmount();

    const { container } = render(<StudyAvatar mood="speaking" paused />);
    expect(container.querySelector('svg')).toHaveAttribute('data-frozen', 'true');
  });

  it('freezes on the static mood pose under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<StudyAvatar mood="celebrating" />);

    expect(container.querySelector('svg')).toHaveAttribute('data-frozen', 'true');
    // The pose is still complete: the star is there and the eyes are the happy squint.
    expect(container.querySelector('[data-avatar-part="star"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-avatar-part="squint"]')).toHaveLength(2);
  });

  it('shows the raised hand only in the thinking mood', () => {
    for (const mood of MOODS) {
      const { container, unmount } = render(<StudyAvatar mood={mood} />);
      const raised = container.querySelector('[data-avatar-part="raised-hand"]');
      if (mood === 'thinking') {
        expect(raised).not.toBeNull();
      } else {
        expect(raised).toBeNull();
      }
      unmount();
    }
  });

  it('renders the star only while celebrating, and removes it once the mood changes', async () => {
    for (const mood of MOODS) {
      const { container, unmount } = render(<StudyAvatar mood={mood} />);
      const star = container.querySelector('[data-avatar-part="star"]');
      if (mood === 'celebrating') {
        expect(star).not.toBeNull();
      } else {
        expect(star).toBeNull();
      }
      unmount();
    }

    const { container, rerender } = render(<StudyAvatar mood="celebrating" />);
    expect(container.querySelector('[data-avatar-part="star"]')).not.toBeNull();
    rerender(<StudyAvatar mood="listening" />);
    await waitFor(() => {
      expect(container.querySelector('[data-avatar-part="star"]')).toBeNull();
    });
  });

  it('uses the happy squint instead of open eyes while celebrating', () => {
    const { container } = render(<StudyAvatar mood="celebrating" />);

    expect(container.querySelectorAll('[data-avatar-part="squint"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-avatar-part="pupil"]')).toHaveLength(0);
  });

  it('colors every part from design tokens, never a hardcoded hex value', () => {
    const { container } = render(<StudyAvatar mood="thinking" />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(container.innerHTML).toContain('var(--avatar-skin)');
    expect(container.innerHTML).toContain('var(--secondary)');
  });
});
