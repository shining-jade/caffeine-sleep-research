import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemorySpreadsheet,loadAppsScript} from './harness.js';

const dates=['2000-01-01','2000-01-02','2000-01-03'];
async function setup({text=true,key=true,caffeine=true,sleep=true,mg=[0,50,100],hours=[8,8,8.5],fail=false}={}){
 const rows={caffeine:[Array(10).fill('')],sleep:[Array(11).fill('')]};
 dates.forEach((d,i)=>{
  if(caffeine){const r=Array(10).fill('');r[4]='fictional';r[7]=mg[i];r[8]=text?d+' 00:01:00':new Date(d+'T00:01:00+09:00');rows.caffeine.push(r);}
  if(sleep){const r=Array(11).fill('');r[4]='fictional';r[6]=text?d:new Date(d+'T00:00:00+09:00');r[10]=hours[i];rows.sleep.push(r);}
 });
 const spreadsheet=createMemorySpreadsheet(rows);const calls=[];
 const {context:c}=await loadAppsScript({files:['Code.gs'],properties:key?{GEMINI_API_KEY:'FAKE_KEY'}:{},globals:{getSpreadsheet_:()=>spreadsheet,safeLog_(){}}});
 c.fetchWithRetry=(url,options)=>{calls.push({url,prompt:JSON.parse(options.payload).contents[0].parts[0].text});return fail?{errorCode:'RATE_LIMIT'}:{response:{getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'가상 기록의 분석입니다. '.repeat(20)}]}}]})}};};
 c.getSleepSettings=()=>({settings:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11}});
 const run=(start='2000-01-01',end='2000-01-07')=>c.generateAIHealthReport('fictional','가상',9999,999,99,60,120,start,end);
 return{c,calls,run,spreadsheet};
}
for(const text of [true,false])test(`student selected historical period uses authoritative averages including recorded zero (${text?'text':'Date'})`,async()=>{
 const x=await setup({text});const result=x.run();assert.equal(result.success,true);
 const combined=result.analysis+'\n'+x.calls.map(v=>v.prompt).join('\n');
 assert.match(combined,/50mg/);assert.match(combined,/8\.2(?:h|시간)/);
 assert.doesNotMatch(combined,/999mg|99\.0h/);
 if(x.calls.length){assert.match(x.calls[0].prompt,/2000-01-01.*2000-01-07/);assert.doesNotMatch(x.calls[0].prompt,/이름: 가상|가상님/);assert.doesNotMatch(x.calls[0].url,/FAKE_KEY|\?key=/);}
});
test('student no-key rule analysis uses selected server records and preserves personal goal',async()=>{
 const x=await setup({key:false});const result=x.run();assert.equal(result.source,'Rule');assert.match(result.analysis,/일평균 50mg \/ 목표 섭취량 120mg/);assert.match(result.analysis,/평균 8\.2h/);assert.equal(x.calls.length,0);
});
test('student provider failure fallback preserves selected averages',async()=>{
 const x=await setup({fail:true});const result=x.run();assert.equal(result.success,true);assert.match(result.analysis,/일평균 50mg/);assert.match(result.analysis,/평균 8\.2h/);
});
test('student no-use records remain distinct from missing caffeine history',async()=>{
 const zero=await setup({key:false,mg:[0,0,0]});assert.match(zero.run().analysis,/3일은 카페인 없이/);
 const missing=await setup({key:false,caffeine:false});const report=missing.run().analysis;assert.match(report,/카페인 미기록/);assert.doesNotMatch(report,/일평균 0mg.*이내|좋은 카페인/);
});
test('student missing sleep is not described as observed short sleep',async()=>{
 const x=await setup({key:false,sleep:false});const report=x.run().analysis;assert.match(report,/수면 미기록/);assert.doesNotMatch(report,/평균 0\.0h|취침 시간을.*앞당겨/);
});
test('student insufficient history avoids provider calls',async()=>{
 const x=await setup({caffeine:false,sleep:false});const result=x.run();assert.equal(result.source,'InsufficientData');assert.match(result.analysis,/__INSUFFICIENT__/);assert.equal(x.calls.length,0);
});
for(const missing of ['caffeine','sleep'])test(`student AI prompt does not infer a zero average for missing ${missing}`,async()=>{
 const x=await setup({[missing]:false});x.run();assert.equal(x.calls.length,1);
 const prompt=x.calls[0].prompt;
 if(missing==='caffeine'){assert.match(prompt,/카페인 미기록/);assert.doesNotMatch(prompt,/카페인 평균: 0mg|평균 0mg과/);}
 else {assert.match(prompt,/수면 미기록/);assert.doesNotMatch(prompt,/수면 평균: 0\.0h|평균 0\.0h와/);}
});
for(const [start,end] of [['2000-02-30','2000-03-07'],['2000-01-01','2050-01-07'],['2000-01-07','2000-01-01'],['2000-01-01',null]])test(`invalid student period rejected before reading records (${start}, ${end})`,async()=>{
 const x=await setup();x.c.getSpreadsheet_=()=>{throw Error('must not read on invalid range');};
 const result=x.run(start,end);assert.equal(result.success,false);assert.equal(result.errorCode,'INVALID_PERIOD');assert.equal(x.calls.length,0);
});
