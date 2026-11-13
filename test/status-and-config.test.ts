import helper from 'node-red-node-test-helper';
import { ALL_NODES, KEY, mockFetch, runThrough } from './support';

const ID = 'msg_0198d3c5a1b24d3e9f01a2b3c4d5e6f7';

beforeAll(() => helper.startServer());
afterAll(() => helper.stopServer());

let fake: ReturnType<typeof mockFetch>;
afterEach(async () => {
  fake?.restore();
  helper.settings({});
  await helper.unload();
});

const flow = (props: Record<string, unknown> = {}) => [
  { id: 'cfg', type: 'turbo-notify-config' },
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

type TestBody = { ok: boolean; state: string; description: string; code?: string };

/** The API as the Test button sees it: usage, then the main number. */
const api = (options: { usage?: { status: number; body: unknown }; number?: { status: number; body: unknown } } = {}) =>
  (call: { url: string }) => {
    const usage = options.usage ?? { status: 200, body: { plan: 'solo' } };
    const number = options.number ?? { status: 200, body: { status: 'connected' } };
    return call.url.endsWith('/v1/usage') ? usage : number;
  };

describe('Config node Test button', () => {
  const post = (body: Record<string, unknown>) =>
    helper.request().post('/turbo-notify/test').send(body);
  const answerOf = async (body: Record<string, unknown>) => (await post(body)).body as TestBody;

  it('reads GET /v1/usage and then the main number with the stored key, and says everything is ready', async () => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY } });
    const answer = await answerOf({ id: 'cfg', apiKey: '__PWRD__' });
    expect(answer).toEqual({
      ok: true,
      state: 'ready',
      description: 'Connected. The key works and your WhatsApp number is linked.',
    });
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.turbonotify.com/v1/usage',
      'GET https://api.turbonotify.com/v1/numbers/main',
    ]);
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(fake.calls[0].headers['User-Agent']).toMatch(/^turbo-notify-node-red\//);
  });

  it('uses the key typed in the editor for a node that is not deployed yet', async () => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, flow(), {});
    await post({ id: 'new-node', apiKey: 'tn_live_typed_key' });
    expect(fake.calls[0].headers.Authorization).toBe('Bearer tn_live_typed_key');
  });

  it('always talks to the fixed address, whatever the request or a saved flow names', async () => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, [{ id: 'cfg', type: 'turbo-notify-config', baseUrl: 'https://attacker.example' }], {
      cfg: { apiKey: KEY },
    });
    await post({ id: 'cfg', apiKey: '__PWRD__', baseUrl: 'https://attacker.example' });
    await post({ id: 'new-node', apiKey: 'tn_live_typed_key', baseUrl: 'https://attacker.example' });
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fake.calls) expect(call.url.startsWith('https://api.turbonotify.com/v1/')).toBe(true);
    expect(JSON.stringify(fake.calls)).not.toContain('attacker.example');
  });

  it('refuses to use a stored key for a node that is not a deployed config node', async () => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, flow(), { cfg: { apiKey: KEY }, s1: { apiKey: KEY } });
    for (const id of ['s1', 'missing-node', '']) {
      const answer = await answerOf({ id, apiKey: '__PWRD__' });
      expect(answer.ok).toBe(false);
    }
    expect(fake.calls).toHaveLength(0);
  });

  describe('the address can only be changed in settings.js', () => {
    it('accepts https and this computer, and strips a trailing /v1', async () => {
      fake = mockFetch(api());
      helper.settings({ turboNotifyBaseUrl: 'http://127.0.0.1:8080/v1/' });
      await helper.load(ALL_NODES, flow(), {});
      const answer = await answerOf({ id: 'new-node', apiKey: 'tn_live_typed_key' });
      expect(answer.ok).toBe(true);
      expect(fake.calls[0].url).toBe('http://127.0.0.1:8080/v1/usage');
    });

    it('refuses an address that is neither https nor this computer, and names the setting', async () => {
      fake = mockFetch(api());
      helper.settings({ turboNotifyBaseUrl: 'http://api.example.test' });
      await helper.load(ALL_NODES, flow(), {});
      const answer = await answerOf({ id: 'new-node', apiKey: 'tn_live_typed_key' });
      expect(answer.ok).toBe(false);
      expect(answer.description).toContain('turboNotifyBaseUrl');
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('says in plain words what the person has to do next', () => {
    const states: Array<[string, Record<string, unknown>, Parameters<typeof api>[0], Partial<TestBody>, RegExp]> = [
      ['no key', { id: 'new-node', apiKey: '' }, {}, { ok: false, state: 'no_key' }, /Paste your API key first.*API keys/],
      ['a text that is not a key', { id: 'new-node', apiKey: 'abc123' }, {}, { ok: false, state: 'bad_format' }, /Keys start with tn_live_/],
      [
        'a refused key',
        { id: 'new-node', apiKey: 'tn_live_revoked' },
        { usage: { status: 401, body: { error: 'not_authenticated' } } },
        { ok: false, state: 'refused', code: 'not_authenticated' },
        /not accepted.*new one/,
      ],
      [
        'a number that is not connected',
        { id: 'new-node', apiKey: 'tn_live_ok' },
        { number: { status: 200, body: { status: 'pending' } } },
        { ok: true, state: 'no_number' },
        /not connected yet \(status: pending\).*Numbers/,
      ],
      [
        'no number at all',
        { id: 'new-node', apiKey: 'tn_live_ok' },
        { number: { status: 404, body: { error: 'number_not_found' } } },
        { ok: true, state: 'no_number' },
        /no WhatsApp number is linked yet.*Numbers/,
      ],
      [
        'a key that cannot read numbers',
        { id: 'new-node', apiKey: 'tn_live_ok' },
        { number: { status: 403, body: { error: 'insufficient_scope' } } },
        { ok: true, state: 'unchecked' },
        /could not check your WhatsApp number/,
      ],
    ];
    it.each(states)('%s', async (_name, body, replies, expected, text) => {
      fake = mockFetch(api(replies));
      await helper.load(ALL_NODES, flow(), {});
      const answer = await answerOf(body);
      expect(answer).toMatchObject(expected);
      expect(answer.description).toMatch(text);
      // The link to the dashboard is a button in the editor, so the text never carries the address.
      expect(answer.description).not.toContain('dashboard.turbonotify.com');
    });

    it('makes no request for an empty key or a text that is not a key', async () => {
      fake = mockFetch(api());
      await helper.load(ALL_NODES, flow(), {});
      await post({ id: 'new-node', apiKey: '' });
      await post({ id: 'new-node', apiKey: 'abc123' });
      expect(fake.calls).toHaveLength(0);
    });

    it('says the network is the problem when Turbo Notify cannot be reached', async () => {
      fake = mockFetch({ reject: new Error('offline') });
      await helper.load(ALL_NODES, flow(), {});
      const answer = await answerOf({ id: 'new-node', apiKey: 'tn_live_ok' });
      expect(answer).toMatchObject({ ok: false, state: 'refused', code: 'unreachable' });
      expect(answer.description).toContain('network');
    });
  });
});

describe('Nodes without a usable config node', () => {
  it('a send node with no key reports it and sends nothing', async () => {
    fake = mockFetch({ body: {} });
    await helper.load(
      ALL_NODES,
      [
        { id: 'cfg', type: 'turbo-notify-config' },
        { id: 'n1', type: 'turbo-notify-send', server: 'cfg', wires: [['out']] },
        { id: 'out', type: 'helper' },
      ],
      {},
    );
    const { error } = await runThrough('n1', { payload: 'x', to: '+12025550123' });
    expect(error?.message).toContain('API key');
    expect(error?.message).toContain('account node');
    expect(fake.calls).toHaveLength(0);
  });

  it('an address saved in a flow made with an older version is ignored, not obeyed', async () => {
    fake = mockFetch({ body: { message_id: ID, status: 'pending' } });
    await helper.load(
      ALL_NODES,
      [
        { id: 'cfg', type: 'turbo-notify-config', baseUrl: 'https://attacker.example' },
        { id: 'n1', type: 'turbo-notify-send', server: 'cfg', wires: [['out']] },
        { id: 'out', type: 'helper' },
      ],
      { cfg: { apiKey: KEY } },
    );
    await runThrough('n1', { payload: 'x', to: '+12025550123' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe('https://api.turbonotify.com/v1/numbers/main/messages');
    expect(JSON.stringify(fake.calls)).not.toContain('attacker.example');
  });

  it('a settings.js address that is not a web address is refused, and the message names the setting', async () => {
    fake = mockFetch({ body: {} });
    helper.settings({ turboNotifyBaseUrl: 'ftp://nope' });
    await helper.load(
      ALL_NODES,
      [
        { id: 'cfg', type: 'turbo-notify-config' },
        { id: 'n1', type: 'turbo-notify-send', server: 'cfg', wires: [['out']] },
        { id: 'out', type: 'helper' },
      ],
      { cfg: { apiKey: KEY } },
    );
    const { error } = await runThrough('n1', { payload: 'x', to: '+12025550123' });
    expect(error?.message).toContain('turboNotifyBaseUrl');
    expect(fake.calls).toHaveLength(0);
  });
});

describe('A node says at deploy time that the key is still missing', () => {
  const statusOf = (id: string) =>
    helper.getNode(id).status.lastCall?.args[0] as { fill: string; shape: string; text: string } | undefined;
  const nodes = [
    ['whatsapp send', 'turbo-notify-send'],
    ['whatsapp status', 'turbo-notify-status'],
    ['whatsapp events', 'turbo-notify-events'],
  ] as const;

  it.each(nodes)('%s shows a yellow ring that asks for the key, before any message', async (_label, type) => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, [{ id: 'cfg', type: 'turbo-notify-config' }, { id: 'n1', type, server: 'cfg', wires: [[]] }], {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(statusOf('n1')).toEqual({ fill: 'yellow', shape: 'ring', text: 'paste your API key' });
    expect(fake.calls).toHaveLength(0); // the events node does not poll without a key
  });

  it.each(nodes)('%s shows no warning when the key is set', async (_label, type) => {
    fake = mockFetch(api());
    await helper.load(ALL_NODES, [{ id: 'cfg', type: 'turbo-notify-config' }, { id: 'n1', type, server: 'cfg', wires: [[]] }], {
      cfg: { apiKey: KEY },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(statusOf('n1')?.fill).not.toBe('yellow');
  });
});
