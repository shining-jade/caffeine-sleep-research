import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const student=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const teacher=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function extract(html,name,indent='    ') {
  const start=html.indexOf(`${indent}function ${name}(`);
  assert.ok(start>=0,name);
  const end=html.indexOf(`\n${indent}}`,start)+indent.length+2;
  return html.slice(start,end);
}

for (const [html,name,id,action,indent] of [
  [student,'loadMyInquiries','myInquiriesContainer','getMyInquiries','    '],
  [student,'loadTeacherMessages','teacherMsgContainer','getTeacherMessages','    '],
  [teacher,'loadInquiries','inquiryList','getInquiries',''],
  [teacher,'loadSentMessages','sentMessageList','getSentTeacherMessages',''],
]) {
  test(`${name} preserves existing content while loading and after transport or invalid payload failure`,()=>{
    for(const bad of [null,{success:false},{success:true,data:null},{success:true,data:{}}]) {
      const container={innerHTML:'confirmed PDF and draft reply'};
      let success,failure,failed=0;
      const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},[action](){} };
      const context=vm.createContext({user:{studentId:'0'},window:{_sentMsgSelected:new Set([7])},
        document:{getElementById:key=>key===id?container:null},google:{script:{run:runner}},
        ReadFeedback:{begin(){return true;},success(){return true;},fail(){failed++;}},
        allInquiries:[{title:'confirmed'}],inquiryFilter:'all',updateInquiryStats(){},renderInquiries(){},updateMsgBubble(){}});
      vm.runInContext(extract(html,name,indent)+`\n${name}();`,context);
      assert.equal(container.innerHTML,'confirmed PDF and draft reply','loading must preserve nodes');
      failure(new Error('offline'));
      assert.equal(container.innerHTML,'confirmed PDF and draft reply','network failure');
      success(bad);
      assert.equal(container.innerHTML,'confirmed PDF and draft reply','malformed response');
      assert.equal(failed,2);
      assert.equal(context.window._sentMsgSelected.has(7),true);
      assert.equal(context.allInquiries[0].title,'confirmed');
    }
  });
  test(`${name} renders genuine successful empty response`,()=>{
    const container={innerHTML:'old'};let success,confirmed=0;
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},[action](){} };
    const context=vm.createContext({user:{studentId:'0'},window:{},
      document:{getElementById:()=>container},google:{script:{run:runner}},
      ReadFeedback:{begin(){return true;},success(){confirmed++;return true;},fail(){assert.fail('valid empty');}},
      allInquiries:[1],inquiryFilter:'all',updateInquiryStats(){},renderInquiries(){container.innerHTML='empty';},updateMsgBubble(){}});
    vm.runInContext(extract(html,name,indent)+`\n${name}();`,context);
    success({success:true,data:[]});
    assert.notEqual(container.innerHTML,'old');
    assert.equal(confirmed,1);
  });
  test(`${name} refuses to render a superseded read when a later refresh is pending`,()=>{
    const container={innerHTML:'confirmed'};let success;
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},[action](){} };
    const context=vm.createContext({user:{studentId:'0'},window:{},
      document:{getElementById:()=>container},google:{script:{run:runner}},
      ReadFeedback:{begin(){return true;},success(){return false;},fail(){assert.fail('valid');}},
      allInquiries:[{title:'confirmed'}],inquiryFilter:'all',updateInquiryStats(){assert.fail('stale stats');},renderInquiries(){assert.fail('stale render');},updateMsgBubble(){assert.fail('stale unread count');}});
    vm.runInContext(extract(html,name,indent)+`\n${name}();`,context);
    success({success:true,data:[]});
    assert.equal(container.innerHTML,'confirmed');
    assert.equal(context.allInquiries[0].title,'confirmed');
  });
}

test('award read errors preserve confirmed awards without applying legacy browser cache',()=>{
  for(const bad of [null,{success:false},{success:true,awards:null}]){
    let success,failure;const applied=[],notices=[];
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},getTeacherAwardsForStudent(){} };
    const context=vm.createContext({user:{studentId:'0'},console:{log(){},error(){}},google:{script:{run:runner}},
      setNotificationReadError:(kind,failed)=>notices.push([kind,failed]),
      _applyTeacherAwards:awards=>applied.push(awards),_flushTeacherAwardSeenQueue(){},
      _localStorageFallback(){assert.fail('obsolete fallback must not replace confirmed data');}});
    vm.runInContext(extract(student,'checkTeacherAwards')+'\ncheckTeacherAwards();',context);
    success(bad);failure(new Error('offline'));
    assert.equal(applied.length,0);
    assert.deepEqual(notices,[['awards',true],['awards',true]]);
    success({success:true,awards:[]});assert.equal(applied.length,1);
    assert.deepEqual(notices.at(-1),['awards',false]);
  }
});

for(const [name,action,kind] of [['checkMsgBubble','getTeacherMessages','messages'],['checkReplyBubble','getMyInquiries','replies']]){
  test(`${name} reports failed reads without clearing existing unread state`,()=>{
    let success,failure;const notices=[];let bubbles=0;
    const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},[action](){} };
    const context=vm.createContext({user:{studentId:'0'},google:{script:{run:runner}},
      setNotificationReadError:(type,failed)=>notices.push([type,failed]),updateMsgBubble(){bubbles++;},
      getSeenReplyKeys:()=>[],showNewMsgModal(){assert.fail('empty response');},showReplyPopup(){assert.fail('empty response');}});
    vm.runInContext(extract(student,name)+`\n${name}();`,context);
    success({success:false});success({success:true,data:null});failure(new Error('offline'));
    assert.equal(bubbles,0);assert.deepEqual(notices,[[kind,true],[kind,true],[kind,true]]);
    success({success:true,data:[]});assert.deepEqual(notices.at(-1),[kind,false]);
  });
}

test('teacher unread inquiry polling clears warning only on a valid result, including empty',()=>{
  let success,failure;const notices=[];
  const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},getUnreadInquiries(){} };
  const context=vm.createContext({document:{getElementById:()=>({})},google:{script:{run:runner}},
    ReadFeedback:{report:(_anchor,_kind,failed)=>notices.push(failed)},showInquiryPopup(){assert.fail('empty response');}});
  vm.runInContext(extract(teacher,'checkUnreadInquiries','')+'\ncheckUnreadInquiries();',context);
  success({success:true,data:null});failure(new Error('offline'));success({success:true,data:[]});
  assert.deepEqual(notices,[true,true,false]);
});
