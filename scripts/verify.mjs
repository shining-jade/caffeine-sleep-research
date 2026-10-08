import { spawnSync } from 'node:child_process';

const commands = [
  // Windows Node 24 can corrupt parallel test-worker IPC; run the same suite serially there.
  ['Node/API/browser tests', ['--test', ...(process.platform === 'win32' ? ['--test-concurrency=1'] : [])]],
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
