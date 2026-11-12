import helper from 'node-red-node-test-helper';
import { ALL_NODES, KEY, mockFetch, runThrough } from './support';

const ID = 'msg_0198d3c5a1b24d3e9f01a2b3c4d5e6f7';

beforeAll(() => helper.startServer());
afterAll(() => helper.stopServer());

let fake: ReturnType<typeof mockFetch>;
afterEach(async () => {
  fake?.restore();
  await helper.unload();
});

const flow = (props: Record<string, unknown> = {}) => [
  { id: 'cfg', type: 'turbo-notify-config', baseUrl: 'https://api.turbonotify.com' },
  { id: 's1', type: 'turbo-notify-status', server: 'cfg', number: 'main', wires: [['out']], ...props },
  { id: 'out', type: 'helper' },
];

describe('Status node', () => {
  it('GET /v1/numbers/main/messages/{id}/status with the bearer key', async () => {
    fake = mockFetch({ body: { message_id: ID, status: 'delivered' } });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const { out } = await runThrough('s1', { messageId: ID });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe('GET');
    expect(fake.calls[0].url).toBe(`https://api.turbonotify.com/v1/numbers/main/messages/${ID}/status`);
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(fake.calls[0].body).toBeUndefined();
    expect(out?.payload).toEqual({ message_id: ID, status: 'delivered' });
  });

  it('reads the id from a text payload or from payload.message_id, and the number from msg.number', async () => {
    fake = mockFetch({ body: { status: 'sent' } });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    await runThrough('s1', { payload: ID, number: 'sales' });
    await runThrough('s1', { payload: { message_id: ID } });
    expect(fake.calls[0].url).toBe(`https://api.turbonotify.com/v1/numbers/sales/messages/${ID}/status`);
    expect(fake.calls[1].url).toBe(`https://api.turbonotify.com/v1/numbers/main/messages/${ID}/status`);
  });

  it('refuses an id with the wrong prefix and a missing id before any request', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const wrong = await runThrough('s1', { messageId: 'ct_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' });
    expect(wrong.error?.message).toContain('msg.messageId');
    const missing = await runThrough('s1', { payload: 5 });
    expect(missing.error?.message).toContain('msg.messageId');
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a 404 with its error code', async () => {
    fake = mockFetch({ status: 404, body: { error: 'not_found' } });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const { error } = await runThrough('s1', { messageId: ID });
    expect(String(error)).toBe('not_found');
  });
});

describe('Config node Test button', () => {
  const post = (body: Record<string, unknown>) =>
    helper.request().post('/turbo-notify/test').send(body);

  it('calls GET /v1/usage with the stored key of the node', async () => {
    fake = mockFetch({ body: { messages: { used: 1 } } });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const answer = await post({ id: 'cfg', apiKey: '__PWRD__', baseUrl: 'https://api.turbonotify.com' });
    expect(answer.body).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe('GET');
    expect(fake.calls[0].url).toBe('https://api.turbonotify.com/v1/usage');
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(fake.calls[0].headers['User-Agent']).toMatch(/^turbo-notify-node-red\//);
  });

  it('uses the key typed in the editor for a node that is not deployed yet', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), {});
    await post({ id: 'new-node', apiKey: 'typed_key_abc', baseUrl: 'https://example.test/v1/' });
    expect(fake.calls[0].url).toBe('https://example.test/v1/usage');
    expect(fake.calls[0].headers.Authorization).toBe('Bearer typed_key_abc');
  });

  it('sends the stored key only to the address deployed with it, never to one named in the request', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    await post({ id: 'cfg', apiKey: '__PWRD__', baseUrl: 'https://attacker.example' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe('https://api.turbonotify.com/v1/usage');
    expect(JSON.stringify(fake.calls)).not.toContain('attacker.example');
  });

  it('refuses to use a stored key for a node that is not a deployed config node', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY }, s1: { apiKey: KEY } });
    for (const id of ['s1', 'missing-node', '']) {
      const answer = await post({ id, apiKey: '__PWRD__', baseUrl: 'https://attacker.example' });
      expect((answer.body as { ok: boolean }).ok).toBe(false);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it('accepts only https addresses, except for this computer (localhost, 127.0.0.1, ::1)', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), {});
    const refused = await post({ id: 'new-node', apiKey: 'typed_key_abc', baseUrl: 'http://api.example.test' });
    expect((refused.body as { ok: boolean }).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
    const local = await post({ id: 'new-node', apiKey: 'typed_key_abc', baseUrl: 'http://127.0.0.1:8080' });
    expect((local.body as { ok: boolean }).ok).toBe(true);
    expect(fake.calls[0].url).toBe('http://127.0.0.1:8080/v1/usage');
  });

  it('answers with the API error code and its description when the key is refused', async () => {
    fake = mockFetch({ status: 401, body: { error: 'not_authenticated' } });
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const answer = await post({ id: 'cfg', apiKey: '__PWRD__' });
    const body = answer.body as { ok: boolean; code: string; description: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('not_authenticated');
    expect(body.description).toContain('API key');
  });

  it('refuses without a key and without a request', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(ALL_NODES, flow(), {});
    const answer = await post({ id: 'cfg', apiKey: '' });
    expect((answer.body as { ok: boolean }).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('Nodes without a usable config node', () => {
  it('a send node with no key reports it and sends nothing', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(
      ALL_NODES,
      [
        { id: 'cfg', type: 'turbo-notify-config', baseUrl: 'https://api.turbonotify.com' },
        { id: 'n1', type: 'turbo-notify-send', server: 'cfg', wires: [['out']] },
        { id: 'out', type: 'helper' },
      ],
      {},
    );
    const { error } = await runThrough('n1', { payload: 'x', to: '+12025550123' });
    expect(error?.message).toContain('API key');
    expect(fake.calls).toHaveLength(0);
  });

  it('a base URL that is not a web address is refused', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(
      ALL_NODES,
      [
        { id: 'cfg', type: 'turbo-notify-config', baseUrl: 'ftp://nope' },
        { id: 'n1', type: 'turbo-notify-send', server: 'cfg', wires: [['out']] },
        { id: 'out', type: 'helper' },
      ],
      { cfg: { apiKey: KEY } },
    );
    const { error } = await runThrough('n1', { payload: 'x', to: '+12025550123' });
    expect(error?.message).toContain('Base URL');
    expect(fake.calls).toHaveLength(0);
  });
});
