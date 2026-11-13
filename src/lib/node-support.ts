import { ApiError, ValidationError } from './errors';
import type { ConfigNode, Msg, NodeContext, RedNode } from './red';

/** Shows the failure on the node (red ring) and returns the error for node.error or done(). */
export function failNode(node: RedNode, error: unknown, msg?: Msg): Error {
  if (error instanceof ApiError) {
    node.status({ fill: 'red', shape: 'ring', text: error.code });
    // Node-RED 4 copies `error.cause` into msg.error, Node-RED 3 does not: this one is there on both.
    if (msg) msg.errorDescription = error.details.description;
    return error;
  }
  if (error instanceof ValidationError) {
    node.status({ fill: 'red', shape: 'ring', text: `invalid ${error.property}`.slice(0, 40) });
    if (msg) msg.errorDescription = error.message;
    return error;
  }
  node.status({ fill: 'red', shape: 'ring', text: 'error' });
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * A yellow ring right after a deploy tells the person the key is still missing, before the first message
 * fails. Returns true when the key is missing.
 */
/** The API answers `status` as `{ state, at, error }`; the badge shows the state, whatever shape comes back. */
export function stateText(status: unknown, fallback: string): string {
  if (typeof status === 'string' && status !== '') return status;
  if (typeof status === 'object' && status !== null) {
    const state = (status as { state?: unknown }).state;
    if (typeof state === 'string' && state !== '') return state;
  }
  return fallback;
}

export function markMissingKey(node: RedNode, server: ConfigNode | null): boolean {
  if (server === null || (server.credentials?.apiKey ?? '').trim() !== '') return false;
  node.status({ fill: 'yellow', shape: 'ring', text: 'paste your API key' });
  return true;
}

export function readContext(context: NodeContext, key: string): Promise<unknown> {
  return new Promise((resolve, reject) =>
    context.get(key, (err, value) => (err ? reject(err) : resolve(value))),
  );
}

export function writeContext(context: NodeContext, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) =>
    context.set(key, value, (err) => (err ? reject(err) : resolve())),
  );
}
