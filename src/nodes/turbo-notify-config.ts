import { type ApiConfig, DEFAULT_BASE_URL, apiRequest, normalizeBaseUrl } from '../lib/client';
import { ApiError, ValidationError } from '../lib/errors';
import type { ConfigNode, NodeConfig, Red } from '../lib/red';

/** The editor sends this placeholder for a password field the person did not change. */
const UNCHANGED = '__PWRD__';

/** The one way to point the nodes at another address (a test double, a staging copy): `settings.js`, never a flow. */
const SETTINGS_KEY = 'turboNotifyBaseUrl';

const KEY_PREFIX = /^tn_/;

/** What the Test button tells the person. `state` picks the color and the link in the editor. */
type TestState = 'ready' | 'no_number' | 'unchecked' | 'no_key' | 'bad_format' | 'refused' | 'error';
interface TestAnswer {
  ok: boolean;
  state: TestState;
  description: string;
  code?: string;
}

function apiConfigOf(apiKey: unknown, baseUrl: unknown): ApiConfig {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key === '') {
    throw new ValidationError(
      'API key',
      'is not set. Open the Turbo Notify account node and paste a key created under API keys in the dashboard.',
    );
  }
  return { apiKey: key, baseUrl: normalizeBaseUrl(baseUrl) };
}

/** The dashboard address inside a description is a link in the editor, so the text drops it. */
const withoutDashboardUrl = (text: string): string => text.replace(/\s*\(https:\/\/dashboard\.turbonotify\.com[^)]*\)/g, '');

export = function register(RED: Red): void {
  const configuredBase = (): unknown => RED.settings?.[SETTINGS_KEY];

  function TurboNotifyConfig(this: ConfigNode, config: NodeConfig): void {
    RED.nodes.createNode(this, config);
    this.apiConfig = () => apiConfigOf(this.credentials?.apiKey, configuredBase());
    // Flows made before 1.5.15 carry an address. It is ignored: a flow someone shares must not choose where your key goes.
    const old = typeof config.baseUrl === 'string' ? config.baseUrl.trim().replace(/\/+$/, '') : '';
    if (old !== '' && old !== DEFAULT_BASE_URL) {
      this.warn(
        `The address "${old}" saved in this account node is ignored: the nodes always use ${DEFAULT_BASE_URL}. ` +
          `To use another address, set ${SETTINGS_KEY} in settings.js.`,
      );
    }
  }

  // The API key lives in the credentials store only, never in the flow file.
  RED.nodes.registerType('turbo-notify-config', TurboNotifyConfig, {
    credentials: { apiKey: { type: 'password' } },
  });

  async function runTest(apiKey: string): Promise<TestAnswer> {
    const key = apiKey.trim();
    if (key === '') {
      return {
        ok: false,
        state: 'no_key',
        description: 'Paste your API key first. You create it in the Turbo Notify dashboard, under API keys.',
      };
    }
    if (!KEY_PREFIX.test(key)) {
      return {
        ok: false,
        state: 'bad_format',
        description:
          'That does not look like a Turbo Notify API key. Keys start with tn_live_ and are created in the dashboard, under API keys.',
      };
    }
    let config: ApiConfig;
    try {
      config = apiConfigOf(key, configuredBase());
    } catch (error) {
      return { ok: false, state: 'error', code: 'invalid_input', description: (error as Error).message };
    }
    try {
      await apiRequest(config, { method: 'GET', path: '/usage' });
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, state: 'refused', code: error.code, description: withoutDashboardUrl(error.details.description) };
      }
      return { ok: false, state: 'error', code: 'error', description: 'The test could not be run.' };
    }
    // The key works. Most first-time failures after this point are a number that is not linked yet, so look at it.
    try {
      const number = await apiRequest<{ status?: unknown }>(config, { method: 'GET', path: '/numbers/main' });
      if (number.status === 'connected') {
        return { ok: true, state: 'ready', description: 'Connected. The key works and your WhatsApp number is linked.' };
      }
      return {
        ok: true,
        state: 'no_number',
        description: `The key works, but your WhatsApp number is not connected yet (status: ${String(number.status ?? 'unknown')}). Link it in the dashboard, under Numbers, then press Test again.`,
      };
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'no_main_number' || error.code === 'number_not_found' || error.code === 'not_found')) {
        return {
          ok: true,
          state: 'no_number',
          description:
            'The key works, but no WhatsApp number is linked yet. Link it in the dashboard, under Numbers, then press Test again.',
        };
      }
      return {
        ok: true,
        state: 'unchecked',
        description:
          'The key works, but it could not check your WhatsApp number (this key may not be allowed to read numbers). Make sure a number is linked under Numbers in the dashboard.',
      };
    }
  }

  // Test button of the config node: reads the account usage and the main number with the key.
  RED.httpAdmin.post(
    '/turbo-notify/test',
    RED.auth.needsPermission('turbo-notify-config.write'),
    async (req, res) => {
      const body = req.body ?? {};
      const id = typeof body.id === 'string' ? body.id : '';
      const typed = typeof body.apiKey === 'string' ? body.apiKey : '';
      let apiKey = typed;
      if (typed === '' || typed === UNCHANGED) {
        // A field that shows dots is tested with the key already stored, and only for a deployed config node.
        const node = id !== '' ? (RED.nodes.getNode(id) as (ConfigNode & { type?: string }) | null) : null;
        if (!node || node.type !== 'turbo-notify-config') {
          if (typed === UNCHANGED) {
            res.json({
              ok: false,
              state: 'error',
              code: 'invalid_input',
              description: 'Paste the key again to test it, or deploy this account node first.',
            } satisfies TestAnswer);
            return;
          }
          apiKey = '';
        } else {
          apiKey = RED.nodes.getCredentials(id)?.apiKey ?? '';
        }
      }
      res.json(await runTest(apiKey));
    },
  );
};
