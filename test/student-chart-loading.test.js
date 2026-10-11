import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadStudentBootstrap } from '../public/js/student-startup.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  return start < 0 ? '' : html.slice(start, html.indexOf('\n    }', start) + 6);
}
function setup() {
  const elements = {}, calls = [];
  for (const kind of ['caffeine', 'sleep']) {
    elements[kind + 'ChartStatus'] = { hidden: false, textContent: '' };
    elements[kind + 'ChartRegion'] = { setAttribute(key, value) { this[key] = value; } };
  }
  const run = { withSuccessHandler(success) {
    return { withFailureHandler(failure) {
      return { getFilteredStats: (...args) => calls.push({ success, failure, args }),
        getStudentBootstrap: (...args) => calls.push({ success, failure, args }) };
    } };
  } };
  const c = vm.createContext({ window: { studentStartup: { loadStudentBootstrap } },
    user: { studentId: 'fictional', name: '가상' }, userLimit: 150, lastDashboardData: null,
    document: { getElementById: id => elements[id] || null }, google: { script: { run } },
    getTodayKST: () => '2026-10-11', renderCharts() {}, changeSettingsAgeGroup() {},
    applyWeightData() {}, cacheStudentRecords() {}, renderCaffeineLogs() {}, renderSleepLogs() {},
    loadLegacyStudentData() {}, refreshData() {},
  });
  vm.runInContext(['setDashboardChartState', 'requestDashboardStats', 'updateDashboard',
    'requestStudentBootstrap', 'applyStudentBootstrap', 'loadInitialStudentData'].map(extract).join('\n'), c);
  return { c, elements, calls };
}
function statuses(x) { return ['caffeine', 'sleep'].map(kind => x.elements[kind + 'ChartStatus']); }

test('initial pending query shows chart loading; successful empty records finish loading', async () => {
  const x = setup(), pending = x.c.requestDashboardStats('2026-10-11');
  assert.ok(statuses(x).every(el => !el.hidden && /불러오는 중/.test(el.textContent)));
  assert.equal(x.elements.caffeineChartRegion['aria-busy'], 'true');
  x.calls[0].success({ labels: ['10/11'], caffeineData: [0], sleepData: [0] });
  assert.equal(await pending, true);
  assert.ok(statuses(x).every(el => el.hidden));
  assert.equal(x.elements.sleepChartRegion['aria-busy'], 'false');
});

test('initial failure stops loading and retry restores the chart', async () => {
  const x = setup(), first = x.c.requestDashboardStats('2026-10-11');
  x.calls[0].failure(); await first;
  assert.ok(statuses(x).every(el => !el.hidden && /불러오지 못/.test(el.textContent)));
  assert.equal(x.elements.sleepChartRegion['aria-busy'], 'false');
  const retry = x.c.requestDashboardStats('2026-10-11');
  assert.ok(statuses(x).every(el => /불러오는 중/.test(el.textContent)));
  x.calls[1].success({ labels: ['10/11'] }); await retry;
  assert.ok(statuses(x).every(el => el.hidden));
});

test('older success or failure cannot dismiss or replace the latest query loading state', async () => {
  const x = setup(), old = x.c.requestDashboardStats('2026-10-10');
  const latest = x.c.requestDashboardStats('2026-10-11');
  x.calls[0].success({ labels: ['10/10'] }); x.calls[0].failure(); await old;
  assert.ok(statuses(x).every(el => !el.hidden && /불러오는 중/.test(el.textContent)));
  x.calls[1].success({ labels: ['10/11'] }); await latest;
  assert.ok(statuses(x).every(el => el.hidden));
});

test('refresh and refresh failure preserve already displayed graphs', async () => {
  const x = setup(); x.c.updateDashboard({ labels: ['10/11'] });
  const next = x.c.requestDashboardStats('2026-10-11');
  assert.ok(statuses(x).every(el => el.hidden));
  x.calls[0].failure(); await next;
  assert.ok(statuses(x).every(el => el.hidden));
});

test('bundled startup displays loading until bootstrap statistics render', async () => {
  const x = setup(), pending = x.c.loadInitialStudentData();
  assert.ok(statuses(x).every(el => !el.hidden && /불러오는 중/.test(el.textContent)));
  x.calls[0].success({ weight: {}, caffeineLogs: [], sleepLogs: [], stats: { labels: ['10/11'] } });
  assert.equal(await pending, true);
  assert.ok(statuses(x).every(el => el.hidden));
});
