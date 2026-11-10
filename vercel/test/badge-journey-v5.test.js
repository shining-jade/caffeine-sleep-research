import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/badge-journey.js';
const B = globalThis.BadgeJourney;
const basis = 'caffeine_day_next_wake';
const schedule = {start:'2026-11-04',end:'2026-11-09',initialStart:'2026-11-04',initialEnd:'2026-11-09',actionStart:'2026-11-04',actionEnd:'2026-11-09'};

test('v4 remains unchanged until an explicit upgrade', () => {
  const v4 = B.mergeConfig(null);
  assert.equal(v4.version, 4);
  assert.equal(v4.schedules['1'].start, '2026-10-19');
  assert.deepEqual(v4.badges.map(x=>x.days), [3,7,14,21,28]);
  assert.equal(B.summarize({schedule,caffeineDates:['2026-11-04'],sleepDates:['2026-11-04']}).totalComplete,1);
  assert.equal(B.summarize({schedule,today:'2026-11-04',caffeineDates:['2026-11-09'],sleepDates:['2026-11-09']}).totalComplete,1);
});
test('upgrade uses consent days, preserves initial observation, and sets exact final mornings', () => {
  const old=B.mergeConfig(null); old.schedules['2']={...old.schedules['2'],initialStart:'2026-10-24',initialEnd:'2026-10-30'};
  const next=B.prepareUpgrade(old);
  assert.equal(old.version,4);
  assert.equal(next.version,5); assert.equal(next.dateBasis,basis);
  assert.deepEqual(Object.values(next.schedules).map(x=>x.start),['2026-10-12','2026-10-16','2026-10-06','2026-10-06']);
  assert.deepEqual(Object.values(next.schedules).map(x=>x.end),['2026-11-11','2026-11-11','2026-11-10','2026-11-09']);
  assert.deepEqual(Object.values(next.schedules).map(x=>x.finalClassDate),['2026-11-12','2026-11-12','2026-11-11','2026-11-10']);
  assert.equal(next.schedules['2'].initialStart,'2026-10-24');
  assert.deepEqual(next.badges.map(x=>x.id),['journey_3','journey_7','journey_14','journey_finish_v5']);
  assert.deepEqual(Object.values(next.schedules).map(s=>B.milestoneProgress([],next.badges,s).at(-1).days),[25,22,29,28]);
});
test('pairs intake D with actual wake D+1, including final class morning, once per day', () => {
  const x=B.summarize({dateBasis:basis,schedule,today:'2026-11-10',caffeineDates:['2026-11-04','2026-11-09','2026-11-09','2026-11-10'],sleepDates:['2026-11-04','2026-11-05','2026-11-10','2026-11-10','2026-11-11']});
  assert.deepEqual(x.completeDates,['2026-11-04','2026-11-09']);
  assert.equal(x.action.totalDays,6); assert.equal(x.action.complete,2);
  assert.deepEqual(x.today,{caffeine:true,sleep:true,complete:true});
});
for (const [classNo,lastIntake,finalMorning,threshold,total,actionDays] of [
  ['1','2026-11-11','2026-11-12',25,31,6],
  ['2','2026-11-11','2026-11-12',22,27,6],
  ['3','2026-11-10','2026-11-11',29,36,7],
  ['4','2026-11-09','2026-11-10',28,35,6],
]) test(`class 2-${classNo} includes its final morning without adding a caffeine day`,()=>{
  const config=B.prepareUpgrade(null), schedule=config.schedules[classNo];
  const input={schedule,dateBasis:basis,caffeineDates:[lastIntake,lastIntake],sleepDates:[finalMorning,finalMorning]};
  assert.equal(B.summarize({...input,today:lastIntake}).totalComplete,0);
  const final=B.summarize({...input,today:finalMorning});
  assert.deepEqual(final.completeDates,[lastIntake]);
  assert.equal(final.action.totalDays,actionDays);
  const badge=B.milestoneProgress(final.completeDates,config.badges,schedule).at(-1);
  assert.equal(badge.days,threshold);
  assert.equal(badge.totalDays,total);
});
test('same-day sleep and future wake cannot complete a paired target day', () => {
  assert.equal(B.summarize({dateBasis:basis,schedule,today:'2026-11-04',caffeineDates:['2026-11-04'],sleepDates:['2026-11-04','2026-11-05']}).totalComplete,0);
  assert.equal(B.summarize({dateBasis:basis,schedule,today:'2026-11-05',caffeineDates:['2026-11-05'],sleepDates:['2026-11-05']}).totalComplete,0);
});
test('80% uses actual inclusive denominator, rounds up and never earns invalid goals', () => {
  const badge=[{id:'finish',ratio:0.8}];
  assert.equal(B.milestoneProgress(B.dateRange(schedule.start,schedule.end),badge,schedule)[0].days,5);
  assert.equal(B.milestoneProgress(['2026-11-04'],badge,{start:'bad',end:'bad'})[0].earned,false);
  assert.equal(B.milestoneProgress([], [{id:'bad',days:0}],schedule)[0].earned,false);
  assert.deepEqual(B.dateRange('2026-02-30','2026-03-03'),[]);
});
test('weekly paired progress respects target dates, schedule and actual morning cutoff', () => {
  const x=B.weekProgress({dateBasis:basis,schedule,today:'2026-11-10',caffeineDates:['2026-11-09','2026-11-10','2026-11-11'],sleepDates:['2026-11-10','2026-11-11','2026-11-12']});
  assert.equal(x.complete,1); assert.equal(x.states[0],'complete');
  assert.equal(x.totalDays,1);
  assert.equal(x.states[1],'empty');
});
