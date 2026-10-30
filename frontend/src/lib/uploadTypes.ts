/**
 * Extensions the backend accepts (`app.ingestion.pipeline.SUPPORTED_EXTENSIONS`), used to
 * pre-filter the file picker and give an early hint; the server re-validates every upload.
 * Note `.txt` is not accepted by the backend, so it is deliberately not listed.
 */
export const ACCEPTED_EXTENSIONS =
  '.pdf,.pptx,.py,.js,.jsx,.ts,.tsx,.java,.c,.cc,.cpp,.h,.hpp,.cs,.go,.rs,.php,.rb,.kt,.swift,.sql,.html,.css,.sh,.json,.yaml,.yml,.md,.zip';

/** Human-readable file size, e.g. "1.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
