import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  }

  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stderr.write('\n');
    };
    const onData = (key) => {
      if (key === '\u0003') {
        cleanup();
        reject(new Error('Cancelled.'));
      } else if (key === '\r' || key === '\n') {
        cleanup();
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else {
        value += key;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = await readHidden('Teacher password: ');
if (password.length < 8) {
  process.stderr.write('Password must contain at least 8 characters.\n');
  process.exitCode = 1;
} else {
  const salt = randomBytes(16);
  const hash = Buffer.from(await scrypt(password, salt, 64));
  process.stdout.write(`TEACHER_PASSWORD_SALT=${salt.toString('hex')}\n`);
  process.stdout.write(`TEACHER_PASSWORD_HASH=${hash.toString('hex')}\n`);
}
