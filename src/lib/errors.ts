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
  number_not_connected: `The WhatsApp number is not connected. Link it under Numbers in the dashboard with Connect main number, or reconnect it if it was linked before (${DASHBOARD}/numbers).`,
  no_main_number: `No main WhatsApp number is linked yet. Link it under Numbers in the dashboard with Connect main number (${DASHBOARD}/numbers).`,
  no_main_number_configured: `No main WhatsApp number is linked yet. Link it under Numbers in the dashboard with Connect main number (${DASHBOARD}/numbers).`,
  main_number_not_paired: `The main WhatsApp number lost its link. Connect it again under Numbers in the dashboard (${DASHBOARD}/numbers).`,
  number_not_found: 'The number was not found. Use main, the alias of an extra number or its num_ id.',
  not_found: 'Nothing was found for that id on this number. Ids belong to one number.',
  feature_not_available: `The current plan does not include this feature. Compare plans under Billing in the dashboard (${DASHBOARD}/billing).`,
  subscription_inactive: `The subscription is not active. Sort out the payment under Billing in the dashboard (${DASHBOARD}/billing).`,
  messages_quota_exceeded:
    "The message allowance of this number for the current billing cycle (one month) is used up. It starts again when the cycle turns (the date is under Billing in the dashboard) or right after a change to a bigger plan, and retrying now gives the same answer.",
  contact_quota_exceeded:
    "The contact allowance of this number for the current billing cycle (one month) is used up. It starts again when the cycle turns (the date is under Billing in the dashboard) or right after a change to a bigger plan, and retrying now gives the same answer.",
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
  timeout: 'Turbo Notify did not answer in time. Reads are safe to repeat. A send may have gone out: look in your WhatsApp or under Messages in the dashboard before sending it again, or set msg.idempotencyKey so that a repeat cannot send twice.',
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
    description = `The API key cannot do this. It lacks the '${requiredScope ?? 'required'}' scope, and the scopes of a key cannot be changed afterwards: create a new key under API keys in the dashboard (${DASHBOARD}/api-keys) with that scope, for example from the AI agent (MCP) template.`;
  } else if (code === 'validation_error') {
    const errors = asObject(data.details).errors;
    const fields = Array.isArray(errors)
      ? errors
          .map((e) => {
            const entry = asObject(e);
            // The API answers { field: 'body.to.number', message, type }.
            const field = typeof entry.field === 'string' ? entry.field.replace(/^body\./, '') : '';
            const reason = typeof entry.message === 'string' ? entry.message : '';
            return field !== '' && reason !== '' ? `${field}: ${reason}` : field || reason;
          })
          .join('; ')
      : '';
    description = fields !== '' ? `Turbo Notify rejected a value. ${fields}` : 'Turbo Notify rejected a value.';
  }
  if (description === '') {
    if (typeof data.message === 'string') description = data.message;
    else if (status >= 500) description = 'This happened on the Turbo Notify side. Reads are safe to repeat. A send may have gone out: look in your WhatsApp or under Messages in the dashboard before sending it again, or set msg.idempotencyKey so that a repeat cannot send twice.';
    else description = `The API answered ${status}.`;
  }
  if (retryAfter !== undefined) description = `${description} Retry after ${retryAfter} seconds.`;

  return new ApiError(code, { status, description, requiredScope, retryAfter });
}

export function transportError(kind: 'unreachable' | 'timeout'): ApiError {
  return new ApiError(kind, { description: KNOWN[kind] });
}
