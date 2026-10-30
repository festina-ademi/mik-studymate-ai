import type { TFunction } from 'i18next';

import i18n from '../i18n';
import { ApiError } from './api';

/** Translate an error into a friendly message in the current language. */
export function describeError(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && i18n.exists(error.messageKey)) {
    return t(error.messageKey);
  }
  return t('errors.unknown');
}

/**
 * Like {@link describeError}, but keeps the backend's machine code (and, for a missing AI key,
 * says which environment variable to set) so the person running the server can act on it.
 */
export function describeErrorDetailed(t: TFunction, error: unknown): string {
  const message = describeError(t, error);
  if (!(error instanceof ApiError)) {
    return message;
  }
  if (error.code === 'llm_not_configured') {
    const key = error.details.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    return `${message} ${t('errors.llm_not_configured_hint', { key })} [${error.code}]`;
  }
  if (error.code === 'embedding_not_configured') {
    const hint =
      error.details.provider === 'local'
        ? t('errors.embedding_local_hint')
        : t('errors.embedding_api_hint', { provider: String(error.details.provider) });
    return `${message} ${hint} [${error.code}]`;
  }
  return `${message} [${error.code}]`;
}
