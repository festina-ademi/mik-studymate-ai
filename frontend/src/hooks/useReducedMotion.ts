import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user prefers reduced motion, kept live as the OS/browser setting changes (unlike
 * framer-motion's own `useReducedMotion`, which only reads it once at mount). Used for effects
 * framer's global `MotionConfig reducedMotion="user"` cannot express on its own, such as swapping
 * the orbiting hero cards for a static layout or turning off scroll-linked parallax.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const apply = (): void => {
      setReduced(media.matches);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, []);

  return reduced;
}
