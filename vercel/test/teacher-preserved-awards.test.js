import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function fn(name){
 const start=source.indexOf('function '+name+'(');
 if(start<0)return '';
 const end=source.indexOf('\nfunction ',start+1);
 return source.slice(start,end<0?source.indexOf('</script>',start):end);
}
const helpers=['teacherAwardOwnerName','teacherAwardMatchesOwner','getOwnedAwardEntries','getManualAwardsFor','composeStudentAwards'];
const student={학번:'2101',이름:'Synthetic A',학년:'2',반:'1',번호:'1'};
const durable={awardId:'journey_3',studentId:'2101',studentName:'Synthetic A',kind:'automatic',preserved:true,name:'Original milestone',image:'star',grantedAt:'2026-10-20'};
const manual={awardId:'reflection',studentName:'Synthetic A',name:'Teacher reflection',grantedAt:'2026-10-21'};
const wrong={awardId:'other',studentId:'2101',studentName:'Different person',kind:'automatic',name:'Not theirs'};
function setup(awards=[wrong,durable,manual],computed=[{id:'journey_3',name:'Recomputed milestone'}]){
 const ctx=vm.createContext({manualAwards:{'2101':structuredClone(awards)},studentsData:[student],evaluateAwards:()=>computed,console});
 vm.runInContext(helpers.map(fn).join('\n'),ctx);
 return ctx;
}

test('stored awards bind current name as well as student ID',()=>{
 const ctx=setup([wrong,durable,{...durable,studentName:''},manual,{...manual,awardId:'legacy',studentName:''}]);
 assert.deepEqual(Array.from(ctx.getManualAwardsFor('2101'),a=>a.name),['Original milestone','Teacher reflection']);
});

test('composition counts durable automatic milestones once and preserves original metadata',()=>{
 const ctx=setup();
 assert.equal(typeof ctx.composeStudentAwards,'function','shared award composition must exist');
 const result=ctx.composeStudentAwards('2101',[{id:'journey_3',name:'New metadata'},{id:'today_sleep',name:'Today sleep'}]);
 assert.deepEqual(Array.from(result.automatic,a=>a.name),['Original milestone','Today sleep']);
 assert.deepEqual(Array.from(result.manual,a=>a.name),['Teacher reflection']);
 assert.equal(result.automatic[0].kind,'automatic');
 assert.equal(result.manual[0]._manualAwardIndex,2);
 assert.equal(result.all.length,3);
});

test('teacher copies deduplicate the same milestone without losing their original delete index',()=>{
 const copy={...manual,awardId:'journey_3',name:'Original milestone',message:'Teacher note'};
 const ctx=setup([wrong,durable,copy]);
 assert.equal(typeof ctx.composeStudentAwards,'function');
 const result=ctx.composeStudentAwards('2101',[{id:'journey_3',name:'Original milestone'}]);
 assert.equal(result.all.length,1);assert.equal(result.manual.length,1);
 assert.equal(result.manual[0].message,'Teacher note');assert.equal(result.manual[0]._manualAwardIndex,2);
});

test('different award IDs are not collapsed merely because names happen to match',()=>{
 const ctx=setup([durable]);assert.equal(typeof ctx.composeStudentAwards,'function');
 const result=ctx.composeStudentAwards('2101',[{id:'different_milestone',name:durable.name}]);
 assert.equal(result.automatic.length,2);
});

test('chips show automatic awards without teacher labels or delete controls and preserve manual source indices',()=>{
 const ctx=setup();vm.runInContext(fn('renderAwardChips'),ctx);
 const html=ctx.renderAwardChips('2101',[],'2026-11-10',true);
 assert.match(html,/data-award-kind="automatic"/);
 assert.equal((html.match(/Original milestone/g)||[]).length,1);
 assert.doesNotMatch(html,/deleteManualAward\('2101',1\)/);
 assert.match(html,/deleteManualAward\('2101',2\)/);
 assert.doesNotMatch(html,/Not theirs/);
});

test('direct deletion calls cannot remove a durable automatic award',()=>{
 const ctx=setup();let effects=0;
 Object.assign(ctx,{showTeacherConfirm(){effects++;},saveManualAwards(){effects++;},revokeManualAward(){effects++;}});
 vm.runInContext(fn('deleteManualAward')+'\n'+fn('_doDeleteManualAward'),ctx);
 assert.doesNotThrow(()=>ctx.deleteManualAward('2101',1));
 assert.doesNotThrow(()=>ctx._doDeleteManualAward('2101',1));
 assert.equal(effects,0);assert.equal(ctx.manualAwards['2101'].length,3);
});

