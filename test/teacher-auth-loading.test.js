import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('public/js/teacher-auth.js','utf8');
function setup(getSession,startApp,options={}){
 let ready;const nodes=new Map();let started=0;const classes=new Set();
 const make=()=>({style:{},dataset:{},id:'',textContent:'',attributes:{},
  set innerHTML(value){this.markup=value;for(const match of value.matchAll(/id="([^"]+)"/g)){const child=make();child.id=match[1];nodes.set(child.id,child);}},
  get innerHTML(){return this.markup||'';},
  setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},
  appendChild(n){nodes.set(n.id,n);},querySelector(){return {addEventListener(){}}},
  addEventListener(type,fn){(this.listeners||={})[type]=fn;},remove(){nodes.delete(this.id)},focus(){}});
 const document={documentElement:{classList:{add(name){classes.add(name)},remove(name){classes.delete(name)}}},head:make(),body:make(),createElement:make,getElementById:id=>nodes.get(id),querySelector:()=>null,addEventListener(_event,fn){ready=fn}};
 const window={appAuth:{getSession,onSessionExpired(){}},setTimeout:options.setTimeout||((fn)=>Promise.resolve().then(fn)),startTeacherApp(){started++;return startApp?.()}};
 vm.runInNewContext(source,{document,window});return {ready,nodes,window,classes,get started(){return started}};
}
test('valid existing teacher session never displays password form during refresh',async()=>{
 let release;const x=setup(()=>new Promise(resolve=>release=resolve));const task=x.ready();assert.ok(x.nodes.get('teacherAuthOverlay').innerHTML.includes('로그인 상태 확인 중'));assert.ok(!x.nodes.get('teacherAuthOverlay').innerHTML.includes('type="password"'));release({});await task;assert.equal(x.nodes.has('teacherAuthOverlay'),false);assert.equal(x.started,1);
});
test('password form appears only after session check rejects',async()=>{
 const x=setup(async()=>{throw new Error('expired')});await x.ready();assert.ok(x.nodes.get('teacherAuthOverlay').innerHTML.includes('type="password"'));
});

test('dashboard remains covered until data load completes; completion reaches 100 percent',async()=>{
 let finish;const x=setup(async()=>({}),()=>new Promise(resolve=>finish=resolve));const progress=[];const update=x.window.teacherLoadingProgress;x.window.teacherLoadingProgress=(n,label)=>{progress.push(n);update(n,label)};
 const task=x.ready();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.nodes.has('teacherAuthOverlay'),true);assert.ok(!progress.includes(100));
 finish();await task;assert.equal(progress.at(-1),100);assert.equal(x.nodes.has('teacherAuthOverlay'),false);
});
test('data load failure preserves loading overlay and does not report 100 percent',async()=>{
 const x=setup(async()=>({}),async()=>{throw new Error('network')});const progress=[];const update=x.window.teacherLoadingProgress;x.window.teacherLoadingProgress=(n,label)=>{progress.push(n);update(n,label)};
 await x.ready();assert.equal(x.nodes.has('teacherAuthOverlay'),true);assert.ok(!progress.includes(100));assert.ok(!x.nodes.get('teacherAuthOverlay').innerHTML.includes('type="password"'));
});

test('rejected teacher session clears recent private view and never starts cached dashboard',async()=>{
 const x=setup(async()=>{throw new Error('expired')});let cleared=0;x.window.clearTeacherViewCache=()=>cleared++;
 await x.ready();assert.equal(cleared,1);assert.equal(x.started,0);
});

test('waiting for teacher data uses an indeterminate state rather than a stalled percentage',async()=>{
 let finish;const x=setup(async()=>({}),()=>new Promise(resolve=>finish=resolve));const task=x.ready();
 await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(x.nodes.get('teacherAuthOverlay').innerHTML,/teacherLoadingPercent/);
 assert.equal(x.nodes.get('teacherLoadingTitle').textContent,'대시보드 준비 중...');
 assert.equal(x.nodes.get('teacherLoadingBar').attributes['aria-valuenow'],undefined);
 assert.equal(x.nodes.get('teacherLoadingBar').attributes['aria-busy'],'true');
 finish();await task;
});

test('completed teacher data shows a completion state before revealing and fading into dashboard',async()=>{
 const timers=[];const x=setup(async()=>({}),async()=>{}, {setTimeout(fn,ms){timers.push({fn,ms})}});
 const task=x.ready();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.nodes.get('teacherLoadingTitle').textContent,'준비가 완료되었습니다');
 x.window.teacherLoadingProgress(90,'백그라운드 최신 자료 갱신');
 assert.equal(x.nodes.get('teacherLoadingTitle').textContent,'준비가 완료되었습니다');
 assert.equal(x.classes.has('teacher-auth-pending'),true);
 assert.equal(x.nodes.has('teacherAuthOverlay'),true);
 assert.ok(timers[0].ms>=200);timers.shift().fn();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.classes.has('teacher-auth-pending'),false);
 assert.equal(x.nodes.get('teacherAuthOverlay').dataset.leaving,'true');
 assert.equal(x.nodes.has('teacherAuthOverlay'),true);
 timers.shift().fn();await task;assert.equal(x.nodes.has('teacherAuthOverlay'),false);
});

test('failed initial teacher load stays gated and retry can complete normally',async()=>{
 let attempts=0;const x=setup(async()=>({}),async()=>{if(++attempts===1)throw new Error('timeout')});
 await x.ready();assert.equal(x.classes.has('teacher-auth-pending'),true);
 assert.equal(x.nodes.get('teacherLoadingBar').attributes['aria-busy'],'false');
 assert.equal(x.nodes.get('teacherLoadingTitle').textContent,'연결을 확인해주세요');
 assert.equal(x.nodes.get('teacherLoadingBar').attributes['aria-valuenow'],undefined);
 await x.nodes.get('teacherLoadingRetry').listeners.click();
 assert.equal(attempts,2);assert.equal(x.classes.has('teacher-auth-pending'),false);assert.equal(x.nodes.has('teacherAuthOverlay'),false);
});
