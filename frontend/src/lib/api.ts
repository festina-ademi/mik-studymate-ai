/** Typed client for the StudyMate backend. Paths are relative to ``/api``. */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** Response of ``GET /api/health``. */
export interface HealthResponse {
  status: 'ok';
  version: string;
}

/** An error reported by the API, or a failure to reach it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** i18n key the UI translates; the backend never sends user-facing prose. */
  readonly messageKey: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    messageKey = `errors.${code}`,
    details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the standard ``{"error": {code, message_key, details}}`` envelope. */
function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message_key: messageKey, details } = body.error;
    if (typeof code === 'string') {
      return new ApiError(
        status,
        code,
        typeof messageKey === 'string' ? messageKey : undefined,
        isRecord(details) ? details : {},
      );
    }
  }
  return new ApiError(status, 'http_error');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(
  path: string,
  parse: (body: unknown) => T | undefined,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'network');
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw parseErrorEnvelope(response.status, body);
  }
  const parsed = parse(body);
  if (parsed === undefined) {
    throw new ApiError(response.status, 'invalid_response');
  }
  return parsed;
}

function parseHealth(body: unknown): HealthResponse | undefined {
  if (isRecord(body) && body.status === 'ok' && typeof body.version === 'string') {
    return { status: 'ok', version: body.version };
  }
  return undefined;
}

/** Ask the backend whether it is running. */
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/api/health', parseHealth, signal);
}