for(const name of ['exportStudentExcel','exportStudentToSheet'])test(name+' separates preserved automatic awards from teacher awards',()=>{
 const ctx=setup();Object.assign(ctx,{s:student,d7:[],fd:'2026-11-10'});
 const body=fn(name);const start=body.includes('        const awardGroups=')?body.indexOf('        const awardGroups='):body.indexOf('        const autoList=');
 // Execute the production award-composition statements without download transport.
 const end=body.indexOf('\n',body.indexOf('const manualList=',start));
 const code=body.slice(start,end)+'\n;({autoList,manualList});';
 const result=vm.runInContext(code,ctx);
 assert.deepEqual(Array.from(result.autoList,a=>a.name),['Original milestone']);
 assert.deepEqual(Array.from(result.manualList,a=>a.name),['Teacher reflection']);
});

test('PDF composition emits one correctly typed preserved badge and excludes the wrong owner',()=>{
 const ctx=setup();Object.assign(ctx,{studentId:'2101',s:student,report:null,endDate:'2026-11-10',dates:[],options:{}});
 const body=fn('exportPDF');const start=body.indexOf('        const autoEarned =');const end=body.indexOf('        if (allBadges.length',start);
 const result=vm.runInContext(body.slice(start,end)+'\n;allBadges;',ctx);
 assert.equal(result.length,2);assert.equal(result[0].name,'Original milestone');
 assert.equal(result[0].type,'auto');assert.equal(result[1].type,'manual');
});

test('v50 report PDF lists a preserved milestone and its teacher copy only once',()=>{
 const copy={...manual,awardId:durable.awardId,name:'Teacher copy',message:'Teacher note'};
 const report={student,dates:['2026-11-10'],feedback:{engine:{}},awards:[wrong,durable,copy,manual]};
 const ctx=setup();
 let input;
 Object.assign(ctx,{normalizePDFOptions:()=>({}),window:{teacherReportFiles:{buildGoalPdfDocument(value){
   input=value;
   return {detailed:false};
 }}}});
 vm.runInContext(fn('exportPDF'),ctx);
 ctx.exportPDF({report});
 assert.deepEqual(Array.from(input.awards,a=>a.name),['Teacher copy','Teacher reflection']);
 assert.equal(input.awards[0].message,'Teacher note');
 assert.equal(input.feedback,report.feedback);
});

test('awards-tab chips retain owner identity and expose deletion only for the original manual row',()=>{
 const ctx=setup();const nodes=new Map();ctx.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:''});return nodes.get(id);}};
 vm.runInContext(fn('renderAwardsTab'),ctx);ctx.renderAwardsTab();
 const html=ctx.document.getElementById('awardsTabContent').innerHTML;
 assert.doesNotMatch(html,/Not theirs/);assert.doesNotMatch(html,/deleteManualAward\('2101',1\)/);
 assert.match(html,/deleteManualAward\('2101',2\)/);
 assert.match(html,/자동 기록/);
});

test('manual deletion still opens confirmation for the original source row',()=>{
 const ctx=setup();let confirmation;
 ctx.showTeacherConfirm=(...args)=>{confirmation=args;};
 vm.runInContext(fn('deleteManualAward'),ctx);
 assert.doesNotThrow(()=>ctx.deleteManualAward('2101',2));
 assert.match(confirmation[2],/Teacher reflection/);
});

test('teacher-only absence count and filter do not mistake automatic awards for teacher grants',()=>{
 const ctx=setup([durable]);let count;
 Object.assign(ctx,{n:(id,value)=>{count=value;},getAnalysisStudents:()=>[student],af:new Set(['awardNoTeacher']),sAwards:[durable],teacherMatch:false});
 const countLine=source.split('\n').find(line=>line.includes("n('cntAwardNoTeacher'"));
 const filterLine=source.split('\n').find(line=>line.includes("if(af.has('awardNoTeacher'))"));
 vm.runInContext(countLine+'\n'+filterLine,ctx);
 assert.equal(count,1);assert.equal(ctx.teacherMatch,true);
});
