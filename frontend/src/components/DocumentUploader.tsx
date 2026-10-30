import { CloudUpload, FileText, Loader2, X } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { uploadDocuments, type ChunkRecord, type DocumentRecord } from '../lib/api';
import { saveUploadedDocument } from '../lib/documentStorage';
import { describeErrorDetailed } from '../lib/errors';
import { isQuotaExceeded } from '../lib/quota';
import { ACCEPTED_EXTENSIONS, formatFileSize } from '../lib/uploadTypes';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';

interface DocumentUploaderProps {
  /** Called after the document has been stored where the workspace reads it from. */
  onUploaded: (document: DocumentRecord, chunks: ChunkRecord[]) => void;
  onCancel?: () => void;
}

/**
 * Workspace upload: choose (or drop) a file, see its name and size, then "Process document"
 * sends it to `POST /api/documents`. The backend's real error is shown if that fails.
 */
export function DocumentUploader({ onUploaded, onCancel }: DocumentUploaderProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (list: FileList | File[]): void => {
    const next = Array.from(list);
    if (next.length > 0) {
      setFiles(next);
      setError(null);
    }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.target.files) choose(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    choose(event.dataTransfer.files);
  };

  const process = (): void => {
    setError(null);
    setIsUploading(true);
    void uploadDocuments(files)
      .then((results) => {
        const result = results[0];
        if (!result) {
          throw new Error('empty upload response');
        }
        saveUploadedDocument(result.document, result.chunks);
        onUploaded(result.document, result.chunks);
      })
      .catch((caught: unknown) => {
        // The app-wide quota modal already explains a used-up quota.
        if (!isQuotaExceeded(caught)) {
          setError(describeErrorDetailed(t, caught));
        }
      })
      .finally(() => {
        setIsUploading(false);
      });
  };

  const openPicker = (): void => {
    inputRef.current?.click();
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-labelledby={labelId}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => {
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-[1.75rem] border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDragging
            ? 'border-primary bg-primary-soft'
            : 'border-border bg-surface hover:border-primary/50'
        }`}
      >
        <input
          ref={inputRef}
          data-testid="workspace-file-input"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleInput}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
        <div className="rounded-2xl bg-primary-soft p-4 text-primary-soft-fg">
          <CloudUpload aria-hidden className="size-7" />
        </div>
        <div className="space-y-1.5">
          <p id={labelId} className="text-xl font-semibold text-fg">
            {t('workspace.uploadTitle')}
          </p>
          <p className="max-w-md text-sm leading-6 text-fg-muted">
            {t('workspace.uploadDescription')}
          </p>
        </div>
      </div>

      {files.length > 0 ? (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={`${file.name}-${String(file.size)}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            >
              <FileText aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{file.name}</span>
              <span className="shrink-0 text-fg-muted">{formatFileSize(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isUploading ? <ProgressBar value={70} label={t('workspace.uploadProcessing')} /> : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-error/40 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={process} disabled={files.length === 0 || isUploading}>
          {isUploading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          {t('workspace.uploadProcess')}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={isUploading}>
            <X aria-hidden className="size-4" />
            {t('workspace.uploadCancel')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
