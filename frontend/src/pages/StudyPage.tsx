import { Check, Copy, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ControlViewer } from '../components/study/ControlViewer';
import { StudyTestFlow } from '../components/study/StudyTestFlow';
import { StudyTimerBar } from '../components/study/StudyTimerBar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ErrorState } from '../components/ErrorState';
import { SegmentedControl } from '../components/SegmentedControl';
import { Skeleton } from '../components/Skeleton';
import {
  createStudyParticipant,
  getStudyImmediateTest,
  getStudyParticipant,
  logStudyUsageEvent,
  startStudyTimer,
  submitStudyImmediateTest,
  submitStudyQuestionnaire,
  withdrawStudyParticipant,
  type ApiLanguage,
  type StudyParticipant,
  type StudyTestPublic,
} from '../lib/api';
import { describeError } from '../lib/errors';
import i18n, { SUPPORTED_LANGUAGES } from '../i18n';
import { WorkspacePage } from './WorkspacePage';
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage';

type FlowPhase =
  | 'loading'
  | 'language'
  | 'consent'
  | 'code'
  | 'session'
  | 'test'
  | 'questionnaire'
  | 'thankyou'
  | 'error';

function readSavedCode(): string | null {
  return readStorage(STORAGE_KEYS.studyParticipantCode);
}

function saveCode(code: string | null): void {
  if (code) {
    writeStorage(STORAGE_KEYS.studyParticipantCode, code);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.studyParticipantCode);
  }
}

function phaseAfterFetch(participant: StudyParticipant): FlowPhase {
  if (participant.withdrawn) return 'language';
  if (!participant.immediate_submitted) return 'session';
  if (participant.group === 'experimental' && !participant.questionnaire_submitted) {
    return 'questionnaire';
  }
  return 'thankyou';
}

/** The full Study Mode participant flow: language -> consent -> code -> session -> test ->
 * questionnaire (experimental only) -> thank-you. See docs/STUDY_PROTOCOL.md section 3. */
