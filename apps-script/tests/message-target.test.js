import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadAppsScript,createMemorySpreadsheet} from './harness.js';

const headers=['timestamp','studentId','studentName','title','content','readStatus','readTime','studentReply','studentReplyTime','studentReplyRead','attachmentName','attachmentUrl','attachmentType'];
const subject={studentId:'0',name:'합성학생'};
const message=(title,owner='0')=>['2026-10-09 12:00:00',owner,'합성학생',title,'본문','미읽음','','기존 답장','2026-10-09 12:01:00','미확인','','',''];
const digest=parts=>createHash('sha256').update(JSON.stringify(parts.map(v=>v instanceof Date?v.toISOString():String(v??'')))).digest('hex');
const key=row=>digest([0,1,2,3,4,10,11,12].map(i=>row[i]));
const replyKey=row=>digest([key(row),row[7],row[8]]);
async function setup(rows=['A','B','C','D'].map(x=>message(x))){
 const spreadsheet=createMemorySpreadsheet({teacher_messages:[headers,...rows]});const sheet=spreadsheet.getSheetByName('teacher_messages');
 sheet.deleteRow=index=>sheet.rows.splice(index-1,1);const events=[];
 const {context}=await loadAppsScript({files:['Spreadsheet.gs','Security.gs','Ownership.gs','Api.gs','Code.gs'],properties:{SPREADSHEET_ID:'synthetic'},globals:{__spreadsheet:spreadsheet,__lockEvents:events}});
 return {sheet,context,events};
}
test('message and reply identities survive mutable read/reply state and row movement',async()=>{
 const {sheet,context}=await setup();const expected=key(sheet.rows[2]);
 const row=context.getTeacherMessages('0').data.find(x=>x.title==='B');assert.equal(row.messageKey,expected);
 assert.equal(context.getSentTeacherMessages().data.find(x=>x.title==='B').messageKey,expected);
 const unread=context.getUnreadStudentReplies().data.find(x=>x.title==='B');assert.equal(unread.messageKey,expected);assert.equal(unread.replyKey,replyKey(sheet.rows[2]));
 sheet.deleteRow(2);sheet.rows[1][5]='읽음';sheet.rows[1][7]='수정 답장';
 assert.equal(context.getTeacherMessages('0').data.find(x=>x.title==='B').messageKey,expected);
});
test('student reply follows its original message under one lock after an earlier deletion',async()=>{
 const {sheet,context,events}=await setup();const expected=key(sheet.rows[2]);sheet.deleteRow(2);
 assert.equal(context.dispatchStudentAction_('replyToTeacherMessage',[3,'새 답장',expected],subject).success,true);
 assert.equal(sheet.rows[1][7],'새 답장');assert.equal(sheet.rows[2][7],'기존 답장');assert.deepEqual(events,['lock','unlock']);
});
for(const action of ['replyToTeacherMessage','markTeacherMessageRead','deleteTeacherMessage','markStudentReplyRead']){
 test(`${action} rejects a deleted target without changing its successor`,async()=>{
  const {sheet,context}=await setup();const expected=key(sheet.rows[2]),expectedReply=replyKey(sheet.rows[2]);sheet.deleteRow(3);const before=JSON.stringify(sheet.rows);
  const params=action==='replyToTeacherMessage'?[3,'wrong',expected]:action==='markStudentReplyRead'?[3,expected,expectedReply]:[3,expected];
  const result=action==='replyToTeacherMessage'||action==='markTeacherMessageRead'?context.dispatchStudentAction_(action,params,subject):context.dispatchTeacherAction_(action,params);
  assert.equal(result.success,false);assert.equal(result.code,'MESSAGE_TARGET_CHANGED');assert.equal(JSON.stringify(sheet.rows),before);
 });
}
test('ownership is checked on the resolved original message, never the stale row',async()=>{
 const {sheet,context}=await setup([message('A'),message('B','1102'),message('C')]);const expected=key(sheet.rows[2]);sheet.deleteRow(2);const before=JSON.stringify(sheet.rows);
 assert.throws(()=>context.dispatchStudentAction_('replyToTeacherMessage',[3,'wrong',expected],subject),/REQUEST_REJECTED/);assert.equal(JSON.stringify(sheet.rows),before);
});
test('student read and teacher reply read follow shifted identities',async()=>{
 const {sheet,context}=await setup();const expected=key(sheet.rows[2]),expectedReply=replyKey(sheet.rows[2]);sheet.deleteRow(2);
 assert.equal(context.dispatchStudentAction_('markTeacherMessageRead',[3,expected],subject).success,true);
 assert.equal(context.dispatchTeacherAction_('markStudentReplyRead',[3,expected,expectedReply]).success,true);
 assert.equal(sheet.rows[1][5],'읽음');assert.equal(sheet.rows[1][9],'확인');assert.equal(sheet.rows[2][5],'미읽음');assert.equal(sheet.rows[2][9],'미확인');
});
test('acknowledging an old reply cannot mark a newer reply as read',async()=>{
 const {sheet,context}=await setup();const expected=key(sheet.rows[2]),expectedReply=replyKey(sheet.rows[2]);sheet.rows[2][7]='새로운 답장';const before=JSON.stringify(sheet.rows);
 assert.equal(context.dispatchTeacherAction_('markStudentReplyRead',[3,expected,expectedReply]).success,false);assert.equal(JSON.stringify(sheet.rows),before);
});
test('identical replies at the same clock instant receive distinct persisted versions',async()=>{
 const {sheet,context}=await setup();const expected=key(sheet.rows[2]);
 const fixed=Date.parse('2026-10-09T03:05:00Z');
 context.Date=class extends Date {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
 assert.equal(context.dispatchStudentAction_('replyToTeacherMessage',[3,'동일 답장',expected],subject).success,true);
 const first=context.getUnreadStudentReplies().data.find(x=>x.title==='B');
 assert.equal(context.dispatchStudentAction_('replyToTeacherMessage',[3,'동일 답장',expected],subject).success,true);
 const second=context.getUnreadStudentReplies().data.find(x=>x.title==='B');
 assert.notEqual(first.replyKey,second.replyKey);
 assert.equal(context.dispatchTeacherAction_('markStudentReplyRead',[3,expected,first.replyKey]).success,false);
 assert.equal(sheet.rows[2][9],'미확인');
 assert.equal(context.dispatchTeacherAction_('markStudentReplyRead',[3,expected,second.replyKey]).success,true);
});
test('single delete resolves the original message after an earlier deletion',async()=>{
 const {sheet,context}=await setup();const expected=key(sheet.rows[2]);sheet.deleteRow(2);
 assert.equal(context.dispatchTeacherAction_('deleteTeacherMessage',[3,expected]).success,true);assert.deepEqual(sheet.rows.slice(1).map(x=>x[3]),['C','D']);
});
test('bulk delete validates every identity before deleting and follows shifted targets',async()=>{
 const {sheet,context,events}=await setup();const targets=[{rowIndex:3,messageKey:key(sheet.rows[2])},{rowIndex:4,messageKey:key(sheet.rows[3])}];sheet.deleteRow(2);
 const result=context.dispatchTeacherAction_('deleteBulkTeacherMessages',[targets]);assert.equal(result.success,true);assert.equal(result.deleted,2);assert.deepEqual(sheet.rows.slice(1).map(x=>x[3]),['D']);assert.deepEqual(events,['lock','unlock']);
});
test('a missing bulk target aborts before deleting any other valid target',async()=>{
 const {sheet,context}=await setup();const targets=[{rowIndex:3,messageKey:key(sheet.rows[2])},{rowIndex:4,messageKey:key(sheet.rows[3])}];sheet.deleteRow(4);const before=JSON.stringify(sheet.rows);
 assert.equal(context.dispatchTeacherAction_('deleteBulkTeacherMessages',[targets]).success,false);assert.equal(JSON.stringify(sheet.rows),before);
});
test('bulk duplicate identities and legacy row-only requests cannot delete successors',async()=>{
 for(const targets of [[3,3],[{rowIndex:3,messageKey:key(message('B'))},{rowIndex:3,messageKey:key(message('B'))}]]){
  const {sheet,context}=await setup();const before=JSON.stringify(sheet.rows);assert.equal(context.deleteBulkTeacherMessages(targets).success,false);assert.equal(JSON.stringify(sheet.rows),before);
 }
});
test('ambiguous identities and unverified legacy calls fail safely',async()=>{
 const duplicate=message('B');const {sheet,context}=await setup([duplicate,duplicate]);const before=JSON.stringify(sheet.rows);
 assert.equal(context.replyToTeacherMessage(2,'wrong',key(duplicate)).success,false);
 assert.equal(context.deleteTeacherMessage(2,key(duplicate)).success,false);
 assert.equal(context.markTeacherMessageRead(2).success,false);assert.equal(context.markStudentReplyRead(2).success,false);
 assert.equal(JSON.stringify(sheet.rows),before);
});
test('legacy attachment padding and Date timestamps produce stable identities',async()=>{
 const row=message('B');row[0]=new Date('2026-10-09T03:00:00Z');const {sheet,context}=await setup([row.slice(0,10)]);
 assert.equal(context.getTeacherMessages('0').data[0].messageKey,key(row));
 sheet.rows[1][4]='변경된 본문';assert.equal(context.replyToTeacherMessage(2,'wrong',key(row)).success,false);
});
