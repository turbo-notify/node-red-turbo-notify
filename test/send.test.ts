import helper from 'node-red-node-test-helper';
import { ApiError, ValidationError } from '../src/lib/errors';
import {
  ALL_NODES,
  KEY,
  credentials,
  flowWithSend,
  mockFetch,
  runThrough,
} from './support';

const ID = 'msg_0198d3c5a1b24d3e9f01a2b3c4d5e6f7';
const ACCEPTED = { message_id: ID, status: 'pending' };

beforeAll(() => helper.startServer());
afterAll(() => helper.stopServer());

let fake: ReturnType<typeof mockFetch>;
afterEach(async () => {
  fake?.restore();
  await helper.unload();
});

async function send(
  msg: Record<string, unknown>,
  props: Record<string, unknown> = {},
  reply: Parameters<typeof mockFetch>[0] = { body: ACCEPTED },
) {
  fake = mockFetch(reply);
  await helper.load(ALL_NODES, flowWithSend(props), credentials);
  const result = await runThrough('n1', msg);
  return { ...result, calls: fake.calls };
}

describe('Send: one request shape per kind of content', () => {
  it('text: POST /v1/numbers/main/messages with the bearer key and the to/content body', async () => {
    const { calls, out } = await send({ payload: 'Door opened', to: '+12025550123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.turbonotify.com/v1/numbers/main/messages');
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].headers['User-Agent']).toMatch(/^turbo-notify-node-red\/\d+\.\d+\.\d+$/);
    expect(calls[0].headers['Idempotency-Key']).toBeUndefined();
    expect(calls[0].body).toEqual({
      to: { number: '+12025550123' },
      content: { text: 'Door opened' },
    });
    expect(out?.payload).toEqual(ACCEPTED);
    expect(out?.messageId).toBe(ID);
  });

  it('uses the To and Number properties of the node when the message has none, and msg overrides them', async () => {
    const a = await send({ payload: 'hi' }, { to: '+12025550123', number: 'sales' });
    expect(a.calls[0].url).toBe('https://api.turbonotify.com/v1/numbers/sales/messages');
    expect(a.calls[0].body).toEqual({ to: { number: '+12025550123' }, content: { text: 'hi' } });
    fake.restore();
    await helper.unload();
    const b = await send(
      { payload: 'hi', to: 'ct_0198d3c5a1b24d3e9f01a2b3c4d5e6f7', number: 'num_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' },
      { to: '+12025550123', number: 'sales' },
    );
    expect(b.calls[0].url).toBe(
      'https://api.turbonotify.com/v1/numbers/num_0198d3c5a1b24d3e9f01a2b3c4d5e6f7/messages',
    );
    expect(b.calls[0].body).toEqual({
      to: { contact_id: 'ct_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' },
      content: { text: 'hi' },
    });
  });

  it('a group id and a numeric payload', async () => {
    const { calls } = await send({ payload: 23.5, to: 'grp_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' });
    expect(calls[0].body).toEqual({
      to: { group_id: 'grp_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' },
      content: { text: '23.5' },
    });
  });

  it('media: the type picks the url field; a text payload becomes the caption', async () => {
    const { calls } = await send({
      payload: 'Front door',
      to: '+12025550123',
      media: { type: 'image', url: 'https://example.com/cam.jpg' },
    });
    expect(calls[0].url).toBe('https://api.turbonotify.com/v1/numbers/main/messages');
    expect(calls[0].body).toEqual({
      to: { number: '+12025550123' },
      content: { image_url: 'https://example.com/cam.jpg', caption: 'Front door' },
    });
  });

  it('media: document with a file name and its own caption', async () => {
    const { calls } = await send({
      payload: 'ignored text',
      to: '+12025550123',
      media: { type: 'document', url: 'http://example.com/r.pdf', caption: 'Report', filename: 'report.pdf' },
    });
    expect(calls[0].body).toEqual({
      to: { number: '+12025550123' },
      content: { document_url: 'http://example.com/r.pdf', caption: 'Report', filename: 'report.pdf' },
    });
  });

  it('location', async () => {
    const { calls } = await send({
      to: '+12025550123',
      location: { latitude: 40.7128, longitude: -74.006, name: 'Office', address: '1 Main St' },
    });
    expect(calls[0].body).toEqual({
      to: { number: '+12025550123' },
      content: { latitude: 40.7128, longitude: -74.006, name: 'Office', address: '1 Main St' },
    });
  });

  it('reply: POST .../messages/{id}/reply with only the content', async () => {
    const { calls } = await send({ payload: 'Thanks', replyTo: ID, number: 'sales' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`https://api.turbonotify.com/v1/numbers/sales/messages/${ID}/reply`);
    expect(calls[0].body).toEqual({ content: { text: 'Thanks' } });
  });

  it('idempotency: the key goes in the Idempotency-Key header, not in the body', async () => {
    const { calls } = await send({ payload: 'hi', to: '+12025550123', idempotencyKey: 'order-4711' });
    expect(calls[0].headers['Idempotency-Key']).toBe('order-4711');
    expect(JSON.stringify(calls[0].body)).not.toContain('order-4711');
  });
});

