import { StudyAvatar, type AvatarMood } from '../avatar/StudyAvatar';

/**
 * The Avatar tab's face. It keeps the original `Avatar`/`AvatarState` API so `ExplainerPanel`
 * needs no changes, and simply renders the reusable `StudyAvatar` with the matching mood.
 */

export type AvatarState = 'idle' | 'thinking' | 'speaking' | 'happy' | 'encouraging';

interface AvatarProps {
  state: AvatarState;
  /** Freeze the avatar on its current pose (e.g. narration is paused). */
  paused?: boolean;
  className?: string;
  /**
   * Kept for API compatibility with the old mascot, which drove its mouth from audio amplitude.
   * `StudyAvatar` deliberately does not lip-sync, so these are accepted and ignored.
   */
  amplitude?: number;
  mouthMode?: 'amplitude' | 'timed';
}

// `encouraging` (a wrong mini-quiz answer) has no dedicated mood; the attentive, smiling
// `listening` pose is the closest fit.
const MOOD_BY_STATE: Record<AvatarState, AvatarMood> = {
  idle: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'celebrating',
  encouraging: 'listening',
};

export function Avatar({ state, paused = false, className }: AvatarProps) {
  return <StudyAvatar mood={MOOD_BY_STATE[state]} paused={paused} className={className} />;
}
