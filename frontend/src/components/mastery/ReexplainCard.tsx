import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../Button';
import { ErrorState } from '../ErrorState';
import { PrettyMarkdown } from '../PrettyMarkdown';
import { ProgressBar, type ProgressBarTone } from '../ProgressBar';
import { Skeleton } from '../Skeleton';
import { QuizQuestionView } from '../quiz/QuizQuestionView';
import {
  answerQuizQuestion,
  generateQuiz,
  getDocumentMastery,
  reexplainTopic,
  type ApiLanguage,
  type MasteryLevel,
  type QuizAnswerResult,
  type QuizQuestionRecord,
  type ReexplainResponse,
} from '../../lib/api';
import type { StudyLevel } from '../../hooks/useLevel';
import { describeError } from '../../lib/errors';

type Phase = 'offer' | 'loading' | 'explained' | 'retest-loading' | 'retesting' | 'retest-done';

const RETEST_QUESTION_COUNT = 3;

/** Comparison key for a topic label, mirroring the backend's ``normalize_topic``. */
function normalizeTopic(topic: string): string {
  return topic.trim().split(/\s+/).join(' ').toLowerCase();
}

type RetestOutcome = 'rose' | 'same' | 'dropped';

/** Compares at the displayed (whole-percent) precision, so "same" matches what the learner sees. */
function retestOutcome(before: number, after: number): RetestOutcome {
  const beforePercent = Math.round(before * 100);
  const afterPercent = Math.round(after * 100);
  if (afterPercent > beforePercent) return 'rose';
  if (afterPercent < beforePercent) return 'dropped';
  return 'same';
}

const RETEST_OUTCOME_KEYS: Record<RetestOutcome, string> = {
  rose: 'workspace.reexplainRetestRose',
  same: 'workspace.reexplainRetestSame',
  dropped: 'workspace.reexplainRetestDropped',
};

function masteryTone(value: number): ProgressBarTone {
  if (value < 0.5) return 'error';
  if (value < 0.75) return 'warning';
  return 'success';
}

interface ReexplainCardProps {
  documentId: string;
  topic: string;
  mastery: number;
  level: StudyLevel;
  language: ApiLanguage;
  onJumpToReference: (reference: string) => void;
  /** Called with the server's recomputed mastery once a retest finishes. */
  onMasteryUpdated?: (topic: string, mastery: number, level: MasteryLevel) => void;
}

