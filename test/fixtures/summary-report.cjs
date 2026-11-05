const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const gas = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'gas/Code.js'), 'utf8'), gas);

function makeSummaryFixture({ length = 7, personal = true, empty = false } = {}) {
  const end = '2026-11-05';
  const date = offset => new Date(Date.parse(end) + offset * 86400000).toISOString().slice(0, 10);
  const start = date(1 - length);
  const example = [
    [0, 1380, '09:05', 10.1, 3, '안 함', '안 함', '15분 이내', '없음', '없음'],
    [40, 1401, '09:20', 10, 3, '30분 미만', '30분 미만', '15분 이내', '없음', '조금 있었음'],
    [80, 1521, '06:55', 5.6, 2, '60분 이상', '안 함', '30분 이상', '1번', '꽤 힘들었음'],
    [null, 1287, '06:58', 9.5, 4, '30분 미만', '60분 이상', '15분 이내', '없음', '없음'],
    [120, 1384, '06:54', 7.8, 2, '30~60분', '30~60분', '15~30분', '1번', '조금 있었음'],
    [0, 1407, '06:55', 7.5, null, '30~60분', '30분 미만', '15분 이내', '없음', '조금 있었음'],
  ];
  const drinks = {
    1: ['14:00', '가상 녹차라떼', '맛이 좋아서', '없음'],
    2: ['17:30', '가상 커피', '집중이 필요해서', '잠이 잘 안 왔다'],
    4: ['16:00', '가상 에너지음료', '졸음을 깨려고', '없음'],
  };
  const days = empty ? [] : Array.from({ length: length - 1 }, (_, i) => {
    const k = (i + 7 - length) % 6;
    const [mg, bed, wake, hours, condition, phone, activity, latency, awakenings, drowsy] = example[(k + 6) % 6];
    const [time, drink, reason, symptom] = drinks[(k + 6) % 6] || [];
    return { date: date(i + 1 - length), sleep: { recorded: true, bedOnTimeline: bed, wake, hours,
      condition, latency, awakenings, drowsy }, habits: { phone, activity },
      caffeine: mg === null ? undefined : { recorded: true, totalMg: mg,
        intakes: mg === 0 ? [] : [{ time, drink, mg, reason, symptom }] } };
  });
  const goals = personal ? [
    { id: 'class-caffeine', source: 'class', criterion: 'caffeineMax', threshold: 150, label: '하루 150mg 넘지 않기' },
    { id: 'class-bedtime', source: 'class', criterion: 'bedtime', threshold: '23:59', label: '12시 전에 자기' },
  ] : [];
  const engine = gas.buildFeedbackReport_({ start, end, today: end, days, goals, caffeineLimitMg: 170 });
  return { student: { 이름: '테스트 학생' }, start, end, feedback: { engine, sections: engine.sections }, awards: [] };
}

module.exports = { root, makeSummaryFixture };
