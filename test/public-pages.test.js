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
  assert.match(html, /rel="manifest" href="\/public\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/public\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<script type="module" src="\/public\/js\/install-guide\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/public\/js\/push-reminders\.js"><\/script>/);
  assert.match(html, /id="installGuideBtn"[^>]*>[^<]*📲 앱 설치·알림 설정 방법/s);
  assert.match(html, /installGuide\.open/);
  assert.match(html, /카페인·수면 기록 알림 받기/);
  assert.match(html, /알림은 언제든 설정에서 끌 수 있어요\./);
  assert.match(html, /pushReminders\.initialize/);
});

test('teacher page is gated by server-side authentication before dashboard start', async () => {
  const html = await read('teacher/index.html');
  const auth = await read('public/js/teacher-auth.js');
  const safeRender = await read('public/js/safe-render.js');

  assert.match(html, /<html[^>]+data-app-role="teacher"/);
  assert.match(html, /<script src="\/public\/js\/api-bridge\.js"><\/script>/);
  assert.match(html, /<script src="\/public\/js\/teacher-auth\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/public\/js\/teacher-reminders\.js"><\/script>/);
  assert.match(html, /<script src="\/public\/js\/safe-render\.js"><\/script>/);
  assert.match(html, /window\.startTeacherApp\s*=/);
  assert.match(auth, /appAuth\.loginTeacher/);
  assert.match(auth, /appAuth\.getSession/);
  assert.match(auth, /startTeacherApp/);
  assert.match(auth, /location\.replace\('\/teacher'\)/);
  assert.match(html, /id="tab-reminders"/);
  assert.match(html, /선택한 시간대 안에서 발송될 수 있습니다/);
  assert.match(html, /어젯밤 수면 기록을 간단히 남겨보세요\./);
  assert.match(html, /오늘의 카페인 기록을 확인해 주세요\. 마시지 않았다면 ‘섭취 안 함’을 선택하면 돼요\./);
  assert.match(html, /테스트 학생 알림 확인/);
  assert.match(html, /teacherReminders\.sendTestStudent\('sleep'\)/);
  assert.match(html, /teacherReminders\.sendTestStudent\('caffeine'\)/);
  assert.doesNotMatch(html, /reminderStudentSelector|name="studentId"|name="subscriptionId"/);
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
