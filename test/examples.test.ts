import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import helper from 'node-red-node-test-helper';
import { ALL_NODES, type Call, type FakeReply, KEY, mockFetch } from './support';

/**
 * Runs the example flows in a real Node-RED test runtime, with the real core nodes (function, switch,
 * change, template, catch, delay) and the real Turbo Notify nodes. Only the edges are replaced:
 * the events and http in nodes (the test hands the message to the node after them), the http response node
 * (the test reads the status and body it would send), the http request to another service, the file node
 * and the 30 second wait. The Turbo Notify API is a mocked fetch.
 */

const ROOT = join(__dirname, '..');
const CORE_DIR = join(ROOT, 'node_modules/@node-red/nodes/core');
const CORE = [
  'common/20-inject.js',
  'common/21-debug.js',
  'common/25-catch.js',
  'common/90-comment.js',
  'function/10-function.js',
  'function/10-switch.js',
  'function/15-change.js',
  'function/80-template.js',
  'function/89-delay.js',
].map((file) => createRequire(__filename)(join(CORE_DIR, file)) as unknown);

const CFG = 'tn0cfg0000000001';
const ID = 'msg_0198d3c5a1b24d3e9f01a2b3c4d5e6f7';
const PHONE = '+12025550123';
const GROUP = 'grp_0198d3c5a1b24d3e9f01a2b3c4d5e6f7';

type FlowNode = Record<string, unknown> & { id: string; type: string; name?: string; wires?: string[][] };

const load = (file: string): FlowNode[] => JSON.parse(readFileSync(join(ROOT, 'examples', file), 'utf8')) as FlowNode[];

interface Edges {
  /** Code that replaces the http request node (it runs as a function node). */
  httpStub?: string;
  /** The 30 second wait is replaced by a pass-through. */
  skipDelay?: boolean;
  /** API answers. A function gets the call. */
  reply?: FakeReply | ((call: Call) => FakeReply);
}

interface Running {
  calls: Call[];
  flow: FlowNode[];
  byName: (name: string) => FlowNode;
  fireInject: (name?: string) => void;
  /** Hands an event (or a request body, with extra message properties) to the node that follows the entry node. */
  deliver: (event: unknown, extra?: Record<string, unknown>) => void;
  captured: unknown[];
  /** What the http response node would have sent. */
  responses: Array<{ status: unknown; body: unknown }>;
}

let fake: ReturnType<typeof mockFetch> | undefined;
afterEach(async () => {
  fake?.restore();
  fake = undefined;
  await helper.unload();
});
beforeAll(() => helper.startServer());
afterAll(() => helper.stopServer());

const accepted = (call: Call): FakeReply =>
  call.method === 'POST' ? { body: { message_id: ID, status: 'pending' } } : { body: { message_id: ID, status: 'delivered' } };

async function start(file: string, edges: Edges = {}): Promise<Running> {
  const original = load(file);
  const entryTargets: string[] = [];
  const flow: FlowNode[] = [];
  const captured: unknown[] = [];
  const responses: Array<{ status: unknown; body: unknown }> = [];
  const responseIds = new Set<string>();
  for (const node of original) {
    if (node.type === 'turbo-notify-events' || node.type === 'http in') {
      entryTargets.push(...(node.wires?.[0] ?? []));
      continue;
    }
    if (node.type === 'http request') {
      flow.push({ ...node, type: 'function', func: edges.httpStub ?? 'return msg;', outputs: 1, noerr: 0, timeout: 0, initialize: '', finalize: '', libs: [] });
      continue;
    }
    if (node.type === 'file') {
      flow.push({ id: node.id, type: 'helper', z: node.z });
      continue;
    }
    if (node.type === 'http response') {
      responseIds.add(node.id);
      flow.push({ id: node.id, type: 'helper', z: node.z });
      continue;
    }
    if (node.type === 'delay' && edges.skipDelay && node.pauseType === 'delay') {
      flow.push({ ...node, type: 'function', func: 'return msg;', outputs: 1, noerr: 0, timeout: 0, initialize: '', finalize: '', libs: [] });
      continue;
    }
    flow.push(node);
  }
  fake = mockFetch(edges.reply ?? accepted);
  await helper.load([...CORE, ...ALL_NODES], flow, { [CFG]: { apiKey: KEY } });
  for (const node of flow.filter((n) => n.type === 'helper')) {
    helper.getNode(node.id).on('input', (m) => {
      const msg = m as { payload: unknown; statusCode?: unknown };
      if (responseIds.has(node.id)) responses.push({ status: msg.statusCode, body: msg.payload });
      else captured.push(msg.payload);
    });
  }
  const byName = (name: string) => {
    const node = flow.find((n) => n.name === name);
    if (!node) throw new Error(`no node named ${name}`);
    return node;
  };
  return {
    calls: fake.calls,
    flow,
    byName,
    captured,
    responses,
    fireInject: (name) => {
      const injects = flow.filter((n) => n.type === 'inject');
      const target = name ? byName(name) : injects[0];
      helper.getNode(target.id).receive({});
    },
    deliver: (event, extra = {}) => {
      for (const id of entryTargets) helper.getNode(id).receive({ payload: event, ...extra });
    },
  };
}

