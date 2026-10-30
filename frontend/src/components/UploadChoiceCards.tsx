import { Code2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface UploadChoiceCardsProps {
  onChooseDocument: () => void;
  onChooseCode: () => void;
}

/** Two large cards: "Upload a document" or "Paste or write code" -- shared between the empty
 * workspace state (shown inline) and the "Upload a new document" button (shown in a modal). */
export function UploadChoiceCards({ onChooseDocument, onChooseCode }: UploadChoiceCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <button
        type="button"
        onClick={onChooseDocument}
        className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center transition hover:border-primary/50 hover:bg-surface-muted"
      >
        <span className="rounded-2xl bg-primary-soft p-4 text-primary-soft-fg">
          <FileText aria-hidden className="size-7" />
        </span>
        <span className="text-lg font-semibold text-fg">{t('upload.documentTitle')}</span>
        <span className="text-sm text-fg-muted">{t('upload.documentSubtitle')}</span>
      </button>
      <button
        type="button"
        onClick={onChooseCode}
        className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-center transition hover:border-primary/50 hover:bg-surface-muted"
      >
        <span className="rounded-2xl bg-primary-soft p-4 text-primary-soft-fg">
          <Code2 aria-hidden className="size-7" />
        </span>
        <span className="text-lg font-semibold text-fg">{t('upload.codeTitle')}</span>
        <span className="text-sm text-fg-muted">{t('upload.codeSubtitle')}</span>
      </button>
    </div>
  );
}
