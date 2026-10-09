import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const start=html.indexOf(`    function ${name}(`);assert.ok(start>=0,name);return html.slice(start,html.indexOf('\n    }',start)+6);}
const raw='<img src=x onerror="alert(1)"> & "제목" ${1+1} `기호`';
const escaped='&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;제목&quot; ${1+1} `기호`';
const message={rowIndex:3,messageKey:'a'.repeat(64),title:raw,studentReply:raw,readStatus:'읽음',timestamp:'2026-10-09 12:00:00',content:raw};
function setup(){
 const fields={},overlays=[];
 const buttons=[{dataset:{messageIndex:'0'},addEventListener(type,handler){this[type]=handler;}}];
 function element(){return {style:{},dataset:{},innerHTML:'',appendChild(el){this.child=el;},remove(){this.removed=true;},querySelectorAll(){return buttons;}};}
 fields.teacherMsgContainer=element();fields.myInquiriesContainer=element();fields.studentReplySendBtn=element();fields.studentReplyCancelBtn=element();fields.studentReplyText={value:''};
 let callback;const run={withSuccessHandler(fn){callback=fn;return this;},withFailureHandler(){return this;},getTeacherMessages(){},getMyInquiries(){}};
 const context=vm.createContext({window:{},document:{getElementById:id=>fields[id]||null,createElement:element,body:{appendChild(el){overlays.push(el);}}},
  user:{studentId:'0'},google:{script:{run}},ReadFeedback:{begin:()=>true,success:()=>true,fail(){}},updateMsgBubble(){},acknowledgeTeacherMessages(){},closeStudentReplyModal(){},submitStudentReply(){},setTimeout(){}});
 vm.runInContext(fs.readFileSync(new URL('../public/js/safe-render.js',import.meta.url),'utf8')+'\nconst escapeHtml=window.safeRender.escapeHtml;'+['formatTimestamp','formatMsgDate','formatTeacherMsgContent'].map(extract).join('\n'),context);
 return {fields,overlays,buttons,context,respond:data=>callback({success:true,data})};
}

test('student message titles and replies remain plain text while body links stay clickable',()=>{
 const {context,fields,respond}=setup();vm.runInContext(extract('loadTeacherMessages'),context);context.loadTeacherMessages();respond([message]);
 const rendered=fields.teacherMsgContainer.innerHTML;
 assert.ok(rendered.includes(escaped));assert.doesNotMatch(rendered,/<img\b/);assert.doesNotMatch(rendered,/onclick=/);
 const body=context.formatTeacherMsgContent(raw+' https://example.invalid/report.pdf',{attachmentType:'pdf',attachmentUrl:'https://example.invalid/report.pdf'});
 assert.doesNotMatch(body,/<img\b/);assert.match(body,/href="https:\/\/example\.invalid\/report\.pdf"/);assert.match(body,/PDF 열기/);
});
test('reply and edit buttons pass literal titles and original message identities through click handlers',()=>{
 for(const reply of ['',raw]){
  const {context,buttons,respond}=setup();let selected;
  context.openReplyModal=(...args)=>{selected=args;};vm.runInContext(extract('loadTeacherMessages'),context);context.loadTeacherMessages();respond([{...message,studentReply:reply}]);
  assert.equal(typeof buttons[0].click,'function');buttons[0].click();assert.deepEqual(selected,[3,raw,!!reply,message.messageKey,reply]);
 }
});
test('student inquiry title body status and teacher response remain plain text',()=>{
 const {context,fields,respond}=setup();vm.runInContext(extract('loadMyInquiries'),context);context.loadMyInquiries();
 respond([{title:raw,content:raw,status:'응답완료',reply:raw,timestamp:'2026-10-09',replyTime:'2026-10-09'}]);
 const rendered=fields.myInquiriesContainer.child.innerHTML;assert.equal(rendered.split(escaped).length-1,3);assert.doesNotMatch(rendered,/<img\b/);
});
for(const [name,data] of [['showNewMsgModal',[message]],['showReplyPopup',[{title:raw,content:raw,reply:raw,timestamp:'2026-10-09',replyTime:'2026-10-09'}]]]){
 test(`${name} displays stored text without creating injected elements`,()=>{
  const {context,fields,overlays}=setup();for(const id of ['newMsgCloseBtn','newMsgReplyBtn','replyPopupConfirmBtn','replyPopupAskBtn'])fields[id]={};
  vm.runInContext(extract(name),context);context[name](data);
  const rendered=name==='showNewMsgModal'?overlays[0].child.innerHTML:overlays[0].innerHTML;
  assert.ok(rendered.includes(escaped));assert.doesNotMatch(rendered,/<img\b/);
 });
}
test('reply modal safely displays the title and binds buttons without inline generated code',()=>{
 const {context,fields,overlays}=setup();fields.studentReplySendBtn.disabled=false;vm.runInContext(extract('openReplyModal'),context);context.openReplyModal(3,raw,true,message.messageKey);
 assert.ok(overlays[0].innerHTML.includes(escaped));assert.doesNotMatch(overlays[0].innerHTML,/<img\b|onclick=/);
 assert.equal(overlays[0].dataset.messageKey,message.messageKey);
});
test('editing a reply prefills exact stored text without interpolating it into modal HTML',()=>{
 const reply='\n기존 답장 "내용" & ${1+1}\n</textarea><img src=x onerror="alert(1)">';
 const {context,fields,overlays}=setup();vm.runInContext(extract('openReplyModal'),context);context.openReplyModal(3,raw,true,message.messageKey,reply);
 assert.equal(fields.studentReplyText.value,reply);
 assert.doesNotMatch(overlays[0].innerHTML,/<img\b/);assert.equal(overlays[0].dataset.messageKey,message.messageKey);
});
test('a new reply starts empty even if a caller supplies previous text',()=>{
 const {context,fields}=setup();fields.studentReplyText.value='previous message';vm.runInContext(extract('openReplyModal'),context);context.openReplyModal(4,'새 메시지',false,'b'.repeat(64),'other reply');
 assert.equal(fields.studentReplyText.value,'');
});
test('opening another reply during a pending send cannot replace the current draft',()=>{
 const {context,fields,overlays}=setup();fields.studentReplySendBtn.disabled=true;fields.studentReplyText.value='전송 중 작성 내용';vm.runInContext(extract('openReplyModal'),context);context.openReplyModal(4,'다른 메시지',true,'b'.repeat(64),'다른 답장');
 assert.equal(fields.studentReplyText.value,'전송 중 작성 내용');assert.equal(overlays.length,0);
});
test('resumed student data loads without consulting removed image UI and refreshes only stale beverage cache',()=>{
 const name=html.includes('function loadStudentDataOnResume(')?'loadStudentDataOnResume':'waitForCameraAnalysisThenLoad';
 for(const fresh of [false,true]){
  const calls=[];const context=vm.createContext({user:{studentId:'0'},window:{},document:{getElementById(){assert.fail('Removed image UI must not gate record loading');}},
   localStorage:{getItem:()=>fresh?String(Date.now()):'0'},CAFFEINE_DB:[{}],Date,loadInitialStudentData(){calls.push('records');},loadCaffeineDbFromGAS(){calls.push('db');}});
  vm.runInContext(extract(name),context);context[name]();assert.deepEqual(calls,fresh?['records']:['records','db']);
 }
});
