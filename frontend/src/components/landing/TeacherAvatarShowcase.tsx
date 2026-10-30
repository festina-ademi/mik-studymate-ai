import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

import { StudyAvatar } from '../avatar/StudyAvatar';
import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

interface TeacherAvatarShowcaseProps {
  /** Rotated one at a time in the speech bubble; shown statically (just the first) under
   * reduced motion. */
  phrases: string[];
  /** How long each phrase stays up, in ms. Exposed mainly so tests can use a short interval
   * instead of faking timers around framer-motion's own animation. */
  intervalMs?: number;
}

/**
 * The landing page's "virtual teacher" showcase: a floating card with the always-speaking
 * {@link StudyAvatar}, and a speech bubble that cross-fades through a handful of phrases next
 * to it. Positioned top-right of the avatar on desktop, overlapping its bottom edge on mobile.
 */
export function TeacherAvatarShowcase({ phrases, intervalMs = 5000 }: TeacherAvatarShowcaseProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion || phrases.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % phrases.length);
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [prefersReducedMotion, phrases.length, intervalMs]);

  const phrase = phrases[prefersReducedMotion ? 0 : index] ?? '';

  return (
    <div className="relative mx-auto w-full max-w-[240px] pb-10 sm:max-w-[320px] sm:pb-0">
      <motion.div
        animate={prefersReducedMotion ? undefined : { y: [-4, 4, -4] }}
        transition={
          prefersReducedMotion ? undefined : { duration: 4, repeat: Infinity, ease: 'easeInOut' }
        }
        className="overflow-hidden rounded-3xl border border-primary/20 bg-surface shadow-[0_1px_2px_rgb(73_52_36/0.06),0_24px_48px_-12px_rgb(156_99_37/0.35)]"
      >
        <StudyAvatar mood="speaking" size={320} className="h-auto w-full" />
      </motion.div>

      <div
        aria-live="polite"
        className="absolute inset-x-6 bottom-0 rounded-3xl border border-border bg-surface px-4 py-3 text-center shadow-soft sm:inset-x-auto sm:bottom-auto sm:-right-6 sm:-top-6 sm:w-64 sm:text-left"
      >
        {/* Mobile tail: bubble sits below the card, tail points up toward the avatar. */}
        <span
          aria-hidden="true"
          className="absolute -top-2 left-1/2 size-4 -translate-x-1/2 rotate-45 border-r border-t border-border bg-surface sm:hidden"
        />
        {/* Desktop tail: bubble sits top-right, tail points down-left toward the avatar's mouth. */}
        <span
          aria-hidden="true"
          className="absolute -bottom-2 left-10 hidden size-4 rotate-45 border-b border-l border-border bg-surface sm:block"
        />
        {prefersReducedMotion ? (
          <p className="text-sm font-medium text-fg">{phrase}</p>
        ) : (
          <AnimatePresence mode="wait">
            <motion.p
              key={index}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm font-medium text-fg"
            >
              {phrase}
            </motion.p>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
