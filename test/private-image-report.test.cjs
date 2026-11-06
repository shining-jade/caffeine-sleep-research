const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { after, test } = require('node:test');
const vm = require('node:vm');

const now = () => 1000;
const limit = 3 * 1024 * 1024;
const fixturePdf = Buffer.from('%PDF-1.4\nsynthetic header fixture\n%%EOF\n');
const owner = { studentId: 'fixture-owner', name: '테스트 학생' };
const other = { studentId: 'fixture-other', name: '가상 학생' };
const previousSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = 'local-test-fixture-only';
after(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

function fakeGas({ append = 'normal', sharing = 'private' } = {}) {
  const rows = [Array(13).fill('')];
  const files = new Map();
  const calls = { decode: 0, convert: 0, download: 0 };
  const state = { locked: false };
  const messageSheet = {
    getName: () => 'teacher_messages',
    getSheetId: () => 1,
    getLastColumn: () => 13,
    getDataRange: () => ({ getValues: () => rows }),
    appendRow(row) {
      assert.equal(state.locked, true);
      if (append === 'before') throw new Error('synthetic write failure');
      rows.push(Array.from(row));
      if (append === 'after') throw new Error('synthetic lost append response');
    },
  };
  const students = [[], ...[owner, other].map(item => ['', '', '', item.name, item.studentId])];
  const gas = vm.createContext({
    MimeType: { PDF: 'application/pdf' },
    DriveApp: {
      Access: { PRIVATE: 'private' },
      createFile(blob) {
        const id = 'fixture-file-' + (files.size + 1);
        const file = { blob, trashed: false, getId: () => id, getSharingAccess: () => sharing,
          getBlob: () => blob, setTrashed(value) { this.trashed = value; } };
        files.set(id, file);
        return file;
      },
      getFileById(id) { calls.download++; return files.get(id); },
    },
    LockService: { getScriptLock: () => ({
      waitLock() { assert.equal(state.locked, false); state.locked = true; },
      releaseLock() { state.locked = false; },
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'local-gateway-fixture' }) },
    Utilities: {
      formatDate: () => '2026-11-05 09:00:00',
      getUuid: () => '00000000-0000-4000-8000-000000000002',
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value, encoding) => [...createHash(algorithm).update(value, encoding).digest()],
      base64Decode(value) { calls.decode++; return Buffer.from(value, 'base64'); },
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      newBlob(value, mime, name) {
        return {
          name, mime, getBytes: () => Buffer.from(value),
          getAs(target) {
            assert.equal(mime, 'text/html');
            assert.equal(target, 'application/pdf');
            calls.convert++;
            return gas.Utilities.newBlob(fixturePdf, target, name);
          },
          setName(name) { this.name = name; return this; },
        };
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Code.js'), 'utf8'), gas);
  gas.getSpreadsheet_ = () => ({ getSheetByName(name) {
    if (name === 'students') return { getDataRange: () => ({ getValues: () => students }) };
    if (name === 'teacher_messages') return messageSheet;
    return null;
  } });
  const callGas = request => gas.handleApiRequest_({ ...request, secret: 'local-gateway-fixture' });
  return { rows, files, calls, callGas, gas };
}

const payload = (extra = {}) => ({
  pdf: fixturePdf.toString('base64'),
  fileName: '가짜/건강 기록.pdf',
  start: '2026-10-30', end: '2026-11-05',
  deliveryId: 'abcdef01-0000-4000-8000-000000000001',
  studentId: owner.studentId, studentName: owner.name,
  ...extra,
});
const send = (callGas, data) => callGas({ role: 'teacher', action: 'sendPrivateTeacherReport', params: [data] });

function fakeResponse() {
  const headers = new Map();
  return { headers, setHeader(key, value) { headers.set(key, value); },
    end(body) { this.body = body; } };
}

async function makeSession(role, subject = {}) {
  const { createSession } = await import('../vercel/api/_lib/session.js');
  return 'caffeine_' + role + '_session=' + createSession({ role, exp: now() + 60, ...subject }, now());
}

test('image PDF delivery uses the private message route and only the owner can download the same bytes', async () => {
  const { rows, files, calls, callGas, gas } = fakeGas();
  const result = send(callGas, payload());
  assert.equal(result.success, true);
  assert.equal(files.size, 1);
  assert.equal(calls.convert, 0);
  const file = [...files.values()][0];
  assert.equal(file.getSharingAccess(), 'private');
  assert.equal(file.blob.mime, 'application/pdf');
  assert.equal(file.blob.name, '가짜_건강 기록.pdf');
  assert.deepEqual(file.blob.getBytes(), fixturePdf);
  assert.equal(rows[1][12], 'privatePdf');
  assert.equal(send(callGas, payload()).success, true);
  assert.equal(send(callGas, payload({ deliveryId: payload().deliveryId.toUpperCase() })).success, true);
  assert.equal(rows.length, 2);
  assert.equal(files.size, 1);
  assert.throws(() => send(callGas, payload({ studentId: other.studentId, studentName: other.name })), /이미 사용/);
  assert.equal(send(callGas, payload({ studentName: other.name })).success, false);

  const { createActionHandler } = await import('../vercel/api/student/action.js');
  const get = createActionHandler({ callGas, now });
  const url = '/api/student/action?report=' + gas.teacherMessageKey_(rows[1]);
  for (const subject of [other, { ...owner, name: other.name }]) {
    const res = fakeResponse();
    await get({ method: 'GET', url, headers: { cookie: await makeSession('student', subject) } }, res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(calls.download, 0);
  const res = fakeResponse();
  await get({ method: 'GET', url, headers: { cookie: await makeSession('student', owner) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.deepEqual(res.body, fixturePdf);
});

test('new action accepts only raw PDF base64 and rejects oversize before decoding', () => {
  const { rows, files, calls, callGas } = fakeGas();
  for (const bad of [
    { pdf: undefined, html: '<p>legacy input</p>' },
    { html: '<p>ambiguous input</p>' },
    { pdf: 'data:application/pdf;base64,' + payload().pdf },
    { pdf: payload().pdf.slice(0, -4) + '!AAA' },
    { pdf: Buffer.from('not a PDF').toString('base64') },
    { pdf: 'JVBERi1=' }, // Nonzero padding bits.
  ]) assert.throws(() => send(callGas, payload(bad)), /PDF/);
  const overLimit = 'JVBERi0A' + 'A'.repeat(4 * 1024 * 1024 - 4);
  assert.throws(() => send(callGas, payload({ pdf: overLimit })), /용량/);
  assert.equal(calls.decode, 0);
  assert.equal(calls.convert, 0);
  assert.equal(files.size, 0);
  assert.equal(rows.length, 1);
});

test('legacy HTML render and save continue through the existing private storage path', () => {
  const { rows, files, calls, callGas } = fakeGas();
  const data = { ...payload(), fileName: '가짜_2026-10-30_2026-11-05.pdf', html: '<p>synthetic</p>' };
  const rendered = callGas({ role: 'teacher', action: 'renderTeacherReportPdf', params: [data] });
  assert.equal(rendered.pdf, fixturePdf.toString('base64'));
  assert.equal(callGas({ role: 'teacher', action: 'saveTeacherPdfAndSendMessage', params: [data] }).success, true);
  assert.equal(files.size, 1);
  assert.equal(rows[1][12], 'privatePdf');
  assert.match(rows[1][4], /2026-10-30 ~ 2026-11-05/);
  assert.equal(calls.convert, 2);
});

test('lost message append response is retryable and a failed append does not expose an attachment', () => {
  const lost = fakeGas({ append: 'after' });
  assert.equal(send(lost.callGas, payload()).success, true);
  assert.equal(send(lost.callGas, payload()).success, true);
  assert.equal(lost.rows.length, 2);
  assert.equal(lost.files.size, 1);
  assert.equal([...lost.files.values()][0].trashed, false);
  const failed = fakeGas({ append: 'before' });
  assert.throws(() => send(failed.callGas, payload()), /synthetic write failure/);
  assert.equal(failed.rows.length, 1);
  assert.equal([...failed.files.values()][0].trashed, true);
});

test('a PDF outside private Drive sharing cannot create a message', () => {
  const { callGas, rows } = fakeGas({ sharing: 'unexpected-sharing' });
  assert.throws(() => send(callGas, payload()), /비공개/);
  assert.equal(rows.length, 1);
});

test('teacher gateway allows a full 3 MiB image PDF plus JSON and retains separate limits', async () => {
  const { createActionHandler } = await import('../vercel/api/teacher/action.js');
  const fake = fakeGas();
  const calls = [];
  const handle = createActionHandler({ now, callGas: args => {
    calls.push(args.action);
    return args.action === 'sendPrivateTeacherReport' ? fake.callGas(args) : { success: true };
  } });
  const cookie = await makeSession('teacher');
  const post = async (action, params, withCookie = true) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ action, params }))]);
    req.method = 'POST';
    req.headers = withCookie ? { cookie } : {};
    const res = fakeResponse();
    await handle(req, res);
    return res.statusCode;
  };
  const pdf = Buffer.alloc(limit);
  fixturePdf.copy(pdf);
  assert.equal(await post('sendPrivateTeacherReport', [payload({ pdf: pdf.toString('base64') })]), 200);
  assert.equal([...fake.files.values()][0].blob.getBytes().length, limit);
  assert.equal(await post('sendPrivateTeacherReport', [payload({ pdf: 'A'.repeat(4 * 1024 * 1024 + 4) })]), 413);
  assert.equal(await post('sendPrivateTeacherReport', [payload({ html: '<p>ambiguous</p>' })]), 400);
  assert.equal(await post('sendPrivateTeacherReport', [payload()], false), 401);
  assert.equal(await post('getTeacherData', ['x'.repeat(256 * 1024)]), 413);
  assert.equal(await post('analyzeTeacherBatch', ['x'.repeat(1024 * 1024)]), 413);
  assert.equal(await post('renderTeacherReportPdf', ['x'.repeat(4 * 1024 * 1024)]), 413);
  assert.deepEqual(calls, ['sendPrivateTeacherReport']);
});

test('teacher gateway accepts only supported report models and keeps the choice out of Apps Script', async () => {
  const { createActionHandler } = await import('../vercel/api/teacher/action.js');
  const { createTeacherOpenAI } = await import('../vercel/api/_lib/teacher-openai.js');
  const { makeSummaryFixture } = require('./fixtures/summary-report.cjs');
  const apiRequests = [], gasRequests = [];
  const applyTeacherAI = createTeacherOpenAI({ readKey: () => 'local-fixture-only', async fetchImpl(_url, options) {
    const { model, reasoning, input } = JSON.parse(options.body);
    apiRequests.push({ model, reasoning });
    assert.doesNotMatch(input, /테스트 학생|fixture-owner/);
    const analyses = JSON.parse(input).map(evidence => ({
      ...Object.fromEntries(Object.entries(evidence).map(([field, fact]) => [
        field, fact ? '기록에 나타난 습관을 다음에도 살펴볼 수 있습니다.' : null,
      ])),
      highlights: ['caffeineSleep'],
    }));
    return Response.json({ model, status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ analyses }) }] },
    ] });
  } });
  const handle = createActionHandler({ now, applyTeacherAI, callGas({ params: [input] }) {
    gasRequests.push(input);
    return { success: true, reports: [makeSummaryFixture()] };
  } });
  const cookie = await makeSession('teacher');
  const post = async options => {
    const params = [{ reportVersion: 2, mode: 'ai', ...options }];
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'analyzeTeacherBatch', params }))]);
    req.method = 'POST';
    req.headers = { cookie };
    const res = fakeResponse();
    await handle(req, res);
    return res;
  };

  for (const [model, reasoning] of [
    [undefined, { effort: 'none' }],
    ['gpt-6-luna', { effort: 'none' }],
    ['gpt-6.1-terra', { effort: 'none' }],
    ['gpt-4.1-mini', undefined],
  ]) {
    const res = await post(model ? { aiModel: model } : {});
    assert.equal(res.statusCode, 200);
    const expected = model || 'gpt-6-luna';
    const feedback = JSON.parse(res.body).data.reports[0].feedback;
    assert.equal(feedback.aiApiStatus, 'applied');
    assert.equal(feedback.aiModel, expected);
    assert.deepEqual(apiRequests.at(-1), { model: expected, reasoning });
    assert.deepEqual(gasRequests.at(-1), { mode: 'rule', reportVersion: 2 });
  }
  assert.equal((await post({ aiModel: 'unlisted-model' })).statusCode, 400);
  assert.equal((await post({ mode: 'rule', aiModel: 'gpt-6.1-terra' })).statusCode, 200);
  assert.deepEqual(gasRequests.at(-1), { mode: 'rule', reportVersion: 2 });
  assert.equal(gasRequests.length, 5);
  assert.equal(apiRequests.length, 4);
});
