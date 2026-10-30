/**
 * Citation markers ("[Page 5]", "[Faqja 5]", "[file.py:45-60]") help a reader, but read aloud
 * they come out as noise ("pasted underscore code ... pikë py dy pika shtatëmbëdhjetë"). Only
 * the text handed to a speech engine is cleaned; on-screen scripts and captions keep them.
 * Mirrors the backend's `strip_citations_for_tts` (`app/tts/text_utils.py`).
 */

// Named refs (whole-word label, so "[linear search]" is kept), file:line refs and bare numeric
// refs, with any whitespace before them. The bracket must not directly follow a letter, digit or
// underscore, so code such as `arr[0]` in a tutor answer is left alone. Unicode-aware (`u`) so
// "gjatësinë[Page 3]" is treated the same way as in the backend's Python regex.
const CITATION_RE =
  /\s*(?<![\p{L}\p{N}_])\[\s*(?:(?:Pages?|Faqja|Faqet|Slides?|Slajdi|Slajdet|Slajd|Lines?|Rreshti|Rreshtat)\b[^\]]*|[A-Za-z_][\w\-.]*\s*:\s*\d+(?:\s*-\s*\d+)?[^\]]*|\d+(?:\s*-\s*\d+)?\s*)\]/giu;

/** Removes citation markers so a speech engine does not read them aloud. */
export function stripCitationsForTts(text: string): string {
  return text
    .replace(CITATION_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
