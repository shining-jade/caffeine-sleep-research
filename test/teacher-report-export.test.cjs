const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { root, makeSummaryFixture } = require('./fixtures/summary-report.cjs');

test('reflection uses natural recorded-day wording and a concrete action', () => {
  const result = makeSummaryFixture().feedback.engine.summaryReflection;
  assert.match(result.rule.praise, /기록한 5일 모두 지켰습니다/);
  assert.match(result.rule.difficulty, /6일 중 5일입니다/);
  assert.match(result.rule.plan, /10\.30 밤처럼 23시쯤 잠자리에 드는 것부터 해 볼까요\?/);
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

test('exports two images when 29 caffeine intakes are represented as charts', async () => {
  const report = makeSummaryFixture({ length:30, editDays(days) {
    days.forEach(day => {
      day.caffeine = { recorded:true, totalMg:40, intakes:[{ drink:'가상 음료', mg:40, time:'15:00' }] };
    });
  } });
  const captured = [];
  const frame = { style:{}, setAttribute(){}, remove(){}, contentDocument:{
    fonts:{ ready:Promise.resolve() },
    open(){}, close(){},
    write(html){
      this.pages = [...html.matchAll(/<article class="summary-page"[\s>]/g)].map(() => ({
        dataset:{}, scrollHeight:1123, querySelector:() => null,
      }));
      assert.match(html, /섭취 29번/);
      assert.equal((html.match(/data-caffeine-card=/g) || []).length, 4);
      assert.doesNotMatch(html, /class="summary-scroll summary-intakes"/);
    },
    querySelectorAll(){ return this.pages; },
  } };
  const window = {};
  const document = {
    body:{ append(){} },
    head:{ append(script) {
      window.html2canvas = async (page, options) => {
        captured.push(options.height);
        return { width:1588, height:2246, toBlob:callback => callback(new Blob(['fake jpeg'], { type:'image/jpeg' })) };
      };
      window.jspdf = { jsPDF:{ version:'4.2.1' } };
      script.load();
    } },
    createElement(tag) {
      return tag === 'iframe' ? frame : { addEventListener(type, callback) { this[type] = callback; } };
    },
  };
  const env = vm.createContext({ window, document, Uint8Array });
  for (const file of ['teacher-report-files.js', 'teacher-report-export.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'vercel/public/js', file), 'utf8'), env);
  }
  const images = await window.teacherReportExport.prepare(report, 'images');
  assert.equal(images.length, 2);
  assert.deepEqual(captured, [1123, 1123]);
  assert.match(images[1].name, /_2쪽\.jpg$/);
});
