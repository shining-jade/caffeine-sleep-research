import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {SleepRecordPolicy} from './support/sleep-policy.js';

const source = fs.readFileSync('teacher/index.html', 'utf8');
const journeySource = fs.readFileSync('public/js/badge-journey.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const end = source.indexOf('\nfunction ', start + 9);
  return source.slice(start, end < 0 ? undefined : end);
}
function fixture(id = '0') {
  const fields = new Map();
  const c = vm.createContext({
    SleepRecordPolicy, today: '2026-10-26',
    studentsData: [{학번:id, 이름:'합성 테스트'}], manualAwards: {},
    caffeineData: ['13','14','15','16','17','18','19','20','21','22','23','24','25'].map(d => ({학번:id, 섭취시간:`2026-10-${d} 12:00`, 함량:0})),
    sleepData: ['14','15','16','17','18','20','21','22','24','25','26'].map(d => ({학번:id, 기상날짜:`2026-10-${d}`, 날짜:'2026-10-12'})),
    activeFilters: {caf:new Set(), sleep:new Set(), award:new Set(), record:new Set()},
    document: {getElementById: key => {if (!fields.has(key)) fields.set(key, {value:'', textContent:''}); return fields.get(key);}},
    msGet: () => null, getStudentFilterDate: () => '2026-10-26', getStudentDates: () => ['2026-10-26'],
    avgCafForDates: () => 0, getLimit: () => 170, hasCafRecordOnDates: () => true, getCafStageKey: () => 'caf0',
    avgSleepForDates: () => 7, S: {sleepWarn:8, sleepGood:10}
  });
  vm.runInContext(journeySource + '\nvar journeyConfig=BadgeJourney.mergeConfig(null); var challengeBadges=journeyConfig.badges;', c);
  c.getAnalysisStudents = () => c.studentsData;
  vm.runInContext(['getSleepWakeDate','hasSleepRecordOnWakeDate','getManualAwardsFor','evaluateAutoTodayBadges','evaluateJourneyBadges','evaluateAwards','renderAwardChips','getFilteredStudents','updateBadges'].map(extract).join('\n'), c);
  return {c, fields};
}
const milestones = c => Array.from(c.evaluateAwards(c.studentsData[0].학번, ['2026-10-26'], '2026-10-26'), b => b.id).filter(id => id.startsWith('journey_'));

test('teacher shows 3 and 7 day milestones for the screenshot-shaped test account records', () => {
  const {c} = fixture();
  assert.deepEqual(milestones(c), ['journey_3','journey_7']);
  const html = c.renderAwardChips('0', ['2026-10-26'], '2026-10-26', true);
  assert.match(html, /기록 첫걸음/);
  assert.match(html, /일주일 관찰자/);
  assert.doesNotMatch(html, /데이터 탐험가/);
});
test('milestones use waking dates, count unique days and require both record types', () => {
  const {c} = fixture();
  c.caffeineData = [13,14,15].flatMap(d => [{학번:'0',섭취시간:`2026-10-${d} 12:00`},{학번:'0',섭취시간:`2026-10-${d} 13:00`}]);
  c.sleepData = [14,15,16].map(d => ({학번:'0',날짜:`2026-10-${d-1}`,기상날짜:`2026-10-${d}`}));
  assert.deepEqual(milestones(c), []);
  c.sleepData.push({학번:'0',날짜:'2026-10-12',기상날짜:'2026-10-13'});
  assert.deepEqual(milestones(c), ['journey_3']);
});
test('class challenge boundaries and historical end dates limit earned milestones', () => {
  const {c} = fixture('2101');
  assert.deepEqual(milestones(c), ['journey_3']);
  assert.deepEqual(Array.from(c.evaluateAwards('2101', [], '2026-10-21'), b => b.id).filter(id => id.startsWith('journey_')), []);
  c.sleepData.push({학번:'2101',기상날짜:'2026-10-19'}, {학번:'2101',기상날짜:'2026-10-23'});
  assert.deepEqual(milestones(c), ['journey_3','journey_7']);
});
test('changing the visible period does not discard earlier challenge achievements', () => {
  const {c} = fixture();
  const one = c.renderAwardChips('0', ['2026-10-26'], '2026-10-26', false);
  const fourteen = c.renderAwardChips('0', ['2026-10-13','2026-10-26'], '2026-10-26', false);
  assert.equal(one, fourteen);
  assert.match(one, /일주일 관찰자/);
});
test('matching teacher-awarded milestone appears once and retains its delete action', () => {
  const {c} = fixture();
  c.manualAwards['0'] = [{awardId:'journey_3',name:'기록 첫걸음',image:'🌱'}];
  const html = c.renderAwardChips('0', [], '2026-10-26', true);
  assert.equal(html.split('기록 첫걸음').length - 1, 1);
  assert.match(html, /deleteManualAward\('0',0\)/);
});
test('badge filter and counts include automatically earned milestones', () => {
  const {c, fields} = fixture();
  c.activeFilters.award.add('badge_journey_7');
  assert.deepEqual(Array.from(c.getFilteredStudents(), s => s.학번), ['0']);
  c.updateBadges();
  assert.equal(fields.get('cntBadge_journey_7').textContent, 1);
  assert.equal(fields.get('cntBadge_journey_14').textContent, 0);
});
