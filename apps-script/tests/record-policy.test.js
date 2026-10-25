import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemorySpreadsheet,loadAppsScript} from './harness.js';

function sleep(date,time,hours,condition,stamp='',wakeDate='',end='08:00') {
  const row=Array(19).fill('');
  Object.assign(row,{0:stamp,4:'sample',6:date,7:time,8:wakeDate,9:end,10:hours,11:condition,13:date+'-'+time});
  return row;
}
async function setup() {
  const caf=(date,mg)=>{const r=Array(12).fill('');Object.assign(r,{4:'sample',7:mg,8:date+' 12:00'});return r;};
  const spreadsheet=createMemorySpreadsheet({sleep:[Array(19).fill(''),
    sleep('2026-10-14','01:00',7.5,'😊','2026-10-14 10:00','2026-10-14','08:30'),
    sleep('2026-10-13','23:00',2,'😫','2026-10-14 09:00','2026-10-14','01:00'),
    sleep('2026-10-14','05:00','', '🙂','2026-10-14 11:00','2026-10-14','08:00'),
    sleep('2026-10-15','23:00',8,'','2026-10-16 09:00','2026-10-16','07:00')],
    caffeine:[Array(12).fill(''),caf('2026-10-13',100),caf('2026-10-14',0),caf('2026-10-15','')]});
  const {context:c}=await loadAppsScript({files:['Code.gs','Ownership.gs','Sync.gs'],properties:{GEMINI_API_KEY:'FAKE'},globals:{getSpreadsheet_:()=>spreadsheet,safeLog_(){}}});
  c.fetchWithRetry=()=>{throw new Error('Health feedback must not call a provider');};
  return c;
}
test('server holds overlapping/multiple episodes and keeps independent valid-day denominators',async()=>{
  const c=await setup();const data=c.getWeeklyDetailedData('sample','2026-10-13','2026-10-15');
  assert.equal(data.sleepRecordedDays,1);assert.equal(data.sleepTotal,8);assert.equal(data.sleepHeldDays,1);
  assert.equal(data.conditionRecordedDays,0);assert.equal(data.conditionTotal,0);
  assert.equal(data.caffeineRecordedDays,2);assert.equal(data.caffeineTotal,100);
  assert.equal(data.caffeineMissingDays,1);
});
test('both health reports use deterministic rules even with an API key and show independent record counts',async()=>{
  const c=await setup();
  for(const result of [c.generateAIHealthReport('sample','Example',999,999,99,60,150,'2026-10-13','2026-10-19'),
    c.handleAIReportForTeacher({studentId:'sample',name:'Example',limit:150,startDate:'2026-10-13',endDate:'2026-10-19'})]) {
    assert.equal(result.success,true);assert.equal(result.source,'Rule');
    assert.match(result.analysis,/8\.0/);assert.match(result.analysis,/컨디션 미기록/);
    assert.match(result.analysis,/2\/7일/);assert.match(result.analysis,/기록이 적|기록이.*적|기록 부족/);
    assert.doesNotMatch(result.analysis,/수면 부족 🔴|수면 과다|만성|즉각|999/);
  }
});
test('invalid teacher and filtered-stat dates reject before constructing a date range',async()=>{
  const c=await setup();
  assert.throws(()=>c.getFilteredStats('sample','bad-date'),/분석 기간/);
  assert.throws(()=>c.getWeeklyDetailedData('sample','2026-02-30','2026-03-01'),/분석 기간/);
});
