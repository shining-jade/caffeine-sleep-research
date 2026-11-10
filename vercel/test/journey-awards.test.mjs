import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source = fs.readFileSync(new URL('../../gas/Code.js', import.meta.url), 'utf8');
const AWARDS = 'badge_journey_awards';
const historyHeader = ['studentId', 'name', 'stateJson', 'updatedAt'];
const teacherHeader = ['at', 'grade', 'class', 'number', 'studentId', 'studentName', 'awardId', 'name', 'image', 'bg', 'color', 'message', 'by', 'seenAt'];
const badges = [3, 7, 14, 21, 28].map(days => ({id:`journey_${days}`, name:`old ${days}`, image:'star', bg:'#fff', color:'#123', days, auto:true, customLabel:'keep me'}));
const schedule = {start:'2026-10-01',end:'2026-10-31',initialStart:'2026-10-01',initialEnd:'2026-10-07',actionStart:'2026-10-25',actionEnd:'2026-10-31',finalClassDate:'2026-11-01'};
const oldConfig = () => ({version:4,challengeName:'Old',schedules:Object.fromEntries(['1','2','3','4'].map(c=>[c,{...schedule}])),badges:structuredClone(badges)});
const nextConfig = () => ({version:5,dateBasis:'caffeine_day_next_wake',challengeName:'New',schedules:Object.fromEntries(['1','2','3','4'].map(c=>[c,{start:'2026-11-01',end:'2026-11-30',initialStart:'2026-11-01',initialEnd:'2026-11-07',actionStart:'2026-11-24',actionEnd:'2026-11-30',finalClassDate:'2026-12-01'}])),badges:[...structuredClone(badges.slice(0,3)),{id:'journey_finish_v5',name:'Finish',auto:true,ratio:0.8}]});
function fixture({days=0, people=[[2,1,1,'Synthetic A','2101']], history=[], config=oldConfig()}={}) {
  const sheets = new Map(), reads = {}, events = [], props = {SPREADSHEET_ID:'fake', BADGE_CONFIG_V3:JSON.stringify(config)};
  const fail = {read:null,write:null,partial:false,silent:false,property:false,flush:false};
  function add(name, rows) {
    const sheet = {rows:structuredClone(rows), getLastRow(){return this.rows.length;}, getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}, getName(){return name;},
      getDataRange(){return this.getRange(1,1,Math.max(1,this.rows.length),this.getLastColumn());},
      getRange(r,c,n=1,m=1){return {getValues(){reads[name]=(reads[name]||0)+1;if(fail.read===name) throw Error('read failed');return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sheet.rows[r+i-1]?.[c+j-1]??''));},setValues(rows){events.push(`write:${name}`);if(fail.write===name&&!fail.partial)throw Error('write failed');if(!fail.silent&&fail.silentName!==name)rows.forEach((row,i)=>{if(fail.write===name&&fail.partial&&i>0)return;sheet.rows[r+i-1]??=[];row.forEach((v,j)=>sheet.rows[r+i-1][c+j-1]=v);});if(fail.write===name)throw Error('partial write failed');},setValue(value){this.setValues([[value]]);},setNumberFormat(){},setBackground(){},setFontColor(){},setFontWeight(){}};},
      appendRow(row){this.getRange(this.rows.length+1,1,1,row.length).setValues([row]);},setFrozenRows(){},setColumnWidth(){}};
    sheets.set(name,sheet);return sheet;
  }
  add('students',[['grade','class','number','name','id'],...people]);
  const caf=[Array(15).fill('header')], sleep=[Array(19).fill('header')];
  for(const person of people)for(let d=1;d<=days;d++) {
    const day=`2026-10-${String(d).padStart(2,'0')}`;
    caf.push(['',2,1,1,person[4],person[3],'water',0,`${day} 12:00:00`,`caf-${person[4]}-${d}`]);
    sleep.push(['',2,1,1,person[4],person[3],day,'00:00',day,'08:00',8,3,'',`sleep-${person[4]}-${d}`]);
  }
  add('caffeine',caf);add('sleep',sleep);add('info',[['header']]);add('teacher_awards',[teacherHeader]);
  if(history.length)add('badge_celebrations',[historyHeader,...history.map(h=>[h.id||'2101',h.name||'Synthetic A',JSON.stringify({version:2,automaticIds:[],teacherKeys:[],...h.state}), '2026-10-10'])]);
  const ss={getSheetByName:name=>sheets.get(name)||null,insertSheet:name=>add(name,[])};
  sheets.get('info').getParent=()=>({getId:()=> 'fake'});
  const ctx=vm.createContext({console,Date,Map,Set,JSON,Math,Number,String,Array,Object,Error,RegExp,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty(k,v){events.push(`property:${k}`);if(fail.property)throw Error('property failed');if(!fail.propertySilent)props[k]=v;}})},
    SpreadsheetApp:{openById:()=>ss,flush(){if(fail.flush)throw Error('flush failed');}},
    Sheets:{Spreadsheets:{Values:{get:()=>({values:sheets.get('info').rows})}}},
    Logger:{log(){}},Utilities:{formatDate:d=>d.toISOString().slice(0,10),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_algorithm,value)=>Array.from(createHash('sha256').update(value).digest())},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}
  });
  vm.runInContext(source,ctx);
  ctx.getKSTDate=()=> '2026-11-12';
  return {ctx,sheets,props,fail,reads,events,add,ledger(){return (sheets.get(AWARDS)?.rows||[]).slice(1).map(r=>JSON.parse(r[3]));}};
}

