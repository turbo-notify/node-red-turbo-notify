declare module 'node-red-node-test-helper' {
  interface TestNode {
    id: string;
    credentials?: Record<string, string | undefined>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    receive(msg: Record<string, unknown>): void;
    emit(event: string, ...args: unknown[]): void;
    status: { lastCall?: { args: unknown[] } };
    context(): {
      get(key: string, callback: (err: unknown, value: unknown) => void): void;
      flow: { get(key: string): unknown; set(key: string, value: unknown): void };
    };
  }
  interface HttpAnswer {
    status: number;
    body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    text: string;
  }
  interface HttpPost extends PromiseLike<HttpAnswer> {
    set(name: string, value: string): HttpPost;
    send(body: unknown): HttpPost;
  }
  interface HttpRequest {
    get(path: string): Promise<HttpAnswer>;
    post(path: string): HttpPost;
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
    /** Merges runtime settings (what settings.js holds); call it before load. {} resets them. */
    settings(userSettings: Record<string, unknown>): void;
    getNode(id: string): TestNode;
    request(): HttpRequest;
    /** The runtime's node registry. getFlows() is what the admin API returns for GET /flows. */
    _redNodes: { getFlows(): { flows: unknown } };
  }
  const helper: Helper;
  export default helper;
}
