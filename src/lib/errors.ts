/** A value the flow author supplied is not acceptable. Raised before any request is made. */
export class ValidationError extends Error {
  readonly property: string;
  readonly code = 'invalid_input';
  readonly cause: { property: string };
  constructor(property: string, problem: string) {
    super(`${property}: ${problem}`);
    this.name = 'ValidationError';
    this.property = property;
    this.cause = { property };
  }
  /** Node-RED logs and reports an error through toString(): keep it to the message. */
  toString(): string {
    return this.message;
  }
}

export interface ApiErrorDetails {
  status?: number;
  description: string;
  requiredScope?: string;
  retryAfter?: number;
}

/**
 * The API refused the call, or there was no answer. `message` is the API error code
 * (for example `insufficient_scope`); the human description is in `details.description`.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly details: ApiErrorDetails;
  /** Node-RED copies this to `msg.error.cause` for a Catch node. */
  readonly cause: ApiErrorDetails;
  constructor(code: string, details: ApiErrorDetails) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.cause = details;
  }
  /** Node-RED logs and reports an error through toString(): the API error code alone. */
  toString(): string {
    return this.code;
  }
}

const DASHBOARD = 'https://dashboard.turbonotify.com';

const KNOWN: Record<string, string> = {
  not_authenticated: `The API key was not accepted. A revoked or expired key never works again: create a new one under API keys in the dashboard (${DASHBOARD}/api-keys).`,
  number_not_connected: `The number is not connected to WhatsApp. Reconnect it under Numbers in the dashboard (${DASHBOARD}/numbers).`,
  number_not_found: 'The number was not found. Use main, the alias of an extra number or its num_ id.',
  not_found: 'Nothing was found for that id on this number. Ids belong to one number.',
  feature_not_available: `The current plan does not include this feature. Compare plans under Billing in the dashboard (${DASHBOARD}/billing).`,
  subscription_inactive: `The subscription is not active. Sort out the payment under Billing in the dashboard (${DASHBOARD}/billing).`,
  messages_quota_exceeded:
    "The number's message allowance is used up. It resets when the billing cycle turns, and retrying now gives the same answer.",
  contact_quota_exceeded:
    "The number's contact allowance is used up. It resets when the billing cycle turns, and retrying now gives the same answer.",
  send_rate_spacing:
    'Messages are going out faster than this number allows. Wait for the Retry-After time, or add a delay node between sends.',
  rate_limit_exceeded: 'Too many requests. Wait for the Retry-After time and try again.',
  warmup_limit_exceeded:
    "This number's daily volume is still being released in its first week. The count starts again at midnight UTC.",
  reply_ratio_too_low:
    'This number has sent much more than it has received. Sending resumes when contacts reply or the volume drops.',
  duplicate_burst_blocked:
    'The same text went to too many recipients in the last hour. Vary the text or space the sends out.',
  recipients_per_day_limit_exceeded:
    'This recipient already received the daily maximum from this number. Try again tomorrow.',
  unreachable: 'Could not reach Turbo Notify. Check the network of this Node-RED: it must be able to reach the internet.',
  timeout: 'Turbo Notify did not answer in time. Reads are safe to repeat. For a send, check the status of the message before sending it again, because it may have gone out.',
};

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** Builds the error for a non-2xx answer. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): ApiError {
  const data = asObject(body);
  let code = typeof data.error === 'string' && data.error !== '' ? data.error : '';
  if (code === '') code = status === 401 ? 'not_authenticated' : `http_${status}`;

  const retry = Number(retryAfterHeader);
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
  const requiredScope = typeof data.required_scope === 'string' ? data.required_scope : undefined;

  let description = KNOWN[code] ?? '';
  if (code === 'insufficient_scope') {
    description = `The API key cannot do this. Add the '${requiredScope ?? 'required'}' scope to the key, or create a key from a template that includes it.`;
  } else if (code === 'validation_error') {
    const errors = asObject(data.details).errors;
    const fields = Array.isArray(errors)
      ? errors
          .map((e) => {
            const entry = asObject(e);
            const loc = Array.isArray(entry.loc)
              ? entry.loc.filter((p) => p !== 'body').join('.')
              : '';
            return `${loc}: ${String(entry.msg ?? '')}`.trim();
          })
          .join('; ')
      : '';
    description = fields !== '' ? `Turbo Notify rejected a value. ${fields}` : 'Turbo Notify rejected a value.';
  }
  if (description === '') {
    if (typeof data.message === 'string') description = data.message;
    else if (status >= 500) description = 'This happened on the Turbo Notify side. Reads are safe to repeat. For a send, check the status of the message before sending it again.';
    else description = `The API answered ${status}.`;
  }
  if (retryAfter !== undefined) description = `${description} Retry after ${retryAfter} seconds.`;

  return new ApiError(code, { status, description, requiredScope, retryAfter });
}

export function transportError(kind: 'unreachable' | 'timeout'): ApiError {
  return new ApiError(kind, { description: KNOWN[kind] });
}
