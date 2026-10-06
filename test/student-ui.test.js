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

test('immediate caffeine guidance distinguishes pending from confirmed storage', () => {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { style: {}, querySelector: () => ({}) });
    return elements.get(id);
  } };
  const logs = [{ amount: 50, time: 'today' }];
  const context = vm.createContext({ document, caffeineLogs: logs, userLimit: 150,
    user: { name: '테스트' }, getTodayKST: () => 'today', getLogDateKST: x => x, setTimeout() {} });
  vm.runInContext(extract('showCaffeineWarning') + "\nshowCaffeineWarning(30, 80, 'pending');", context);
  assert.match(elements.get('warningInfo').innerText, /서버에 저장 중/);
  assert.match(elements.get('warningInfo').innerText, /예상 합계 80mg/);
  assert.doesNotMatch(elements.get('warningInfo').innerText, /저장 완료/);
  assert.equal(logs.length, 1);
  vm.runInContext("showCaffeineWarning(30, 80, 'confirmed');", context);
  assert.match(elements.get('warningInfo').innerText, /서버 저장 완료/);
  assert.doesNotMatch(elements.get('warningInfo').innerText, /예상 합계/);
});

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
    caffeineLogs: [1], confirmedPendingCaffeine: [{ amount: 100 }], sleepLogs: [2], teacherAwards: [3], lastDashboardData: { private: true },
    caffeineChart: null, sleepChart: null, userWeight: 55, userLimit: 137.5,
    sleepChoices: {}, pendingDelete: {}, editingId: 'old', editingType: 'sleep',
    caffeineDbLoading: true, stopAutoRefresh() {},
    SLEEP_CFG: {},
  });
  vm.runInContext(extract('resetStudentData') + '\nresetStudentData();', context);
  assert.equal(container.innerHTML, '');
  assert.equal(field.value, '');
  assert.equal(context.caffeineLogs.length, 0);
  assert.equal(context.confirmedPendingCaffeine.length, 0);
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

test('confirmed deletion removes only the matching record and renders without waiting for a read', () => {
  let rendered=0,cached=0;
  const context=vm.createContext({caffeineLogs:[{id:'a'},{id:'b'}],sleepLogs:[{id:'a'}],renderCaffeineLogs(){rendered++;},renderSleepLogs(){},cacheStudentRecords(){cached++;},updateCaffeineBadge(){}});
  vm.runInContext(extract('applyConfirmedDeletion')+"\napplyConfirmedDeletion('caffeine','a');",context);
  assert.equal(context.caffeineLogs.length,1); assert.equal(context.caffeineLogs[0].id,'b'); assert.equal(context.sleepLogs.length,1);
  assert.equal(rendered,1); assert.equal(cached,1);
});
test('caffeine save feedback does not wait for a second history request', () => {
  const submit=extract('submitCaffeine');
  assert.ok(submit.includes('showCaffeineWarning(amount,'));
  assert.ok(!submit.includes('loadCaffeineLogs(amount)'));
  assert.ok(!submit.includes('caffeineLogs.push(newLog)'));
});

test('background polling checks notifications without reloading record histories', () => {
  const calls=[];
  const context=vm.createContext({user:{studentId:'0'},document:{hidden:false},lastRefreshTime:0,Date,checkReplyBubble(){calls.push('reply');},checkTeacherAwards(){calls.push('badge');},checkMsgBubble(){calls.push('message');}});
  vm.runInContext(extract('silentRefresh')+'\nsilentRefresh();',context);
  assert.deepEqual(calls,['reply','badge','message']);
});

test('all inline student scripts parse before deployment', () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/type="(?:module|application\/)/.test(match[1])) new vm.Script(match[2]);
  }
});

test('consecutive confirmed caffeine saves include both amounts before history returns', () => {
  const submit=extract('submitCaffeine');
  const start=submit.indexOf('.withSuccessHandler((response) => {')+'.withSuccessHandler('.length;
  const end=submit.indexOf('\n        .withFailureHandler',start);
  const callback=submit.slice(start,end).trim().slice(0,-1);
  const totals=[];
  const context=vm.createContext({btn:null,pendingCaffeineSave:null,applyConfirmedCaffeineSave:()=>false,renderCaffeineLogs(){},document:{getElementById:()=>({value:'',classList:{add(){}}}),querySelectorAll:()=>[]},selectedDrink:null,time:'today',amount:30,caffeineLogs:[{time:'today',amount:50}],confirmedPendingCaffeine:[],getLogDateKST:x=>x,getTodayKST:()=> 'today',showCaffeineWarning:(_amount,total)=>totals.push(total),loadCaffeineLogs(){},refreshData(){},showSaveCompleteModal(){}});
  vm.runInContext('const saved='+callback+';saved();saved();',context);
  assert.deepEqual(totals,[80,110]);
});

test('confirmed save renders the trusted record immediately without needing a history request', () => {
  let rendered=0,cached=0;
  const context=vm.createContext({caffeineLogs:[],cacheStudentRecords(){cached++;},renderCaffeineLogs(){rendered++;}});
  vm.runInContext(extract('applyConfirmedCaffeineSave'),context);
  assert.equal(context.applyConfirmedCaffeineSave({record:{id:'server-id',name:'커피',amount:40,time:'2026-10-06T13:00'}}),true);
  assert.equal(context.caffeineLogs[0].id,'server-id');assert.equal(rendered,1);assert.equal(cached,1);
  assert.equal(context.applyConfirmedCaffeineSave({success:true}),false);
});
