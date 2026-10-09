import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeStudentRequest} from '../api/_lib/student-policy.js';
import {normalizeTeacherRequest} from '../api/_lib/teacher-policy.js';
const student=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const teacher=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function extract(source,name,indent=''){const start=source.indexOf(`${indent}function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf(`\n${indent}}`,start)+indent.length+2);}
const key='a'.repeat(64),otherKey='b'.repeat(64);
test('student reply carries the modal identity and preserves the draft when the message is missing',()=>{
 const fields={studentReplyText:{value:'보존할 답장'},studentReplySendBtn:{disabled:false,textContent:'수정하기'},studentReplyModal:{dataset:{messageKey:key},remove(){this.removed=true;}}};
 let success,reads=0;const calls=[],notices=[];
 const run={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},replyToTeacherMessage(...params){calls.push(params);}};
 const context=vm.createContext({document:{getElementById:id=>fields[id]},google:{script:{run}},loadTeacherMessages(){reads++;},alert:m=>notices.push(m)});
 vm.runInContext(extract(student,'submitStudentReply','    '),context);context.submitStudentReply(3);
 assert.deepEqual(calls[0],[3,'보존할 답장',key]);success({success:false,code:'MESSAGE_TARGET_CHANGED'});
 assert.equal(fields.studentReplyText.value,'보존할 답장');assert.equal(fields.studentReplyModal.removed,undefined);assert.equal(reads,1);assert.equal(fields.studentReplySendBtn.disabled,false);
});
test('single and bulk delete keep original target snapshots while the list changes during confirmation',()=>{
 for(const name of ['confirmDeleteSentMsg','confirmBulkDeleteSentMsg']) {
  const calls=[];let confirm;
  const run={withSuccessHandler(){return this;},withFailureHandler(){return this;},deleteTeacherMessage(...x){calls.push(x);},deleteBulkTeacherMessages(...x){calls.push(x);}};
  const context=vm.createContext({window:{_sentMsgSelected:new Set([3]),_sentMsgTargets:new Map([[3,{rowIndex:3,messageKey:key}]])},
   google:{script:{run}},showTeacherModal(_e,_t,_m,_type,cb){confirm=cb;},loadSentMessages(){},escapeHtml:x=>x});
  vm.runInContext(extract(teacher,name),context);context[name](3,'B',key);
  context.window._sentMsgTargets.set(3,{rowIndex:3,messageKey:otherKey});confirm();
  const target=name==='confirmDeleteSentMsg'?calls[0][1]:calls[0][0][0].messageKey;assert.equal(target,key);
 }
});
test('message mutation policies reject missing keys, duplicate and mixed bulk targets',()=>{
 const subject={role:'student',studentId:'0',name:'합성학생'};
 assert.throws(()=>normalizeStudentRequest('replyToTeacherMessage',[3,'reply'],subject));
 assert.throws(()=>normalizeStudentRequest('markTeacherMessageRead',[3],subject));
 assert.throws(()=>normalizeTeacherRequest('deleteTeacherMessage',[3]));
 assert.throws(()=>normalizeTeacherRequest('markStudentReplyRead',[3,key]));
 for(const targets of [[3,3],[],[{rowIndex:3,messageKey:key},{rowIndex:3,messageKey:key}],[{rowIndex:3,messageKey:key},{rowIndex:4,messageKey:'bad'}]])assert.throws(()=>normalizeTeacherRequest('deleteBulkTeacherMessages',[targets]));
 assert.deepEqual(normalizeTeacherRequest('deleteBulkTeacherMessages',[[{rowIndex:3,messageKey:key}]]).params,[[{rowIndex:3,messageKey:key}]]);
});
function node(data={}){return {...data,style:{display:'none'},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelector(){return null;}};}
test('teacher selection displays the bulk toolbar and select-all without a global callback',()=>{
 const checkboxes=[node({checked:false,dataset:{rowindex:'3'}}),node({checked:false,dataset:{rowindex:'4'}})];
 const all=node({checked:false}),bar=node(),label=node({textContent:''}),deleteButtons=[node({dataset:{rowindex:'3'}}),node({dataset:{rowindex:'4'}})];bar.querySelector=()=>label;
 const list=node();list.querySelectorAll=selector=>selector.includes('sent-msg-cb')?checkboxes:selector.includes('sent-msg-delete')?deleteButtons:[];
 let success;const context=vm.createContext({window:{},document:{getElementById:id=>({sentMessageList:list,sentMsgBatchBar:bar,batchSelCount:label,sentMsgSelectAll:all})[id],querySelectorAll:()=>checkboxes},
  google:{script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getSentTeacherMessages(){}}}},
  ReadFeedback:{begin:()=>true,success:()=>true},escapeHtml:x=>x,formatMsgDate:x=>x,formatTeacherMsgContent:x=>x,confirmDeleteSentMsg(){}});
 vm.runInContext(extract(teacher,'loadSentMessages'),context);context.loadSentMessages();success({success:true,data:[{rowIndex:3,messageKey:key,title:'B',content:'body'},{rowIndex:4,messageKey:otherKey,title:'C',content:'body'}]});
 assert.equal(typeof checkboxes[0].listeners.change,'function');checkboxes[0].checked=true;checkboxes[0].listeners.change();
 assert.equal(bar.style.display,'flex');assert.equal(label.textContent,'1개 선택됨');assert.equal(context.window._sentMsgSelected.size,1);
 all.checked=true;all.listeners.change();assert.equal(context.window._sentMsgSelected.size,2);assert.equal(label.textContent,'2개 선택됨');
 all.checked=false;all.listeners.change();assert.equal(context.window._sentMsgSelected.size,0);assert.equal(bar.style.display,'none');
});
test('student read acknowledgment sends identities and reports failures once without dropping unread notices',()=>{
 const callbacks=[],calls=[],counts=[],notices=[];
 const run={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},markTeacherMessageRead(...args){calls.push(args);callbacks.push({success:this.success,failure:this.failure});}};
 const context=vm.createContext({google:{script:{run}},updateMsgBubble:x=>counts.push(x),showInfoModal:(...x)=>notices.push(x)});
 vm.runInContext(extract(student,'acknowledgeTeacherMessages','    '),context);context.acknowledgeTeacherMessages([{rowIndex:3,messageKey:key},{rowIndex:4,messageKey:otherKey}]);
 assert.deepEqual(calls,[[3,key],[4,otherKey]]);callbacks[0].success({success:false,code:'MESSAGE_TARGET_CHANGED'});callbacks[1].failure(new Error('offline'));
 assert.equal(notices.length,1);assert.equal(counts.at(-1),2);
});
test('teacher popup acknowledges the displayed reply version and reports stale or failed acknowledgments once',()=>{
 const fields={studentReplyPopupClose:{}};const overlay={style:{},remove(){}};let reads=0;const notices=[],calls=[],callbacks=[];
 const run={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},markStudentReplyRead(...args){calls.push(args);callbacks.push({success:this.success,failure:this.failure});}};
 const context=vm.createContext({document:{getElementById:id=>fields[id]||null,createElement:()=>overlay,body:{appendChild(){}}},google:{script:{run}},escapeHtml:x=>x,formatMsgDate:x=>x,loadSentMessages(){reads++;},showTeacherModal:(...x)=>notices.push(x)});
 vm.runInContext(extract(teacher,'showStudentReplyPopup'),context);context.showStudentReplyPopup([{rowIndex:3,messageKey:key,replyKey:otherKey},{rowIndex:4,messageKey:otherKey,replyKey:key}]);fields.studentReplyPopupClose.onclick();
 assert.deepEqual(calls,[[3,key,otherKey],[4,otherKey,key]]);callbacks[0].success({success:false,code:'MESSAGE_TARGET_CHANGED'});callbacks[1].failure(new Error('offline'));assert.equal(notices.length,1);assert.ok(reads>=1);
});
