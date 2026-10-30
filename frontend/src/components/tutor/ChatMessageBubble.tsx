import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { PrettyMarkdown } from '../PrettyMarkdown';
import type { TutorCitation } from '../../lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: TutorCitation[];
  isStreaming?: boolean;
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  onJumpToReference: (reference: string) => void;
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-hidden="true">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="size-1.5 rounded-full bg-fg-muted"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </span>
  );
}

export function ChatMessageBubble({ message, onJumpToReference }: ChatMessageBubbleProps) {
  const { t } = useTranslation();
  const isAssistant = message.role === 'assistant';
  const showTyping = isAssistant && message.isStreaming && !message.content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-3 ${isAssistant ? 'border-primary/30 bg-primary-soft' : 'border-border bg-surface'}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
        <span>{isAssistant ? t('workspace.tutorAssistant') : t('workspace.tutorYou')}</span>
        {message.citations.length > 0 ? (
          <span>{t('workspace.tutorSourceCount', { count: message.citations.length })}</span>
        ) : null}
      </div>
      {showTyping ? (
        <TypingIndicator />
      ) : (
        <div className="text-sm leading-6 text-fg">
          <PrettyMarkdown value={message.content} className="prose-sm" />
        </div>
      )}
      {message.citations.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.citations.map((citation) => (
            <button
              key={citation.reference}
              type="button"
              onClick={() => {
                onJumpToReference(citation.reference);
              }}
              className="rounded-full border border-primary/40 bg-surface px-2.5 py-1 text-[11px] font-medium text-primary"
            >
              {citation.reference}
            </button>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
