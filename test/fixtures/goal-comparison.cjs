const { gas } = require('./summary-report.cjs');
const student = { 학번:'0',이름:'테스트 학생' };
const goal = { id:'0',name:student.이름,start:'2026-10-30',end:'2026-11-05',uploadId:'fixture-goal',
  goal:'밤 11시에 휴대폰을 무음으로 바꿔 책상에 두고, 잠들기 전 30분 동안 쓰지 않는 것을 7일 중 4일 이상 지키겠다.' };
const shift = (date,days) => new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

function goalFixture(withGoal) {
  const caffeine = [], sleep = [];
  for (let i=0;i<14;i++) {
    const date = shift('2026-10-23',i);
    const practice = i >= 7;
    const phone = (!practice && i<2 || practice && i<11) ? '30분 미만' : '60분 이상';
    const wakeDay = shift(date,1);
    sleep.push([wakeDay+' 08:00:00','','','','0',student.이름,date,practice?'22:50':'23:55',wakeDay,'06:50',
      practice?8:6.9,practice?4:3,'','test-sleep-'+i,phone,'30~60분','15분 이내','없음','없음']);
    const mg = i % 3 === 0 ? 0 : practice ? 40 : 100;
    caffeine.push([date+' 16:05:00','','','','0',student.이름,mg?'가상 차':'안 마심',mg,
      date+(practice?' 14:20:00':' 15:30:00'),'','맛이 좋아서','없음']);
  }
  const source = { caffeine,sleep,info:[],sleepIds:new Map(),sleepMetadata:{groups:new Map()} };
  return {
    student, start:withGoal?'2026-11-01':'2026-10-30', end:'2026-11-05',
    request(input) {
      const globals = {
        teacherReportRoster_:()=>[{id:'0',dashboardId:'0',name:student.이름,researchCode:'TEST-00'}],
        feedbackClassRows_:()=>withGoal?[goal]:[],feedbackSourceRows_:()=>source,
        getSpreadsheet_:()=>({getSheetByName:()=>null}),
      };
      const old = Object.fromEntries(Object.keys(globals).map(key=>[key,gas[key]]));
      const format = gas.Utilities.formatDate;
      Object.assign(gas,globals);
      gas.Utilities.formatDate = ()=>'2026-11-05';
      try { return gas.analyzeTeacherBatch(input); }
      finally { Object.assign(gas,old);gas.Utilities.formatDate=format; }
    },
  };
}

module.exports = { goalFixture };
