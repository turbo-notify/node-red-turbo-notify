import { type ApiConfig, DEFAULT_BASE_URL, apiRequest, normalizeBaseUrl } from '../lib/client';
import { ApiError, ValidationError } from '../lib/errors';
import type { ConfigNode, NodeConfig, Red } from '../lib/red';

/** The editor sends this placeholder for a password field the person did not change. */
const UNCHANGED = '__PWRD__';

function apiConfigOf(apiKey: unknown, baseUrl: unknown): ApiConfig {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key === '') {
    throw new ValidationError(
      'API key',
      'is not set. Open the Turbo Notify config node and paste a key created under API keys in the dashboard.',
    );
  }
  return { apiKey: key, baseUrl: normalizeBaseUrl(baseUrl) };
}

export = function register(RED: Red): void {
  function TurboNotifyConfig(this: ConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config);
    this.apiConfig = () => apiConfigOf(this.credentials?.apiKey, config.baseUrl);
  }

  // The API key lives in the credentials store only, never in the flow file.
  RED.nodes.registerType('turbo-notify-config', TurboNotifyConfig, {
    credentials: { apiKey: { type: 'password' } },
  });

  // Test button of the config node: one read of the account usage with the key.
  RED.httpAdmin.post(
    '/turbo-notify/test',
    RED.auth.needsPermission('turbo-notify-config.write'),
    async (req, res) => {
      const body = req.body ?? {};
      const id = typeof body.id === 'string' ? body.id : '';
      const typed = typeof body.apiKey === 'string' ? body.apiKey : '';
      const apiKey =
        typed !== '' && typed !== UNCHANGED ? typed : (RED.nodes.getCredentials(id)?.apiKey ?? '');
      const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl !== '' ? body.baseUrl : DEFAULT_BASE_URL;
      try {
        await apiRequest(apiConfigOf(apiKey, baseUrl), { method: 'GET', path: '/usage' });
        res.json({ ok: true });
      } catch (error) {
        if (error instanceof ApiError) {
          res.json({ ok: false, code: error.code, description: error.details.description });
        } else if (error instanceof ValidationError) {
          res.json({ ok: false, code: 'invalid_input', description: error.message });
        } else {
          res.json({ ok: false, code: 'error', description: 'The test could not be run.' });
        }
      }
    },
  );
};
