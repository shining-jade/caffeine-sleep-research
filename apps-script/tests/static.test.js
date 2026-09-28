import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('legacy business code does not emit identifiable records to Apps Script logs', async () => {
  const source = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Logger\.log\(/);
});

test('tracked Apps Script source has one secure spreadsheet provider and no active binding', async () => {
  const directory = new URL('../', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.gs'));
  const sources = await Promise.all(files.map(async (name) => ({
    name,
    source: await readFile(new URL(`../${name}`, import.meta.url), 'utf8'),
  })));
  const combined = sources.map(({ name, source }) => `/* ${name} */\n${source}`).join('\n');

  assert.doesNotMatch(combined, /getActiveSpreadsheet\s*\(/);
  assert.doesNotMatch(combined, /openById\s*\(\s*['"][^'"]+['"]\s*\)/);
  assert.match(combined, /getProperty\(['"]SPREADSHEET_ID['"]\)/);
  assert.equal((combined.match(/function doPost\s*\(/g) || []).length, 1);
  assert.equal((combined.match(/function doGet\s*\(/g) || []).length, 1);
  assert.doesNotThrow(() => new vm.Script(combined));
});

test('Apps Script build includes every gateway source exactly once', async () => {
  const result = spawnSync(process.execPath, ['scripts/build-apps-script.mjs'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const built = await readFile(new URL('../dist/Code.gs', import.meta.url), 'utf8');
  for (const source of ['Spreadsheet.gs', 'Security.gs', 'Ownership.gs', 'Reminders.gs', 'Api.gs', 'Code.gs']) {
    const marker = `// ===== apps-script/${source} =====`;
    assert.equal(built.split(marker).length - 1, 1, `${source} must appear exactly once`);
  }
  assert.equal((built.match(/function ensureReminderSheets_\s*\(/g) || []).length, 1);
});
