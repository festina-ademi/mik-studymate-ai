import {
  Loader2,
  MessageCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Subtitles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from './Avatar';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card } from '../Card';
import { ErrorState } from '../ErrorState';
import { IconButton } from '../IconButton';
import { ProgressBar } from '../ProgressBar';
import { Skeleton } from '../Skeleton';
import { QuizQuestionView } from '../quiz/QuizQuestionView';
import { EXPLAINER_SPEEDS, useExplainerPlayer } from '../../hooks/useExplainerPlayer';
import {
  answerQuizQuestion,
  type ApiLanguage,
  type ChunkRecord,
  type DocumentKind,
  type DocumentRecord,
  type ExplainerSectionSummary,
  type QuizAnswerResult,
} from '../../lib/api';
import type { StudyLevel } from '../../hooks/useLevel';
import { describeError } from '../../lib/errors';

interface ExplainerPanelProps {
  documentId: string;
  document: DocumentRecord;
  chunks: ChunkRecord[];
  level: StudyLevel;
  language: ApiLanguage;
  onJumpToReference: (reference: string) => void;
  /** Whether the Avatar tab is the one on screen. The panel stays mounted (hidden) while another
   * tab is open, so a paused narration keeps its exact position; leaving the tab pauses it. */
  active: boolean;
  /** "Ask" was clicked: narration is paused and the parent switches to the Chat tab.
   * `wasPlaying` says whether it was playing, i.e. whether returning should resume it. */
  onAsk: (wasPlaying: boolean) => void;
  /** Set when the learner comes back through Chat's "Back to the Teacher": on becoming active
   * again, narration resumes from its pause point. `onResumeHandled` clears it. */
  resumeOnReturn: boolean;
  onResumeHandled: () => void;
}

