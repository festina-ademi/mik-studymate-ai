import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { IconButton } from './IconButton';
import { usePrefersReducedMotion } from '../hooks/useReducedMotion';

interface LongCodeAlertProps {
  open: boolean;
  /** Non-empty lines in the current code document, shown in the body. */
  lineCount: number;
  onSwitchToBlocks: () => void;
  onShortenCode: () => void;
  /** X, Escape or a click outside; the caller falls back to blocks. */
  onDismiss: () => void;
}

/**
 * Friendly warning shown when line-by-line is chosen for code longer than the soft limit: the
 * student can switch to blocks, or trim the code down in the editor.
 */
export function LongCodeAlert({
  open,
  lineCount,
  onSwitchToBlocks,
  onShortenCode,
  onDismiss,
}: LongCodeAlertProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const transition = { duration: reducedMotion ? 0 : 0.15 };
  const panelFrom = reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onDismiss();
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <AlertCircle aria-hidden className="size-5" />
                </span>
                <h2 id={titleId} className="text-lg font-semibold text-fg">
                  {t('workspace.longCodeTitle')}
                </h2>
              </div>
              <IconButton ariaLabel={t('common.closeDialog')} size="sm" onClick={onDismiss}>
                <X className="size-4" />
              </IconButton>
            </div>
            <p id={bodyId} className="mt-3 text-sm leading-6 text-fg-muted">
              {t('workspace.longCodeBody', { lines: lineCount })}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={onShortenCode}>
                {t('workspace.longCodeShorten')}
              </Button>
              <Button onClick={onSwitchToBlocks}>{t('workspace.longCodeSwitchToBlocks')}</Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
