import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.NODE_TEST_CONTEXT) process.exit(0);

const marker = process.argv.indexOf('--test');
const requested = marker >= 0 ? process.argv.slice(marker + 1) : [];
const tests = requested.length
  ? requested
  : readdirSync(resolve('apps-script', 'tests'))
      .filter((name) => name.endsWith('.test.js'))
      .map((name) => resolve('apps-script', 'tests', name));

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
