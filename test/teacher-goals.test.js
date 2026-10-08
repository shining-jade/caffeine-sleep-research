import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../teacher/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function getPersonalInfo('), html.indexOf('function getTargetSleepText('));
function setup(infoData) {
  const context = vm.createContext({ infoData, getLimit: () => 150 });
  vm.runInContext(source, context);
  return context;
}
test('missing or empty personal goals do not become the default 150mg', () => {
  for (const records of [[], [{ 학번: '2101', 몸무게: 60 }], [{ 학번: '2101', 목표카페인: null }]]) {
    const ctx = setup(records);
    assert.equal(ctx.getTargetCafText('2101'), '미설정');
    assert.equal(ctx.getTargetCafLimit('2101'), null);
  }
});
test('saved personal goal is used even when the general limit differs', () => {
  const ctx = setup([{ 학번: '2101', 목표카페인: 80 }]);
  assert.equal(ctx.getTargetCafText('2101'), '80mg');
  assert.equal(ctx.getTargetCafLimit('2101'), 80);
});
