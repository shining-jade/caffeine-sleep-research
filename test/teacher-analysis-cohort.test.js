import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('teacher/index.html','utf8');
test('analysis cohort excludes hidden and test students; restore preserves original list',()=>{
 const ctx=vm.createContext({studentsData:[{'학번':'0','이름':'테스트'},{'학번':'2410','이름':'A'},{'학번':'2411','이름':'B'}]});
 vm.runInContext(source.slice(source.indexOf('const TEST_STUDENT_NAMES='),source.indexOf('function toggleStudentHideSelection('))+'let showTestStudents=false;',ctx);
 assert.equal(vm.runInContext('getAnalysisStudents().length',ctx),2);
 vm.runInContext("hiddenStudentIds.add('2410')",ctx);assert.equal(vm.runInContext('getAnalysisStudents().length',ctx),1);
 vm.runInContext("hiddenStudentIds.delete('2410')",ctx);assert.equal(vm.runInContext('getAnalysisStudents().length',ctx),2);
 assert.equal(ctx.studentsData.length,3);
});
test('daily mean includes recorded zero but excludes missing students and sums multiple drinks per student',()=>{
 const ctx=vm.createContext({Set});vm.runInContext(source.slice(source.indexOf('function getDailyCaffeineSummary('),source.indexOf('function avgCafForDates(')),ctx);
 const records=[{'학번':'1','섭취시간':'2026-10-06 09:00','함량':100},{'학번':'1','섭취시간':'2026-10-06 10:00','함량':50},{'학번':'2','섭취시간':'2026-10-06 10:00','함량':0}];
 const r=ctx.getDailyCaffeineSummary(records,58,'2026-10-06');assert.equal(r.recorded,2);assert.equal(r.average,75);assert.equal(r.total,58);
 assert.equal(ctx.getDailyCaffeineSummary(records,58,'2026-10-05').average,null);
});

test('late data refresh cannot undo a newer confirmed hidden-student setting',()=>{
 let success;const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getTeacherData(){}};
 const ctx=vm.createContext({google:{script:{run:runner}},document:{getElementById:()=>({disabled:false,textContent:'',innerHTML:''})},console:{error(){},log(){}},updateVisibilityControls(){}});
 vm.runInContext("let visibilityRevision=0;let hiddenStudentIds=new Set();let studentHideSelection=new Set();let studentsData=[],caffeineData=[],sleepData=[],infoData=[];",ctx);
 const start=source.indexOf('function loadDataFromSheet(){');const end=source.indexOf('\nfunction ',start+10);
 vm.runInContext(source.slice(start,end),ctx);ctx.loadDataFromSheet();
 vm.runInContext("visibilityRevision++;hiddenStudentIds=new Set(['2410']);",ctx);
 success({success:true,hiddenStudentIds:[],students:[],caffeine:[],sleep:[],info:[]});
 assert.deepEqual(Array.from(vm.runInContext('hiddenStudentIds',ctx)),['2410']);
});
