import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../Button';
import { deleteAllUserData } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { clearUserProfile } from '../../lib/profile';
import { STORAGE_KEYS } from '../../lib/storage';

interface DeleteProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Everything but the display preferences (theme, interface language) -- those are the
 * browser's own settings, not part of the deleted study profile. */
const USER_DATA_STORAGE_KEYS = [
  STORAGE_KEYS.userProfile,
  STORAGE_KEYS.level,
  STORAGE_KEYS.currentDocumentId,
  STORAGE_KEYS.recentDocuments,
  STORAGE_KEYS.documentState,
  STORAGE_KEYS.chunksState,
  STORAGE_KEYS.studyParticipantCode,
] as const;

function clearLocalUserData(): void {
  USER_DATA_STORAGE_KEYS.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable: nothing was saved in the first place.
    }
  });
  clearUserProfile();
}

/**
 * Confirmation modal for permanently deleting the local profile and all backend data, shared by
 * the header's profile dropdown and the profile page's danger zone.
 */
export function DeleteProfileDialog({ open, onClose }: DeleteProfileDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const titleId = useId();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const confirmDelete = (): void => {
    setIsDeleting(true);
    setError(null);
    void deleteAllUserData()
      .then(() => {
        clearLocalUserData();
        void navigate('/', { state: { toast: 'profileDeleted' } });
      })
      .catch((caught: unknown) => {
        setError(describeError(t, caught));
        setIsDeleting(false);
      });
  };

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
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-soft"
          >
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {t('profileDelete.title')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">{t('profileDelete.body')}</p>
            {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="bg-error text-primary-contrast hover:bg-error/90"
              >
                {t('profileDelete.confirm')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
