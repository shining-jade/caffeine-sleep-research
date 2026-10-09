import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { createSession } from '../api/_lib/session.js';
import { createActionHandler as studentAction } from '../api/student/action.js';
import { createActionHandler as teacherAction } from '../api/teacher/action.js';
import { normalizeStudentRequest } from '../api/_lib/student-policy.js';
import { normalizeTeacherRequest } from '../api/_lib/teacher-policy.js';

const student=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const teacher=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function extract(html,name,indent='    '){
  const start=html.indexOf(`${indent}function ${name}(`);assert.ok(start>=0,name);
  return html.slice(start,html.indexOf(`\n${indent}}`,start)+indent.length+2);
}
function form(html,name,action,indent='    '){
  const ids=['inquiryTitle','inquiryContent','submitInquiryBtn','studentReplyText','studentReplySendBtn',
    'studentReplyModal','replyRowIndex','replyInquiryKey','replyContent','replyModal','msgTitle','msgContent','msgTargetId','msgTargetName','msgSendModal'];
  const fields=Object.fromEntries(ids.map(id=>[id,{value:'valid text',disabled:false,textContent:'전송',innerText:'전송',style:{display:'block'},remove(){this.removed=true;}}]));
  fields.replyRowIndex.value='2';fields.replyInquiryKey.value='a'.repeat(64);fields.msgTargetId.value='0';fields.msgTargetName.value='테스트';fields.studentReplySendBtn.textContent='수정하기';
  fields.studentReplyModal.dataset={messageKey:'a'.repeat(64)};
  const replyBtn={disabled:false,textContent:'응답 제출'},messageBtn={disabled:false,textContent:'전송'};
  let success,failure;const requests=[],notices=[];
  const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},[action](...args){requests.push(args);}};
  const context=vm.createContext({user:{studentId:'0',name:'테스트'},window:{},
    document:{getElementById:id=>fields[id]||null,querySelector:s=>s.includes('replyModal')?replyBtn:messageBtn},
    google:{script:{run:runner}},alert:m=>notices.push(m),showInfoModal:(...x)=>notices.push(x),showSaveCompleteModal:(...x)=>notices.push(x),showTeacherModal:(...x)=>notices.push(x),
    loadMyInquiries(){},loadTeacherMessages(){},loadInquiries(){},loadSentMessages(){},
    closeReplyModal(){fields.replyModal.style.display='none';},closeMsgSendModal(){fields.msgSendModal.style.display='none';}});
  vm.runInContext(extract(html,name,indent),context);
  return {context,fields,replyBtn,messageBtn,requests,notices,invoke:()=>context[name](2),success:x=>success(x),failure:()=>failure(new Error('offline'))};
}
for(const [html,name,action,indent,input,button] of [
  [student,'submitInquiry','submitInquiry','    ','inquiryContent','submitInquiryBtn'],
  [student,'submitStudentReply','replyToTeacherMessage','    ','studentReplyText','studentReplySendBtn'],
  [teacher,'submitReply','replyToInquiry','','replyContent','replyBtn'],
  [teacher,'submitTeacherMsg','sendTeacherMessage','','msgContent','messageBtn'],
]){
  test(`${name} sends once while pending, retains draft on failure, then allows retry`,()=>{
    const f=form(html,name,action,indent),btn=f[button]||f.fields[button];
    const label=btn.textContent;
    f.invoke();f.invoke();assert.equal(f.requests.length,1,'pending request must not duplicate');
    assert.equal(btn.disabled,true);f.failure();assert.equal(btn.disabled,false);
    assert.equal(f.fields[input].value,'valid text');
    if(name==='submitStudentReply')assert.equal(btn.textContent,label,'editing label restored');
    f.invoke();assert.equal(f.requests.length,2);
  });
  test(`${name} rejects whitespace-only required input without a request`,()=>{
    const f=form(html,name,action,indent);f.fields[input].value=' \n ';
    f.invoke();assert.equal(f.requests.length,0);assert.ok(f.notices.length);
  });
}
test('inquiry submission handles malformed acknowledgment without clearing the draft or locking the button',()=>{
  const f=form(student,'submitInquiry','submitInquiry');f.invoke();f.success(null);
  assert.equal(f.fields.inquiryContent.value,'valid text');assert.equal(f.fields.submitInquiryBtn.disabled,false);
});
test('teacher reply handles malformed acknowledgment and restores submit button',()=>{
  const f=form(teacher,'submitReply','replyToInquiry','');f.invoke();f.success(null);
  assert.equal(f.fields.replyContent.value,'valid text');assert.equal(f.replyBtn.disabled,false);
  assert.equal(f.fields.replyModal.style.display,'block');
});
test('student delete refusal never removes confirmed records',()=>{
  for(const type of ['caffeine','sleep']){
    let success,applied=0;const notices=[];
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},deleteCaffeineData(){},deleteSleepData(){}};
    const context=vm.createContext({google:{script:{run:runner}},applyConfirmedDeletion(){applied++;},showSaveCompleteModal:m=>notices.push(m),showInfoModal:(...x)=>notices.push(x),refreshData(){}});
    vm.runInContext(extract(student,'deleteLog'),context);context.deleteLog(type,'saved');
    success({success:false});assert.equal(applied,0);success({success:true});assert.equal(applied,1);
  }
});
test('canceling student deletion clears pending action and does not send a delete',()=>{
  const modal={style:{display:'flex'}};let writes=0;
  const context=vm.createContext({document:{getElementById:()=>modal},pendingDelete:{type:'caffeine',id:'saved'},deleteLog(){writes++;}});
  vm.runInContext(extract(student,'closeDeleteConfirm')+'\n'+extract(student,'confirmDelete'),context);
  context.closeDeleteConfirm();context.confirmDelete();assert.equal(writes,0);assert.equal(context.pendingDelete.id,null);
});
test('canceling teacher inquiry deletion does not call the API',()=>{
  const context=vm.createContext({confirm:()=>false,google:{script:{run:{get withSuccessHandler(){assert.fail('cancelled delete');}}}}});
  vm.runInContext(extract(teacher,'confirmDeleteInquiry',''),context);context.confirmDeleteInquiry(2,'test');
});
test('canceling teacher single and bulk message deletion does not call the API',()=>{
  for(const name of ['confirmDeleteSentMsg','confirmBulkDeleteSentMsg']){
    let confirms=0;
    const context=vm.createContext({window:{_sentMsgSelected:new Set([2]),_sentMsgTargets:new Map([[2,{rowIndex:2,messageKey:'a'.repeat(64)}]])},escapeHtml:x=>x,showTeacherModal(_e,_t,_m,type){assert.equal(type,'confirm');confirms++;},
      google:{script:{run:{get withSuccessHandler(){assert.fail('cancelled delete');}}}}});
    vm.runInContext(extract(teacher,name,''),context);context[name](2,'test');assert.equal(confirms,1);
  }
});

