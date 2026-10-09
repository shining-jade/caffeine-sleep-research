import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  return start < 0 ? '' : html.slice(start, html.indexOf('\n    }', start) + 6);
}
function setup() {
  const input = { value: '2000-01-07' }, range = { innerHTML: '', textContent: '' };
  const calls = [], displayed = [];
  const run = new Proxy({}, { get(_, name) {
    let success, failure;
    const chain = new Proxy({}, { get(_, method) {
      if (method === 'withSuccessHandler') return h => { success = h; return chain; };
      if (method === 'withFailureHandler') return h => { failure = h; return chain; };
      return (...args) => calls.push({ method, args, success, failure });
    } });
    return chain[name];
  } });
  const c = vm.createContext({ window: {}, Date, Promise, console,
    user: { studentId: 'fictional', name: '가상' }, lastDashboardData: null,
    getTodayKST: () => '2026-10-09', resetStudentAnalysis() {},
    document: { getElementById: id => id === 'filterEndDate' ? input : id === 'dateRangeText' ? range : null },
    google: { script: { run } }, updateDashboard(data, date) { displayed.push({ data, date }); c.lastDashboardData = { ...data, chartEndDate: date }; },
    cacheStudentRecords() {}, renderCaffeineLogs() {}, renderSleepLogs() {}, renderCharts() {}, applyWeightData() {}, changeSettingsAgeGroup() {}
  });
  vm.runInContext(['requestDashboardStats', 'applyDateFilter', 'refreshData', 'manualRefresh', 'applyStudentBootstrap'].map(extract).join('\n'), c);
  return { c, input, range, calls, displayed };
}

test('dashboard refresh preserves queried period while ignoring unsubmitted date draft', () => {
  const x = setup(); x.c.applyDateFilter(); x.calls[0].success({ todayTotal: 150 });
  x.input.value = '2000-02-07'; x.c.refreshData();
  assert.equal(x.calls[1].method, 'getFilteredStats');
  assert.equal(x.calls[1].args[1], '2000-01-07');
  x.calls[1].success({ todayTotal: 150 }); assert.equal(x.displayed.at(-1).date, '2000-01-07');
});
test('older query success and failure cannot overwrite latest queried range', () => {
  const x = setup(); x.c.applyDateFilter(); x.input.value = '2000-01-14'; x.c.applyDateFilter();
  x.calls[1].success({ todayTotal: 200 }); const before = x.range.textContent;
  x.calls[0].success({ todayTotal: 150 }); x.calls[0].failure(new Error('old failure'));
  assert.equal(x.displayed.length, 1); assert.equal(x.displayed[0].date, '2000-01-14'); assert.equal(x.range.textContent, before);
});
test('refresh during query requests same period and ignores slower original response', () => {
  const x = setup(); x.c.applyDateFilter(); x.c.refreshData();
  assert.equal(x.calls[1].args[1], '2000-01-07');
  x.calls[1].success({ todayTotal: 200 }); x.calls[0].success({ todayTotal: 150 });
  assert.equal(x.displayed.length, 1); assert.equal(x.displayed[0].data.todayTotal, 200);
});
test('manual refresh reads the committed dashboard range', () => {
  const x = setup(); x.c.applyDateFilter(); x.calls[0].success({ todayTotal: 150 }); x.c.manualRefresh();
  const stats = x.calls.slice(1).find(call => /Stats$/.test(call.method));
  assert.equal(stats.method, 'getFilteredStats'); assert.equal(stats.args[1], '2000-01-07');
});
test('late bootstrap cannot replace a queried period with current-day stats', () => {
  const x = setup(); x.c.applyDateFilter(); x.calls[0].success({ todayTotal: 150 });
  x.c.applyStudentBootstrap({ dashboardRequestId: 0, weight: {}, caffeineLogs: [], sleepLogs: [], stats: { todayTotal: 100 } });
  assert.equal(x.displayed.length, 1); assert.equal(x.calls.length, 1);
});
test('resume bootstrap refreshes an unchanged historical range once', () => {
  const x = setup(); x.c.applyDateFilter(); x.calls[0].success({ todayTotal: 150 });
  x.c.applyStudentBootstrap({ dashboardRequestId: 1, weight: {}, caffeineLogs: [], sleepLogs: [], stats: { todayTotal: 100 } });
  assert.equal(x.displayed.length, 1); assert.equal(x.calls.length, 2); assert.equal(x.calls[1].args[1], '2000-01-07');
});
test('initial bundled stats render without another statistics request', () => {
  const x = setup();
  x.c.applyStudentBootstrap({ dashboardRequestId: 0, weight: {}, caffeineLogs: [], sleepLogs: [], stats: { todayTotal: 100 } });
  assert.equal(x.displayed.length, 1); assert.equal(x.calls.length, 0);
});
test('dashboard request does not update a different signed-in student', () => {
  const x = setup(); x.c.applyDateFilter(); x.c.user = { studentId: 'another-fiction', name: '다른 가상' };
  x.calls[0].success({ todayTotal: 150 }); assert.equal(x.displayed.length, 0);
});
test('unfiltered refresh follows today after midnight instead of pinning yesterday', () => {
  const x = setup(); x.c.refreshData(); x.calls[0].success({ todayTotal: 100 });
  x.c.getTodayKST = () => '2026-10-10'; x.c.refreshData();
  assert.equal(x.calls[1].args[1], '2026-10-10');
});
test('student sleep graph fits long records with headroom', () => {
  const configs = []; const canvas = { getContext: () => ({}) };
  const c = vm.createContext({ userLimit: 150, caffeineChart: null, sleepChart: null,
    buildSleepDataByLifeDate: (_, values) => values,
    document: { getElementById: id => id.endsWith('Chart') ? canvas : null }, setTimeout() {},
    Chart: function(_, config) { configs.push(config); }
  });
  vm.runInContext(extract('renderCharts'), c);
  c.renderCharts({ labels: ['10/9'], caffeineData: [0], caffeineHasData: [true], sleepData: [16] });
  assert.ok(configs[1].options.scales.y.max > 16); assert.equal(configs[1].data.datasets[0].data[0], 16);
});
test('sleep graph uses committed chart year across New Year and ignores picker drafts', () => {
  const c = vm.createContext({ Date, lastDashboardData: { chartEndDate: '2026-01-02' },
    document: { getElementById: () => ({ value: '2030-01-02' }) }, getTodayKST: () => '2026-10-09',
    sleepLogs: [{ date: '2025-12-31', hours: 16 }, { date: '2026-01-01', hours: 8 }],
    getSleepLifeDate: log => log.date, compareSleepLogsByEndDesc: () => 0
  });
  vm.runInContext(['labelToISODate', 'buildSleepDataByLifeDate'].map(extract).join('\n'), c);
  assert.deepEqual(Array.from(c.buildSleepDataByLifeDate(['12/31', '01/01', '01/02'], [], '2026-01-02')), [16, 8, 0]);
});
