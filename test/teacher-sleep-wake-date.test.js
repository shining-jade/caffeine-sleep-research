import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('teacher/index.html','utf8');
const helpers=source.slice(source.indexOf('function shiftDateString('),source.indexOf('function getSleepLifeDate('));
const ctx=vm.createContext({sleepData:[
 {'학번':'2410','날짜':'2026-10-05','취침':'23:00','기상':'12:14','기상날짜':'2026-10-06'},
 {'학번':'2411','날짜':'2026-10-05','취침':'23:00','기상':'12:12','기상날짜':'2026. 10. 6'},
 {'학번':'2409','날짜':'2026-10-06','취침':'01:00','기상':'07:30','기상날짜':'2026-10-06'}
],formatSleepTime:x=>x||''});
vm.runInContext(helpers,ctx);
test('overnight and dawn records all count on wake day, isolated by student',()=>{
 for(const id of ['2410','2411','2409'])assert.equal(ctx.hasSleepRecordOnWakeDate(id,'2026-10-06'),true);
 assert.equal(ctx.hasSleepRecordOnWakeDate('9999','2026-10-06'),false);
 assert.equal(ctx.hasSleepRecordOnWakeDate('2410','2026-10-05'),false);
});
test('legacy record infers next-day wake across year boundary',()=>{
 assert.equal(ctx.getSleepWakeDate({'날짜':'2026-12-31','취침':'23:00','기상':'07:00'}),'2027-01-01');
 assert.equal(ctx.getSleepWakeDate({'날짜':'2026-10-06','취침':'01:00','기상':'07:30'}),'2026-10-06');
});
