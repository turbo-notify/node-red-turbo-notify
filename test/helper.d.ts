declare module 'node-red-node-test-helper' {
  interface TestNode {
    id: string;
    credentials?: Record<string, string | undefined>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    receive(msg: Record<string, unknown>): void;
    emit(event: string, ...args: unknown[]): void;
    status: { lastCall?: { args: unknown[] } };
    context(): { get(key: string, callback: (err: unknown, value: unknown) => void): void };
  }
  interface HttpAnswer {
    status: number;
    body: unknown;
    text: string;
  }
  interface HttpRequest {
    get(path: string): Promise<HttpAnswer>;
    post(path: string): { send(body: unknown): Promise<HttpAnswer> };
  }
  interface Helper {
    startServer(callback?: (err?: unknown) => void): Promise<void>;
    stopServer(callback?: (err?: unknown) => void): Promise<void>;
    load(
      nodes: unknown,
      flow: Array<Record<string, unknown>>,
      credentials?: Record<string, Record<string, string>>,
    ): Promise<void>;
    unload(): Promise<void>;
    getNode(id: string): TestNode;
    request(): HttpRequest;
    /** The runtime's node registry. getFlows() is what the admin API returns for GET /flows. */
    _redNodes: { getFlows(): { flows: unknown } };
  }
  const helper: Helper;
  export default helper;
}
