import { PROGRAMMING_LANGUAGE_IDS, type ProgrammingLanguageId } from '../lib/api';

/** Display name for each dropdown choice. Language/framework names are proper nouns and are
 * not translated, the same convention already used for university names in onboarding. */
const PROGRAMMING_LANGUAGE_LABELS: Record<ProgrammingLanguageId, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  go: 'Go',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
};

export interface ProgrammingLanguageOption {
  id: ProgrammingLanguageId;
  label: string;
}

/** The 14 real languages, in display order. */
export const PROGRAMMING_LANGUAGE_OPTIONS: ProgrammingLanguageOption[] =
  PROGRAMMING_LANGUAGE_IDS.map((id) => ({ id, label: PROGRAMMING_LANGUAGE_LABELS[id] }));
