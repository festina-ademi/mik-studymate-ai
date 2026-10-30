import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { writeLevelPreference } from '../hooks/useLevel';
import type { DocumentRecord } from '../lib/api';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import { renderApp, sseJsonResponse } from '../test/utils';

const DOCUMENT: DocumentRecord = {
  id: 'doc-1',
  filename: 'lecture.pdf',
  content_hash: 'hash-1',
  content_type: 'lecture',
  source_format: 'pdf',
  detected_language: 'en',
  size_bytes: 100,
  page_count: 1,
};

function seedDocument(): void {
  writeJsonStorage(STORAGE_KEYS.recentDocuments, [
    {
      id: DOCUMENT.id,
      filename: DOCUMENT.filename,
      content_type: DOCUMENT.content_type,
      source_format: DOCUMENT.source_format,
      detected_language: DOCUMENT.detected_language,
      updatedAt: new Date().toISOString(),
    },
  ]);
  writeStorage(STORAGE_KEYS.currentDocumentId, DOCUMENT.id);
  writeJsonStorage(STORAGE_KEYS.documentState, { document: DOCUMENT });
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Stub the API and record the level each explanation request was made for. */
function stubFetch(explanationLevels: string[]): void {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/explanation')) {
      const body = typeof init?.body === 'string' ? init.body : '';
      explanationLevels.push(/beginner|intermediate|advanced/.exec(`${url} ${body}`)?.[0] ?? '?');
    }
    if (url.includes('/summary') || url.includes('/explanation')) {
      return Promise.resolve(
        sseJsonResponse({
          overview: 'Overview',
          sections: [],
          key_concepts: [],
          takeaways: [],
          recommendations: [],
          walkthrough: [],
          confidence_notes: [],
          metadata: {
            document_id: DOCUMENT.id,
            content_type: 'lecture',
            task: 'explanation',
            level: 'beginner',
            language: 'en',
            chunks_used: 1,
            prompt_version: '8',
            model: 'mock',
            cached: false,
          },
        }),
      );
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('workspace level toggle', () => {
  it('lives in the workspace header row and drives the explanation level', async () => {
    seedDocument();
    writeLevelPreference('beginner');
    const levels: string[] = [];
    stubFetch(levels);
    const user = userEvent.setup();
    renderApp('/workspace');

    const toggle = await screen.findByRole('group', { name: 'Level' });
    expect(within(screen.getByRole('banner')).queryByRole('group', { name: 'Level' })).toBeNull();
    expect(within(toggle).getByRole('button', { name: 'Beginner' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Explanation' }));
    await waitFor(() => {
      expect(levels).toContain('beginner');
    });

    await user.click(within(toggle).getByRole('button', { name: 'Advanced' }));
    await waitFor(() => {
      expect(levels).toContain('advanced');
    });
    expect(window.localStorage.getItem(STORAGE_KEYS.level)).toBe('advanced');
  });

  it('explains the toggle in a tooltip on focus and dismisses it on Escape and blur', async () => {
    seedDocument();
    // Pinned explicitly: `useLevel`'s in-memory state is a module-level singleton that persists
    // across tests within a worker (clearing localStorage in `beforeEach` doesn't reset it).
    writeLevelPreference('intermediate');
    stubFetch([]);
    const user = userEvent.setup();
    renderApp('/workspace');

    const toggle = await screen.findByRole('group', { name: 'Level' });
    const tooltip = screen.getByRole('tooltip');
    expect(toggle).toHaveAttribute('aria-describedby', tooltip.id);
    expect(tooltip).toHaveTextContent('Change explanation level');
    expect(tooltip).toHaveTextContent(
      'Beginner: simple explanation with everyday examples. Uses basic vocabulary and defines terms.',
    );
    expect(tooltip).toHaveTextContent(
      'Intermediate: standard explanation with field terminology. Assumes basic familiarity.',
    );
    expect(tooltip).toHaveTextContent(
      'Advanced: technical explanation with professional vocabulary. Discusses nuance and theory.',
    );
    // The active level (intermediate, the default) is visually highlighted.
    expect(within(tooltip).getByText(/^Intermediate:/)).toHaveClass('text-primary');
    expect(within(tooltip).getByText(/^Beginner:/)).not.toHaveClass('text-primary');
    expect(tooltip).toHaveClass('invisible');

    const beginner = within(toggle).getByRole('button', { name: 'Beginner' });
    act(() => {
      beginner.focus();
    });
    expect(tooltip).toHaveClass('visible');

    await user.keyboard('{Escape}');
    expect(tooltip).toHaveClass('invisible');

    act(() => {
      beginner.blur();
      beginner.focus();
    });
    expect(tooltip).toHaveClass('visible');
    act(() => {
      beginner.blur();
    });
    expect(tooltip).toHaveClass('invisible');
  });

  it('shows the tooltip after a short hover delay', async () => {
    seedDocument();
    stubFetch([]);
    const user = userEvent.setup();
    renderApp('/workspace');

    const toggle = await screen.findByRole('group', { name: 'Level' });
    const tooltip = screen.getByRole('tooltip');
    await user.hover(toggle);
    expect(tooltip).toHaveClass('invisible');
    await waitFor(() => {
      expect(tooltip).toHaveClass('visible');
    });
    await user.unhover(toggle);
    expect(tooltip).toHaveClass('invisible');
  });
});
