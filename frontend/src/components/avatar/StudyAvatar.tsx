import { AnimatePresence, motion, type TargetAndTransition, type Transition } from 'framer-motion';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

export type AvatarMood = 'speaking' | 'listening' | 'thinking' | 'celebrating';

export interface StudyAvatarProps {
  mood?: AvatarMood;
  /** Rendered width and height in px; the drawing scales through its viewBox. */
  size?: number;
  /** Freezes every animation on the current mood's static pose (e.g. playback is paused). */
  paused?: boolean;
  className?: string;
}

/** Blink interval range per mood in ms; `null` means the mood's eyes never blink. */
const BLINK_RANGE_MS: Record<AvatarMood, [number, number] | null> = {
  speaking: [3000, 5000],
  listening: [4000, 6000],
  thinking: [5000, 8000],
  celebrating: null,
};
const BLINK_DURATION_MS = 120;

/** Base eyebrow offset per mood, in viewBox units (negative = raised). */
const EYEBROW_BASE_Y: Record<AvatarMood, number> = {
  speaking: 0,
  listening: -2,
  thinking: -3,
  celebrating: -2,
};

const RAISED_ARM_ROTATION = -135;

// Sleeves are a slightly deeper shade of the hoodie so arms read against the torso.
const SLEEVE_COLOR = 'color-mix(in srgb, var(--secondary) 86%, var(--secondary-soft-fg))';

/** A five-pointed star centered on the origin. */
function starPath(outerRadius: number, innerRadius: number): string {
  const points = 5;
  const step = Math.PI / points;
  const commands: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = i * step - Math.PI / 2;
    const x = (radius * Math.cos(angle)).toFixed(2);
    const y = (radius * Math.sin(angle)).toFixed(2);
    commands.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  return `${commands.join(' ')} Z`;
}
const STAR_PATH = starPath(17, 7);

const INSTANT: Transition = { duration: 0 };

/** Head pose per mood: a bob, a tilted sway, still, or a happy nod; `frozen` keeps the pose only. */
function headMotion(
  mood: AvatarMood,
  frozen: boolean,
): { animate: TargetAndTransition; transition: Transition } {
  if (frozen) {
    return {
      animate: { x: 0, y: 0, rotate: mood === 'listening' ? 5 : 0 },
      transition: INSTANT,
    };
  }
  switch (mood) {
    case 'speaking':
      return {
        animate: { x: [-0.5, 0.5, -0.5], y: [-1, 1, -1], rotate: 0 },
        transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
      };
    case 'listening':
      return {
        animate: { x: 0, y: 0, rotate: [3, 7, 3] },
        transition: {
          rotate: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
          default: { duration: 0.3 },
        },
      };
    case 'celebrating':
      // Three nods (300ms down, 300ms back) over 1.8s, then it holds still.
      return {
        animate: { x: 0, y: 0, rotate: [0, 5, 0, 5, 0, 5, 0] },
        transition: {
          rotate: { duration: 1.8, ease: 'easeInOut' },
          default: { duration: 0.3 },
        },
      };
    case 'thinking':
      return { animate: { x: 0, y: 0, rotate: 0 }, transition: { duration: 0.3 } };
  }
}

/** Blinks at a random interval within the mood's range; never runs while frozen. */
function useBlink(mood: AvatarMood, frozen: boolean): boolean {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    const range = BLINK_RANGE_MS[mood];
    if (!range || frozen) return;
    const [min, max] = range;
    let cancelled = false;
    let scheduleId: number | undefined;
    let releaseId: number | undefined;

    const scheduleNext = (): void => {
      scheduleId = window.setTimeout(
        () => {
          if (cancelled) return;
          setBlinking(true);
          releaseId = window.setTimeout(() => {
            if (cancelled) return;
            setBlinking(false);
            scheduleNext();
          }, BLINK_DURATION_MS);
        },
        min + Math.random() * (max - min),
      );
    };
    scheduleNext();

    return () => {
      cancelled = true;
      window.clearTimeout(scheduleId);
      window.clearTimeout(releaseId);
      setBlinking(false);
    };
  }, [mood, frozen]);

  return blinking;
}

interface EyeProps {
  cx: number;
  cy: number;
  blinking: boolean;
  frozen: boolean;
  mood: AvatarMood;
}

/** One open eye: white, a pupil that can look around, and a highlight. Blinks by squashing. */
function Eye({ cx, cy, blinking, frozen, mood }: EyeProps) {
  const looking = mood === 'thinking';
  const pupilAnimate: TargetAndTransition = frozen
    ? { x: looking ? 3 : 0, y: looking ? -2.5 : 0 }
    : looking
      ? { x: [0, 3, 3, 0], y: [0, -2.5, -2.5, 0] }
      : { x: 0, y: 0 };
  const pupilTransition: Transition =
    frozen || !looking
      ? { duration: frozen ? 0 : 0.3 }
      : { duration: 2, times: [0, 0.3, 0.7, 1], repeat: Infinity, ease: 'easeInOut' };

  return (
    <motion.g
      data-avatar-part="eye"
      animate={{ scaleY: blinking ? 0.08 : 1 }}
      transition={{ duration: 0.06, ease: 'easeInOut' }}
    >
      <ellipse cx={cx} cy={cy} rx="10" ry="8" fill="var(--avatar-eye-white)" />
      <motion.g animate={pupilAnimate} transition={pupilTransition}>
        <circle data-avatar-part="pupil" cx={cx} cy={cy} r="4.6" fill="var(--avatar-ink)" />
        <circle cx={cx - 1.6} cy={cy - 1.8} r="1.4" fill="var(--avatar-eye-white)" opacity="0.9" />
      </motion.g>
    </motion.g>
  );
}

