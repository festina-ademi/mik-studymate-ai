import { readUserProfile } from './profile';

/**
 * Where every "get started" call-to-action leads: first-time visitors are onboarded at
 * `/welcome`; anyone with a saved profile goes straight to `/workspace`. Missing or malformed
 * profile data counts as "no profile" rather than throwing.
 */
export function getStartRoute(): '/welcome' | '/workspace' {
  return readUserProfile() === null ? '/welcome' : '/workspace';
}
