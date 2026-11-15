/**
 * Typed API client.
 *
 * All requests are same-origin (`/api/v1`): in development Vite proxies them to
 * the API, and in production the frontend host rewrites them. The session lives
 * in an HttpOnly cookie, so no token is ever handled by JavaScript.
 */

const API_PREFIX = '/api/v1';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string[]> | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'unknown_error';
    this.details = body?.error.details;
    this.requestId = body?.error.requestId;
  }

  /** Field-level validation messages, flattened for form display. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [field, messages] of Object.entries(this.details ?? {})) {
      if (messages[0]) result[field] = messages[0];
    }
    return result;
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('We could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Set for multipart uploads; the body is passed through untouched. */
  raw?: BodyInit | undefined;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;

  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    let parsed: ApiErrorBody | undefined;
    if (contentType.includes('application/json')) {
      parsed = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
    }
    throw new ApiError(response.status, parsed);
  }

  if (contentType.includes('application/json')) return (await response.json()) as T;
  return (await response.text()) as unknown as T;
}

/** Download a generated file through fetch so the session cookie is sent. */
export async function download(path: string, fileName: string): Promise<void> {
  const response = await fetch(`${API_PREFIX}${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
    throw new ApiError(response.status, body);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
