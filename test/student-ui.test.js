import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf('\n    }', start) + 6;
  return html.slice(start, end);
}

test('opening DB search loads the database without a previous cache', () => {
  let loads = 0;
  const panel = { classList: { contains: () => true, toggle() {} } };
  const context = vm.createContext({
    document: { getElementById: id => id === 'dbSearchPanel' ? panel : null },
    loadCaffeineDbFromGAS: () => loads++,
  });
  vm.runInContext(extract('toggleDbSearch') + '\ntoggleDbSearch();', context);
  assert.equal(loads, 1);
});

test('weight field does not display a fabricated default before profile loading', () => {
  const field = html.match(/<input[^>]+id="userWeight"[^>]*>/)[0];
  assert.doesNotMatch(field, /value="60"/);
  assert.match(field, /placeholder="불러오는 중/);
});

test('DB load completion reruns the current query', () => {
  let success;
  const queries = [];
  const elements = { dbTotalCount: {}, dbSearchInput: { value: '아메리카노' } };
  const runner = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler() { return this; }, getCaffeineDB() {},
  };
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    localStorage: { getItem: () => null, setItem() {} },
    google: { script: { run: runner } }, console,
    CAFFEINE_DB: [], caffeineDbLoading: false,
    searchCaffeineDb: query => queries.push(query),
  });
  vm.runInContext(extract('loadCaffeineDbFromGAS') + '\nloadCaffeineDbFromGAS();', context);
  success({ success: true, data: [{ f: '아메리카노', mg: 100 }] });
  assert.deepEqual(queries, ['아메리카노']);
});

test('public DB remains searchable when the live Google request fails', async () => {
  let fail;
  const elements = { dbTotalCount: {}, dbSearchInput: { value: '아메리카노' } };
  const runner = {
    withSuccessHandler() { return this; },
    withFailureHandler(handler) { fail = handler; return this; }, getCaffeineDB() {},
  };
  const queries = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    localStorage: { getItem: () => null, setItem() {} },
    google: { script: { run: runner } }, console: { error() {} },
    fetch: async () => ({ ok: true, json: async () => [{ f: '아메리카노', mg: 100 }] }),
    CAFFEINE_DB: [], caffeineDbLoading: false,
    searchCaffeineDb: query => queries.push(query),
  });
  vm.runInContext(extract('loadCaffeineDbFromGAS') + '\nloadCaffeineDbFromGAS();', context);
  await new Promise(resolve => setImmediate(resolve));
  fail(new Error('GAS_TIMEOUT'));
  assert.equal(context.CAFFEINE_DB.length, 1);
  assert.equal(elements.dbTotalCount.textContent, '1건');
  assert.equal(context.caffeineDbLoading, false);
  assert.deepEqual(queries, ['아메리카노', '아메리카노']);
});

test('session reset clears previous student records, settings and rendered private content', () => {
  const container = { innerHTML: 'previous student inquiry', className: 'changed', style: { cssText: 'display:block' } };
  const field = { value: 'previous student weight', checked: true, disabled: false };
  const context = vm.createContext({
    window: { _weightLoaded: true, currentAIAnalysis: 'private report' },
    document: { getElementById: id => id === 'myInquiriesContainer' ? container : null },
    privateUiDefaults: [{ id: 'myInquiriesContainer', html: '', className: 'initial', style: '' }],
    privateFormDefaults: [{ element: field, value: '', checked: false, disabled: true }],
    caffeineLogs: [1], sleepLogs: [2], teacherAwards: [3], lastDashboardData: { private: true },
    caffeineChart: null, sleepChart: null, userWeight: 55, userLimit: 137.5,
    sleepChoices: {}, pendingDelete: {}, editingId: 'old', editingType: 'sleep',
    caffeineDbLoading: true, stopAutoRefresh() {},
    SLEEP_CFG: {},
  });
  vm.runInContext(extract('resetStudentData') + '\nresetStudentData();', context);
  assert.equal(container.innerHTML, '');
  assert.equal(field.value, '');
  assert.equal(context.caffeineLogs.length, 0);
  assert.equal(context.sleepLogs.length, 0);
  assert.equal(context.teacherAwards.length, 0);
  assert.equal(context.lastDashboardData, null);
  assert.equal(context.window._weightLoaded, false);
});

for (const kind of ['Caffeine', 'Sleep']) {
  test(`${kind} read failure preserves records instead of reporting an empty history`, () => {
    let fail;
    const runner = { withSuccessHandler() { return this; }, withFailureHandler(fn) { fail = fn; return this; }, getCaffeineLogs() {}, getSleepLogs() {} };
    const context = vm.createContext({ user: { studentId: '0', name: '테스트' }, caffeineLogs: [{ id: 'saved' }], sleepLogs: [{ id: 'saved' }], google: { script: { run: runner } }, renderCaffeineLogs() {}, renderSleepLogs() {}, lastDashboardData: null, showRecordConnectionError() {}, cacheStudentRecords() {}, showCaffeineWarning() {} });
    vm.runInContext(extract(`load${kind}Logs`) + `\nload${kind}Logs();`, context);
    fail(new Error('GAS_UNAVAILABLE'));
    assert.equal(context[kind === 'Caffeine' ? 'caffeineLogs' : 'sleepLogs'].length, 1);
  });
}

test('automatic refresh waits two minutes and skips hidden pages', () => {
  let callback, period, reads=0;
  const context=vm.createContext({stopAutoRefresh(){},setInterval(fn,ms){callback=fn;period=ms;return 1;},silentRefresh(){reads++;},document:{hidden:true},autoRefreshInterval:null});
  vm.runInContext(extract('startAutoRefresh')+'\nstartAutoRefresh();',context);
  assert.equal(period,120000);
  callback(); assert.equal(reads,0);
  context.document.hidden=false; callback(); assert.equal(reads,1);
});
test('app version checks never create an update announcement', () => {
  const context=vm.createContext({document:{lastModified:'new',createElement(){assert.fail('update toast');}},localStorage:{getItem:()=> 'old',setItem(){}}});
  vm.runInContext(extract('checkAppVersion')+'\ncheckAppVersion();',context);
  assert.doesNotMatch(html,/앱이 업데이트 되었습니다/);
});