function saveConfig(f, config) {
  const {revision}=f.ctx.getChallengeBadgeConfig();
  return f.ctx.dispatchTeacherAction_('saveChallengeBadgeConfig',[config,revision]);
}
test('authenticated reads and bootstrap never return the previous owner’s records for a reused ID',()=>{
  const f=fixture({days:3,people:[[2,1,1,'Synthetic A','2101']]});
  f.sheets.get('students').rows[1][3]='Synthetic B';
  const subject={studentId:'2101',name:'Synthetic B'};
  for(const action of ['getCaffeineLogs','getSleepLogs']) {
    assert.equal(f.ctx.dispatchStudentAction_(action,['2101'],subject).length,0,action);
    assert.equal(f.ctx.dispatchStudentAction_(action,['2101'],{...subject,name:'Synthetic A'}).length,3,action);
  }
  const bootstrap=f.ctx.dispatchStudentAction_('getStudentBootstrap',[],subject);
  assert.equal(bootstrap.caffeineLogs.length,0);
  assert.equal(bootstrap.sleepLogs.length,0);
});

test('unowned and mismatched manual awards remain in storage but are not returned for a reused ID',()=>{
  const f=fixture({people:[[2,1,1,'Synthetic B','2101']]});
  const subject={studentId:'2101',name:'Synthetic B'};
  const sheet=f.add('teacher_awards', [['at','studentId','awardId','name','image','bg','color','message','by'],
    ['2026-10-09','2101','journey_21','Unverified legacy award']]);
  const before=structuredClone(sheet.rows);
  assert.equal(f.ctx.dispatchStudentAction_('getTeacherAwardsForStudent',[],subject).awards.length,0);
  assert.deepEqual(sheet.rows,before);
  f.add('teacher_awards',[teacherHeader,
    ['2026-10-09',2,1,1,'2101','Synthetic A','journey_21','Other owner'],
    ['2026-10-10',2,1,1,'2101','','journey_28','Unverified owner'],
    ['2026-10-11',2,1,1,'2101','Synthetic B','other','Correct owner']]);
  assert.deepEqual(Array.from(f.ctx.dispatchStudentAction_('getTeacherAwardsForStudent',[],subject).awards,a=>a.awardId),['other']);
});

test('manual deletion matches the named owner and never falls back to another row',()=>{
  const f=fixture();
  const sheet=f.add('teacher_awards',[teacherHeader,
    ['2026-10-09 10:30',2,1,1,'2101','Synthetic A','shared','A award'],
    ['2026-10-09 10:30',2,1,1,'2101','Synthetic B','shared','B award']]);
  sheet.deleteRow=row=>sheet.rows.splice(row-1,1);
  const revoke=(...args)=>f.ctx.dispatchTeacherAction_('revokeTeacherAward',args);
  assert.equal(revoke('2101','2026-10-09 10:30','shared','Synthetic A').success,true);
  assert.deepEqual(sheet.rows.slice(1).map(row=>row[5]),['Synthetic B']);
  assert.equal(revoke('2101','2026-10-09 10:30','missing','Synthetic B').success,false);
  assert.equal(revoke('2101','2026-10-09 10:30','shared').success,false);
  assert.equal(sheet.rows.length,2);
});

test('manual grant retry requires the original owner and deduplicates per owner',()=>{
  const f=fixture({people:[[2,1,1,'Synthetic B','2101']]});
  const sheet=f.add('teacher_awards',[teacherHeader,
    ['2026-10-09',2,1,1,'2101','Synthetic A','shared','A award']]);
  const grant=(studentName)=>f.ctx.dispatchTeacherAction_('grantTeacherAwards',[{
    studentIds:['2101'],studentNames:studentName?{'2101':studentName}:undefined,
    awards:[{awardId:'shared',name:'B award'}],grantedAt:'2026-10-10',
  }]);
  assert.equal(grant('Synthetic A').success,false);
  assert.equal(grant().success,false);
  assert.equal(sheet.rows.length,2);
  assert.equal(grant('Synthetic B').count,1);
  assert.equal(grant('Synthetic B').count,0);
  assert.deepEqual(sheet.rows.slice(1).map(row=>row[5]),['Synthetic A','Synthetic B']);
});

