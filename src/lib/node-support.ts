import { ApiError, ValidationError } from './errors';
import type { NodeContext, RedNode } from './red';

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