describe('Send: validation fails before any request and names the property', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['bad phone', { payload: 'x', to: '12025550123' }, 'msg.to'],
    ['phone with letters', { payload: 'x', to: '+1202abc' }, 'msg.to'],
    ['two recipients (object)', { payload: 'x', to: { number: '+12025550123', group_id: 'grp_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' } }, 'msg.to'],
    ['two recipients (list)', { payload: 'x', to: ['+12025550123', '+12025550124'] }, 'msg.to'],
    ['media url not http', { to: '+12025550123', media: { type: 'image', url: 'ftp://example.com/a.jpg' } }, 'msg.media.url'],
    ['media url not a url', { to: '+12025550123', media: { type: 'image', url: 'cam.jpg' } }, 'msg.media.url'],
    ['media type unknown', { to: '+12025550123', media: { type: 'gif', url: 'https://example.com/a.gif' } }, 'msg.media.type'],
    ['text over 4096', { payload: 'a'.repeat(4097), to: '+12025550123' }, 'msg.payload'],
    ['no text at all', { to: '+12025550123' }, 'msg.payload'],
    ['object payload', { payload: { a: 1 }, to: '+12025550123' }, 'msg.payload'],
    ['reply id with wrong prefix', { payload: 'x', replyTo: 'ct_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' }, 'msg.replyTo'],
    ['reply id is an event id', { payload: 'x', replyTo: 'evt_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' }, 'msg.replyTo'],
    ['contact id with wrong length', { payload: 'x', to: 'ct_123' }, 'msg.to'],
    ['group id with wrong prefix', { payload: 'x', to: { group_id: 'ct_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' } }, 'msg.to.group_id'],
    ['media and location together', { to: '+12025550123', media: { type: 'image', url: 'https://example.com/a.jpg' }, location: { latitude: 1, longitude: 1 } }, 'msg.media'],
    ['latitude out of range', { to: '+12025550123', location: { latitude: 91, longitude: 0 } }, 'msg.location.latitude'],
    ['idempotency key too long', { payload: 'x', to: '+12025550123', idempotencyKey: 'k'.repeat(256) }, 'msg.idempotencyKey'],
    ['no recipient anywhere', { payload: 'x' }, "node property 'To'"],
  ];

  it.each(cases)('%s', async (_name, msg, property) => {
    const { calls, error } = await send(msg);
    expect(calls).toHaveLength(0);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).property).toBe(property);
    expect(error?.message).toContain(property);
  });

  it('accepts exactly 4096 characters and an idempotency key of 255', async () => {
    const { calls } = await send({
      payload: 'a'.repeat(4096),
      to: '+12025550123',
      idempotencyKey: 'k'.repeat(255),
    });
    expect(calls).toHaveLength(1);
  });

  it('formats a phone typed with spaces and punctuation', async () => {
    const { calls } = await send({ payload: 'x', to: '+1 (202) 555-0123' });
    expect(calls[0].body).toMatchObject({ to: { number: '+12025550123' } });
  });
});

describe('Send: errors from the API', () => {
  it('reports the API error code as the message and the description in cause', async () => {
    const { error, calls } = await send(
      { payload: 'x', to: '+12025550123' },
      {},
      { status: 403, body: { error: 'insufficient_scope', required_scope: 'messages:send' } },
    );
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(ApiError);
    expect(String(error)).toBe('insufficient_scope');
    expect(error?.message).toBe('insufficient_scope');
    const cause = (error as ApiError).cause;
    expect(cause.status).toBe(403);
    expect(cause.requiredScope).toBe('messages:send');
    expect(cause.description).toContain("'messages:send'");
  });

  it('a 429 carries the Retry-After hint', async () => {
    const { error } = await send(
      { payload: 'x', to: '+12025550123' },
      {},
      { status: 429, body: { error: 'send_rate_spacing' }, headers: { 'Retry-After': '7' } },
    );
    expect((error as ApiError).cause.retryAfter).toBe(7);
    expect((error as ApiError).cause.description).toContain('Retry after 7 seconds');
  });

  it('a network failure is reported as unreachable', async () => {
    const { error } = await send(
      { payload: 'x', to: '+12025550123' },
      {},
      { reject: new TypeError('fetch failed') },
    );
    expect(String(error)).toBe('unreachable');
  });

  it('shows the error code on the node status', async () => {
    const { error } = await send(
      { payload: 'x', to: '+12025550123' },
      {},
      { status: 500, body: { error: 'internal_error' } },
    );
    expect(String(error)).toBe('internal_error');
    const status = helper.getNode('n1').status.lastCall?.args[0] as { fill: string; shape: string; text: string };
    expect(status).toEqual({ fill: 'red', shape: 'ring', text: 'internal_error' });
  });
});