test('marking a manual award as seen does not update a reused ID’s former owner',()=>{
  const f=fixture({people:[[2,1,1,'Synthetic B','2101']]});
  const sheet=f.add('teacher_awards',[teacherHeader,
    ['2026-10-09',2,1,1,'2101','Synthetic A','shared','A award'],
    ['2026-10-09',2,1,1,'2101','Synthetic B','shared','B award']]);
  const result=f.ctx.dispatchStudentAction_('markTeacherAwardsSeen',
    ['2101','Synthetic A',[{awardId:'shared',grantedAt:'2026-10-09'}]],{studentId:'2101',name:'Synthetic B'});
  assert.equal(result.updated,1);
  assert.equal(sheet.rows[1][13],undefined);
  assert.ok(sheet.rows[2][13]);
});

test('a conflicting sleep ID is marked in both authenticated records and teacher data',()=>{
  const f=fixture({days:1});
  const sleep=f.sheets.get('sleep');
  const row=sleep.rows[1];
  const other=[...row];
  other[5]='Synthetic B';
  sleep.rows.push(other);
  addSleepMeta(f,row,'main_candidate','candidate','basic_form');
  const subject={studentId:'2101',name:'Synthetic A'};
  assert.equal(f.ctx.dispatchStudentAction_('getSleepLogs',[],subject)[0].identityConflict,true);
  assert.ok(f.ctx.getTeacherData().sleep.every(record=>record.identityConflict===true));
});

test('exact duplicate sleep rows remain eligible for one badge day across views',()=>{
  const f=fixture({days:1});
  const row=f.sheets.get('sleep').rows[1];
  f.sheets.get('sleep').rows.push([...row]);
  addSleepMeta(f,row,'main_candidate','candidate','basic_form');
  const subject={studentId:'2101',name:'Synthetic A'};
  const records=f.ctx.dispatchStudentAction_('getSleepLogs',[],subject);
  const dates=f.ctx.BadgeJourney.sleepWakeDates(records,'caffeine_day_next_wake',f.ctx.SleepRecordPolicy);
  assert.deepEqual(Array.from(dates),['2026-10-01']);
});

test('legacy date separators and single-digit days preserve the same actual wake in both views',()=>{
  const f=fixture({days:1});
  const row=f.sheets.get('sleep').rows[1];
  row[6]='2026. 11. 6';
  row[7]='23:00';
  row[8]='2026. 11. 7';
  addSleepMeta(f,row,'main_candidate','candidate','basic_form');
  const subject={studentId:'2101',name:'Synthetic A'};
  const student=f.ctx.dispatchStudentAction_('getSleepLogs',[],subject);
  const teacher=f.ctx.getTeacherData().sleep;
  for(const records of [student,teacher]){
    const wakes=f.ctx.BadgeJourney.sleepWakeDates(records,'caffeine_day_next_wake',f.ctx.SleepRecordPolicy);
    assert.deepEqual(Array.from(wakes),['2026-11-07']);
  }
});

test('equal-revision sleep rows with different notes hold that morning in the server badge calculation',()=>{
  const f=fixture({config:nextConfig()});
  for(const [day,wake] of [['01','02'],['02','03'],['03','04']]){
    f.sheets.get('caffeine').rows.push(['',2,1,1,'2101','Synthetic A','water',0,`2026-11-${day} 12:00:00`,'c'+day]);
    const row=['',2,1,1,'2101','Synthetic A',`2026-11-${day}`,'23:00',`2026-11-${wake}`,'06:00',7,3,'','s'+day];
    f.sheets.get('sleep').rows.push(row);
    addSleepMeta(f,row,'main_candidate','candidate','basic_form');
    if(day==='03'){
      const conflicting=[...row];
      conflicting[12]='Different synthetic note';
      f.sheets.get('sleep').rows.push(conflicting);
    }
  }
  const result=f.ctx.claimBadgeCelebrations('2101','Synthetic A');
  assert.equal(result.success,true);
  assert.equal(result.items.length,0);
  assert.equal(f.ledger().length,0);
});

test('teacher saves reject both stale drafts and older clients without a revision',()=>{
  const f=fixture();
  const save=(config,revision)=>f.ctx.dispatchTeacherAction_('saveChallengeBadgeConfig',[config,revision]);
  const original=f.ctx.getChallengeBadgeConfig().revision;
  assert.equal(save(nextConfig(),original).success,true);
  const current=f.ctx.getChallengeBadgeConfig().revision;
  const edited={...nextConfig(),challengeName:'Another teacher'};
  assert.equal(save(edited,current).success,true);
  const writes=f.events.length;
  assert.equal(save(oldConfig(),original).error,'BADGE_CONFIG_CONFLICT');
  assert.equal(save(nextConfig(),current).error,'BADGE_CONFIG_CONFLICT');
  assert.equal(save(oldConfig()).error,'BADGE_CONFIG_CONFLICT');
  assert.equal(f.events.length,writes);
  assert.equal(JSON.parse(f.props.BADGE_CONFIG_V3).challengeName,'Another teacher');
});

