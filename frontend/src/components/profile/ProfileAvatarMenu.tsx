import { LogOut, Trash2, User, UserCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { DeleteProfileDialog } from './DeleteProfileDialog';
import { getInitials, readUserProfile, type UserProfile } from '../../lib/profile';

function studentLine(profile: UserProfile, t: (key: string) => string): string {
  const parts = [
    profile.university,
    profile.yearOfStudy ? t(`welcome.year_${profile.yearOfStudy}`) : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The profile avatar in the header's far right: an initials badge when a profile exists (or a
 * generic icon linking to onboarding when it doesn't), opening a dropdown with identity, quick
 * facts, and the profile/session/delete actions.
 */
export function ProfileAvatarMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The header never remounts across client-side navigation; `Header` itself subscribes to
  // `useLocation()` and re-renders on every navigation, which re-renders this child too, so
  // reading the profile fresh on every render keeps it in sync without a shared store.
  const profile = readUserProfile();
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        containerRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (profile === null) {
    return (
      <Link
        to="/welcome"
        aria-label={t('profileMenu.goToWelcome')}
        className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-surface text-fg-muted transition hover:bg-surface-muted"
      >
        <User aria-hidden className="size-5" />
      </Link>
    );
  }

  const secondaryLine =
    profile.role === 'student' ? studentLine(profile, t) : (profile.fieldOfWork ?? '');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={t('profileMenu.openMenu')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="inline-flex size-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-contrast shadow-soft transition hover:bg-primary-hover"
      >
        {getInitials(profile.firstName, profile.lastName)}
      </button>
      {open ? (
        <div
          id={panelId}
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-border bg-surface p-1.5 shadow-soft"
        >
          <div className="px-3 py-2">
            <p className="font-semibold text-fg">
              {profile.firstName} {profile.lastName}
            </p>
            <p className="text-sm text-fg-muted">{profile.birthYear}</p>
            {secondaryLine ? <p className="mt-1 text-sm text-fg-muted">{secondaryLine}</p> : null}
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate('/profile');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-fg transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserCircle aria-hidden className="size-4 text-fg-muted" />
            {t('profileMenu.myProfile')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate('/');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-fg transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut aria-hidden className="size-4 text-fg-muted" />
            {t('profileMenu.endSession')}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDeleteOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-error transition hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 aria-hidden className="size-4" />
            {t('profileMenu.deleteProfile')}
          </button>
        </div>
      ) : null}
      <DeleteProfileDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}
