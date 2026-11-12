/**
 * The small part of the Node-RED runtime API this package uses. Declared here so
 * the package compiles without depending on Node-RED's own typings.
 */
export interface NodeStatus {
  fill?: 'red' | 'green' | 'yellow' | 'blue' | 'grey';
  shape?: 'ring' | 'dot';
  text?: string;
}

export interface NodeContext {
  get(key: string, callback: (err: unknown, value: unknown) => void): void;
  set(key: string, value: unknown, callback: (err: unknown) => void): void;
}

export interface RedNode {
  id: string;
  name?: string;
  credentials?: Record<string, string | undefined>;
  on(event: 'input', handler: (msg: Msg, send: SendFn, done: DoneFn) => void): void;
  on(event: 'close', handler: (done: () => void) => void): void;
  send(msg: Msg | Msg[]): void;
  error(error: unknown, msg?: Msg): void;
  warn(text: string): void;
  status(status: NodeStatus | string): void;
  context(): NodeContext;
}

export type Msg = Record<string, unknown> & { payload?: unknown };
export type SendFn = (msg: Msg | Msg[]) => void;
export type DoneFn = (err?: Error) => void;

export interface NodeConfig {
  id: string;
  type: string;
  name?: string;
  [key: string]: unknown;
}

export interface Request {
  body?: Record<string, unknown>;
}
export interface Response {
  json(body: unknown): void;
  status(code: number): Response;
}
export type Middleware = (req: Request, res: Response, next: () => void) => void;
export type Handler = (req: Request, res: Response) => void | Promise<void>;

export interface Red {
  nodes: {
    createNode(node: unknown, config: NodeConfig): void;
    registerType<N extends RedNode>(
      type: string,
      constructor: (this: N, config: NodeConfig) => void,
      options?: { credentials?: Record<string, { type: 'text' | 'password' }> },
    ): void;
    getNode(id: string): unknown;
    getCredentials(id: string): Record<string, string | undefined> | undefined;
  };
  httpAdmin: {
    post(path: string, permission: Middleware, handler: Handler): void;
  };
  auth: {
    needsPermission(permission: string): Middleware;
  };
}

/** The Turbo Notify config node as the other nodes see it. */
export interface ConfigNode extends RedNode {
  /** The key and address for a call. Throws a ValidationError when the key is missing or the address is not usable. */
  apiConfig(): { apiKey: string; baseUrl: string };
}
