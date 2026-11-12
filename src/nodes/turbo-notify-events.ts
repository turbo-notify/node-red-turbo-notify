import { type ApiConfig, apiRequest } from '../lib/client';
import { ValidationError } from '../lib/errors';
import { failNode, readContext, writeContext } from '../lib/node-support';
import {
  DEFAULT_INTERVAL_SECONDS,
  type EventRecord,
  type ListFn,
  type PollState,
  checkInterval,
  parseTypes,
  pollOnce,
} from '../lib/poll';
import type { ConfigNode, NodeConfig, Red, RedNode } from '../lib/red';
import { timers } from '../lib/timers';
import { isBlank, numberRef } from '../lib/validation';

const CURSOR_KEY = 'turboNotifyCursor';

export = function register(RED: Red): void {
  function setup(node: RedNode, config: NodeConfig): void {
    const server = RED.nodes.getNode(String(config.server ?? '')) as ConfigNode | null;

    let seconds: number;
    let types: string[];
    let number: string;
    try {
      if (!server) throw new ValidationError('Server', 'is not set. Choose a Turbo Notify config node in this node.');
      seconds = checkInterval(config.interval ?? DEFAULT_INTERVAL_SECONDS);
      types = parseTypes(config.types);
      number = isBlank(config.number) ? '' : numberRef(config.number, 'Number');
    } catch (error) {
      // A bad setting is reported once, at deploy time, and the node does not poll.
      node.error(failNode(node, error));
      return;
    }

    const filterKey = `${[...types].sort().join(',')}|${number}`;
    const controller = new AbortController();
    let cancelTimer: (() => void) | undefined;
    let closed = false;

    const list = (api: ApiConfig): ListFn => async (params) => {
      const query: Array<[string, string]> = [['limit', String(params.limit)]];
      for (const type of types) query.push(['types[]', type]);
      if (number !== '') query.push([/^num_[0-9a-f]{32}$/.test(number) ? 'number_id' : 'number_alias', number]);
      if (params.createdGte) query.push(['created[gte]', params.createdGte]);
      if (params.startingAfter) query.push(['starting_after', params.startingAfter]);
      return apiRequest<{ data?: EventRecord[] }>(api, {
        method: 'GET',
        path: '/events',
        query,
        signal: controller.signal,
      });
    };

    const poll = async (): Promise<void> => {
      try {
        const context = node.context();
        const stored = (await readContext(context, CURSOR_KEY)) as PollState | undefined;
        const result = await pollOnce(list(server!.apiConfig()), stored, filterKey, new Date());
        if (closed) return;
        for (const event of result.events) {
          node.send({ payload: event, topic: String(event.type ?? '') });
        }
        // The cursor moves only after the events were handed on: delivery is at least once.
        await writeContext(context, CURSOR_KEY, result.state);
        if (result.truncated) {
          node.warn('More events arrived than one poll reads. The oldest of them were left out. Poll more often or use a webhook.');
        }
        const first = stored?.initialized !== true || stored.filterKey !== filterKey;
        node.status({
          fill: 'green',
          shape: 'dot',
          text: first ? 'listening' : `${result.events.length} events at ${new Date().toLocaleTimeString()}`,
        });
      } catch (error) {
        if (closed) return;
        // The cursor stays where it was: the next poll reads the same window again.
        node.error(failNode(node, error));
      } finally {
        if (!closed) cancelTimer = timers.after(() => void poll(), seconds * 1000);
      }
    };

    node.status({ fill: 'grey', shape: 'ring', text: 'starting' });
    cancelTimer = timers.after(() => void poll(), 0);

    node.on('close', (done) => {
      closed = true;
      controller.abort();
      cancelTimer?.();
      done();
    });
  }

  function TurboNotifyEvents(this: RedNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config);
    setup(this, config);
  }

  RED.nodes.registerType('turbo-notify-events', TurboNotifyEvents);
};
