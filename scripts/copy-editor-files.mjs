// Copies the editor files (one .html per node) next to the compiled JavaScript.
import { cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const from = 'src/nodes';
const to = 'dist/nodes';
for (const name of readdirSync(from)) {
  if (name.endsWith('.html')) cpSync(join(from, name), join(to, name));
}
