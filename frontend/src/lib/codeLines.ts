import type { ChunkRecord } from './api';

/** Line-by-line explanations work best up to this many non-empty code lines (Phase 15). */
export const LINE_BY_LINE_MAX_LINES = 30;

/**
 * Number of non-empty source lines across a code document's chunks.
 *
 * Python chunks can overlap (a class and each of its methods are separate chunks), so lines are
 * counted once per real line number when chunks carry one; chunks without a `line_start` are
 * simply counted as-is.
 */
export function countCodeLines(chunks: readonly ChunkRecord[]): number {
  const numbered = new Set<number>();
  let unnumbered = 0;
  chunks.forEach((chunk) => {
    chunk.text.split('\n').forEach((line, index) => {
      if (!line.trim()) return;
      if (chunk.line_start === null) {
        unnumbered += 1;
      } else {
        numbered.add(chunk.line_start + index);
      }
    });
  });
  return numbered.size + unnumbered;
}

/**
 * The document's code rebuilt from its chunks, in source order, for editing ("Shorten the
 * code"). A chunk nested inside one already included (a method inside its class) is skipped so
 * nothing appears twice.
 */
export function reconstructCode(chunks: readonly ChunkRecord[]): string {
  const ordered = [...chunks].sort(
    (a, b) => (a.line_start ?? Number.MAX_SAFE_INTEGER) - (b.line_start ?? Number.MAX_SAFE_INTEGER),
  );
  const parts: string[] = [];
  let coveredUntil = 0;
  ordered.forEach((chunk) => {
    if (chunk.line_start !== null && chunk.line_end !== null) {
      if (chunk.line_end <= coveredUntil) return;
      coveredUntil = chunk.line_end;
    }
    parts.push(chunk.text.trimEnd());
  });
  return parts.join('\n\n');
}
