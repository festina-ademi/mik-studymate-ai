/** Turn a citation label (e.g. "Page 12", "Faqja 12", "Slide 7", "Slajdi 7", "main.py:45-60")
 * into the DOM id of the matching item in the original-material viewer. */

function parseReferenceId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function getReferenceTargetId(reference: string, documentId: string): string {
  const normalized = reference.trim();
  // "Page"/"Faqja" (English/Albanian) both refer to the same page-numbered viewer item.
  const pageMatch = /(?:Page|Faqja)\s+(\d+)/i.exec(normalized);
  if (pageMatch) return 'page-' + documentId + '-' + String(pageMatch[1]);
  // "Slide"/"Slajdi" (English/Albanian) both refer to the same slide-numbered viewer item.
  const slideMatch = /(?:Slide|Slajdi)\s+(\d+)/i.exec(normalized);
  if (slideMatch) return 'slide-' + documentId + '-' + String(slideMatch[1]);
  const lineMatch = /([A-Za-z0-9._/-]+):(\d+)(?:-(\d+))?/.exec(normalized);
  if (lineMatch) {
    const fileName = lineMatch[1] ?? 'file';
    const start = lineMatch[2] ?? '0';
    const end = lineMatch[3] ?? start;
    return fileName + '-' + start + '-' + end;
  }
  return parseReferenceId(normalized) || documentId;
}
