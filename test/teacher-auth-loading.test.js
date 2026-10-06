import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('public/js/teacher-auth.js','utf8');
function setup(getSession){let ready;const nodes=new Map();let started=0;const make=()=>({dataset:{},id:'',innerHTML:'',textContent:'',appendChild(n){nodes.set(n.id,n);},querySelector(){return {addEventListener(){}}},addEventListener(){},remove(){nodes.delete(this.id)},focus(){}});const document={documentElement:{classList:{add(){},remove(){}}},head:make(),body:make(),createElement:make,getElementById:id=>nodes.get(id),querySelector:()=>null,addEventListener(_event,fn){ready=fn}};const window={appAuth:{getSession,onSessionExpired(){}},startTeacherApp(){started++}};vm.runInNewContext(source,{document,window});return {ready,nodes,get started(){return started}};}
test('valid existing teacher session never displays password form during refresh',async()=>{
 let release;const x=setup(()=>new Promise(resolve=>release=resolve));const task=x.ready();assert.ok(x.nodes.get('teacherAuthOverlay').innerHTML.includes('로그인 상태 확인 중'));assert.ok(!x.nodes.get('teacherAuthOverlay').innerHTML.includes('type="password"'));release({});await task;assert.equal(x.nodes.has('teacherAuthOverlay'),false);assert.equal(x.started,1);
});
test('password form appears only after session check rejects',async()=>{
 const x=setup(async()=>{throw new Error('expired')});await x.ready();assert.ok(x.nodes.get('teacherAuthOverlay').innerHTML.includes('type="password"'));
});
