import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from './IconButton';
import { UploadChoiceCards } from './UploadChoiceCards';

interface UploadChoiceModalProps {
  open: boolean;
  onClose: () => void;
  onChooseDocument: () => void;
  onChooseCode: () => void;
}

/** "Upload a new document" opens this first: a choice between a file upload and pasted code,
 * dismissible with Escape, the X button, or a click outside. */
export function UploadChoiceModal({
  open,
  onClose,
  onChooseDocument,
  onChooseCode,
}: UploadChoiceModalProps) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-soft"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold text-fg">
                {t('upload.chooseTitle')}
              </h2>
              <IconButton ariaLabel={t('common.closeDialog')} size="sm" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
            <UploadChoiceCards onChooseDocument={onChooseDocument} onChooseCode={onChooseCode} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
