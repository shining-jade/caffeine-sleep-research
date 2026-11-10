import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../public/js/badge-journey.js';
import {createStudentRecordCache} from '../public/js/student-startup.js';
const B=globalThis.BadgeJourney;
const teacher=fs.readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
const student=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const SleepRecordPolicy=vm.runInNewContext(
 fs.readFileSync(new URL('../public/js/sleep-record-policy.js',import.meta.url),'utf8')+'\n;SleepRecordPolicy'
);
function fn(source,name){const start=source.indexOf('function '+name+'(');const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?source.indexOf('</script>',start):end)+'\n';}
function dom(){const nodes=new Map();return {nodes,getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',classList:{add(){},toggle(){},contains(){return false;}}});return nodes.get(id);}};}
const owner={학번:'2401',name:'Synthetic B'};
const sleep=(date,wakeDate)=>({...owner,date,wakeDate,start:'23:00',end:'07:00',sleepType:'main_candidate',classificationStatus:'candidate',typeSource:'basic_form'});
const teacherOwnership=fn(teacher,'teacherAwardOwnerName')+fn(teacher,'badgeOwnerRecords');
test('startup discards record snapshots made before authenticated owner filtering',()=>{
 const user={studentId:'2401',name:'Synthetic B'};
 const storage=new Map([['student-record-snapshot-v1',JSON.stringify({owner:JSON.stringify(['2401','Synthetic B']),records:{caffeineLogs:[{id:'previous-owner'}]}})]]);
 const cache=createStudentRecordCache({getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)});
 assert.equal(cache.read(user),null);
 cache.write(user,'caffeineLogs',[{id:'verified-owner'}]);
 assert.deepEqual(cache.read(user).caffeineLogs,[{id:'verified-owner'}]);
});
test('teacher journey status and earned milestones ignore another owner’s records',()=>{
 const document=dom();
 const student={학번:'2401',이름:'Synthetic B',반:4};
 const caffeineData=['07','08','09'].map(day=>({학번:'2401',name:'Synthetic A',섭취시간:`2026-11-${day} 12:00:00`}));
 const sleepData=[['07','08'],['08','09'],['09','10']].map(([day,wake])=>({...sleep(`2026-11-${day}`,`2026-11-${wake}`),name:'Synthetic A'}));
 const context={document,BadgeJourney:B,SleepRecordPolicy,journeyConfig:B.prepareUpgrade(null),getKSTDate:()=> '2026-11-10',getAnalysisStudents:()=>[student],studentsData:[student],caffeineData,sleepData,getSleepWakeDate:r=>r.wake,escapeHtml:x=>x};
 vm.runInNewContext(teacherOwnership+fn(teacher,'renderJourneyStatus')+fn(teacher,'evaluateJourneyBadges')+';renderJourneyStatus();',context);
 assert.equal(vm.runInNewContext("evaluateJourneyBadges('2401','2026-11-10').length",context),0);
 assert.match(document.getElementById('journeyStatusBody').innerHTML,/<strong>0일<\/strong>/);
});
test('student shows a retired milestone once and retains original automatic award metadata',()=>{
 const document=dom();
 const context={document,BadgeJourney:B,SleepRecordPolicy,badgeConfig:B.prepareUpgrade(null),user:{studentId:'2401'},getTodayKST:()=> '2026-11-10',caffeineLogs:[],sleepLogs:[],teacherAwards:[
  {awardId:'journey_21',kind:'automatic',name:'Original milestone'},
  {awardId:'journey_21',name:'Teacher copy'},
  {awardId:'another',name:'Separate award'},
 ]};
 const start=student.indexOf('function updateBadges()');const end=student.indexOf('// ── 뱃지 이미지 팝업',start);
 vm.runInNewContext(student.slice(start,end)+';updateBadges();',context);
 const html=document.getElementById('teacherDirectBadgeList').innerHTML;
 assert.match(html,/Original milestone/);
 assert.doesNotMatch(html,/Teacher copy/);
 assert.match(html,/Separate award/);
});
test('teacher status uses wake day pairing and six-day actual action denominator',()=>{
 const document=dom(); const context={document,BadgeJourney:B,SleepRecordPolicy,journeyConfig:B.prepareUpgrade(null),getKSTDate:()=> '2026-11-10',getAnalysisStudents:()=>[{학번:'2401',이름:owner.name,반:4}],caffeineData:[{...owner,섭취시간:'2026-11-08T16:00:00Z'}],sleepData:[sleep('2026-11-09','2026-11-10')],escapeHtml:x=>x};
 vm.runInNewContext(teacherOwnership+fn(teacher,'renderJourneyStatus')+';renderJourneyStatus();',context);
 assert.match(document.getElementById('journeyStatusBody').innerHTML,/완료 1\/6/);
 assert.match(document.getElementById('journeyStatusBody').innerHTML,/<strong>1일<\/strong>/);
});
test('teacher report uses full schedule for 80% even with earlier report cutoff',()=>{
 const cfg=B.prepareUpgrade(null);const dates=B.dateRange('2026-10-06','2026-10-20');
 const context={BadgeJourney:B,SleepRecordPolicy,journeyConfig:cfg,caffeineData:dates.map(d=>({...owner,섭취시간:d+'T12:00:00+09:00'})),sleepData:dates.map(d=>sleep(d,B.shiftDate(d,1))),getKSTDate:()=> '2026-11-10'};
 const result=vm.runInNewContext(teacherOwnership+fn(teacher,'evaluateJourneyBadges')+";evaluateJourneyBadges('2401','2026-10-21',null,'Synthetic B');",context);
 assert.deepEqual(Array.from(result,x=>x.id),['journey_3','journey_7','journey_14']);
});
test('student completes final prior day and still displays retired earned badges',()=>{
 const document=dom();const context={document,BadgeJourney:B,SleepRecordPolicy,badgeConfig:B.prepareUpgrade(null),user:{studentId:'2401'},getTodayKST:()=> '2026-11-10',caffeineLogs:[{time:'2026-11-08T16:00:00Z'}],sleepLogs:[sleep('2026-11-09','2026-11-10')],teacherAwards:[{awardId:'journey_21',name:'꾸준한 기록가',alwaysSeen:true}]};
 const start=student.indexOf('function updateBadges()');const end=student.indexOf('// ── 뱃지 이미지 팝업',start);
 vm.runInNewContext(student.slice(start,end)+';updateBadges();',context);
 assert.match(document.getElementById('journey-total-days').textContent,/1일/);
 assert.match(document.getElementById('teacherDirectBadgeList').innerHTML,/꾸준한 기록가/);
 assert.match(document.getElementById('challengeBadgeGrid').innerHTML,/28일/);
});
test('student and teacher badge progress include an eligible legacy wake without assigning a research target',()=>{
 const badgeConfig=B.prepareUpgrade(null);
 const record={...sleep('2026-11-09','2026-11-10'),sleepType:'',classificationStatus:'uncollected',typeSource:'legacy_uncollected'};
 const time='2026-11-09 12:00:00';
 const teacherDocument=dom();
 const teacherContext={document:teacherDocument,BadgeJourney:B,SleepRecordPolicy,journeyConfig:badgeConfig,getKSTDate:()=> '2026-11-10',
  getAnalysisStudents:()=>[{학번:owner.학번,이름:owner.name,반:4}],caffeineData:[{...owner,섭취시간:time}],sleepData:[record],escapeHtml:x=>x};
 vm.runInNewContext(teacherOwnership+fn(teacher,'renderJourneyStatus')+';renderJourneyStatus();',teacherContext);
 assert.match(teacherDocument.getElementById('journeyStatusBody').innerHTML,/완료 1\/6/);
 const studentDocument=dom();
 const studentContext={document:studentDocument,BadgeJourney:B,SleepRecordPolicy,badgeConfig,user:{studentId:owner.학번},getTodayKST:()=> '2026-11-10',
  caffeineLogs:[{time}],sleepLogs:[record],teacherAwards:[]};
 const start=student.indexOf('function updateBadges()');const end=student.indexOf('// ── 뱃지 이미지 팝업',start);
 vm.runInNewContext(student.slice(start,end)+';updateBadges();',studentContext);
 assert.match(studentDocument.getElementById('journey-total-days').textContent,/1일/);
 assert.equal(SleepRecordPolicy.describe(record).targetDate,'');
});
test('failed settings save keeps the active config and local award state unchanged',()=>{
 const document=dom();let sent;let writes=0;const active=B.mergeConfig(null);
 const runner={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(){return this;},saveChallengeBadgeConfig(cfg,revision){sent={cfg,revision};this.success({success:false});}};
 const context={document,BadgeJourney:B,journeyConfigRevision:'read-revision',journeyConfigLoaded:true,journeySavePending:false,journeyConfig:active,journeyDraftConfig:B.prepareUpgrade(active),readJourneySchedules:()=>B.prepareUpgrade(active).schedules,challengeConfigSaved:true,challengeBadges:active.badges,S:{challengeName:'원래'},saveChallengeBadges(){writes++;},localStorage:{setItem(){writes++;}},rebuildAwardDropdown(){},renderChallengeBadgeList(){},renderJourneyStatus(){},showTeacherModal(){},google:{script:{run:runner}}};
 vm.runInNewContext(fn(teacher,'saveChallengeBadgeSettings')+';saveChallengeBadgeSettings();',context);
 assert.equal(sent.cfg.version,5);assert.equal(sent.revision,'read-revision');assert.equal(context.journeyConfig.version,4);assert.equal(context.S.challengeName,'원래');assert.equal(writes,0);
});
test('a pending save cannot be overtaken by a second save',()=>{
 const document=dom();let requests=0;
 const runner={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(){return this;},saveChallengeBadgeConfig(){requests++;}};
 const context={document,BadgeJourney:B,journeyConfigRevision:'read-revision',journeyConfigLoaded:true,journeySavePending:false,journeyConfig:B.mergeConfig(null),journeyDraftConfig:B.prepareUpgrade(null),readJourneySchedules:()=>B.prepareUpgrade(null).schedules,google:{script:{run:runner}}};
 vm.runInNewContext(fn(teacher,'saveChallengeBadgeSettings')+';saveChallengeBadgeSettings();saveChallengeBadgeSettings();',context);
 assert.equal(requests,1);assert.equal(context.journeySavePending,true);
});
test('settings cannot overwrite an unknown server configuration after load failure',()=>{
 const document=dom();let requests=0;
 const runner={withSuccessHandler(){return this;},withFailureHandler(){return this;},saveChallengeBadgeConfig(){requests++;}};
 const context={document,BadgeJourney:B,journeyConfigLoaded:false,journeySavePending:false,journeyConfig:B.mergeConfig(null),journeyDraftConfig:null,readJourneySchedules:()=>B.mergeConfig(null).schedules,google:{script:{run:runner}}};
 vm.runInNewContext(fn(teacher,'saveChallengeBadgeSettings')+';saveChallengeBadgeSettings();',context);
 assert.equal(requests,0);assert.match(document.getElementById('challengeSaveStatus').textContent,/불러/);
});
