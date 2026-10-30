import { describe, expect, it, vi } from 'vitest';

import { ApiError, deleteDocument, getClientId, getQuota } from './api';
import { forgetRecentDocument } from './documentStorage';
import { isQuotaExceeded, quotaTone } from './quota';
import {
  readJsonStorage,
  readStorage,
  STORAGE_KEYS,
  writeJsonStorage,
  writeStorage,
} from './storage';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const RESET_AT = '2026-10-22T00:00:00+02:00';
const OVERVIEW = {
  ai_requests: { used: 23, limit: 50, reset_at: RESET_AT },
  uploads: { used: 2, limit: 5, reset_at: RESET_AT },
};

function clientIdSent(fetchMock: ReturnType<typeof vi.fn<FetchMock>>): string | undefined {
  const init = fetchMock.mock.calls[0]?.[1];
  return (init?.headers as Record<string, string> | undefined)?.['X-Client-Id'];
}

describe('quotaTone', () => {
  it('is green below 70%, orange from 70% to 90%, red from 90%', () => {
    expect(quotaTone(0, 50)).toBe('success');
    expect(quotaTone(34, 50)).toBe('success');
    expect(quotaTone(35, 50)).toBe('warning');
    expect(quotaTone(44, 50)).toBe('warning');
    expect(quotaTone(45, 50)).toBe('error');
    expect(quotaTone(50, 50)).toBe('error');
    expect(quotaTone(60, 50)).toBe('error');
  });

  it('treats a zero limit as used up', () => {
    expect(quotaTone(0, 0)).toBe('error');
  });
});

describe('isQuotaExceeded', () => {
  it('matches only the daily quota error, not the general rate limit', () => {
    expect(isQuotaExceeded(new ApiError(429, 'quota_exceeded'))).toBe(true);
    expect(isQuotaExceeded(new ApiError(429, 'rate_limited'))).toBe(false);
    expect(isQuotaExceeded(new Error('x'))).toBe(false);
  });
});

describe('getQuota', () => {
  it('parses both quotas and identifies the browser with a stable anonymous id', async () => {
    const fetchMock = vi.fn<FetchMock>(() => Promise.resolve(Response.json(OVERVIEW)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getQuota()).resolves.toEqual(OVERVIEW);

    const clientId = getClientId();
    expect(clientId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(readStorage(STORAGE_KEYS.clientId)).toBe(clientId);
    expect(clientIdSent(fetchMock)).toBe(clientId);
  });

  it('counts a Study Mode session under the participant code', async () => {
    writeStorage(STORAGE_KEYS.studyParticipantCode, 'P-7K2M');
    const fetchMock = vi.fn<FetchMock>(() => Promise.resolve(Response.json(OVERVIEW)));
    vi.stubGlobal('fetch', fetchMock);

    await getQuota();

    expect(clientIdSent(fetchMock)).toBe('study-P-7K2M');
  });

  it('rejects a response without both quotas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ ai_requests: OVERVIEW.ai_requests }))),
    );
    await expect(getQuota()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('deleteDocument', () => {
  it('treats an already-deleted document (404) as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ error: { code: 'not_found' } }, { status: 404 })),
      ),
    );
    await expect(deleteDocument('gone')).resolves.toBeUndefined();
  });

  it('still reports other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: { code: 'boom' } }, { status: 500 }))),
    );
    await expect(deleteDocument('doc-1')).rejects.toMatchObject({ status: 500 });
  });
});

describe('forgetRecentDocument', () => {
  it('removes the document from the recent list and clears it as the current one', () => {
    writeJsonStorage(STORAGE_KEYS.recentDocuments, [{ id: 'a' }, { id: 'b' }]);
    writeStorage(STORAGE_KEYS.currentDocumentId, 'a');
    writeJsonStorage(STORAGE_KEYS.documentState, { document: { id: 'a' } });

    const remaining = forgetRecentDocument('a');

    expect(remaining.map((entry) => entry.id)).toEqual(['b']);
    expect(readJsonStorage(STORAGE_KEYS.recentDocuments)).toEqual([{ id: 'b' }]);
    expect(readStorage(STORAGE_KEYS.currentDocumentId)).toBeNull();
    expect(readStorage(STORAGE_KEYS.documentState)).toBeNull();
  });

  it('keeps the current document when another one is forgotten', () => {
    writeJsonStorage(STORAGE_KEYS.recentDocuments, [{ id: 'a' }, { id: 'b' }]);
    writeStorage(STORAGE_KEYS.currentDocumentId, 'a');

    forgetRecentDocument('b');

    expect(readStorage(STORAGE_KEYS.currentDocumentId)).toBe('a');
  });
});
