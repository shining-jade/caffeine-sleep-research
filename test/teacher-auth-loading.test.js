import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('public/js/teacher-auth.js','utf8');
function setup(getSession,startApp){let ready;const nodes=new Map();let started=0;const make=()=>({style:{},dataset:{},id:'',innerHTML:'',textContent:'',appendChild(n){nodes.set(n.id,n);},querySelector(){return {addEventListener(){}}},addEventListener(){},remove(){nodes.delete(this.id)},focus(){}});const document={documentElement:{classList:{add(){},remove(){}}},head:make(),body:make(),createElement:make,getElementById:id=>nodes.get(id),querySelector:()=>null,addEventListener(_event,fn){ready=fn}};const window={appAuth:{getSession,onSessionExpired(){}},startTeacherApp(){started++;return startApp?.()}};vm.runInNewContext(source,{document,window});return {ready,nodes,window,get started(){return started}};}
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
