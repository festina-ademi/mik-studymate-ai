import { motion } from 'framer-motion';
import { BookOpenText, ListChecks, MessagesSquare, Sparkles, type LucideIcon } from 'lucide-react';

import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

interface HeroVisualProps {
  /** Alt text for the photo itself; this is the only thing assistive tech announces here. */
  photoAlt: string;
  summaryLabel: string;
  quizLabel: string;
  explanationLabel: string;
  tutorLabel: string;
}

interface OrbitCard {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Position around the circle (12 / 3 / 6 / 9 o'clock). */
  orbitPosition: string;
  /** Static fallback position (a page corner), used under reduced motion. */
  cornerPosition: string;
}

const pillClass =
  'pointer-events-auto flex w-[120px] items-center gap-2 rounded-full border border-primary/25 bg-surface px-3 py-2 text-xs font-medium text-fg shadow-soft transition hover:ring-2 hover:ring-primary/30';

/**
 * Hero visual: the real study-desk photo in a floating card, with four small feature pills
 * orbiting around it. Under reduced motion the orbit and float stop and the pills settle into
 * the four corners instead, matching the guarantee `MotionConfig reducedMotion="user"` already
 * gives every other `whileHover`/`whileInView` animation on the page.
 */
export function HeroVisual({
  photoAlt,
  summaryLabel,
  quizLabel,
  explanationLabel,
  tutorLabel,
}: HeroVisualProps) {
  const reducedMotion = usePrefersReducedMotion();

  const cards: OrbitCard[] = [
    {
      key: 'summary',
      label: summaryLabel,
      icon: Sparkles,
      orbitPosition: 'left-1/2 top-0 -translate-x-1/2 -translate-y-full',
      cornerPosition: '-left-2 -top-2',
    },
    {
      key: 'quiz',
      label: quizLabel,
      icon: ListChecks,
      orbitPosition: 'right-0 top-1/2 translate-x-full -translate-y-1/2',
      cornerPosition: '-right-2 -top-2',
    },
    {
      key: 'explanation',
      label: explanationLabel,
      icon: BookOpenText,
      orbitPosition: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full',
      cornerPosition: '-right-2 -bottom-2',
    },
    {
      key: 'tutor',
      label: tutorLabel,
      icon: MessagesSquare,
      orbitPosition: 'left-0 top-1/2 -translate-x-full -translate-y-1/2',
      cornerPosition: '-left-2 -bottom-2',
    },
  ];

  return (
    <div className="relative w-full max-w-[300px] sm:max-w-[360px] md:max-w-[380px] lg:max-w-[440px]">
      {/* Entrance: fades and slides up once on mount. The continuous float lives on a nested
          element so it doesn't fight this one-shot transition. */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      >
        <motion.div
          animate={reducedMotion ? undefined : { y: [-6, 6, -6] }}
          transition={
            reducedMotion
              ? undefined
              : { duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }
          }
          className="overflow-hidden rounded-3xl border border-primary/20 shadow-[0_1px_2px_rgb(73_52_36/0.06),0_24px_48px_-12px_rgb(156_99_37/0.35)]"
        >
          <img
            src="/images/hero-study.jpg"
            alt={photoAlt}
            width={600}
            height={400}
            loading="eager"
            className="aspect-3/2 h-auto w-full object-cover"
          />
        </motion.div>
      </motion.div>

      {/* Decorative: the same four ideas are already named and explained in the Features
          section below, so this layer is hidden from assistive tech. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
        {reducedMotion ? (
          cards.map(({ key, label, icon: Icon, cornerPosition }, index) => (
            <motion.div
              key={key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: index * 0.08, ease: 'easeOut' }}
              className={`absolute ${cornerPosition} ${pillClass}`}
            >
              <Icon aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="truncate">{label}</span>
            </motion.div>
          ))
        ) : (
          <motion.div
            className="absolute inset-0 [--orbit-r:150px] lg:[--orbit-r:190px]"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          >
            {cards.map(({ key, label, icon: Icon, orbitPosition }) => (
              <div key={key} className={`absolute ${orbitPosition}`}>
                {/* Counter-rotates at the same rate as the orbit above so the label stays
                    upright while still travelling around the photo. */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
                  whileHover={{ scale: 1.05 }}
                  className={pillClass}
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{label}</span>
                </motion.div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
