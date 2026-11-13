import helper from 'node-red-node-test-helper';
import {
  type EventRecord,
  type ListFn,
  type PollState,
  LOOKBACK_MS,
  MAX_PAGES,
  PAGE,
  checkInterval,
  parseTypes,
  pollOnce,
} from '../src/lib/poll';
import { timers } from '../src/lib/timers';
import { ALL_NODES, type Call, KEY, mockFetch } from './support';

/** A model of the documented events API: newest first, created[gte], starting_after, limit. */
class EventStore {
  rows: EventRecord[] = [];
  private seq = 0;
  add(createdAt: string, extra: EventRecord = {}): EventRecord {
    this.seq += 1;
    const event = {
      id: `evt_${String(this.seq).padStart(32, '0')}`,
      type: 'message.received',
      created_at: createdAt,
      data: { n: this.seq },
      ...extra,
    };
    this.rows.push(event);
    this.rows.sort(
      (a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)) || String(b.id).localeCompare(String(a.id)),
    );
    return event;
  }
  list: ListFn = async ({ limit, createdGte, startingAfter }) => {
    let rows = this.rows;
    if (createdGte) rows = rows.filter((e) => Date.parse(String(e.created_at)) >= Date.parse(createdGte));
    if (startingAfter) {
      const at = rows.findIndex((e) => e.id === startingAfter);
      if (at >= 0) rows = rows.slice(at + 1);
    }
    return { data: rows.slice(0, limit) };
  };
}

