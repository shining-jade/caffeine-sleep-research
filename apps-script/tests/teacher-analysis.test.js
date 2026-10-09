import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemorySpreadsheet,loadAppsScript} from './harness.js';
async function setup({text=false,key=true,mg=[150,6,0]}={}){let prompt='';const dates=['2026-10-06','2026-10-08','2026-10-09'];const rows=[Array(10).fill(''),...dates.map((d,i)=>{const r=Array(10).fill('');r[4]='synthetic';r[7]=mg[i];r[8]=text?d+' 12:00:00':new Date(d+'T12:00:00+09:00');return r;})];const spreadsheet=createMemorySpreadsheet({caffeine:rows,sleep:[Array(11).fill(''),['','','','','synthetic','','2026-10-05','','','',8]]});const {context:c}=await loadAppsScript({files:['Code.gs'],properties:key?{GEMINI_API_KEY:'LOCAL_FIXTURE'}:{},globals:{getSpreadsheet_:()=>spreadsheet,safeLog_(){},fetchWithRetry(_url,options){prompt=JSON.parse(options.payload).contents[0].parts[0].text;return{response:{getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'합성 자료의 분석입니다. '.repeat(20)}]}}]})}};}}});c.fetchWithRetry=(_url,options)=>{prompt=JSON.parse(options.payload).contents[0].parts[0].text;return{response:{getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"합성 자료의 분석입니다. ".repeat(20)}]}}]})}};};c.getSleepSettings=()=>({settings:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11}});return{c,getPrompt:()=>prompt};}
const payload={studentId:'synthetic',name:'합성',weight:68,limit:170,startDate:'2026-10-03',endDate:'2026-10-09',caffeineData:{avgPerDay:52,totalDays:3,topSymptoms:'손이 떨렸다',symptomRate:'33% (1/3건)'},sleepData:{avgHours:8,totalDays:1}};
for(const text of [false,true])test(`server analysis matches recorded-day mean including zero (${text?'text':'Date'} cells)`,async()=>{const x=await setup({text});const result=x.c.handleAIReportForTeacher(payload);assert.equal(result.success,true);assert.match(x.getPrompt(),/일평균 52mg/);assert.doesNotMatch(x.getPrompt(),/33% \(1\/3건\)%/);});
test('custom period reports its actual number of days',async()=>{const {c}=await setup();const result=c.getWeeklyDetailedData('synthetic','2026-09-26','2026-10-09');assert.equal(result.totalDays,14);assert.equal(result.caffeineRecordedDays,3);});
test('missing API key returns a usable report using server records rather than stale payload averages',async()=>{const {c}=await setup({key:false,text:true});const result=c.handleAIReportForTeacher({...payload,caffeineData:{...payload.caffeineData,avgPerDay:999}});assert.equal(result.success,true);assert.match(result.analysis,/52mg/);assert.doesNotMatch(result.analysis,/999mg/);});
test('server fallback distinguishes recorded zero from no caffeine history',async()=>{const {c}=await setup({key:false,mg:[0,0,0]});const result=c.handleAIReportForTeacher(payload);assert.equal(result.success,true);assert.match(result.analysis,/섭취 안 함/);assert.doesNotMatch(result.analysis,/카페인 미기록/);});
test('teacher custom thresholds appear in analysis status without changing its weight basis',async()=>{const x=await setup({mg:[170,170,170]});const result=x.c.handleAIReportForTeacher({...payload,caffeineThresholds:{warn:80,over:110},caffeineData:{...payload.caffeineData,avgPerDay:170}});assert.equal(result.success,true);assert.match(x.getPrompt(),/2단계: 적정\/제한/);assert.match(x.getPrompt(),/교사 판정 기준: 170mg/);});

test('API error fallback preserves the same averages, thresholds and lifestyle context',async()=>{
 const {c}=await setup({mg:[170,170,170]});
 c.fetchWithRetry=()=>({errorCode:'RATE_LIMIT'});
 const result=c.handleAIReportForTeacher({...payload,caffeineThresholds:{warn:80,over:110}});
 assert.equal(result.success,true);
 assert.equal(result.source,'Fallback (API 오류)');
 assert.match(result.analysis,/일평균 170mg/);
 assert.match(result.analysis,/2단계: 적정\/제한/);
 assert.match(result.analysis,/손이 떨렸다/);
});

test('fallback preserves missing histories instead of inventing healthy or severe states',async()=>{
 const {c}=await setup();
 const report=c.getTeacherFallbackAnalysis(0,0,170,0,0,'합성 기간',[]);
 assert.match(report,/카페인 미기록/);
 assert.match(report,/수면 미기록/);
 assert.doesNotMatch(report,/수면 부족 🔴|양호하게 관리/);
});

test('server stages and daily excess count follow the configured boundaries',async()=>{
 const {c}=await setup();
 for(const [mg,stage] of [[0,0],[60,1],[80,2],[105,2],[110,3],[120,4],[200,5]]){
  const result=c.getTeacherCaffeineSummary_(mg,100,1,[{date:'2026-10-09',mg}],{warn:80,over:110});
  assert.equal(result.stage,stage);
  assert.equal(result.overDays.length,mg>=110?1:0);
 }
});

test('missing and no-use lifestyle responses do not become observed sleep problems',async()=>{
 const {c}=await setup({key:false});
 const result=c.handleAIReportForTeacher({...payload,caffeineData:{...payload.caffeineData,topSymptoms:'없음'},sleepData:{...payload.sleepData,topLatency:'없음',topPhone:'안 함(2일)',topDrowsy:'없음(2일)'}});
 assert.equal(result.success,true);
 assert.doesNotMatch(result.analysis,/없음로|안 함\(2일\)로|없음\(2일\) 정도|수면 잠복기가 길어/);
});
