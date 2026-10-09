import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizeStudentRequest} from '../api/_lib/student-policy.js';

const html=fs.readFileSync('index.html','utf8');
function extract(name){const start=html.indexOf(`    function ${name}(`);assert.ok(start>=0,name);const end=html.indexOf('\n    function ',start+10);return html.slice(start,end);}
test('fresh browser sessions use the server confirmation state instead of local reply history',()=>{
 for(const seen of [false,true]){
  let success;const popups=[];
  const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getMyInquiries(){}};
  const c=vm.createContext({user:{studentId:'0',name:'합성학생'},google:{script:{run:runner}},setNotificationReadError(){},showReplyPopup:rows=>popups.push(rows),localStorage:{getItem(){throw Error('browser storage unavailable');}}});
  vm.runInContext(extract('checkReplyBubble'),c);c.checkReplyBubble();
  success({success:true,data:[{status:'응답완료',reply:'답변',replyKey:'a'.repeat(64),replySeen:seen}]});
  assert.equal(popups.length,seen?0:1);
 }
});
test('reply confirmation uses the signed identity and validates reply keys',()=>{
 const session={role:'student',studentId:'0',name:'합성학생'};
 const result=normalizeStudentRequest('markInquiryRepliesSeen',['spoofed','wrong',['a'.repeat(64)]],session);
 assert.deepEqual(result.params,['0','합성학생',['a'.repeat(64)]]);
 for(const keys of [[],['bad'],Array(101).fill('a'.repeat(64))])assert.throws(()=>normalizeStudentRequest('markInquiryRepliesSeen',['0','합성학생',keys],session),{code:'INVALID_INPUT'});
});
test('confirmation promises reject failures and never accept success from a different login',async()=>{
 let success,failure;const calls=[];
 const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},markInquiryRepliesSeen(...args){calls.push(args);}};
 const c=vm.createContext({user:{studentId:'0',name:'합성학생'},google:{script:{run:runner}},Promise,Error});
 vm.runInContext(extract('acknowledgeInquiryReplies'),c);
 const replies=[{replyKey:'a'.repeat(64)}];
 let pending=c.acknowledgeInquiryReplies(replies);success({success:false});await assert.rejects(pending);
 pending=c.acknowledgeInquiryReplies(replies);failure(Error('offline'));await assert.rejects(pending);
 pending=c.acknowledgeInquiryReplies(replies);c.user={studentId:'1',name:'다른학생'};success({success:true});await assert.rejects(pending);
 c.user={studentId:'0',name:'합성학생'};pending=c.acknowledgeInquiryReplies(replies);success({success:true});await pending;
 assert.deepEqual(Array.from(calls[3].slice(0,2)),['0','합성학생']);
});
test('popup stays open on failed confirmation, blocks duplicate clicks, then closes after successful retry',async()=>{
 const fields={};let overlay,resolve,reject,calls=0;
 for(const id of ['replyPopupConfirmBtn','replyPopupAskBtn','replyPopupError'])fields[id]={style:{},disabled:false};
 const c=vm.createContext({document:{getElementById:id=>fields[id]||null,createElement:()=>({style:{},remove(){this.removed=true;}}),body:{appendChild(el){overlay=el;}}},
  escapeHtml:s=>s,formatTimestamp:s=>s,
  checkReplyBubble(){},
  acknowledgeInquiryReplies(){calls++;return new Promise((ok,bad)=>{resolve=ok;reject=bad;});}});
 vm.runInContext(extract('showReplyPopup'),c);c.showReplyPopup([{title:'문의',content:'내용',reply:'답변',replyTime:'시간'}]);
 let pending=fields.replyPopupConfirmBtn.onclick();await fields.replyPopupConfirmBtn.onclick();
 assert.equal(calls,1);assert.equal(fields.replyPopupConfirmBtn.disabled,true);assert.equal(overlay.removed,undefined);
 reject(Error('offline'));await pending;
 assert.equal(overlay.removed,undefined);assert.equal(fields.replyPopupConfirmBtn.disabled,false);assert.equal(fields.replyPopupError.style.display,'block');
 pending=fields.replyPopupConfirmBtn.onclick();resolve();await pending;
 assert.equal(calls,2);assert.equal(overlay.removed,true);
});
test('reply popup batches large unread histories into at most 100 replies',()=>{
 let success,count=0;const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getMyInquiries(){}};
 const c=vm.createContext({user:{studentId:'0'},google:{script:{run:runner}},setNotificationReadError(){},showReplyPopup:rows=>count=rows.length});
 vm.runInContext(extract('checkReplyBubble'),c);c.checkReplyBubble();
 success({success:true,data:Array.from({length:101},()=>({status:'응답완료',reply:'답변',replySeen:false}))});
 assert.equal(count,100);
});
test('changed reply replaces the stale popup instead of trapping retries of its old key',async()=>{
 const fields={};let overlay,refreshes=0;
 for(const id of ['replyPopupConfirmBtn','replyPopupAskBtn','replyPopupError'])fields[id]={style:{}};
 const c=vm.createContext({document:{getElementById:id=>fields[id]||null,createElement:()=>({style:{},remove(){this.removed=true;}}),body:{appendChild(el){overlay=el;}}},
  escapeHtml:s=>s,formatTimestamp:s=>s,checkReplyBubble(){refreshes++;},
  acknowledgeInquiryReplies:()=>Promise.reject(Object.assign(Error('changed'),{code:'INQUIRY_TARGET_CHANGED'}))});
 vm.runInContext(extract('showReplyPopup'),c);c.showReplyPopup([{title:'문의',content:'내용',reply:'답변',replyTime:'시간'}]);
 await fields.replyPopupConfirmBtn.onclick();
 assert.equal(overlay.removed,true);assert.equal(refreshes,1);
});
