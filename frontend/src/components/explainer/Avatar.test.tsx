import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar, type AvatarState } from './Avatar';

const EXPECTED_MOOD: Record<AvatarState, string> = {
  idle: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'celebrating',
  encouraging: 'listening',
};

describe('Avatar (Avatar tab face)', () => {
  it.each(Object.entries(EXPECTED_MOOD))(
    'maps the %s playback state to the %s mood',
    (state, mood) => {
      const { container } = render(<Avatar state={state as AvatarState} />);

      expect(container.querySelector('svg')).toHaveAttribute('data-mood', mood);
    },
  );

  it('freezes the avatar when paused and forwards className', () => {
    const { container } = render(<Avatar state="idle" paused className="h-52 w-52" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('data-frozen', 'true');
    expect(svg).toHaveClass('h-52', 'w-52');
  });
});
