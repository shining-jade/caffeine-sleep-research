import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const start=html.indexOf(`    function ${name}(`);return html.slice(start,html.indexOf('\n    }',start)+6);}
const teen={ageGroup:'teen',sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11};
const adult={ageGroup:'adult',sleepSevere:6,sleepWarn:7,sleepGood:9,sleepMax:10};
function setup(settings=teen){
 const configs=[], elements={sleepLegend:{innerHTML:''},sleepRecommendLabel:{textContent:''}};
 const c=vm.createContext({window:{},SLEEP_CFG:{...settings},user:{studentId:'fictional'},lastDashboardData:null,userLimit:150,
 caffeineChart:null,sleepChart:null,document:{getElementById:id=>elements[id]||(id.endsWith('Chart')?{getContext:()=>({})}:null)},
 Chart:function(_,config){configs.push(config);this.destroy=()=>{};},buildSleepDataByLifeDate:(_,values)=>values,setTimeout(){},
 cacheStudentRecords(){},renderCaffeineLogs(){},renderSleepLogs(){},updateDashboard(){},refreshData(){},
 updateLimitDisplay(){},updateTargetSleepDisplay(){},showWeightSetupModal(){},google:{script:{run:{withSuccessHandler(h){this.success=h;return this;},withFailureHandler(){return this;},getSleepSettings(){}}}}
 });
 vm.runInContext(['renderCharts','applyWeightData','applyStudentBootstrap','loadSleepSettingsLegacy','changeSettingsAgeGroup'].map(extract).join('\n'),c);
 return{c,configs,elements};
}
test('teen sleep graph stages and threshold lines match configured save feedback',()=>{
 const x=setup();x.c.renderCharts({labels:['1','2','3','4','5','6'],sleepData:[6.5,7.5,8,10.5,11,0]});
 const chart=x.configs[1];assert.deepEqual(Array.from(chart.data.datasets[0].backgroundColor),['#ef4444','#f97316','#22c55e','#eab308','#a855f7','rgba(209,213,219,0.4)']);
 assert.match(chart.options.plugins.tooltip.callbacks.label({datasetIndex:0,dataIndex:3}),/적당한 수면/);
});
test('adult graph recommendations, tooltip and legend use adult settings',()=>{
 const x=setup(adult);x.c.renderCharts({labels:['1'],sleepData:[7.5]});const chart=x.configs[1];
 assert.equal(chart.data.datasets[2].data[0],7);assert.equal(chart.data.datasets[3].data[0],9);
 assert.match(chart.options.plugins.tooltip.callbacks.label({datasetIndex:2}),/7시간/);
 assert.match(x.elements.sleepLegend.innerHTML,/7~9h/);
});
test('bootstrap retains saved adult profile instead of global teen default',()=>{
 const x=setup();x.c.applyStudentBootstrap({dashboardRequestId:0,weight:{success:true,weight:60,ageGroup:'adult'},sleepSettings:{success:true,settings:teen},stats:{},caffeineLogs:[],sleepLogs:[]});
 assert.equal(x.c.SLEEP_CFG.ageGroup,'adult');assert.equal(x.c.SLEEP_CFG.sleepWarn,7);
});
test('matching teacher thresholds survive bootstrap and profile loading',()=>{
 const custom={...teen,sleepSevere:6.5,sleepWarn:7.5,sleepGood:9.5,sleepMax:10.5};
 const x=setup();x.c.applyStudentBootstrap({dashboardRequestId:0,weight:{success:true,weight:60,ageGroup:'teen'},sleepSettings:{success:true,settings:custom},stats:{},caffeineLogs:[],sleepLogs:[]});
 assert.equal(x.c.SLEEP_CFG.sleepWarn,7.5);assert.equal(x.c.SLEEP_CFG.sleepGood,9.5);
});
test('late legacy global settings do not overwrite a saved adult profile',()=>{
 const x=setup();x.c.applyWeightData({success:true,weight:60,ageGroup:'adult'});x.c.loadSleepSettingsLegacy();
 x.c.google.script.run.success({success:true,settings:teen});assert.equal(x.c.SLEEP_CFG.ageGroup,'adult');assert.equal(x.c.SLEEP_CFG.sleepGood,9);
});
test('fresh profile age takes priority over the previously loaded age without losing matching custom thresholds',()=>{
 const x=setup(adult);x.c.window.studentAgeGroup='adult';const custom={...teen,sleepWarn:7.5,sleepGood:9.5};
 x.c.applyStudentBootstrap({dashboardRequestId:0,weight:{success:true,weight:60,ageGroup:'teen'},sleepSettings:{success:true,settings:custom},stats:{},caffeineLogs:[],sleepLogs:[]});
 assert.equal(x.c.SLEEP_CFG.ageGroup,'teen');assert.equal(x.c.SLEEP_CFG.sleepWarn,7.5);
 assert.equal(custom.ageGroup,'teen');assert.equal(custom.sleepWarn,7.5);
});
test('legacy profile arriving after settings and chart refresh immediately redraws adult thresholds',()=>{
 const x=setup();x.c.lastDashboardData={labels:['1'],sleepData:[7.5]};x.c.loadSleepSettingsLegacy();
 x.c.google.script.run.success({success:true,settings:teen});assert.equal(x.configs.at(-1).data.datasets[2].data[0],8);
 x.c.applyWeightData({success:true,weight:60,ageGroup:'adult'});
 assert.equal(x.configs.at(-1).data.datasets[2].data[0],7);assert.equal(x.configs.at(-1).data.datasets[0].backgroundColor[0],'#22c55e');
});
