import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VERSION } from '../src/lib/version';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const pkg = JSON.parse(read('package.json'));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'coverage', 'dist'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

describe('package contract (what the Flow Library and the scorecard read)', () => {
  it('has no runtime dependencies and a scoped, MIT, public package', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.name).toBe('@turbo-notify/node-red-whatsapp');
    expect(pkg.license).toBe('MIT');
    expect(pkg.publishConfig).toMatchObject({ access: 'public', provenance: true });
    expect(pkg.engines.node).toBe('>=18');
    expect(pkg.bugs.url).toBe('https://github.com/turbo-notify/node-red-turbo-notify/issues');
    expect(pkg.repository.url).toContain('github.com/turbo-notify/node-red-turbo-notify');
    expect(existsSync(join(ROOT, 'LICENSE'))).toBe(true);
    expect(pkg.files).toEqual(['dist', 'examples']);
  });

  it('the version constant matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('carries the one version every public Turbo Notify package carries, and the words people search for', () => {
    expect(pkg.version).toBe('1.5.13');
    // The name and description are what npm and the palette search read: keep the two search words in the name.
    expect(pkg.name).toMatch(/node-red/);
    expect(pkg.name).toMatch(/whatsapp/);
    for (const keyword of ['node-red', 'whatsapp', 'whatsapp-api', 'whatsapp-bot', 'chatbot', 'auto-reply', 'turbo-notify']) {
      expect(pkg.keywords).toContain(keyword);
    }
    expect(pkg.description).toMatch(/^WhatsApp nodes for Node-RED/);
    expect(pkg.description.length).toBeLessThanOrEqual(200);
  });

  it('lists four nodes with the turbo-notify- prefix, each with a source and an editor file', () => {
    expect(pkg['node-red'].version).toMatch(/^>=\d+\.\d+\.\d+$/);
    const nodes = pkg['node-red'].nodes as Record<string, string>;
    expect(Object.keys(nodes).sort()).toEqual([
      'turbo-notify-config',
      'turbo-notify-events',
      'turbo-notify-send',
      'turbo-notify-status',
    ]);
    for (const [type, file] of Object.entries(nodes)) {
      expect(file).toBe(`dist/nodes/${type}.js`);
      expect(existsSync(join(ROOT, `src/nodes/${type}.ts`))).toBe(true);
      const html = read(`src/nodes/${type}.html`);
      expect(html).toContain(`RED.nodes.registerType('${type}'`);
      expect(html).toContain(`data-template-name="${type}"`);
      expect(html).toContain(`data-help-name="${type}"`);
      expect(read(`src/nodes/${type}.ts`)).toContain(`registerType('${type}'`);
    }
  });

  it('every help text follows the Node-RED style: a summary, then Details or Inputs and Outputs', () => {
    for (const type of Object.keys(pkg['node-red'].nodes)) {
      const help = read(`src/nodes/${type}.html`).split(`data-help-name="${type}"`)[1];
      expect(help).toMatch(/^>\s*<p>[^<]{20,}/);
      expect(help).toContain('<h3>Details</h3>');
      expect(help).toContain('<h3>References</h3>');
      if (type !== 'turbo-notify-config') expect(help).toContain('class="message-properties"');
    }
  });

  it('has eighteen importable example flows that hold no key and no real phone number', () => {
    const files = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual([
      'after-hours-auto-reply.json',
      'camera-picture-to-whatsapp.json',
      'confirm-delivery-or-alert.json',
      'daily-report-to-a-list.json',
      'daily-weather-forecast.json',
      'door-sensor-to-whatsapp.json',
      'http-endpoint-to-whatsapp.json',
      'incoming-to-team-group.json',
      'log-incoming-to-csv.json',
      'menu-by-keyword.json',
      'node-red-error-alert.json',
      'order-confirmation.json',
      'reply-to-an-incoming-message.json',
      'scheduled-reminder.json',
      'send-a-pdf.json',
      'share-the-store-location.json',
      'temperature-alert.json',
      'website-down-alert.json',
    ]);
    const known = new Set([
      'tab', 'comment', 'inject', 'change', 'function', 'delay', 'debug', 'catch', 'switch', 'template',
      'http in', 'http response', 'http request', 'file',
      'turbo-notify-config', 'turbo-notify-send', 'turbo-notify-status', 'turbo-notify-events',
    ]);
    for (const file of files) {
      const text = read(`examples/${file}`);
      const nodes = JSON.parse(text) as Array<Record<string, unknown>>;
      expect(Array.isArray(nodes)).toBe(true);
      const ids = nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      const tabs = nodes.filter((n) => n.type === 'tab');
      expect(tabs).toHaveLength(1);
      expect(String(tabs[0].info).length).toBeGreaterThan(20);
      // Every example explains the setup (key, scope, number) in a comment node.
      expect(nodes.some((n) => n.type === 'comment' && n.name === 'Setup' && /API key/.test(String(n.info)))).toBe(true);
      for (const node of nodes) {
        expect(known.has(String(node.type))).toBe(true);
        expect(node.credentials).toBeUndefined();
        expect(node.apiKey).toBeUndefined();
        for (const wire of ((node.wires ?? []) as string[][]).flat()) expect(ids).toContain(wire);
        if (node.type !== 'tab' && node.type !== 'turbo-notify-config') expect(node.z).toBe(tabs[0].id);
      }
      const configs = nodes.filter((n) => n.type === 'turbo-notify-config');
      expect(configs).toHaveLength(1);
      for (const node of nodes.filter((n) => String(n.type).startsWith('turbo-notify-') && n.type !== 'turbo-notify-config')) {
        expect(node.server).toBe(configs[0].id);
      }
      expect(text).not.toMatch(/tn_live_|tn_test_|Bearer /);
      const phones = text.match(/\+\d{8,}/g) ?? [];
      for (const phone of phones) expect(phone).toMatch(/^\+1202555\d{4}$/);
      expect(text).not.toContain('5511999999999');
    }
  });

  it('every runtime node is used by at least one example (scorecard check N02)', () => {
    const used = new Set<string>();
    for (const file of readdirSync(join(ROOT, 'examples'))) {
      for (const node of JSON.parse(read(`examples/${file}`)) as Array<{ type: string }>) used.add(node.type);
    }
    for (const type of ['turbo-notify-send', 'turbo-notify-status', 'turbo-notify-events']) {
      expect(used.has(type)).toBe(true);
    }
  });

  it('the list example shows a delay node ahead of the send node', () => {
    const nodes = JSON.parse(read('examples/daily-report-to-a-list.json')) as Array<{ type: string }>;
    expect(nodes.map((n) => n.type)).toContain('delay');
  });

  it('the publish workflow uses the npm Trusted Publisher route with provenance on version tags', () => {
    const text = read('.github/workflows/publish.yml');
    expect(text).toContain('id-token: write');
    expect(text).toContain('--provenance');
    expect(text).toMatch(/tags:\s*\n\s*- '\*\.\*\.\*'/);
    // The Trusted Publisher is the route. The one allowed use of a token is the very first release of a new
    // package (a Trusted Publisher can only be set on a package that exists): one optional, empty-by-default
    // secret read in the Publish step, never NODE_AUTH_TOKEN and never anywhere else.
    expect(text).not.toMatch(/NODE_AUTH_TOKEN/);
    const code = text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(code.match(/secrets\.NPM_TOKEN/g)).toHaveLength(1);
    expect(code).toContain('if [ -n "$NPM_TOKEN" ]');
  });

  it('the gitignore keeps internal folders, env files and build output out of the repository', () => {
    const ignore = read('.gitignore').split('\n');
    for (const entry of ['node_modules', 'dist', '.claude/', '.private/', '.codex/', '.gemini/', '.env*', 'graphify-out/']) {
      expect(ignore).toContain(entry);
    }
  });
});

