(function installTeacherBatchReports() {
  'use strict';

  const $ = id => document.getElementById(id);
  const filters = $('batchReportFilters');
  const goalControls = $('batchGoalControls');
  const grade = $('batchReportGrade');
  const room = $('batchReportClass');
  const reportStart = $('batchReportStart');
  const reportEnd = $('batchReportEnd');
  const aiMode = $('batchAiMode');
  const goalStart = $('batchGoalStart');
  const goalEnd = $('batchGoalEnd');
  const all = $('batchReportAll');
  const studentList = $('batchReportStudents');
  const status = $('batchReportStatus');
  const resultList = $('batchReportResults');
  const zipButton = $('batchReportZip');
  const imageZipButton = $('batchReportImageZip');
  const zipFile = $('batchReportZipFile');
  const sendButton = $('batchReportSend');
  const goalStatus = $('batchGoalStatus');
  const goalFile = $('batchGoalFile');
  const goalSave = $('batchGoalSave');
  const { parseGoalCsv, createPdfZip, goalColumns, renderFeedback } = window.teacherReportFiles;
  const output = window.teacherReportExport;
  const previewDialog = $('batchPdfPreview');
  // Individual preview also uses this dialog while the batch tab is hidden.
  document.body.append(previewDialog);
  const selected = new Set();
  const studentKey = student => JSON.stringify([student.학번, student.이름.trim()]);
  let reports = [];
  let pendingGoals;
  let busy = false;
  let previewVersion = 0;
  let previewUrl;
  function call(action, params) {
    return new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(result => {
        if (result?.success === true) resolve(result);
        else reject(Object.assign(new Error(result?.error || '요청을 완료하지 못했습니다.'), { errors: result?.errors }));
      }).withFailureHandler(reject)[action](params);
    });
  }

  function period(start, end) {
    const dates = [start.value, end.value];
    const length = (Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000 + 1;
    if (!Number.isInteger(length) || length < 1 || length > 366) throw new Error('시작일과 종료일을 1~366일 범위로 선택해 주세요.');
    return { start: dates[0], end: dates[1] };
  }

  function saveFile(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function options(select, values, suffix) {
    const previous = select.value;
    select.replaceChildren(new Option('전체', ''), ...values.map(value => new Option(value + suffix, value)));
    if (values.includes(previous)) select.value = previous;
  }

  function matchingStudents() {
    return getAnalysisStudents().filter(student => (!grade.value || student.학년 === grade.value)
      && (!room.value || student.반 === room.value));
  }

  function updateSelection() {
    const visible = matchingStudents();
    const count = visible.filter(student => selected.has(studentKey(student))).length;
    all.checked = count > 0 && count === visible.length;
    all.indeterminate = count > 0 && count < visible.length;
    all.disabled = visible.length === 0;
    $('batchReportSelection').textContent = '현재 목록 전체 선택 (' + count + '/' + visible.length + '명)';
    $('batchReportRun').disabled = count === 0;
  }

  function refresh() {
    if (busy) return;
    const students = getAnalysisStudents();
    const distinct = values => Array.from(new Set(values.filter(Boolean))).sort((a, b) => Number(a) - Number(b));
    options(grade, distinct(students.map(student => student.학년)), '학년');
    options(room, distinct(students.filter(student => !grade.value || student.학년 === grade.value).map(student => student.반)), '반');
    const visible = matchingStudents();
    const ids = new Set(visible.map(studentKey));
    let changed = false;
    for (const id of selected) {
      if (!ids.has(id)) { selected.delete(id); changed = true; }
    }
    if (changed) clearReports();
    studentList.replaceChildren(...visible.map(student => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selected.has(studentKey(student));
      input.addEventListener('change', () => {
        if (input.checked) selected.add(studentKey(student));
        else selected.delete(studentKey(student));
        clearReports();
        updateSelection();
      });
      label.append(input, document.createTextNode(student.학번 + ' ' + student.이름));
      return label;
    }));
    if (!visible.length) studentList.textContent = '조건에 해당하는 학생이 없습니다.';
    updateSelection();
  }

  function updateActions() {
    const ready = reports.filter(report => !report.error);
    filters.disabled = busy;
    goalControls.disabled = busy;
    zipButton.disabled = imageZipButton.disabled = busy || !ready.length;
    sendButton.disabled = busy || !ready.some(report => !report.delivered);
    goalSave.disabled = busy || !pendingGoals;
  }

  function clearReports(message = '기간과 학생을 선택해 분석해 주세요.') {
    if (previewDialog.open) previewDialog.close();
    clearZip();
    reports = [];
    resultList.replaceChildren();
    status.textContent = message;
    updateActions();
  }

  function clearZip() {
    if (zipFile.hasAttribute('href')) URL.revokeObjectURL(zipFile.href);
    zipFile.removeAttribute('href');
    zipFile.hidden = true;
  }

  function average(daily, column) {
    const values = daily.map(day => day[column]).filter(value => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function topObservations(records, field, unit, split = false) {
    const counts = new Map();
    for (const row of records) {
      const raw = String(row[field] || '');
      const labels = (split ? raw.split(/[,\/]/) : [raw]).map(value => value.trim().slice(0, 42)).filter(Boolean);
      for (const label of new Set(labels)) {
        if (split && label === '없음') continue;
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .slice(0, 2).map(([label, count]) => label + ' ' + count + unit).join(' · ');
  }

  function analysisInput(report) {
    const observations = {};
    for (const [key, field] of [['reasons', '이유'], ['symptoms', '부작용']]) {
      const value = topObservations(report.cafRecords.filter(row => Number.isFinite(row.함량) && row.함량 > 0), field, '회', true);
      if (value) observations[key] = value;
    }
    for (const [key, field] of [['phone', '스마트폰'], ['activity', '활동'], ['latency', '잠들기'], ['wake', '각성'], ['drowsy', '낮졸림']]) {
      const value = topObservations(report.mainSleep, field, '일');
      if (value) observations[key] = value;
    }
    const input = { studentId: report.student.학번, studentName: report.student.이름, daily: report.daily, limit: report.limit,
      limitBasis: report.limitBasis };
    if (Object.keys(observations).length) input.observations = observations;
    return input;
  }

  async function requestAnalysis(prepared, start, end, mode, thresholds = getCafThresholds(), reportMode = 'ongoing', includeSavedReportEdits = false) {
    const request = { start, end, mode, thresholds, reportVersion: 2, reportMode, includeSavedReportEdits, students: prepared.map(analysisInput) };
    try {
      return await call('analyzeTeacherBatch', request);
    } catch (error) {
      if (mode !== 'ai') throw error;
      const response = await call('analyzeTeacherBatch', { ...request, mode: 'rule' });
      for (const report of response.reports) {
        if (report.feedback) report.feedback.aiFallback = true;
      }
      return response;
    }
  }

  async function analyzeStudent(student, dates, mode = 'rule', reportMode = 'ongoing') {
    const report = prepareReport(student, dates);
    const response = await requestAnalysis([report], dates[0], dates[dates.length - 1], mode, undefined, reportMode);
    const result = response.reports?.[0];
    if (!result?.analysis || result.studentId !== student.학번) throw new Error(result?.error || '분석 결과를 확인할 수 없습니다.');
    return { ...report, ...result, start: dates[0], end: dates[dates.length - 1] };
  }

  function prepareReport(student, dates) {
    const dateSet = new Set(dates);
    const name = student.이름.trim();
    const owned = row => row.학번 === student.학번 && String(row.name || '').trim() === name;
    const studentCaffeine = caffeineData.filter(owned);
    const cafRecords = studentCaffeine.filter(row => dateSet.has(SleepRecordPolicy.date(row.섭취시간)));
    const caffeineDays = SleepRecordPolicy.caffeineDays(cafRecords);
    const studentSleep = sleepData.filter(owned);
    const sleepRecords = SleepRecordPolicy.selectPeriod(studentSleep, {
      start: dates[0], end: dates[dates.length - 1],
    }).records;
    const sleepGroups = SleepRecordPolicy.days(studentSleep);
    const daily = dates.map(date => {
      const caffeine = caffeineDays.get(date);
      const sleep = sleepGroups.get(date);
      const main = sleep?.record;
      const midnightKst = SleepRecordPolicy.instant(date);
      const bedtimeMinutes = Number.isFinite(main?.bed) ? Math.floor((main.bed - midnightKst) / 60000) : null;
      const wakeTime = main ? new Date(main.wake + 9 * 3600000).toISOString().slice(11, 16) : '';
      const hours = (caffeine?.records || []).filter(row => Number.isFinite(row.함량) && row.함량 > 0)
        .map(row => String(row.섭취시간 || '').match(/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d/)?.[1]);
      const latest = caffeine?.status === 'known' && hours.length && hours.every(hour => hour !== undefined)
        ? Math.max(...hours.map(Number)) : null;
      const timing = latest === null ? null : latest >= 18 ? 'evening' : latest >= 12 ? 'afternoon' : 'morning';
      return [caffeine?.total ?? null, main?.intervalHours ?? null, main?.condition ?? null,
        bedtimeMinutes, wakeTime, sleep?.status === 'held' ? 'held' : '', caffeine?.status === 'unknown', timing,
        main?.source?.스마트폰 || null, main?.source?.활동 || null];
    });
    const info = infoData.find(owned) || null;
    return {
      student, dates, daily, cafRecords, caffeineDays, studentCaffeine, sleepRecords, sleepGroups, studentSleep, info,
      awards: getManualAwardsFor(student.학번).filter(award => award.studentName === name),
      mainSleep: dates.map(date => sleepGroups.get(date)?.record?.source).filter(Boolean),
      ...getLimit(student.학번, info, { withBasis: true }),
      caffeineAverage: average(daily, 0),
      sleepAverage: average(daily, 1),
      sleepDays: daily.filter(day => day[1] !== null).length,
      deliveryId: crypto.randomUUID(),
    };
  }

  function renderResults() {
    resultList.replaceChildren(...reports.map((report, index) => {
      const item = document.createElement('article');
      item.className = 'report-result';
      const header = document.createElement('div');
      header.className = 'report-result-header';
      const identity = document.createElement('h4');
      identity.textContent = report.student.이름 + ' · ' + report.student.학번;
      const badge = document.createElement('span');
      badge.className = 'report-result-badge';
      badge.textContent = report.error ? '분석 실패' : report.delivered ? '전송 완료'
        : report.sendError ? '전송 실패' : report.edited ? '수정됨' : '분석 완료';
      header.append(identity, badge);
      let editAnalysis;
      if (!report.error) {
        const edit = editAnalysis = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn';
        edit.textContent = '분석 수정';
        edit.setAttribute('aria-label', report.student.이름 + ' 분석 수정');
        edit.addEventListener('click', () => {
          if (reportView.querySelector('[data-feedback-view="report"][aria-pressed="true"]')) openReportEditor();
          else openFeedbackEditor();
        });
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'btn report-preview-button';
        preview.textContent = '이미지 PDF 미리보기';
        preview.setAttribute('aria-label', report.student.이름 + ' PDF 미리보기');
        preview.addEventListener('click', () => {
          if (!busy) void openPreview(report);
        });
        const goalComparison = document.createElement('button');
        goalComparison.type = 'button';
        goalComparison.className = 'btn';
        goalComparison.textContent = '목표 전후 비교';
        goalComparison.addEventListener('click', () => {
          if (!busy) void window.teacherGoalComparison.open(report.student, report.start, report.end, report);
        });
        header.append(edit, preview, goalComparison);
      }
      const detail = document.createElement('details');
      detail.open = report.expanded ?? index === 0;
      const summary = document.createElement('summary');
      summary.textContent = report.error ? '오류 상세 보기' : '분석 내용 보기';
      const feedback = document.createElement('div');
      renderFeedback(feedback, report.feedback, report.error || report.analysis);
      const reportView = document.createElement('div');
      const saveSummary = async values => {
        if (busy || !reports.includes(report)) throw new Error('다시 분석한 뒤 저장해 주세요.');
        busy = true;
        updateActions();
        try {
          const mode = report.feedback.reportMode === 'final' ? 'final' : 'ongoing';
          const saved = await saveReportEdit(report.student, report.start, report.end, mode, values);
          if (!reports.includes(report)) throw new Error('분석 결과가 바뀌었습니다.');
          report.feedback.summaryEdit = saved || { ...report.feedback.summaryEdit, ...values };
          report.edited = true;
          report.delivered = false;
          report.sendError = false;
          report.deliveryId = crypto.randomUUID();
          clearZip();
          badge.textContent = '수정됨';
          return report.feedback.summaryEdit;
        } finally {
          busy = false;
          updateActions();
        }
      };
      detail.append(summary, reportView, feedback);
      const textEditor = !report.error ? window.teacherReportFiles.createFeedbackTextEditor(feedback, {
        save: feedbackHtml => saveSummary({ feedbackHtml }),
      }) : null;
      const showReport = () => {
        if (detail.open && !reportView.hasChildNodes()) {
          window.teacherReportFiles.renderFeedbackReportView?.(reportView, report, feedback, { preferText: true, saveSummary });
        }
      };
      const openFeedbackEditor = () => {
        if (busy) return;
        detail.open = true;
        showReport();
        reportView.querySelector('[data-feedback-view="text"]')?.click();
        textEditor?.start();
      };
      const openReportEditor = () => {
        if (busy) return;
        detail.open = true;
        showReport();
        reportView.querySelector('[data-feedback-view="report"]')?.click();
        reportView.querySelector('[data-summary-edit]:not([hidden])')?.click();
      };
      if (report.feedback?.engine) {
        const editReport = document.createElement('button');
        editReport.type = 'button';
        editReport.className = 'btn';
        editReport.textContent = '보고서 문장 수정';
        editReport.setAttribute('aria-label', report.student.이름 + ' 보고서 문장 수정과 선생님 한마디');
        editReport.addEventListener('click', openReportEditor);
        feedback.addEventListener('reportviewchange', () => {
          const label = feedback.hidden ? '보고서 수정' : '분석 수정';
          editAnalysis.textContent = label;
          editAnalysis.setAttribute('aria-label', report.student.이름 + ' ' + label);
          editReport.hidden = feedback.hidden;
        });
        header.append(editReport);
      }
      detail.addEventListener('toggle', () => {
        report.expanded = detail.open;
        showReport();
      });
      showReport();
      item.append(header, detail);
      return item;
    }));
  }

  function clearPreview() {
    previewVersion++;
    $('batchPdfFrame').hidden = true;
    $('batchPdfFrame').removeAttribute('src');
    $('batchPdfOpen').hidden = true;
    $('batchPdfOpen').removeAttribute('href');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  }

  async function openPreview(report, isCurrent = () => reports.includes(report)) {
    if (busy || !isCurrent()) return;
    clearPreview();
    const version = previewVersion;
    $('batchPdfTitle').textContent = report.student.이름 + ' 이미지 PDF 미리보기';
    $('batchPdfPeriod').textContent = report.start + ' ~ ' + report.end;
    $('batchPdfStatus').textContent = 'PDF를 만드는 중입니다.';
    if (!previewDialog.open) previewDialog.showModal();
    try {
      const [file] = await output.prepare(report);
      if (version !== previewVersion || !previewDialog.open) return;
      if (!isCurrent()) { previewDialog.close(); return; }
      previewUrl = URL.createObjectURL(new Blob([file.bytes], { type: 'application/pdf' }));
      $('batchPdfFrame').src = previewUrl;
      $('batchPdfFrame').hidden = false;
      $('batchPdfOpen').href = previewUrl;
      $('batchPdfOpen').hidden = false;
      $('batchPdfStatus').textContent = 'PDF가 보이지 않으면 새 탭에서 열 수 있습니다.';
    } catch {
      if (version === previewVersion && previewDialog.open) {
        if (!isCurrent()) { previewDialog.close(); return; }
        $('batchPdfStatus').textContent = 'PDF를 열 수 없습니다. 창을 닫고 미리보기를 다시 눌러 주세요.';
      }
    }
  }

  async function analyze() {
    if (!hasReportOwnerData) {
      status.textContent = '학생 이름이 포함된 최신 기록이 필요합니다. 데이터 새로고침 후 다시 시도해 주세요.';
      return;
    }
    let range;
    try { range = period(reportStart, reportEnd); }
    catch (error) { status.textContent = error.message; return; }
    clearReports('학생 기록을 분석하는 중입니다.');
    busy = true;
    updateActions();
    try {
      const dates = getCustomRange(range.start, range.end);
      const students = matchingStudents().filter(student => selected.has(studentKey(student)));
      const prepared = students.map(student => prepareReport(student, dates));
      const thresholds = getCafThresholds();
      const mode = aiMode.checked ? 'ai' : 'rule';
      const reportMode = $('batchFinalMode')?.checked ? 'final' : 'ongoing';
      let verification;
      // Small requests stay within the API body limit even for a full year of daily records.
      const chunkSize = 12;
      for (let i = 0; i < prepared.length; i += chunkSize) {
        const chunk = prepared.slice(i, i + chunkSize);
        try {
          const response = await requestAnalysis(chunk, range.start, range.end, mode, thresholds, reportMode, true);
          verification = response.aiVerification || verification;
          for (const [index, report] of chunk.entries()) {
            const result = response.reports[index];
            if (!result?.analysis || result.studentId !== report.student.학번) {
              reports.push({ student: report.student, error: result?.error || '분석 결과를 확인할 수 없습니다.' });
              continue;
            }
            reports.push({ ...report, ...range, analysis: result.analysis, feedback: result.feedback, edited: Boolean(result.feedback?.summaryEdit) });
          }
        } catch (error) {
          reports.push(...chunk.map(report => ({ student: report.student, error: error.message || '분석에 실패했습니다.' })));
        }
        status.textContent = '처리 중 ' + reports.length + '/' + prepared.length + '명';
      }
      const ready = reports.filter(report => !report.error).length;
      const aiCount = reports.filter(report => report.feedback?.mode === 'ai').length;
      status.textContent = range.start + ' ~ ' + range.end + ' · ' + ready + '/' + reports.length + '명 준비 완료'
        + (ready < reports.length ? '. 실패한 학생은 아래에서 확인해 주세요.' : '');
      if (mode === 'ai' && ready) {
        const checks = {
          missing_key: '키 설정 확인 필요',
          authentication_failed: 'OpenAI 인증 확인 필요',
          organization_unavailable: 'OpenAI 조직 확인 필요',
          synthetic_failed: '가상 기록 검증 실패',
          connection_failed: 'OpenAI 연결 확인 필요',
          reflection_failed: 'AI 돌아보기 응답을 확인할 수 없음',
          reflection_no_facts: 'AI로 다듬을 돌아보기 기록이 없음',
        };
        const org = verification?.organization ? ' · 조직 ' + verification.organization : '';
        const reasons = {
          invalid_api_key: '키가 유효하지 않음',
          insufficient_quota: 'API 사용 한도 또는 결제 확인 필요',
          model_not_found: '모델 사용 권한 확인 필요',
          rate_limit_exceeded: '요청 한도 초과',
        };
        const reason = reasons[verification?.reason] || (verification?.status ? 'HTTP ' + verification.status : '');
        status.textContent += verification?.state === 'reflection_refined'
          ? '\n돌아보기 문장 AI 적용 ' + aiCount + '/' + ready + '명' + (aiCount < ready ? ' · 나머지는 규칙 기반' : '')
          : verification?.state === 'verified'
          ? '\nOpenAI 인증·가상 기록 검증 완료' + org + ' · AI 적용 ' + aiCount + '/' + ready + '명'
          : '\n' + (checks[verification?.state] || 'AI 연결 확인 필요') + org + (reason ? ' · ' + reason : '') + ' · 규칙 기반으로 분석했습니다.';
      }
      renderResults();
    } catch (error) {
      status.textContent = error.message || '분석에 실패했습니다.';
    } finally {
      busy = false;
      updateActions();
    }
  }

  async function processReports(kind) {
    const send = kind === 'send';
    const ready = reports.filter(report => !report.error && (!send || !report.delivered));
    if (busy || !ready.length) return;
    const { start, end } = ready[0];
    if (send && !window.confirm(start + ' ~ ' + end + ' PDF를 ' + ready.length + '명의 학생 메시지함에 보낼까요?')) return;
    busy = true;
    updateActions();
    const files = [], failed = [];
    try {
      for (const [index, report] of ready.entries()) {
        status.textContent = (send ? 'PDF 전송' : kind === 'images' ? '이미지 생성' : '이미지 PDF 생성') + ' 중 ' + (index + 1) + '/' + ready.length + '명';
        try {
          const rendered = await output.prepare(report, kind === 'images' ? 'images' : 'pdf');
          if (send) {
            await call('sendPrivateTeacherReport', output.deliveryRequest(report, rendered[0], report.deliveryId));
            report.delivered = true;
            report.sendError = false;
          } else {
            files.push(...rendered);
          }
        } catch {
          failed.push(report.student.학번 + ' ' + report.student.이름);
          if (send) report.sendError = true;
        }
      }
      if (!send) {
        clearZip();
        if (files.length) {
          zipFile.href = URL.createObjectURL(createPdfZip(files));
          zipFile.download = (kind === 'images' ? '기록_요약_이미지_' : '기록_요약_PDF_') + start + '_' + end + '.zip';
          zipFile.hidden = false;
          zipFile.click();
        }
      }
      const count = ready.length - failed.length;
      status.textContent = (send ? '전송 완료 ' : 'ZIP에 포함 ') + count + '/' + ready.length + '명'
        + (failed.length ? '\n실패 · ' + failed.join(', ') + '\n같은 버튼으로 다시 시도할 수 있습니다.' : '');
      if (send) {
        renderResults();
        if (count) loadSentMessages();
      }
    } catch (error) {
      status.textContent = error.message || 'PDF 처리를 완료하지 못했습니다.';
    } finally {
      busy = false;
      updateActions();
    }
  }

  function showGoalError(error) {
    const errors = error.errors || [];
    goalStatus.textContent = errors.length
      ? '확인이 필요한 행 ' + errors.length + '개\n' + errors.slice(0, 20).map(item => item.line + '행 · ' + item.error).join('\n')
        + (errors.length > 20 ? '\n외 ' + (errors.length - 20) + '개' : '')
      : error.message || '목표를 확인하지 못했습니다.';
  }

  async function previewGoals() {
    pendingGoals = null;
    updateActions();
    const file = goalFile.files[0];
    if (!file) { goalStatus.textContent = ''; return; }
    busy = true;
    updateActions();
    try {
      const range = period(goalStart, goalEnd);
      if (file.size > 512 * 1024) throw new Error('512KB 이하의 CSV를 선택해 주세요.');
      const bytes = await file.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('euc-kr').decode(bytes); }
      const goals = parseGoalCsv(text);
      const request = { ...range, goals, uploadId: crypto.randomUUID() };
      const result = await call('saveTeacherClassGoals', { ...request, preview: true });
      pendingGoals = request;
      goalStatus.textContent = result.count + '명 명단 확인 완료 · ' + range.start + ' ~ ' + range.end + '\n'
        + goals.slice(0, 8).map(row => row.studentId + ' ' + row.studentName + ' · ' + row.goal.replace(/\s+/g, ' ').slice(0, 80)).join('\n')
        + (result.count > 8 ? '\n외 ' + (result.count - 8) + '명' : '');
    } catch (error) { showGoalError(error); }
    finally { busy = false; updateActions(); }
  }

  async function saveGoals() {
    if (!pendingGoals) return;
    busy = true;
    updateActions();
    try {
      const result = await call('saveTeacherClassGoals', pendingGoals);
      goalStatus.textContent = result.count + '명의 수업 목표를 저장했습니다.';
      pendingGoals = null;
      goalFile.value = '';
      clearReports('목표가 변경되었습니다. 학생 분석을 다시 실행해 주세요.');
    } catch (error) { showGoalError(error); }
    finally { busy = false; updateActions(); }
  }

  for (const input of [grade, room]) input.addEventListener('change', () => { clearReports(); refresh(); });
  for (const input of [reportStart, reportEnd]) input.addEventListener('change', () => clearReports());
  for (const input of [$('batchRuleMode'), aiMode, $('batchFinalMode')]) input?.addEventListener('change', () => {
    const final = $('batchFinalMode')?.checked;
    $('batchReportRun').textContent = final ? '📊 마무리 피드백 만들기' : '📊 피드백 만들기';
    const heading = $('batchResultHeading');
    if (heading) heading.textContent = final ? '📊 마무리 피드백 결과' : '📊 피드백 결과';
    clearReports();
  });
  all.addEventListener('change', () => {
    selected.clear();
    if (all.checked) for (const student of matchingStudents()) selected.add(studentKey(student));
    clearReports();
    refresh();
  });
  for (const input of [goalFile, goalStart, goalEnd]) input.addEventListener('change', previewGoals);
  $('batchGoalTemplate').addEventListener('click', () => saveFile(
    new Blob(['\uFEFF' + goalColumns.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }), '수업_목표_업로드_양식.csv'));
  goalSave.addEventListener('click', saveGoals);
  $('batchReportRun').addEventListener('click', analyze);
  zipButton.addEventListener('click', () => processReports('pdf'));
  imageZipButton.addEventListener('click', () => processReports('images'));
  sendButton.addEventListener('click', () => processReports('send'));
  $('batchPdfClose').addEventListener('click', () => previewDialog.close());
  previewDialog.addEventListener('close', () => { if (!previewDialog.open) clearPreview(); });
  reportStart.value = goalStart.value = getLastNDates(today, 7)[0];
  reportEnd.value = goalEnd.value = today;
  window.teacherBatchReports = { refresh, analyzeStudent,
    previewIndividual: (report, isCurrent) => openPreview(report, isCurrent) };
}());
