import type { RecentDocument } from '../pages/WorkspacePage';
import type { ChunkRecord, DocumentRecord } from './api';
import {
  readJsonStorage,
  readStorage,
  STORAGE_KEYS,
  writeJsonStorage,
  writeStorage,
} from './storage';

/** Recent-documents list is capped so it stays a quick switcher, not an unbounded history. */
const MAX_RECENT_DOCUMENTS = 8;

/**
 * Save a freshly uploaded document as the workspace's current document.
 *
 * This is the only place that writes `documentState`/`chunksState`/`recentDocuments` outside of
 * tests, so every entry point into the workspace (landing page upload today, others later) must
 * go through it to stay consistent with what `WorkspacePage` reads.
 */
export function saveUploadedDocument(document: DocumentRecord, chunks: ChunkRecord[]): void {
  writeJsonStorage(STORAGE_KEYS.documentState, { document });
  writeJsonStorage(STORAGE_KEYS.chunksState, chunks);

  const existing = readJsonStorage<RecentDocument[]>(STORAGE_KEYS.recentDocuments) ?? [];
  const withoutCurrent = existing.filter((entry) => entry.id !== document.id);
  const entry: RecentDocument = {
    id: document.id,
    filename: document.filename,
    content_type: document.content_type,
    source_format: document.source_format,
    detected_language: document.detected_language,
    updatedAt: new Date().toISOString(),
  };
  writeJsonStorage(
    STORAGE_KEYS.recentDocuments,
    [entry, ...withoutCurrent].slice(0, MAX_RECENT_DOCUMENTS),
  );
  writeStorage(STORAGE_KEYS.currentDocumentId, document.id);
}

/**
 * Drop a deleted document from the workspace's recent list (and from "current", if it was the
 * open one), so no page keeps offering a document the backend no longer has.
 *
 * @returns The remaining recent documents.
 */
export function forgetRecentDocument(documentId: string): RecentDocument[] {
  const existing = readJsonStorage<RecentDocument[]>(STORAGE_KEYS.recentDocuments) ?? [];
  const remaining = existing.filter((entry) => entry.id !== documentId);
  writeJsonStorage(STORAGE_KEYS.recentDocuments, remaining);
  if (readStorage(STORAGE_KEYS.currentDocumentId) === documentId) {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.currentDocumentId);
      window.localStorage.removeItem(STORAGE_KEYS.documentState);
      window.localStorage.removeItem(STORAGE_KEYS.chunksState);
    } catch {
      // Blocked storage: there is nothing persisted to clean up.
    }
  }
  return remaining;
}
