import { spawnSync } from 'node:child_process';

const commands = [
  ['--test'],
  ['scripts/test-apps-script.mjs'],
  ['scripts/check-public-bundle.mjs'],
  ['scripts/build-apps-script.mjs'],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: process.cwd() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Verification completed successfully.');
