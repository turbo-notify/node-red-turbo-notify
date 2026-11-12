import { ValidationError } from './errors';

const MESSAGE_ID = /^msg_[0-9a-f]{32}$/;
const CONTACT_ID = /^ct_[0-9a-f]{32}$/;
const GROUP_ID = /^grp_[0-9a-f]{32}$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

export const MAX_TEXT = 4096;
export const MAX_CAPTION = 1024;
export const MAX_FILENAME = 255;
export const MAX_URL = 2083;

/** A value that is not set: undefined, null or empty text. */
export const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** Text, or a finite number that arrived from an earlier node (a sensor reading, a phone column). */
export function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function requireText(value: unknown, where: string, max: number): string {
  if (value !== null && typeof value === 'object') {
    throw new ValidationError(where, 'holds an object or a list, not text. Turn it into text first, for example with a change or function node.');
  }
  const text = asString(value);
  if (text === '') throw new ValidationError(where, 'is empty');
  if (text.length > max) {
    throw new ValidationError(where, `is too long (${text.length} characters, the limit is ${max})`);
  }
  return text;
}

export function optionalText(value: unknown, where: string, max: number): string | undefined {
  return isBlank(value) ? undefined : requireText(value, where, max);
}

export function requirePhone(value: unknown, where: string): string {
  const raw = asString(value);
  if (raw === '') throw new ValidationError(where, 'is empty');
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (!PHONE.test(cleaned)) {
    throw new ValidationError(
      where,
      "is not a valid international number. Start with + and the country code, for example +12025550123. If your data has digits only, add the '+' first.",
    );
  }
  return cleaned;
}

function requireId(value: unknown, where: string, pattern: RegExp, prefix: string): string {
  const id = asString(value);
  if (id === '') throw new ValidationError(where, 'is empty');
  if (id.startsWith('evt_')) {
    throw new ValidationError(where, 'holds an event id. An event carries the message id in payload.data.id.');
  }
  if (!pattern.test(id)) {
    throw new ValidationError(
      where,
      `is not a valid id. It starts with ${prefix}_ followed by 32 letters and digits, for example ${prefix}_0198d3c5a1b24d3e9f01a2b3c4d5e6f7.`,
    );
  }
  return id;
}

export const messageId = (value: unknown, where: string) => requireId(value, where, MESSAGE_ID, 'msg');
export const contactId = (value: unknown, where: string) => requireId(value, where, CONTACT_ID, 'ct');
export const groupId = (value: unknown, where: string) => requireId(value, where, GROUP_ID, 'grp');

export function requireHttpUrl(value: unknown, where: string, max = MAX_URL): string {
  const text = requireText(value, where, max);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ValidationError(where, 'is not a valid web address. Use a full address that starts with http:// or https://');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError(where, 'must start with http:// or https://');
  }
  return text;
}

export function requireNumberInRange(value: unknown, where: string, min: number, max: number): number {
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = numeric ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ValidationError(where, `must be a number from ${min} to ${max}`);
  }
  return n;
}

export function idempotencyKey(value: unknown, where: string): string | undefined {
  if (isBlank(value)) return undefined;
  const key = typeof value === 'string' ? value : String(value);
  if (key.length < 1 || key.length > 255) {
    throw new ValidationError(where, 'must have 1 to 255 characters');
  }
  if (!/^[\x20-\x7e]+$/.test(key)) {
    throw new ValidationError(where, 'may hold only plain letters, digits and punctuation, for example order-4711');
  }
  return key;
}

/** `main`, the alias of an extra number, or its num_ id. */
export function numberRef(value: unknown, where: string): string {
  const ref = asString(value);
  if (ref === '') throw new ValidationError(where, 'is empty. Use main, the alias of an extra number or its num_ id.');
  if (ref.length > 128 || [...ref].some((char) => char.charCodeAt(0) < 32)) {
    throw new ValidationError(where, 'is not a valid number alias or id');
  }
  return ref;
}

export type Recipient = { number: string } | { contact_id: string } | { group_id: string };

const RECIPIENT_KEYS = ['number', 'contact_id', 'group_id'] as const;

/**
 * One recipient: a phone number, a `ct_` contact id or a `grp_` group id (text, the prefix tells
 * them apart), or an object with exactly one of `number`, `contact_id` and `group_id`.
 */
export function recipient(value: unknown, where: string): Recipient {
  if (Array.isArray(value)) {
    if (value.length > 1) {
      throw new ValidationError(where, 'holds several recipients. A message goes to one recipient: split the list so each message carries one (a split node).');
    }
    return recipient(value[0], where);
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const given = RECIPIENT_KEYS.filter((key) => !isBlank(object[key]));
    if (given.length > 1) {
      throw new ValidationError(where, `has two recipients (${given.join(' and ')}). Give one of number, contact_id or group_id.`);
    }
    if (given.length === 0) {
      throw new ValidationError(where, 'has no recipient. Give one of number, contact_id or group_id.');
    }
    const key = given[0];
    if (key === 'contact_id') return { contact_id: contactId(object[key], `${where}.contact_id`) };
    if (key === 'group_id') return { group_id: groupId(object[key], `${where}.group_id`) };
    return { number: requirePhone(object[key], `${where}.number`) };
  }
  const text = asString(value);
  if (text.startsWith('ct_')) return { contact_id: contactId(text, where) };
  if (text.startsWith('grp_')) return { group_id: groupId(text, where) };
  return { number: requirePhone(text, where) };
}

export const MEDIA_FIELD = {
  image: 'image_url',
  video: 'video_url',
  audio: 'audio_url',
  document: 'document_url',
  sticker: 'sticker_url',
} as const;
export type MediaType = keyof typeof MEDIA_FIELD;

export const isMediaType = (value: unknown): value is MediaType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(MEDIA_FIELD, value);