function intersects(
  aStart: number | null,
  aEnd: number | null,
  bStart: number | null,
  bEnd: number | null,
): boolean {
  if (aStart === null || bStart === null) return false;
  const aFrom = aStart;
  const aTo = aEnd ?? aStart;
  const bFrom = bStart;
  const bTo = bEnd ?? bStart;
  return aFrom <= bTo && bFrom <= aTo;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * The synced "viewer" side of the stage: for lecture material, the page/slide numbers
 * covered by the current script, highlighted; for code, the actual source chunks in range.
 */
function ExplainerViewer({
  contentType,
  pageCount,
  chunks,
  pageStart,
  pageEnd,
  lineStart,
  lineEnd,
  sections,
  currentIndex,
  onSelectSection,
}: {
  contentType: DocumentKind;
  pageCount: number | null;
  chunks: ChunkRecord[];
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  sections: ExplainerSectionSummary[];
  currentIndex: number;
  onSelectSection: (index: number) => void;
}) {
  const { t } = useTranslation();

  if (contentType === 'code') {
    const relevant = chunks.filter((chunk) =>
      intersects(chunk.line_start, chunk.line_end, lineStart, lineEnd),
    );
    const shown = relevant.length > 0 ? relevant : chunks;
    return (
      <div className="space-y-3">
        {shown.slice(0, 6).map((chunk, index) => {
          const highlighted = relevant.includes(chunk);
          return (
            <div
              key={`${chunk.heading ?? 'chunk'}-${String(index)}`}
              className={`rounded-xl border p-3 transition ${
                highlighted
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-surface-muted opacity-60'
              }`}
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                {chunk.heading ?? t('workspace.explainerViewerCode')}
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
                {chunk.text}
              </pre>
            </div>
          );
        })}
      </div>
    );
  }

  const total = pageCount ?? 0;
  if (total <= 0) {
    return <p className="text-sm text-fg-muted">{t('workspace.explainerViewerEmpty')}</p>;
  }

  const currentTitle = sections.find((section) => section.index === currentIndex)?.title ?? '';
  const pageGrid = (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {Array.from({ length: total }, (_, index) => index + 1).map((pageNumber) => {
        const highlighted = intersects(pageNumber, pageNumber, pageStart, pageEnd);
        return (
          <div
            key={pageNumber}
            className={`flex aspect-[3/4] flex-col items-center justify-center rounded-xl border text-sm font-medium transition ${
              highlighted
                ? 'border-primary bg-primary-soft text-primary-soft-fg'
                : 'border-border bg-surface-muted text-fg-muted opacity-60'
            }`}
          >
            {pageNumber}
          </div>
        );
      })}
    </div>
  );

  if (sections.length === 0) {
    // The section plan hasn't loaded yet: the page grid is the only thing we can show.
    return pageGrid;
  }

  return (
    <>
      {/* Section pills: real titles, click to jump. Hidden on very narrow screens, where a
          wrapping list of titles would be cramped -- those fall back to the page grid below,
          with the current section's title called out separately above it. */}
      <div
        aria-label={t('workspace.explainerSectionListLabel')}
        className="hidden flex-col gap-1.5 sm:flex sm:flex-row sm:flex-wrap"
      >
        {sections.map((section) => {
          const active = section.index === currentIndex;
          return (
            <button
              key={section.index}
              type="button"
              title={section.title}
              aria-current={active}
              onClick={() => {
                onSelectSection(section.index);
              }}
              className={`flex max-w-56 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                active
                  ? 'border-primary bg-primary-soft font-semibold text-primary-soft-fg'
                  : 'border-border bg-surface-muted text-fg-muted hover:text-fg'
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  active ? 'bg-primary text-primary-contrast' : 'bg-surface text-fg-muted'
                }`}
              >
                {section.index + 1}
              </span>
              <span className="truncate">{section.title}</span>
            </button>
          );
        })}
      </div>
      <div className="sm:hidden">
        {currentTitle ? <p className="mb-2 text-sm font-medium text-fg">{currentTitle}</p> : null}
        {pageGrid}
      </div>
    </>
  );
}

/** The mini-quiz shown after a section's narration ends, reusing the Phase 5 quiz component. */
function ExplainerMiniQuiz({
  questions,
  onJumpToReference,
  onAllAnswered,
  onAnswerOutcome,
}: {
  questions: {
    id: number;
    kind: 'multiple_choice' | 'short_answer';
    topic: string;
    difficulty: 'easy' | 'medium' | 'hard';
    question: string;
    options: string[];
    allow_multiple?: boolean;
    source_reference: string | null;
  }[];
  onJumpToReference: (reference: string) => void;
  onAllAnswered: () => void;
  onAnswerOutcome: (correct: boolean) => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, QuizAnswerResult>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = questions[index];
  const result = current ? (answers[current.id] ?? null) : null;

  if (!current) {
    return null;
  }

  const submit = (): void => {
    const isMultipleChoice = current.kind === 'multiple_choice';
    if (isMultipleChoice ? selectedOptionIndices.length === 0 : !draft.trim()) {
      return;
    }
    void (async () => {
      setIsSubmitting(true);
      setError(null);
      try {
        const outcome = await answerQuizQuestion({
          questionId: current.id,
          answer: isMultipleChoice ? '' : draft.trim(),
          selectedOptionIndices: isMultipleChoice ? selectedOptionIndices : [],
        });
        setAnswers((previous) => ({ ...previous, [current.id]: outcome }));
        onAnswerOutcome(outcome.correct);
      } catch (caught: unknown) {
        setError(describeError(t, caught));
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  // Every multiple_choice question is single-correct: picking an option always replaces the
  // current pick, matching the radio-button UI.
  const toggleOption = (optionIndex: number): void => {
    setSelectedOptionIndices([optionIndex]);
  };

  const advance = (): void => {
    if (index >= questions.length - 1) {
      onAllAnswered();
      return;
    }
    setIndex((value) => value + 1);
    setDraft('');
    setSelectedOptionIndices([]);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary-soft-fg">
        {t('workspace.explainerMiniQuizTitle')}
      </p>
      {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
      <QuizQuestionView
        question={{ ...current, allow_multiple: current.allow_multiple ?? false }}
        index={index}
        total={questions.length}
        draftAnswer={draft}
        onChangeDraft={setDraft}
        selectedOptionIndices={selectedOptionIndices}
        onToggleOption={toggleOption}
        result={result}
        isSubmitting={isSubmitting}
        onSubmit={submit}
        onAdvance={advance}
        isLast={index >= questions.length - 1}
        onJumpToReference={onJumpToReference}
      />
    </div>
  );
}

/**
 * The Avatar tab, user-facing name for what's still called "Explainer" internally: an animated
 * avatar reads a spoken script for the current document, synced to a viewer, with captions, a
 * section timeline, playback controls, an "Ask" button (pauses narration and hands over to the
 * Chat tab; see `onAsk`), and a short mini-quiz after each section.
 */
export function ExplainerPanel({
  documentId,
  document,
  chunks,
  level,
  language,
  onJumpToReference,
  active,
  onAsk,
  resumeOnReturn,
  onResumeHandled,
}: ExplainerPanelProps) {
  const { t } = useTranslation();
  const [showCaptions, setShowCaptions] = useState(true);
  const [happyPulse, setHappyPulse] = useState<'happy' | 'encouraging' | null>(null);

  const player = useExplainerPlayer({ documentId, level, language });

  // Leaving the tab pauses narration in place; coming back from Chat's "Back to the Teacher"
  // resumes it (if it was playing when "Ask" was clicked), while any other return just ends
  // the ask and leaves the Play button. Tracks the previous `active` value so this reacts only
  // to an actual change, not to every re-render.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (wasActiveRef.current === active) return;
    wasActiveRef.current = active;
    if (!active) {
      if (player.status === 'playing') player.pause();
      return;
    }
    if (resumeOnReturn) {
      player.resumeFromAsk();
      onResumeHandled();
    } else if (player.isAsking) {
      player.dismissAsk();
    }
  }, [active, onResumeHandled, player, resumeOnReturn]);

  // Reset the quiz-answer face when the section changes, adjusting state during render (the
  // React-recommended alternative to an effect for state derived from a changed prop) rather
  // than in an effect, which would cause an extra render pass just to clear it.
  const [happyPulseSectionIndex, setHappyPulseSectionIndex] = useState(player.currentIndex);
  if (happyPulseSectionIndex !== player.currentIndex) {
    setHappyPulseSectionIndex(player.currentIndex);
    setHappyPulse(null);
  }

  useEffect(() => {
    if (!happyPulse) return;
    const timer = setTimeout(() => {
      setHappyPulse(null);
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [happyPulse]);

  // The first-time "preparing your virtual teacher" overlay: `player.voiceEngine` starts null
  // and is set for good the first time any utterance's engine resolves this session, so it
  // doubles as "has synthesis ever succeeded yet" without extra state.
  const [showPreparingOverlay, setShowPreparingOverlay] = useState(false);
  const [preparingTimedOut, setPreparingTimedOut] = useState(false);

  // Dismiss the overlay the moment an engine resolves (success) or both engines fail, adjusting
  // state during render -- the same React-recommended alternative to an effect used for
  // `happyPulse` above -- rather than in an effect, which would cost an extra render pass.
  const [lastVoiceSignal, setLastVoiceSignal] = useState({
    engine: player.voiceEngine,
    error: player.voiceError,
  });
  if (
    lastVoiceSignal.engine !== player.voiceEngine ||
    lastVoiceSignal.error !== player.voiceError
  ) {
    setLastVoiceSignal({ engine: player.voiceEngine, error: player.voiceError });
    if (player.voiceEngine !== null || player.voiceError !== null) {
      setShowPreparingOverlay(false);
    }
  }

  useEffect(() => {
    if (!showPreparingOverlay) return;
    const timer = setTimeout(() => {
      setPreparingTimedOut(true);
    }, 45_000);
    return () => {
      clearTimeout(timer);
    };
  }, [showPreparingOverlay]);

  const retryFirstPlay = (): void => {
    player.pause();
    player.play();
    setPreparingTimedOut(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!active || isEditableTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (player.status === 'playing') {
          player.pause();
        } else {
          player.play();
        }
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        player.next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        player.previous();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, player]);

  const script = player.currentScript;
  const captions = script?.captions ?? [];
  const activeCaption = player.captionIndex >= 0 ? (captions[player.captionIndex] ?? '') : '';

  const avatarState =
    happyPulse ??
    (player.isLoadingScript ? 'thinking' : player.status === 'playing' ? 'speaking' : 'idle');

  const speedOptions = useMemo(
    () =>
      EXPLAINER_SPEEDS.map((value) => ({
        value,
        label: `${String(value)}x`,
      })),
    [],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-fg-muted">
          {t('workspace.explainerViewerTitle')}
          {script?.source_reference ? (
            <span className="ml-2 text-fg">{script.source_reference}</span>
          ) : null}
        </div>
        <div className="p-4">
          <ExplainerViewer
            contentType={document.content_type}
            pageCount={document.page_count}
            chunks={chunks}
            pageStart={script?.page_start ?? null}
            pageEnd={script?.page_end ?? null}
            lineStart={script?.line_start ?? null}
            lineEnd={script?.line_end ?? null}
            sections={player.sections}
            currentIndex={player.currentIndex}
            onSelectSection={player.goToSection}
          />
        </div>
      </Card>

      <Card className="flex flex-col overflow-hidden">
        {player.phase === 'loading' && !script ? (
          <div className="p-6">
            <Skeleton lines={6} />
          </div>
        ) : player.phase === 'error' ? (
          <div className="p-6">
            <ErrorState
              title={t('workspace.errorTitle')}
              description={player.error ?? t('errors.unknown')}
              onRetry={player.retry}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge>
                {player.isOverview
                  ? t('workspace.explainerOverviewBadge')
                  : t('workspace.explainerSectionBadge', {
                      current: player.currentIndex + 1,
                      total: player.sections.length,
                    })}
              </Badge>
              <span className="text-sm font-medium text-fg">{script?.title}</span>
            </div>

            <ProgressBar
              value={
                player.sections.length > 0
                  ? ((player.currentIndex + 1) / player.sections.length) * 100
                  : 0
              }
              label={t('workspace.explainerProgress')}
            />

            <div className="relative flex flex-1 flex-col items-center justify-center gap-4 py-2">
              {showPreparingOverlay ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-surface/95 p-6 text-center">
                  {preparingTimedOut ? (
                    <>
                      <p className="text-sm font-medium text-fg">
                        {t('workspace.explainerPreparingTimeout')}
                      </p>
                      <Button variant="secondary" size="sm" onClick={retryFirstPlay}>
                        {t('common.retry')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Loader2 aria-hidden className="size-8 animate-spin text-primary" />
                      <p className="text-sm font-medium text-fg">
                        {t('workspace.explainerPreparingTitle')}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {t('workspace.explainerPreparingSubtitle')}
                      </p>
                    </>
                  )}
                </div>
              ) : null}
              <Avatar
                state={avatarState}
                // Frozen only while narration is paused; a script that is still loading keeps
                // the avatar's thinking animation running even though the player status is paused.
                paused={player.status === 'paused' && !player.isLoadingScript}
                className="h-52 w-52"
              />

              {player.voiceError ? (
                <p className="text-sm text-error">{t('workspace.explainerVoiceFailed')}</p>
              ) : player.voiceEngine === 'browser' ? (
                <p
                  className="text-xs text-fg-muted"
                  title={t('workspace.explainerUsingBrowserVoice')}
                >
                  {t('workspace.explainerUsingBrowserVoice')}
                </p>
              ) : null}

              {showCaptions ? (
                <p className="min-h-12 max-w-md text-center text-base font-medium text-fg">
                  {activeCaption ||
                    (player.isLoadingScript ? t('workspace.explainerThinking') : '')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <IconButton
                ariaLabel={t('workspace.explainerPrevious')}
                onClick={player.previous}
                disabled={player.isFirstSection}
              >
                <SkipBack className="size-4" />
              </IconButton>
              <IconButton
                ariaLabel={
                  player.status === 'playing'
                    ? t('workspace.explainerPause')
                    : t('workspace.explainerPlay')
                }
                variant="primary"
                size="lg"
                onClick={() => {
                  if (player.status === 'playing') {
                    player.pause();
                  } else {
                    if (player.voiceEngine === null) {
                      setShowPreparingOverlay(true);
                      setPreparingTimedOut(false);
                    }
                    player.play();
                  }
                }}
              >
                {player.status === 'playing' ? (
                  <Pause className="size-5" />
                ) : (
                  <Play className="size-5" />
                )}
              </IconButton>
              <IconButton
                ariaLabel={t('workspace.explainerNext')}
                onClick={player.next}
                disabled={player.isLastSection}
              >
                <SkipForward className="size-4" />
              </IconButton>

              <div className="mx-1 flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1">
                {speedOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={player.speed === option.value}
                    onClick={() => {
                      player.setSpeed(option.value);
                    }}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                      player.speed === option.value
                        ? 'bg-primary text-primary-contrast'
                        : 'text-fg-muted hover:text-fg'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <IconButton
                ariaLabel={t('workspace.explainerToggleCaptions')}
                variant={showCaptions ? 'primary' : 'default'}
                onClick={() => {
                  setShowCaptions((value) => !value);
                }}
              >
                <Subtitles className="size-4" />
              </IconButton>

              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  const wasPlaying = player.status === 'playing';
                  player.ask();
                  onAsk(wasPlaying);
                }}
              >
                <MessageCircle className="size-4" />
                {t('workspace.explainerAsk')}
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={player.explainSimpler}
                disabled={player.isOverview || player.isLoadingScript}
              >
                <Sparkles className="size-4" />
                {t('workspace.explainerSimpler')}
              </Button>
            </div>

            {player.showQuiz && script?.quiz ? (
              <ExplainerMiniQuiz
                questions={script.quiz.questions}
                onJumpToReference={onJumpToReference}
                onAllAnswered={player.continueAfterQuiz}
                onAnswerOutcome={(correct) => {
                  setHappyPulse(correct ? 'happy' : 'encouraging');
                }}
              />
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
