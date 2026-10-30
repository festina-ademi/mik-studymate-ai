import confetti from 'canvas-confetti';
import { useEffect, useRef } from 'react';

import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

const DURATION_MS = 2500;
// Warm palette only (amber tones, cream, deep brown) -- deliberately not canvas-confetti's
// rainbow default, which would clash with the design. Literal hex, not CSS custom properties:
// confetti is drawn on a <canvas> via the Canvas 2D API, which can't resolve `var(...)`.
const COLORS = ['#9c6325', '#f5b55c', '#f9ce81', '#f5e3c8', '#7a4318'];

interface QuizConfettiCanvasProps {
  /** Fire once when this becomes true (e.g. the results just loaded at a celebration-worthy
   * score); does not re-fire on its own if it stays true across re-renders. */
  active: boolean;
}

/**
 * A confetti burst confined to its own absolutely-positioned `<canvas>` (via
 * `canvas-confetti`'s `create()`, not the default page-wide canvas), so it reads as "this card
 * is celebrating" rather than a full-screen effect that would feel invasive on a shared
 * screen. Falls from the top for ~2.5s, then stops; never loops. Skipped entirely under
 * `prefers-reduced-motion` -- the caller still shows the band message either way.
 */
export function QuizConfettiCanvas({ active }: QuizConfettiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!active || prefersReducedMotion || !canvasRef.current) {
      return;
    }
    const fire = confetti.create(canvasRef.current, { resize: true, useWorker: true });
    let cancelled = false;
    const endAt = Date.now() + DURATION_MS;

    const tick = (): void => {
      if (cancelled) return;
      void fire({
        particleCount: 3,
        startVelocity: 28,
        gravity: 0.9,
        spread: 70,
        angle: 270, // straight down from the top edge
        origin: { x: Math.random(), y: -0.1 },
        colors: COLORS,
        disableForReducedMotion: true,
      });
      if (Date.now() < endAt) {
        requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      cancelled = true;
      fire.reset();
    };
  }, [active, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
