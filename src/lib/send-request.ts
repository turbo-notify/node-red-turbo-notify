import { ValidationError } from './errors';
import {
  MAX_CAPTION,
  MAX_FILENAME,
  MAX_TEXT,
  MEDIA_FIELD,
  idempotencyKey,
  isBlank,
  isMediaType,
  messageId,
  numberRef,
  optionalText,
  recipient,
  requireHttpUrl,
  requireNumberInRange,
  requireText,
} from './validation';

/** What the node would call, already validated. */
export interface PreparedSend {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  number: string;
}

export interface SendDefaults {
  /** The "To" property of the node, used when `msg.to` is not set. */
  to?: string;
  /** The "Number" property of the node, used when `msg.number` is not set. */
  number?: string;
}

type Msg = Record<string, unknown>;

const asRecord = (value: unknown, where: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(where, 'must be an object');
  }
  return value as Record<string, unknown>;
};

function mediaContent(value: unknown, payload: unknown): Record<string, unknown> {
  const media = asRecord(value, 'msg.media');
  const type = media.type;
  if (!isMediaType(type)) {
    throw new ValidationError('msg.media.type', 'must be image, video, audio, document or sticker');
  }
  const content: Record<string, unknown> = {
    [MEDIA_FIELD[type]]: requireHttpUrl(media.url, 'msg.media.url'),
  };
  // A text payload with no caption of its own becomes the caption.
  const caption = !isBlank(media.caption)
    ? optionalText(media.caption, 'msg.media.caption', MAX_CAPTION)
    : typeof payload === 'string'
      ? optionalText(payload, 'msg.payload', MAX_CAPTION)
      : undefined;
  if (caption !== undefined) {
    if (type === 'audio' || type === 'sticker') {
      throw new ValidationError('msg.media.caption', `is not supported for ${type} messages`);
    }
    content.caption = caption;
  }
  if (!isBlank(media.filename)) {
    if (type !== 'document') {
      throw new ValidationError('msg.media.filename', 'applies to documents only');
    }
    content.filename = requireText(media.filename, 'msg.media.filename', MAX_FILENAME);
  }
  return content;
}

function locationContent(value: unknown): Record<string, unknown> {
  const location = asRecord(value, 'msg.location');
  const content: Record<string, unknown> = {
    latitude: requireNumberInRange(location.latitude, 'msg.location.latitude', -90, 90),
    longitude: requireNumberInRange(location.longitude, 'msg.location.longitude', -180, 180),
  };
  const name = optionalText(location.name, 'msg.location.name', 200);
  const address = optionalText(location.address, 'msg.location.address', 500);
  if (name !== undefined) content.name = name;
  if (address !== undefined) content.address = address;
  if (!isBlank(location.url)) content.url = requireHttpUrl(location.url, 'msg.location.url');
  return content;
}

/** Turns a message and the node's properties into one API call, or throws a ValidationError. */
export function prepareSend(msg: Msg, defaults: SendDefaults): PreparedSend {
  const ref = !isBlank(msg.number)
    ? numberRef(msg.number, 'msg.number')
    : numberRef(isBlank(defaults.number) ? 'main' : defaults.number, "node property 'Number'");

  const hasMedia = !isBlank(msg.media);
  const hasLocation = !isBlank(msg.location);
  if (hasMedia && hasLocation) {
    throw new ValidationError('msg.media', 'and msg.location are both set. A message carries one kind of content.');
  }
  let content: Record<string, unknown>;
  if (hasMedia) content = mediaContent(msg.media, msg.payload);
  else if (hasLocation) content = locationContent(msg.location);
  else content = { text: requireText(msg.payload, 'msg.payload', MAX_TEXT) };

  const headers: Record<string, string> = {};
  const key = idempotencyKey(msg.idempotencyKey, 'msg.idempotencyKey');
  if (key !== undefined) headers['Idempotency-Key'] = key;

  const base = `/numbers/${encodeURIComponent(ref)}/messages`;
  if (!isBlank(msg.replyTo)) {
    // A reply goes to the chat of the quoted message, so no recipient is needed.
    const quoted = messageId(msg.replyTo, 'msg.replyTo');
    return { path: `${base}/${quoted}/reply`, body: { content }, headers, number: ref };
  }

  const to = !isBlank(msg.to)
    ? recipient(msg.to, 'msg.to')
    : recipient(defaults.to ?? '', "node property 'To'");
  return { path: base, body: { to, content }, headers, number: ref };
}

/** The path of a status read, or a ValidationError. */
export function prepareStatus(
  msg: Msg,
  defaults: { number?: string },
): { path: string; number: string; id: string } {
  const ref = !isBlank(msg.number)
    ? numberRef(msg.number, 'msg.number')
    : numberRef(isBlank(defaults.number) ? 'main' : defaults.number, "node property 'Number'");

  let source: unknown = msg.messageId;
  let where = 'msg.messageId';
  if (isBlank(source)) {
    const payload = msg.payload;
    if (typeof payload === 'string' && !isBlank(payload)) {
      source = payload;
      where = 'msg.payload';
    } else if (payload !== null && typeof payload === 'object') {
      source = (payload as Record<string, unknown>).message_id;
      where = 'msg.payload.message_id';
    }
  }
  if (isBlank(source)) {
    throw new ValidationError('msg.messageId', 'is not set. Wire this node after a whatsapp send node, or set msg.messageId to a msg_ id.');
  }
  const id = messageId(source, where);
  return { path: `/numbers/${encodeURIComponent(ref)}/messages/${id}/status`, number: ref, id };
}
