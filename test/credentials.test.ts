import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import helper from 'node-red-node-test-helper';
import { ALL_NODES, KEY, flowWithSend, mockFetch } from './support';

beforeAll(() => helper.startServer());
afterAll(() => helper.stopServer());
afterEach(() => helper.unload());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the API key lives only in the credentials store (acceptance 6)', () => {
  it('the exported flow JSON holds no key', async () => {
    await helper.load(ALL_NODES, flowWithSend(), { cfg: { apiKey: KEY } });
    const exported = JSON.stringify(helper._redNodes.getFlows());
    expect(exported).toContain('turbo-notify-config');
    expect(exported).not.toContain(KEY);
    expect(exported.toLowerCase()).not.toContain('apikey');
    // The key is still usable by the node through the credentials store.
    expect(helper.getNode('cfg').credentials?.apiKey).toBe(KEY);
  });

  it('a key pasted into the flow file by mistake is not what the node uses', async () => {
    const fake = mockFetch({ body: { message_id: 'msg_0198d3c5a1b24d3e9f01a2b3c4d5e6f7', status: 'pending' } });
    try {
      const flow = flowWithSend({ to: '+12025550123' });
      flow[0].apiKey = 'flow_file_key';
      await helper.load(ALL_NODES, flow, { cfg: { apiKey: KEY } });
      helper.getNode('n1').receive({ payload: 'hi' });
      await wait(50);
      expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    } finally {
      fake.restore();
    }
  });

  it('the editor defines the key as a credential, never as a node property', () => {
    const html = readFileSync(join(__dirname, '../src/nodes/turbo-notify-config.html'), 'utf8');
    const defaults = html.slice(html.indexOf('defaults:'), html.indexOf('credentials:'));
    expect(defaults).not.toMatch(/apiKey/i);
    expect(html).toMatch(/credentials:\s*\{\s*apiKey:\s*\{\s*type:\s*'password'\s*\}/);
    // The example flows carry no credentials either.
    const example = readFileSync(join(__dirname, '../examples/door-sensor-to-whatsapp.json'), 'utf8');
    expect(example).not.toMatch(/apiKey|credentials/);
  });

  it('the error and status texts never print the key', async () => {
    const fake = mockFetch({ status: 401, body: { error: 'not_authenticated' } });
    try {
      await helper.load(ALL_NODES, flowWithSend({ to: '+12025550123' }), { cfg: { apiKey: KEY } });
      const errors: string[] = [];
      helper.getNode('n1').on('call:error', (call) => errors.push(String((call as { args: unknown[] }).args[0])));
      helper.getNode('n1').receive({ payload: 'hi' });
      await wait(50);
      expect(errors.join('')).toContain('not_authenticated');
      expect(errors.join('')).not.toContain(KEY);
    } finally {
      fake.restore();
    }
  });
});

describe('a Catch node receives the failure', () => {
  it('msg.error.message is the API code and the description is in msg.error.cause', async () => {
    const fake = mockFetch({ status: 403, body: { error: 'insufficient_scope', required_scope: 'messages:send' } });
    try {
      await helper.load(
        ALL_NODES,
        [
          { id: 'cfg', type: 'turbo-notify-config' },
          { id: 'n1', type: 'turbo-notify-send', server: 'cfg', to: '+12025550123', wires: [[]] },
          { id: 'c1', type: 'catch', scope: null, wires: [['out']] },
          { id: 'out', type: 'helper' },
        ],
        { cfg: { apiKey: KEY } },
      );
      const caught = new Promise<Record<string, unknown>>((resolve) =>
        helper.getNode('out').on('input', (m) => resolve(m as Record<string, unknown>)),
      );
      helper.getNode('n1').receive({ payload: 'hi' });
      const msg = await caught;
      const error = msg.error as {
        message: string;
        code: string;
        cause: { description: string; requiredScope: string; status: number };
      };
      expect(error.message).toBe('insufficient_scope');
      expect(error.code).toBe('insufficient_scope');
      expect(error.cause.status).toBe(403);
      expect(error.cause.requiredScope).toBe('messages:send');
      expect(error.cause.description).toContain("'messages:send'");
    } finally {
      fake.restore();
    }
  });
});
