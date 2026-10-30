import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExplainerPanel } from './ExplainerPanel';
import type { DocumentRecord } from '../../lib/api';
import type { TtsEngineKind, TtsErrorCode } from '../../lib/tts';

const DOCUMENT: DocumentRecord = {
  id: 'doc-1',
  filename: 'lecture.pdf',
  content_hash: 'hash-1',
  content_type: 'lecture',
  source_format: 'pdf',
  detected_language: 'en',
  size_bytes: 100,
  page_count: 2,
};

const SCRIPT = {
  section_index: -1,
  title: 'Overview',
  text: 'Welcome.',
  captions: ['Welcome.'],
  source_reference: null,
  page_start: null,
  page_end: null,
  line_start: null,
  line_end: null,
  quiz: null,
  metadata: {
    document_id: 'doc-1',
    level: 'intermediate',
    language: 'en',
    simplified: false,
    prompt_version: '1',
    model: 'mock',
    cached: false,
  },
};

let playerState: {
  voiceEngine: TtsEngineKind | null;
  voiceError: TtsErrorCode | null;
  status: 'idle' | 'playing' | 'paused';
};
const playMock = vi.fn();

vi.mock('../../hooks/useExplainerPlayer', () => ({
  EXPLAINER_SPEEDS: [1, 1.25, 1.5],
  useExplainerPlayer: () => ({
    phase: 'ready',
    error: null,
    sections: [],
    currentIndex: -1,
    isOverview: true,
    isFirstSection: true,
    isLastSection: true,
    currentScript: SCRIPT,
    isLoadingScript: false,
    status: playerState.status,
    speed: 1,
    captionIndex: 0,
    amplitude: 0,
    isAsking: false,
    showQuiz: false,
    voiceError: playerState.voiceError,
    voiceEngine: playerState.voiceEngine,
    play: playMock,
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    goToSection: vi.fn(),
    setSpeed: vi.fn(),
    explainSimpler: vi.fn(),
    ask: vi.fn(),
    resumeFromAsk: vi.fn(),
    dismissAsk: vi.fn(),
    continueAfterQuiz: vi.fn(),
    retry: vi.fn(),
  }),
}));

describe('ExplainerPanel first-time loading overlay', () => {
  afterEach(() => {
    vi.useRealTimers();
    playMock.mockClear();
  });

  it('shows the "preparing" overlay on the first Play click, and hides it once the voice resolves', async () => {
    playerState = { voiceEngine: null, voiceError: null, status: 'idle' };
    const user = userEvent.setup();
    const { rerender } = render(
      <ExplainerPanel
        documentId="doc-1"
        document={DOCUMENT}
        chunks={[]}
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
        active
        onAsk={() => undefined}
        resumeOnReturn={false}
        onResumeHandled={() => undefined}
      />,
    );

    expect(screen.queryByText('Preparing your virtual teacher...')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Preparing your virtual teacher...')).toBeInTheDocument();
    expect(screen.getByText('This may take 10–30 seconds the first time.')).toBeInTheDocument();

    // The voice resolves (first synthesis call succeeds): the overlay disappears.
    playerState = { voiceEngine: 'server', voiceError: null, status: 'playing' };
    rerender(
      <ExplainerPanel
        documentId="doc-1"
        document={DOCUMENT}
        chunks={[]}
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
        active
        onAsk={() => undefined}
        resumeOnReturn={false}
        onResumeHandled={() => undefined}
      />,
    );
    expect(screen.queryByText('Preparing your virtual teacher...')).not.toBeInTheDocument();
  });

  it('does not show the overlay again once a voice has already resolved this session', async () => {
    playerState = { voiceEngine: 'server', voiceError: null, status: 'idle' };
    const user = userEvent.setup();
    render(
      <ExplainerPanel
        documentId="doc-1"
        document={DOCUMENT}
        chunks={[]}
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
        active
        onAsk={() => undefined}
        resumeOnReturn={false}
        onResumeHandled={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.queryByText('Preparing your virtual teacher...')).not.toBeInTheDocument();
  });

  it('shows a "Try again" button after the overlay has been up for 45s with no resolution', async () => {
    vi.useFakeTimers();
    playerState = { voiceEngine: null, voiceError: null, status: 'idle' };
    render(
      <ExplainerPanel
        documentId="doc-1"
        document={DOCUMENT}
        chunks={[]}
        level="intermediate"
        language="en"
        onJumpToReference={() => undefined}
        active
        onAsk={() => undefined}
        resumeOnReturn={false}
        onResumeHandled={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByText('Preparing your virtual teacher...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(screen.getByText('This is taking longer than expected.')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    expect(playMock).toHaveBeenCalledTimes(2);
  });
});
