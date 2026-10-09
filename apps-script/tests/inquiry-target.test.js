import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadAppsScript, createMemorySpreadsheet } from './harness.js';

const headers = ['timestamp','grade','class','number','studentId','name','title','content','status','reply','replyTime'];
const inquiry = title => ['2026-10-09 09:00:00',1,1,1,0,'합성학생',title,'합성 문의 내용','미응답','',''];
const key = row => createHash('sha256').update(JSON.stringify(row.slice(0,8).map(v => v instanceof Date ? v.toISOString() : String(v ?? '')))).digest('hex');
async function setup(rows = [inquiry('앞 문의'),inquiry('선택 문의'),inquiry('뒤 문의')]) {
  const spreadsheet = createMemorySpreadsheet({ inquiries: [headers,...rows] });
  const sheet = spreadsheet.getSheetByName('inquiries');
  sheet.deleteRow = index => sheet.rows.splice(index-1,1);
  const events=[];
  const {context} = await loadAppsScript({files:['Spreadsheet.gs','Security.gs','Ownership.gs','Api.gs','Code.gs'], globals:{__spreadsheet:spreadsheet,__lockEvents:events}});
  context.getSpreadsheet_ = () => spreadsheet;
  return {context,sheet,events};
}

test('inquiry list supplies stable identity including numeric test student zero',async()=>{
  const {context,sheet}=await setup();
  const selected=context.getInquiries().data.find(x=>x.title==='선택 문의');
  assert.equal(selected.studentId,'0');
  assert.equal(selected.inquiryKey,key(sheet.rows[2]));
  sheet.deleteRow(2);
  assert.equal(context.getInquiries().data.find(x=>x.title==='선택 문의').inquiryKey,selected.inquiryKey);
  assert.equal(context.getUnreadInquiries().data.find(x=>x.title==='선택 문의').inquiryKey,selected.inquiryKey);
});
test('reply follows the unique original inquiry after an earlier row is deleted under the gateway lock',async()=>{
  const {context,sheet,events}=await setup(); const selectedKey=key(sheet.rows[2]);
  sheet.deleteRow(2);
  const result=context.dispatchTeacherAction_('replyToInquiry',[3,'합성 응답',selectedKey]);
  assert.equal(result.success,true);assert.equal(sheet.rows[1][9],'합성 응답');assert.equal(sheet.rows[2][9],'');
  assert.deepEqual(events,['lock','unlock']);
});
test('reply to a deleted inquiry cannot overwrite its successor',async()=>{
  const {context,sheet}=await setup();const selectedKey=key(sheet.rows[2]);sheet.deleteRow(3);
  const before=JSON.stringify(sheet.rows);
  const result=context.replyToInquiry(3,'wrong',selectedKey);
  assert.equal(result.success,false);assert.equal(result.code,'INQUIRY_TARGET_CHANGED');assert.equal(JSON.stringify(sheet.rows),before);
});
test('reply to the deleted last inquiry cannot create an orphan row',async()=>{
  const {context,sheet}=await setup();const selectedKey=key(sheet.rows[3]);sheet.deleteRow(4);
  const before=JSON.stringify(sheet.rows);
  assert.equal(context.replyToInquiry(4,'wrong',selectedKey).success,false);assert.equal(JSON.stringify(sheet.rows),before);
});
test('stale delete follows the original target instead of deleting its successor',async()=>{
  const {context,sheet,events}=await setup();const selectedKey=key(sheet.rows[2]);sheet.deleteRow(2);
  assert.equal(context.dispatchTeacherAction_('deleteInquiry',[3,selectedKey]).success,true);
  assert.deepEqual(sheet.rows.map(x=>x[6]),['title','뒤 문의']);assert.deepEqual(events,['lock','unlock']);
});
test('deleting a missing target preserves every remaining inquiry',async()=>{
  const {context,sheet}=await setup();const selectedKey=key(sheet.rows[2]);sheet.deleteRow(3);
  const before=JSON.stringify(sheet.rows);
  assert.equal(context.deleteInquiry(3,selectedKey).success,false);assert.equal(JSON.stringify(sheet.rows),before);
});
test('popup acknowledgment follows the original inquiry after row movement',async()=>{
  const {context,sheet,events}=await setup();const selectedKey=key(sheet.rows[2]);sheet.deleteRow(2);
  assert.equal(context.dispatchTeacherAction_('markInquiryNotified',[3,selectedKey]).success,true);
  assert.equal(sheet.rows[1][11],'확인');assert.equal(sheet.rows[2][11],undefined);
  assert.deepEqual(events,['lock','unlock']);
});
test('identical inquiry identities are rejected rather than choosing a duplicate',async()=>{
  for(const action of ['replyToInquiry','deleteInquiry']) {
    const row=inquiry('동일 문의');const {context,sheet}=await setup([row,row]);const before=JSON.stringify(sheet.rows);
    const args=action==='replyToInquiry'?[2,'wrong',key(row)]:[2,key(row)];
    const result=context[action](...args);assert.equal(result.success,false);assert.equal(result.code,'INQUIRY_TARGET_CHANGED');assert.equal(JSON.stringify(sheet.rows),before);
  }
});
test('unverified legacy calls and invalid indices never mutate inquiry rows',async()=>{
  const {context,sheet}=await setup();const before=JSON.stringify(sheet.rows);
  for(const index of [1,0,-1,2.5,'2',NaN,undefined,2]) {
    assert.equal(context.replyToInquiry(index,'wrong').success,false);
    assert.equal(context.deleteInquiry(index).success,false);
  }
  assert.equal(context.replyToInquiry(2,' ',key(sheet.rows[1])).success,false);
  assert.equal(JSON.stringify(sheet.rows),before);
});
test('Date timestamps retain their identity across reads and changed source text is rejected',async()=>{
  const row=inquiry('선택 문의');row[0]=new Date('2026-10-09T00:00:00Z');
  const {context,sheet}=await setup([row]);const selectedKey=key(row);
  assert.equal(context.getInquiries().data[0].inquiryKey,selectedKey);
  sheet.rows[1][7]='변경된 문의';
  assert.equal(context.replyToInquiry(2,'wrong',selectedKey).success,false);assert.equal(sheet.rows[1][9],'');
});
