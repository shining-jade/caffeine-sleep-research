import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function setup(){
 const classes=new Set();
 const elements=Object.fromEntries(['msgTargetId','msgTargetName','msgTargetLabel','msgTitle','msgContent','msgSendModal','studentModal','messagePanelLauncher'].map(id=>[id,{value:'',style:{},classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},focus(){this.focused=true;},setAttribute(){}}]));
 const button={disabled:false};
 const c=vm.createContext({currentStudentId:'a',studentsData:[{학번:'a',이름:'가상 A'},{학번:'b',이름:'가상 B'}],document:{getElementById:id=>elements[id],querySelector:()=>button}});
 for(const name of ['openMsgSendModal','closeMsgSendModal']){const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);vm.runInContext(html.slice(start,end),c);}
 return {c,e:elements,classes,button};
}
test('message panel keeps the draft when folded and reopened for the same student',()=>{
 const {c,e,classes}=setup();c.openMsgSendModal();e.msgTitle.value='기록 확인';e.msgContent.value='수면 날짜를 확인해 주세요';c.closeMsgSendModal();c.openMsgSendModal();
 assert.equal(e.msgTitle.value,'기록 확인');assert.equal(e.msgContent.value,'수면 날짜를 확인해 주세요');assert.equal(classes.has('message-panel-open'),true);
 c.closeMsgSendModal();assert.equal(classes.has('message-panel-open'),false);
});
test('opening the panel for another student resets the draft and captures the new recipient',()=>{
 const {c,e}=setup();c.openMsgSendModal();e.msgContent.value='A의 기록';c.closeMsgSendModal();c.currentStudentId='b';c.openMsgSendModal();
 assert.equal(e.msgTargetId.value,'b');assert.equal(e.msgTargetName.value,'가상 B');assert.equal(e.msgContent.value,'');
});
test('pending message cannot be folded or retargeted',()=>{
 const {c,e,button}=setup();c.openMsgSendModal();button.disabled=true;c.currentStudentId='b';c.closeMsgSendModal();c.openMsgSendModal();
 assert.equal(e.msgTargetId.value,'a');assert.equal(e.msgSendModal.style.display,'block');
});
