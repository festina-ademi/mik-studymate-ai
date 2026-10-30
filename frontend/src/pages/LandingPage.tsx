import { motion } from 'framer-motion';
import {
  GraduationCap,
  Languages,
  ListChecks,
  MessagesSquare,
  Mic,
  Pause,
  Sliders,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { AudiencePhoto } from '../components/landing/AudiencePhoto';
import { HeroVisual } from '../components/landing/HeroVisual';
import { LandingFooter } from '../components/landing/LandingFooter';
import { Reveal } from '../components/landing/Reveal';
import { TeacherAvatarShowcase } from '../components/landing/TeacherAvatarShowcase';
import { Toast } from '../components/Toast';
import { useScrollToHash } from '../hooks/useScrollToHash';
import { getStartRoute } from '../lib/routing';

const TOAST_DURATION_MS = 5000;

const ordinals = ['one', 'two', 'three'] as const;

const FEATURES: readonly { key: string; icon: LucideIcon }[] = [
  { key: 'summary', icon: Sparkles },
  { key: 'level', icon: GraduationCap },
  { key: 'quiz', icon: ListChecks },
  { key: 'chat', icon: MessagesSquare },
  { key: 'teacher', icon: Mic },
];

const TEACHER_BULLETS: readonly { key: string; icon: LucideIcon }[] = [
  { key: 'reads', icon: Volume2 },
  { key: 'pauses', icon: Pause },
  { key: 'adapts', icon: Sliders },
  { key: 'bilingual', icon: Languages },
];
const TEACHER_PHRASE_KEYS = ['phrase1', 'phrase2', 'phrase3', 'phrase4'] as const;

const primaryButtonClass =
  'inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-6 text-base font-medium text-primary-contrast shadow-soft transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const secondaryButtonClass =
  'inline-flex h-12 items-center justify-center rounded-2xl border border-border bg-surface px-6 text-base font-medium text-fg transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

interface SectionProps {
  id: string;
  titleId: string;
  title: string;
  /** Extra classes for the full-width band (background tone). */
  className?: string;
  children: ReactNode;
}

/** A full-width landing band with a centered column, an h2 and a scroll-anchor offset for the sticky header. */
function Section({ id, titleId, title, className = '', children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={titleId} className={`scroll-mt-16 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <Reveal>
          <h2
            id={titleId}
            className="max-w-3xl text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl"
          >
            {title}
          </h2>
        </Reveal>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** Product landing page: hero, problem, features, how it works, audience, closing call-to-action. */
export function LandingPage() {
  const { t } = useTranslation();
  useScrollToHash();
  const startRoute = getStartRoute();
  const location = useLocation();
  const [showDeletedToast, setShowDeletedToast] = useState(
    () => (location.state as { toast?: string } | null)?.toast === 'profileDeleted',
  );

  useEffect(() => {
    if (!showDeletedToast) return;
    const id = window.setTimeout(() => {
      setShowDeletedToast(false);
    }, TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [showDeletedToast]);

  // overflow-x-clip: the lamp-glow pseudo-element must not cause horizontal page scroll.
  return (
    <div className="landing-shell overflow-x-clip">
      {showDeletedToast ? (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <Toast
            title={t('profileDelete.toastTitle')}
            icon={<CheckCircle2 className="size-4" />}
            onDismiss={() => {
              setShowDeletedToast(false);
            }}
          />
        </div>
      ) : null}
      <section aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal className="flex flex-col items-start gap-6">
            <h1
              id="hero-title"
              className="text-4xl font-semibold leading-[1.1] tracking-[-0.04em] text-fg sm:text-5xl lg:text-6xl"
            >
              <span className="block">{t('landing.hero.titleLine1')}</span>{' '}
              <span className="block text-primary">{t('landing.hero.titleLine2')}</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-fg-muted">
              {t('landing.hero.subtitle')}
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link to={startRoute} className={primaryButtonClass}>
                {t('landing.hero.ctaPrimary')}
              </Link>
              <Link to={{ pathname: '/', hash: '#how-it-works' }} className={secondaryButtonClass}>
                {t('landing.hero.ctaSecondary')}
              </Link>
            </div>
          </Reveal>
          {/* HeroVisual owns its own entrance animation (a slower, larger fade+slide than
              Reveal's), so it isn't nested inside one here. */}
          <div className="flex justify-center lg:justify-end">
            <HeroVisual
              photoAlt={t('landing.hero.photoAlt')}
              summaryLabel={t('landing.hero.cardSummary')}
              quizLabel={t('landing.hero.cardQuiz')}
              explanationLabel={t('landing.hero.cardExplanation')}
              tutorLabel={t('landing.hero.cardTutor')}
            />
          </div>
        </div>
      </section>

      <Section
        id="problem"
        titleId="problem-title"
        title={t('landing.problem.title')}
        className="bg-surface-muted/50"
      >
        <ul className="grid gap-6 md:grid-cols-3">
          {ordinals.map((ordinal, index) => (
            <li key={ordinal}>
              <Reveal delay={index * 0.06} className="h-full">
                <div className="h-full rounded-2xl border border-border bg-surface p-6 shadow-soft">
                  <h3 className="text-xl font-semibold text-fg">
                    {t(`landing.problem.${ordinal}.title`)}
                  </h3>
                  <p className="mt-3 text-lg leading-relaxed text-fg-muted">
                    {t(`landing.problem.${ordinal}.text`)}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="features" titleId="features-title" title={t('landing.features.title')}>
        <ul className="flex flex-wrap justify-center gap-6">
          {FEATURES.map(({ key, icon: Icon }, index) => (
            <li key={key} className="w-full md:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)]">
              <Reveal delay={(index % 3) * 0.06} className="h-full">
                <motion.article
                  initial="rest"
                  whileHover="hover"
                  variants={{ rest: { y: 0 }, hover: { y: -3 } }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="h-full rounded-2xl border border-border bg-surface p-6 shadow-soft transition-colors hover:border-primary/40"
                >
                  <motion.span
                    variants={{ rest: { rotate: 0 }, hover: { rotate: 360 } }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                    className="inline-flex rounded-xl bg-primary-soft p-3 text-primary-soft-fg"
                  >
                    <Icon aria-hidden className="size-6" />
                  </motion.span>
                  <h3 className="mt-4 text-xl font-semibold text-fg">
                    {t(`landing.features.${key}.title`)}
                  </h3>
                  <p className="mt-2 text-lg leading-relaxed text-fg-muted">
                    {t(`landing.features.${key}.text`)}
                  </p>
                </motion.article>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="how-it-works"
        titleId="how-title"
        title={t('landing.how.title')}
        className="bg-surface-muted/50"
      >
        <ol className="grid gap-0 md:grid-cols-3 md:gap-8">
          {ordinals.map((ordinal, index) => (
            <li key={ordinal} className="relative pb-10 last:pb-0 md:pb-0">
              {index < ordinals.length - 1 ? (
                <>
                  {/* Dotted connector: vertical on mobile, horizontal between badges from md up. */}
                  <span
                    aria-hidden
                    className="absolute bottom-1 left-6 top-[3.75rem] -translate-x-1/2 border-l-2 border-dotted border-primary/60 md:hidden"
                  />
                  <span
                    aria-hidden
                    className="absolute left-[calc(50%+2.25rem)] right-[calc(-50%+1rem)] top-6 hidden border-t-2 border-dotted border-primary/60 md:block"
                  />
                </>
              ) : null}
              <Reveal
                delay={index * 0.08}
                className="flex gap-5 md:flex-col md:items-center md:text-center"
              >
                <span
                  aria-hidden
                  style={{ animationDelay: `${String(index * 0.6)}s` }}
                  className="animate-badge-pulse flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-contrast shadow-soft"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-xl font-semibold text-fg">
                    <span className="sr-only">
                      {t('landing.how.stepLabel', { number: index + 1 })}:{' '}
                    </span>
                    {t(`landing.how.${ordinal}.title`)}
                  </h3>
                  <p className="mt-2 text-lg leading-relaxed text-fg-muted">
                    {t(`landing.how.${ordinal}.text`)}
                  </p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Section>

      <section id="teacher" aria-labelledby="teacher-title" className="scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
            <Reveal>
              <TeacherAvatarShowcase
                phrases={TEACHER_PHRASE_KEYS.map((key) => t(`landing.teacher.${key}`))}
              />
            </Reveal>
            <Reveal delay={0.08} className="space-y-6">
              <div className="space-y-3">
                <h2
                  id="teacher-title"
                  className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl"
                >
                  {t('landing.teacher.title')}
                </h2>
                <p className="text-lg leading-relaxed text-fg-muted">
                  {t('landing.teacher.subtitle')}
                </p>
              </div>
              <ul className="space-y-4">
                {TEACHER_BULLETS.map(({ key, icon: Icon }, index) => (
                  <li key={key}>
                    <Reveal delay={0.08 + (index + 1) * 0.1} className="flex items-center gap-3">
                      <span className="inline-flex shrink-0 rounded-xl bg-primary-soft p-2 text-primary-soft-fg">
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <span className="text-lg text-fg">{t(`landing.teacher.bullets.${key}`)}</span>
                    </Reveal>
                  </li>
                ))}
              </ul>
              <Link to={startRoute} className={primaryButtonClass}>
                {t('landing.teacher.cta')}
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <Section id="audience" titleId="audience-title" title={t('landing.audience.title')}>
        {/* Photo first in the DOM: photo above text on mobile, photo left of text from md up. */}
        <div className="grid gap-8 md:grid-cols-2 md:items-center md:gap-10">
          <Reveal className="mx-auto w-full max-w-sm md:max-w-none">
            <AudiencePhoto alt={t('landing.audience.photoAlt')} />
          </Reveal>
          <Reveal delay={0.08} className="space-y-6">
            {(['students', 'professionals'] as const).map((group) => (
              <div
                key={group}
                className="rounded-2xl border border-border bg-surface p-6 shadow-soft sm:p-8"
              >
                <h3 className="text-2xl font-semibold text-fg">
                  {t(`landing.audience.${group}.title`)}
                </h3>
                <ul className="mt-5 space-y-3">
                  {ordinals.map((ordinal) => (
                    <li key={ordinal} className="flex gap-3 text-lg leading-relaxed text-fg-muted">
                      <span
                        aria-hidden
                        className="mt-[0.7rem] size-2 shrink-0 rounded-full bg-primary"
                      />
                      {t(`landing.audience.${group}.${ordinal}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Reveal>
        </div>
      </Section>

      <section aria-labelledby="closing-title" className="border-y border-border bg-primary-soft">
        <Reveal className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2
            id="closing-title"
            className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl"
          >
            {t('landing.closing.title')}
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-fg-muted">
            {t('landing.closing.text')}
          </p>
          <Link to={startRoute} className={primaryButtonClass}>
            {t('landing.closing.cta')}
          </Link>
        </Reveal>
      </section>

      <LandingFooter />
    </div>
  );
}
