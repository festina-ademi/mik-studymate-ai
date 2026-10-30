import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../Badge';
import { Button } from '../Button';
import { ProgressBar } from '../ProgressBar';
import type { QuizAnswerResult, QuizQuestionRecord } from '../../lib/api';

function sourceChipLabel(input: string): string {
  return input;
}

interface QuizQuestionViewProps {
  question: QuizQuestionRecord;
  index: number;
  total: number;
  draftAnswer: string;
  onChangeDraft: (value: string) => void;
  /** The one selected option index for a multiple_choice question, as a single-element array
   * (or empty before anything is picked). Ignored for short_answer. */
  selectedOptionIndices: number[];
  onToggleOption: (optionIndex: number) => void;
  result: QuizAnswerResult | null;
  isSubmitting: boolean;
  onSubmit: () => void;
  onAdvance: () => void;
  isLast: boolean;
  onJumpToReference: (reference: string) => void;
}

export function QuizQuestionView({
  question,
  index,
  total,
  draftAnswer,
  onChangeDraft,
  selectedOptionIndices,
  onToggleOption,
  result,
  isSubmitting,
  onSubmit,
  onAdvance,
  isLast,
  onJumpToReference,
}: QuizQuestionViewProps) {
  const { t } = useTranslation();
  const isMultipleChoice = question.kind === 'multiple_choice';
  const canSubmit = isMultipleChoice
    ? selectedOptionIndices.length > 0
    : draftAnswer.trim().length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMultipleChoice && !result) {
        const optionIndex = Number.parseInt(event.key, 10) - 1;
        if (optionIndex >= 0 && optionIndex < question.options.length) {
          event.preventDefault();
          onToggleOption(optionIndex);
          return;
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        if (result) {
          event.preventDefault();
          onAdvance();
        } else if (canSubmit && !isSubmitting) {
          event.preventDefault();
          onSubmit();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    canSubmit,
    isMultipleChoice,
    isSubmitting,
    onAdvance,
    onSubmit,
    onToggleOption,
    question,
    result,
  ]);

  return (
    <motion.div
      key={question.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-fg-muted">
            {t('workspace.quizProgress', { current: index + 1, total })}
          </span>
          <div className="flex items-center gap-2">
            <Badge>{question.topic}</Badge>
            <Badge>{t(`workspace.quizDifficulty_${question.difficulty}`)}</Badge>
          </div>
        </div>
        <ProgressBar
          value={((index + 1) / total) * 100}
          label={t('workspace.quizProgress', { current: index + 1, total })}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface-muted p-4">
        <p className="text-base font-semibold text-fg">{question.question}</p>
      </div>

      {isMultipleChoice ? (
        <div className="space-y-2" role="radiogroup" aria-label={question.question}>
          {question.options.map((option, optionIndex) => {
            const isPicked = selectedOptionIndices.includes(optionIndex);
            const isCorrectOption = (result?.correct_option_indices ?? []).includes(optionIndex);
            const isWrongPick = Boolean(result) && isPicked && !isCorrectOption;

            return (
              <label
                key={option}
                className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-3 py-3 text-left transition ${
                  result
                    ? isCorrectOption
                      ? 'border-success bg-success/10 text-success'
                      : isWrongPick
                        ? 'border-error bg-error/10 text-error'
                        : 'border-border bg-surface text-fg-muted'
                    : isPicked
                      ? 'border-primary bg-primary-soft text-primary-soft-fg'
                      : 'border-border bg-surface text-fg hover:bg-surface-muted'
                } ${result ? 'cursor-default' : ''}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name={`question-${String(question.id)}`}
                    checked={isPicked}
                    disabled={Boolean(result)}
                    onChange={() => {
                      if (!result) onToggleOption(optionIndex);
                    }}
                    aria-label={`${String(optionIndex + 1)} ${option}`}
                    className="size-4 accent-primary"
                  />
                  <span className="inline-flex size-6 items-center justify-center rounded-full border border-current text-xs font-semibold">
                    {optionIndex + 1}
                  </span>
                  {option}
                </span>
                {result && isCorrectOption ? <span className="text-xs font-medium">✓</span> : null}
              </label>
            );
          })}
        </div>
      ) : (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-fg-muted">
            {t('workspace.quizAnswerLabel')}
          </span>
          <textarea
            value={draftAnswer}
            disabled={Boolean(result)}
            onChange={(event) => {
              onChangeDraft(event.target.value);
            }}
            rows={4}
            className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-sm text-fg outline-none transition focus:border-primary"
            placeholder={t('workspace.quizAnswerLabel')}
          />
        </label>
      )}

      {result ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`space-y-2 rounded-2xl border p-4 ${
            result.correct
              ? 'border-success bg-success/10 text-success'
              : 'border-error bg-error/10 text-error'
          }`}
        >
          <p className="text-sm font-semibold">
            {result.correct ? t('workspace.quizCorrect') : t('workspace.quizIncorrect')}
            {question.kind === 'short_answer'
              ? ` · ${t('workspace.quizScoreLabel')}: ${String(Math.round(result.score * 100))}%`
              : null}
          </p>
          {isMultipleChoice ? (
            <p className="text-sm">
              {t('workspace.quizExpected')}: {result.expected}
            </p>
          ) : null}
          {result.explanation ? (
            <p className="text-sm">
              {t('workspace.quizExplanation')}: {result.explanation}
            </p>
          ) : null}
          {result.feedback ? <p className="text-sm">{result.feedback}</p> : null}
          {result.missing_key_points.length > 0 ? (
            <div className="text-sm">
              <p className="font-medium">{t('workspace.quizMissingKeyPoints')}:</p>
              <ul className="list-disc pl-5">
                {result.missing_key_points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {question.source_reference ? (
            <button
              type="button"
              onClick={() => {
                onJumpToReference(question.source_reference ?? '');
              }}
              className="mt-1 inline-flex rounded-full border border-current px-2.5 py-1 text-xs font-medium"
            >
              {t('workspace.quizSourceReference')}: {sourceChipLabel(question.source_reference)}
            </button>
          ) : null}
        </motion.div>
      ) : null}

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={result ? onAdvance : onSubmit}
          disabled={result ? false : !canSubmit || isSubmitting}
        >
          {result
            ? isLast
              ? t('workspace.quizFinish')
              : t('workspace.quizNext')
            : t('workspace.quizSubmit')}
        </Button>
      </div>
    </motion.div>
  );
}
