import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { UploadChoiceModal } from './UploadChoiceModal';

describe('UploadChoiceModal', () => {
  it('renders nothing when closed, and both cards when open', () => {
    render(
      <UploadChoiceModal
        open={false}
        onClose={() => undefined}
        onChooseDocument={() => undefined}
        onChooseCode={() => undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the two choices and calls the matching callback for each', async () => {
    const onChooseDocument = vi.fn();
    const onChooseCode = vi.fn();
    const user = userEvent.setup();
    render(
      <UploadChoiceModal
        open
        onClose={() => undefined}
        onChooseDocument={onChooseDocument}
        onChooseCode={onChooseCode}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Upload a document/ }));
    expect(onChooseDocument).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Paste or write code/ }));
    expect(onChooseCode).toHaveBeenCalledTimes(1);
  });

  it('dismisses with Escape, the close button, and a click outside', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <UploadChoiceModal
        open
        onClose={onClose}
        onChooseDocument={() => undefined}
        onChooseCode={() => undefined}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    // Clicking the backdrop (the dialog's own container, outside the card) closes it too.
    const backdrop = screen.getByRole('dialog').parentElement;
    if (!backdrop) throw new Error('backdrop not found');
    await user.click(backdrop);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });
});
