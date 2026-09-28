import { spawnSync } from 'node:child_process';

const commands = [
  ['Node/API/browser tests', ['--test']],
  ['Apps Script tests', ['scripts/test-apps-script.mjs']],
  ['Public bundle secret scan', ['scripts/check-public-bundle.mjs']],
  ['Apps Script production build', ['scripts/build-apps-script.mjs']],
];

for (const [label, args] of commands) {
  console.log(`\n[verify] ${label}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: process.cwd() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Verification completed successfully.');