/** "Re-explain this topic" card: a simpler explanation, then an optional short retest. */
export function ReexplainCard({
  documentId,
  topic,
  mastery,
  level,
  language,
  onJumpToReference,
  onMasteryUpdated,
}: ReexplainCardProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('offer');
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ReexplainResponse | null>(null);

  const [retestQuestions, setRetestQuestions] = useState<QuizQuestionRecord[]>([]);
  const [retestIndex, setRetestIndex] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<number[]>([]);
  const [answerMap, setAnswerMap] = useState<Record<number, QuizAnswerResult>>({});
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [updatedMastery, setUpdatedMastery] = useState<number | null>(null);
  const [displayedMastery, setDisplayedMastery] = useState(mastery);
  const [preRetestMastery, setPreRetestMastery] = useState(mastery);

  useEffect(() => {
    if (phase !== 'retest-done' || updatedMastery === null) {
      return;
    }
    // A short delay before updating the bar's value lets the width transition actually animate
    // (an instant value change on mount would just render the final state directly).
    const timer = setTimeout(() => {
      setDisplayedMastery(updatedMastery);
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, updatedMastery]);

  const handleReexplain = async (): Promise<void> => {
    setError(null);
    setPhase('loading');
    try {
      const result = await reexplainTopic({ documentId, topic, level, language });
      setExplanation(result);
      setPhase('explained');
    } catch (caught: unknown) {
      setError(describeError(t, caught));
      setPhase('offer');
    }
  };

  const handleRetest = async (): Promise<void> => {
    setError(null);
    setPreRetestMastery(displayedMastery);
    setUpdatedMastery(null);
    setPhase('retest-loading');
    try {
      const quiz = await generateQuiz({
        documentId,
        level,
        language,
        topic,
        numQuestions: RETEST_QUESTION_COUNT,
        types: ['multiple_choice'],
        regenerate: true,
      });
      if (quiz.questions.length === 0) {
        setError(t('workspace.masteryRetestNoQuestions'));
        setPhase('explained');
        return;
      }
      setRetestQuestions(quiz.questions);
      setRetestIndex(0);
      setDraftAnswer('');
      setSelectedOptionIndices([]);
      setAnswerMap({});
      setPhase('retesting');
    } catch (caught: unknown) {
      setError(describeError(t, caught));
      setPhase('explained');
    }
  };

  const currentQuestion = retestQuestions[retestIndex] ?? null;
  const currentResult = currentQuestion ? (answerMap[currentQuestion.id] ?? null) : null;

  const submitRetestAnswer = async (): Promise<void> => {
    if (!currentQuestion) {
      return;
    }
    const isMultipleChoice = currentQuestion.kind === 'multiple_choice';
    if (isMultipleChoice ? selectedOptionIndices.length === 0 : !draftAnswer.trim()) {
      return;
    }
    setIsSubmittingAnswer(true);
    setError(null);
    try {
      const result = await answerQuizQuestion({
        questionId: currentQuestion.id,
        answer: isMultipleChoice ? '' : draftAnswer.trim(),
        selectedOptionIndices: isMultipleChoice ? selectedOptionIndices : [],
      });
      setAnswerMap((previous) => ({ ...previous, [currentQuestion.id]: result }));
    } catch (caught: unknown) {
      setError(describeError(t, caught));
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  // Every multiple_choice question is single-correct: picking an option always replaces the
  // current pick, matching the radio-button UI.
  const toggleRetestOption = (optionIndex: number): void => {
    setSelectedOptionIndices([optionIndex]);
  };

  const finishRetest = async (): Promise<void> => {
    setPhase('retest-done');
    try {
      const overview = await getDocumentMastery(documentId);
      const key = normalizeTopic(topic);
      const entry = overview.find((item) => normalizeTopic(item.topic) === key);
      if (entry) {
        setUpdatedMastery(entry.mastery);
        onMasteryUpdated?.(topic, entry.mastery, entry.level);
      } else {
        setUpdatedMastery(preRetestMastery);
      }
    } catch (caught: unknown) {
      setError(describeError(t, caught));
    }
  };

  const advanceRetest = (): void => {
    if (retestIndex >= retestQuestions.length - 1) {
      void finishRetest();
      return;
    }
    setRetestIndex((value) => value + 1);
    setDraftAnswer('');
    setSelectedOptionIndices([]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 rounded-2xl border border-primary/30 bg-primary-soft p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium uppercase tracking-[0.08em] text-primary-soft-fg">
          {t('workspace.reexplainTitle')}
        </p>
        <span className="rounded-full border border-primary/30 bg-surface px-2.5 py-1 text-xs font-medium text-fg">
          {topic}
        </span>
      </div>

      {error ? (
        <ErrorState
          title={t('workspace.errorTitle')}
          description={error}
          onRetry={() => {
            setError(null);
          }}
        />
      ) : null}

      {phase === 'offer' && !error ? (
        <div className="space-y-3">
          <p className="text-sm text-fg">{t('workspace.reexplainOffer', { topic })}</p>
          <Button
            variant="primary"
            onClick={() => {
              void handleReexplain();
            }}
          >
            {t('workspace.reexplainAction')}
          </Button>
        </div>
      ) : null}

      {phase === 'loading' ? <Skeleton lines={4} /> : null}

      {phase === 'explained' && explanation ? (
        <div className="space-y-4">
          <PrettyMarkdown value={explanation.explanation} />
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-muted">
              {t('workspace.reexplainExampleLabel')}
            </p>
            <p className="mt-1 text-sm text-fg">{explanation.example}</p>
          </div>
          {explanation.trace ? (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-muted">
                {t('workspace.reexplainTraceLabel')}
              </p>
              <PrettyMarkdown value={explanation.trace} className="prose-sm mt-1" />
            </div>
          ) : null}
          {explanation.references.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {explanation.references.map((reference) => (
                <button
                  key={reference}
                  type="button"
                  onClick={() => {
                    onJumpToReference(reference);
                  }}
                  className="rounded-full border border-primary/40 bg-surface px-2.5 py-1 text-[11px] font-medium text-primary"
                >
                  {reference}
                </button>
              ))}
            </div>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              void handleRetest();
            }}
          >
            {t('workspace.reexplainRetest')}
          </Button>
        </div>
      ) : null}

      {phase === 'retest-loading' ? <Skeleton lines={3} /> : null}

      {phase === 'retesting' && currentQuestion ? (
        <QuizQuestionView
          question={currentQuestion}
          index={retestIndex}
          total={retestQuestions.length}
          draftAnswer={draftAnswer}
          onChangeDraft={setDraftAnswer}
          selectedOptionIndices={selectedOptionIndices}
          onToggleOption={toggleRetestOption}
          result={currentResult}
          isSubmitting={isSubmittingAnswer}
          onSubmit={() => {
            void submitRetestAnswer();
          }}
          onAdvance={advanceRetest}
          isLast={retestIndex >= retestQuestions.length - 1}
          onJumpToReference={onJumpToReference}
        />
      ) : null}

      {phase === 'retest-done' && updatedMastery === null && !error ? <Skeleton lines={2} /> : null}

      {phase === 'retest-done' && updatedMastery !== null ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-fg">
            {t(RETEST_OUTCOME_KEYS[retestOutcome(preRetestMastery, updatedMastery)], {
              percent: Math.round(updatedMastery * 100),
            })}
          </p>
          <ProgressBar
            value={displayedMastery * 100}
            tone={masteryTone(displayedMastery)}
            label={`${String(Math.round(displayedMastery * 100))}%`}
          />
        </div>
      ) : null}
    </motion.div>
  );
}
