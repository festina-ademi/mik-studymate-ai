import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { getStartRoute } from '../lib/routing';
import { IconButton } from './IconButton';
import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';
import { ProfileAvatarMenu } from './profile/ProfileAvatarMenu';
import { ThemeToggle } from './ThemeToggle';

/** In-page landing anchors; from any other page they lead to `/` and then scroll. */
const ANCHOR_LINKS = [
  { hash: '#features', labelKey: 'header.features' },
  { hash: '#how-it-works', labelKey: 'header.howItWorks' },
  { hash: '#teacher', labelKey: 'header.teacher' },
  { hash: '#audience', labelKey: 'header.audience' },
] as const;

const linkClass =
  'whitespace-nowrap rounded-xl px-2 py-2 text-sm font-medium text-fg-muted transition hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-fg';

const ctaClass =
  'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl bg-primary px-4 text-sm font-medium text-primary-contrast shadow-soft transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** Product navigation: brand, section links, preference controls and the main call-to-action. */
export function Header() {
  const { t } = useTranslation();
  // Subscribing to the location re-evaluates the CTA target after onboarding or a profile
  // deletion and lets the mobile menu close whenever the user navigates.
  const location = useLocation();
  // The menu is open for exactly one navigation entry, so any navigation closes it.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === location.key;
  const setMenuOpen = (open: boolean | ((current: boolean) => boolean)): void => {
    const next = typeof open === 'function' ? open(menuOpen) : open;
    setOpenedAt(next ? location.key : null);
  };
  const menuId = useId();
  const toggleRef = useRef<HTMLDivElement>(null);
  const startRoute = getStartRoute();
  // The visitor is still building their profile on this page, so the menu that manages an
  // existing one (and could delete it) stays hidden there.
  const isWelcome = location.pathname === '/welcome';

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenedAt(null);
        toggleRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const navLinks = (
    <>
      {ANCHOR_LINKS.map(({ hash, labelKey }) => (
        <Link key={hash} to={{ pathname: '/', hash }} className={linkClass}>
          {t(labelKey)}
        </Link>
      ))}
      <NavLink to="/study" className={linkClass}>
        {t('header.studyMode')}
      </NavLink>
    </>
  );

  const preferenceControls = (
    <>
      <LanguageToggle />
      <ThemeToggle />
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-xl">
      {/* Same container as the landing hero (`max-w-7xl`, same side padding), so the logo lines
          up with the hero's text instead of hugging the window's left edge on wide screens. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <nav aria-label={t('header.navLabel')} className="hidden items-center gap-1 nav:flex">
            {navLinks}
          </nav>
        </div>

        <div className="flex items-center gap-2 nav:gap-3">
          <div className="hidden items-center gap-2 nav:flex">{preferenceControls}</div>
          <Link to={startRoute} className={`${ctaClass} max-sm:hidden`}>
            {t('header.getStarted')}
          </Link>
          {isWelcome ? null : <ProfileAvatarMenu />}
          <div ref={toggleRef} className="nav:hidden">
            <IconButton
              ariaLabel={menuOpen ? t('header.closeMenu') : t('header.openMenu')}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => {
                setMenuOpen((current) => !current);
              }}
            >
              {menuOpen ? (
                <X aria-hidden className="size-5" />
              ) : (
                <Menu aria-hidden className="size-5" />
              )}
            </IconButton>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id={menuId}
            key="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-t border-border bg-bg nav:hidden"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
              <nav aria-label={t('header.navLabel')} className="flex flex-col gap-1">
                {navLinks}
              </nav>
              <div className="flex flex-wrap items-center gap-2">{preferenceControls}</div>
              <Link to={startRoute} className={`${ctaClass} h-11 sm:hidden`}>
                {t('header.getStarted')}
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
