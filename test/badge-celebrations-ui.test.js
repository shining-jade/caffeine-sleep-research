import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=n=>{const a=html.indexOf('    function '+n+'(');return html.slice(a,html.indexOf('\n    }',a)+6);};
test('receiving teacher data cannot bypass the server celebration claim',()=>{let refresh=0,direct=0;const c=vm.createContext({console:{log(){}},teacherAwards:[],document:{hidden:false,getElementById:()=>null},window:{badgeCelebrations:{refresh(){refresh++;}}},_pruneSeenAwardIds(){},getNewTeacherAwards:a=>a,_renderTeacherAwardSection(){},_updateTeacherBubble(){},_showTeacherBadgeModal(){direct++;},showUpdateNotification(){direct++;}});vm.runInContext(extract('_applyTeacherAwards'),c);c._applyTeacherAwards([{name:'합성',grantedAt:'now'}]);assert.equal(direct,0);assert.equal(refresh,1);});
test('automatic-only celebration confirmation never acknowledges an undisplayed teacher award',()=>{let marked,closed=0;const c=vm.createContext({window:{activeBadgeCelebrations:[{kind:'automatic',name:'기록 첫걸음'}],badgeCelebrations:{closed(){closed++;}}},document:{getElementById:()=>({style:{}})},teacherAwards:[{awardId:'hidden-teacher',name:'합성'}],markTeacherAwardsSeen:a=>{marked=a;},getNewTeacherAwards:a=>a,_updateTeacherBubble(){},_renderTeacherAwardSection(){},showTab(){}});vm.runInContext(extract('closeTeacherBadgeModal'),c);c.closeTeacherBadgeModal();assert.equal(marked.length,0);assert.equal(closed,1);});
test('only newly server-synced receipts for the current account trigger automatic celebration checks',()=>{let refresh=0;const listeners={};const c=vm.createContext({user:{studentId:'9999',name:'합성'},google:{},getComputedStyle:()=>({display:'none'}),_showTeacherBadgeModal(){},showUpdateNotification(){},BadgeCelebrations:{create:()=>({refresh(){refresh++;},closed(){}})},window:{addEventListener:(k,f)=>listeners[k]=f},document:{hidden:false,addEventListener(){},getElementById:()=>({})}});vm.runInContext(fs.readFileSync(new URL('../public/js/badge-celebrations-ui.js',import.meta.url),'utf8'),c);const event=state=>({detail:[{owner:'["9999","합성"]',state,mutationId:'receipt-a'}]});listeners['student-sync-change'](event('pending'));assert.equal(refresh,0);listeners['student-sync-change'](event('synced'));assert.equal(refresh,1);listeners['student-sync-change'](event('synced'));assert.equal(refresh,1);listeners['student-sync-change']({detail:[{owner:'["9998","다른"]',state:'synced',mutationId:'receipt-b'}]});assert.equal(refresh,1);});
test('calendar automatic badges use the same waking dates as server claims',()=>{const els=new Map();const c=vm.createContext({user:{studentId:'9999'},teacherAwards:[],badgeConfig:null,getTodayKST:()=> '2026-10-25',getLogDateKST:t=>t.slice(0,10),SleepRecordPolicy:{describe:r=>({wakeDate:r.wakeDate})},caffeineLogs:[{time:'2026-10-13T12:00'},{time:'2026-10-14T12:00'},{time:'2026-10-15T12:00'}],sleepLogs:[{date:'2026-10-12',wakeDate:'2026-10-13'},{date:'2026-10-13',wakeDate:'2026-10-14'},{date:'2026-10-14',wakeDate:'2026-10-15'}],document:{getElementById:id=>{if(!els.has(id))els.set(id,{classList:{add(){},toggle(){}}});return els.get(id);}}});vm.runInContext(fs.readFileSync(new URL('../public/js/badge-journey.js',import.meta.url),'utf8')+'\n'+extract('updateBadges'),c);c.updateBadges();assert.match(els.get('journey-total-days').textContent,/3일/);assert.match(els.get('challengeBadgeGrid').innerHTML,/기록하며 얻은 뱃지/);});