const session={role:'student',studentId:'0',name:'테스트'};
test('API policies reject empty or non-text message content before Apps Script',()=>{
  for(const value of ['', ' \n ', null, undefined, 12, {}]){
    assert.throws(()=>normalizeStudentRequest('submitInquiry',[{title:'title',content:value}],session));
    assert.throws(()=>normalizeStudentRequest('submitInquiry',[{title:value,content:'body'}],session));
    assert.throws(()=>normalizeStudentRequest('replyToTeacherMessage',[2,value],session));
    assert.throws(()=>normalizeTeacherRequest('replyToInquiry',[2,value]));
    assert.throws(()=>normalizeTeacherRequest('sendTeacherMessage',[{studentId:'0',studentName:'테스트',title:'title',content:value}]));
  }
});
test('reply policies reject invalid and header row indices but preserve valid row/content',()=>{
  for(const row of [0,1,-1,2.5,'2',NaN,undefined]){
    assert.throws(()=>normalizeStudentRequest('replyToTeacherMessage',[row,'reply'],session));
    assert.throws(()=>normalizeTeacherRequest('replyToInquiry',[row,'reply']));
  }
  assert.deepEqual(normalizeTeacherRequest('replyToInquiry',[2,' reply ','a'.repeat(64)]).params,[2,' reply ','a'.repeat(64)]);
  assert.deepEqual(normalizeStudentRequest('replyToTeacherMessage',[2,'reply','a'.repeat(64)],session).params,[2,'reply','a'.repeat(64)]);
});
test('teacher message recipient must be present while test student zero remains valid',()=>{
  const payload={studentId:'0',studentName:'테스트',title:'title',content:'body'};
  for(const field of ['studentId','studentName','title'])assert.throws(()=>normalizeTeacherRequest('sendTeacherMessage',[{...payload,[field]:' '} ]));
  assert.deepEqual(normalizeTeacherRequest('sendTeacherMessage',[payload]).params,[payload]);
});

