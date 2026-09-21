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
