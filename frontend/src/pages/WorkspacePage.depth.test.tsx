import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { writeExplanationDepthPreference } from '../hooks/useExplanationDepth';
import { writeLevelPreference } from '../hooks/useLevel';
import type { ChunkRecord, DocumentRecord } from '../lib/api';
import { STORAGE_KEYS, writeJsonStorage, writeStorage } from '../lib/storage';
import { renderApp, sseJsonResponse } from '../test/utils';

const CODE_DOCUMENT: DocumentRecord = {
  id: 'code-1',
  filename: 'password.py',
  content_hash: 'hash-code',
  content_type: 'code',
  source_format: 'code',
  detected_language: 'en',
  size_bytes: 100,
  page_count: null,
};

const LECTURE_DOCUMENT: DocumentRecord = {
  ...CODE_DOCUMENT,
  id: 'lecture-1',
  filename: 'lecture.pdf',
  content_type: 'lecture',
  source_format: 'pdf',
  page_count: 1,
};

function codeChunk(lineCount: number): ChunkRecord {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `x${String(index)} = ${String(index)}`,
  );
  return {
    text: lines.join('\n'),
    heading: 'module',
    page_start: null,
    page_end: null,
    line_start: 1,
    line_end: lineCount,
  };
}

function seed(document: DocumentRecord, chunks: ChunkRecord[]): void {
  writeJsonStorage(STORAGE_KEYS.recentDocuments, [
    {
      id: document.id,
      filename: document.filename,
      content_type: document.content_type,
      source_format: document.source_format,
      detected_language: document.detected_language,
      updatedAt: new Date().toISOString(),
    },
  ]);
  writeStorage(STORAGE_KEYS.currentDocumentId, document.id);
  writeJsonStorage(STORAGE_KEYS.documentState, { document });
  writeJsonStorage(STORAGE_KEYS.chunksState, chunks);
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface Requests {
  summary: number;
  explanationDepths: (string | undefined)[];
}

/** Stub the API, recording each summary request and each explanation request's depth. */
function stubApi(): Requests {
  const requests: Requests = { summary: 0, explanationDepths: [] };
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (url.includes('/summary')) {
      requests.summary += 1;
    }
    if (url.includes('/explanation')) {
      const depth =
        typeof body === 'object' && body !== null && 'depth' in body ? body.depth : undefined;
      requests.explanationDepths.push(typeof depth === 'string' ? depth : undefined);
    }
    if (url.includes('/summary') || url.includes('/explanation')) {
      return Promise.resolve(
        sseJsonResponse({
          overview: 'Overview',
          sections: [{ title: 'check (lines 1-3)', content: 'Explained.', references: [] }],
          key_concepts: [],
          takeaways: [],
          confidence_notes: [],
          metadata: {
            document_id: CODE_DOCUMENT.id,
            content_type: 'code',
            task: 'explanation',
            level: 'intermediate',
            language: 'en',
            chunks_used: 1,
            prompt_version: '22',
            model: 'mock',
            cached: false,
          },
        }),
      );
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

function prepare(depth: 'line-by-line' | 'blocks'): void {
  // Both preferences are module-level singletons that outlive `localStorage.clear()`.
  writeLevelPreference('intermediate');
  writeExplanationDepthPreference(depth);
}

describe('workspace explanation depth toggle', () => {
  it('defaults to line-by-line and persists the choice', () => {
    window.localStorage.removeItem(STORAGE_KEYS.codeExplanationDepth);
    expect(STORAGE_KEYS.codeExplanationDepth).toBe('codeExplanationDepth');
    writeExplanationDepthPreference('blocks');
    expect(window.localStorage.getItem('codeExplanationDepth')).toBe('blocks');
  });

  it('is shown for code and re-fetches only the explanation with the new depth', async () => {
    prepare('line-by-line');
    seed(CODE_DOCUMENT, [codeChunk(24)]);
    const requests = stubApi();
    const user = userEvent.setup();
    renderApp('/workspace');

    const toggle = await screen.findByRole('group', { name: 'Explanation depth' });
    expect(within(toggle).getByRole('button', { name: 'Line-by-line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => {
      expect(requests.explanationDepths).toEqual(['line-by-line']);
    });
    expect(requests.summary).toBe(1);

    await user.click(within(toggle).getByRole('button', { name: 'Blocks' }));

    await waitFor(() => {
      expect(requests.explanationDepths).toEqual(['line-by-line', 'blocks']);
    });
    expect(requests.summary).toBe(1);
    expect(window.localStorage.getItem('codeExplanationDepth')).toBe('blocks');
    // 24 lines is within the limit: no alert.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is hidden for lectures, which never send a depth', async () => {
    prepare('line-by-line');
    seed(LECTURE_DOCUMENT, []);
    const requests = stubApi();
    renderApp('/workspace');

    await screen.findByRole('group', { name: 'Level' });
    await waitFor(() => {
      expect(requests.explanationDepths).toEqual([undefined]);
    });
    expect(screen.queryByRole('group', { name: 'Explanation depth' })).toBeNull();
  });
});

describe('long-code alert', () => {
  it('opens on the Explanation tab for long code in line-by-line and switches to blocks', async () => {
    prepare('line-by-line');
    seed(CODE_DOCUMENT, [codeChunk(45)]);
    const requests = stubApi();
    const user = userEvent.setup();
    renderApp('/workspace');

    await screen.findByRole('group', { name: 'Explanation depth' });
    await waitFor(() => {
      expect(requests.summary).toBe(1);
    });
    // No line-by-line explanation is requested for code over the limit.
    expect(requests.explanationDepths).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Explanation' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Oh! The code is a bit long' });
    expect(dialog).toHaveTextContent(
      'This code has 45 lines. Line-by-line explanation works best for code up to 30 lines.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Switch to Blocks' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(requests.explanationDepths).toEqual(['blocks']);
    });
    expect(
      within(screen.getByRole('group', { name: 'Explanation depth' })).getByRole('button', {
        name: 'Blocks',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens right away when line-by-line is picked, and dismissing falls back to blocks', async () => {
    prepare('blocks');
    seed(CODE_DOCUMENT, [codeChunk(60)]);
    const requests = stubApi();
    const user = userEvent.setup();
    renderApp('/workspace');

    const toggle = await screen.findByRole('group', { name: 'Explanation depth' });
    await waitFor(() => {
      expect(requests.explanationDepths).toEqual(['blocks']);
    });

    // Still on the Summary tab: picking line-by-line opens the alert immediately.
    await user.click(within(toggle).getByRole('button', { name: 'Line-by-line' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('This code has 60 lines.');

    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(within(toggle).getByRole('button', { name: 'Blocks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(window.localStorage.getItem('codeExplanationDepth')).toBe('blocks');
    expect(requests.explanationDepths).not.toContain('line-by-line');
  });

  it('"Shorten the code" opens the code editor pre-filled with the current code', async () => {
    prepare('line-by-line');
    const chunk = codeChunk(35);
    seed(CODE_DOCUMENT, [chunk]);
    stubApi();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: 'Explanation' }));
    const dialog = await screen.findByRole('alertdialog');

    await user.click(within(dialog).getByRole('button', { name: 'Shorten the code' }));

    const editor = await screen.findByTestId('code-input-textarea');
    expect(editor).toHaveValue(chunk.text);
    expect(screen.getByDisplayValue('password.py')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});
