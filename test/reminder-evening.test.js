import test from 'node:test';
import assert from 'node:assert/strict';
import {call,createMemorySpreadsheet,loadAppsScript} from '../apps-script/tests/harness.js';
import {createReminderRunHandler} from '../api/reminders/run.js';
import {getNextReminderTimes} from '../api/_lib/reminder-policy.js';
const config=(extra={})=>({enabled:true,sleepEnabled:true,caffeineEnabled:true,sleepTime:'08:00',caffeineTime:'20:00',includeWeekends:false,classPeriods:[1,2,3,4].map(n=>({classId:String(n),startDate:'2026-10-01',endDate:'2026-10-31'})),...extra});
const SUB_HEADERS=['구독ID','역할','학생학번','endpoint','p256dh','auth','수면알림허용','카페인알림허용','활성상태','생성시각','마지막갱신시각','마지막성공시각','마지막오류코드'];
const LOG_HEADERS=['중복방지키','기준날짜','알림유형','학번','구독ID','발송시각','결과','오류코드'];
async function setup({sleep=false,caffeine=false,sleepOptIn=true,caffeineOptIn=true,active=true,configExtra={}}={}){
 const spreadsheet=createMemorySpreadsheet({students:[['학번ID','반'],['1101','1']],sleep:[['타임스탬프','전체학번','취침날짜','기상날짜']],caffeine:[['타임스탬프','전체학번','섭取時間','함량']],
  푸시구독:[SUB_HEADERS,['a','student','1101','https://push.example/a','public-a','auth-a',sleepOptIn,caffeineOptIn,active,'','','','']],알림발송로그:[LOG_HEADERS]});
 // Use the production Korean intake header; the fixture never contacts a provider.
 spreadsheet.getSheetByName('caffeine').rows[0][2]='섭취시간';
 const loaded=await loadAppsScript({files:['Spreadsheet.gs','Ownership.gs','Reminders.gs'],properties:{SPREADSHEET_ID:'synthetic-only'},globals:{__spreadsheet:spreadsheet}});
 loaded.context.config=config(configExtra);call(loaded.context,"saveReminderConfig_(config,'teacher')");
 const sent=[],actions=[];
 const f={...loaded,spreadsheet,sent,actions};
 f.completeSleep=()=>spreadsheet.getSheetByName('sleep').appendRow(['2026-10-20','1101','2026-10-19','2026-10-19']);
 f.completeCaffeine=()=>spreadsheet.getSheetByName('caffeine').appendRow(['2026-10-20','1101','2026-10-19 10:00:00',0]);
 if(sleep)f.completeSleep();if(caffeine)f.completeCaffeine();
 f.execute=async(time='2026-10-19T20:00:00+09:00',sendWait=null)=>{
  const handler=createReminderRunHandler({now:()=>Date.parse(time)/1000,getCronSecret:()=> 'synthetic-secret',createExecutionId:()=> 'synthetic-execution',
   callGas:async({action,params})=>{actions.push(action);loaded.context.args=params;return JSON.parse(JSON.stringify(call(loaded.context,action+'_.apply(null,args)')));},
   createSender:()=>({send:async(_subscription,payload)=>{sent.push(JSON.parse(payload));if(sendWait)await sendWait;return {status:'success',errorCode:''};}})});
  const response={statusCode:0,body:'',setHeader(){},end(s){this.body=s;}};
  await handler({method:'GET',headers:{authorization:'Bearer synthetic-secret'},url:'/api/reminders/run'},response);
  return {...response,data:JSON.parse(response.body)};
 };
 return f;
}
test('evening combines two missing types into one push and one logged delivery per device',async()=>{
 const f=await setup();const response=await f.execute();assert.equal(response.statusCode,200);assert.equal(f.sent.length,1);
 assert.match(f.sent[0].body,/수면/);assert.match(f.sent[0].body,/카페인/);
 assert.match(f.sent[0].data.url,/open=sleep&date=2026-10-18/);
 assert.equal(response.data.targeted,1);assert.equal(response.data.sent,1);
 const logs=f.spreadsheet.getSheetByName('알림발송로그').rows;assert.equal(logs.length,2);assert.equal(logs[1][0],'2026-10-19:caffeine:a');assert.equal(logs[1][2],'evening');
});
test('evening missing sleep is reminded after explicit zero-mg caffeine completion',async()=>{
 const f=await setup({caffeine:true});assert.equal((await f.execute()).statusCode,200);assert.equal(f.sent.length,1);
 assert.match(f.sent[0].body,/수면/);assert.doesNotMatch(f.sent[0].body,/카페인/);assert.match(f.sent[0].data.url,/open=sleep/);
});
test('evening missing caffeine only opens its actual intake-day form',async()=>{
 const f=await setup({sleep:true});assert.equal((await f.execute()).statusCode,200);assert.equal(f.sent.length,1);
 assert.doesNotMatch(f.sent[0].body,/수면/);assert.match(f.sent[0].body,/카페인/);assert.equal(f.sent[0].data.url,'/?open=caffeine&date=2026-10-19');
});
test('both completed means no evening claim result or push',async()=>{
 const f=await setup({sleep:true,caffeine:true});assert.equal((await f.execute()).statusCode,200);assert.equal(f.sent.length,0);assert.ok(!f.actions.includes('claimReminderDeliveries'));
});
test('per-kind opt-outs and global kind toggles are respected within one evening push',async()=>{
 for(const [settings,word,absent]of [[{sleepOptIn:false},'카페인','수면'],[{caffeineOptIn:false},'수면','카페인'],[{configExtra:{sleepEnabled:false}},'카페인','수면'],[{configExtra:{caffeineEnabled:false}},'수면','카페인']]){
  const f=await setup(settings);await f.execute();assert.equal(f.sent.length,1);assert.ok(f.sent[0].body.includes(word));assert.ok(!f.sent[0].body.includes(absent));
 }
 for(const settings of [{sleepOptIn:false,caffeineOptIn:false},{active:false},{configExtra:{enabled:false}}]){const f=await setup(settings);await f.execute();assert.equal(f.sent.length,0);}
});
test('AM successful sleep delivery does not block an evening missing-sleep reminder',async()=>{
 const f=await setup({caffeine:true});assert.equal((await f.execute('2026-10-19T08:00:00+09:00')).statusCode,200);assert.equal(f.sent.length,1);
 assert.equal((await f.execute()).statusCode,200);assert.equal(f.sent.length,2);
 const rows=f.spreadsheet.getSheetByName('알림발송로그').rows;assert.equal(rows[1][0],'2026-10-18:sleep:a');assert.equal(rows[2][0],'2026-10-19:caffeine:a');
});
test('sleep recorded after morning excludes sleep from the evening message regardless of later submission date',async()=>{
 const f=await setup();await f.execute('2026-10-19T08:00:00+09:00');f.completeSleep();await f.execute();assert.equal(f.sent.length,2);assert.doesNotMatch(f.sent[1].body,/수면/);assert.match(f.sent[1].body,/카페인/);
});
test('same evening replay stays deduplicated even when missing types change',async()=>{
 const f=await setup();await f.execute();f.completeCaffeine();await f.execute('2026-10-19T20:40:00+09:00');assert.equal(f.sent.length,1);
});
test('concurrent evening requests acquire one shared lease and send once',async()=>{
 const f=await setup();let release;const gate=new Promise(resolve=>{release=resolve;});const first=f.execute(undefined,gate);
 while(f.sent.length===0)await new Promise(resolve=>setImmediate(resolve));
 const second=await f.execute();assert.equal(second.statusCode,200);assert.equal(f.sent.length,1);release();assert.equal((await first).statusCode,200);
});
test('legacy AM and legacy PM success keys block duplicate sends without rewriting rows',async()=>{
 const f=await setup();const rows=f.spreadsheet.getSheetByName('알림발송로그').rows;
 rows.push(['2026-10-18:sleep:a','2026-10-18','sleep','1101','a','old','success','']);rows.push(['2026-10-19:caffeine:a','2026-10-19','caffeine','1101','a','old','success','']);
 const before=JSON.stringify(rows);await f.execute('2026-10-19T08:00:00+09:00');await f.execute();assert.equal(f.sent.length,0);assert.equal(JSON.stringify(rows),before);
});
test('hour boundaries retain authorized 08/20 hour windows and reject adjacent hours before GAS',async()=>{
 for(const hour of ['07:59','09:00','19:59','21:00']){const f=await setup();await f.execute('2026-10-19T'+hour+':00+09:00');assert.equal(f.actions.length,0);}
 for(const hour of ['08:00','08:59','20:00','20:59']){const f=await setup();await f.execute('2026-10-19T'+hour+':00+09:00');assert.equal(f.sent.length,1);}
});
test('next sleep reminder after morning includes the evening check',()=>{
 assert.deepEqual(getNextReminderTimes({config:config(),nowMs:Date.parse('2026-10-19T09:00:00+09:00')}),{sleep:'2026-10-19T20:00:00+09:00',caffeine:'2026-10-19T20:00:00+09:00'});
});

test('old GAS without wake-day and evening capability stops before claim or send',async()=>{
 let claims=0,sends=0;const handler=createReminderRunHandler({now:()=>Date.parse('2026-10-19T20:00:00+09:00')/1000,getCronSecret:()=> 'synthetic',
  callGas:async({action,params})=>{
   if(action==='getReminderDispatchSnapshot')return {config:config(),students:[{studentId:'1101',classId:'1'}],completedStudentIds:[],subscriptions:[{studentId:'1101',subscriptionId:'a',endpoint:'https://push.example/a',keys:{p256dh:'public',auth:'auth'},active:true,sleepEnabled:true,caffeineEnabled:true}],successfulDeliveryKeys:[]};
   if(action==='claimReminderDeliveries'){claims++;return params[0];}return {recorded:1};
  },createSender:()=>({send:async()=>{sends++;return {status:'success',errorCode:''};}})});
 const response={statusCode:0,body:'',setHeader(){},end(s){this.body=s;}};
 await handler({method:'GET',headers:{authorization:'Bearer synthetic'},url:'/api/reminders/run'},response);
 assert.equal(response.statusCode,502);assert.equal(claims,0);assert.equal(sends,0);
});
