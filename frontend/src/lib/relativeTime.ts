import type { ApiLanguage } from './api';

const DIVISIONS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

/** "2 days ago" / "2 ditë më parë", localized to the interface language. */
export function formatRelativeTime(
  isoDate: string,
  language: ApiLanguage,
  now = Date.now(),
): string {
  const diffSeconds = (new Date(isoDate).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });

  for (const { unit, seconds } of DIVISIONS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return rtf.format(Math.round(diffSeconds), 'second');
}
