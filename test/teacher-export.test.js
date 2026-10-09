import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=fs.readFileSync('teacher/index.html','utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);if(start<0)return '';const end=source.indexOf('\nfunction ',start+9);return source.slice(start,end<0?undefined:end);}
function setup({days=7,filter='',mode='7',search=''}={}){
 const dates=Array.from({length:days},(_,i)=>new Date(Date.UTC(2026,9,10-days+i)).toISOString().slice(0,10));
 const students=[{학년:'1',반:'1',번호:'1',학번:'0',이름:'합성 테스트'},{학년:'1',반:'1',번호:'2',학번:'1',이름:'제로'},{학년:'1',반:'1',번호:'3',학번:'2',이름:'미기록'}];
 const caffeineData=[{학번:'0',섭취시간:'2026-10-06 13:13',함량:150},{학번:'0',섭취시간:'2026-10-08 14:08',함량:2},{학번:'0',섭취시간:'2026-10-08 16:07',함량:4},{학번:'0',섭취시간:'2026-10-09 06:00',함량:0},{학번:'1',섭취시간:'2026-10-09 09:00',함량:0}];
 const fields={studentSearchInput:{value:search},studentDateFilter:{value:'2026-10-09'},studentEndDate:{value:'2026-10-06'}};
 const saved={};
 const c=vm.createContext({today:'2026-10-09',studentPeriodMode:mode,Blob,
  caffeineData,sleepData:[],
  getAnalysisStudents:()=>students,msGet:()=>null,normalizeGrade:x=>x,getStudentDates:()=>dates,
  activeFilters:{caf:new Set(filter?[filter]:[]),sleep:new Set(),award:new Set(),record:new Set()},
  getLimit:()=>150,S:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11},
  findSleepForLifeDate:(id,date)=>id==='0'&&date==='2026-10-05'?{시간:8}:id==='0'&&date==='2026-10-07'?{시간:16}:null,
  hasSleepRecordOnWakeDate:(id,date)=>id==='0'&&date==='2026-10-06',
  getPersonalInfo:()=>({목표취침:'23:00',목표기상:'07:00'}),getTargetCafText:id=>id==='2'?'미설정':'150mg',
  evaluateAwards:()=>[{name:'합성 자동'}],getManualAwardsFor:()=>[{name:'합성 수여',message:'쉼표, "따옴표"\n줄바꿈'}],
  updateBadges(){},renderStudentGrid(rows){saved.visible=rows.map(x=>x.학번)},
  document:{getElementById:id=>fields[id]||null,createElement:()=>({click(){saved.clicked=true}}),body:{appendChild(){},removeChild(){}}},
  URL:{createObjectURL(blob){saved.blob=blob;return 'blob:synthetic'},revokeObjectURL(){}},
  showTeacherModal(){},alert(){},google:{script:{run:{withSuccessHandler(){return this},withFailureHandler(){return this},exportDataToNewSheet(payload){saved.sheet=payload}}}}
 });
 vm.runInContext(['getStudentFilterDate','getFilteredStudents','filterStudents','avgCafForDates','hasCafRecordOnDates','avgSleepForDates','getCafStatusInfo','getSleepStatusInfo','exportStudentExcel','exportStudentToSheet'].map(extract).join('\n'),c);
 return {c,saved};
}
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(ch===','||ch==='\n')){row.push(cell);cell='';if(ch==='\n'){rows.push(row);row=[];}}else cell+=ch;}row.push(cell);rows.push(row);return rows;}
test('teacher download creates a CSV containing matching means and teacher award comments',async()=>{
 const x=setup();assert.doesNotThrow(()=>x.c.exportStudentExcel());assert.equal(x.saved.clicked,true);
 const rows=parseCsv(await x.saved.blob.text());assert.equal(rows[3][5],'52');assert.equal(rows[3][7],'12.0');assert.equal(rows[3][16],'쉼표, "따옴표"\n줄바꿈');
});
test('CSV preserves recorded zero separately from an unrecorded student',async()=>{
 const x=setup();x.c.exportStudentExcel();const rows=parseCsv(await x.saved.blob.text());assert.equal(rows[4][5],'0');assert.equal(rows[4][6],'카페인 섭취 안 함');assert.equal(rows[5][5],'-');assert.equal(rows[5][6],'미기록');
});
for(const kind of ['csv','sheet']){
 test(`${kind} headings describe the actual selected 14-day period`,async()=>{
  const x=setup({days:14});if(kind==='csv')x.c.exportStudentExcel();else x.c.exportStudentToSheet();const header=kind==='csv'?parseCsv(await x.saved.blob.text())[2]:x.saved.sheet.rows[0];assert.equal(header[5],'14일평균카페인(mg)');assert.equal(header[7],'14일평균수면(h)');
 });
 test(`${kind} exports only the same stage-filtered students shown on screen`,async()=>{
  const x=setup({filter:'caf0'});x.c.filterStudents();assert.deepEqual(Array.from(x.saved.visible),['1']);if(kind==='csv')x.c.exportStudentExcel();else x.c.exportStudentToSheet();const rows=kind==='csv'?parseCsv(await x.saved.blob.text()).slice(3):x.saved.sheet.rows.slice(1);assert.deepEqual(Array.from(rows,r=>r[4]),['1']);
 });
}
test('custom-period record flags use its selected end date rather than the hidden regular date',()=>{
 const x=setup({mode:'custom'});assert.equal(x.c.getStudentFilterDate(),'2026-10-06');x.c.exportStudentToSheet();assert.equal(x.saved.sheet.rows[1][9],'O');assert.equal(x.saved.sheet.rows[1][10],'O');
});
test('sheet export leaves unrecorded means and unset goals blank rather than inventing zero',()=>{
 const x=setup();x.c.exportStudentToSheet();const rows=x.saved.sheet.rows;assert.equal(rows[2][5],0);assert.equal(rows[3][5],'');assert.equal(rows[3][7],'');assert.equal(rows[3][11],'');
});
test('sheet dropdowns align with status and badge columns and accept emitted values',()=>{
 const x=setup();x.c.exportStudentToSheet();const {rows,dropdownCols}=x.saved.sheet;
 assert.deepEqual(Array.from(dropdownCols,d=>rows[0][d.colIndex-1]),['카페인상태','수면상태','자동뱃지목록','교사수여뱃지목록']);
 for(const d of dropdownCols)for(const row of rows.slice(1))if(row[d.colIndex-1])assert.ok(d.values.includes(row[d.colIndex-1]),row[d.colIndex-1]);
});
test('stage filter headings describe the current custom or preset period',()=>{
 for(const days of [1,14]){
  const fields={studentDateRangeLabel:{},studentCafStageLabel:{},studentSleepStageLabel:{}};
  const c=vm.createContext({document:{getElementById:id=>fields[id]||null},getStudentDates:()=>Array(days).fill('2026-10-09'),getPeriodLabel:()=>'',filterStudents(){}});
  vm.runInContext(extract('onStudentDateChange'),c);c.onStudentDateChange();
  assert.equal(fields.studentCafStageLabel.textContent,`카페인 단계 (${days}일 평균)`);
  assert.equal(fields.studentSleepStageLabel.textContent,`수면 단계 (${days}일 평균)`);
 }
});
