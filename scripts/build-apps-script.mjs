import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sources = [
  'apps-script/Spreadsheet.gs',
  'apps-script/Security.gs',
  'apps-script/Ownership.gs',
  'apps-script/Reminders.gs',
  'apps-script/Sync.gs',
  'apps-script/Api.gs',
  'apps-script/Code.gs',
];
const target = resolve('apps-script', 'dist', 'Code.gs');
const chunks = await Promise.all(sources.map(async (file) => {
  const source = await readFile(resolve(file), 'utf8');
  return `// ===== ${file} =====\n${source.trim()}\n`;
}));

await mkdir(dirname(target), { recursive: true });
await writeFile(target, chunks.join('\n'), 'utf8');
console.log(`Built ${target} from ${sources.length} sources.`);
