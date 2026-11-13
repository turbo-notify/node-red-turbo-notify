// A stand-in for the Turbo Notify API, for trying the nodes in a real Node-RED editor without an account.
// The key you paste decides what the API answers:
//   tn_live_good_connected   the key works and the main number is connected
//   tn_live_good_nonumber    the key works but no number is connected yet
//   tn_live_noscope          the key works for usage but may not read numbers or send
//   anything else            refused as not_authenticated
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export function startMockApi(port = 18080) {
  const server = createServer((req, res) => {
    const key = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const known = ['tn_live_good_connected', 'tn_live_good_nonumber', 'tn_live_noscope'];
    const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/v1/, '');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!known.includes(key)) return json(res, 401, { error: 'not_authenticated' });
      if (req.method === 'GET' && path === '/usage') return json(res, 200, { plan: 'solo', messages: { used: 0, limit: 1000 } });
      if (key === 'tn_live_noscope') return json(res, 403, { error: 'insufficient_scope', required_scope: 'messages:send' });
      if (req.method === 'GET' && /^\/numbers\/[^/]+$/.test(path)) {
        return key === 'tn_live_good_nonumber'
          ? json(res, 200, { alias: 'main', status: 'pending' })
          : json(res, 200, { alias: 'main', status: 'connected', number: '+12025550123' });
      }
      if (req.method === 'POST' && /^\/numbers\/[^/]+\/messages$/.test(path)) {
        if (key === 'tn_live_good_nonumber') return json(res, 409, { error: 'number_not_connected' });
        return json(res, 202, { message_id: `msg_${randomBytes(16).toString('hex')}`, status: 'pending' });
      }
      if (req.method === 'GET' && /^\/numbers\/[^/]+\/messages\/[^/]+\/status$/.test(path)) {
        return json(res, 200, { status: 'delivered' });
      }
      return json(res, 404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 18080);
  await startMockApi(port);
  console.log(`Mock Turbo Notify API on http://127.0.0.1:${port}`);
}
