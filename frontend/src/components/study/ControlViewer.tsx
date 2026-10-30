import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '../Card';
import { ErrorState } from '../ErrorState';
import { Skeleton } from '../Skeleton';
import {
  getDocument,
  getDocumentChunks,
  type ChunkRecord,
  type DocumentRecord,
} from '../../lib/api';
import { describeError } from '../../lib/errors';

interface ControlViewerProps {
  documentId: string;
}

/**
 * The control group's entire study session: only the original material, no AI features, no
 * avatar, no chat — just the same viewer the experimental group also sees beside their tabs.
 */
export function ControlViewer({ documentId }: ControlViewerProps) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [chunks, setChunks] = useState<ChunkRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const [doc, docChunks] = await Promise.all([
          getDocument(documentId),
          getDocumentChunks(documentId),
        ]);
        if (cancelled) return;
        setDocument(doc);
        setChunks(docChunks);
      } catch (caught: unknown) {
        if (cancelled) return;
        setError(describeError(t, caught));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [documentId, t]);

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton lines={10} />
      </Card>
    );
  }
  if (error || !document) {
    return (
      <ErrorState title={t('workspace.errorTitle')} description={error ?? t('errors.unknown')} />
    );
  }

  const isLecture = document.content_type === 'lecture';

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3 text-sm font-medium text-fg-muted">
        {document.filename}
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        {chunks.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('study.controlViewerEmpty')}</p>
        ) : (
          chunks.map((chunk, index) => (
            <div
              key={`${chunk.heading ?? 'section'}-${String(index)}`}
              className="rounded-2xl border border-border bg-surface-muted p-4"
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                {chunk.heading ?? t('study.controlViewerSection', { number: index + 1 })}
              </p>
              {isLecture ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{chunk.text}</p>
              ) : (
                <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
                  {chunk.text}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