/** The happy-squint crescent that replaces the open eye while celebrating. */
function SquintEye({ cx, cy }: { cx: number; cy: number }) {
  return (
    <path
      data-avatar-part="squint"
      d={`M ${String(cx - 10)} ${String(cy + 3)} Q ${String(cx)} ${String(cy - 9)} ${String(cx + 10)} ${String(cy + 3)}`}
      fill="none"
      stroke="var(--avatar-ink)"
      strokeWidth="3.4"
      strokeLinecap="round"
    />
  );
}

function Mouth({ mood, frozen }: { mood: AvatarMood; frozen: boolean }) {
  if (mood === 'speaking') {
    // Closed line -> rounded open shape: 250ms open, 250ms close, on a loop. No audio lip-sync.
    return (
      <motion.ellipse
        data-avatar-part="mouth"
        cx="120"
        cy="113"
        rx="9"
        ry="8"
        fill="var(--avatar-ink)"
        animate={{ scaleY: frozen ? 1 : [0.15, 1, 0.15] }}
        transition={
          frozen
            ? INSTANT
            : { duration: 0.5, times: [0, 0.5, 1], repeat: Infinity, ease: 'easeInOut' }
        }
      />
    );
  }
  if (mood === 'celebrating') {
    return (
      <path
        data-avatar-part="mouth"
        d="M 103 108 Q 120 111 137 108 Q 134 127 120 127 Q 106 127 103 108 Z"
        fill="var(--avatar-ink)"
        strokeLinejoin="round"
        stroke="var(--avatar-ink)"
        strokeWidth="2"
      />
    );
  }
  if (mood === 'thinking') {
    // A small closed line that now and then purses.
    return (
      <motion.path
        data-avatar-part="mouth"
        d="M 111 112 Q 120 114 129 112"
        fill="none"
        stroke="var(--avatar-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ scaleX: frozen ? 1 : [1, 1, 0.8, 1, 1] }}
        transition={
          frozen
            ? INSTANT
            : { duration: 4, times: [0, 0.4, 0.5, 0.6, 1], repeat: Infinity, ease: 'easeInOut' }
        }
      />
    );
  }
  return (
    <path
      data-avatar-part="mouth"
      d="M 107 110 Q 120 120 133 110"
      fill="none"
      stroke="var(--avatar-ink)"
      strokeWidth="3"
      strokeLinecap="round"
    />
  );
}

/**
 * A reusable, hand-drawn study companion: a neutral, waist-up figure in a warm hoodie whose
 * face, head and (when thinking) hand animate to show what it is doing. Every color comes from
 * a CSS token, so it follows light/dark mode; motion is framer-motion only and collapses to the
 * mood's static pose when `paused` or when the user prefers reduced motion.
 */
