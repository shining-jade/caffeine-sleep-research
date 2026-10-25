import {SleepRecordPolicy} from './support/sleep-policy.js';
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
  const c = vm.createContext({SleepRecordPolicy, window: { studentStartup: { loadStudentBootstrap } },
    user: { studentId: 'fictional', name: '가상' }, userLimit: 150, lastDashboardData: null, caffeineLogs: [], sleepLogs: [],
    document: { getElementById: id => elements[id] || null }, google: { script: { run } },
    getTodayKST: () => '2026-10-11', renderCharts() {}, changeSettingsAgeGroup() {},
    applyWeightData() {}, cacheStudentRecords() {}, renderCaffeineLogs() {}, renderSleepLogs() {},
    loadLegacyStudentData() {}, refreshData() {},
  });
  vm.runInContext(['setDashboardChartState', 'requestDashboardStats', 'updateDashboard',
    'requestStudentBootstrap', 'applyStudentBootstrap', 'restoreCachedStudentDashboard', 'loadInitialStudentData'].map(extract).join('\n'), c);
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

const bundle = (total = 60) => ({ weight: { success: true, weight: 60 },
  caffeineLogs: [], sleepLogs: [], stats: { todayTotal: total, labels: ['10/11'], chartEndDate: '2026-10-11', localStats: true } });

test('startup shows device graphs before the server bootstrap finishes, then uses fresh totals', async () => {
  const x = setup();
  x.elements.dateRangeText = {};
  x.c.window.studentSync = { read: async action => action === 'getStudentBootstrap' ? bundle() : bundle().stats };
  const pending = x.c.loadInitialStudentData();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.calls.length, 1);
  assert.equal(x.c.lastDashboardData.todayTotal, 60);
  assert.ok(statuses(x).every(el => el.hidden));
  assert.match(x.elements.dateRangeText.textContent, /기기 저장본.*최신/);
  x.calls[0].success({ ...bundle(90), stats: { ...bundle(90).stats, localStats: false } });
  await pending;
  assert.equal(x.c.lastDashboardData.todayTotal, 90);
  assert.doesNotMatch(x.elements.dateRangeText.textContent, /기기 저장본/);
});

test('startup reuses an in-flight bootstrap rather than issuing it twice', async () => {
  const x = setup();
  const first = x.c.loadInitialStudentData(), second = x.c.loadInitialStudentData();
  assert.equal(x.calls.length, 1);
  assert.equal(first, second);
  x.calls[0].success(bundle()); await first;
  assert.equal(x.c.window.studentBootstrapPending, null);
});

test('cached statistics cannot repaint after a newer server response or an account change', async () => {
  for (const change of ['server', 'account', 'range']) {
    const x = setup(); let resolveCache;
    const cache = new Promise(resolve => { resolveCache = resolve; });
    x.c.window.studentSync = { read: action => action === 'getStudentBootstrap' ? cache : Promise.resolve(bundle().stats) };
    const restoring = x.c.restoreCachedStudentDashboard();
    if (change === 'server') x.c.updateDashboard({ todayTotal: 90 });
    if (change === 'account') x.c.user = { studentId: 'other', name: '다른 학생' };
    if (change === 'range') x.c.window.studentDashboardRequestId = 1;
    resolveCache(bundle()); await restoring;
    assert.equal(x.c.lastDashboardData?.todayTotal, change === 'server' ? 90 : undefined);
  }
});

test('bootstrap cache is used only when rebuilt for the requested full date', async () => {
  for (const stats of [bundle().stats, { ...bundle().stats, chartEndDate: '2025-10-11' }, { todayTotal: 60, labels: ['10/11'] }]) {
    const x = setup();
    x.c.window.studentSync = { read: async action => {
      if (action === 'getFilteredStats') throw new Error('no dated snapshot');
      return { ...bundle(), stats };
    } };
    await x.c.restoreCachedStudentDashboard();
    assert.equal(!!x.c.lastDashboardData, stats.chartEndDate === '2026-10-11');
  }
});

test('dashboard tab reuses startup today read but still requests a selected historical range', () => {
  const x = setup(); let refreshes = 0;
  const element = { classList: { add() {}, remove() {} } };
  x.c.document.querySelectorAll = () => [];
  x.c.document.getElementById = () => element;
  x.c.window.scrollTo = () => {};
  x.c.saveCurrentTab = () => {};
  x.c.refreshData = () => { refreshes++; };
  vm.runInContext(extract('showTab'), x.c);
  x.c.window.studentBootstrapPending = Promise.resolve();
  x.c.showTab('dashboard'); assert.equal(refreshes, 0);
  x.c.window.studentDashboardEndDate = '2026-10-10';
  x.c.showTab('dashboard'); assert.equal(refreshes, 1);
  x.c.window.studentBootstrapPending = null;
  x.c.window.studentDashboardEndDate = null;
  x.c.showTab('dashboard'); assert.equal(refreshes, 2);
});

test('missing device cache preserves loading and never prevents the fresh server request', async () => {
  const x = setup();
  x.c.window.studentSync = { read: async () => { throw new Error('OFFLINE_CACHE_MISSING'); } };
  const pending = x.c.loadInitialStudentData();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(statuses(x).every(el => !el.hidden));
  assert.equal(x.calls.length, 1);
  x.calls[0].success(bundle()); await pending;
  assert.ok(statuses(x).every(el => el.hidden));
});

test('slow cached stats cannot replace histories or profile that refreshed while opening another tab', async () => {
  const x = setup(); let resolveStats, profileApplications = 0;
  x.c.applyWeightData = () => { profileApplications++; };
  x.c.window.studentSync = { read: action => action === 'getStudentBootstrap'
    ? Promise.resolve({ ...bundle(), caffeineLogs: [{ id: 'old' }], sleepLogs: [{ id: 'old' }],
        sleepSettings: { success: true, settings: { ageGroup: 'teen', sleepWarn: 8 } } })
    : new Promise(resolve => { resolveStats = resolve; }) };
  const restoring = x.c.restoreCachedStudentDashboard();
  x.c.caffeineLogs = [{ id: 'fresh-caffeine' }];
  x.c.sleepLogs = [{ id: 'fresh-sleep' }];
  x.c.window.studentSyncProfile = { weight: 70, ageGroup: 'adult' };
  x.c.SLEEP_CFG = { ageGroup: 'adult', sleepWarn: 7 };
  resolveStats(bundle().stats); await restoring;
  assert.equal(x.c.caffeineLogs[0].id, 'fresh-caffeine');
  assert.equal(x.c.sleepLogs[0].id, 'fresh-sleep');
  assert.equal(profileApplications, 0);
  assert.equal(x.c.SLEEP_CFG.ageGroup, 'adult');
  assert.equal(x.c.SLEEP_CFG.sleepWarn, 7);
});

test('cached restoration retains a newly appended confirmed record', async () => {
  const x = setup(); let resolveStats;
  x.c.window.studentSync = { read: action => action === 'getStudentBootstrap'
    ? Promise.resolve({ ...bundle(), caffeineLogs: [] }) : new Promise(resolve => { resolveStats = resolve; }) };
  const restoring = x.c.restoreCachedStudentDashboard();
  x.c.caffeineLogs.push({ id: 'just-saved' });
  resolveStats(bundle().stats); await restoring;
  assert.equal(x.c.caffeineLogs[0].id, 'just-saved');
});
