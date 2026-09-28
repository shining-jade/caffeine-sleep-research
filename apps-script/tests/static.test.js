import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
