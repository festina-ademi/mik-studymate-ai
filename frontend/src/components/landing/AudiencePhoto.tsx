import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

interface AudiencePhotoProps {
  alt: string;
}

/**
 * The audience section's photo: a rounded card matching the hero photo's styling, with a subtle
 * parallax drift as the section scrolls past (the photo moves slower than the surrounding text,
 * which sits still) and a gentle hover zoom.
 *
 * The image is rendered taller than its frame and centered with a matching negative offset, so
 * the parallax shift and hover zoom always reveal more of the photo itself rather than an edge
 * gap; the frame's `overflow-hidden` clips the rest.
 */
export function AudiencePhoto({ alt }: AudiencePhotoProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Tracks the photo's own progress through the viewport; the small +/-10% range against static
  // surrounding text reads as the photo lagging behind, i.e. moving at roughly 85% of scroll speed.
  const { scrollYProgress } = useScroll({
    target: anchorRef,
    offset: ['start end', 'end start'],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], ['-10%', '10%']);

  return (
    <div
      ref={anchorRef}
      className="relative aspect-600/862 overflow-hidden rounded-3xl border border-primary/20 shadow-[0_1px_2px_rgb(73_52_36/0.06),0_24px_48px_-12px_rgb(156_99_37/0.35)]"
    >
      <motion.img
        src="/images/audience-student.jpg"
        alt={alt}
        width={600}
        height={862}
        loading="lazy"
        style={reducedMotion ? undefined : { y: parallaxY }}
        whileHover={{ scale: 1.03 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="absolute top-[-12%] left-0 h-[124%] w-full object-cover"
      />
    </div>
  );
}
