import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('student page uses the same-origin secure bridge and server session auth', async () => {
  const html = await read('index.html');

  assert.match(html, /<html[^>]+data-app-role="student"/);
  assert.match(html, /<script src="\/public\/js\/api-bridge\.js"><\/script>/);
  assert.match(html, /appAuth\.loginStudent/);
  assert.match(html, /appAuth\.getSession/);
  assert.match(html, /appAuth\.logout/);
});

test('teacher page is gated by server-side authentication before dashboard start', async () => {
  const html = await read('teacher/index.html');
  const auth = await read('public/js/teacher-auth.js');
  const safeRender = await read('public/js/safe-render.js');

  assert.match(html, /<html[^>]+data-app-role="teacher"/);
  assert.match(html, /<script src="\/public\/js\/api-bridge\.js"><\/script>/);
  assert.match(html, /<script src="\/public\/js\/teacher-auth\.js"><\/script>/);
  assert.match(html, /<script src="\/public\/js\/safe-render\.js"><\/script>/);
  assert.match(html, /window\.startTeacherApp\s*=/);
  assert.match(auth, /appAuth\.loginTeacher/);
  assert.match(auth, /appAuth\.getSession/);
  assert.match(auth, /startTeacherApp/);
  assert.match(auth, /location\.replace\('\/teacher'\)/);
  assert.match(safeRender, /escapeHtml/);
  assert.match(safeRender, /sanitizeRichHtml/);
});

test('teacher renders student-controlled fields through safe render helpers', async () => {
  const html = await read('teacher/index.html');
  assert.doesNotMatch(html, /\$\{r\.메모\}|\$\{r\.이유\}|\$\{item\.content\}|\$\{item\.title\}/);
  assert.match(html, /safeRender\.escapeHtml/);
  assert.match(html, /safeRender\.sanitizeRichHtml/);
});

test('public pages contain no Apps Script deployment address or secret configuration', async () => {
  const files = [
    await read('index.html'),
    await read('teacher/index.html'),
    await read('public/js/api-bridge.js'),
  ];
  const combined = files.join('\n');

  assert.doesNotMatch(combined, /script\.google\.com\/macros\/s\//);
  assert.doesNotMatch(combined, /GAS_API_URL/);
  assert.doesNotMatch(combined, /SPREADSHEET_ID|TEACHER_PASSWORD|SHARED_SECRET/);
});

test('Vercel routes the public student and teacher URLs to their HTML entry points', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const routes = new Map((config.rewrites || []).map(({ source, destination }) => [source, destination]));

  assert.equal(config.outputDirectory, '.');
  assert.equal(routes.get('/'), '/index.html');
  assert.equal(routes.get('/teacher'), '/teacher/index.html');
});