function addSleepMeta(f,row,type,status,source) {
  const meta=f.sheets.get('_sleep_record_meta')||f.add('_sleep_record_meta',[
    ['record_id','owner_key','sleep_type','classification_status','classification_source','policy_version','revision','updated_at'],
  ]);
  meta.rows.push([row[13],f.ctx.preservedSleepOwnerKey_(row),type,status,source,'policy',1,'2026-11-10']);
}

test('class 2-3 reaches 29/36 with an owner-verified legacy sleep on the final morning',()=>{
  const f=fixture({people:[[2,3,1,'Synthetic A','2301']]});
  const config=f.ctx.BadgeJourney.prepareUpgrade(null);
  f.props.BADGE_CONFIG_V3=JSON.stringify(config);
  const caffeine=f.sheets.get('caffeine').rows, sleep=f.sheets.get('sleep').rows;
  const dates=f.ctx.BadgeJourney.dateRange('2026-10-06','2026-11-02');
  dates.push('2026-11-10');
  dates.forEach((day,i)=>{
    caffeine.push(['',2,3,1,'2301','Synthetic A','water',0,day+' 12:00:00','intake-'+i]);
    const row=['',2,3,1,'2301','Synthetic A',day,'23:00',f.ctx.BadgeJourney.shiftDate(day,1),'07:00',8,3,'','sleep-'+i];
    sleep.push(row);
    if(i<28) addSleepMeta(f,row,'main_candidate','candidate','basic_form');
    else sleep.push([...row]);
  });
  const before=structuredClone(sleep);
  const subject={studentId:'2301',name:'Synthetic A'};
  const claim=()=>f.ctx.dispatchStudentAction_('claimBadgeCelebrations',[],subject);
  f.ctx.getKSTDate=()=> '2026-11-10';
  assert.equal(claim().items.some(a=>a.awardId==='journey_finish_v5'),false);
  f.ctx.getKSTDate=()=> '2026-11-11';
  const final=claim();
  assert.equal(final.success,true);
  assert.deepEqual(Array.from(final.items,a=>a.awardId),['journey_finish_v5']);
  const award=f.ledger().find(a=>a.awardId==='journey_finish_v5');
  assert.deepEqual([award.current,award.days,award.totalDays],[29,29,36]);
  assert.equal(claim().items.length,0);
  const legacy=f.ctx.dispatchStudentAction_('getSleepLogs',[],subject).find(row=>row.id==='sleep-28');
  const described=f.ctx.SleepRecordPolicy.describe(legacy);
  assert.equal(described.type,'uncollected');
  assert.equal(described.targetDate,'');
  assert.equal(legacy.analysisTargetDate,'');
  assert.equal(f.sheets.get('_sleep_record_meta').rows.length,29);
  assert.deepEqual(sleep,before);
});

for (const [label,change] of [
  ['previous owner',row=>{row[5]='Former synthetic owner';}],
  ['missing owner',row=>{row[5]='';}],
  ['missing wake date',row=>{row[8]='';}],
  ['missing wake time',row=>{row[9]='';}],
  ['same-ID owner conflict',(row,rows)=>{const other=[...row];other[5]='Former synthetic owner';rows.push(other);}],
  ['two episodes for one morning',(row,rows)=>{const other=[...row];other[13]='second';other[9]='08:00';rows.push(other);}],
  ['explicit nap',(row,rows,f)=>addSleepMeta(f,row,'nap','student_selected','nap_form')],
  ['explicit unclassified episode',(row,rows,f)=>addSleepMeta(f,row,'unclassified','student_selected','additional_record')],
  ['unrecognized type from a newer form',(row,rows,f)=>addSleepMeta(f,row,'unknown_type','uncollected','client_unspecified')],
]) test(`v5 withholds the milestone for an ineligible final pair: ${label}`,()=>{
  const f=fixture({config:nextConfig()});
  const caffeine=f.sheets.get('caffeine').rows, sleep=f.sheets.get('sleep').rows;
  for(const [day,wake] of [['01','02'],['02','03'],['03','04']]){
    caffeine.push(['',2,1,1,'2101','Synthetic A','water',0,`2026-11-${day} 12:00:00`,'intake-'+day]);
    const row=['',2,1,1,'2101','Synthetic A',`2026-11-${day}`,'23:00',`2026-11-${wake}`,'07:00',8,3,'','sleep-'+day];
    sleep.push(row);
    if(day==='03') change(row,sleep,f);
    else addSleepMeta(f,row,'main_candidate','candidate','basic_form');
  }
  const result=f.ctx.claimBadgeCelebrations('2101','Synthetic A');
  assert.equal(result.success,true);
  assert.equal(result.items.length,0);
  assert.equal(f.ledger().length,0);
});

