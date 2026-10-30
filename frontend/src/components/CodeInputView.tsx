import { Loader2, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { PROGRAMMING_LANGUAGE_OPTIONS } from '../data/programmingLanguages';
import {
  uploadCode,
  type ChunkRecord,
  type DocumentRecord,
  type ProgrammingLanguageId,
} from '../lib/api';
import { saveUploadedDocument } from '../lib/documentStorage';
import { describeErrorDetailed } from '../lib/errors';
import { isQuotaExceeded } from '../lib/quota';

const MIN_CODE_CHARS = 10;
const TAB_INSERT = '  ';

const INPUT_CLASS =
  'w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-fg outline-none focus:border-primary';

interface CodeInputViewProps {
  /** Called once the document is confirmed and ready to open, same shape as `DocumentUploader`'s
   * prop so the two can be swapped in the same slot in `WorkspacePage`. */
  onUploaded: (document: DocumentRecord, chunks: ChunkRecord[]) => void;
  onCancel?: () => void;
  /** Pre-fills the editor, e.g. with the current document's code so it can be trimmed down. */
  initialCode?: string;
  initialFilename?: string;
}

interface PendingAmbiguousResult {
  document: DocumentRecord;
  chunks: ChunkRecord[];
}

/**
 * The "paste or write code" half of the upload choice: a language dropdown (defaulting to
 * Auto-detect), a plain monospace textarea (tab inserts spaces instead of moving focus), an
 * optional filename, and Analyze. Mirrors `DocumentUploader`'s own shape so `WorkspacePage` can
 * show either in the same place.
 */
export function CodeInputView({
  onUploaded,
  onCancel,
  initialCode = '',
  initialFilename = '',
}: CodeInputViewProps) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<ProgrammingLanguageId | 'auto'>('auto');
  const [code, setCode] = useState(initialCode);
  const [filename, setFilename] = useState(initialFilename);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When auto-detect comes back ambiguous, pause here for acknowledgement instead of silently
  // landing on an unlabeled document -- the user can still choose to proceed as-is.
  const [pendingResult, setPendingResult] = useState<PendingAmbiguousResult | null>(null);

  const canAnalyze = code.trim().length >= MIN_CODE_CHARS;

  const finish = (document: DocumentRecord, chunks: ChunkRecord[]): void => {
    saveUploadedDocument(document, chunks);
    onUploaded(document, chunks);
  };

  const analyze = (): void => {
    if (!canAnalyze || isAnalyzing) return;
    setError(null);
    setIsAnalyzing(true);
    void uploadCode({ code, language, filename: filename.trim() || undefined })
      .then((result) => {
        if (language === 'auto' && result.detected_programming_language === null) {
          setPendingResult({ document: result.document, chunks: result.chunks });
          return;
        }
        finish(result.document, result.chunks);
      })
      .catch((caught: unknown) => {
        // The app-wide quota modal already explains a used-up quota.
        if (!isQuotaExceeded(caught)) {
          setError(describeErrorDetailed(t, caught));
        }
      })
      .finally(() => {
        setIsAnalyzing(false);
      });
  };

  const handleTabKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd } = textarea;
    setCode(`${code.slice(0, selectionStart)}${TAB_INSERT}${code.slice(selectionEnd)}`);
    requestAnimationFrame(() => {
      const cursor = selectionStart + TAB_INSERT.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  if (pendingResult) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg"
        >
          {t('codeInput.autoDetectNotice')}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              finish(pendingResult.document, pendingResult.chunks);
            }}
          >
            {t('codeInput.continueAnyway')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPendingResult(null);
            }}
          >
            {t('workspace.uploadCancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <label className="block space-y-1.5 text-left">
        <span className="text-sm font-medium text-fg">{t('codeInput.languageLabel')}</span>
        <select
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value as ProgrammingLanguageId | 'auto');
          }}
          className={INPUT_CLASS}
        >
          <option value="auto">{t('codeInput.autoDetect')}</option>
          {PROGRAMMING_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5 text-left">
        <span className="text-sm font-medium text-fg">{t('codeInput.filenameLabel')}</span>
        <input
          value={filename}
          onChange={(event) => {
            setFilename(event.target.value);
          }}
          placeholder={t('codeInput.filenamePlaceholder')}
          className={INPUT_CLASS}
        />
      </label>

      <textarea
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
        }}
        onKeyDown={handleTabKey}
        placeholder={t('codeInput.placeholder')}
        rows={16}
        spellCheck={false}
        data-testid="code-input-textarea"
        className="w-full rounded-2xl border border-border bg-surface-muted px-4 py-3 font-mono text-sm leading-6 text-fg outline-none focus:border-primary"
      />

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-error/40 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={analyze} disabled={!canAnalyze || isAnalyzing}>
          {isAnalyzing ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          {isAnalyzing ? t('codeInput.analyzing') : t('codeInput.analyze')}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={isAnalyzing}>
            <X aria-hidden className="size-4" />
            {t('workspace.uploadCancel')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