test('student and teacher API routes return 400 for invalid messages without calling Apps Script',async()=>{
  process.env.SESSION_SECRET='submission-audit-local-test-secret';
  const now=1800000000;let gasCalls=0;
  for(const [role,create,action,params] of [
    ['student',studentAction,'submitInquiry',[{title:'title',content:' '}]],
    ['student',studentAction,'replyToTeacherMessage',[2,' ']],
    ['teacher',teacherAction,'replyToInquiry',[1,'reply']],
    ['teacher',teacherAction,'sendTeacherMessage',[{studentId:'',studentName:'테스트',title:'title',content:'body'}]],
  ]){
    const token=createSession({role,...(role==='student'?{studentId:'0',name:'테스트'}:{}),exp:now+3600},now);
    const req=Readable.from([Buffer.from(JSON.stringify({action,params}))]);req.method='POST';req.headers={cookie:`caffeine_session=${encodeURIComponent(token)}`};
    const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
    await create({now:()=>now,callGas:async()=>{gasCalls++;}})(req,res);
    assert.equal(res.statusCode,400);assert.equal(res.body.error,'INVALID_INPUT');
  }
  assert.equal(gasCalls,0);
});

test('caffeine required name, amount, reason and symptom failures do not submit',()=>{
  for(const [name,amount,reasons,symptoms] of [['','0',[],[]],['음료','',[],[]],['음료','-1',[],[]],['음료','10',[],[]],['음료','10',[{value:'피로'}],[]]]){
    const fields={drinkName:{value:name},customAmount:{value:amount},caffeineTime:{value:'2026-10-09T06:00'},caffeineReasonEtc:{value:''}};let notices=0;
    const context=vm.createContext({document:{getElementById:id=>fields[id]||null,querySelectorAll:query=>query.includes('Reason')?reasons:symptoms},
      showInfoModal(){notices++;},google:{script:{run:{get withSuccessHandler(){assert.fail('invalid caffeine submitted');}}}}});
    vm.runInContext(extract(student,'submitCaffeine'),context);context.submitCaffeine();assert.equal(notices,1);
  }
});

test('sleep missing choices and reversed date-time fail before any write',()=>{
  for(const [start,end,choices] of [['','',''],['2026-10-09T23:00','2026-10-09T07:00','all'],['2026-10-09T23:00','2026-10-10T07:00','']]){
    const fields={sleepStart:{value:start},sleepEnd:{value:end},sleepMemo:{value:''},sleepDate:{}};let notices=0;
    const context=vm.createContext({user:{studentId:'0',name:'테스트'},selectedCondition:{emoji:'😐'},sleepChoices:choices?{smartphone:'안 함',activity:'안 함',latency:'15분 이내',awakenings:'없음',daytime:'없음'}:{},
      document:{getElementById:id=>fields[id]||null},console:{log(){}},datePartFromDatetime:v=>v.slice(0,10),showInfoModal(){notices++;},
      proceedSaveSleep(){assert.fail('invalid sleep submitted');}});
    vm.runInContext(extract(student,'getMissingSleepFields')+'\n'+extract(student,'submitSleep'),context);context.submitSleep();assert.equal(notices,1);
  }
});

