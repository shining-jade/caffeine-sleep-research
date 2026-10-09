import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';
const code=fs.readFileSync('public/js/student-sync.js','utf8');
function setup(send){const c=vm.createContext({window:{},crypto:{randomUUID:()=>String(++seq)},structuredClone,Date,JSON,setTimeout:()=>0,clearTimeout(){}});let seq=0;vm.runInContext(code,c);const rows=new Map();const store={put:async r=>rows.set(r.mutationId,structuredClone(r)),list:async owner=>[...rows.values()].filter(r=>r.owner===owner),lease:async()=>true,release:async()=>{},snapshot:async()=>null};const sync=c.window.StudentSync.create({store,send});sync.setSubject({studentId:'2101',name:'합성'});return {sync,rows};}
const payload={drink:'합성',mg:0,time:'2026-10-08 12:00:00'};

test('offline filtered statistics are isolated by queried end date and student',async()=>{
 const x=setup(async()=>{}), snapshots=new Map();
 x.sync.store.snapshot=async(key,value)=>{if(value!==undefined)snapshots.set(key,structuredClone(value));return snapshots.get(key);};
 await x.sync.capture('getFilteredStats',{todayTotal:150},['2101','2000-01-07']);
 await x.sync.capture('getFilteredStats',{todayTotal:50},['2101','2026-10-09']);
 assert.equal((await x.sync.read('getFilteredStats',undefined,['2101','2000-01-07'])).todayTotal,150);
 assert.equal((await x.sync.read('getFilteredStats',undefined,['2101','2026-10-09'])).todayTotal,50);
 await assert.rejects(x.sync.read('getFilteredStats',undefined,['2101','2026-10-10']),{code:'OFFLINE_CACHE_MISSING'});
 x.sync.setSubject({studentId:'2102',name:'다른'});
 await assert.rejects(x.sync.read('getFilteredStats',undefined,['2102','2000-01-07']),{code:'OFFLINE_CACHE_MISSING'});
});
test('local commit precedes sending and a failed send remains pending',async()=>{let x;x=setup(async()=>{assert.equal(x.rows.size,1);throw Object.assign(new Error('offline'),{code:'NETWORK_ERROR'});});const result=await x.sync.enqueue('saveCaffeineData',payload);assert.equal(result.localSaved,true);await x.sync.flush();assert.equal([...x.rows.values()][0].state,'pending');});
test('confirmed receipt is preserved, and confirmed writes are not resent',async()=>{let calls=0;const x=setup(async(_,p)=>{calls++;return {success:true,mutationId:p._sync.mutationId,recordId:'server-id',committedAt:'now'};});await x.sync.enqueue('saveCaffeineData',payload);await x.sync.flush();await x.sync.flush();assert.equal(calls,1);assert.equal([...x.rows.values()][0].state,'synced');});
test('changing students does not send or list the old student data',async()=>{const x=setup(async()=>{throw new Error('offline');});await x.sync.enqueue('saveCaffeineData',payload);await x.sync.flush();x.sync.setSubject({studentId:'2102',name:'다른'});assert.equal((await x.sync.list()).length,0);});
test('storage failure does not send or report local success',async()=>{let calls=0;const x=setup(async()=>calls++);x.sync.store.put=async()=>{throw new Error('quota');};await assert.rejects(x.sync.enqueue('saveCaffeineData',payload));assert.equal(calls,0);});
test('missing receipt does not mark a write as synchronized',async()=>{const x=setup(async()=>({success:true}));await x.sync.enqueue('saveCaffeineData',payload);await x.sync.flush();assert.equal([...x.rows.values()][0].state,'pending');});
test('fresh server reads do not resurrect a previously deleted confirmed record',async()=>{const x=setup(async(_,p)=>({success:true,mutationId:p._sync.mutationId,recordId:'server-id',committedAt:'now'}));await x.sync.enqueue('saveCaffeineData',payload);await x.sync.flush();await x.sync.capture('getCaffeineLogs',[{id:'server-id',amount:0,time:payload.time}]);await x.sync.capture('getCaffeineLogs',[]);assert.equal((await x.sync.read('getCaffeineLogs')).length,0);});
test('a second enqueue during an active send starts another automatic pass',async()=>{let unblock;let calls=0;const blocked=new Promise(r=>unblock=r);const x=setup(async(_,p)=>{calls++;if(calls===1)await blocked;return {success:true,mutationId:p._sync.mutationId,recordId:'server-'+calls,committedAt:'now'};});await x.sync.enqueue('saveCaffeineData',payload);await x.sync.enqueue('saveCaffeineData',{...payload,mg:10});unblock();await x.sync.flush();await x.sync.flush();assert.equal(calls,2);});

test('offline queue retains DB company metadata through local feedback and transmission',async()=>{
 let sent;const x=setup(async(_,p)=>{sent=p;return {success:true,mutationId:p._sync.mutationId,recordId:'id',committedAt:'now',record:{id:'id',name:p.drink,company:p.company,foodName:p.foodName,amount:p.mg,time:p.time}};});
 const result=await x.sync.enqueue('saveCaffeineData',{...payload,company:'메가커피',foodName:'커피_아메리카노'});
 assert.equal(result.record.company,'메가커피');assert.equal(result.record.foodName,'커피_아메리카노');
 await x.sync.flush();assert.equal(sent.company,'메가커피');assert.equal(sent.foodName,'커피_아메리카노');
});
