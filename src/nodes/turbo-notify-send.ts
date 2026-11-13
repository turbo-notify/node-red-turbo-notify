import { apiRequest } from '../lib/client';
import { ValidationError } from '../lib/errors';
import { failNode, markMissingKey } from '../lib/node-support';
import type { ConfigNode, NodeConfig, Red, RedNode } from '../lib/red';
import { prepareSend } from '../lib/send-request';

export = function register(RED: Red): void {
  function setup(node: RedNode, config: NodeConfig): void {
    const server = RED.nodes.getNode(String(config.server ?? '')) as ConfigNode | null;
    if (!server) node.status({ fill: 'red', shape: 'ring', text: 'no config' });
    else markMissingKey(node, server);

    node.on('input', async (msg, send, done) => {
      try {
        if (!server) {
          throw new ValidationError('Server', 'is not set. Choose a Turbo Notify account in the Account field of this node.');
        }
        const prepared = prepareSend(msg, {
          to: typeof config.to === 'string' ? config.to : '',
          number: typeof config.number === 'string' ? config.number : '',
        });
        const api = server.apiConfig();
        node.status({ fill: 'blue', shape: 'dot', text: 'sending' });
        const result = await apiRequest(api, {
          method: 'POST',
          path: prepared.path,
          body: prepared.body,
          headers: prepared.headers,
        });
        msg.payload = result;
        if (typeof result.message_id === 'string') msg.messageId = result.message_id;
        node.status({ fill: 'green', shape: 'dot', text: String(result.status ?? 'accepted') });
        send(msg);
        done();
      } catch (error) {
        done(failNode(node, error));
      }
    });
  }

  function TurboNotifySend(this: RedNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config);
    setup(this, config);
  }

  RED.nodes.registerType('turbo-notify-send', TurboNotifySend);
};
