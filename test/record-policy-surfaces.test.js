import {SleepRecordPolicy} from './support/sleep-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const teacher=fs.readFileSync('teacher/index.html','utf8');
const student=fs.readFileSync('index.html','utf8');
function extract(source,name,indent='') {const start=source.indexOf(`${indent}function ${name}(`);const end=source.indexOf(`\n${indent}function `,start+10);return source.slice(start,end);}
test('student and teacher use actual waking dates with no bedtime cutoff',()=>{
  const t=vm.createContext({SleepRecordPolicy,}),s=vm.createContext({SleepRecordPolicy,});
  vm.runInContext(['formatSleepTime','shiftDateString','getSleepLifeDate'].map(n=>extract(teacher,n)).join('\n'),t);
  for(const n of ['shiftDateString','getSleepLifeDate']){const start=student.indexOf(`    function ${n}(`);vm.runInContext(student.slice(start,student.indexOf('\n    }',start)+6),s);}
  for(const [time,want] of [['03:59','2026-10-13'],['04:00','2026-10-13'],['11:00','2026-10-13']]) {
    assert.equal(t.getSleepLifeDate({날짜:'2026-10-14',취침:time,기상날짜:'2026-10-14',기상:'15:00'}),want);
    assert.equal(s.getSleepLifeDate({date:'2026-10-14',start:time,wakeDate:'2026-10-14',end:'15:00'}),want);
  }
});
test('teacher sleep labels distinguish duration from condition and missing values',()=>{
  const c=vm.createContext({SleepRecordPolicy,S:{sleepSevere:7,sleepWarn:8,sleepGood:10,sleepMax:11}});
  vm.runInContext(extract(teacher,'getSleepStatusInfo'),c);
  for(const [hours,want] of [[7.5,'권장보다 짧음'],[8,'권장 범위'],[10,'권장 범위'],[10.5,'권장보다 김'],[null,'미기록']]) assert.match(c.getSleepStatusInfo(hours).text,new RegExp(want));
});
test('daily cohort caffeine mean excludes student days with unknown amounts',()=>{
  const c=vm.createContext({SleepRecordPolicy,});vm.runInContext(extract(teacher,'getDailyCaffeineSummary'),c);
  const result=c.getDailyCaffeineSummary([{학번:'A',섭취시간:'2026-10-14 12:00',함량:100},{학번:'B',섭취시간:'2026-10-14 12:00',함량:null}],2,'2026-10-14');
  assert.equal(result.recorded,1);assert.equal(result.average,100);
});