function unreadBubbleSetup(displayed) {
  const awards=[{awardId:'teacher_a',name:'합성 A',grantedAt:'2026-10-25 10:00:00',seenAt:''},{awardId:'teacher_b',name:'합성 B',grantedAt:'2026-10-25 11:00:00',seenAt:''},{awardId:'teacher_old',name:'이미 확인',grantedAt:'2026-10-24 10:00:00',seenAt:'2026-10-24 11:00:00'}];
  const data=new Map(),bubble={textContent:'2',style:{display:'inline-block'}},modal={style:{display:'flex'}};
  const runner={withSuccessHandler(){return this;},withFailureHandler(){return this;},markTeacherAwardsSeen(){}};
  const c=vm.createContext({user:{studentId:'9999',name:'합성검증'},teacherAwards:awards,window:{activeBadgeCelebrations:displayed?.(awards),badgeCelebrations:{closed(){}}},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},document:{getElementById:id=>id==='teacherBadgeModal'?modal:id==='teacherBadgeBubble'?bubble:null},google:{script:{run:runner}},console:{warn(){}},_renderTeacherAwardSection(){},showTab(){}});
  vm.runInContext(['_taBadgeKey','getSeenTeacherAwardIds','_teacherAwardSeenQueueKey','_readTeacherAwardSeenQueue','_writeTeacherAwardSeenQueue','_flushTeacherAwardSeenQueue','markTeacherAwardsSeen','_awardKey','getNewTeacherAwards','_updateTeacherBubble','closeTeacherBadgeModal'].map(extract).join('\n'),c);
  return{c,bubble,modal};
}
test('closing automatic-only celebration preserves the unread teacher bubble immediately',()=>{
  const s=unreadBubbleSetup(()=>[{kind:'automatic',name:'기록 첫걸음'}]);s.c.closeTeacherBadgeModal();
  assert.equal(s.modal.style.display,'none');assert.equal(s.bubble.style.display,'inline-block');assert.equal(s.bubble.textContent,'2');
  assert.deepEqual(Array.from(s.c.getNewTeacherAwards(s.c.teacherAwards),a=>a.awardId),['teacher_a','teacher_b']);assert.equal(s.c._readTeacherAwardSeenQueue().length,0);
});
test('closing mixed celebration removes only displayed teacher awards from the unread bubble',()=>{
  const s=unreadBubbleSetup(a=>[{kind:'automatic',name:'기록 첫걸음'},{...a[0],kind:'teacher'}]);s.c.closeTeacherBadgeModal();
  assert.equal(s.bubble.style.display,'inline-block');assert.equal(s.bubble.textContent,'1');
  assert.deepEqual(Array.from(s.c.getNewTeacherAwards(s.c.teacherAwards),a=>a.awardId),['teacher_b']);assert.equal(s.c._readTeacherAwardSeenQueue().length,1);
});
test('closing all displayed teacher awards hides the bubble after real local acknowledgment',()=>{
  const s=unreadBubbleSetup(a=>a.slice(0,2).map(item=>({...item,kind:'teacher'})));s.c.closeTeacherBadgeModal();
  assert.equal(s.bubble.style.display,'none');assert.equal(s.c.getNewTeacherAwards(s.c.teacherAwards).length,0);assert.equal(s.c._readTeacherAwardSeenQueue().length,2);
});
test('legacy teacher confirmation without an active claim batch still clears acknowledged unread awards',()=>{
  const s=unreadBubbleSetup(undefined);s.c.closeTeacherBadgeModal();assert.equal(s.bubble.style.display,'none');assert.equal(s.c.getNewTeacherAwards(s.c.teacherAwards).length,0);
});
