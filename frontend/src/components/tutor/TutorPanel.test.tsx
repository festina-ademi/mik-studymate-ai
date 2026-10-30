import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TutorPanel } from './TutorPanel';

function stubEmptyHistoryFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json([]))),
  );
}

describe('TutorPanel', () => {
  it('uses a tall min/max height band so the panel feels proportional, not cramped', async () => {
    stubEmptyHistoryFetch();
    const { container } = render(
      <TutorPanel
        documentId="doc-1"
        contentType="lecture"
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
      />,
    );

    await screen.findByPlaceholderText('Ask about a concept, idea, or example from this material…');

    const root = container.firstElementChild;
    expect(root).toHaveClass('min-h-[65vh]');
    expect(root).toHaveClass('max-h-[75vh]');
    expect(root).toHaveClass('sm:min-h-[75vh]');
    expect(root).toHaveClass('sm:max-h-[85vh]');
  });

  it('keeps the input box visible regardless of message count (pinned below the scrolling list)', async () => {
    stubEmptyHistoryFetch();
    render(
      <TutorPanel
        documentId="doc-1"
        contentType="lecture"
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
      />,
    );

    const input = await screen.findByPlaceholderText(
      'Ask about a concept, idea, or example from this material…',
    );
    expect(input).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeVisible();
  });
});
