import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppsScript } from './harness.js';

const legacyHeaders = ['타임스탬프', '학번', '이름', '제목', '내용', '읽음여부', '읽은시간', '학생답장', '학생답장시간', '학생답장읽음'];
const subject = { studentId: '1101', name: '합성학생' };

async function setup({ legacy = false, englishHeaders = false, nativeTable = false } = {}) {
  const rows = [[...legacyHeaders, ...(legacy ? [] : ['attachmentName', 'attachmentUrl', 'attachmentType'])]];
  if (englishHeaders) rows[0] = ['timestamp', 'studentId', 'studentName', 'title', 'content', 'readStatus', 'readTime', 'studentReply', 'studentReplyTime', 'studentReplyRead', 'attachmentName', 'attachmentUrl', 'attachmentType'];
  const sheet = {
    getName: () => 'teacher_messages',
    getSheetId: () => nativeTable ? 2044179537 : 123,
    getParent: () => spreadsheet,
    appendRow(row) { assert.equal(nativeTable, false, 'native message tables must use appendCells'); rows.push([...row]); },
    getLastRow() { return rows.length; },
    getLastColumn() { return Math.max(...rows.map(row => row.length)); },
    getDataRange() { return { getValues: () => rows.map(row => [...row]) }; },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row + i - 1]?.[column + j - 1] ?? '')),
        setValue(value) { rows[row - 1][column - 1] = value; },
        setValues(values) { values.forEach((valuesRow, i) => valuesRow.forEach((value, j) => {
        rows[row + i - 1] ??= [];
        rows[row + i - 1][column + j - 1] = value;
      })); } };
    },
  };
  const spreadsheet = { getSheetByName: () => sheet, getId: () => 'synthetic-spreadsheet' };
  const requests = [];
  const file = { setSharing() {}, getName: () => 'synthetic.pdf', getUrl: () => 'https://example.invalid/synthetic.pdf', getId: () => 'synthetic-file' };
  const blob = { getAs() { return this; }, setName() { return this; } };
  const { context } = await loadAppsScript({
    files: ['Spreadsheet.gs', 'Security.gs', 'Ownership.gs', 'Api.gs', 'Code.gs'],
    globals: {
      Sheets: { Spreadsheets: { batchUpdate(body, id) {
        assert.equal(id, 'synthetic-spreadsheet');
        const append = body.requests[0].appendCells;
        assert.equal(append.tableId, '1114109815');
        requests.push(append);
        rows.push(append.rows[0].values.map(cell => cell.userEnteredValue ? Object.values(cell.userEnteredValue)[0] : ''));
      } } },
      getSpreadsheet_: () => spreadsheet,
      Utilities: { getUuid: () => 'synthetic-record', formatDate: () => '2026-10-08 12:00:00', newBlob: () => blob },
      MimeType: { PDF: 'application/pdf' },
      DriveApp: { createFile: () => file, Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' } },
    },
  });
  context.getSpreadsheet_ = () => spreadsheet;
  return { context, rows, requests };
}

test('message attachments survive teacher send and student/teacher retrieval', async () => {
  const { context, rows } = await setup();
  context.dispatchTeacherAction_('sendTeacherMessage', [{
    studentId: '1101', studentName: '합성학생', title: '첨부 확인', content: '합성 메시지',
    attachmentName: 'synthetic.pdf', attachmentUrl: 'https://example.invalid/synthetic.pdf', attachmentType: 'pdf',
  }]);
  assert.equal(rows.length, 2);
  for (const item of [
    context.dispatchTeacherAction_('getSentTeacherMessages', []).data[0],
    context.dispatchStudentAction_('getTeacherMessages', [], subject).data[0],
  ]) {
    assert.equal(item.attachmentName, 'synthetic.pdf');
    assert.equal(item.attachmentUrl, 'https://example.invalid/synthetic.pdf');
    assert.equal(item.attachmentType, 'pdf');
  }
});

test('a student can acknowledge and reply to their message in the attachment sheet format', async () => {
  const { context, rows } = await setup({ englishHeaders: true });
  context.sendTeacherMessage({ studentId: '1101', studentName: '합성학생', title: '메시지', content: '본문' });
  assert.equal(context.dispatchStudentAction_('markTeacherMessageRead', [2], subject).success, true);
  assert.equal(context.dispatchStudentAction_('replyToTeacherMessage', [2, '합성 답장'], subject).success, true);
  assert.equal(rows[1][5], '읽음');
  assert.equal(rows[1][7], '합성 답장');
});

test('attachment sheet headers never allow a different student to acknowledge or reply', async () => {
  const { context, rows } = await setup({ englishHeaders: true });
  context.sendTeacherMessage({ studentId: '1101', studentName: '합성학생', title: '메시지', content: '본문' });
  const otherStudent = { studentId: '1102', name: '합성학생둘' };
  assert.throws(() => context.dispatchStudentAction_('markTeacherMessageRead', [2], otherStudent), /REQUEST_REJECTED/);
  assert.throws(() => context.dispatchStudentAction_('replyToTeacherMessage', [2, '다른 학생'], otherStudent), /REQUEST_REJECTED/);
  assert.equal(rows[1][5], '미읽음');
  assert.equal(rows[1][7], '');
});

test('sending an attachment extends the legacy message header without dropping reply fields', async () => {
  const { context, rows } = await setup({ legacy: true });
  context.sendTeacherMessage({ studentId: '1101', studentName: '합성학생', title: '첨부', content: '본문', attachmentName: 'synthetic.pdf', attachmentUrl: 'https://example.invalid/synthetic.pdf', attachmentType: 'pdf' });
  assert.deepEqual(rows[0].slice(0, 10), legacyHeaders);
  assert.deepEqual(rows[0].slice(10), ['attachmentName', 'attachmentUrl', 'attachmentType']);
  assert.equal(rows[1][11], 'https://example.invalid/synthetic.pdf');
});

test('legacy text messages remain readable with empty attachment metadata', async () => {
  const { context, rows } = await setup({ legacy: true });
  rows.push(['2026-10-08 12:00:00', '1101', '합성학생', '이전 메시지', '이전 본문', '읽음', '', '기존 답장', '', '읽음']);
  const item = context.getTeacherMessages('1101').data[0];
  assert.equal(item.content, '이전 본문');
  assert.equal(item.studentReply, '기존 답장');
  assert.equal(item.attachmentUrl, '');
});

test('PDF delivery creates one message with a retrievable attachment', async () => {
  const { context, rows } = await setup();
  const result = context.dispatchTeacherAction_('saveTeacherPdfAndSendMessage', [{ studentId: '1101', studentName: '합성학생', html: '<p>Synthetic only</p>' }]);
  assert.equal(result.success, true);
  assert.equal(rows.length, 2);
  assert.match(rows[1][4], /PDF 링크: https:\/\/example\.invalid\/synthetic\.pdf/);
  const item = context.getTeacherMessages('1101').data[0];
  assert.equal(item.attachmentUrl, 'https://example.invalid/synthetic.pdf');
  assert.equal(item.attachmentType, 'pdf');
});

test('PDF delivery preserves native table append and all thirteen message columns', async () => {
  const { context, rows, requests } = await setup({ nativeTable: true });
  const result = context.saveTeacherPdfAndSendMessage({ studentId: '1101', studentName: '합성학생', html: '<p>Synthetic only</p>' });
  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 13);
  assert.equal(context.getTeacherMessages('1101').data[0].attachmentType, 'pdf');
});
