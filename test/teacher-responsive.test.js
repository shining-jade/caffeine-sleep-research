import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('teacher header tools and logout stay in the responsive header flow', async () => {
  const html = await read('teacher/index.html');
  const auth = await read('public/js/teacher-auth.js');

  assert.match(html, /class="header-right header-actions"/);
  assert.match(html, /class="refresh-settings"/);
  assert.match(auth, /querySelector\(['"]\.header-actions['"]\)/);
  assert.match(auth, /logoutHost\.appendChild\(button\)/);
  assert.doesNotMatch(auth, /#teacherSecureLogout\{position:fixed/);
});

test('teacher mobile breakpoints hide zoom and keep tabs touchable and horizontally contained', async () => {
  const html = await read('teacher/index.html');

  assert.match(html, /@media\(max-width:768px\)[\s\S]*?\.zoom-box\{display:none/);
  assert.match(html, /\.tab-nav\{[^}]*overflow-x:auto[^}]*scroll-snap-type:x mandatory/);
  assert.match(html, /\.tab-button\{[^}]*flex:0 0 auto[^}]*min-height:44px/);
  assert.match(html, /@media\(max-width:480px\)/);
  assert.match(html, /\.header-actions\{[^}]*grid-template-columns:1fr/);
  assert.match(html, /if\(isMobile\(\)\)\{[\s\S]*?document\.body\.style\.zoom='100%'/);
  assert.doesNotMatch(html, /document\.documentElement\.style\.fontSize=\(v\/100\*16\)/);
});

test('wide teacher content uses local scroll regions and mobile card rows', async () => {
  const html = await read('teacher/index.html');

  assert.ok((html.match(/class="responsive-table-wrap"/g) || []).length >= 4);
  assert.match(html, /\.responsive-table-wrap\{[^}]*max-width:100%[^}]*overflow-x:auto/);
  assert.match(html, /\.reminder-period-table thead,\.journey-schedule-table thead\{display:none/);
  assert.match(html, /data-label="시작일"/);
  assert.match(html, /data-label="전체 시작"/);
  assert.match(html, /\.chart-card,\.settings-card,\.student-card\{min-width:0/);
  assert.match(html, /\.settings-input[^}]*width:100%/);
});

test('mobile controls stack without shrinking labels or forcing page overflow', async () => {
  const html = await read('teacher/index.html');

  assert.match(html, /\.header-actions\{[^}]*width:100%[^}]*display:grid/);
  assert.match(html, /#refreshBtn,#teacherSecureLogout\{[^}]*width:100%/);
  assert.match(html, /\.award-setting-row\{[^}]*flex-wrap:wrap/);
  assert.match(html, /\.analysis-dropdown-menu\{[^}]*max-width:calc\(100vw - 28px\)/);
  assert.match(html, /\.tab-content,\.filter-bar,\.chart-grid,\.settings-grid,\.student-grid\{min-width:0/);
});
