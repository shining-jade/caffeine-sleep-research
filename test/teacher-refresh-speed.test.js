import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('teacher/index.html','utf8');
test('recent teacher cache is bounded and expired data is rejected',()=>{
 let stored=JSON.stringify({savedAt:Date.now(),data:{students:[],caffeine:[],sleep:[],info:[]}});const ctx=vm.createContext({sessionStorage:{getItem:()=>stored,removeItem(){stored=null}},window:{}});
 const start=source.indexOf("const TEACHER_VIEW_CACHE=");const end=source.indexOf('function loadRemoteTeacherSettings()',start);vm.runInContext(source.slice(start,end),ctx);
 assert.ok(ctx.readTeacherViewCache());stored=JSON.stringify({savedAt:Date.now()-600001,data:{students:[],caffeine:[],sleep:[],info:[]}});assert.equal(ctx.readTeacherViewCache(),null);stored='invalid';assert.equal(ctx.readTeacherViewCache(),null);
});
test('failed refresh preserves existing student cards and statistics',()=>{
 let failure;const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'saved cards',textContent:'58',disabled:false});return nodes.get(id)};
 const runner={withSuccessHandler(){return this},withFailureHandler(fn){failure=fn;return this},getTeacherData(){}};
 const ctx=vm.createContext({document:{getElementById:get},google:{script:{run:runner}},window:{},console});
 vm.runInContext("let teacherDataLoading=false,visibilityRevision=0;let studentsData=[{'학번':'2410'}];",ctx);
 const start=source.indexOf('function loadDataFromSheet('),end=source.indexOf('\n// ═',start);vm.runInContext(source.slice(start,end),ctx);
 ctx.loadDataFromSheet();assert.equal(get('studentGrid').innerHTML,'saved cards');failure(new Error('network'));assert.equal(get('studentGrid').innerHTML,'saved cards');assert.equal(get('totalStudents').textContent,'58');assert.ok(get('lastUpdate').textContent.includes('기존 자료는 유지'));
});

test('render failure after assigning students settles initial readiness with an error',()=>{
 let success;let rejected=false;const runner={withSuccessHandler(fn){success=fn;return this},withFailureHandler(){return this},getTeacherData(){}};
 const ctx=vm.createContext({document:{getElementById:()=>({innerHTML:'',textContent:'',disabled:false})},google:{script:{run:runner}},window:{},console,readTeacherViewCache:()=>null,updateVisibilityControls(){},initFilters(){throw new Error('render failure')}});
 vm.runInContext("let teacherDataLoading=false,visibilityRevision=0,hiddenStudentIds=new Set(),studentHideSelection=new Set();let studentsData=[],caffeineData=[],sleepData=[],infoData=[];",ctx);
 const start=source.indexOf('function loadDataFromSheet('),end=source.indexOf('\n// ═',start);vm.runInContext(source.slice(start,end),ctx);
 ctx.loadDataFromSheet(()=>assert.fail('must not succeed'),()=>{rejected=true});success({success:true,students:[{'학번':'2410'}],caffeine:[],sleep:[],info:[],hiddenStudentIds:[]});assert.equal(rejected,true);
});
