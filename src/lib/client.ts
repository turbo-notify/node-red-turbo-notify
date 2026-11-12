import { ApiError, ValidationError, apiErrorFromResponse, transportError } from './errors';
import { USER_AGENT } from './version';

/** The only host this package talks to unless the config node says otherwise. */
export const DEFAULT_BASE_URL = 'https://api.turbonotify.com';

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Array<[string, string]>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The address without a trailing slash or /v1 (the client adds /v1 itself). */
export function normalizeBaseUrl(raw: unknown): string {
  const text = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : DEFAULT_BASE_URL;
  const cleaned = text.replace(/\/+$/, '').replace(/\/v1$/, '');
  let parsed: URL | undefined;
  try {
    parsed = new URL(cleaned);
  } catch {
    parsed = undefined;
  }
  const usable =
    parsed !== undefined &&
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.search === '' &&
    parsed.hash === '';
  if (!usable) {
    throw new ValidationError(
      'Base URL',
      `is not a valid web address. Use ${DEFAULT_BASE_URL} unless support gave you another address.`,
    );
  }
  return cleaned;
}

export function buildUrl(baseUrl: string, path: string, query?: Array<[string, string]>): string {
  const url = new URL(`${baseUrl}/v1${path}`);
  for (const [key, value] of query ?? []) url.searchParams.append(key, value);
  return url.toString();
}

/** One call to the API, authenticated with the key. Resolves with the parsed JSON body. */
export async function apiRequest<T = Record<string, unknown>>(
  config: ApiConfig,
  options: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    ...options.headers,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options.method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    let response: Response;
    try {
      response = await fetch(buildUrl(config.baseUrl, options.path, options.query), {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw transportError(timedOut ? 'timeout' : 'unreachable');
    }

    const text = await response.text();
    let parsed: unknown = {};
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    if (!response.ok) {
      throw apiErrorFromResponse(response.status, parsed, response.headers.get('retry-after'));
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export { ApiError };
