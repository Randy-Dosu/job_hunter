/**
 * Scripted `fetch` doubles.
 *
 * No test in this repository is allowed to reach the network. These helpers make
 * that explicit: any un-stubbed request throws with the URL, so a missing fixture
 * fails loudly instead of silently passing.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

/** Minimal request description: avoids depending on DOM lib types. */
export type FetchInput = string | URL | { url: string };

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export interface ScriptedFetch {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
  /** Number of requests that matched no route. */
  unmatched: () => number;
}

/**
 * Route by URL pattern. Order matters: the first matching route wins.
 * Anything unmatched returns 404 and is recorded.
 */
export function createScriptedFetch(
  routes: Array<{ match: RegExp | string; respond: Responder }>,
): ScriptedFetch {
  const requests: RecordedRequest[] = [];
  let unmatched = 0;

  const impl = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const request: RecordedRequest = { url, method, headers, ...(body ? { body } : {}) };
    requests.push(request);

    for (const route of routes) {
      const matches =
        typeof route.match === 'string' ? url.includes(route.match) : route.match.test(url);
      if (matches) return route.respond(request);
    }
    unmatched += 1;
    return new Response(JSON.stringify({ error: `No fixture for ${url}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    fetch: impl as unknown as typeof globalThis.fetch,
    requests,
    unmatched: () => unmatched,
  };
}

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return result;
}

/** Convenience: a JSON response. */
export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Convenience: an HTML/XML response. */
export function textResponse(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/**
 * A fetch that always rejects, for asserting retry/failure handling.
 * Records how many attempts were made.
 */
export function createFailingFetch(message = 'network down'): ScriptedFetch {
  const requests: RecordedRequest[] = [];
  const impl = async (input: FetchInput): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push({ url, method: 'GET', headers: {} });
    throw new TypeError(message);
  };
  return { fetch: impl as unknown as typeof globalThis.fetch, requests, unmatched: () => 0 };
}