/** Waits until the condition holds (the nodes work asynchronously). */
async function until(condition: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const body = (call: Call) => call.body as { to?: Record<string, string>; content: Record<string, unknown> };
const textOf = (call: Call) => String(body(call).content.text);

const incoming = (preview: string, extra: Record<string, unknown> = {}, at = '2026-06-08T10:00:00') => ({
  id: 'evt_2b09b39a44ffc0d3039251f995e4c284',
  type: 'message.received',
  number_alias: 'main',
  created_at: at,
  data: {
    id: 'msg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    from: { name: 'Ana Silva', number: '12025550142' },
    to: { name: 'Turbo Notify', alias: 'main', number: '12025550100' },
    preview,
    content_type: 'text',
    direction: 'inbound',
    ...extra,
  },
});
const groupMessage = () =>
  incoming('hello team', { to: { name: 'Team', group_id: GROUP } });

describe('example flows run on the real nodes', () => {
  it('scheduled-reminder: the inject sends the reminder text to the configured number', async () => {
    const run = await start('scheduled-reminder.json');
    expect(run.byName('Weekdays at 09:00').crontab).toBe('00 09 * * 1-5');
    run.fireInject();
    await until(() => run.calls.length === 1, 'one send');
    expect(run.calls[0].url).toBe('https://api.turbonotify.com/v1/numbers/main/messages');
    expect(body(run.calls[0])).toEqual({
      to: { number: PHONE },
      content: { text: 'Good morning. The team meeting starts at 09:30.' },
    });
  });

  describe('http-endpoint-to-whatsapp', () => {
    /** Sends one request through the flow and waits for its answer. */
    const post = async (run: Running, payload: unknown, token: string | undefined = 'change-me') => {
      const before = run.responses.length;
      run.deliver(payload, { req: { headers: token ? { 'x-token': token } : {} } });
      await until(() => run.responses.length === before + 1, 'an http answer');
      return run.responses[before] as { status: number; body: Record<string, unknown> };
    };

    it('answers 202 with the message id and sends the text', async () => {
      const run = await start('http-endpoint-to-whatsapp.json');
      const res = await post(run, { to: PHONE, message: 'Backup finished' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message_id: ID, status: 'pending' });
      expect(run.calls).toHaveLength(1);
      expect(body(run.calls[0])).toEqual({ to: { number: PHONE }, content: { text: 'Backup finished' } });
    });

    it('answers 401 without the token and 400 for a bad body, and sends nothing', async () => {
      const run = await start('http-endpoint-to-whatsapp.json');
      expect((await post(run, { to: PHONE, message: 'x' }, '')).status).toBe(401);
      expect((await post(run, { to: PHONE, message: 'x' }, 'wrong')).status).toBe(401);
      const bad = await post(run, { message: 'no recipient' });
      expect(bad.status).toBe(400);
      expect(String(bad.body.error)).toContain('"to"');
      expect(run.calls).toHaveLength(0);
    });

    it('answers 502 with the API error code when Turbo Notify refuses the message', async () => {
      const run = await start('http-endpoint-to-whatsapp.json', {
        reply: { status: 403, body: { error: 'insufficient_scope' } },
      });
      const res = await post(run, { to: PHONE, message: 'x' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('insufficient_scope');
    });
  });

  it('order-confirmation: writes the confirmation from the order and answers 201', async () => {
    const run = await start('order-confirmation.json');
    const order = {
      id: 'A-1001',
      customer: { name: "Ana O'Neil", phone: PHONE },
      items: [{ qty: 2, name: 'Coffee beans' }, { qty: 1, name: 'Filter & paper' }],
      total: '31.80',
      currency: 'USD',
    };
    run.deliver(order, { req: { headers: { 'x-token': 'change-me' } } });
    await until(() => run.responses.length === 1, 'the answer');
    expect(run.responses[0]).toEqual({ status: 201, body: { message_id: ID } });
    expect(body(run.calls[0]).to).toEqual({ number: PHONE });
    expect(textOf(run.calls[0])).toBe(
      "Hi Ana O'Neil, we received your order A-1001:\n- 2 x Coffee beans\n- 1 x Filter & paper\nTotal: 31.80 USD\nThank you!",
    );
    run.deliver({ id: 'x' }, { req: { headers: { 'x-token': 'change-me' } } });
    await until(() => run.responses.length === 2, 'the 400');
    expect(run.responses[1].status).toBe(400);
    expect(run.calls).toHaveLength(1);
  });

  describe('menu-by-keyword', () => {
    it.each([
      ['1', 'We are open Monday to Friday'],
      ['What are your HOURS?', 'We are open Monday to Friday'],
      ['2', 'You find us at 10 Example Street'],
      ['3', 'A person from the team will write to you'],
      ['hello', 'Reply 1 for opening hours'],
    ])('"%s" gets the matching answer, sent to the sender', async (text, expected) => {
      const run = await start('menu-by-keyword.json');
      run.deliver(incoming(text));
      await until(() => run.calls.length === 1, 'one answer');
      expect(textOf(run.calls[0])).toContain(expected);
      expect(body(run.calls[0]).to).toEqual({ number: '+12025550142' });
    });

    it('ignores groups and messages that are not text', async () => {
      const run = await start('menu-by-keyword.json');
      run.deliver(groupMessage());
      run.deliver(incoming('', { content_type: 'image' }));
      await settle();
      expect(run.calls).toHaveLength(0);
    });
  });

  describe('after-hours-auto-reply', () => {
    it('answers on a Saturday, not on a Monday at 10:00, and only once per person in 12 hours', async () => {
      const run = await start('after-hours-auto-reply.json');
      run.deliver(incoming('are you there?', {}, '2026-06-08T10:00:00')); // Monday, open
      await settle();
      expect(run.calls).toHaveLength(0);
      run.deliver(incoming('are you there?', {}, '2026-06-06T10:00:00')); // Saturday
      await until(() => run.calls.length === 1, 'one reply');
      expect(textOf(run.calls[0])).toContain('We are closed now');
      expect(textOf(run.calls[0])).toContain('9:00 to 18:00');
      run.deliver(incoming('hello?', {}, '2026-06-06T11:00:00')); // same person, one hour later
      await settle();
      expect(run.calls).toHaveLength(1);
      run.deliver(incoming('hello again', {}, '2026-06-07T09:00:00')); // next day, Sunday
      await until(() => run.calls.length === 2, 'a second reply after the pause');
    });

    it('answers a weekday evening and skips groups', async () => {
      const run = await start('after-hours-auto-reply.json');
      run.deliver(groupMessage());
      await settle();
      expect(run.calls).toHaveLength(0);
      run.deliver(incoming('late question', {}, '2026-06-08T19:30:00'));
      await until(() => run.calls.length === 1, 'one reply');
    });
  });

  it('incoming-to-team-group: forwards a private message to the group, not group messages', async () => {
    const run = await start('incoming-to-team-group.json');
    run.deliver(incoming('Can you call me?'));
    await until(() => run.calls.length === 1, 'one forward');
    expect(body(run.calls[0]).to).toEqual({ group_id: GROUP });
    expect(textOf(run.calls[0])).toBe('New message from Ana Silva (+12025550142): Can you call me?');
    run.deliver(groupMessage());
    await settle();
    expect(run.calls).toHaveLength(1);
  });

  describe('website-down-alert', () => {
    it('sends one message when the site fails and one when it recovers, nothing in between', async () => {
      const run = await start('website-down-alert.json', {
        httpStub: "msg.statusCode = flow.get('code') ?? 200; return msg;",
      });
      const stub = () => helper.getNode(run.byName('check the site').id).context().flow;
      run.fireInject();
      await settle();
      expect(run.calls).toHaveLength(0); // healthy
      stub().set('code', 503);
      run.fireInject();
      await until(() => run.calls.length === 1, 'the down message');
      expect(textOf(run.calls[0])).toBe('your-site.example is DOWN (HTTP 503).');
      run.fireInject();
      await settle();
      expect(run.calls).toHaveLength(1); // still down: silent
      stub().set('code', 200);
      run.fireInject();
      await until(() => run.calls.length === 2, 'the recovery message');
      expect(textOf(run.calls[1])).toMatch(/^your-site\.example is back after \d+ minutes\.$/);
    });

    it('treats a connection error like a failure', async () => {
      const run = await start('website-down-alert.json', {
        httpStub: "throw new Error('connect ECONNREFUSED');",
      });
      run.fireInject();
      await until(() => run.calls.length === 1, 'the down message');
      expect(textOf(run.calls[0])).toBe('your-site.example is DOWN (Error: connect ECONNREFUSED).');
    });
  });

  it('temperature-alert: alerts once above the limit, stays quiet while hot, tells when back to normal', async () => {
    const run = await start('temperature-alert.json');
    run.fireInject('Reading 31.5 (replace with your sensor)');
    await until(() => run.calls.length === 1, 'the alert');
    expect(textOf(run.calls[0])).toBe('Temperature is 31.5 C, above the limit of 30 C.');
    run.fireInject('Reading 31.5 (replace with your sensor)');
    await settle();
    expect(run.calls).toHaveLength(1);
    run.fireInject('Reading 27 (replace with your sensor)');
    await until(() => run.calls.length === 2, 'the all-clear');
    expect(textOf(run.calls[1])).toBe('Temperature is back to normal: 27 C.');
    run.fireInject('Reading 27 (replace with your sensor)');
    await settle();
    expect(run.calls).toHaveLength(2);
  });

  describe('daily-weather-forecast', () => {
    it('writes the forecast from the service answer', async () => {
      const run = await start('daily-weather-forecast.json', {
        httpStub:
          'msg.payload = { daily: { time: ["2026-06-08"], temperature_2m_max: [14.4], temperature_2m_min: [7.6], precipitation_probability_max: [40] } }; return msg;',
      });
      expect(String(run.byName('get the forecast').url)).toContain('api.open-meteo.com/v1/forecast');
      run.fireInject();
      await until(() => run.calls.length === 1, 'the forecast');
      expect(textOf(run.calls[0])).toBe('Today: 8 to 14 C, chance of rain 40%.');
    });

    it('sends nothing when the service answers without a forecast', async () => {
      const run = await start('daily-weather-forecast.json', { httpStub: 'msg.payload = {}; return msg;' });
      run.fireInject();
      await settle();
      expect(run.calls).toHaveLength(0);
    });
  });

  it('send-a-pdf: sends a document with the file name and the text as the caption', async () => {
    const run = await start('send-a-pdf.json');
    run.fireInject();
    await until(() => run.calls.length === 1, 'the document');
    expect(body(run.calls[0]).content).toEqual({
      document_url: 'https://your-site.example/files/invoice-june.pdf',
      caption: 'Your invoice for June',
      filename: 'invoice-june.pdf',
    });
  });

  it('share-the-store-location: answers a question about where you are with a location', async () => {
    const run = await start('share-the-store-location.json');
    run.deliver(incoming('Hi, where are you exactly?'));
    await until(() => run.calls.length === 1, 'the location');
    expect(body(run.calls[0]).content).toEqual({
      latitude: 51.5007,
      longitude: -0.1246,
      name: 'Our store',
      address: '10 Example Street, London',
    });
    run.deliver(incoming('what is the price?'));
    run.deliver(groupMessage());
    await settle();
    expect(run.calls).toHaveLength(1);
  });

  it('node-red-error-alert: an error on the tab becomes a WhatsApp message', async () => {
    const run = await start('node-red-error-alert.json');
    run.fireInject();
    await until(() => run.calls.length === 1, 'the alert');
    expect(textOf(run.calls[0])).toBe('Node-RED error in fails on purpose (delete me): Error: This is a test error');
  });

  describe('confirm-delivery-or-alert', () => {
    it('warns the owner when the status is failed', async () => {
      const run = await start('confirm-delivery-or-alert.json', {
        skipDelay: true,
        reply: (call) =>
          call.method === 'POST' ? { body: { message_id: ID, status: 'pending' } } : { body: { message_id: ID, status: 'failed' } },
      });
      run.fireInject();
      await until(() => run.calls.length === 3, 'send, status, warning');
      expect(run.calls[0].method).toBe('POST');
      expect(run.calls[1].url).toBe(`https://api.turbonotify.com/v1/numbers/main/messages/${ID}/status`);
      expect(body(run.calls[2]).to).toEqual({ number: '+12025550199' });
      expect(textOf(run.calls[2])).toBe(`WhatsApp message ${ID} failed to reach the customer.`);
    });

    it('stays quiet when the message was delivered', async () => {
      const run = await start('confirm-delivery-or-alert.json', { skipDelay: true });
      run.fireInject();
      await until(() => run.calls.length === 2, 'send and status');
      await settle();
      expect(run.calls).toHaveLength(2);
    });
  });

  it('log-incoming-to-csv: one quoted CSV line per message', async () => {
    const run = await start('log-incoming-to-csv.json');
    run.deliver(incoming('He said "yes", then left'));
    await until(() => run.captured.length === 1, 'one line');
    expect(run.captured[0]).toBe('"2026-06-08T10:00:00","main","12025550142","Ana Silva","text","He said ""yes"", then left"');
    expect(run.flow.find((n) => n.type === 'helper')).toBeDefined();
  });
});
