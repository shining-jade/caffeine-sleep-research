import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppsScript } from './harness.js';

test('report period strings remain compatible with exact-date lookup', async () => {
  let request;
  const {context}=await loadAppsScript({files:['Spreadsheet.gs'],globals:{Sheets:{Spreadsheets:{batchUpdate(body){request=body;}}}}});
  context.appendRecordRow_({getName:()=> 'ai_reports',getSheetId:()=>1501207574,getParent:()=>({getId:()=> 'sheet-id'})},['학생','2308','2026-10-01','2026-10-06','내용','2026-10-06 14:00:00']);
  const cells=request.requests[0].appendCells.rows[0].values;
  assert.equal(cells[2].userEnteredValue.stringValue,'2026-10-01');
  assert.equal(cells[3].userEnteredValue.stringValue,'2026-10-06');
  assert.equal(typeof cells[5].userEnteredValue.numberValue,'number');
});

test('sleep overwrite updates in place and preserves existing record on failure', async () => {
  let request;
  const {context}=await loadAppsScript({files:['Spreadsheet.gs'],globals:{Sheets:{Spreadsheets:{batchUpdate(body){request=body;throw Error('503');}}}}});
  const sheet={getName:()=> 'sleep',getSheetId:()=>630091192,getParent:()=>({getId:()=> 'sheet-id'}),deleteRow(){assert.fail('must not delete');}};
  assert.throws(()=>context.appendRecordRow_(sheet,['2026-10-06 13:00:00'],3),/TABLE_APPEND_FAILED/);
  assert.equal(request.requests[0].updateCells.start.rowIndex,2);
  assert.equal(request.requests.length,1);
});

test('new recovery sheet does not use the old native table ID', async () => {
  let written;
  const {context}=await loadAppsScript({files:['Spreadsheet.gs']});
  context.appendRecordRow_({getName:()=> 'teacher_messages',getSheetId:()=>123,appendRow(values){written=values;}},['타임스탬프','학번']);
  assert.equal(written[1],'학번');
});

test('table append targets native table rather than the formula spill end', async () => {
  let request;
  const { context } = await loadAppsScript({files:['Spreadsheet.gs'],globals:{
    Sheets:{Spreadsheets:{batchUpdate(body){request=body;}}},
  }});
  const sheet={getName:()=> 'info',getSheetId:()=>1695164716,getParent:()=>({getId:()=> 'sheet-id'}),appendRow(){assert.fail('must not append after formula spill');}};
  context.appendRecordRow_(sheet,['time',2,3,8,'학생',2308,52,130,'23:00','07:00','teen']);
  assert.equal(request.requests[0].appendCells.tableId,'1885862728');
  assert.equal(request.requests[0].appendCells.rows[0].values.length,11);
  assert.equal(request.requests[0].appendCells.rows[0].values[6].userEnteredValue.numberValue,52);
});

test('table append rejects upstream failures without fallback or duplicate writes', async () => {
  let calls=0;
  const {context}=await loadAppsScript({files:['Spreadsheet.gs'],globals:{Sheets:{Spreadsheets:{batchUpdate(){calls++;throw Error('503');}}}}});
  assert.throws(()=>context.appendRecordRow_({getName:()=> 'caffeine',getSheetId:()=>1399656889,getParent:()=>({getId:()=> 'sheet-id'}),appendRow(){assert.fail('no fallback');}},['value']),/TABLE_APPEND_FAILED/);
  assert.equal(calls,1);
});
