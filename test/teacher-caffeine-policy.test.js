import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html=fs.readFileSync('teacher/index.html','utf8');
function extract(name){const match=new RegExp(`(?:async )?function ${name}\\(`).exec(html);if(!match)return '';const tail=html.slice(match.index+match[0].length),next=/\n(?:async )?function /.exec(tail);return html.slice(match.index,next?match.index+match[0].length+next.index:undefined);}
const helpers=['getCafThresholds','readCafSettings','getCafStageKey','getCafStatusInfo','getCafBarColor','updateCafPreview','hasLifestyleConcern'];
function setup(settings={cafWarn:80,cafOver:110},extra={}){const fields={};for(const id of ['lvl_ok','lvl_warn','lvl_over','lvl_danger','lvl_critical'])fields[id]={};Object.assign(fields,{setting_cafWarn:{value:'80'},setting_cafOver:{value:'110'},setting_cafMax:{value:'0'}});const c=vm.createContext({S:settings,document:{getElementById:id=>fields[id]},...extra});vm.runInContext(helpers.map(extract).join('\n'),c);return{c,fields};}
test('custom warning and excess thresholds apply to every stage while 120 and 200 stay fixed',()=>{const {c}=setup();for(const [mg,key] of [[60,'caf1'],[80,'caf2'],[105,'caf2'],[110,'caf3'],[120,'caf4'],[200,'caf5']])assert.equal(c.getCafStageKey(mg,100,true),key);assert.equal(c.getCafStageKey(0,100,true),'caf0');assert.equal(c.getCafStageKey(0,100,false),'cafNone');});
test('default boundaries remain 56/100/120/200',()=>{const {c}=setup({});for(const [mg,stage] of [[55,1],[56,2],[100,3],[120,4],[200,5]])assert.match(c.getCafStatusInfo(mg,100,true).text,new RegExp(`${stage}단계`));});
test('preview follows input thresholds and does not mutate applied settings',()=>{const {c,fields}=setup();fields.setting_cafWarn.value='90';c.updateCafPreview();assert.match(fields.lvl_warn.textContent,/90% ~ 110%/);assert.equal(c.S.cafWarn,80);});
test('invalid settings are rejected without changing applied thresholds',()=>{for(const [warn,over,max] of [['110','80','0'],['80','120','0'],['abc','100','0'],['56','100','-1']]){const {c,fields}=setup();fields.setting_cafWarn.value=warn;fields.setting_cafOver.value=over;fields.setting_cafMax.value=max;assert.equal(typeof c.readCafSettings,'function');assert.throws(()=>c.readCafSettings());assert.equal(c.S.cafWarn,80);}});
test('empty fields use the documented defaults rather than a different warning level',()=>{const {c,fields}=setup();for(const f of Object.values(fields))if('value'in f)f.value='';const value=c.readCafSettings();assert.equal(value.cafWarn,56);assert.equal(value.cafOver,100);assert.equal(value.cafMaxFixed,0);});
test('list, chart and exported PDF use the same status color and the teacher basis',()=>{const {c}=setup({cafWarn:56,cafOver:100},{currentStudentId:'synthetic',getLimit:()=>170,charts:{pdfDual:{data:{labels:['10-06'],datasets:[{data:[150],assessmentLimit:170,backgroundColor:['#f59e0b']},{data:[150]},{data:[8]},{data:[8]}]}}}});vm.runInContext(extract('buildStaticPdfDualChartHTML'),c);assert.equal(c.getCafBarColor(150,170,true),c.getCafStatusInfo(150,170,true).color);const result=c.buildStaticPdfDualChartHTML();assert.match(result,/background:#f59e0b;/);assert.doesNotMatch(result,/height:[\d.]+%;background:#ef4444;/);assert.match(result,/목표 섭취량\(150mg\)/);});
test('student target and calculated daily maximum have distinct labels',()=>{assert.match(html,/<span class="modal-stat-label">목표 섭취량<\/span>/);assert.match(html,/목표 섭취량: \$\{targetCafText\} · 일일 최대 섭취량: \$\{Math.round\(lim\)\}mg/);assert.match(html,/카페인 상태 · 일일 최대 섭취량 \$\{Math.round\(lim\)\}mg/);assert.doesNotMatch(html,/일일 최대 섭취량[^\r\n]*Math.round\(targetCafLimit\)/);});
test('stage filters use the shared assessment instead of fixed ratios',()=>{for(const name of ['getFilteredStudents','updateBadges']){const source=extract(name);assert.match(source,/getCafStageKey\(/);assert.doesNotMatch(source,/ratio<0\.56/);}});
test('analysis payload excludes no-symptom responses and uses the active sleep shortage cutoff',async()=>{const days=['2026-10-06','2026-10-08','2026-10-09'],elements={};let sent;const runner={withSuccessHandler(){return this},withFailureHandler(){return this},handleAIReportForTeacher(p){sent=p;}};const {c}=setup({cafWarn:80,cafOver:110,sleepSevere:7,aiMinCaf:3,aiMinSleep:3},{studentsData:[{학번:'s',이름:'합성'}],infoData:[{학번:'s',몸무게:68}],currentStudentId:'s',today:'2026-10-09',getModalDates:()=>days,countCafDays:()=>3,countSleepDays:()=>1,getLimit:()=>170,avgCafForDates:()=>52,avgSleepForDates:()=>5,normalizeDaytimeLabel:x=>x,caffeineData:days.map((d,i)=>({학번:'s',섭취시간:d+' 12:00',함량:[150,6,0][i],부작용:i===1?'손이 떨렸다':'없음'})),sleepData:[{학번:'s',날짜:days[0],시간:5}],document:{getElementById:id=>elements[id]||=( {value:'2026-10-09',style:{},classList:{add(){}}})},google:{script:{run:runner}}});vm.runInContext(extract('requestAIAnalysis'),c);await c.requestAIAnalysis();assert.equal(sent.sleepData.badDays,1);assert.equal(sent.caffeineData.symptomRate,'33% (1/3건)');assert.equal(sent.caffeineThresholds.warn,80);});
test('local fallback describes recorded zero as no intake instead of missing records',()=>{const {c}=setup({cafWarn:56,cafOver:100,sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11},{studentsData:[]});vm.runInContext(extract('generateFallbackAnalysis'),c);const result=c.generateFallbackAnalysis({studentId:'s',caffeineData:{totalDays:3},sleepData:{totalDays:3,maxHours:8,minHours:8},period:'합성'},0,8,170);assert.match(result,/섭취 안 함/);assert.doesNotMatch(result,/카페인 섭취 기록이 없습니다/);});

test('custom excess boundary is described separately from the teacher basis',()=>{
 const {c}=setup({cafWarn:56,cafOver:80,sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11},{studentsData:[]});
 vm.runInContext(extract('generateFallbackAnalysis'),c);
 const result=c.generateFallbackAnalysis({studentId:'s',caffeineData:{totalDays:3},sleepData:{totalDays:3,maxHours:8,minHours:8},period:'합성'},153,8,170);
 assert.match(result,/3단계: 과다/);
 assert.match(result,/설정한 초과 경계\(80%\)/);
 assert.doesNotMatch(result,/일일 최대 섭취량을 초과하는 섭취/);
});

test('transport fallback ignores counted no-use and low latency responses',()=>{
 const {c}=setup({cafWarn:56,cafOver:100,sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11},{studentsData:[]});
 vm.runInContext(extract('generateFallbackAnalysis'),c);
 const report=c.generateFallbackAnalysis({studentId:'s',caffeineData:{totalDays:3,topSymptoms:'없음(2회)'},sleepData:{totalDays:3,maxHours:8,minHours:8,topPhone:'안 함(2일)',topLatency:'15분 이내(2일)',topDrowsy:'없음(2일)'},period:'합성'},52,8,170);
 assert.doesNotMatch(report,/수면 잠복기 개선|다만 잠드는|낮 졸음\(없음|다만 부작용/);
 assert.equal(c.hasLifestyleConcern('없음(1일), 60분 이상(1일)',['안함']),true);
});
