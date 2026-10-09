import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const m=new RegExp(`    (?:async )?function ${name}\\(`).exec(html);if(!m)return '';return html.slice(m.index,html.indexOf('\n    }',m.index)+6);}
function setup({sufficient=true}={}){
 const container={innerHTML:'',firstChild:null,insertBefore(el){this.innerHTML=el.innerHTML+this.innerHTML;}};
 const btn={disabled:false,innerHTML:''};const input={value:'2000-01-07'};
 const elements={aiReportContainer:container,aiAnalysisBtn:btn,filterEndDate:input};
 const calls=[];let success,failure;
 const chain={withSuccessHandler(h){success=h;return chain;},withFailureHandler(h){failure=h;return chain;},generateAIHealthReport(...params){calls.push(params);}};
 const c=vm.createContext({Date,Math,Set,Map,Number,window:{},user:{studentId:'fictional',name:'가상'},userWeight:60,userLimit:120,
  caffeineLogs:sufficient?[0,50,100].map((amount,i)=>({amount,time:`2000-01-0${i+1}T12:00:00+09:00`})) : [],
  sleepLogs:sufficient?[8,8,8.5].map((hours,i)=>({hours,date:`2000-01-0${i+1}`})):[],
  document:{getElementById:id=>elements[id]||null,createElement:()=>({innerHTML:'',className:''})},
  getTodayKST:()=> '2000-01-07',getLogDateKST:t=>t.slice(0,10),escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  google:{script:{run:chain}}});
 vm.runInContext(['resetStudentAnalysis','generateAIReport','displayAIReport','getErrorDisplayInfo','showErrorReport','showFallbackNotice'].map(extract).join('\n'),c);
 return{c,btn,input,container,calls,succeed:r=>success(r),fail:e=>failure(e)};
}
test('student sends selected dates and recorded-day mean',async()=>{
 const x=setup();await x.c.generateAIReport();assert.equal(x.calls.length,1);assert.equal(Number(x.calls[0][3]),50);assert.equal(x.calls[0][7],'2000-01-01');assert.equal(x.calls[0][8],'2000-01-07');
});
test('student fallback notice remains visible after report rendering',async()=>{
 const x=setup();await x.c.generateAIReport();x.succeed({success:true,source:'Fallback (API 오류)',errorCode:'RATE_LIMIT',analysis:'가상 분석\n☕ 카페인\n- 평균 50mg\n😴 수면\n- 평균 8.2h\n💡 실천\n1. 기록하기'});
 assert.match(x.container.innerHTML,/AI 대신 기본 분석/);assert.match(x.container.innerHTML,/평균 50mg/);assert.equal(x.btn.disabled,false);
});
test('student changed period ignores delayed report and clears shareable analysis',async()=>{
 const x=setup();x.c.window.currentAIAnalysis='이전 결과';await x.c.generateAIReport();assert.equal(x.c.window.currentAIAnalysis,null);
 x.input.value='2000-01-14';x.c.resetStudentAnalysis();const before=x.container.innerHTML;
 x.succeed({success:true,source:'AI',analysis:'늦게 온 결과'});assert.equal(x.container.innerHTML,before);assert.equal(x.c.window.currentAIAnalysis,null);assert.equal(x.btn.disabled,false);
});
test('student insufficient local history avoids server request',async()=>{
 const x=setup({sufficient:false});await x.c.generateAIReport();assert.equal(x.calls.length,0);assert.match(x.container.innerHTML,/기록이 조금 부족/);assert.equal(x.btn.disabled,false);
});
test('student analysis escapes provider text instead of injecting markup',()=>{
 const x=setup();x.c.displayAIReport('<img src=x onerror=bad()>\n☕ 카페인\n- <b>50mg</b>','1/1 ~ 1/7','');assert.doesNotMatch(x.container.innerHTML,/<img src=x|<b>50mg<\/b>/);assert.match(x.container.innerHTML,/&lt;img/);
});
test('student structured shortage averages only accept finite nonnegative numbers',()=>{
 const x=setup();x.c.displayAIReport('__INSUFFICIENT__\n☕:1:2\n😴:1:2\n__CAF_AVG__:<img src=x onerror=bad()>\n__SLP_AVG__:Infinity','1/1 ~ 1/7','');
 assert.doesNotMatch(x.container.innerHTML,/<img src=x|평균 Infinity/);
 x.c.displayAIReport('__INSUFFICIENT__\n☕:1:2\n😴:1:2\n__CAF_AVG__:50\n__SLP_AVG__:8.2','1/1 ~ 1/7','');
 assert.match(x.container.innerHTML,/평균 50mg/);assert.match(x.container.innerHTML,/평균 8\.2시간/);
});
