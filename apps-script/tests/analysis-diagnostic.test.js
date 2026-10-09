import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAppsScript } from './harness.js';

test('analysis diagnostic exercises production analysis with fixed fictional data and no sheet access', async () => {
  const calls = [], logs = [];
  const { context: c, openedIds } = await loadAppsScript({files:['Code.gs'], properties:{GEMINI_API_KEY:'SYNTHETIC_KEY'},globals:{
    safeLog_(){}, console:{info(value){logs.push(value);}},
    ScriptApp:{AuthMode:{FULL:'FULL'},requireScopes(){}},
    getSpreadsheet_(){throw new Error('Diagnostic must never read student records');},
  }});
  c.fetchWithRetry = (url, options, retries) => {
    calls.push({url,options,retries});
    const retired = url.includes('gemini-2.0-flash');
    return {errorCode:retired?'UNKNOWN_ERROR':null,response:{getResponseCode:()=>retired?404:200,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'가상 자료입니다. 카페인 일평균 50mg, 수면 평균 8.2시간입니다. '.repeat(8)}]}}]})}};
  };
  c.getSleepSettings = () => ({settings:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11}});
  const result = c.testAIAnalysis();
  assert.equal(result.results.length,2);
  assert.match(result.results[0].source,/Fallback/);
  assert.equal(result.results[1].source,'AI_Teacher');
  assert.equal(calls.length,2);
  assert.deepEqual(openedIds,[]);
  for(const call of calls){
    assert.equal(call.retries,1);
    assert.match(JSON.parse(call.options.payload).contents[0].parts[0].text,/실존 인물이 아닌 가상 자료/);
  }
  assert.equal(JSON.stringify({result,logs}).includes('SYNTHETIC_KEY'),false);
  assert.match(result.results[0].analysis,/50mg/);
  assert.match(result.results[0].analysis,/8\.2시간/);
});
