import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../Button';
import { ProgressBar } from '../ProgressBar';
import type { StudyTestPublic } from '../../lib/api';

interface StudyTestFlowProps {
  test: StudyTestPublic;
  onSubmit: (answers: { item_id: number; answer: string }[]) => void;
  isSubmitting: boolean;
}

/**
 * The study test: one item per page, no way back once an item is submitted, and no answer key
 * or per-item correctness shown at any point — used for both the immediate and the retention
 * sitting of the same researcher-authored test (see docs/STUDY_PROTOCOL.md section 3).
 */
export function StudyTestFlow({ test, onSubmit, isSubmitting }: StudyTestFlowProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [answers, setAnswers] = useState<{ item_id: number; answer: string }[]>([]);

  const item = test.items[index];
  if (!item) {
    return null;
  }
  const isLast = index >= test.items.length - 1;

  const advance = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    const nextAnswers = [...answers, { item_id: item.id, answer: trimmed }];
    if (isLast) {
      onSubmit(nextAnswers);
      return;
    }
    setAnswers(nextAnswers);
    setDraft('');
    setIndex((value) => value + 1);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProgressBar
        value={((index + 1) / test.items.length) * 100}
        label={t('study.testProgress', { current: index + 1, total: test.items.length })}
      />

      <div className="rounded-2xl border border-border bg-surface-muted p-5">
        <p className="text-base font-semibold text-fg">{item.question}</p>
      </div>

      {item.kind === 'multiple_choice' ? (
        <div className="space-y-2">
          {item.options.map((option, optionIndex) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setDraft(option);
              }}
              aria-label={`${String(optionIndex + 1)} ${option}`}
              aria-pressed={draft === option}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                draft === option
                  ? 'border-primary bg-primary-soft text-primary-soft-fg'
                  : 'border-border bg-surface text-fg hover:bg-surface-muted'
              }`}
            >
              <span className="inline-flex size-6 items-center justify-center rounded-full border border-current text-xs font-semibold">
                {optionIndex + 1}
              </span>
              {option}
            </button>
          ))}
        </div>
      ) : (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-fg-muted">{t('study.testAnswerLabel')}</span>
          <textarea
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            rows={5}
            className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-sm text-fg outline-none transition focus:border-primary"
            placeholder={t('study.testAnswerLabel')}
          />
        </label>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={advance} disabled={!draft.trim() || isSubmitting}>
          {isLast ? t('study.testSubmit') : t('study.testNext')}
        </Button>
      </div>
      <p className="text-center text-xs text-fg-muted">{t('study.testNoGoingBack')}</p>
    </div>
  );
}
