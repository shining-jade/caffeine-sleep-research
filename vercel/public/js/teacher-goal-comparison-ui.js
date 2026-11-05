(function () {
  'use strict';
  const comparison = window.teacherGoalComparison;
  const selectField = (form, name) => form.elements.namedItem(name);
  function call(action, input) {
    return new Promise((resolve,reject)=>{
      google.script.run.withSuccessHandler(result=>{
        if (result?.success === true) resolve(result);
        else reject(new Error(result?.error || '목표 비교 요청을 완료하지 못했습니다.'));
      }).withFailureHandler(reject)[action](input);
    });
  }

  function ruleRow(entry) {
    const row = document.createElement('div');
    row.className = 'goal-dialog-rule';
    row.innerHTML = '<label>행동 <select data-kind aria-label="행동"></select></label><label data-threshold>기준 <input data-value required></label>' +
      '<label data-strict> <input type="checkbox"> 기준값 제외</label><button type="button" class="btn">삭제</button>';
    const select = row.querySelector('[data-kind]');
    const valueBox = row.querySelector('[data-threshold]');
    const strict = row.querySelector('[data-strict]');
    for (const [kind,[label]] of Object.entries(comparison.rules)) select.add(new Option(label,kind));
    select.value = entry.kind;
    const configure = item => {
      const kind = select.value;
      const [,field,min,max] = comparison.rules[kind];
      const clock = ['bedtime','wakeTime','caffeineAfter'].includes(kind);
      const choices = kind === 'phone' ? [[0,'안 함'],[30,'30분 미만'],[60,'60분 미만']] :
        kind === 'activity' ? [[30,'30분 이상'],[60,'60분 이상']] : null;
      const input = document.createElement(choices ? 'select' : 'input');
      input.dataset.value = '';
      input.required = true;
      if (choices) {
        for (const [number,label] of choices) input.add(new Option(label,String(number)));
        input.value = String(item?.value ?? choices[0][0]);
      } else {
        input.type = clock ? 'time' : 'number';
        input.value = item ? clock ? comparison.clock(item.value) : item.value : '';
        if (!clock) { input.min=min; input.max=max; input.step='any'; }
      }
      valueBox.replaceChildren(document.createTextNode('기준 · ' + field + ' '),input);
      strict.hidden = !['caffeineMax','bedtime','wakeTime'].includes(kind);
      strict.querySelector('input').checked = !strict.hidden && item?.strict === true;
    };
    configure(entry);
    select.addEventListener('change',()=>configure(null));
    row.querySelector('button').addEventListener('click',()=>row.remove());
    return row;
  }

  function readRule(row) {
    const kind = row.querySelector('[data-kind]').value;
    const value = row.querySelector('[data-value]').value;
    const [hour,minute] = value.split(':').map(Number);
    return {kind,value:value ? value.includes(':') ? hour*60+minute : Number(value) : NaN,
      strict:kind === 'phone' || row.querySelector('[data-strict] input').checked};
  }

  function showReport(dialog, report) {
    dialog.innerHTML = '<h2>목표 전후 비교 보고서</h2><div class="goal-dialog-actions">' +
      '<button type="button" class="btn" data-save="images">이미지 저장</button><button type="button" class="btn btn-blue" data-save="pdf">이미지 PDF 저장</button>' +
      '<button type="button" class="btn" data-close>닫기</button></div><p role="status"></p><div data-report></div>';
    const {styles,content} = window.teacherReportFiles.buildSummaryReportDocument(report);
    const shadow = dialog.querySelector('[data-report]').attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = styles;
    shadow.append(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    shadow.append(wrapper);
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    const status = dialog.querySelector('[role=status]');
    const buttons = [...dialog.querySelectorAll('[data-save]')];
    buttons.forEach(button=>button.addEventListener('click',async()=>{
      buttons.forEach(item=>item.disabled=true);
      status.textContent = '보고서 파일을 만드는 중입니다.';
      try {
        const files = await window.teacherReportExport.prepare(report,button.dataset.save);
        if (!dialog.open) return;
        if (button.dataset.save === 'images') window.teacherReportExport.offerImageDownloads(files);
        else window.teacherReportExport.download(files[0]);
        status.textContent = '';
      } catch (error) { status.textContent = error?.message || '파일을 만들지 못했습니다.'; }
      finally { buttons.forEach(item=>item.disabled=false); }
    }));
  }

  async function open(student, start, end, limits = {}) {
    if (!student || !start || !end || document.querySelector('.goal-compare-dialog[open]')) return;
    const studentRequest = { studentId:student.학번, studentName:student.이름, limit:limits.limit, limitBasis:limits.limitBasis };
    const request = { start,end,reportVersion:2,mode:'rule',students:[studentRequest] };
    const dialog = document.createElement('dialog');
    dialog.className = 'goal-compare-dialog';
    dialog.setAttribute('aria-labelledby','goalComparisonDialogTitle');
    dialog.innerHTML = '<h2 id="goalComparisonDialogTitle">목표 전후 비교</h2><p role="status">기간과 목표를 확인하는 중입니다.</p>' +
      '<form hidden><fieldset><legend>비교할 기간</legend><div class="goal-dialog-dates">' +
      '<label>기준 시작 <input type="date" name="baselineStart"></label><label>기준 종료 <input type="date" name="baselineEnd"></label>' +
      '<label>비교 시작 <input type="date" name="start" required></label><label>비교 종료 <input type="date" name="end" required></label></div></fieldset>' +
      '<fieldset data-interpretation hidden><legend>이 목표를 이렇게 이해했어요</legend><p data-original></p>' +
      '<button type="button" class="btn" data-ai>AI로 문장 분석</button><p>앱 기록으로 확인할 행동과 기준을 수정할 수 있어요.</p>' +
      '<div data-rules></div><button type="button" class="btn" data-add>행동 추가</button>' +
      '<div class="goal-dialog-dates"><label>계획한 기간(일) <input type="number" min="1" max="366" name="targetWindow"></label>' +
      '<label>지킬 목표 일수 <input type="number" min="1" max="366" name="targetDays"></label></div>' +
      '<label>기록으로 확인할 수 없는 부분 <textarea name="unverified" rows="2" maxlength="500"></textarea></label></fieldset>' +
      '<button type="submit" class="btn btn-blue">확인하고 보고서 만들기</button></form><button type="button" class="btn" data-cancel>닫기</button>';
    document.body.append(dialog);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.querySelector('[data-cancel]').addEventListener('click',()=>dialog.close());
    dialog.showModal();
    const form = dialog.querySelector('form');
    const status = dialog.querySelector('[role=status]');
    const field = name => selectField(form,name);
    try {
      const setup = await call('analyzeTeacherBatch',{ ...request,goalComparison:{phase:'setup'} });
      if (!dialog.open) return;
      const {goal, periods, firstRecordDate} = setup;
      const rulesBox = dialog.querySelector('[data-rules]');
      const ai = dialog.querySelector('[data-ai]');
      const submit = form.querySelector('[type=submit]');
      const apply = model => {
        rulesBox.replaceChildren(...model.rules.map(ruleRow));
        field('targetWindow').value = model.targetWindow ?? '';
        field('targetDays').value = model.targetDays ?? '';
        field('unverified').value = model.unverified.join('\n');
      };
      for (const key of ['start','end','baselineStart','baselineEnd']) field(key).value = periods[key] || '';
      field('start').readOnly = field('end').readOnly = !!goal;
      let baselineEdited = false;
      for (const key of ['baselineStart','baselineEnd']) field(key).addEventListener('input',()=>{baselineEdited=true;});
      field('start').addEventListener('change',()=>{
        if (baselineEdited || !field('start').value) return;
        const end = new Date(Date.parse(field('start').value)-86400000).toISOString().slice(0,10);
        const available = firstRecordDate && firstRecordDate <= end;
        field('baselineStart').value = available ? firstRecordDate : '';
        field('baselineEnd').value = available ? end : '';
      });
      if (goal) {
        dialog.querySelector('[data-interpretation]').hidden = false;
        dialog.querySelector('[data-original]').textContent = goal.goal;
        apply(comparison.parse(goal));
        ai.disabled = !goal.aiSentence;
        ai.addEventListener('click',async()=>{
          ai.disabled = submit.disabled = true;
          status.textContent = '목표 문장만 분석하는 중입니다.';
          try {
            const response = await call('interpretTeacherGoal',goal.aiSentence);
            if (!dialog.open) return;
            const valid = comparison.validate(response.interpretation);
            apply(comparison.interpret(goal,valid));
            status.textContent = valid ? 'AI가 해석한 기준을 확인해 주세요.' : '규칙 기반 해석을 표시했어요.';
          } catch {
            if (dialog.open) { apply(comparison.parse(goal)); status.textContent = '규칙 기반 해석을 표시했어요.'; }
          } finally { ai.disabled = submit.disabled = false; }
        });
        dialog.querySelector('[data-add]').addEventListener('click',()=>{
          const used = [...rulesBox.children].map(row=>row.querySelector('[data-kind]').value);
          const kind = Object.keys(comparison.rules).find(key=>!used.includes(key));
          if (kind) rulesBox.append(ruleRow({kind,value:comparison.rules[kind][2],strict:false}));
        });
      }
      form.hidden = false;
      status.textContent = goal ? '수업 목표의 적용 기간을 사용합니다. 기준 기간과 해석을 확인해 주세요.' :
        '등록된 수업 목표가 없습니다. 비교 기간과 기준 기간을 확인해 주세요.';
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const range = Object.fromEntries(['start','end','baselineStart','baselineEnd'].map(key=>[key,field(key).value]));
        if (range.start > range.end || (!!range.baselineStart !== !!range.baselineEnd) ||
            (range.baselineStart && (range.baselineStart > range.baselineEnd || range.baselineEnd >= range.start))) {
          status.textContent = '기준 기간은 비교 기간 시작 전날까지 선택해 주세요.';
          return;
        }
        let model = null;
        if (goal) {
          const validated = comparison.validate({
            rules:[...rulesBox.children].map(readRule),
            targetDays:field('targetDays').value ? Number(field('targetDays').value) : null,
            targetWindow:field('targetWindow').value ? Number(field('targetWindow').value) : null,
            unverified:field('unverified').value.split('\n').map(item=>item.trim()).filter(Boolean),
          });
          if (!validated) { status.textContent = '행동은 하나씩 선택하고, 기준값과 목표 일수를 확인해 주세요.'; return; }
          model = { ...validated,text:goal.goal };
        }
        submit.disabled = ai.disabled = true;
        status.textContent = '확인한 기준으로 보고서를 만드는 중입니다.';
        try {
          const data = await call('analyzeTeacherBatch',{
            ...request, ...(goal ? {} : { start:range.start,end:range.end }),
            goalComparison:{ phase:'report', practiceStart:range.start,practiceEnd:range.end,
              baselineStart:range.baselineStart,baselineEnd:range.baselineEnd,revision:goal?.revision },
          });
          if (!dialog.open) return;
          const result = comparison.compare({periods:data.periods,model,before:data.before,after:data.after});
          showReport(dialog,{student,start:data.periods.start,end:data.periods.end,feedback:data.feedback,goalComparison:result});
        } catch (error) { status.textContent = error?.message || '보고서를 만들지 못했습니다.'; }
        finally { submit.disabled = false; ai.disabled = !goal?.aiSentence; }
      });
    } catch (error) { status.textContent = error?.message || '기간을 불러오지 못했습니다.'; }
  }

  comparison.open = open;
}());
