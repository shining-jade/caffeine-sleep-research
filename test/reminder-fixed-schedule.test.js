import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import {call,createMemorySpreadsheet,loadAppsScript} from '../apps-script/tests/harness.js';
import {createReminderRunHandler} from '../api/reminders/run.js';
import {createReminderConfigHandler} from '../api/_lib/teacher/reminders/config.js';
import {createSession} from '../api/_lib/session.js';
import {getNextReminderTimes,normalizeStoredReminderConfig,selectReminderCandidates} from '../api/_lib/reminder-policy.js';
import * as client from '../public/js/teacher-reminders.js';
const NOW=Date.parse('2026-10-19T08:00:00+09:00');
const config=(extra={})=>({enabled:true,sleepEnabled:true,caffeineEnabled:true,sleepTime:'08:00',caffeineTime:'20:00',includeWeekends:false,
  classPeriods:[1,2,3,4].map(n=>({classId:String(n),startDate:'2026-10-01',endDate:'2026-10-31'})),...extra});
const res=()=>({statusCode:0,body:'',setHeader(){},end(s){this.body=s;},json(){return JSON.parse(this.body);}});
function teacherRequest(body){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';
  req.headers={cookie:'caffeine_teacher_session='+encodeURIComponent(createSession({role:'teacher',exp:Math.floor(NOW/1000)+3600},Math.floor(NOW/1000)))};return req;
}
async function gasFixture(){
  const initial={students:[['학번ID','반'],...Array.from({length:6},(_,i)=>[String(1101+i),'1'])],
    sleep:[['타임스탬프','전체학번','취침날짜','기상날짜'],
      ['2026-10-20',1101,'2026-10-19','2026-10-19'],
      ['2026-10-20',1102,'2026-10-18','2026-10-19'],
      ['2026-10-19',1103,'2026-10-17','2026-10-18'],
      ['2026-10-19',1104,'2026-10-18','2026-10-20'],
      ['2026-10-19',1105,'2026-10-18',''],
      ['2026-10-20',1106,'2026-10-19',new Date('2026-10-18T21:30:00Z')]],
    caffeine:[['타임스탬프','전체학번','섭취시간','함량'],
      ['2026-10-20',1101,'2026-10-19 00:00:00',0],
      ['2026-10-20',1102,'2026-10-18T15:00:00Z',50],
      ['2026-10-20',1103,new Date('2026-10-18T15:00:00Z'),0],
      ['2026-10-19',1104,'2026-10-18 23:59:59',20],
      ['2026-10-19',1105,'',20],
      ['2026-10-19',1106,'2026-10-19T15:00:00Z',20]]};
  const spreadsheet=createMemorySpreadsheet(initial);
  const loaded=await loadAppsScript({files:['Spreadsheet.gs','Ownership.gs','Reminders.gs'],properties:{SPREADSHEET_ID:'synthetic-only'},globals:{__spreadsheet:spreadsheet}});
  return {...loaded,spreadsheet,initial};
}
test('two UTC schedules represent KST sleep 08 and caffeine 20 only',()=>{
  const {crons}=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.deepEqual(crons,[{path:'/api/reminders/run?slot=23',schedule:'0 23 * * *'},{path:'/api/reminders/run?slot=11',schedule:'0 11 * * *'}]);
});
test('retired hourly runs outside 08 and 20 never reach GAS or push',async()=>{
  let calls=0;const handler=createReminderRunHandler({now:()=>Date.parse('2026-10-19T19:00:00+09:00')/1000,getCronSecret:()=> 'synthetic',callGas:async()=>{calls++;throw Error('unexpected');},createSender:()=>{throw Error('unexpected');}});
  const req={method:'GET',headers:{authorization:'Bearer synthetic'},url:'/api/reminders/run?slot=10'},response=res();
  await handler(req,response);assert.equal(response.statusCode,200);assert.equal(response.json().targeted,0);assert.equal(calls,0);
});
test('sleep completion uses actual wake date today without changing rows or delivery date',async()=>{
  const f=await gasFixture();const before=JSON.stringify(f.initial.sleep);
  const value=JSON.parse(JSON.stringify(call(f.context,"getReminderDispatchSnapshot_('sleep','2026-10-19T08:00:00+09:00')")));
  assert.deepEqual(value.completedStudentIds,['1101','1102','1106']);
  assert.equal(JSON.stringify(f.spreadsheet.getSheetByName('sleep').getDataRange().getValues()),before);
});
test('caffeine completion uses actual KST intake date including explicit zero without timestamp fallback',async()=>{
  const f=await gasFixture();const before=JSON.stringify(f.initial.caffeine);
  const value=JSON.parse(JSON.stringify(call(f.context,"getReminderDispatchSnapshot_('caffeine','2026-10-19T20:00:00+09:00')")));
  assert.deepEqual(value.completedStudentIds,['1101','1102','1103']);
  assert.equal(JSON.stringify(f.spreadsheet.getSheetByName('caffeine').getDataRange().getValues()),before);
});
test('missing real wake column fails closed instead of substituting bedtime or submission date',async()=>{
  const f=await gasFixture();f.spreadsheet.getSheetByName('sleep').rows=[['타임스탬프','전체학번','취침날짜'],['2026-10-19',1101,'2026-10-18']];
  assert.throws(()=>call(f.context,"getReminderDispatchSnapshot_('sleep','2026-10-19T08:00:00+09:00')"),/REQUEST_REJECTED/);
});
test('month and year wake date boundaries are KST dates, not bedtime dates',async()=>{
  for(const [wake,bed] of [['2026-11-01','2026-10-31'],['2027-01-01','2026-12-31']]){
    const f=await gasFixture();f.spreadsheet.getSheetByName('sleep').rows=[['전체학번','취침날짜','기상날짜'],[1101,bed,wake],[1102,bed,bed]];
    const value=JSON.parse(JSON.stringify(call(f.context,`getReminderDispatchSnapshot_('sleep','${wake}T08:00:00+09:00')`)));
    assert.deepEqual(value.completedStudentIds,['1101']);
  }
});
test('old stored times remain readable but unavailable hours are not announced as next scheduled runs',()=>{
  const legacy=normalizeStoredReminderConfig(config({sleepTime:'09:00',caffeineTime:'21:00'}));
  assert.equal(legacy.sleepTime,'09:00');assert.equal(legacy.caffeineTime,'21:00');
  assert.deepEqual(getNextReminderTimes({config:legacy,nowMs:NOW}),{sleep:null,caffeine:null});
});
test('new teacher saves reject unavailable hours at browser and API without reaching GAS',async()=>{
  assert.equal(typeof client.normalizeTeacherReminderSave,'function');
  process.env.SESSION_SECRET='synthetic-fixed-schedule-session';
  let calls=0;const handler=createReminderConfigHandler({now:()=>NOW/1000,callGas:async()=>{calls++;throw Error('unexpected');}});
  for(const extra of [{sleepTime:'09:00'},{caffeineTime:'21:00'}]){
    assert.throws(()=>client.normalizeTeacherReminderSave(config(extra)),/08:00.*20:00/);
    const response=res();await handler(teacherRequest(config(extra)),response);assert.equal(response.statusCode,400);
  }
  assert.equal(calls,0);assert.deepEqual(client.normalizeTeacherReminderSave(config()),config());
});
test('GAS save rejects unsupported hours before writing config or research rows',async()=>{
  const f=await gasFixture();f.context.draft=config({sleepTime:'09:00'});
  assert.throws(()=>call(f.context,"saveReminderConfig_(draft,'teacher')"),/REQUEST_REJECTED/);
  assert.equal(f.spreadsheet.getSheetByName('알림설정'),null);
});
test('per-type completion and opt-in stay independent and the legacy sleep delivery key stays stable',()=>{
  const base={config:config(),students:[{studentId:'1101',classId:'1'}],subscriptions:[{studentId:'1101',subscriptionId:'a',active:true,sleepEnabled:true,caffeineEnabled:true}],successfulDeliveryKeys:[]};
  assert.equal(selectReminderCandidates({...base,type:'sleep',nowMs:NOW,completedStudentIds:['1101']}).length,0);
  const caffeine=selectReminderCandidates({...base,type:'caffeine',nowMs:Date.parse('2026-10-19T20:00:00+09:00'),completedStudentIds:[]});assert.equal(caffeine.length,1);
  const sleep=selectReminderCandidates({...base,type:'sleep',nowMs:NOW,completedStudentIds:[]});assert.equal(sleep[0].referenceDate,'2026-10-18');
  assert.equal(selectReminderCandidates({...base,type:'sleep',nowMs:NOW,completedStudentIds:[],successfulDeliveryKeys:['2026-10-18:sleep:a']}).length,0);
});
