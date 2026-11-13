// Starts a real Node-RED editor with this package installed and a mock Turbo Notify API, so a person (or a
// browser test) can walk through the first minutes: drag a node, create the account, press Test, import an example.
//   npm run build && npm run editor         (editor on http://127.0.0.1:11990, mock API on http://127.0.0.1:18080)
//   SANDBOX_TOURS=1 npm run editor          keeps the welcome tour of a first Node-RED start
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockApi } from './mock-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_PORT = Number(process.env.SANDBOX_EDITOR_PORT ?? 11990);
const API_PORT = Number(process.env.SANDBOX_API_PORT ?? 18080);

const work = mkdtempSync(join(tmpdir(), 'tn-node-red-sandbox-'));
const userDir = join(work, 'user');
mkdirSync(userDir);

const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split('\n')
  .pop();
writeFileSync(join(userDir, 'package.json'), JSON.stringify({ name: 'tn-sandbox', version: '1.0.0', private: true }));
execFileSync('npm', ['install', '--silent', join(work, tarball)], { cwd: userDir, stdio: 'inherit' });

const tours = process.env.SANDBOX_TOURS === '1';
writeFileSync(
  join(work, 'settings.js'),
  `module.exports = {
  uiPort: ${EDITOR_PORT},
  uiHost: '127.0.0.1',
  turboNotifyBaseUrl: 'http://127.0.0.1:${API_PORT}',
  credentialSecret: 'sandbox-secret',
  flowFile: 'flows.json',
  editorTheme: { tours: ${tours}, projects: { enabled: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
};
`,
);

const api = await startMockApi(API_PORT);
const redJs = join(ROOT, 'node_modules', 'node-red', 'red.js');
const editor = spawn(process.execPath, [redJs, '-s', join(work, 'settings.js'), '-u', userDir], { stdio: 'inherit' });

console.log(`\nEditor:   http://127.0.0.1:${EDITOR_PORT}`);
console.log(`Mock API: http://127.0.0.1:${API_PORT}  (the nodes use it through turboNotifyBaseUrl in settings.js)`);
console.log('Keys: tn_live_good_connected, tn_live_good_nonumber, tn_live_noscope; any other key is refused.\n');

const stop = () => {
  editor.kill();
  api.close();
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
editor.on('exit', stop);
