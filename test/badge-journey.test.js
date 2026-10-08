import assert from 'node:assert/strict';
import test from 'node:test';

await import('../public/js/badge-journey.js');

const journey = globalThis.BadgeJourney;

test('complete record days require both caffeine and sleep on the same date', () => {
  const summary = journey.summarize({
    caffeineDates: ['2026-10-13', '2026-10-14', '2026-10-14', '2026-10-16'],
    sleepDates: ['2026-10-13', '2026-10-15', '2026-10-16'],
    schedule: { start: '2026-10-13', end: '2026-10-19' },
    today: '2026-10-16',
  });

  assert.deepEqual(summary.completeDates, ['2026-10-13', '2026-10-16']);
  assert.equal(summary.totalComplete, 2);
  assert.equal(summary.today.caffeine, true);
  assert.equal(summary.today.sleep, true);
  assert.equal(summary.today.complete, true);
});

test('class schedules cover 35 logging days and equal seven-day analysis windows', () => {
  const expected = {
    '1': ['2026-10-19', '2026-11-22', '2026-10-25', '2026-11-16', '2026-11-22'],
    '2': ['2026-10-23', '2026-11-26', '2026-10-29', '2026-11-20', '2026-11-26'],
    '3': ['2026-10-13', '2026-11-16', '2026-10-19', '2026-11-10', '2026-11-16'],
    '4': ['2026-10-13', '2026-11-16', '2026-10-19', '2026-11-10', '2026-11-16'],
  };

  for (const [classNo, values] of Object.entries(expected)) {
    const schedule = journey.DEFAULT_CONFIG.schedules[classNo];
    assert.deepEqual(
      [schedule.start, schedule.end, schedule.initialEnd, schedule.actionStart, schedule.actionEnd],
      values,
    );
    assert.equal(journey.dateRange(schedule.start, schedule.end).length, 35);
    assert.equal(journey.dateRange(schedule.initialStart, schedule.initialEnd).length, 7);
    assert.equal(journey.dateRange(schedule.actionStart, schedule.actionEnd).length, 7);
  }
});

test('student class is derived only from a four-digit school student number', () => {
  assert.equal(journey.classFromStudentId('2101'), '1');
  assert.equal(journey.classFromStudentId('2417'), '4');
  assert.equal(journey.classFromStudentId('0'), '');
  assert.equal(journey.classFromStudentId('교사_테스트'), '');
});

test('milestones reward cumulative complete days without resetting for gaps', () => {
  const completeDates = Array.from({ length: 15 }, (_, index) => {
    const date = new Date('2026-10-13T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + index * 2);
    return date.toISOString().slice(0, 10);
  });
  const progress = journey.milestoneProgress(completeDates, journey.DEFAULT_CONFIG.badges);

  assert.deepEqual(progress.filter((item) => item.earned).map((item) => item.days), [3, 7, 14]);
  assert.equal(progress.find((item) => item.days === 21).current, 15);
  assert.equal(progress.find((item) => item.days === 21).remaining, 6);
});

test('student stage labels avoid research-analysis terminology', () => {
  const schedule = journey.DEFAULT_CONFIG.schedules['3'];
  assert.equal(journey.studentStage(schedule, '2026-10-13').label, '기록 시작하기');
  assert.equal(journey.studentStage(schedule, '2026-10-25').label, '나의 생활 살펴보기');
  assert.equal(journey.studentStage(schedule, '2026-11-12').label, '건강행동 실천하기');
  assert.equal(journey.studentStage(schedule, '2026-11-17').label, '변화를 돌아보기');
});

test('teacher summary keeps partial and complete counts separate for each window', () => {
  const schedule = journey.DEFAULT_CONFIG.schedules['3'];
  const summary = journey.summarize({
    caffeineDates: ['2026-10-13', '2026-10-14', '2026-11-10', '2026-11-11'],
    sleepDates: ['2026-10-13', '2026-10-15', '2026-11-10'],
    schedule,
    today: '2026-11-11',
  });

  assert.deepEqual(summary.initial, { caffeine: 2, sleep: 2, complete: 1, totalDays: 7 });
  assert.deepEqual(summary.action, { caffeine: 2, sleep: 1, complete: 1, totalDays: 7 });
  assert.equal(summary.totalComplete, 2);
});

test('weekly progress uses Monday through Sunday and preserves partial days', () => {
  const progress = journey.weekProgress({
    caffeineDates: ['2026-10-12', '2026-10-13', '2026-10-15'],
    sleepDates: ['2026-10-12', '2026-10-14', '2026-10-15'],
    today: '2026-10-15',
  });

  assert.deepEqual(progress.dates, [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
    '2026-10-16', '2026-10-17', '2026-10-18',
  ]);
  assert.deepEqual(progress.states, ['complete', 'partial', 'partial', 'complete', 'empty', 'empty', 'empty']);
  assert.equal(progress.complete, 2);
});

test('legacy challenge settings migrate to the five-week journey defaults', () => {
  const config = journey.mergeConfig({
    challengeName: '10일 건강 챌린지',
    challengeStart: '2026-01-01',
    challengeEnd: '2026-01-10',
    badges: [{ id: 'old-streak', days: 10 }],
  });

  assert.equal(config.version, 4);
  assert.equal(config.challengeName, '나의 건강기록 여정');
  assert.deepEqual(config.badges.map((badge) => badge.days), [3, 7, 14, 21, 28]);
  assert.equal(config.schedules['2'].actionStart, '2026-11-20');
});