test('v5 server pairs Seoul intake dates with valid morning records across UTC midnight',()=>{
  const f=fixture({config:nextConfig()});
  for(let d=5;d<=7;d++){
    const utc=`2026-11-0${d}`, day=`2026-11-0${d+1}`, wake=`2026-11-0${d+2}`;
    f.sheets.get('caffeine').rows.push(['',2,1,1,'2101','Synthetic A','water',0,utc+'T16:00:00Z','c'+d]);
    const row=['',2,1,1,'2101','Synthetic A',day,'23:00',wake,'08:00',9,3,'','s'+d];
    f.sheets.get('sleep').rows.push(row);
    addSleepMeta(f,row,'main_candidate','candidate','basic_form');
  }
  assert.deepEqual(Array.from(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items,a=>a.awardId),['journey_3']);
});

test('v5 server does not issue a milestone for naps, unclassified sleep or ambiguous mornings',()=>{
  const f=fixture({config:nextConfig(),days:0});
  for(let d=1;d<=3;d++){
    const day=`2026-11-0${d}`, wake=`2026-11-0${d+1}`;
    f.sheets.get('caffeine').rows.push(['',2,1,1,'2101','Synthetic A','water',0,day+' 12:00:00','c'+d]);
    const row=['',2,1,1,'2101','Synthetic A',day,'23:00',wake,'06:00',7,3,'','s'+d];
    f.sheets.get('sleep').rows.push(row);
    addSleepMeta(f,row,['nap','unclassified','main_candidate'][d-1],d===3?'candidate':'student_selected',d===3?'basic_form':'additional_record');
    if(d===3){
      const competing=[...row];competing[13]='competing';competing[9]='08:00';
      f.sheets.get('sleep').rows.push(competing);
      addSleepMeta(f,competing,'main','student_confirmed','additional_record');
    }
  }
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items.length,0);
  assert.equal(f.ledger().length,0);
});

test('retry delivers a new celebration once when the first history write failed before commit',()=>{
  const f=fixture({days:3});
  f.fail.write='badge_celebrations';
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').success,false);
  assert.equal(f.ledger().length,1);
  const award=structuredClone(f.ledger()[0]);
  f.fail.write=null;
  assert.deepEqual(Array.from(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items,a=>a.awardId),['journey_3']);
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items.length,0);
  assert.deepEqual(f.ledger(),[award]);
});

