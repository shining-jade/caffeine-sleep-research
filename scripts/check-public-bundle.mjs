import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['index.html', 'teacher', 'public'];
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.svg', '']);
const forbidden = [
  { name: 'Apps Script deployment URL', pattern: /script\.google\.com\/macros\/s\//i },
  { name: 'legacy browser gateway variable', pattern: /GAS_API_URL/ },
  { name: 'server-only environment variable', pattern: /\b(?:SPREADSHEET_ID|TEACHER_PASSWORD|TEACHER_PASSWORD_HASH|TEACHER_PASSWORD_SALT|GAS_SHARED_SECRET|SESSION_SECRET)\b/ },
];

async function collect(path) {
  const extension = extname(path);
  if (extension) return textExtensions.has(extension) ? [path] : [];
  try {
    return (await readdir(path, { withFileTypes: true })).flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? [collect(child)] : (textExtensions.has(extname(child)) ? [child] : []);
    });
  } catch (error) {
    if (error?.code === 'ENOTDIR') return [path];
    throw error;
  }
}

const nested = await Promise.all(roots.map(collect));
const files = (await Promise.all(nested.flat(Infinity))).flat(Infinity);
const failures = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`${file}: ${rule.name}`);
  }
}

if (failures.length) {
  console.error('Public bundle security check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Public bundle security check passed (${files.length} files).`);
}
