import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function renderCharts(');
const source=html.slice(start,html.indexOf('\n    }',start)+6);
function setup(){
 const instances=[],timers=[];
 const canvases={caffeineChart:{getContext:()=>({})},sleepChart:{getContext:()=>({})}};
 const c=vm.createContext({userLimit:150,caffeineChart:null,sleepChart:null,
  SLEEP_CFG:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11},
  buildSleepDataByLifeDate:(_,values)=>values,
  document:{getElementById:id=>canvases[id]||null,querySelectorAll:()=>[]},
  setTimeout:fn=>timers.push(fn),
  Chart:function(_,config){this.data=config.data;this.options=config.options;this.updates=[];this.destroyed=false;this.update=mode=>this.updates.push(mode);this.destroy=()=>{this.destroyed=true};instances.push(this)}
 });
 vm.runInContext(source,c);
 const data={labels:['10/10','10/11'],caffeineData:[35,60],caffeineHasData:[true,true],sleepData:[8.5,8]};
 return {c,data,instances,timers};
}

test('repeated dashboard responses keep the same charts and do not replay identical data',()=>{
 const x=setup();x.c.renderCharts(x.data);const first=[...x.instances];
 x.c.renderCharts(JSON.parse(JSON.stringify(x.data)));x.c.renderCharts({...x.data,todayTotal:60});
 assert.equal(x.instances.length,2);assert.ok(first.every(chart=>!chart.destroyed));
 assert.ok(first.every(chart=>chart.updates.length===0));
 assert.equal(x.timers.length,1,'unchanged dates must not keep resetting chart scroll positions');
});

test('changed caffeine values update in place without animation and preserve sleep chart',()=>{
 const x=setup();x.c.renderCharts(x.data);
 x.c.renderCharts({...x.data,caffeineData:[35,90]});
 assert.equal(x.instances.length,2);assert.deepEqual(x.instances[0].updates,['none']);
 assert.deepEqual(Array.from(x.instances[0].data.datasets[0].data),[35,90]);
 assert.equal(x.instances[1].updates.length,0);
});

test('goal and sleep threshold changes update reference lines and tooltip labels in place',()=>{
 const x=setup();x.c.renderCharts(x.data);x.c.userLimit=100;x.c.SLEEP_CFG.sleepWarn=9;
 x.c.renderCharts(x.data);assert.equal(x.instances.length,2);
 assert.deepEqual(Array.from(x.instances[0].data.datasets[1].data),[100,100]);
 assert.deepEqual(Array.from(x.instances[1].data.datasets[2].data),[9,9]);
 assert.match(x.instances[1].options.plugins.tooltip.callbacks.label({datasetIndex:2}),/9/);
 assert.deepEqual(x.instances[0].updates,['none']);assert.deepEqual(x.instances[1].updates,['none']);
});

test('recorded zero remains distinct from missing caffeine and changed dates still update chart labels',()=>{
 const x=setup();x.c.renderCharts({...x.data,caffeineData:[0,0],caffeineHasData:[false,false]});
 const before=x.instances[0].data.datasets[0].backgroundColor[0];
 x.c.renderCharts({...x.data,caffeineData:[0,0],caffeineHasData:[true,false]});
 assert.notEqual(x.instances[0].data.datasets[0].backgroundColor[0],before);
 x.c.renderCharts({...x.data,labels:['10/11','10/12']});
 assert.deepEqual(Array.from(x.instances[0].data.labels),['10/11','10/12']);
 assert.equal(x.instances.length,2);assert.equal(x.timers.length,2);
});
