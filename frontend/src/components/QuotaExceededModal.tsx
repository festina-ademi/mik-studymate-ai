import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { usePrefersReducedMotion } from '../hooks/useReducedMotion';
import { onQuotaExceeded, type QuotaExceededDetail } from '../lib/quotaEvents';

/**
 * App-wide modal for a `429 quota_exceeded` from any request (see `apiFetch` in `lib/api.ts`):
 * tells the user when they can continue and that their work is saved.
 */
export function QuotaExceededModal() {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [detail, setDetail] = useState<QuotaExceededDetail | null>(null);
  const open = detail !== null;
  const transition = { duration: reducedMotion ? 0 : 0.15 };
  const panelFrom = reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 };

  useEffect(() => onQuotaExceeded(setDetail), []);

  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDetail(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = (): void => {
    setDetail(null);
  };

  return (
    <AnimatePresence>
      {detail ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            initial={panelFrom}
            animate={{ opacity: 1, scale: 1 }}
            exit={panelFrom}
            transition={transition}
            className="w-full max-w-md rounded-2xl border border-warning/40 bg-surface p-6 shadow-soft"
          >
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {t('quota.exceededTitle')}
            </h2>
            <p id={bodyId} className="mt-3 text-sm leading-6 text-fg-muted">
              {t('quota.exceededBody', { count: detail.hoursRemaining })}
            </p>
            <div className="mt-6 flex justify-end">
              <Button ref={okRef} onClick={close}>
                {t('quota.ok')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
