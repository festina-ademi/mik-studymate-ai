import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQueryClient } from '../test/utils';
import { CodeInputView } from './CodeInputView';

const DOCUMENT = {
  id: 'doc-1',
  filename: 'pasted_code_2026-10-12.py',
  content_hash: 'hash-1',
  content_type: 'code' as const,
  source_format: 'code',
  detected_language: 'en',
  size_bytes: 40,
  page_count: null,
};
const CHUNKS = [
  {
    text: 'def add(a, b):\n    return a + b',
    heading: 'add',
    page_start: null,
    page_end: null,
    line_start: null,
    line_end: null,
  },
];

/** `detectedLanguage` is required (not defaulted via `??`) so an explicit `null` -- the
 * ambiguous-detection case -- can never be coalesced away into the "detected" default. */
function stubUploadCodeFetch(detectedLanguage: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json(
          {
            document: DOCUMENT,
            chunks: CHUNKS,
            detected_programming_language: detectedLanguage,
            language_detected_automatically: true,
          },
          { status: 201 },
        ),
      ),
    ),
  );
}

describe('CodeInputView', () => {
  it('disables Analyze until there are at least 10 characters of code', async () => {
    stubUploadCodeFetch('python');
    const user = userEvent.setup();
    renderWithQueryClient(<CodeInputView onUploaded={() => undefined} />);

    const textarea = screen.getByTestId('code-input-textarea');
    const analyzeButton = screen.getByRole('button', { name: 'Analyze' });
    expect(analyzeButton).toBeDisabled();

    await user.type(textarea, 'short');
    expect(analyzeButton).toBeDisabled();

    await user.type(textarea, ' enough now');
    expect(analyzeButton).toBeEnabled();
  });

  it('inserts two spaces on Tab instead of moving focus out of the editor', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<CodeInputView onUploaded={() => undefined} />);

    const textarea = screen.getByTestId<HTMLTextAreaElement>('code-input-textarea');
    await user.click(textarea);
    await user.keyboard('abc');
    await user.keyboard('{Tab}');
    await user.keyboard('def');

    expect(textarea.value).toBe('abc  def');
    expect(textarea).toHaveFocus();
  });

  it('calls onUploaded with the created document once analysis succeeds', async () => {
    stubUploadCodeFetch('python');
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<CodeInputView onUploaded={onUploaded} />);

    await user.type(screen.getByTestId('code-input-textarea'), 'def add(a, b):\n    return a+b');
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    await vi.waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });
    expect(onUploaded).toHaveBeenCalledWith(DOCUMENT, CHUNKS);
  });

  it('pauses with a notice when auto-detect is ambiguous, and proceeds on "Continue anyway"', async () => {
    stubUploadCodeFetch(null);
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<CodeInputView onUploaded={onUploaded} />);

    await user.type(
      screen.getByTestId('code-input-textarea'),
      'just some ambiguous notes, not clearly any language',
    );
    await user.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(
      await screen.findByText("Language couldn't be auto-detected. Please select manually."),
    ).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(onUploaded).toHaveBeenCalledWith(DOCUMENT, CHUNKS);
  });

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithQueryClient(<CodeInputView onUploaded={() => undefined} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