test('pending message and reply forms cannot be closed or replaced before acknowledgment',()=>{
  for(const [html,name,indent] of [[student,'closeStudentReplyModal','    '],[student,'openReplyModal','    '],[teacher,'closeReplyModal',''],[teacher,'openReplyModal',''],[teacher,'closeMsgSendModal',''],[teacher,'openMsgSendModal','']]){
    const btn={disabled:true};
    const context=vm.createContext({document:{getElementById:id=>id==='studentReplySendBtn'?btn:null,querySelector:()=>btn}});
    vm.runInContext(extract(html,name,indent),context);context[name](2,'title','content');
  }
});

test('teacher reply sends the identity captured when the draft was opened',()=>{
  const f=form(teacher,'submitReply','replyToInquiry','');f.invoke();
  assert.deepEqual(f.requests[0],[2,'valid text','a'.repeat(64)]);
});
test('changed inquiry target keeps the draft and refreshes the list',()=>{
  const f=form(teacher,'submitReply','replyToInquiry','');let reads=0;f.context.loadInquiries=()=>reads++;
  f.invoke();f.success({success:false,code:'INQUIRY_TARGET_CHANGED',error:'문의가 변경되었습니다.'});
  assert.equal(f.fields.replyContent.value,'valid text');assert.equal(f.fields.replyModal.style.display,'block');
  assert.equal(f.replyBtn.disabled,false);assert.equal(reads,1);
});
test('teacher reply and delete policies require a verified inquiry key',()=>{
  for(const value of [undefined,'',12,'a'.repeat(63),'z'.repeat(64)]) {
    assert.throws(()=>normalizeTeacherRequest('replyToInquiry',[2,'reply',value]));
    assert.throws(()=>normalizeTeacherRequest('deleteInquiry',[2,value]));
  }
  assert.deepEqual(normalizeTeacherRequest('deleteInquiry',[2,'a'.repeat(64)]).params,[2,'a'.repeat(64)]);
});
test('popup acknowledgment rejection refreshes the inquiry list and alerts once without changing the reply draft',()=>{
  const fields={inquiryPopupClose:{},inquiryPopupGoBtn:{},replyContent:{value:'보존할 응답'}};
  const overlay={style:{},querySelectorAll:()=>[],remove(){}};let reads=0;const notices=[],callbacks=[];
  const runner={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},
    markInquiryNotified(row,key){assert.equal(key,'a'.repeat(64));callbacks.push({success:this.success,failure:this.failure});}};
  const context=vm.createContext({document:{getElementById:id=>fields[id]||null,createElement:()=>overlay,body:{appendChild(){}}},
    google:{script:{run:runner}},escapeHtml:x=>x,formatTimestamp:x=>x,loadInquiries(){reads++;},showTeacherModal:(...x)=>notices.push(x)});
  vm.runInContext(extract(teacher,'showInquiryPopup',''),context);
  context.showInquiryPopup([{rowIndex:2,inquiryKey:'a'.repeat(64)},{rowIndex:3,inquiryKey:'a'.repeat(64)}]);fields.inquiryPopupClose.onclick();
  assert.equal(typeof callbacks[0].success,'function');callbacks[0].success({success:false,code:'INQUIRY_TARGET_CHANGED'});
  callbacks[1].failure(new Error('offline'));assert.equal(reads,1);assert.equal(notices.length,1);assert.equal(fields.replyContent.value,'보존할 응답');
});
