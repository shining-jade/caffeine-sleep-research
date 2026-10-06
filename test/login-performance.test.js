import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('login reads only name and ID columns and validates both on every attempt', () => {
  let rows = [['학생A', 1101], ['학생B', 1102]];
  let reads = 0;
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange(row, col, height, width) {
      assert.deepEqual([row, col, height, width], [2, 4, 2, 2]);
      reads++;
      return { getValues: () => rows };
    },
    getDataRange() { assert.fail('Full roster range must not be loaded'); },
  };
  const context = vm.createContext({ getSpreadsheet_: () => ({ getSheetByName: () => sheet }), safeLog_() {} });
  vm.runInContext(extract('normalizeId') + '\n' + extract('checkLogin'), context);
  assert.equal(vm.runInContext("checkLogin('1101', '학생A').success", context), true);
  assert.equal(vm.runInContext("checkLogin('1101', '학생B').success", context), false);
  rows = [['변경학생', 1101], ['학생B', 1102]];
  assert.equal(vm.runInContext("checkLogin('1101', '학생A').success", context), false);
  assert.equal(reads, 3);
});
