const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { root, makeSummaryFixture } = require('./fixtures/summary-report.cjs');

test('reflection uses natural recorded-day wording and a concrete action', () => {
  const result = makeSummaryFixture().feedback.engine.summaryReflection;
  assert.match(result.rule.praise, /기록한 5일 모두 지켰어요/);
  assert.match(result.rule.difficulty, /기록한 6일 중 2일 지켰어요/);
  assert.match(result.rule.plan, /10\.31 밤처럼 23시 21분쯤 누워 보기/);
  assert.doesNotMatch(result.rule.plan, /다음 계획에 참고/);
});

test('delivery uses raw PDF bytes as base64, preserves identity and period, and enforces the 3 MiB cap', () => {
  const env = vm.createContext({ window: {}, btoa, Uint8Array });
  vm.runInContext(fs.readFileSync(path.join(root, 'vercel/public/js/teacher-report-export.js'), 'utf8'), env);
  const build = env.window.teacherReportExport.deliveryRequest;
  const report = makeSummaryFixture();
  report.student.학번 = '0';
  const bytes = new Uint8Array(Buffer.from('%PDF-1.4\nsynthetic'));
  const delivery = build(report, { name: '가상.pdf', bytes }, 'fixture-delivery');
  assert.equal(delivery.studentId, '0');
  assert.equal(delivery.start, report.start);
  assert.equal(delivery.deliveryId, 'fixture-delivery');
  assert.equal(delivery.fileName, '가상.pdf');
  assert.deepEqual(Buffer.from(delivery.pdf, 'base64'), Buffer.from(bytes));
  assert.ok(!Object.hasOwn(delivery, 'html'));
  assert.throws(() => build(report, { name: '가상.pdf', bytes: bytes.subarray(1) }, 'fixture-delivery'), /PDF 형식/);
  const big = new Uint8Array(3 * 1024 * 1024 + 1);
  big.set(bytes);
  assert.throws(() => build(report, { name: '가상.pdf', bytes: big }, 'fixture-delivery'), /3MB/);
});
