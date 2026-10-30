import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getStudyTimer } from '../../lib/api';

const SERVER_POLL_MS = 15_000;
const LOCAL_TICK_MS = 1_000;

function formatRemaining(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
}

interface StudyTimerBarProps {
  code: string;
  onExpired: () => void;
}

/**
 * The visible study session countdown. The server's remaining time is the source of truth,
 * polled periodically; between polls, the bar ticks down locally once a second for a smooth
 * display. Once the server reports the timer expired, `onExpired` fires exactly once.
 */
export function StudyTimerBar({ code, onExpired }: StudyTimerBarProps) {
  const { t } = useTranslation();
  const [started, setStarted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const hasExpiredRef = useRef(false);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    let cancelled = false;

    const handleStatus = (next: {
      started: boolean;
      remaining_seconds: number | null;
      expired: boolean;
    }): void => {
      if (cancelled) return;
      setStarted(next.started);
      setRemainingSeconds(next.remaining_seconds);
      if (next.expired && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpiredRef.current();
      }
    };

    const poll = (): void => {
      void getStudyTimer(code)
        .then(handleStatus)
        .catch(() => undefined);
    };
    poll();
    const pollInterval = window.setInterval(poll, SERVER_POLL_MS);

    const tickInterval = window.setInterval(() => {
      if (hasExpiredRef.current) return;
      setRemainingSeconds((current) => (current === null ? null : Math.max(0, current - 1)));
    }, LOCAL_TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollInterval);
      window.clearInterval(tickInterval);
    };
  }, [code]);

  if (!started || remainingSeconds === null) {
    return null;
  }

  return (
    <div
      role="timer"
      className="sticky top-0 z-10 mb-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-2 text-sm font-medium text-fg shadow-soft"
    >
      <Clock className="size-4 text-primary" />
      {t('study.timeRemaining', { time: formatRemaining(remainingSeconds) })}
    </div>
  );
}
