(function () {
  'use strict';

  const rules = {
    caffeineMax: ['카페인 양', '카페인 함량', 0, 1000],
    caffeineAfter: ['특정 시각 이후 카페인 안 마시기', '카페인 섭취 시각', 0, 1439],
    phone: ['자기 전 휴대폰', '취침 전 스마트폰 범주', 0, 60],
    activity: ['신체활동', '신체활동 범주', 30, 60],
    bedtime: ['취침시각', '취침시각', 0, 1439],
    wakeTime: ['기상시각', '기상시각', 0, 1439],
    sleepMin: ['수면시간', '취침·기상 간격', 0.01, 24],
  };
  const clock = minutes => {
    const minute = (Math.round(minutes) + 1440) % 1440;
    return String(Math.floor(minute / 60)).padStart(2,'0') + ':' + String(minute % 60).padStart(2,'0');
  };
  const dayLabel = date => date?.slice(5).replace('-', '.') || '';
  const span = (start, end) => start && end ? (start.slice(0,4) === end.slice(0,4)
    ? dayLabel(start) + '~' + dayLabel(end) : start + '~' + end) : '기준 기간 없음';
  const isCaffeine = kind => kind === 'caffeineMax' || kind === 'caffeineAfter';
  const numbers = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const validTarget = value => value === null || Number.isInteger(value) && numbers(value, 1, 366);
  const timeValue = (text, kind) => {
    if (/자정/.test(text)) return 0;
    const match = text.match(/(?:(오후|오전|밤|저녁|새벽|아침)\s*)?(\d{1,2})(?::([0-5]\d)|\s*시(?:\s*(\d{1,2})\s*분)?)/);
    if (!match) return null;
    const [, period, hourText, colon, minuteText] = match;
    let hour = Number(hourText);
    const minute = Number(colon || minuteText || 0);
    if (hour > 23 || minute > 59) return null;
    if (/^(오후|저녁|밤)$/.test(period || '') && hour >= 1 && hour < 12) hour += 12;
    if (hour === 12 && (/^(오전|새벽|아침|밤)$/.test(period || '') || (!period && kind === 'bedtime'))) hour = 0;
    return hour * 60 + minute;
  };
  const validRule = entry => {
    if (!entry || !Object.hasOwn(rules, entry.kind)) return false;
    const [, , min, max] = rules[entry.kind];
    if (!numbers(entry.value, min, max) || typeof entry.strict !== 'boolean') return false;
    if (entry.kind === 'phone') return [0,30,60].includes(entry.value);
    if (entry.kind === 'activity') return [30,60].includes(entry.value);
    return ['caffeineMax','sleepMin'].includes(entry.kind) || Number.isInteger(entry.value);
  };
  function validate(input) {
    if (!input || !Array.isArray(input.rules) || input.rules.length > 7 || !input.rules.every(validRule) ||
        new Set(input.rules.map(entry => entry.kind)).size !== input.rules.length ||
        !validTarget(input.targetDays) || !validTarget(input.targetWindow) ||
        (input.targetDays !== null && input.targetWindow !== null && input.targetDays > input.targetWindow) ||
        !Array.isArray(input.unverified) || input.unverified.length > 10 ||
        input.unverified.some(value => typeof value !== 'string' || value.length > 500)) return null;
    return { rules: input.rules.map(({kind,value,strict})=>({kind,value,strict})),
      targetDays:input.targetDays, targetWindow:input.targetWindow, unverified:input.unverified.map(value=>value.trim()).filter(Boolean) };
  }

  function withNumeric(goal, input) {
    const configured = ['caffeineMax','sleepMin','bedtime','wakeTime'].flatMap(kind => {
      const field = goal[kind];
      if (field === null || field === undefined || field === '') return [];
      const entry = { kind, value:['bedtime','wakeTime'].includes(kind) ? timeValue(field, 'configured') : field, strict:false };
      return validRule(entry) ? [entry] : [];
    });
    return { ...input, text:goal.goal, rules:[...input.rules.filter(rule =>
      !configured.some(entry => entry.kind === rule.kind || (entry.kind === 'caffeineMax' && isCaffeine(rule.kind)))), ...configured] };
  }

  function parse(goal) {
    const text = goal.goal || '';
    const actions = new Map();
    const unverified = new Set();
    let recognized = false;
    const approximate = (kind, value, strict = false) => {
      const item = { kind,value,strict };
      if (!validRule(item)) return;
      recognized = true;
      if (!actions.has(kind)) actions.set(kind,item);
    };
    const paired = text.match(/(\d{1,3})\s*일\s*(?:중|가운데|동안)\s*(\d{1,3})\s*일/);
    const count = text.match(/(?:^|[^\d월\s])\s*(\d{1,3})\s*일\s*(?:이상|은|을|실천|지키)/);
    let targetDays = paired ? Number(paired[2]) : count ? Number(count[1]) : null;
    let targetWindow = paired ? Number(paired[1]) : null;
    if (!validTarget(targetDays) || !validTarget(targetWindow) || (targetWindow && targetDays > targetWindow)) {
      targetDays = targetWindow = null;
    }
    const hidden = [
      [/무음|진동/, '무음·진동 설정'], [/책상에|다른 방|침대 밖/, '휴대폰을 책상 등에 두기'],
      [/알람|알림 설정/, '알람·알림 설정'], [/물(?:을|만|\s)|명상|독서|일기/, '앱에 없는 행동 기록'],
    ];
    for (const [pattern,label] of hidden) if (pattern.test(text)) unverified.add(label);
    const mentionsPhone = /휴대폰|스마트폰|핸드폰|화면/.test(text);
    for (const clause of text.split(/[,;!?。\n]|(?<!\d)\.|\.(?!\d)|그리고|하고\s+|하며\s+|하면서|\s+및\s+/)) {
      recognized = false;
      const amount = clause.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
      const minutes = clause.match(/(\d+)\s*분/);
      if (/카페인|커피|에너지\s*음료|콜라/i.test(clause) || amount) {
        const cutoff = timeValue(clause,'caffeineAfter');
        const noIntake = /0\s*잔|안\s*마시|마시지\s*않|끊기|안마시|섭취하지\s*않/.test(clause);
        if (amount && !/mg\s*(?:이상|초과)|최소\s*\d+(?:\.\d+)?\s*mg/i.test(clause)) approximate('caffeineMax',Number(amount[1]),/미만/.test(clause));
        if (cutoff !== null && /이후|부터/.test(clause) && noIntake) approximate('caffeineAfter',cutoff);
        else if (!amount && noIntake) approximate('caffeineMax',0);
      }
      const phoneClause = /휴대폰|스마트폰|핸드폰|화면/.test(clause) ||
        mentionsPhone && /잠들기\s*전|자기\s*전/.test(clause);
      if (phoneClause && !/분\s*(?:이상|초과)/.test(clause) && (minutes || /안\s*쓰|쓰지\s*않|사용하지|안\s*하/.test(clause))) {
        const value = minutes ? Number(minutes[1]) : 0;
        approximate('phone',value <= 0 ? 0 : value <= 30 ? 30 : 60,true);
      }
      if (/운동|신체활동|걷기|산책/.test(clause) && minutes) {
        approximate('activity',Number(minutes[1]) >= 60 ? 60 : 30);
      }
      if (/취침|잠자리|잠들|누워|눕기|자기/.test(clause) && !/휴대폰|스마트폰|핸드폰|카페인/.test(clause)) {
        const bedtime = timeValue(clause,'bedtime');
        if (bedtime !== null && !/이후/.test(clause)) approximate('bedtime',bedtime,/시(?:\s*\d+\s*분)?\s*전|자정\s*전/.test(clause));
      }
      if (/기상|일어나|일어날/.test(clause)) {
        const wake = timeValue(clause,'wakeTime');
        if (wake !== null && !/이후/.test(clause)) approximate('wakeTime',wake,/시(?:\s*\d+\s*분)?\s*전/.test(clause));
      }
      const duration = clause.match(/(\d+(?:\.\d+)?)\s*시간/);
      if (duration && /수면|자기|잠|자겠|잔다/.test(clause) && !/시간\s*(?:이하|미만)/.test(clause)) approximate('sleepMin',Number(duration[1]));
      if (!recognized && !hidden.some(([pattern])=>pattern.test(clause)) &&
          /마시|먹기|섭취|휴대폰|스마트폰|운동|걷기|취침|기상|수면|공부|샤워|요가|스트레칭|산책|읽기/.test(clause)) {
        unverified.add(clause.trim().slice(0,100));
      }
    }
    const model = withNumeric(goal,{ rules:[...actions.values()],targetDays,targetWindow,unverified:[...unverified] });
    if (!model.rules.length) model.unverified = [...new Set([...model.unverified,'앱에서 확인할 기준을 찾지 못했어요.'])];
    return model;
  }

  function interpret(goal, proposed) {
    const ai = validate(proposed);
    const fallback = parse(goal);
    return ai ? withNumeric(goal, { ...ai,unverified:[...new Set([...fallback.unverified.filter(value=>value !== '앱에서 확인할 기준을 찾지 못했어요.'),...ai.unverified])] }) : fallback;
  }

  function ruleLabel({kind,value,strict}) {
    return {
      caffeineMax: '하루 카페인 ' + value + 'mg ' + (strict ? '미만' : '이하'),
      caffeineAfter: clock(value) + ' 이후 카페인 안 마시기',
      phone: value === 0 ? '자기 전 휴대폰 ‘안 함’' : '자기 전 휴대폰 ‘안 함’ 또는 ' + value + '분 미만',
      activity: '신체활동 ' + value + '분 이상',
      bedtime: clock(value) + (strict ? ' 전' : '까지') + ' 취침',
      wakeTime: clock(value) + (strict ? ' 전' : '까지') + ' 기상',
      sleepMin: '수면시간 ' + value + '시간 이상',
    }[kind];
  }

  function lateIntake(day, cutoff) {
    if (!day.caffeine.recorded) return null;
    if (day.caffeine.totalMg === 0) return false;
    const times = day.caffeine.times;
    if (times.some(time => Number.isFinite(time) && time >= cutoff)) return true;
    return times.length && times.every(Number.isFinite) ? false : null;
  }

  function judge(day, {kind,value,strict}) {
    if (!isCaffeine(kind) && day.open) return null;
    const atMost = (number,limit) => Number.isFinite(number) ? strict ? number < limit : number <= limit : null;
    if (kind === 'caffeineMax') return day.caffeine.recorded ? atMost(day.caffeine.totalMg,value) : null;
    if (kind === 'caffeineAfter') {
      const late = lateIntake(day,value);
      return late === null ? null : !late;
    }
    if (kind === 'bedtime') return atMost(day.sleep.bed,value < 360 ? value + 1440 : value);
    if (kind === 'wakeTime') return atMost(day.sleep.wake,value);
    if (kind === 'sleepMin') return Number.isFinite(day.sleep.hours) ? day.sleep.hours >= value : null;
    const bands = ['안 함','30분 미만','30~60분','60분 이상'];
    const band = bands.indexOf(day.habits[kind]);
    if (band < 0) return null;
    if (kind === 'activity') return band >= (value === 60 ? 3 : 2);
    return band <= (value === 0 ? 0 : value === 30 ? 1 : 2);
  }

  const measured = marks => ({ kept:marks.filter(value=>value===true).length,measured:marks.filter(value=>value!==null).length });
  const mean = values => values.reduce((sum,value)=>sum+value,0) / values.length;
  const ratio = value => value.measured ? value.kept / value.measured : null;
  const measure = (days, read, proportion) => {
    const values = days.map(read).filter(Number.isFinite);
    return { n:values.length,value:values.length ? mean(values) : null,
      ...(proportion ? {count:values.reduce((sum,value)=>sum+value,0)} : {}) };
  };
  const binary = value => value === null ? null : Number(value);
  const metricDefinitions = [
    ['sleep','평균 수면시간',day=>day.open ? null : day.sleep.hours,1,1,'시간',0.5],
    ['bed','평균 취침시각',day=>day.open ? null : day.sleep.bed,-1,60,'분',30],
    ['condition','평균 아침 컨디션',day=>day.open ? null : day.sleep.condition,1,1,'점',0.5],
    ['caffeine','하루 평균 카페인',day=>day.caffeine.recorded ? day.caffeine.totalMg : null,-1,100,'mg',20],
    ['drinking','카페인을 마신 날',day=>day.caffeine.recorded ? Number(day.caffeine.totalMg !== 0) : null,-1,1,'일',null,true],
    ['late','오후 3시 이후 마신 날',day=>binary(lateIntake(day,900)),-1,1,'일',null,true],
  ];
  const precise = value => Number(value.toFixed(1));
  const distanceFromRange = hours => Math.max(0,8-hours,hours-10);
  const verdicts = { good:['좋아짐','#2F7D62'], bad:['아쉬움','#D0743F'], same:['비슷해요','#6B7390'] };

  function changeAmount(metric) {
    const { key, delta, before, after, proportion, unit } = metric;
    const distance = Math.abs(delta);
    if (proportion) return before.n === after.n ? Math.abs(after.count-before.count) + '일' :
      '약 ' + precise(distance * Math.min(before.n,after.n)) + '일분';
    return (key === 'bed' ? Math.round(distance) : precise(distance)) + unit;
  }

  function changeText(metric) {
    const amount = changeAmount(metric);
    const more = metric.delta > 0;
    if (metric.key === 'bed') return '평균 취침시각은 ' + amount + ' ' + (more ? '늦어졌어요.' : '빨라졌어요.');
    if (metric.key === 'sleep') return '수면시간은 평균 ' + amount + ' ' + (more ? '길어졌어요.' : '짧아졌어요.');
    if (metric.proportion) return metric.label + '은 ' + metric.before.n + '일 중 ' + metric.before.count + '일에서 ' +
      metric.after.n + '일 중 ' + metric.after.count + '일로, 기록일 대비 비율이 ' + (more ? '높아졌어요.' : '낮아졌어요.');
    return metric.label + '은 ' + amount + ' ' + (more ? '늘었어요.' : '줄었어요.');
  }

  function missedObservation(days) {
    const options = [
      ['자기 전 휴대폰을 60분 이상 썼다고 기록했어요.', day=>!day.open && day.habits.phone === '60분 이상'],
      ['오후 3시 이후에 카페인을 마셨다고 기록했어요.', day=>lateIntake(day,900) === true],
      ['자기 전 휴대폰을 30분 이상 썼다고 기록했어요.', day=>!day.open && ['30~60분','60분 이상'].includes(day.habits.phone)],
    ];
    const observation = options.map(([text,matches])=>({text,count:days.filter(matches).length}))
      .filter(item=>item.count >= 2).sort((a,b)=>b.count-a.count)[0];
    return observation ? ' 그중 ' + observation.count + '일은 ' + observation.text : '';
  }

  function practicePlan(rules) {
    if (rules.length > 1) return '확인할 수 있는 목표를 함께 실천할 날을 미리 정해 보세요.';
    const [rule] = rules;
    if (rule.kind === 'phone') return '자기 전 휴대폰을 ' + (rule.value ? rule.value + '분 미만으로 쓰는' : '쓰지 않는') + ' 날을 미리 정해 보세요.';
    return ruleLabel(rule) + ' 기준을 지킬 날을 미리 정해 보세요.';
  }

  function compare({periods, model = null, before, after}) {
    const metrics = metricDefinitions.map(([key,label,read,direction,scale,unit,tolerance,proportion])=>{
      const left = measure(before,read,proportion);
      const right = measure(after,read,proportion);
      const comparable = left.n >= 2 && right.n >= 2;
      const delta = comparable ? right.value - left.value : null;
      let verdict = null;
      if (comparable) {
        const distance = Math.abs(delta);
        const similar = proportion ? distance <= 1 / Math.min(left.n,right.n) + 1e-9 : distance < tolerance - 1e-9;
        const benefit = key === 'sleep' ? distanceFromRange(left.value)-distanceFromRange(right.value) : delta * direction;
        verdict = similar || Math.abs(benefit) < 1e-9 ? 'same' : benefit > 0 ? 'good' : 'bad';
      }
      return {key,label,before:left,after:right,comparable,delta,scale,unit,proportion:!!proportion,verdict};
    });
    const available = metrics.some(metric=>metric.comparable);
    const changes = metrics.filter(metric=>metric.verdict === 'good' || metric.verdict === 'bad')
      .sort((a,b)=>Math.abs(b.delta)/b.scale-Math.abs(a.delta)/a.scale);
    const [strongest] = changes;
    const resultText = strongest ? changeText(strongest) : '';
    const summarizeGoal = (label, read, canCheckToday) => {
      const outcomes = after.map(read);
      return { label, before:measured(before.map(read)),after:measured(outcomes), outcomes,
        days:after.map((day,i)=>({date:day.date,mark:outcomes[i] === true ? '✓' : outcomes[i] === false ? '×'
          : day.open && !canCheckToday(day) ? '아직' : '–'})) };
    };
    const activeRules = model?.rules || [];
    const goals = activeRules.map(rule=>summarizeGoal(ruleLabel(rule),day=>judge(day,rule),day=>isCaffeine(rule.kind)&&day.caffeine.recorded));
    const overall = goals.length < 2 ? goals[0] : summarizeGoal('확인 가능한 목표 모두',day=>{
      const values = activeRules.map(rule=>judge(day,rule));
      return values.includes(null) ? null : values.every(Boolean);
    },day=>activeRules.every(rule=>isCaffeine(rule.kind))&&day.caffeine.recorded);
    const count = day => day.caffeine.recorded || !day.open && (day.sleep.recorded || Number.isFinite(day.sleep.hours));
    const recorded = [before.filter(count).length,after.filter(count).length];
    const comparable = !!overall && overall.before.measured >= 2 && overall.after.measured >= 2;
    const target = model?.targetDays;
    const targetKnown = !!overall && Number.isInteger(target) && (overall.after.kept >= target || overall.after.measured >= Math.max(2,target));
    const achieved = targetKnown ? overall.after.kept >= target : null;
    const improved = comparable && ratio(overall.after) > ratio(overall.before);
    let evaluation, goalText, plan;
    if (model) {
      evaluation = !comparable || !targetKnown ? '기록이 조금 더 필요해요.' : improved && achieved ? '잘 해냈어요!' :
        improved || achieved ? '한 걸음 나아갔어요.' : '조금 아쉬웠어요.';
      goalText = comparable ? (goals.length > 1 ? '확인 가능한 목표를 모두 지킨 날은 ' : '같은 기준을 지킨 날은 ') +
        overall.before.measured + '일 중 ' + overall.before.kept + '일에서 ' + overall.after.measured + '일 중 ' + overall.after.kept + '일이었어요.' : '';
      plan = !overall ? '앱에서 확인할 수 있는 행동을 하나 골라 보세요.' : overall.after.measured < 2 ?
        '다음에는 목표에 해당하는 기록을 이틀 이상 남겨 보세요.' :
        practicePlan(activeRules);
    } else {
      evaluation = strongest ? (strongest.verdict === 'good' ? '좋아졌어요' : '조금 아쉬웠어요') :
        (available ? '두 기간의 기록은 거의 그대로였어요.' : '기록이 조금 더 필요해요.');
      goalText = '';
      plan = available ? '다음 비교 기간에도 같은 항목을 기록해 변화를 살펴보세요.' : '두 기간에 같은 항목을 이틀 이상 기록해 보세요.';
    }
    const observation = goalText && resultText ? goalText.replace(/이었어요\.$/, '이었고, ') + resultText : goalText || resultText;
    const summary = [evaluation,observation,model && evaluation === '조금 아쉬웠어요.' ? plan : ''].filter(Boolean).join(' ');
    const keptConditions = measure(after,(day,index)=>!day.open && overall?.outcomes[index] === true ? day.sleep.condition : null);
    const missedConditions = measure(after,(day,index)=>!day.open && overall?.outcomes[index] === false ? day.sleep.condition : null);
    const condition = overall ? { kept:keptConditions,missed:missedConditions } : null;
    const better = changes.find(metric=>metric.verdict === 'good');
    const harder = changes.find(metric=>metric.verdict === 'bad');
    const missed = after.filter((_day,index)=>overall?.outcomes[index] === false);
    const reflection = model ? [
      (improved && goalText) || (overall?.after.kept ? '실천 기간에 확인할 수 있는 목표를 ' + overall.after.kept + '일 지켰어요.' : '비교 기간의 기록을 살펴봤어요.'),
      missed.length ? '실천 기간에 같은 기준을 지키지 못한 날은 ' + missed.length + '일이었어요.' + missedObservation(missed) :
        comparable ? '비교에 사용한 기록에서 빠진 목표 항목을 확인해 보세요.' : '같은 항목의 기록이 더 쌓이면 두 기간을 비교할 수 있어요.',
      plan,
    ] : [better ? changeText(better) : '비교할 기록을 남겼어요.',
      harder ? changeText(harder) : available ? '기록한 항목을 기간별로 함께 살펴보세요.' : '같은 항목의 기록이 더 쌓이면 두 기간을 비교할 수 있어요.',plan];
    return { periods,model,metrics,goals,overall,recorded,comparable,achieved,evaluation,summary,condition,reflection };
  }

  const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
  const shorten = (value,length) => value.length > length ? value.slice(0,length).trimEnd() + '…' : value;
  const targetText = model => !model?.targetDays ? '정하지 않음' : model.targetWindow ?
    model.targetWindow + '일 중 ' + model.targetDays + '일' : model.targetDays + '일';
  const compareHold = '비교 보류 · 양쪽에 유효 기록이 2일 이상 필요해요.';
  const compareCss = [
    '.goal-compare-page{gap:13px}.goal-compare-page h2{font-size:16px}',
    '.goal-compare-lead{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:14px;background:#2f2a6b;color:#fff;font-size:13px}',
    '.goal-compare-lead span{flex:none;border-radius:999px;padding:4px 9px;background:#fff;color:#2f2a6b;font-weight:800;font-size:11px}',
    '.goal-compare-plan{display:grid;gap:7px;padding:11px 14px;border-radius:14px;background:#f1effb}',
    '.goal-compare-chips{display:flex;flex-wrap:wrap;gap:5px}.goal-compare-chips span{border:1.5px solid #5b4fc4;border-radius:12px;background:white;color:#3b3195;padding:3px 8px;font-size:11px}',
    '.goal-compare-chips .unverified{border-style:dashed;border-color:#9aa0b4;color:#4a5470}',
    '.goal-compare-side{display:grid;grid-template-columns:1fr 28px 1fr;align-items:center;gap:8px}',
    '.goal-compare-side article{display:grid;gap:1px;padding:8px 12px;border:1.5px solid #e2def3;border-radius:12px;color:#4a5470;font-size:11px}',
    '.goal-compare-side article:last-child{background:#e3f3ec;border-color:#e3f3ec;color:#185a41}',
    '.goal-compare-side strong{font-size:21px;line-height:1.2}.goal-compare-side>b{text-align:center;color:#5b4fc4;font-size:20px}',
    '.goal-compare-side strong small{font-size:12px;margin-left:6px}',
    '.goal-compare-track{display:block;position:relative;height:6px;margin:4px 0 1px;border-radius:5px;background:#e5e9f4}',
    '.goal-compare-track i{display:block;height:100%;border-radius:5px;background:#61779d}.goal-compare-track.after i{background:#5b4fc4}',
    '.goal-compare-legend{display:flex;flex-wrap:wrap;gap:4px 10px}.goal-compare-legend span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}',
    '.goal-compare-legend i{width:9px;height:9px;border-radius:50%;background:var(--verdict);box-sizing:border-box}.goal-compare-legend .before{background:#fff;border:2px solid #9aa0b4}',
    '.goal-compare-legend .reference{width:15px;border-radius:2px;background:#dfe8f7;border-left:2px dashed #8f96ad}',
    '.goal-compare-dumbbell{padding-inline:7px}.goal-compare-axis{height:19px;position:relative}.goal-compare-axis i{position:absolute;display:block}',
    '.goal-compare-axis .rail{top:8px;width:100%;height:2px;background:#e6e8ef}.goal-compare-axis .band{top:2px;height:14px;border-radius:4px;background:#dfe8f7}',
    '.goal-compare-axis .reference{top:0;height:18px;border-left:2px dashed #8f96ad}.goal-compare-axis .bridge{top:7px;height:4px;border-radius:2px;background:var(--verdict)}',
    '.goal-compare-axis .dot{top:2px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--verdict)}',
    '.goal-compare-axis .before{background:white;border:2px solid #9aa0b4}.goal-compare-axis .overlap{top:5px;width:8px;height:8px;margin-left:-4px}',
    '.goal-compare-ticks{display:flex;justify-content:space-between;gap:2px;font-size:9px;color:#4a5470;white-space:nowrap}',
    '.goal-compare-section{display:grid;gap:6px}.goal-compare-section>p{font-size:11px;color:#4a5470}',
    '.goal-compare-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.goal-compare-days.compact{grid-template-columns:repeat(14,minmax(0,1fr))}.goal-compare-days.dense{grid-template-columns:repeat(21,minmax(0,1fr))}',
    '.goal-compare-day{display:grid;gap:2px;text-align:center;font-size:10px;color:#4a5470}.goal-compare-day b{border:1.5px solid transparent;border-radius:6px;background:#eef0f4;line-height:1.2;padding:3px 0;font-size:12px}',
    '.goal-compare-day .kept{background:#2f7d62;color:white}.goal-compare-day .missed{background:white;border-color:#d0743f;color:#9a3d0e}.goal-compare-day .open{border:1px dashed #b8bccb;background:white;color:#4a5470;font-size:10px}',
    '.goal-compare-metrics{border:1.5px solid #e2def3;border-radius:12px;overflow:hidden}.goal-compare-metrics table{width:100%;table-layout:fixed;border-collapse:collapse;text-align:left}',
    '.goal-compare-metrics .name-col,.goal-compare-metrics .result-col{width:148px}.goal-compare-metrics .value-col{width:84px}',
    '.goal-compare-metrics th,.goal-compare-metrics td{padding:4px 6px;font-size:12px;line-height:1.25;border-top:1px solid #ece9f6;white-space:nowrap}',
    '.goal-compare-metrics thead th{background:#f1effb;border:0}.goal-compare-metrics tbody th{color:#1f4a85}.goal-compare-metrics tbody th.caf{color:#8a3b10}',
    '.goal-compare-metrics small{color:#4a5470;font-size:10px}.goal-compare-metrics .trend{font-weight:800;color:var(--verdict)}',
    '.goal-compare-metrics .before-value{text-align:right}.goal-compare-metrics .after-value{font-weight:700}',
    '.goal-compare-section .goal-compare-condition{background:#eef3fa;padding:6px 9px;border-radius:9px;color:#1f2a44}',
    '.goal-compare-page .summary-reflect-card{padding:8px 10px;font-size:12px}.goal-compare-page .summary-foot{margin-top:0!important}',
    '@media(max-width:680px){.goal-compare-metrics table,.goal-compare-metrics tbody{display:block}.goal-compare-metrics colgroup{display:none}.goal-compare-metrics thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}',
    '.goal-compare-metrics tbody tr{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;align-items:center;padding:4px;border-top:1px solid #ece9f6}.goal-compare-metrics tr:first-child{border:0}',
    '.goal-compare-metrics tbody th,.goal-compare-metrics tbody td{border:0;padding:3px 4px;font-size:11px}.goal-compare-metrics tbody th{grid-column:1/3;grid-row:1}.goal-compare-metrics .trend{grid-column:2/4;grid-row:1;justify-self:end}',
    '.goal-compare-metrics .before-value{grid-column:1;grid-row:2}.goal-compare-metrics .graph{grid-column:2;grid-row:2}.goal-compare-metrics .after-value{grid-column:3;grid-row:2}.goal-compare-metrics .hold{grid-column:1/-1;grid-row:2}}',
    '@media(max-width:520px){.goal-compare-lead{align-items:flex-start;flex-direction:column;gap:4px}.goal-compare-days.compact,.goal-compare-days.dense{grid-template-columns:repeat(7,minmax(0,1fr))}}',
  ].join('\n');


  function track(fraction, period) {
    return '<span class="goal-compare-track ' + period + '" aria-hidden="true"><i style="width:' +
      precise(fraction * 100) + '%"></i></span>';
  }

  function chartScale(metric, limitInfo) {
    if (metric.key === 'sleep') return { min:5,max:11,minText:'5시간',maxText:'11시간',reference:'8~10시간',band:[8,10] };
    if (metric.key === 'bed') return { min:1260,max:1560,minText:'21시',maxText:'02시',reference:'12시',line:1440 };
    if (metric.key === 'condition') return { min:1,max:5,minText:'1점',maxText:'5점',reference:'보통 3점',line:3 };
    if (metric.key === 'caffeine') {
      const limit = limitInfo.basis !== 'noWeight' && limitInfo.amountMg > 0 ? limitInfo.amountMg : null;
      const max = Math.ceil(Math.max(200,metric.before.value,metric.after.value,limit ?? 0));
      const reference = limit ? '일일 최대 ' + precise(limit) + 'mg' : limitInfo.basis === 'noWeight' ? '체중 정보 없음' : '';
      return { min:0,max,minText:'0mg',maxText:max + 'mg',reference,line:limit };
    }
    return { min:0,max:1,minText:'0%',maxText:'100%' };
  }

  function dumbbell(metric, limitInfo) {
    const scale = chartScale(metric,limitInfo);
    const position = value => precise(Math.min(100,Math.max(0,100 * (value-scale.min) / (scale.max-scale.min))));
    const before = position(metric.before.value), after = position(metric.after.value);
    const element = (name,left,width) => '<i class="' + name + '" style="left:' + left + '%' +
      (width === undefined ? '' : ';width:' + width + '%') + '"></i>';
    const band = scale.band ? element('band',position(scale.band[0]),position(scale.band[1])-position(scale.band[0])) : '';
    const line = Number.isFinite(scale.line) ? element('reference',position(scale.line)) : '';
    return '<div class="goal-compare-dumbbell"><div class="goal-compare-axis" aria-hidden="true">' +
      '<i class="rail"></i>' + band + line + element('bridge',Math.min(before,after),Math.abs(after-before)) +
      element('dot before',before) + element(Math.abs(after-before) < 5 ? 'dot overlap' : 'dot',after) +
      '</div><div class="goal-compare-ticks"><span>' + scale.minText + '</span><span>' + (scale.reference || '') +
      '</span><span>' + scale.maxText + '</span></div></div>';
  }

  function verdictText(metric) {
    const [label] = verdicts[metric.verdict];
    if (metric.verdict === 'same') return label;
    const more = metric.delta > 0;
    const direction = metric.key === 'sleep' ? (more ? '길어짐' : '짧아짐') :
      metric.key === 'bed' ? (more ? '늦게' : '일찍') :
      metric.key === 'condition' ? (more ? '높음' : '낮음') : (more ? '많음' : '적음');
    return label + ' · ' + changeAmount(metric) + ' ' + direction;
  }

  function renderPage(data, name, limitInfo = {}) {
    const {periods, model, overall, goals, comparable, achieved, recorded, condition} = data;
    const beforePeriod = span(periods.baselineStart,periods.baselineEnd);
    const afterPeriod = span(periods.start,periods.end);
    const beforeLabel = model ? '목표 세우기 전' : '기준 기간';
    const afterLabel = model ? '실천 기간' : '비교 기간';
    const chapter = (title, content) => '<section class="goal-compare-section"><h2>' + title + '</h2>' + content + '</section>';
    const planned = targetText(model);
    const goalChips = model ? [
      ...model.rules.map(rule=>'<span>앱 기록으로 확인 · ' + escape(ruleLabel(rule)) + ' (' + escape(rules[rule.kind][1]) + ')</span>'),
      '<span>목표 일수 · ' + escape(planned) + '</span>',
      ...(model.unverified.length ? ['<span class="unverified">기록으로 확인할 수 없는 부분 · ' +
        escape(shorten(model.unverified.join(' · '),160)) + '</span>'] : []),
    ].join('') : '';
    const plan = model ? '<section class="goal-compare-plan"><h2>① 내 목표</h2><p>“' + escape(shorten(model.text || '',190)) +
      '”</p><div class="goal-compare-chips">' + goalChips + '</div></section>' : '';
    const goalValue = side => side.kept + ' / ' + side.measured + '일';
    const value = (left, right, leftGraph = '', rightGraph = '') => '<div class="goal-compare-side"><article><span>' + beforeLabel + ' (' + escape(beforePeriod) +
      ')</span><strong>' + left + '</strong>' + leftGraph + '</article><b aria-hidden="true">→</b><article><span>' + afterLabel +
      ' (' + escape(afterPeriod) + ')</span><strong>' + right + '</strong>' + rightGraph + '</article></div>';
    const goalGraph = () => {
      const before = ratio(overall.before), after = ratio(overall.after);
      const percent = amount => ' <small>' + precise(amount * 100) + '%</small>';
      return '<p>목표 실천율 · 판정 가능한 날 중 지킨 날</p>' +
        value(goalValue(overall.before) + percent(before), goalValue(overall.after) + percent(after),
          track(before, 'before'), track(after, 'after'));
    };
    const marks = overall ? '<div class="goal-compare-days' + (overall.days.length > 56 ? ' dense' : overall.days.length > 7 ? ' compact' : '') +
      '" aria-label="실천 기간 날짜별 판정">' + overall.days.map(day =>
        '<div class="goal-compare-day"><span>' + escape(dayLabel(day.date)) + '</span><b class="' +
        ({'✓':'kept','×':'missed','아직':'open','–':'missing'}[day.mark]) + '">' + day.mark + '</b></div>').join('') + '</div>' : '';
    const outcome = achieved === null ? '목표 일수 달성 여부는 확인을 보류했어요.' :
      '계획한 ‘' + planned + '’ 기준을 ' + (achieved ? '달성했어요.' : '아직 달성하지 못했어요.');
    const breakdown = goals.length > 1 ? goals.map(goal=>'<p>' + escape(goal.label) + ' · ' + (goal.before.measured >= 2 && goal.after.measured >= 2 ?
      goalValue(goal.before) + ' → ' + goalValue(goal.after) : '비교 보류') + '</p>').join('') : '';
    const comparison = model
      ? (comparable ? goalGraph() : '<p>' + compareHold + '</p>') +
        '<p>' + outcome + '</p>' + breakdown + marks + (overall ? '<p>✓ 지킴 · × 못 지킴 · – 판정 없음 · 아직 = 지나지 않은 밤</p>' : '')
      : (recorded.every(n=>n>=2) ? value('기록 ' + recorded[0] + '일','기록 ' + recorded[1] + '일') : '<p>' + compareHold + '</p>');
    const metricValue = (metric, side) => metric.proportion ? side.count + ' / ' + side.n + '일' :
      (metric.key === 'bed' ? clock(side.value) : side.value.toFixed(1) + metric.unit) + ' <small>(' + side.n + '일)</small>';
    const legendItem = (label,style,color) => '<span><i aria-hidden="true" class="' + style + '"' +
      (color ? ' style="--verdict:' + color + '"' : '') + '></i>' + label + '</span>';
    const legend = data.metrics.some(metric=>metric.comparable) ? '<p class="goal-compare-legend">' +
      legendItem(beforeLabel,'before') + legendItem(afterLabel + ' · 좋아짐','',verdicts.good[1]) +
      legendItem('아쉬움','',verdicts.bad[1]) + legendItem('비슷해요','',verdicts.same[1]) +
      legendItem('권장 범위 · 기준선','reference') + '</p>' : '';
    const table = legend + '<div class="goal-compare-metrics"><table role="table"><colgroup><col class="name-col"><col class="value-col"><col><col class="value-col"><col class="result-col"></colgroup>' +
      '<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">항목</th><th scope="col" role="columnheader" class="before-value">' + beforeLabel +
      '</th><th scope="col" role="columnheader">변화 그래프</th><th scope="col" role="columnheader">' + afterLabel +
      '</th><th scope="col" role="columnheader">결과</th></tr></thead><tbody role="rowgroup">' +
      data.metrics.map(metric => {
        const heading = '<th scope="row" role="rowheader" class="' + (['caffeine','drinking','late'].includes(metric.key) ? 'caf' : 'sleep') +
          '">' + metric.label + '</th>';
        if (!metric.comparable) return '<tr role="row">' + heading + '<td role="cell" colspan="4" class="hold">비교 보류 <small>(기준 ' +
          metric.before.n + '일 · 비교 ' + metric.after.n + '일, 양쪽 2일 필요)</small></td></tr>';
        return '<tr role="row" style="--verdict:' + verdicts[metric.verdict][1] + '">' + heading +
          '<td role="cell" class="before-value">' + metricValue(metric,metric.before) + '</td><td role="cell" class="graph">' + dumbbell(metric,limitInfo) +
          '</td><td role="cell" class="after-value">' + metricValue(metric,metric.after) + '</td><td role="cell" class="trend">' +
          verdictText(metric) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    const conditionText = condition ? '<p class="goal-compare-condition"><b>실천 기간 안에서</b> ' +
      (condition.kept.n >= 2 && condition.missed.n >= 2 ? '지킨 날(' + condition.kept.n + '일)의 다음 날 아침 컨디션은 평균 ' +
        condition.kept.value.toFixed(1) + '점, 못 지킨 날(' + condition.missed.n + '일)은 ' + condition.missed.value.toFixed(1) + '점이었어요.' :
        '지킨 날과 못 지킨 날의 컨디션 비교는 양쪽 기록이 이틀 이상일 때 보여 줘요.') + '</p>' : '';
    const reflection = '<div class="summary-three">' + ['잘된 점','어려웠던 점','다음 계획'].map((label,i)=>
      '<article class="summary-reflect-card"><h3>' + label + '</h3><p>' + escape(data.reflection[i]) + '</p></article>').join('') + '</div>';
    const punctuation = /[.!?]$/.test(data.evaluation) ? '' : '.';
    return '<article class="summary-page goal-compare-page"><header class="summary-header"><div>' +
      '<p class="summary-kicker">카페인·수면 기록 요약 · 목표 전후 비교</p><h1>' + escape(name) + (model ? '의 목표 실천' : '의 기간 비교') +
      '</h1><p class="summary-sub">' + beforeLabel + ' ' + escape(beforePeriod) + ' · ' + afterLabel + ' ' + escape(afterPeriod) +
      ' · 날짜는 그날 밤 기준</p></div></header><section class="goal-compare-lead"><span>한 줄 정리</span><p><b>' + escape(data.evaluation) +
      punctuation + '</b>' + escape(data.summary.slice(data.evaluation.length)) + '</p></section>' + plan +
      chapter(model ? '② 같은 기준으로 본 전후' : '② 기록한 날',comparison) + chapter('③ 수면과 카페인도 함께 보기',table + conditionText) +
      chapter('④ 돌아보기',reflection) + '<footer class="summary-foot"><p>함께 변했다고 목표 행동이 원인이라고 할 수는 없어요. 비교는 양쪽 모두 유효 기록이 2일 이상일 때 보여 줘요. ‘안 마심’은 0mg으로 계산해요.</p></footer></article>';
  }

  window.teacherGoalComparison = { parse, interpret, validate, rules, ruleLabel, clock, compare, renderPage, styles:compareCss };
}());
