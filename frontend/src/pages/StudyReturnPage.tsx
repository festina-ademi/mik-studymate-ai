import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StudyTestFlow } from '../components/study/StudyTestFlow';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import {
  getStudyRetentionStatus,
  submitStudyRetentionTest,
  type StudyRetentionStatus,
} from '../lib/api';
import { describeError } from '../lib/errors';

type Phase = 'enterCode' | 'checking' | 'locked' | 'test' | 'done' | 'error';

/** The retention-test return flow: enter a code, then either the test (once unlocked) or the
 * unlock date. See docs/STUDY_PROTOCOL.md section 3, step 10. */
export function StudyReturnPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('enterCode');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<StudyRetentionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkCode = (): void => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setPhase('checking');
    setError(null);
    void getStudyRetentionStatus(trimmed)
      .then((found) => {
        setStatus(found);
        if (found.already_submitted) {
          setPhase('done');
        } else if (found.unlocked && found.test) {
          setPhase('test');
        } else {
          setPhase('locked');
        }
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
        setPhase('error');
      });
  };

  const submit = (answers: { item_id: number; answer: string }[]): void => {
    const trimmed = code.trim().toUpperCase();
    setIsSubmitting(true);
    setError(null);
    void submitStudyRetentionTest(trimmed, answers)
      .then(() => {
        setPhase('done');
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <div className="mx-auto max-w-2xl">
      {phase === 'enterCode' || phase === 'checking' || phase === 'error' ? (
        <Card className="mx-auto max-w-md space-y-5 p-8 text-center">
          <h1 className="text-2xl font-semibold text-fg">{t('study.returnTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('study.returnDescription')}</p>
          {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
          <input
            type="text"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') checkCode();
            }}
            placeholder="P-7K2M"
            className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-center font-mono text-lg tracking-widest text-fg outline-none focus:border-primary"
          />
          <Button
            variant="primary"
            onClick={checkCode}
            disabled={!code.trim() || phase === 'checking'}
          >
            {t('study.returnSubmit')}
          </Button>
        </Card>
      ) : phase === 'locked' && status ? (
        <Card className="mx-auto max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-fg">{t('study.returnLockedTitle')}</h1>
          <p className="text-sm text-fg-muted">
            {t('study.returnLockedDescription', {
              date: new Date(status.unlock_at).toLocaleString(),
            })}
          </p>
        </Card>
      ) : phase === 'test' && status?.test ? (
        <StudyTestFlow test={status.test} onSubmit={submit} isSubmitting={isSubmitting} />
      ) : phase === 'done' ? (
        <Card className="mx-auto max-w-md space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-fg">{t('study.returnDoneTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('study.returnDoneDescription')}</p>
        </Card>
      ) : null}
    </div>
  );
}
