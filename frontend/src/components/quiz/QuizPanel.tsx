import { BookX, Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../Button';
import { ErrorState } from '../ErrorState';
import { ProgressBar } from '../ProgressBar';
import { QuizQuestionView } from './QuizQuestionView';
import { QuizResultsView } from './QuizResultsView';
import { QuizStartScreen } from './QuizStartScreen';
import {
  answerQuizQuestion,
  generateQuiz,
  getDocumentMastery,
  getQuizResults,
  getWeakTopics,
  type ApiLanguage,
  type MasteryOverviewEntry,
  type QuestionKind,
  type QuizAnswerResult,
  type QuizQuestionRecord,
  type QuizResultsResponse,
  type QuizSetResponse,
  type WeakTopicEntry,
} from '../../lib/api';
import type { StudyLevel } from '../../hooks/useLevel';
import { describeError } from '../../lib/errors';

type Phase = 'start' | 'loading' | 'active' | 'results';

const DEFAULT_NUM_QUESTIONS = 8;

interface QuizPanelProps {
  documentId: string;
  /** Shown on the printed/PDF-exported results page; see PrintableSection. */
  documentName: string;
  level: StudyLevel;
  language: ApiLanguage;
  onJumpToReference: (reference: string) => void;
  /** Called once a quiz is completed (results reached); Study Mode uses this to log usage. */
  onQuizAttempt?: () => void;
  /** Called whenever "exam mode" (the source panel should be hidden) should turn on or off:
   * true once a quiz is actively being taken, false once it finishes, is left at the start
   * screen, or this panel unmounts (the student navigated away mid-quiz = quit). */
  onExamModeChange?: (active: boolean) => void;
  /** Whether the learner has used the "View source" affordance during the current quiz
   * (owned by the parent, since revealing the material is a workspace-layout concern). */
  examPeeked?: boolean;
  /** Reveal the source material mid-quiz; flags the rest of this quiz's answers as peeked. */
  onPeekSource?: () => void;
}

/**
 * The Quiz tab: start screen, one question at a time, then results.
 *
 * The caller renders this with `key={documentId}` so that switching to a different document
 * naturally remounts the panel back to the start screen instead of carrying over state. The
 * workspace also only renders this component at all while the Quiz tab is selected (see
 * `WorkspacePage`'s tab switch), so navigating to another tab mid-quiz unmounts it the same
 * way — a deliberate "reset rather than resume" choice for exam mode: it is the simplest
 * option, it already falls out of the existing per-tab render structure for free, and it
 * matches "leaving mid-quiz counts as quitting" better than silently resuming later would.
 */
export function QuizPanel({
  documentId,
  documentName,
  level,
  language,
  onJumpToReference,
  onQuizAttempt,
  onExamModeChange,
  examPeeked = false,
  onPeekSource,
}: QuizPanelProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('start');
  const [error, setError] = useState<string | null>(null);
  const [numQuestions, setNumQuestions] = useState(DEFAULT_NUM_QUESTIONS);
  const [types, setTypes] = useState<QuestionKind[]>(['multiple_choice', 'short_answer']);

  const [quiz, setQuiz] = useState<QuizSetResponse | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<QuizQuestionRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [selectedOptionIndices, setSelectedOptionIndices] = useState<number[]>([]);
  const [answerMap, setAnswerMap] = useState<Record<number, QuizAnswerResult>>({});
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);

  // "Exam mode" (the workspace hides the source panel) is on exactly while a quiz is being
  // actively taken; off at the start screen, the results view, and on unmount (navigating away
  // mid-quiz counts as quitting, matching the fresh-start-on-reopen behavior documented on
  // QuizPanel's own docstring).
  const onExamModeChangeRef = useRef(onExamModeChange);
  useEffect(() => {
    onExamModeChangeRef.current = onExamModeChange;
  }, [onExamModeChange]);
  useEffect(() => {
    onExamModeChangeRef.current?.(phase === 'active');
  }, [phase]);
  useEffect(() => {
    return () => {
      onExamModeChangeRef.current?.(false);
    };
  }, []);

  const [results, setResults] = useState<QuizResultsResponse | null>(null);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [documentWeakTopics, setDocumentWeakTopics] = useState<WeakTopicEntry[]>([]);
  const [masteryEntries, setMasteryEntries] = useState<MasteryOverviewEntry[]>([]);
  const [isLoadingMastery, setIsLoadingMastery] = useState(false);

  // Bumped on every "New quiz" so each one is a fresh generation with its own cache entry
  // (the backend also tells the model which questions earlier quizzes already asked).
  const variationSeedRef = useRef(0);

  const startQuiz = useCallback(
    async (regenerate: boolean): Promise<void> => {
      setError(null);
      setPhase('loading');
      if (regenerate) {
        variationSeedRef.current += 1;
      }
      try {
        const nextQuiz = await generateQuiz({
          documentId,
          level,
          language,
          numQuestions,
          types,
          regenerate,
          variationSeed: variationSeedRef.current,
        });
        setQuiz(nextQuiz);
        setActiveQuestions(nextQuiz.questions);
        setCurrentIndex(0);
        setDraftAnswer('');
        setSelectedOptionIndices([]);
        setAnswerMap({});
        setPhase(nextQuiz.questions.length > 0 ? 'active' : 'start');
        if (nextQuiz.questions.length === 0) {
          setError(t('workspace.quizNoQuestions'));
        }
      } catch (caught: unknown) {
        setError(describeError(t, caught));
        setPhase('start');
      }
    },
    [documentId, language, level, numQuestions, t, types],
  );

  const finishQuiz = useCallback(
    async (quizSetId: string): Promise<void> => {
      setPhase('results');
      setIsLoadingResults(true);
      setIsLoadingMastery(true);
      onQuizAttempt?.();
      try {
        const [nextResults, weakTopics, mastery] = await Promise.all([
          getQuizResults(quizSetId),
          getWeakTopics(documentId),
          getDocumentMastery(documentId),
        ]);
        setResults(nextResults);
        setDocumentWeakTopics(weakTopics);
        setMasteryEntries(mastery);
      } catch (caught: unknown) {
        setError(describeError(t, caught));
      } finally {
        setIsLoadingResults(false);
        setIsLoadingMastery(false);
      }
    },
    [documentId, onQuizAttempt, t],
  );

  const refreshMastery = useCallback(async (): Promise<void> => {
    try {
      const [weakTopics, mastery] = await Promise.all([
        getWeakTopics(documentId),
        getDocumentMastery(documentId),
      ]);
      setDocumentWeakTopics(weakTopics);
      setMasteryEntries(mastery);
    } catch (caught: unknown) {
      setError(describeError(t, caught));
    }
  }, [documentId, t]);

  const currentQuestion = activeQuestions[currentIndex] ?? null;
  const currentResult = currentQuestion ? (answerMap[currentQuestion.id] ?? null) : null;

  const submitAnswer = useCallback(async (): Promise<void> => {
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
        peeked: examPeeked,
      });
      setAnswerMap((previous) => ({ ...previous, [currentQuestion.id]: result }));
    } catch (caught: unknown) {
      setError(describeError(t, caught));
    } finally {
      setIsSubmittingAnswer(false);
    }
  }, [currentQuestion, draftAnswer, examPeeked, selectedOptionIndices, t]);

  // Every multiple_choice question is single-correct: picking an option always replaces the
  // current pick, matching the radio-button UI (no `allow_multiple` branch -- see
  // QuizQuestionView's own note on why that field still exists in the data model).
  const toggleOption = useCallback((optionIndex: number): void => {
    setSelectedOptionIndices([optionIndex]);
  }, []);

  const advance = useCallback((): void => {
    if (currentIndex >= activeQuestions.length - 1) {
      if (quiz) {
        void finishQuiz(quiz.quiz_set_id);
      }
      return;
    }
    setCurrentIndex((value) => value + 1);
    setDraftAnswer('');
    setSelectedOptionIndices([]);
  }, [activeQuestions.length, currentIndex, finishQuiz, quiz]);

  const wrongQuestions = quiz
    ? quiz.questions.filter((question) => answerMap[question.id]?.correct === false)
    : [];

  const retryWrong = (): void => {
    if (wrongQuestions.length === 0) {
      return;
    }
    setActiveQuestions(wrongQuestions);
    setCurrentIndex(0);
    setDraftAnswer('');
    setSelectedOptionIndices([]);
    setAnswerMap({});
    setPhase('active');
  };

  const toggleType = (kind: QuestionKind): void => {
    setTypes((previous) => {
      if (previous.includes(kind)) {
        return previous.length > 1 ? previous.filter((item) => item !== kind) : previous;
      }
      return [...previous, kind];
    });
  };

  return (
    <div className="space-y-4">
      {phase === 'loading' ? <ProgressBar value={80} label={t('workspace.quizLoading')} /> : null}

      {error ? (
        <ErrorState
          title={t('workspace.errorTitle')}
          description={error}
          onRetry={() => {
            setError(null);
          }}
        />
      ) : null}

      {phase === 'start' && !error ? (
        <QuizStartScreen
          numQuestions={numQuestions}
          onChangeNumQuestions={setNumQuestions}
          types={types}
          onToggleType={toggleType}
          onStart={() => {
            void startQuiz(false);
          }}
        />
      ) : null}

      {phase === 'active' && currentQuestion ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-fg">
            <span className="flex items-center gap-2 font-medium">
              <BookX className="size-4" />
              {t('workspace.examModeBanner')}
            </span>
            {!examPeeked ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onPeekSource?.();
                }}
              >
                <Eye className="size-4" />
                {t('workspace.examModeViewSource')}
              </Button>
            ) : null}
          </div>
          <QuizQuestionView
            question={currentQuestion}
            index={currentIndex}
            total={activeQuestions.length}
            draftAnswer={draftAnswer}
            onChangeDraft={setDraftAnswer}
            selectedOptionIndices={selectedOptionIndices}
            onToggleOption={toggleOption}
            result={currentResult}
            isSubmitting={isSubmittingAnswer}
            onSubmit={() => {
              void submitAnswer();
            }}
            onAdvance={advance}
            isLast={currentIndex >= activeQuestions.length - 1}
            onJumpToReference={onJumpToReference}
          />
        </div>
      ) : null}

      {phase === 'results' ? (
        <QuizResultsView
          documentId={documentId}
          documentName={documentName}
          level={level}
          language={language}
          results={results}
          isLoading={isLoadingResults}
          documentWeakTopics={documentWeakTopics}
          masteryEntries={masteryEntries}
          isLoadingMastery={isLoadingMastery}
          canRetryWrong={wrongQuestions.length > 0}
          onRetryWrong={retryWrong}
          onNewQuiz={() => {
            void startQuiz(true);
          }}
          onJumpToReference={onJumpToReference}
          onMasteryUpdated={() => {
            void refreshMastery();
          }}
        />
      ) : null}
    </div>
  );
}