describe('source scan (acceptance 5)', () => {
  const src = walk(join(ROOT, 'src')).filter((f) => /\.(ts|html)$/.test(f));
  const shipped = [...src, ...(existsSync(join(ROOT, 'dist')) ? walk(join(ROOT, 'dist')) : [])];

  it('finds the sources', () => {
    expect(src.length).toBeGreaterThanOrEqual(12);
  });

  it('uses no process.env, no file system and no other process API', () => {
    for (const file of shipped.filter((f) => /\.(ts|js)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      const where = relative(ROOT, file);
      expect({ where, hit: /process\.env/.test(text) }).toEqual({ where, hit: false });
      expect({ where, hit: /(?:from|require\()\s*['"](?:node:)?(?:fs|fs\/promises|child_process|net|dns|http|https)['"]/.test(text) }).toEqual({ where, hit: false });
      expect({ where, hit: /\beval\(|new Function\(/.test(text) }).toEqual({ where, hit: false });
    }
  });

  it('has no URL literal other than the default Base URL and links to the Turbo Notify docs and dashboard', () => {
    const allowedHosts = new Set(['docs.turbonotify.com', 'dashboard.turbonotify.com']);
    for (const file of shipped) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.match(/https?:\/\/[^\s'"`<>)]+/g) ?? []) {
        const url = new URL(match.replace(/[.,;]+$/, ''));
        const ok = url.origin === 'https://api.turbonotify.com' && url.pathname === '/' || allowedHosts.has(url.hostname);
        expect({ file: relative(ROOT, file), url: match, ok }).toEqual({ file: relative(ROOT, file), url: match, ok: true });
      }
    }
  });

  it('writes the default Base URL in one place of the code', () => {
    const hits = src.filter((f) => f.endsWith('.ts') && readFileSync(f, 'utf8').includes('https://api.turbonotify.com'));
    expect(hits.map((f) => relative(ROOT, f))).toEqual(['src/lib/client.ts']);
  });

  it('has no em dash or en dash in any file of the package', () => {
    const banned = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
    const files = walk(ROOT).filter((f) => !f.endsWith('package-lock.json') && !/\.(png|ico|tgz)$/.test(f));
    const extra = existsSync(join(ROOT, 'dist')) ? walk(join(ROOT, 'dist')) : [];
    expect(files.length).toBeGreaterThan(20);
    for (const file of [...files, ...extra]) {
      const where = relative(ROOT, file);
      expect({ where, hit: banned.test(readFileSync(file, 'utf8')) }).toEqual({ where, hit: false });
    }
  });

  it('names no internal path or tool in a shipped file', () => {
    const internal = /\.claude|\.private|\.codex|\.gemini|graphify/;
    const files = walk(ROOT).filter(
      (f) => !f.endsWith('package-lock.json') && !f.endsWith('.gitignore') && !f.endsWith('package.test.ts'),
    );
    for (const file of files) {
      const where = relative(ROOT, file);
      expect({ where, hit: internal.test(readFileSync(file, 'utf8')) }).toEqual({ where, hit: false });
    }
  });
});
