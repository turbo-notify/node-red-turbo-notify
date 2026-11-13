import { ApiError, ValidationError } from './errors';
import type { ConfigNode, NodeContext, RedNode } from './red';

/** Shows the failure on the node (red ring) and returns the error for node.error or done(). */
export function failNode(node: RedNode, error: unknown): Error {
  if (error instanceof ApiError) {
    node.status({ fill: 'red', shape: 'ring', text: error.code });
    return error;
  }
  if (error instanceof ValidationError) {
    node.status({ fill: 'red', shape: 'ring', text: `invalid ${error.property}`.slice(0, 40) });
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
