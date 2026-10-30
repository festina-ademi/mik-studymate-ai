import { ArrowLeft, MessageCircle, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatMessageBubble, type ChatMessage } from './ChatMessageBubble';
import { Button } from '../Button';
import { ErrorState } from '../ErrorState';
import { Skeleton } from '../Skeleton';
import {
  askTutorQuestion,
  clearTutorHistory,
  listTutorHistory,
  type ApiLanguage,
  type DocumentKind,
} from '../../lib/api';
import type { StudyLevel } from '../../hooks/useLevel';
import { describeError } from '../../lib/errors';

const QUICK_ACTIONS = [
  {
    key: 'simpler',
    labelKey: 'workspace.tutorQuickSimpler',
    messageKey: 'workspace.tutorQuickSimplerMessage',
  },
  {
    key: 'example',
    labelKey: 'workspace.tutorQuickExample',
    messageKey: 'workspace.tutorQuickExampleMessage',
  },
  {
    key: 'test',
    labelKey: 'workspace.tutorQuickTest',
    messageKey: 'workspace.tutorQuickTestMessage',
  },
  {
    key: 'summarize',
    labelKey: 'workspace.tutorQuickSummarize',
    messageKey: 'workspace.tutorQuickSummarizeMessage',
  },
] as const;

interface TutorPanelProps {
  documentId: string;
  contentType: DocumentKind;
  level: StudyLevel;
  language: ApiLanguage;
  onJumpToReference: (reference: string) => void;
  /** Focus the message input on mount (the learner arrived via the Avatar tab's "Ask"). */
  autoFocusInput?: boolean;
  /** When set, a "Back to the Teacher" button is shown above the chat (the learner arrived via
   * the Avatar tab's "Ask"); clicking it calls this. */
  onBackToTeacher?: (() => void) | null;
  /** Called each time the learner sends a message. */
  onMessageSent?: () => void;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `local-${String(localIdCounter)}`;
}

/**
 * The Chat tab, user-facing name for what's still called "Tutor" internally (component/file
 * names and API routes were left alone to avoid a wide, low-value rename): a streaming, grounded
 * chat. The caller renders this with `key={documentId}` so switching documents naturally
 * remounts it with fresh state. The Avatar tab's "Ask" button opens this tab directly (see
 * `onBackToTeacher`), so every question lives in this one conversation.
 */
export function TutorPanel({
  documentId,
  contentType,
  level,
  language,
  onJumpToReference,
  autoFocusInput = false,
  onBackToTeacher = null,
  onMessageSent,
}: TutorPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocusInput) inputRef.current?.focus();
    // Only on mount: arriving from the Avatar tab, not on every later re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const history = await listTutorHistory(documentId);
        setMessages([
          ...history.map((entry) => ({
            id: entry.id === null ? nextLocalId() : `server-${String(entry.id)}`,
            role: entry.role,
            content: entry.content,
            citations: entry.citations,
          })),
        ]);
        setFollowUpQuestions(history[history.length - 1]?.follow_up_questions ?? []);
      } catch (caught: unknown) {
        setError(describeError(t, caught));
      } finally {
        setIsLoadingHistory(false);
      }
    })();
  }, [documentId, t]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || isSending) {
        return;
      }
      setError(null);
      setDraft('');
      setFollowUpQuestions([]);
      onMessageSent?.();
      const assistantId = nextLocalId();
      setMessages((previous) => [
        ...previous,
        { id: nextLocalId(), role: 'user', content: trimmed, citations: [] },
        { id: assistantId, role: 'assistant', content: '', citations: [], isStreaming: true },
      ]);
      setIsSending(true);
      try {
        const response = await askTutorQuestion({
          documentId,
          message: trimmed,
          level,
          language,
          stream: true,
          onToken: (piece) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + piece }
                  : message,
              ),
            );
          },
        });
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: response.answer,
                  citations: response.citations,
                  isStreaming: false,
                }
              : message,
          ),
        );
        setFollowUpQuestions(response.follow_up_questions);
      } catch (caught: unknown) {
        setMessages((previous) => previous.filter((message) => message.id !== assistantId));
        setError(describeError(t, caught));
      } finally {
        setIsSending(false);
      }
    },
    [documentId, isSending, language, level, onMessageSent, t],
  );

  const handleClear = (): void => {
    void clearTutorHistory(documentId)
      .then(() => {
        setMessages([]);
        setFollowUpQuestions([]);
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
      });
  };

  const exampleQuestions =
    contentType === 'code'
      ? [
          t('workspace.tutorExampleCode1'),
          t('workspace.tutorExampleCode2'),
          t('workspace.tutorExampleCode3'),
        ]
      : [
          t('workspace.tutorExampleLecture1'),
          t('workspace.tutorExampleLecture2'),
          t('workspace.tutorExampleLecture3'),
        ];

  return (
    // A tall min/max band -- proportional to the Original Material panel next to it -- rather
    // than a single fixed height (Phase 9.1 widened Phase 8.3's narrower 60/70vh cap). The
    // message list below is still the only part that scrolls; header, quick actions and the
    // input stay pinned.
    <div className="flex min-h-[65vh] max-h-[75vh] flex-col gap-4 sm:min-h-[75vh] sm:max-h-[85vh]">
      {onBackToTeacher ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={onBackToTeacher}>
          <ArrowLeft className="size-4" />
          {t('workspace.tutorBackToTeacher')}
        </Button>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{t('workspace.tutorTitle')}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          ariaLabel={t('workspace.tutorClear')}
        >
          {t('workspace.tutorClear')}
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface-muted p-3">
        {isLoadingHistory ? (
          <Skeleton lines={4} />
        ) : error ? (
          <ErrorState
            title={t('workspace.errorTitle')}
            description={error}
            onRetry={() => {
              setError(null);
            }}
          />
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-4 text-center">
            <div className="rounded-xl bg-primary-soft p-3 text-primary-soft-fg">
              <MessageCircle className="size-5" />
            </div>
            <p className="text-sm text-fg-muted">{t('workspace.tutorEmpty')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {exampleQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => {
                    void sendMessage(question);
                  }}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessageBubble
                key={message.id}
                message={message}
                onJumpToReference={onJumpToReference}
              />
            ))}
            {followUpQuestions.length > 0 && !isSending ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                  {t('workspace.tutorFollowUpLabel')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {followUpQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => {
                        void sendMessage(question);
                      }}
                      className="rounded-full border border-primary/30 bg-primary-soft px-3 py-1.5 text-xs text-primary-soft-fg"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={isSending}
              onClick={() => {
                void sendMessage(t(action.messageKey));
              }}
              className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs text-fg-muted transition hover:text-fg disabled:pointer-events-none disabled:opacity-50"
            >
              {t(action.labelKey)}
            </button>
          ))}
        </div>
        <textarea
          id="chat-input"
          ref={inputRef}
          aria-label={t('workspace.tutorPlaceholder')}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage(draft);
            }
          }}
          rows={3}
          className="w-full rounded-2xl border border-border bg-surface-muted px-3 py-3 text-sm text-fg outline-none transition focus:border-primary"
          placeholder={t('workspace.tutorPlaceholder')}
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              void sendMessage(draft);
            }}
            disabled={isSending || !draft.trim()}
          >
            <SendHorizontal className="size-4" />
            {isSending ? t('workspace.tutorSending') : t('workspace.tutorAsk')}
          </Button>
        </div>
      </div>
    </div>
  );
}
