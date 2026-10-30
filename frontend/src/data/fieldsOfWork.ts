/** Field-of-work options for the professional/other onboarding path, in display order. */
export const FIELD_OF_WORK_IDS = [
  'it',
  'health',
  'economics',
  'law',
  'education',
  'engineering',
  'marketing',
  'naturalScience',
  'socialScience',
  'artsDesign',
  'other',
] as const;
export type FieldOfWorkId = (typeof FIELD_OF_WORK_IDS)[number];