export function StudyPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<FlowPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [participant, setParticipant] = useState<StudyParticipant | null>(null);
  const [test, setTest] = useState<StudyTestPublic | null>(null);
  const [isSubmittingTest, setIsSubmittingTest] = useState(false);
  const [usefulness, setUsefulness] = useState(4);
  const [ease, setEase] = useState(4);
  const [comment, setComment] = useState('');
  const [isSubmittingQuestionnaire, setIsSubmittingQuestionnaire] = useState(false);

  useEffect(() => {
    const run = async (): Promise<void> => {
      const code = readSavedCode();
      if (!code) {
        setPhase('language');
        return;
      }
      try {
        const found = await getStudyParticipant(code);
        setParticipant(found);
        const next = phaseAfterFetch(found);
        if (next === 'language') {
          saveCode(null);
        }
        setPhase(next);
      } catch {
        saveCode(null);
        setPhase('language');
      }
    };
    void run();
  }, []);

  const chooseLanguage = (language: ApiLanguage): void => {
    void i18n.changeLanguage(language);
    setPhase('consent');
  };

  const acceptConsent = async (): Promise<void> => {
    setError(null);
    setPhase('loading');
    try {
      const created = await createStudyParticipant({
        language: i18n.language === 'sq' ? 'sq' : 'en',
        consent: true,
      });
      saveCode(created.code);
      setParticipant(created);
      setPhase('code');
    } catch (caught: unknown) {
      setError(describeError(t, caught));
      setPhase('error');
    }
  };

  const confirmCodeSaved = async (): Promise<void> => {
    if (!participant) return;
    setPhase('session');
    try {
      await startStudyTimer(participant.code);
      if (participant.group === 'experimental') {
        void logStudyUsageEvent(participant.code, 'tab_view', 'summary');
      }
    } catch {
      // The timer status poll will retry; a failed "start" call is not fatal here.
    }
  };

  const handleTimerExpired = useCallback((): void => {
    if (!participant) return;
    setPhase('loading');
    void getStudyImmediateTest(participant.code)
      .then((fetchedTest) => {
        setTest(fetchedTest);
        setPhase('test');
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
        setPhase('error');
      });
  }, [participant, t]);

  const submitTest = (answers: { item_id: number; answer: string }[]): void => {
    if (!participant) return;
    setIsSubmittingTest(true);
    setError(null);
    void submitStudyImmediateTest(participant.code, answers)
      .then(() => {
        setParticipant((current) =>
          current ? { ...current, immediate_submitted: true } : current,
        );
        setPhase(participant.group === 'experimental' ? 'questionnaire' : 'thankyou');
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsSubmittingTest(false);
      });
  };

  const submitQuestionnaire = (): void => {
    if (!participant) return;
    setIsSubmittingQuestionnaire(true);
    setError(null);
    void submitStudyQuestionnaire(participant.code, {
      perceived_usefulness: usefulness,
      ease_of_understanding: ease,
      open_comment: comment.trim() || undefined,
    })
      .then(() => {
        setPhase('thankyou');
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      })
      .finally(() => {
        setIsSubmittingQuestionnaire(false);
      });
  };

  const withdraw = (): void => {
    if (!participant) return;
    if (!window.confirm(t('study.withdrawConfirm'))) return;
    void withdrawStudyParticipant(participant.code).then(() => {
      saveCode(null);
      setParticipant(null);
      setPhase('language');
    });
  };

  const [copied, setCopied] = useState(false);
  const copyCode = (): void => {
    if (!participant) return;
    void navigator.clipboard
      .writeText(participant.code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => undefined);
  };

  const showWithdraw = phase === 'session' || phase === 'test' || phase === 'questionnaire';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {showWithdraw && participant ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={withdraw}>
            <ShieldAlert className="size-4" />
            {t('study.withdraw')}
          </Button>
        </div>
      ) : null}

      {phase === 'loading' ? (
        <Card className="p-6">
          <Skeleton lines={6} />
        </Card>
      ) : phase === 'error' ? (
        <ErrorState
          title={t('workspace.errorTitle')}
          description={error ?? t('errors.unknown')}
          onRetry={() => {
            setError(null);
            setPhase('language');
          }}
        />
      ) : phase === 'language' ? (
        <Card className="mx-auto max-w-lg space-y-6 p-8 text-center">
          <h1 className="text-2xl font-semibold text-fg">{t('study.languageTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('study.languageDescription')}</p>
          <div className="flex justify-center gap-3">
            {SUPPORTED_LANGUAGES.map((language) => (
              <Button
                key={language}
                variant="secondary"
                size="lg"
                onClick={() => {
                  chooseLanguage(language);
                }}
              >
                {language === 'sq' ? 'Shqip' : 'English'}
              </Button>
            ))}
          </div>
        </Card>
      ) : phase === 'consent' ? (
        <Card className="mx-auto max-w-2xl space-y-5 p-8">
          <h1 className="text-2xl font-semibold text-fg">{t('study.consentTitle')}</h1>
          <div className="space-y-3 text-sm leading-6 text-fg">
            <p>{t('study.consentPurpose')}</p>
            <p>{t('study.consentVoluntary')}</p>
            <p>{t('study.consentWithdraw')}</p>
            <p>{t('study.consentData')}</p>
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
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                void acceptConsent();
              }}
            >
              {t('study.consentAccept')}
            </Button>
          </div>
        </Card>
      ) : phase === 'code' && participant ? (
        <Card className="mx-auto max-w-lg space-y-6 p-8 text-center">
          <h1 className="text-2xl font-semibold text-fg">{t('study.codeTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('study.codeDescription')}</p>
          <div className="flex items-center justify-center gap-3">
            <span className="rounded-2xl border border-primary/30 bg-primary-soft px-6 py-3 font-mono text-2xl font-semibold tracking-widest text-primary-soft-fg">
              {participant.code}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={copyCode}
              ariaLabel={t('study.codeCopy')}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-xs font-medium text-warning">{t('study.codeWarning')}</p>
          <Button
            variant="primary"
            onClick={() => {
              void confirmCodeSaved();
            }}
          >
            {t('study.codeContinue')}
          </Button>
        </Card>
      ) : phase === 'session' && participant ? (
        <div>
          <StudyTimerBar code={participant.code} onExpired={handleTimerExpired} />
          {participant.group === 'control' || !participant.document_id ? (
            <ControlViewer documentId={participant.document_id ?? ''} />
          ) : (
            <WorkspacePage
              onTabChange={(nextTab) => {
                void logStudyUsageEvent(participant.code, 'tab_view', nextTab);
              }}
              onQuizAttempt={() => {
                void logStudyUsageEvent(participant.code, 'quiz_attempt');
              }}
            />
          )}
        </div>
      ) : phase === 'test' && test ? (
        <StudyTestFlow test={test} onSubmit={submitTest} isSubmitting={isSubmittingTest} />
      ) : phase === 'questionnaire' ? (
        <Card className="mx-auto max-w-xl space-y-6 p-8">
          <h1 className="text-2xl font-semibold text-fg">{t('study.questionnaireTitle')}</h1>
          {error ? <ErrorState title={t('workspace.errorTitle')} description={error} /> : null}
          <div className="space-y-3">
            <p className="text-sm font-medium text-fg">{t('study.questionnaireUsefulness')}</p>
            <LikertScale value={usefulness} onChange={setUsefulness} />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-fg">{t('study.questionnaireEase')}</p>
            <LikertScale value={ease} onChange={setEase} />
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-fg">{t('study.questionnaireComment')}</span>
            <textarea
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
              }}
              rows={4}
              className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-sm text-fg outline-none transition focus:border-primary"
            />
          </label>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={submitQuestionnaire}
              disabled={isSubmittingQuestionnaire}
            >
              {t('study.questionnaireSubmit')}
            </Button>
          </div>
        </Card>
      ) : phase === 'thankyou' && participant ? (
        <Card className="mx-auto max-w-lg space-y-4 p-8 text-center">
          <h1 className="text-2xl font-semibold text-fg">{t('study.thankYouTitle')}</h1>
          <p className="text-sm text-fg-muted">{t('study.thankYouDescription')}</p>
          <span className="mx-auto inline-block rounded-2xl border border-primary/30 bg-primary-soft px-6 py-3 font-mono text-xl font-semibold tracking-widest text-primary-soft-fg">
            {participant.code}
          </span>
          {participant.retention_unlock_at ? (
            <p className="text-sm text-fg">
              {t('study.thankYouRetentionDate', {
                date: new Date(participant.retention_unlock_at).toLocaleString(),
              })}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function LikertScale({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      label={t('study.likertLabel')}
      value={String(value)}
      onChange={(next) => {
        onChange(Number(next));
      }}
      options={[1, 2, 3, 4, 5].map((option) => ({
        value: String(option),
        label: String(option),
        ariaLabel: String(option),
      }))}
    />
  );
}