test('config save preserves full old 3/7/14/21/28 identity and metadata before replacement',()=>{
  const f=fixture({days:28});const before=structuredClone(f.sheets.get('sleep').rows);
  assert.equal(saveConfig(f,nextConfig()).success,true);
  assert.deepEqual(f.ledger().map(a=>a.awardId),badges.map(b=>b.id));
  assert.equal(f.ledger().at(-1).name,'old 28');assert.equal(f.ledger().at(-1).badge.customLabel,'keep me');
  assert.equal(f.ledger().at(-1).criteria.version,4);
  assert.ok(f.events.indexOf(`write:${AWARDS}`)<f.events.indexOf('property:BADGE_CONFIG_V3'));
  assert.deepEqual(f.sheets.get('sleep').rows,before);
  assert.equal(f.ctx.getTeacherAwardsForStudent('2101','Synthetic A').awards.length,5);
  const teacher=f.ctx.getTeacherData();assert.equal(teacher.success,true,teacher.error);assert.equal(teacher.manualAwards['2101'].length,5);
});
test('snapshot uses bulk reads rather than reads per student',()=>{
  const people=Array.from({length:130},(_,i)=>[2,1,i+1,`Synthetic ${i}`,String(2100+i)]);
  const f=fixture({days:3,people});assert.equal(saveConfig(f,nextConfig()).success,true);
  assert.equal(f.ledger().length,130);for(const name of ['students','caffeine','sleep'])assert.equal(f.reads[name],1);
});
test('reliable v2 notification IDs survive even when source records no longer qualify',()=>{
  const f=fixture({history:[{state:{version:2,automaticIds:['journey_21','journey_28']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.deepEqual(f.ledger().map(a=>a.awardId),['journey_21','journey_28']);
  assert.equal(f.ledger()[0].confirmationSource,'notification_v2');
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items.length,0);
});
test('ambiguous v1 history is not an award but currently earned legacy awards are preserved',()=>{
  const f=fixture({days:3,history:[{state:{version:1,automaticIds:['journey_3','journey_28']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.deepEqual(f.ledger().map(a=>a.awardId),['journey_3']);
  const result=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(result.legacyHistoryUncertain,true);assert.equal(result.items.length,0);
});
test('v2 migrated ambiguous history is not retroactively confirmed',()=>{
  const f=fixture({history:[{state:{version:2,legacyHistoryUncertain:true,automaticIds:['journey_28']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,0);
});
test('claim persists newly earned awards and subsequent claims or changed records do not replay',()=>{
  const f=fixture({days:7});const first=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(first.success,true);assert.equal(first.items.length,2);assert.equal(f.ledger().length,2);
  f.sheets.get('caffeine').rows.splice(1);assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items.length,0);
  const awards=f.ctx.getTeacherAwardsForStudent('2101','Synthetic A').awards;assert.equal(awards.length,2);assert.ok(awards.every(a=>a.kind==='automatic'&&a.preserved&&a.seenAt));
});
test('durable identity binds name and normalized student ID, including authenticated dispatch',()=>{
  const f=fixture({days:3});assert.equal(f.ctx.claimBadgeCelebrations('2101.0','Synthetic A').success,true);
  assert.equal(f.ctx.getTeacherAwardsForStudent('2101','Different person').awards.length,0);
  const response=f.ctx.dispatchStudentAction_('getTeacherAwardsForStudent',['2101','Synthetic A'],{studentId:'2101',name:'Different person'});
  assert.equal(response.awards.length,0);
});
for(const sheet of ['students','caffeine','sleep','badge_celebrations'])test(`config is unchanged on ${sheet} read failure`,()=>{
  const f=fixture({days:3,history:[{state:{}}]});const old=f.props.BADGE_CONFIG_V3;f.fail.read=sheet;
  assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);
});
test('ledger write failure prevents config change; partial retry preserves once',()=>{
  const f=fixture({days:28});f.fail.write=AWARDS;f.fail.partial=true;const old=f.props.BADGE_CONFIG_V3;
  assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);
  f.fail.write=null;assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,5);
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,5);
});
test('readback verification detects silently dropped ledger writes',()=>{
  const f=fixture({days:3});f.fail.silent=true;const old=f.props.BADGE_CONFIG_V3;
  assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);
});
test('claim fails closed if durable storage fails without consuming notification IDs',()=>{
  const f=fixture({days:3});f.fail.write=AWARDS;assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').success,false);
  assert.equal(f.sheets.get('badge_celebrations')?.rows.length||0,0);
});
test('private award maps cannot be persisted or returned inside public config',()=>{
  const f=fixture();const config=nextConfig();config.preservedAwards={'2101':['private']};config.manualAwards={'2101':['private']};
  assert.equal(saveConfig(f,config).success,true);const result=f.ctx.getChallengeBadgeConfig().config;
  assert.equal(result.preservedAwards,undefined);assert.equal(result.manualAwards,undefined);
});

test('partial award-batch write recovers without changing the original award metadata',()=>{
  const f=fixture({days:28});f.add(AWARDS,['studentId,name,awardId,awardJson,preservedAt'.split(',')]);
  f.fail.write=AWARDS;f.fail.partial=true;const old=f.props.BADGE_CONFIG_V3;
  assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);assert.equal(f.ledger().length,1);
  const first=structuredClone(f.ledger()[0]);f.fail.write=null;
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,5);assert.deepEqual(f.ledger()[0],first);
});
test('config-property failure can retry without duplicating durable awards',()=>{
  const f=fixture({days:7});f.fail.property=true;const old=f.props.BADGE_CONFIG_V3;
  assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);assert.equal(f.ledger().length,2);
  f.fail.property=false;assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,2);
});
test('unknown reliable IDs remain exact and explicitly metadata-unavailable',()=>{
  const f=fixture({history:[{state:{automaticIds:['retired_legacy_award']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger()[0].awardId,'retired_legacy_award');assert.equal(f.ledger()[0].metadataUnavailable,true);
});
test('legacy v1 IDs never become proof even if it has a confirmed-ID field',()=>{
  const f=fixture({history:[{state:{version:1,automaticIds:['journey_28'],confirmedAutomaticIds:['journey_28']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,0);
});
test('a teacher copy of a preserved milestone does not replay when records no longer qualify',()=>{
  const f=fixture({history:[{state:{automaticIds:['journey_21']}}]});
  assert.equal(saveConfig(f,nextConfig()).success,true);
  f.sheets.get('teacher_awards').rows.push(['2026-10-22',2,1,1,'2101','Synthetic A','journey_21','old 21','star','#fff','#123','well done','teacher','']);
  const result=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(result.success,true);assert.equal(result.items.length,0);
});
test('old owner records cannot earn an award for a reused student ID',()=>{
  const f=fixture({days:3});f.sheets.get('students').rows[1][3]='Synthetic B';
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic B').items.length,0);
  assert.equal(f.ctx.getTeacherAwardsForStudent('2101','Synthetic B').awards.length,0);
});
test('an old ID-only v2 history cannot prove a reused owner earned a badge',()=>{
  const f=fixture({days:3,history:[{name:'Synthetic B',state:{automaticIds:['journey_21']}}]});
  f.sheets.get('students').rows[1][3]='Synthetic B';
  assert.equal(saveConfig(f,nextConfig()).success,true);
  assert.deepEqual(f.ledger().map(award=>[award.studentName,award.awardId]),[['Synthetic A','journey_3']]);
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic B').items.length,0);
  assert.equal(f.ctx.getTeacherAwardsForStudent('2101','Synthetic B').awards.length,0);
});
test('nested private maps are not returned as public badge or schedule metadata',()=>{
  const f=fixture();const config=nextConfig();config.badges[0].studentAwards={private:'data'};config.schedules['1'].preservedAwards={private:'data'};
  assert.equal(saveConfig(f,config).success,true);const result=f.ctx.getChallengeBadgeConfig().config;
  assert.equal(result.badges[0].studentAwards,undefined);assert.equal(result.schedules['1'].preservedAwards,undefined);
});
test('corrupt or duplicate durable entries and ledger read failures block config replacement',()=>{
  for(const corrupt of [false,true]) {
    const f=fixture({days:3});assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').success,true);const old=f.props.BADGE_CONFIG_V3;
    if(corrupt)f.sheets.get(AWARDS).rows.push([...f.sheets.get(AWARDS).rows[1]]);else f.fail.read=AWARDS;
    assert.equal(saveConfig(f,nextConfig()).success,false);assert.equal(f.props.BADGE_CONFIG_V3,old);
  }
});

test('a badge ledger failure does not block the v50 teacher records and report input',()=>{
  const f=fixture({days:3});
  f.sheets.get('teacher_awards').rows.push(['2026-10-20',2,1,1,'2101','Synthetic A','classwork','Teacher badge']);
  f.add(AWARDS,[['bad ledger header']]);
  const dashboard=f.ctx.dispatchTeacherAction_('getTeacherData',[]);
  assert.equal(dashboard.success,true);
  assert.equal(dashboard.preservedAutomaticAwardsAvailable,false);
  assert.equal(dashboard.caffeine.length,3);
  assert.equal(dashboard.sleep.length,3);
  assert.deepEqual(Array.from(dashboard.manualAwards['2101'],award=>award.awardId),['classwork']);
  assert.equal(saveConfig(f,nextConfig()).error,'BADGE_PRESERVATION_UNAVAILABLE');
});

test('v5 server claims pair caffeine D with actual wake D+1, including the final morning',()=>{
  const config=oldConfig();config.version=5;config.dateBasis='caffeine_day_next_wake';config.schedules['1'].end='2026-10-03';
  const f=fixture({days:3,config});
  f.sheets.get('sleep').rows.slice(1).forEach((row,i)=>{row[6]=`2026-10-${String(i+1).padStart(2,'0')}`;row[7]='23:00';row[8]=`2026-10-${String(i+2).padStart(2,'0')}`;addSleepMeta(f,row,'main_candidate','candidate','basic_form');});
  const result=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(result.success,true);assert.equal(result.items.length,1);assert.equal(result.items[0].awardId,'journey_3');
  assert.equal(f.ledger()[0].criteria.dateBasis,'caffeine_day_next_wake');
});
test('legacy v4 snapshots keep same-day pairing rather than adopting v5 implicitly',()=>{
  const config=oldConfig();config.schedules['1'].end='2026-10-03';const f=fixture({days:3,config});
  f.sheets.get('sleep').rows.slice(1).forEach((row,i)=>{row[8]=`2026-10-${String(i+2).padStart(2,'0')}`;});
  assert.equal(saveConfig(f,nextConfig()).success,true);assert.equal(f.ledger().length,0);
});
test('v5 ratio award uses the class opportunity and remains durable after another edit',()=>{
  const config=nextConfig();config.badges=[config.badges.at(-1)];Object.assign(config.schedules['1'],{start:'2026-10-01',end:'2026-10-05'});
  const f=fixture({days:4,config});f.sheets.get('sleep').rows.slice(1).forEach((row,i)=>{row[7]='23:00';row[8]=`2026-10-${String(i+2).padStart(2,'0')}`;addSleepMeta(f,row,'main_candidate','candidate','basic_form');});
  assert.equal(saveConfig(f,oldConfig()).success,true);
  assert.equal(f.ledger().length,1);assert.equal(f.ledger()[0].awardId,'journey_finish_v5');assert.equal(f.ledger()[0].days,4);assert.equal(f.ledger()[0].criteria.version,5);
});
test('notification state is read back before any celebration is authorized',()=>{
  const f=fixture({days:3});f.add('badge_celebrations',[historyHeader]);f.fail.silentName='badge_celebrations';
  const first=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(first.success,false);assert.equal(f.ledger().length,1);
  f.fail.silentName=null;const second=f.ctx.claimBadgeCelebrations('2101','Synthetic A');assert.equal(second.success,true);assert.equal(second.items.length,1);
  assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').items.length,0);
});

const invalidV5 = [
  ['missing date basis',c=>delete c.dateBasis],
  ['wrong date basis',c=>{c.dateBasis='same_day';}],
  ['missing class schedule',c=>delete c.schedules['4']],
  ['impossible calendar date',c=>{c.schedules['1'].start='2026-02-30';}],
  ['reversed dates',c=>{c.schedules['2'].start='2026-12-01';}],
  ['initial outside range',c=>{c.schedules['3'].initialStart='2026-10-31';}],
  ['initial reversed range',c=>{c.schedules['3'].initialEnd='2026-10-31';}],
  ['action outside range',c=>{c.schedules['4'].actionEnd='2026-12-01';}],
  ['action reversed range',c=>{c.schedules['4'].actionStart='2026-12-01';}],
  ['wrong final morning',c=>{c.schedules['1'].finalClassDate='2026-12-02';}],
  ['missing known badge',c=>c.badges.splice(0,1)],
  ['duplicate badge ID',c=>c.badges.push({...c.badges[0]})],
  ['changed milestone',c=>{c.badges[0].days=4;}],
  ['disabled milestone',c=>{c.badges[1].auto=false;}],
  ['ratio replacing fixed days',c=>{c.badges[2].ratio=0.8;}],
  ['incorrect finish ratio',c=>{c.badges[3].ratio=0.7;}],
  ['extra retired auto badge',c=>c.badges.push({...badges[4]})],
  ['unsupported future version',c=>{c.version=6;}],
];
for(const [name,change] of invalidV5)test(`invalid v5 ${name} is rejected before ledger writes`,()=>{
  const f=fixture({days:28}),config=nextConfig(),old=f.props.BADGE_CONFIG_V3;change(config);
  const result=saveConfig(f,config);assert.equal(result.success,false);assert.equal(result.error,'INVALID_BADGE_CONFIG');
  assert.equal(f.props.BADGE_CONFIG_V3,old);assert.equal(f.events.length,0);assert.equal(f.ledger().length,0);
});
test('valid v5 edited dates return the exact verified public config',()=>{
  const f=fixture({days:7}),config=nextConfig();config.schedules['1'].start='2026-10-12';
  const result=saveConfig(f,config);assert.equal(result.success,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.config)),JSON.parse(f.props.BADGE_CONFIG_V3));assert.equal(result.config.schedules['1'].start,'2026-10-12');
});
test('silently dropped config writes never report activation success',()=>{
  const f=fixture({days:3}),old=f.props.BADGE_CONFIG_V3;f.fail.propertySilent=true;
  const result=saveConfig(f,nextConfig());assert.equal(result.success,false);assert.equal(result.error,'BADGE_CONFIG_NOT_VERIFIED');assert.equal(f.props.BADGE_CONFIG_V3,old);assert.equal(f.ledger().length,1);
  f.fail.propertySilent=false;const retried=saveConfig(f,nextConfig());assert.equal(retried.success,true);assert.equal(retried.config.version,5);assert.equal(f.ledger().length,1);
});
test('legacy v4 configuration saves remain compatible and return verified settings',()=>{
  const f=fixture(),config={version:4,challengeName:'Legacy',schedules:{'1':{start:'2026-10-01',end:'2026-10-31'}},badges:[{id:'legacy_custom',days:21,auto:true}]};
  const result=saveConfig(f,config);assert.equal(result.success,true);assert.deepEqual(JSON.parse(JSON.stringify(result.config)),{...config,configSaved:true});
});

test('teacher current-roster map never reassigns a retired owner award to a reused ID',()=>{
  const f=fixture({days:3});assert.equal(f.ctx.claimBadgeCelebrations('2101','Synthetic A').success,true);
  f.sheets.get('students').rows[1][3]='Synthetic B';
  const teacher=f.ctx.getTeacherData();assert.equal(teacher.success,true,teacher.error);
  assert.equal((teacher.manualAwards['2101']||[]).length,0);
  assert.equal(teacher.preservedAutomaticAwards.length,1);assert.equal(teacher.preservedAutomaticAwards[0].studentName,'Synthetic A');
});
test('configSaved stays boolean in public config and is authoritative after save',()=>{
  const config=oldConfig();config.configSaved=false;const f=fixture({config});
  assert.equal(f.ctx.getChallengeBadgeConfig().config.configSaved,false);
  const next=nextConfig();next.configSaved=false;const result=saveConfig(f,next);
  assert.equal(result.success,true);assert.equal(result.config.configSaved,true);
  assert.equal(f.ctx.getChallengeBadgeConfig().config.configSaved,true);
});

test('teacher bare-ID award map excludes ambiguous simultaneously enrolled identities',()=>{
  const f=fixture({days:3,people:[[2,1,1,'Synthetic A','2101'],[2,1,1,'Synthetic B','2101']]});
  assert.equal(saveConfig(f,nextConfig()).success,true);
  const teacher=f.ctx.getTeacherData();assert.equal(teacher.success,true,teacher.error);
  assert.equal((teacher.manualAwards['2101']||[]).length,0);assert.equal(teacher.preservedAutomaticAwards.length,2);
  assert.equal(f.ctx.getTeacherAwardsForStudent('2101','Synthetic B').awards.length,1);
});
test('the approved default v5 upgrade passes server validation unchanged',()=>{
  const f=fixture({config:{}}),config=f.ctx.BadgeJourney.prepareUpgrade({});
  const result=saveConfig(f,config);assert.equal(result.success,true);
  assert.equal(result.config.schedules['1'].start,'2026-10-12');assert.equal(result.config.schedules['4'].finalClassDate,'2026-11-10');
});
