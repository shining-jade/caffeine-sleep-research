import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  if (start < 0) return '';
  return source.slice(start, source.indexOf('\n    }', start) + 6);
}
function form(records = [], oldDefaults = new Map()) {
  const fields = Object.fromEntries(['sleepStart','sleepEnd','sleepDate','caffeineTime','sleepLogsContainer',
    'tab-sleep','nav-sleep','tab-caffeine','nav-caffeine'].map(id => [id, {
    value:'', classList:{add(){},remove(){},contains(){return false;}}, appendChild(){}, innerHTML:'',
  }]));
  let success;
  const context = vm.createContext({ sleepLogs:records, sleepTimeDraftEdited:false, user:{studentId:'0',name:'테스트'},
    window:{scrollTo(){}}, selectedCondition:{}, lastDashboardData:null,
    document:{getElementById:id=>fields[id] || null,querySelectorAll:()=>[],createElement:()=>({querySelector:()=>({})})},
    escapeHtml:v=>String(v??''),
    localStorage:{getItem:key=>oldDefaults.get(key),setItem(){}},saveCurrentTab(){},resetSleepChoices(){},
    loadCaffeineLogs(){}, renderCharts(){},cacheStudentRecords(){},showRecordConnectionError(){},
    google:{script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getSleepLogs(){}}}},
    getTodayKST:()=> '2026-10-09', getSleepTimingInfo:()=>({}),formatConditionWithLabel:()=>'',
  });
  for (const name of ['toDateInputValue','toDatetimeLocalValue','datePartFromDatetime','timePartFromDatetime',
    'combineDateAndTime','sleepLogEndKey','compareSleepLogsByEndDesc','applyRecentSleepTimeDefaults',
    'setCurrentTime','refreshCalendarIfVisible','renderSleepLogs','loadSleepLogs','showTab']) vm.runInContext(extract(name),context);
  return { context,fields,open:()=>context.showTab('sleep'),receive:logs=>{context.loadSleepLogs();success(logs);},
    edit(id,value){
      fields[id].value=value;
      const tag=source.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
      const event=tag.match(/oninput="([^"]+)"/);
      if(event)vm.runInContext(event[1],context);
    } };
}
const older = { id:'old',date:'2026-10-05',wakeDate:'2026-10-06',start:'22:00',end:'06:00' };
const latest = { id:'recent',date:'2026-10-08',wakeDate:'2026-10-09',start:'23:45',end:'07:15' };

test('a fresh browser fills recent server sleep times using current record dates',()=>{
  const f=form([older,latest]); f.open();
  assert.equal(f.fields.sleepStart.value,'2026-10-08T23:45');
  assert.equal(f.fields.sleepEnd.value,'2026-10-09T07:15');
  assert.equal(f.fields.sleepDate.value,'2026-10-08');
});
test('recent server times override stale browser-only defaults',()=>{
  const f=form([older,latest],new Map([['lastSleepStart_0','21:00'],['lastSleepEnd_0','05:00']])); f.open();
  assert.equal(f.fields.sleepStart.value,'2026-10-08T23:45');
  assert.equal(f.fields.sleepEnd.value,'2026-10-09T07:15');
});
test('sleep history arriving after the form opens updates untouched defaults',()=>{
  const f=form();f.open();f.receive([older,latest]);
  assert.equal(f.fields.sleepStart.value,'2026-10-08T23:45');
});
test('a bedtime after midnight and morning wake time share the current date',()=>{
  const f=form([{...latest,date:'2026-10-07',wakeDate:'2026-10-07',start:'01:10',end:'08:00'}]);f.open();
  assert.equal(f.fields.sleepStart.value,'2026-10-09T01:10');
  assert.equal(f.fields.sleepEnd.value,'2026-10-09T08:00');
});
test('edited sleep dates and times survive late history, refresh and tab changes',()=>{
  const f=form([latest]);f.open();f.edit('sleepStart','2026-10-07T00:10');f.edit('sleepEnd','2026-10-07T09:30');
  f.receive([older]);f.context.showTab('caffeine');f.open();
  assert.equal(f.fields.sleepStart.value,'2026-10-07T00:10');
  assert.equal(f.fields.sleepEnd.value,'2026-10-07T09:30');
});
test('intentionally cleared sleep time stays empty during a late history response',()=>{
  const f=form();f.open();f.edit('sleepStart','');f.receive([latest]);
  assert.equal(f.fields.sleepStart.value,'');
});
test('malformed recent records do not displace the latest valid sleep record',()=>{
  const f=form([latest,{...latest,date:'2026-10-09',start:'99:90'},{...latest,date:'not-a-date'}]);f.open();
  assert.equal(f.fields.sleepStart.value,'2026-10-08T23:45');
});
test('another account with no history does not inherit the browsers last student times',()=>{
  const f=form([],new Map([['lastSleepStart_0','21:40']]));f.open();
  assert.equal(f.fields.sleepStart.value.slice(11),'23:00');
});
