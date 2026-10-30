import { motion } from 'framer-motion';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../Button';
import type { QuestionKind } from '../../lib/api';

const QUESTION_COUNT_OPTIONS = [4, 8, 12] as const;
const TYPE_OPTIONS: { value: QuestionKind; labelKey: string }[] = [
  { value: 'multiple_choice', labelKey: 'workspace.quizTypeMultipleChoice' },
  { value: 'short_answer', labelKey: 'workspace.quizTypeShortAnswer' },
];

interface QuizStartScreenProps {
  numQuestions: number;
  onChangeNumQuestions: (value: number) => void;
  types: QuestionKind[];
  onToggleType: (value: QuestionKind) => void;
  onStart: () => void;
}

export function QuizStartScreen({
  numQuestions,
  onChangeNumQuestions,
  types,
  onToggleType,
  onStart,
}: QuizStartScreenProps) {
  const { t } = useTranslation();
  const typeHintId = useId();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5 rounded-2xl border border-border bg-surface-muted p-5"
    >
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-fg-muted">
          {t('workspace.quizOverviewTitle')}
        </p>
        <h3 className="text-2xl font-semibold text-fg">{t('workspace.quizStartTitle')}</h3>
      </div>

      <p className="text-sm leading-6 text-fg-muted">{t('workspace.quizStartSubtitle')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.08em] text-fg-muted">
            {t('workspace.quizQuestionCountLabel')}
          </p>
          <div
            className="flex gap-2"
            role="group"
            aria-label={t('workspace.quizQuestionCountLabel')}
          >
            {QUESTION_COUNT_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={numQuestions === count}
                onClick={() => {
                  onChangeNumQuestions(count);
                }}
                className={`h-10 flex-1 rounded-xl border text-sm font-medium transition ${
                  numQuestions === count
                    ? 'border-primary bg-primary-soft text-primary-soft-fg'
                    : 'border-border bg-surface text-fg-muted hover:text-fg'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.08em] text-fg-muted">
            {t('workspace.quizTypeLabel')}
          </p>
          <div
            className="flex flex-col gap-2"
            role="group"
            aria-label={t('workspace.quizTypeLabel')}
            aria-describedby={typeHintId}
          >
            {TYPE_OPTIONS.map((option) => {
              const checked = types.includes(option.value);
              // At least one type must stay selected, so the last checked one can't be cleared.
              const isLastChecked = checked && types.length === 1;
              return (
                <label
                  key={option.value}
                  className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLastChecked}
                    onChange={() => {
                      onToggleType(option.value);
                    }}
                    className="size-4 accent-primary"
                  />
                  {t(option.labelKey)}
                </label>
              );
            })}
          </div>
          <p id={typeHintId} className="text-xs text-fg-muted">
            {t('workspace.quizTypeAtLeastOne')}
          </p>
        </div>
      </div>

      <Button variant="primary" onClick={onStart} disabled={types.length === 0}>
        {t('workspace.quizStart')}
      </Button>
    </motion.div>
  );
}