const at = (secondsFromBase: number) =>
  new Date(Date.parse('2026-11-12T10:00:00Z') + secondsFromBase * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
const NOW = new Date('2026-11-12T10:10:00Z');

describe('pollOnce (cursor rules)', () => {
  it('first poll emits nothing and stores the newest event as the cursor', async () => {
    const store = new EventStore();
    const old = store.add(at(0));
    const newest = store.add(at(30));
    const result = await pollOnce(store.list, undefined, 'k', NOW);
    expect(result.events).toEqual([]);
    expect(result.state.initialized).toBe(true);
    expect(result.state.lastCreatedAt).toBe(at(30));
    expect(result.state.seenIds).toEqual(expect.arrayContaining([old.id, newest.id]));
  });

  it('first poll on an account with no events stores "now" and emits nothing', async () => {
    const result = await pollOnce(new EventStore().list, undefined, 'k', NOW);
    expect(result.events).toEqual([]);
    expect(result.state.lastCreatedAt).toBe(NOW.toISOString());
  });

  it('second poll emits only the new events, oldest first', async () => {
    const store = new EventStore();
    store.add(at(0));
    const first = await pollOnce(store.list, undefined, 'k', NOW);
    const e1 = store.add(at(40));
    const e2 = store.add(at(41));
    const e3 = store.add(at(45));
    const second = await pollOnce(store.list, first.state, 'k', NOW);
    expect(second.events.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    const third = await pollOnce(store.list, second.state, 'k', NOW);
    expect(third.events).toEqual([]);
  });

  it('does not lose an event that becomes visible late with an older second', async () => {
    const store = new EventStore();
    store.add(at(0));
    const first = await pollOnce(store.list, undefined, 'k', NOW);
    store.add(at(50));
    const second = await pollOnce(store.list, first.state, 'k', NOW);
    expect(second.events).toHaveLength(1);
    const late = store.add(at(49));
    const third = await pollOnce(store.list, second.state, 'k', NOW);
    expect(third.events.map((e) => e.id)).toEqual([late.id]);
  });

  it('follows starting_after while a page is full', async () => {
    const store = new EventStore();
    store.add(at(0));
    const first = await pollOnce(store.list, undefined, 'k', NOW);
    for (let i = 1; i <= 250; i++) store.add(at(10 + Math.floor(i / 5)));
    const calls: Array<{ startingAfter?: string; limit: number }> = [];
    const spy: ListFn = (params) => {
      calls.push({ startingAfter: params.startingAfter, limit: params.limit });
      return store.list(params);
    };
    const second = await pollOnce(spy, first.state, 'k', NOW);
    expect(second.events).toHaveLength(250);
    expect(second.truncated).toBe(false);
    expect(calls[0].startingAfter).toBeUndefined();
    expect(calls.slice(1).every((c) => typeof c.startingAfter === 'string')).toBe(true);
    // 251 events in the window: pages of 100, 100 and 51
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.limit === PAGE)).toBe(true);
    // oldest first
    const times = second.events.map((e) => Date.parse(String(e.created_at)));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('stops at 50 pages and says it was cut', async () => {
    let pages = 0;
    const endless: ListFn = async () => {
      pages += 1;
      return {
        data: Array.from({ length: PAGE }, (_, i) => ({
          id: `evt_${String(pages * 1000 + i).padStart(32, '0')}`,
          created_at: at(100),
          type: 'message.received',
        })),
      };
    };
    const state: PollState = { initialized: true, filterKey: 'k', lastCreatedAt: at(0), seenIds: [] };
    const result = await pollOnce(endless, state, 'k', NOW);
    expect(pages).toBe(MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it('an API failure leaves the stored state untouched', async () => {
    const store = new EventStore();
    store.add(at(0));
    const first = await pollOnce(store.list, undefined, 'k', NOW);
    const snapshot = JSON.stringify(first.state);
    const failing: ListFn = async () => {
      throw new Error('boom');
    };
    await expect(pollOnce(failing, first.state, 'k', NOW)).rejects.toThrow('boom');
    expect(JSON.stringify(first.state)).toBe(snapshot);
  });

  it('a changed filter starts again from now', async () => {
    const store = new EventStore();
    store.add(at(0));
    const first = await pollOnce(store.list, undefined, 'types-a', NOW);
    store.add(at(60));
    const other = await pollOnce(store.list, first.state, 'types-b', NOW);
    expect(other.events).toEqual([]);
  });

  it('looks back two minutes from the cursor', async () => {
    expect(LOOKBACK_MS).toBe(120_000);
  });
});

describe('settings', () => {
  it('the interval below 10 seconds is refused', () => {
    expect(() => checkInterval(9)).toThrow(/10 or more/);
    expect(() => checkInterval('5')).toThrow();
    expect(() => checkInterval('')).toThrow();
    expect(() => checkInterval(Number.NaN)).toThrow();
    expect(checkInterval(10)).toBe(10);
    expect(checkInterval('30')).toBe(30);
  });

  it('event types: commas, spaces or lines; bad names and more than 20 are refused', () => {
    expect(parseTypes('message.received, message.sent\nnumber.disconnected')).toEqual([
      'message.received',
      'message.sent',
      'number.disconnected',
    ]);
    expect(parseTypes('')).toEqual([]);
    expect(() => parseTypes('received')).toThrow(/not an event type/);
    expect(() => parseTypes(Array.from({ length: 21 }, (_, i) => `a.b${i}`).join(','))).toThrow(/up to 20/);
  });
});

describe('Events in node', () => {
  beforeAll(() => helper.startServer());
  afterAll(() => helper.stopServer());

  type Scheduled = { fn: () => void; ms: number; cancelled: boolean };
  let scheduled: Scheduled[];
  let fake: ReturnType<typeof mockFetch>;
  let store: EventStore;

  beforeEach(() => {
    scheduled = [];
    jest.spyOn(timers, 'after').mockImplementation((fn, ms) => {
      const entry: Scheduled = { fn, ms, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    });
    store = new EventStore();
  });
  afterEach(async () => {
    fake?.restore();
    jest.restoreAllMocks();
    await helper.unload();
  });

  /** Answers GET /v1/events from the store, like the documented API. */
  const reply = (call: Call) => {
    const url = new URL(call.url);
    let rows = store.rows;
    const gte = url.searchParams.get('created[gte]');
    const after = url.searchParams.get('starting_after');
    if (gte) rows = rows.filter((e) => Date.parse(String(e.created_at)) >= Date.parse(gte));
    if (after) {
      const i = rows.findIndex((e) => e.id === after);
      if (i >= 0) rows = rows.slice(i + 1);
    }
    return { body: { object: 'list', data: rows.slice(0, Number(url.searchParams.get('limit'))), has_more: false } };
  };

  const flow = (props: Record<string, unknown> = {}) => [
    { id: 'cfg', type: 'turbo-notify-config' },
    { id: 'ev', type: 'turbo-notify-events', server: 'cfg', types: 'message.received', number: '', interval: 30, wires: [['out']], ...props },
    { id: 'out', type: 'helper' },
  ];

  /** Runs the next scheduled poll and waits for the poll to schedule the following one. */
  async function tick(): Promise<void> {
    const next = scheduled.find((s) => !s.cancelled && !('ran' in s));
    if (!next) throw new Error('no poll scheduled');
    (next as Scheduled & { ran?: boolean }).ran = true;
    const before = scheduled.length;
    next.fn();
    for (let i = 0; i < 200 && scheduled.length === before; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (scheduled.length === before) throw new Error('poll did not finish');
    // Let the runtime deliver what the node sent.
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  const received: Array<Record<string, unknown>> = [];
  async function load(props: Record<string, unknown> = {}) {
    received.length = 0;
    await helper.load(ALL_NODES, flow(props), { cfg: { apiKey: KEY } });
    helper.getNode('out').on('input', (m) => received.push(m as Record<string, unknown>));
  }
  const statusOf = () => helper.getNode('ev').status.lastCall?.args[0] as { fill: string; shape: string; text: string };

  it('refuses an interval below 10 seconds: no request, no polling, a red status', async () => {
    fake = mockFetch({ body: {} });
    await load({ interval: 5 });
    expect(scheduled).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
    expect(statusOf()).toMatchObject({ fill: 'red', shape: 'ring' });
    expect(statusOf().text).toContain('Interval');
  });

  it('first poll: requests the newest event and its window, emits nothing, stores the cursor', async () => {
    store.add(at(0));
    fake = mockFetch(reply);
    await load();
    expect(scheduled[0].ms).toBe(0);
    await tick();
    expect(received).toHaveLength(0);
    expect(fake.calls).toHaveLength(2);
    const first = new URL(fake.calls[0].url);
    expect(first.origin + first.pathname).toBe('https://api.turbonotify.com/v1/events');
    expect(fake.calls[0].method).toBe('GET');
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(first.searchParams.get('limit')).toBe('1');
    expect(first.searchParams.getAll('types[]')).toEqual(['message.received']);
    const window = new URL(fake.calls[1].url);
    expect(window.searchParams.get('limit')).toBe('100');
    expect(window.searchParams.get('created[gte]')).toBe(at(-120));
    expect(statusOf()).toMatchObject({ fill: 'green', shape: 'dot' });
    const saved = await new Promise<PollState>((resolve) =>
      helper.getNode('ev').context().get('turboNotifyCursor', (_e, v) => resolve(v as PollState)),
    );
    expect(saved.initialized).toBe(true);
    expect(saved.lastCreatedAt).toBe(at(0));
    expect(scheduled[1].ms).toBe(30_000);
  });

  it('second poll emits only the new events, oldest first, with topic and the full envelope', async () => {
    store.add(at(0));
    fake = mockFetch(reply);
    await load();
    await tick();
    const a = store.add(at(40), { number_alias: 'main', number_id: 'num_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' });
    const b = store.add(at(41), { type: 'message.received' });
    await tick();
    expect(received.map((m) => (m.payload as EventRecord).id)).toEqual([a.id, b.id]);
    expect(received[0].topic).toBe('message.received');
    expect(received[0].payload).toMatchObject({ id: a.id, number_alias: 'main', created_at: at(40) });
    expect(statusOf().text).toContain('2 events');
    await tick();
    expect(received).toHaveLength(2);
  });

  it('an API failure moves nothing: the red ring shows the code and the next poll still finds the event', async () => {
    store.add(at(0));
    let failNext = false;
    fake = mockFetch((call) => (failNext ? { status: 403, body: { error: 'insufficient_scope', required_scope: 'events:read' } } : reply(call)));
    await load();
    await tick();
    store.add(at(40));
    failNext = true;
    await tick();
    expect(received).toHaveLength(0);
    expect(statusOf()).toEqual({ fill: 'red', shape: 'ring', text: 'insufficient_scope' });
    failNext = false;
    await tick();
    expect(received).toHaveLength(1);
    expect(statusOf()).toMatchObject({ fill: 'green', shape: 'dot' });
  });

  it('filters by number alias or number id and lists every type given; no types means every event', async () => {
    store.add(at(0));
    fake = mockFetch(reply);
    await load({ types: 'message.received message.sent', number: 'sales' });
    await tick();
    const params = new URL(fake.calls[0].url).searchParams;
    expect(params.getAll('types[]')).toEqual(['message.received', 'message.sent']);
    expect(params.get('number_alias')).toBe('sales');
    expect(params.get('number_id')).toBeNull();
    fake.restore();
    await helper.unload();

    fake = mockFetch(reply);
    await load({ types: '', number: 'num_0198d3c5a1b24d3e9f01a2b3c4d5e6f7' });
    await tick();
    const second = new URL(fake.calls[0].url).searchParams;
    expect(second.getAll('types[]')).toEqual([]);
    expect(second.get('number_id')).toBe('num_0198d3c5a1b24d3e9f01a2b3c4d5e6f7');
  });

  it('a fresh node with an empty context starts from now: it never replays history', async () => {
    store.add(at(0));
    store.add(at(30));
    fake = mockFetch(reply);
    await load();
    await tick();
    expect(received).toHaveLength(0);
  });

  it('closing the node cancels the next poll', async () => {
    store.add(at(0));
    fake = mockFetch(reply);
    await load();
    await tick();
    const pending = scheduled.filter((s) => !s.cancelled && !('ran' in s));
    expect(pending).toHaveLength(1);
    await helper.unload();
    expect(pending[0].cancelled).toBe(true);
  });
});
