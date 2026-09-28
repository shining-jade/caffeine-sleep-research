import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoots = ['index.html', 'teacher', 'public'];
const textExtensions = new Set(['.html', '.js', '.css', '.json', '.svg', '']);
const forbidden = [
  { name: 'Apps Script deployment URL', pattern: /script\.google\.com\/macros\/s\//i },
  { name: 'legacy browser gateway variable', pattern: /\bGAS_API_URL\b/ },
  {
    name: 'server-only reminder environment variable',
    pattern: /\b(?:WEB_PUSH_VAPID_PRIVATE_KEY|CRON_SECRET)\b/,
  },
  {
    name: 'server-only environment variable',
    pattern: /\b(?:SPREADSHEET_ID|TEACHER_PASSWORD|TEACHER_PASSWORD_HASH|TEACHER_PASSWORD_SALT|GAS_SHARED_SECRET|SESSION_SECRET)\b/,
  },
  {
    name: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

function fsPath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

async function collect(value) {
  const path = fsPath(value);
  const extension = extname(path);
  if (extension) return textExtensions.has(extension) ? [path] : [];
  try {
    const files = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) files.push(...await collect(child));
      else if (textExtensions.has(extname(child))) files.push(child);
    }
    return files;
  } catch (error) {
    if (error?.code === 'ENOTDIR') return [path];
    throw error;
  }
}

function configuredSecretValues() {
  return [
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    process.env.CRON_SECRET,
    process.env.GAS_SHARED_SECRET,
    process.env.SESSION_SECRET,
  ].filter((value) => typeof value === 'string' && value.length >= 8);
}

export async function scanPublicBundle(roots = defaultRoots, { secretValues = configuredSecretValues() } = {}) {
  const files = [];
  for (const root of roots) files.push(...await collect(root));
  const failures = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) failures.push({ file, name: rule.name });
    }
    for (const secret of secretValues) {
      if (source.includes(secret)) failures.push({ file, name: 'configured secret value' });
    }
  }
  return failures;
}

async function main() {
  const files = [];
  for (const root of defaultRoots) files.push(...await collect(root));
  const failures = await scanPublicBundle(defaultRoots);
  if (failures.length) {
    console.error('Public bundle security check failed:');
    for (const failure of failures) console.error(`- ${failure.file}: ${failure.name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Public bundle security check passed (${files.length} files).`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) await main();
