import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAppsScript,createMemorySpreadsheet} from './harness.js';

const subject={studentId:'0',name:'합성학생'};
const row=(title='문의',id=0)=>['2026-10-09 09:00:00',1,1,1,id,'합성학생',title,'문의 내용','응답완료','교사 답변','2026-10-09 10:00:00'];
async function setup(rows=[row()]){
 const sheetBook=createMemorySpreadsheet({inquiries:[['timestamp','grade','class','number','studentId','name','title','content','status','reply','replyTime','teacherSeen'],...rows]});
 const events=[];
 const {context:c}=await loadAppsScript({files:['Spreadsheet.gs','Security.gs','Ownership.gs','Api.gs','Code.gs'],globals:{__lockEvents:events}});
 c.getSpreadsheet_=()=>sheetBook;
 return {c,sheet:sheetBook.getSheetByName('inquiries'),events};
}
test('confirmed inquiry reply stays confirmed in a fresh server context without browser storage',async()=>{
 const {c,sheet,events}=await setup();const before=c.getMyInquiries('0').data[0];
 assert.equal(before.replySeen,false);assert.match(before.replyKey,/^[a-f0-9]{64}$/);
 const result=c.dispatchStudentAction_('markInquiryRepliesSeen',['spoofed','wrong',[before.replyKey]],subject);
 assert.equal(result.success,true);assert.deepEqual(events,['lock','unlock']);
 const second=await setup(sheet.rows.slice(1));
 assert.equal(second.c.getMyInquiries('0').data[0].replySeen,true);
 assert.equal(second.c.getMyInquiries('0').data[0].reply,'교사 답변');
 assert.equal(c.dispatchStudentAction_('markInquiryRepliesSeen',['0','합성학생',[before.replyKey]],subject).success,true);
});
test('a changed teacher reply is new and an old acknowledgment cannot hide it',async()=>{
 const {c,sheet}=await setup();const key=c.getMyInquiries('0').data[0].replyKey;
 assert.equal(c.markInquiryRepliesSeen('0','합성학생',[key]).success,true);
 sheet.rows[1][9]='새 교사 답변'; // Same timestamp still needs a new notification.
 assert.equal(c.getMyInquiries('0').data[0].replySeen,false);
 assert.equal(c.markInquiryRepliesSeen('0','합성학생',[key]).success,false);
 assert.equal(c.getMyInquiries('0').data[0].replySeen,false);
});
test('reply acknowledgment rejects another student, a deleted reply and ambiguous duplicates without writes',async()=>{
 for(const mode of ['other','deleted','duplicate']){
  const {c,sheet}=await setup();const key=c.getMyInquiries('0').data[0].replyKey;
  if(mode==='other')sheet.rows[1][4]='1';
  if(mode==='deleted')sheet.rows.splice(1,1);
  if(mode==='duplicate')sheet.rows.push([...sheet.rows[1]]);
  const before=JSON.stringify(sheet.rows);
  assert.equal(c.markInquiryRepliesSeen('0','합성학생',[key]).success,false);
  assert.equal(JSON.stringify(sheet.rows),before);
 }
});
test('row movement preserves the correct reply acknowledgment and teacher notified column',async()=>{
 const {c,sheet}=await setup([row('앞'),row('뒤')]);const key=c.getMyInquiries('0').data[0].replyKey;
 sheet.rows.splice(1,1);sheet.rows[1][11]='확인';
 assert.equal(c.markInquiryRepliesSeen('0','합성학생',[key]).success,true);
 assert.equal(sheet.rows[1][11],'확인');assert.equal(c.getMyInquiries('0').data[0].replySeen,true);
});
test('invalid or mixed reply keys and occupied receipt column fail before any write',async()=>{
 for(const keys of [[],['bad'],['a'.repeat(64)],Array(101).fill('a'.repeat(64))]){
  const {c,sheet}=await setup();const before=JSON.stringify(sheet.rows);
  assert.equal(c.markInquiryRepliesSeen('0','합성학생',keys).success,false);assert.equal(JSON.stringify(sheet.rows),before);
 }
 const {c,sheet}=await setup();const key=c.getMyInquiries('0').data[0].replyKey;
 sheet.rows[0][12]='unrelated';const before=JSON.stringify(sheet.rows);
 assert.equal(c.markInquiryRepliesSeen('0','합성학생',[key]).success,false);assert.equal(JSON.stringify(sheet.rows),before);
});
