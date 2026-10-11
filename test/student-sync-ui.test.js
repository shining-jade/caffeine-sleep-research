import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/student-sync-ui.js', import.meta.url), 'utf8');
function setup(loaded, dashboard) {
  const listeners = {}; let statsUpdates = 0;
  const element = () => ({ style: {}, append() {}, setAttribute() {} });
  const window = { studentSync: { list: async () => [], read: async action => action === 'getWeightData' ? { success: true } : [] },
    addEventListener: (name, fn) => { listeners[name] = fn; }, StudentFeedback: { evaluate: () => ({}), setState() {} } };
  const context = vm.createContext({ window, document: { createElement: element, body: { prepend() {} } },
    user: { studentId: 'fiction', name: '가상' }, caffeineLogs: [], sleepLogs: [], caffeineHistoryLoaded: loaded,
    lastDashboardData: dashboard, setInterval() {}, applyWeightData() {}, renderCaffeineLogs() {}, renderSleepLogs() {},
    syncConfirmedCaffeineStats() { statsUpdates++; }, updateCaffeineBadge() {}, getTodayKST: () => '2026-10-11' });
  vm.runInContext(source, context);
  return { listeners, updates: () => statsUpdates };
}
test('sync snapshot events never start statistics refreshes before complete startup histories and graph data', async () => {
  for (const [loaded, dashboard, expected] of [[false, null, 0], [false, {}, 0], [true, null, 0], [true, {}, 1]]) {
    const x = setup(loaded, dashboard);
    x.listeners['student-sync-change']({ detail: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(x.updates(), expected);
  }
});