export function StudyAvatar({
  mood = 'listening',
  size = 320,
  paused = false,
  className,
}: StudyAvatarProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const frozen = paused || prefersReducedMotion;
  const blinking = useBlink(mood, frozen);
  const head = headMotion(mood, frozen);
  const celebrating = mood === 'celebrating';

  const browAnimate: TargetAndTransition = { y: EYEBROW_BASE_Y[mood] };
  // While speaking, the brows lift briefly once every 1.5s, i.e. on every 3rd mouth opening.
  const browLift: TargetAndTransition =
    mood === 'speaking' && !frozen ? { y: [0, -3, 0, 0] } : { y: 0 };
  const browLiftTransition: Transition =
    mood === 'speaking' && !frozen
      ? { duration: 1.5, times: [0, 0.15, 0.3, 1], repeat: Infinity, ease: 'easeInOut' }
      : { duration: frozen ? 0 : 0.2 };

  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role="img"
      aria-labelledby={titleId}
      className={className}
      data-mood={mood}
      data-frozen={String(frozen)}
    >
      <title id={titleId}>{t('avatar.title', { mood: t(`avatar.mood_${mood}`) })}</title>

      {/* Hood: a soft ring peeking out behind the head. */}
      <g data-avatar-part="hood">
        <ellipse cx="120" cy="100" rx="64" ry="66" fill="var(--secondary-soft-fg)" />
        <ellipse cx="120" cy="104" rx="58" ry="60" fill="var(--secondary)" />
      </g>

      {/* Torso in a hoodie, running off the bottom edge. */}
      <g data-avatar-part="torso">
        <path
          d="M 20 240 L 20 192 C 20 166 40 152 70 147 L 100 141 L 140 141 L 170 147 C 200 152 220 166 220 192 L 220 240 Z"
          fill="var(--secondary)"
        />
        <ellipse cx="120" cy="146" rx="32" ry="11" fill="var(--secondary-soft-fg)" />
        <path
          d="M 108 152 L 106 186 M 132 152 L 134 186"
          stroke="var(--secondary-soft)"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* Neck. */}
      <g data-avatar-part="neck">
        <rect x="107" y="120" width="26" height="28" rx="9" fill="var(--avatar-skin)" />
        <rect
          x="107"
          y="120"
          width="26"
          height="12"
          fill="var(--avatar-skin-shade)"
          opacity="0.55"
        />
      </g>

      {/* Right arm (screen right), hand resting at the side. */}
      <g data-avatar-part="right-arm">
        <line
          x1="182"
          y1="166"
          x2="188"
          y2="222"
          strokeWidth="24"
          strokeLinecap="round"
          style={{ stroke: SLEEVE_COLOR }}
        />
        <circle cx="188" cy="227" r="13" fill="var(--avatar-skin)" />
      </g>

      {/* Head, hair and face move together. */}
      <motion.g data-avatar-part="head" animate={head.animate} transition={head.transition}>
        {/* Invisible anchor: framer-motion rotates SVG groups around their bounding-box center,
            so this circle centers that box on the neck, where the head should pivot. */}
        <circle cx="120" cy="135" r="105" fill="none" />
        <ellipse cx="76" cy="90" rx="6" ry="9" fill="var(--avatar-skin-shade)" />
        <ellipse cx="164" cy="90" rx="6" ry="9" fill="var(--avatar-skin-shade)" />
        <ellipse cx="120" cy="86" rx="44" ry="48" fill="var(--avatar-skin)" />
        <path
          data-avatar-part="hair"
          d="M 75 86 C 70 50 92 33 120 33 C 148 33 170 50 165 86 C 158 68 146 59 120 59 C 94 59 82 68 75 86 Z"
          fill="var(--avatar-hair)"
        />

        <circle cx="90" cy="102" r="7" fill="var(--secondary)" opacity="0.28" />
        <circle cx="150" cy="102" r="7" fill="var(--secondary)" opacity="0.28" />

        {celebrating ? (
          <g data-avatar-part="eyes">
            <SquintEye cx={96} cy={82} />
            <SquintEye cx={144} cy={82} />
          </g>
        ) : (
          <g data-avatar-part="eyes">
            <Eye cx={96} cy={82} blinking={blinking} frozen={frozen} mood={mood} />
            <Eye cx={144} cy={82} blinking={blinking} frozen={frozen} mood={mood} />
          </g>
        )}

        <motion.g
          data-avatar-part="eyebrows"
          animate={browAnimate}
          transition={{ duration: frozen ? 0 : 0.3 }}
        >
          <motion.g animate={browLift} transition={browLiftTransition}>
            <path
              d="M 85 68 Q 96 62 107 67 M 133 67 Q 144 62 155 68"
              fill="none"
              stroke="var(--avatar-hair)"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          </motion.g>
        </motion.g>

        <path
          data-avatar-part="nose"
          d="M 116 92 Q 120 100 124 93"
          fill="none"
          stroke="var(--avatar-skin-shade)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />

        <Mouth mood={mood} frozen={frozen} />
      </motion.g>

      {/* Left arm (screen left): rests at the side, swings up to the chin while thinking. */}
      <motion.g
        data-avatar-part={mood === 'thinking' ? 'raised-hand' : 'left-arm'}
        initial={false}
        animate={{ rotate: mood === 'thinking' ? RAISED_ARM_ROTATION : 0 }}
        transition={
          frozen
            ? INSTANT
            : mood === 'thinking'
              ? { duration: 0.4, ease: 'easeOut' }
              : { duration: 0.4, ease: 'easeIn' }
        }
      >
        {/* Invisible anchor centering the bounding box on the shoulder, the arm's pivot. */}
        <circle cx="58" cy="166" r="80" fill="none" />
        <line
          x1="58"
          y1="166"
          x2="52"
          y2="222"
          strokeWidth="24"
          strokeLinecap="round"
          style={{ stroke: SLEEVE_COLOR }}
        />
        <circle cx="52" cy="227" r="13" fill="var(--avatar-skin)" />
      </motion.g>

      {/* Celebration star, upper right of the head. */}
      <g transform="translate(188 44)">
        <AnimatePresence>
          {celebrating ? (
            <motion.g
              key="star"
              data-avatar-part="star"
              initial={frozen ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: frozen ? 1 : [0.6, 1.1, 1] }}
              exit={{ opacity: 0, transition: { duration: frozen ? 0 : 0.2 } }}
              transition={frozen ? INSTANT : { duration: 0.2, ease: 'easeOut' }}
            >
              <motion.g
                animate={{ scale: frozen ? 1 : [1, 1.08, 1] }}
                transition={
                  frozen
                    ? INSTANT
                    : { duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }
                }
              >
                <path
                  d={STAR_PATH}
                  fill="var(--primary)"
                  stroke="var(--primary-hover)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </motion.g>
            </motion.g>
          ) : null}
        </AnimatePresence>
      </g>
    </svg>
  );
}
