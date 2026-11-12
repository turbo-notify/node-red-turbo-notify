import helper from 'node-red-node-test-helper';

import configNode from '../src/nodes/turbo-notify-config';
import eventsNode from '../src/nodes/turbo-notify-events';
import sendNode from '../src/nodes/turbo-notify-send';
import statusNode from '../src/nodes/turbo-notify-status';

export { configNode, eventsNode, sendNode, statusNode };

export const KEY = 'tn_live_test_key_0123456789';
export const ALL_NODES = [configNode, sendNode, statusNode, eventsNode];

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Make fetch reject, like a network failure. */
  reject?: Error;
}

/** Replaces the global fetch. Each call takes the next reply (the last one repeats). */
export type ReplySource = FakeReply | ((call: Call) => FakeReply);

export function mockFetch(...replies: ReplySource[]): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const text = typeof init?.body === 'string' ? init.body : undefined;
    const call: Call = {
      url: String(url),
      method: String(init?.method),
      headers: { ...(init?.headers as Record<string, string>) },
      body: text === undefined ? undefined : JSON.parse(text),
    };
    calls.push(call);
    const source = replies[Math.min(index, replies.length - 1)] ?? {};
    const reply = typeof source === 'function' ? source(call) : source;
    index += 1;
    if (reply.reject) throw reply.reject;
    const status = reply.status ?? 200;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export const flowWithSend = (props: Record<string, unknown> = {}): Array<Record<string, unknown>> => [
  { id: 'cfg', type: 'turbo-notify-config', name: 'acct', baseUrl: 'https://api.turbonotify.com' },
  { id: 'n1', type: 'turbo-notify-send', server: 'cfg', to: '', number: 'main', wires: [['out']], ...props },
  { id: 'out', type: 'helper' },
];

export const credentials = { cfg: { apiKey: KEY } };

/** Sends one message into node n1 and resolves with what came out of `out` or what the Catch node got. */
export function runThrough(
  nodeId: string,
  msg: Record<string, unknown>,
): Promise<{ out?: Record<string, unknown>; error?: Error }> {
  return new Promise((resolve) => {
    const out = helper.getNode('out');
    out.on('input', (m) => resolve({ out: m as Record<string, unknown> }));
    const node = helper.getNode(nodeId);
    node.on('call:error', (call) => {
      const args = (call as { args: unknown[] }).args;
      resolve({ error: args[0] as Error });
    });
    node.receive(msg);
  });
}
