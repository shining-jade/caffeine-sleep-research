import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {randomUUID} from 'node:crypto';import {IDBFactory} from 'fake-indexeddb';import test from 'node:test';
test('actual IndexedDB commits survive restarting the sync instance and separate students',async()=>{
 const c=vm.createContext({window:{},indexedDB:new IDBFactory(),crypto:{randomUUID},Date,JSON,setTimeout:()=>0,clearTimeout(){}});vm.runInContext(fs.readFileSync('public/js/student-sync.js','utf8'),c);
 const first=c.window.StudentSync.create({send:async()=>{throw new Error('offline');},online:()=>false});first.setSubject({studentId:'2101',name:'합성'});await first.enqueue('saveCaffeineData',{drink:'합성',mg:0,time:'2026-10-08 12:00:00'});
 const second=c.window.StudentSync.create({send:async()=>{},online:()=>false});second.setSubject({studentId:'2101',name:'합성'});assert.equal((await second.list()).length,1);
 second.setSubject({studentId:'2102',name:'다른'});assert.equal((await second.list()).length,0);
});
test('actual IndexedDB lease serializes tabs and permits the original owner to release',async()=>{
 const c=vm.createContext({window:{},indexedDB:new IDBFactory(),crypto:{randomUUID},Date,JSON,setTimeout:()=>0,clearTimeout(){}});vm.runInContext(fs.readFileSync('public/js/student-sync.js','utf8'),c);const store=c.window.StudentSync.indexedStore();assert.equal(await store.lease('owner','tab1'),true);assert.equal(await store.lease('owner','tab2'),false);await store.release('owner','tab2');assert.equal(await store.lease('owner','tab2'),false);await store.release('owner','tab1');assert.equal(await store.lease('owner','tab2'),true);
});

test('offline bootstrap includes confirmed durable records and latest confirmed profile',async()=>{
 const c=vm.createContext({window:{},indexedDB:new IDBFactory(),crypto:{randomUUID},Date,JSON,setTimeout:()=>0,clearTimeout(){}});vm.runInContext(fs.readFileSync('public/js/student-sync.js','utf8'),c);
 let connected=false; const sync=c.window.StudentSync.create({send:async(_,p)=>({success:true,mutationId:p._sync.mutationId,recordId:'confirmed-'+p._sync.mutationId,committedAt:'2026-10-08T00:00:00Z',...('weight' in p?{version:'new'}:{})}),online:()=>connected});sync.setSubject({studentId:'2101',name:'합성'});
 await sync.capture('getStudentBootstrap',{weight:{success:true,weight:50,syncVersion:'old'},caffeineLogs:[],sleepLogs:[]});
 await sync.enqueue('saveCaffeineData',{drink:'합성',mg:10,time:'2026-10-08 12:00:00'});
 await sync.enqueue('saveSleepData',{date:'2026-10-07',hours:5});
 await sync.enqueue('saveInitialSetup',{weight:60});
 connected=true; await sync.flush(true); assert.equal((await sync.list()).filter(r=>r.state==='synced').length,3);
 const restarted=c.window.StudentSync.create({send:async()=>{},online:()=>false});restarted.setSubject({studentId:'2101',name:'합성'});
 const restored=await restarted.read('getStudentBootstrap');assert.equal(restored.caffeineLogs.length,1);assert.equal(restored.sleepLogs.length,1);assert.equal(restored.weight.weight,60);
});
