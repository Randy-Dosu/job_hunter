/**
 * Small HTTP helper shared by connectors: timeouts, retries with exponential
 * backoff, and source-friendly defaults. Uses the injected `fetch` so tests run
 * entirely offline.
 */

import type { ConnectorContext } from './types.js';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly bodyPreview?: string | undefined,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
  'JobHunterBot/0.1 (+https://github.com/Randy-Dosu/job_hunter; personal job search assistant)';

export interface RequestOptions {
  method?: 'GET' | 'POST' | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  timeoutMs?: number | undefined;
  retries?: number | undefined;
  /** Base backoff delay in ms (doubles each retry). */
  backoffMs?: number | undefined;
}

/**
 * Performs a request and parses JSON. Retries only on transport errors, 429 and
 * 5xx — never on 4xx client errors, which indicate a permanent problem.
 */
export async function fetchJson<T>(
  url: string,
  context: ConnectorContext,
  options: RequestOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 500;
  const timeoutMs = options.timeoutMs ?? context.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const externalAbort = () => controller.abort(new Error('aborted'));
    context.signal?.addEventListener('abort', externalAbort, { once: true });

    try {
      const response = await context.fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': context.userAgent ?? DEFAULT_USER_AGENT,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        ...(options.body ? { body: options.body } : {}),
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const bodyPreview = await safePreview(response);
        throw new HttpError(
          `Request to ${hostOf(url)} failed with ${response.status}`,
          response.status,
          retryable,
          bodyPreview,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof HttpError
          ? error.retryable
          : !(context.signal?.aborted ?? false) && !isAbort(error);
      if (!retryable || attempt === retries) throw normalizeError(error, url);
      await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', externalAbort);
    }
  }
  throw normalizeError(lastError, url);
}

/** Fetch plain text (RSS/HTML), same retry semantics as `fetchJson`. */
export async function fetchText(
  url: string,
  context: ConnectorContext,
  options: RequestOptions = {},
): Promise<string> {
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 500;
  const timeoutMs = options.timeoutMs ?? context.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await context.fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'user-agent': context.userAgent ?? DEFAULT_USER_AGENT,
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new HttpError(
          `Request to ${hostOf(url)} failed with ${response.status}`,
          response.status,
          retryable,
          await safePreview(response),
        );
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof HttpError
          ? error.retryable
          : !(context.signal?.aborted ?? false) && !isAbort(error);
      if (!retryable || attempt === retries) throw normalizeError(error, url);
      await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw normalizeError(lastError, url);
}

function normalizeError(error: unknown, url: string): Error {
  if (error instanceof HttpError) return error;
  if (isAbort(error)) return new Error(`Request to ${hostOf(url)} timed out or was aborted`);
  if (error instanceof Error)
    return new Error(`Request to ${hostOf(url)} failed: ${error.message}`);
  return new Error(`Request to ${hostOf(url)} failed`);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message === 'timeout' ||
        error.message === 'aborted')) ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

async function safePreview(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.slice(0, 200);
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
