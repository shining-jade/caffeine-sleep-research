(function installReportFiles() {
  'use strict';

  const goalColumns = ['학번', '이름', '목표', '카페인 상한(mg)', '최소 수면(시간)', '목표 취침(HH:MM)', '목표 기상(HH:MM)'];

  function parseGoalCsv(text) {
    const rows = [];
    let row = [], field = '', state = 'start';
    const finishField = () => { row.push(field.trim()); field = ''; state = 'start'; };
    const finishRow = () => { finishField(); rows.push(row); row = []; };
    const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (state === 'quoted') {
        if (char !== '"') field += char;
        else if (input[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else if (char === ',') finishField();
      else if (char === '\n') finishRow();
      else if (state === 'start' && char === '"') state = 'quoted';
      else {
        if (state === 'closed' || char === '"') throw new Error('CSV의 따옴표를 확인해 주세요.');
        field += char;
        state = 'plain';
      }
    }
    if (state === 'quoted') throw new Error('CSV에 닫히지 않은 따옴표가 있습니다.');
    if (row.length || state !== 'start') finishRow();
    const header = rows.shift() || [];
    if (!goalColumns.slice(0, 3).every(name => header.includes(name)) || new Set(header).size !== header.length) {
      throw new Error('양식의 학번·이름·목표 열을 확인해 주세요.');
    }
    const goals = rows.flatMap((values, index) => {
      if (!values.some(Boolean)) return [];
      if (values.length > header.length) throw new Error((index + 2) + '번째 데이터 행의 열 수를 확인해 주세요.');
      const get = position => values[header.indexOf(goalColumns[position])] || '';
      const number = position => {
        const value = get(position);
        if (!value) return null;
        if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error((index + 2) + '번째 데이터 행의 숫자 항목을 확인해 주세요.');
        return Number(value);
      };
      return [{ line: index + 2, studentId: get(0), studentName: get(1), goal: get(2),
        caffeineMax: number(3), sleepMin: number(4), bedtime: get(5), wakeTime: get(6) }];
    });
    if (goals.length < 1 || goals.length > 500) throw new Error('CSV에 목표를 1~500개 넣어 주세요.');
    return goals;
  }

  // ZIP store mode keeps the already compressed PDFs as-is and preserves Korean filenames.
  function createPdfZip(files) {
    const encoder = new TextEncoder();
    const table = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
      return value;
    });
    const local = [], directory = [];
    let offset = 0, directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = file.bytes;
      let crc = 0xffffffff;
      for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
      crc = (crc ^ 0xffffffff) >>> 0;
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x800, true);
      header.setUint16(12, 33, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, data.length, true);
      header.setUint32(22, data.length, true);
      header.setUint16(26, name.length, true);
      local.push(header.buffer, name, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      new Uint8Array(entry.buffer, 6, 26).set(new Uint8Array(header.buffer, 4, 26));
      entry.setUint32(42, offset, true);
      directory.push(entry.buffer, name);
      offset += header.byteLength + name.length + data.length;
      directorySize += entry.byteLength + name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...local, ...directory, end.buffer], { type: 'application/zip' });
  }

  async function loadReportPdf(report, render) {
    if (report.file) return report.file;
    if (!report.pdfPending) {
      report.pdfPending = Promise.resolve().then(async () => {
        const result = await render({ html: report.html, fileName: report.fileName });
        const bytes = Uint8Array.from(atob(result.pdf), character => character.charCodeAt(0));
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('PDF 형식을 확인할 수 없습니다.');
        report.file = { name: result.fileName || report.fileName, bytes };
        return report.file;
      }).finally(() => { report.pdfPending = null; });
    }
    return report.pdfPending;
  }

  function renderFeedback(target, feedback, fallback = '', showMetrics = true) {
    const savedHtml = feedback?.summaryEdit?.feedbackHtml;
    if (typeof savedHtml === 'string') {
      target.innerHTML = window.safeRender.sanitizeRichHtml(savedHtml, { feedback: true });
      return;
    }
    if (!Array.isArray(feedback?.sections)) {
      const legacy = document.createElement('p');
      legacy.className = 'report-feedback-legacy';
      legacy.textContent = fallback;
      target.replaceChildren(legacy);
      return;
    }
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text) element.textContent = text;
      return element;
    };
    const result = node('div', 'report-feedback');
    if (feedback.mode) {
      const mode = feedback.aiFallback ? 'AI 분석을 사용할 수 없어 규칙 기반으로 분석했어요.'
        : feedback.mode === 'ai' ? (feedback.summaryReflection ? 'AI 분석 · 돌아보기 문장 다듬기'
          : feedback.engine ? 'AI 분석 · 설명 문장 다듬기' : 'AI 분석 · 실천 제안 우선순위 반영') : '규칙 기반 분석';
      const periodMode = feedback.reportMode === 'final' ? '마무리 분석 · ' : feedback.reportMode === 'ongoing' ? '진행 분석 · ' : '';
      result.append(node('p', 'report-feedback-mode', periodMode + mode));
    }
    if (feedback.summary) result.append(node('p', 'report-feedback-lead', feedback.summary));
    const tones = { caffeine: '카페인', sleep: '수면', habit: '생활습관', goal: '내 목표', next: '실천 제안' };
    for (const section of feedback.sections) {
      const tone = Object.hasOwn(tones, section.tone) ? section.tone : '';
      const card = node('section', 'report-feedback-card' + (tone ? ' report-feedback-' + tone : ''));
      card.append(node('h4', 'report-feedback-title', (typeof section.icon === 'string' && section.icon ? section.icon + ' ' : '') + section.title));
      const metrics = showMetrics && (tone === 'caffeine' || tone === 'sleep')
        ? (feedback.metrics || []).filter(item => tone === 'caffeine' ? item.label === '카페인' : item.label !== '카페인') : [];
      if (metrics.length) {
        const row = node('div', 'report-feedback-metrics');
        for (const metric of metrics) {
          const item = node('div', 'report-feedback-metric');
          item.append(node('div', 'report-feedback-label', metric.label + ' 평균'),
            node('strong', 'report-feedback-value', metric.value),
            node('small', 'report-feedback-detail', metric.detail));
          row.append(item);
        }
        card.append(row);
      }
      const items = node('ul', 'report-feedback-items');
      for (const text of section.items) items.append(node('li', '', text));
      card.append(items);
      result.append(card);
    }
    for (const note of [feedback.note, feedback.reference]) {
      if (note) result.append(node('p', 'report-feedback-note', note));
    }
    if (Array.isArray(feedback.sources) && feedback.sources.length) {
      const sources = node('div', 'report-feedback-note');
      sources.append(node('strong', '', '참고 문헌'));
      const list = node('ul', 'report-feedback-sources');
      for (const source of feedback.sources) {
        if (!source?.label || !/^https:\/\/[^\s]+$/i.test(source.url)) continue;
        const item = node('li', '');
        const link = node('a', '', source.label);
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
        list.append(item);
      }
      if (list.childElementCount) {
        sources.append(list);
        result.append(sources);
      }
    }
    target.replaceChildren(result);
  }

  function renderSavedFeedback(target, text) {
    const headings = new Map([
      ['카페인', 'caffeine'], ['☕ 카페인', 'caffeine'], ['수면', 'sleep'], ['😴 수면', 'sleep'],
      ['수면에 영향을 줄 수 있는 생활습관', 'habit'],
      ['실천 제안', 'next'], ['💡 실천 제안', 'next'],
      ['기록 습관', 'habit'], ['내 목표', 'goal'], ['기간의 처음과 끝', 'sleep'],
      ['첫째 주와 둘째 주', 'sleep'], ['이번 기록에서 찾은 것', 'sleep'], ['비교해 본 기록', 'sleep'],
      ['왜 그럴까', 'caffeine'], ['알아 두면 좋아요', 'caffeine'],
      ['이번 주 해 볼 것', 'next'], ['앞으로 이어 갈 한 가지', 'next'],
    ]);
    const sections = [], intro = [], sources = [];
    let section;
    for (const row of text.split(/\r?\n/)) {
      const line = row.trim();
      if (!line) continue;
      const reference = line.match(/^참고 · (.+) (https:\/\/[^\s<>]+)$/i);
      if (reference) {
        sources.push({ label: reference[1], url: reference[2] });
        continue;
      }
      // Saved reports may carry a fixed heading icon before the section name.
      const bare = line.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
      const tone = headings.get(line) || headings.get(bare)
        || (bare.startsWith('수업 목표 · ') || bare.startsWith('내 목표 · ') ? 'goal' : '');
      if (tone) {
        section = { title: line, tone, items: [] };
        sections.push(section);
      } else {
        (section?.items || intro).push(line);
      }
    }
    const isCurrent = sections.some(item => item.title.endsWith('기록 습관'))
      && sections.some(item => item.title.endsWith('이번 기록에서 찾은 것') || item.title === '비교해 본 기록');
    if (!isCurrent && (!sections.some(item => item.tone === 'caffeine') || !sections.some(item => item.tone === 'sleep'))) return false;
    renderFeedback(target, { summary: intro.join(' '), sections, sources }, '', false);
    return true;
  }

  function readSavedPdfFeedback(target) {
    const ids = new Map([
      ['기록 습관', 'record'], ['내 목표', 'goals'], ['기간의 처음과 끝', 'transition'], ['첫째 주와 둘째 주', 'transition'],
      ['이번 기록에서 찾은 것', 'findings'], ['비교해 본 기록', 'similar'], ['왜 그럴까', 'why'], ['알아 두면 좋아요', 'why'],
      ['이번 주 해 볼 것', 'action'], ['앞으로 이어 갈 한 가지', 'action'],
    ]);
    const sections = Array.from(target.querySelectorAll('.report-feedback-card'), card => {
      const title = card.querySelector('.report-feedback-title')?.textContent.trim()
        .replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
      const id = ids.get(title) || (/^(내 목표|수업 목표) · /.test(title) ? 'goals' : undefined);
      const items = Array.from(card.querySelectorAll('.report-feedback-items li'), item => item.textContent.trim()).filter(Boolean);
      return { id, items };
    }).filter(section => section.id && section.items.length);
    if (!sections.length) return { sections, legacyText: target.innerText.trim() };
    const summary = target.querySelector('.report-feedback-lead')?.textContent.trim()
      .replace(/^(?:(?:진행|마무리) 분석 · )?(?:규칙 기반 분석|AI 분석 · 설명 문장 다듬기|AI 분석을 사용할 수 없어 규칙 기반으로 분석했어요\.)\s*/, '');
    const sources = Array.from(target.querySelectorAll('.report-feedback-sources a'), link => link.href);
    return { sections, summary, sources };
  }

  const pdfText = value => String(value ?? '—').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const pdfDay = date => date.slice(5).replace('-', '.');
  const pdfShiftDate = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  // The engine groups each sleep episode under the day before its actual wake date.
  const pdfWakeDate = day => pdfShiftDate(day.date, 1);
  const pdfClock = min => min == null ? '시각 미상' :
    String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  const pdfParagraphs = items => (items || []).map(item => '<p>' + pdfText(item) + '</p>').join('');
  const pdfShort = (value, max) => typeof value === 'string' && value.length > max ? value.slice(0, max).trimEnd() + '…' : value;
  const pdfCard = (title, body, tone = '', icon = '') => '<section class="goal-card ' + tone + '"><h2>' + icon + pdfText(title) + '</h2>' + body + '</section>';
  const pdfIdeaIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" style="display:inline-block;vertical-align:-2px;margin-right:4px" aria-hidden="true"><path d="M8 1.5a4.5 4.5 0 0 0-3 7.9c.6.6.9 1.2.9 2h4.2c0-.8.3-1.4.9-2A4.5 4.5 0 0 0 8 1.5Z" fill="#f5d572" stroke="#875817"/><path d="M6 13h4m-3 1.5h2" stroke="#875817" stroke-linecap="round"/></svg>';

  function pdfTable(headings, rows, cards = false, groups) {
    if (!rows.length) return '<p>기록 없음</p>';
    if (cards) return rows.map(row => {
      const field = i => '<div><dt>' + pdfText(headings[i]) + '</dt><dd>' + pdfText(row[i]) + '</dd></div>';
      if (groups) return '<div class="goal-sleep-record">' + groups.map(group =>
        '<dl class="goal-record-group">' + group.map(field).join('') + '</dl>').join('') + '</div>';
      return '<dl class="goal-record' + (row[1] === '미기록' ? ' missing' : '') + '">' + headings.map((_, i) => field(i)).join('') + '</dl>';
    }).join('');
    return '<table><thead><tr>' + headings.map(heading => '<th>' + pdfText(heading) + '</th>').join('') + '</tr></thead><tbody>'
      + rows.map(row => '<tr' + (row[1] === '미기록' ? ' class="missing"' : '') + '>' + row.map(cell => '<td>' + pdfText(cell) + '</td>').join('') + '</tr>').join('')
      + '</tbody></table>';
  }

  function pdfBedtimePlot(series, phone) {
    const days = series.days.slice(phone ? -14 : -21);
    if (!days.length) return '<p>기록 없음</p>';
    // 한 칸 = 수면 대상일(그날 밤). 취침 시각과 다음 날 아침 컨디션을 같은 칸에 놓는다.
    const dates = days.map(day => day.date);
    const width = phone ? 330 : 690;
    const spacing = (width - 61) / Math.max(1, dates.length - 1);
    const x = i => 39 + i * spacing;
    const y = min => 12 + (Math.min(1620, Math.max(1260, min)) - 1260) / 5;
    const line = (left, top, right, bottom, color) => `<line x1="${left}" y1="${top}" x2="${right}" y2="${bottom}" stroke="${color}" />`;
    const label = (left, top, value, color = '#41516a') => `<text x="${left}" y="${top}" font-size="9" fill="${color}">${pdfText(value)}</text>`;
    const guides = [1260, series.midnight, 1620].map(min => line(32, y(min), width - 10, y(min), '#d7dce8') + label(1, y(min) + 3, pdfClock(min))).join('');
    const targets = series.target.filter(target => Number.isFinite(target.minutes)).map(target => {
      const applicable = days.map((day, i) => ({ date: day.date, i })).filter(day => day.date >= target.start && day.date <= target.end);
      return applicable.length ? line(x(applicable[0].i), y(target.minutes), Math.max(x(applicable[0].i) + 6, x(applicable.at(-1).i)), y(target.minutes), '#ac6948') : '';
    }).join('');
    const points = days.map((day, i) => {
      const previous = days[i - 1];
      const bed = day.bed === null ? (day.open ? label(x(i) - 8, 95, '아직') : label(x(i) - 2, 95, '–')) :
        (previous?.bed != null ? line(x(i - 1), y(previous.bed), x(i), y(day.bed), '#655ab5') : '')
        + `<circle cx="${x(i)}" cy="${y(day.bed)}" r="3" fill="#655ab5" />`;
      const wakeDate = pdfWakeDate(day);
      const score = day.condition == null ? (day.open ? '' : label(x(i) - 2, 127, '–'))
        : `<rect x="${x(i) - 3}" y="${129 - day.condition * 5}" width="6" height="${day.condition * 5}" fill="#4c9780" data-sleep-date="${pdfText(day.date)}" data-wake-date="${pdfText(wakeDate)}"><title>${pdfDay(day.date)} 밤 수면 → 다음 날(${pdfDay(wakeDate)}) 아침 컨디션 ${day.condition}점</title></rect>`;
      return bed + score;
    }).join('');
    const last = dates.length - 1;
    const step = Math.ceil(30 / spacing);
    const dateLabels = dates.map((date, i) => i === 0 || i === last || (i % step === 0 && (last - i) * spacing >= 30)
      ? label(x(i) - 10, 146, pdfDay(date)) : '').join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 152" width="100%" role="img" aria-label="그날 밤 취침 시각과 다음 날 아침 컨디션">${guides}${targets}${label(1, 118, '컨디션')}${points}${dateLabels}</svg>`
      + '<small>날짜는 그날 밤(수면 대상일)이에요. 보라색 점은 그날 밤에 잠자리에 든 시각이고, 자정을 넘겨 잠자리에 든 시각도 전날 밤에 표시해요. 초록색 막대는 같은 칸의 잠을 자고 일어난 다음 날 아침 컨디션(1~5점), 갈색 선은 목표 취침 시각이에요. –는 기록이 없음, ‘아직’은 아직 지나지 않은 밤이에요. 21시 전이나 03시 후에 잠자리에 든 시각은 그래프 끝에 표시해요.</small>'
      + (days.length < series.days.length ? '<p>최근 ' + days.length + '일의 밤 기록과 다음 날 컨디션을 표시했어요.</p>' : '');
  }

  function pdfCaffeinePlot(days, phone) {
    const visible = days.slice(phone ? -9 : -12);
    const width = phone ? 330 : 690;
    const x = min => 49 + (min - 360) * (width - 64) / 1080;
    const height = 26 + visible.length * 13;
    const marks = [360, 720, 1080, 1440].map(min =>
      `<text x="${x(min) - 7}" y="12" font-size="9">${min / 60}시</text>`).join('');
    const rows = visible.map((day, i) => {
      const y = 24 + i * 13;
      return `<text x="3" y="${y + 3}" font-size="9">${pdfDay(day.date)}</text><line x1="47" y1="${y}" x2="${width - 11}" y2="${y}" stroke="#dfe4eb" />`
        + day.intakes.filter(intake => intake.time !== null && intake.time >= 360 && intake.mg > 0).map(intake =>
          `<circle cx="${x(intake.time)}" cy="${y}" r="${Math.min(6, Math.sqrt(intake.mg) / 3)}" fill="#c97949" />`).join('');
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="날짜별 카페인 섭취 시각"><rect x="${x(1080)}" width="${width - x(1080)}" height="${height}" fill="#fff1e5" />${marks}${rows}</svg>`
      + '<small>주황색 영역은 18시 이후예요. 원이 클수록 카페인 양이 많아요. 06시 이전 섭취와 시각 미상은 아래 기록표에 따로 표시해요. 최근 ' + visible.length + '일을 표시했어요.</small>';
  }

  function buildGoalPdfDocument(report, options, layout) {
    const { feedback, student, start, end, awards } = report;
    const { engine } = feedback;
    const phone = layout === 'phone';
    const screen = layout === 'screen';
    const find = id => engine.findings.find(finding => finding.id === id);
    const saved = feedback.savedPdfFeedback;
    const section = id => {
      const items = (saved?.sections || feedback.sections).filter(item => item.id === id).flatMap(item => item.items);
      return items.length ? items : undefined;
    };
    const used = new Set();
    const goals = find('goalProgress').data.goals;
    const standards = find('healthStandards');
    const sleep = find('bedtimeSeries').data;
    const caffeine = find('caffeineSummary').data;
    const displayDays = sleep.days.slice(phone ? -7 : -14);
    const dateSet = new Set(displayDays.map(day => day.date));
    const goalsShown = (goals.length ? goals : standards.data.rows).slice(0, phone ? 3 : 5);
    const openDates = new Set(sleep.days.filter(day => day.open).map(day => day.date));
    const mark = (decision, date) => decision === true ? '✓' : decision === false ? '×' : openDates.has(date) ? '아직' : '–';
    const markSummary = goal => goal.source === 'class' && !goal.criterion ? '앱 기록으로 확인할 수 없는 목표예요.'
      : goal.measured ? goal.kept + ' / ' + goal.measured + '일' : '확인할 기록 없음';
    const calendar = '<div class="goal-calendar">' + displayDays.map(day => {
      const decision = goals[0]?.days.find(item => item.date === day.date)?.kept;
      return '<span class="score-' + (day.condition ?? 0) + '" data-mark="' + mark(decision, day.date) + '">'
        + pdfDay(day.date) + '<br>' + (day.condition == null ? (day.open ? '아직' : '–') : day.condition + '점')
        + (goals.length ? ' ' + mark(decision, day.date) : '') + '</span>';
    }).join('') + '</div><small>날짜는 그날 밤(수면 대상일), 점수는 그 잠을 자고 일어난 다음 날 아침 컨디션이에요.'
      + (goals.length ? ' 목표 표시도 같은 날짜 기준이에요. ✓ 지킴, × 못 지킴, – 확인할 기록 없음 또는 목표 기간 외, ‘아직’ 지나지 않은 밤.' : ' – 컨디션 기록 없음, ‘아직’ 지나지 않은 밤.') + '</small>';
    const mainGoal = goals[0];
    const percent = mainGoal?.measured ? Math.round(mainGoal.rate * 100) : null;
    const ring = percent === null ? '' : '<svg class="goal-ring" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" aria-label="목표 달성 '
      + percent + '%"><circle cx="26" cy="26" r="21" fill="none" stroke="#ddd8ee" stroke-width="4" />'
      + '<circle cx="26" cy="26" r="21" fill="none" stroke="#7265b5" stroke-width="4" pathLength="100" stroke-dasharray="'
      + percent + ' 100" transform="rotate(-90 26 26)" /><text x="26" y="30" font-size="12" text-anchor="middle" fill="#283651">'
      + percent + '%</text></svg>';
    const recordCard = options.includeAi && section('record') ? pdfCard('기록 습관', pdfParagraphs(section('record')), 'mint') : '';
    const goalCard = options.includeAi ? pdfCard(mainGoal ? '내 목표' : section('findings') ? '이번 기록에서 찾은 것' : '아침 컨디션 기록', ring
      + (mainGoal ? pdfParagraphs((section('goals') || []).slice(0, phone ? 1 : 5).map(item => pdfShort(item, 230))) : pdfParagraphs(section('findings')))
      + calendar, 'lavender') : '';
    const transition = options.includeAi && section('transition') ? pdfCard('기간의 처음과 끝', pdfParagraphs(section('transition').slice(0, phone ? 1 : 2))) : '';
    const action = options.includeAi && section('action') ? pdfCard(engine.mode === 'final' ? '앞으로 이어 갈 한 가지' : '이번 주 해 볼 것', pdfParagraphs(section('action')), 'mint') : '';
    if (!goals.length) used.add('healthStandards');
    const check = pdfCard(goals.length ? '목표 체크표' : '건강 기준 체크',
      pdfTable(['항목', '확인 결과', '최근 ' + displayDays.length + '일'], goalsShown.map(goal => [
        pdfShort(goal.label, phone ? 40 : 72), markSummary(goal), goal.days.filter(day => dateSet.has(day.date)).map(day => pdfDay(day.date) + ' ' + mark(day.kept, day.date)).join('  '),
      ])) + (goals.length > goalsShown.length ? '<small>이 표에는 처음 ' + goalsShown.length + '개 목표를 표시했어요.</small>' : '')
      + (goalsShown.some(goal => goal.source === 'class' && !goal.criterion) ? '<p>목표를 지키기 쉬웠던 날에는 무엇을 했나요?</p>' : ''));
    const late = find('lateCaffeine');
    const habitComparisons = [
      [late, '저녁 6시 이후 카페인', late.data.byClock.metrics.condition],
      ...[['phoneBeforeBed', '자기 전 스마트폰 30분'], ['midnightBedtime', '자정 전 취침'], ['eightHours', '잠자리에 있던 시간 8시간'], ['activity', '신체활동 30분']]
        .map(([id, label]) => [find(id), label, find(id).data.condition]),
    ];
    const visible = habitComparisons.filter(([, , metric]) => metric.result !== 'notEnough');
    const missing = habitComparisons.filter(([, , metric]) => metric.result === 'notEnough');
    const conditionBars = options.includePattern ? visible.map(([finding, label, metric]) => {
      used.add(finding.id);
      const delta = metric.delta;
      const detail = metric.groups.map(group => group.label + ' ' + group.n + '일 평균 ' + group.mean + '점').join(' · ');
      return '<div class="goal-comparison"><strong>' + pdfText(label) + '</strong> <span class="goal-comparison-value">'
        + '<span class="goal-difference" aria-hidden="true"><span class="' + (delta < 0 ? 'lower' : 'higher')
        + '" style="width:' + Math.abs(delta) * 12.5 + '%"></span></span><small>차이 '
        + pdfText((delta > 0 ? '+' : '') + delta + '점') + '</small></span><div>' + pdfText(detail) + '</div></div>';
    }).join('') : '';
    const omittedHabits = missing.length ? '<small>비교에서 빠진 항목 · ' + pdfText(missing.map(([, label]) => label).join(', '))
      + '. ' + pdfText(missing[0][2].reason) + '</small>' : '';
    const habitCard = options.includePattern ? pdfCard('어떤 날 아침 컨디션이 달랐을까',
      (conditionBars || '<p>비교할 기록이 충분하지 않았어요.</p>') + omittedHabits, 'lavender') : '';
    const bedCard = options.includeMainChart ? pdfCard('잠자리에 든 시각과 아침 컨디션', pdfBedtimePlot(sleep, phone)) : '';
    const findingsCard = options.includeAi && mainGoal && section('findings') ? pdfCard('이번 기록에서 찾은 것', pdfParagraphs(section('findings'))) : '';
    const similarCard = options.includeAi && section('similar') ? pdfCard('비교해 본 기록', pdfParagraphs(section('similar'))) : '';
    const whyCard = options.includeAi && section('why') ? pdfCard('알아 두면 좋아요', pdfParagraphs(section('why')), '', pdfIdeaIcon) : '';
    if (options.includeAi && !saved) engine.featuredFindingIds.forEach(id => used.add(id));
    const side = find('sideEffect');
    const clockMetrics = late.data.byClock.metrics;
    const sleepMetrics = Object.entries({ bedtime: '잠자리에 든 시각', latencyOver15: '15분 넘게 걸린 날', hours: '잠자리에 있던 시간', condition: '아침 컨디션' });
    const lateRows = sleepMetrics
      .flatMap(([id, label]) => clockMetrics[id].result === 'notEnough' ? [] : [[label, ...clockMetrics[id].groups.map(group =>
        (id === 'latencyOver15' ? group.matches + '일 / ' + group.n + '일'
          : (id === 'bedtime' ? pdfClock(Math.round(group.mean)) : group.mean + group.unit) + ' (' + group.n + '일)'))]]);
    const absentLate = sleepMetrics.filter(([id]) => clockMetrics[id].result === 'notEnough');
    if (options.includePattern && late.text) used.add('lateCaffeine');
    if (options.includePattern && side.text) used.add('sideEffect');
    const caffeineCard = pdfCard('카페인 요약', '<p>카페인 양을 확인한 날의 하루 평균은 ' + (caffeine.meanMg === null ? '확인할 기록 없음' : pdfText(caffeine.meanMg.toFixed(1) + 'mg')) + '</p>'
      + pdfParagraphs(['카페인 없이 보낸 날은 ' + caffeine.counts.zero + '일, 기록이 없는 날은 ' + caffeine.counts.missing
        + '일, 함량을 알 수 없는 날은 ' + caffeine.counts.unknown + '일이에요.']), 'peach');
    const timingCard = options.includeMainChart ? pdfCard('카페인을 언제 마셨나', pdfCaffeinePlot(caffeine.days, phone), 'peach') : '';
    const lateCard = options.includePattern ? pdfCard('저녁 6시 이후 카페인과 그날 밤 수면', (lateRows.length ? pdfTable(['비교 항목', '그 시간에 마신 날', '그 시간에 마시지 않은 날'], lateRows) : '')
      + (absentLate.length ? '<small>' + pdfText((lateRows.length ? '비교에서 빠진 항목 · ' + absentLate.map(([, label]) => label).join(', ') + '. ' : '')
        + clockMetrics[absentLate[0][0]].reason) + '</small>' : '')
      + (late.text ? (lateRows.length ? '' : '<h3>잠자리 전 6시간 안에 마신 기록</h3>') + pdfParagraphs([late.text]) : ''), 'peach') : '';
    const sideLimit = phone ? 2 : 4;
    const sideCard = options.includePattern ? pdfCard('카페인을 마신 뒤 불편했던 점', side.text ? pdfParagraphs([side.text])
      + '<div class="goal-side-table">' + pdfTable(['날짜', '음료', '시각', '불편감'],
        side.data.entries.slice(0, sideLimit).map(item => [pdfDay(item.date), pdfShort(item.drink, phone ? 30 : 40), pdfClock(item.time), pdfShort(item.symptom, phone ? 38 : 55)])) + '</div>'
      + (side.data.entries.length > sideLimit ? '<small>표에는 처음 ' + sideLimit + '건을 표시했어요.</small>' : '') : '<p>불편감을 적은 기록이 없었어요.</p>') : '';
    const quality = find('sleepQuality').data.rows;
    if (options.includePattern) quality.filter(row => row.observed && row.findingId).forEach(row => used.add(row.findingId));
    const cafTable = { title: '카페인 기록표', headings: ['날짜', '상태', '시각', '음료', '함량', '불편감'], rows: [...caffeine.days].reverse()
      .flatMap(day => day.status === 'missing' || day.status === 'zero' ? [[day.date, day.status === 'missing' ? '미기록' : '카페인 없이 보낸 날', '—', '—', day.status === 'zero' ? '0mg' : '—', '—']]
        : day.intakes.map(item => [day.date, day.status === 'unknown' ? '함량 미확인' : '기록 있음',
          item.time !== null && item.time < 360 ? pdfClock(item.time) + ' (06시 전)' : pdfClock(item.time), item.drink, item.mg == null ? '함량 미확인' : item.mg + 'mg', item.symptom])) };
    const sleepTable = { title: '주수면 기록표', headings: ['수면 대상일', '잠자리에 있던 시간', '수면 중 깸', '취침 날짜 · 시각', '잠드는 데 걸린 시간', '기상 날짜 · 시각', '기상 후 컨디션'],
      groups: [[0, 1, 2], [3, 4], [5, 6]], rows: [...sleep.days].reverse()
      .filter(day => day.recorded).map(day => [day.date, day.hours === null ? '—' : day.hours.toFixed(1) + '시간', day.awakenings,
        day.held ? '분석 보류' : day.bed == null ? '시각 미상' : pdfShiftDate(day.date, Math.floor(day.bed / 1440)) + ' ' + pdfClock(day.bed),
        day.latency, pdfWakeDate(day) + ' ' + pdfClock(day.wake), day.condition === null ? '—' : day.condition + '점']) };
    const tables = [options.includeCaffeineRecords && cafTable, options.includeSleepRecords && sleepTable].filter(Boolean);
    const references = new Set(engine.findings.filter(finding => used.has(finding.id)).flatMap(finding => finding.refs));
    const sources = (engine.availableReferences || engine.references).filter(ref => references.has(ref.id)
      || (options.includeAi && saved?.sources?.includes(ref.url)));
    const refCard = sources.length ? pdfCard('참고문헌', '<div class="goal-references">' + sources.map(source =>
      '<a href="' + pdfText(source.url) + '">' + pdfText(source.label) + '</a>').join('') + '</div>') : '';
    const limit = phone ? (sources.length ? 2 : 3) : options.includePattern ? 5 : 9;
    const qualityCard = options.includePattern ? pdfCard('수면의 질과 생활습관', pdfTable(['항목', '이번 기간 응답', '함께 보인 것'],
      quality.map(row => [row.label, row.text, row.observed?.split(/(?<=요\.)\s+/)[0] || '—'])), 'lavender') : '';
    const tableCards = tables.map(table => {
      const rows = table.rows.slice(0, options.maxRecordRows > 0 ? Math.min(limit, options.maxRecordRows) : limit);
      const previewRows = rows.map(row => row.map(value => pdfShort(value, phone ? 38 : 64)));
      return pdfCard(table.title, pdfTable(table.headings, previewRows, phone || screen, table.groups) + (rows.length < table.rows.length
        ? '<small>최근 ' + rows.length + '건을 표시했어요. ' + (table.rows.length - rows.length) + '건은 요약표에서 생략했어요.</small>' : ''));
    });
    const detailed = options.maxRecordRows === 0 && tables.length > 0;
    const title = pdfText(student.이름 + (detailed ? ' 상세 건강 기록' : ' 건강 기록'));
    const header = '<header><h1>' + title + '</h1><p>' + pdfText('학번 ' + student.학번 + ' · ' + (student.학년 || '—') + '학년 ' + (student.반 || '—')
      + '반 ' + (student.번호 || '—') + '번 · ' + start + ' ~ ' + end + ' · ' + (engine.mode === 'final' ? '마무리 분석' : '진행 분석')) + '</p></header>';
    const badgeNames = (awards || []).map(award => award.name).filter(Boolean);
    const savedText = options.includeAi && saved?.legacyText ? pdfCard('교사가 저장한 피드백', pdfParagraphs(saved.legacyText.split('\n').filter(Boolean))) : '';
    const summary = saved ? saved.summary : feedback.summary;
    const memo = options.includeAi && summary ? pdfCard('교사 한 줄 요약', pdfParagraphs([summary])) : '';
    const intro = header + '<p class="goal-badges">부여된 뱃지 · ' + pdfText(badgeNames.join(', ') || '없음') + '</p>' + memo;
    const shortPhone = phone && sleep.days.length < 7;
    const bodies = (detailed ? tables.flatMap(table => {
      const pageSize = phone ? 4 : 14;
      return Array.from({ length: Math.max(1, Math.ceil(table.rows.length / pageSize)) }, (_, index) =>
        pdfCard(table.title + ' 상세 기록', pdfTable(table.headings, table.rows.slice(index * pageSize, (index + 1) * pageSize), phone, table.groups)));
    }) : phone ? [intro + recordCard + goalCard + transition + action, check + habitCard, bedCard + findingsCard + similarCard + whyCard + savedText,
      caffeineCard + timingCard + lateCard, sideCard + qualityCard, tableCards.join('') + (shortPhone ? refCard : ''), shortPhone ? '' : refCard]
      : [intro + recordCard + goalCard + transition + action + check, habitCard + bedCard + findingsCard + similarCard + whyCard + savedText,
        caffeineCard + timingCard + lateCard + sideCard, qualityCard + tableCards.join('') + refCard]).filter(Boolean);
    if (detailed) bodies[0] = header + bodies[0];
    const pages = bodies.map(body => '<article class="goal-page">' + body + '</article>').join('');
    const styles = `@page{size:${phone ? '105mm 185mm' : 'A4'};margin:${phone ? '6mm' : '10mm'};
      @bottom-right{content:counter(page) " / " counter(pages);font:10px sans-serif;color:#475775}}*{box-sizing:border-box}
      body{margin:0;color:#17263b;font:${phone ? '12px/1.35' : '11px/1.42'} "Malgun Gothic","Noto Sans KR",sans-serif;overflow-wrap:anywhere;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      .goal-page{break-after:page;page-break-after:always}.goal-page:last-child{break-after:auto;page-break-after:auto}
      header{border-bottom:2px solid #726ac1;margin-bottom:7px}h1{font-size:22px;margin:0;word-break:keep-all}h2{font-size:15px;margin:0 0 4px}h3{font-size:inherit;margin:5px 0 0}
      p{margin:4px 0}small{font-size:10px;color:#34445e}
      .goal-card{border:1px solid #dbe3ee;border-left:4px solid #8b83cb;background:#f8f9fc;border-radius:8px;padding:7px 10px;margin:0 0 6px}
      .goal-card h2{break-after:avoid;page-break-after:avoid}.goal-card.mint{background:#eaf7f0;border-left-color:#588c72}.goal-card.lavender{background:#f0eefb}.goal-card.peach{background:#fff4ec;border-left-color:#c6855e}
      .goal-ring{width:49px;height:49px;margin:0 7px 4px 0;font-weight:700}
      .goal-calendar span{display:inline-block;background:#eef0f5;border:1px solid #c7cede;border-radius:7px;margin:2px;padding:2px 5px;text-align:center}.goal-calendar [data-mark="✓"]{border:2px solid #478267}.goal-calendar .score-0{border-style:dashed}.goal-calendar .score-1,.goal-calendar .score-2{background:#f8ddd8}.goal-calendar .score-4,.goal-calendar .score-5{background:#d8efe0}
      .goal-comparison{margin:5px 0;break-inside:avoid}.goal-comparison-value{white-space:nowrap}.goal-difference{position:relative;display:inline-block;vertical-align:middle;width:${phone ? '82' : '165'}px;height:8px;margin:0 6px;background:#dfdff0}.goal-difference:after{content:'';position:absolute;left:50%;height:100%;border-left:1px solid #465572}.goal-difference span{position:absolute;height:100%}.goal-difference .lower{right:50%;background:#b56852}.goal-difference .higher{left:50%;background:#4c8471}
      svg{display:block;height:auto;max-width:100%;break-inside:avoid;page-break-inside:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border-bottom:1px solid #e0e5ee;padding:3px 4px;text-align:left;overflow-wrap:anywhere}th{background:#e9e8f8}tr{break-inside:avoid;page-break-inside:avoid}.missing{background:#edf0f3}
      .goal-side-table th:nth-child(1){width:12%}.goal-side-table th:nth-child(2){width:32%}.goal-side-table th:nth-child(3){width:14%}
      .goal-record,.goal-sleep-record{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px 7px;background:white;border:1px solid #dce4ef;border-radius:5px;padding:4px 7px;margin:4px 0;break-inside:avoid;page-break-inside:avoid}
      .goal-record.missing{background:#edf0f3}.goal-record dt,.goal-record-group dt{color:#34445e;font-size:10px;font-weight:700}.goal-record dd,.goal-record-group dd{margin:0}
      .goal-record-group{min-width:0;margin:0;display:grid;align-content:start;gap:3px}.goal-record-group+.goal-record-group{border-left:1px solid #dce4ef;padding-left:7px}
      .goal-references{display:grid;grid-template-columns:repeat(${phone ? 1 : 2},minmax(0,1fr));gap:3px 12px}.goal-references a{color:#384e82;break-inside:avoid}
      .pdf-phone .goal-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.pdf-phone .goal-calendar span{margin:0;padding:2px 0;font-size:10px}.pdf-phone svg[role="img"]{max-height:135px}.pdf-phone .goal-card{padding:6px 8px}`;
    const content = '<main class="goal-pdf' + (phone ? ' pdf-phone' : '') + '">' + pages + '</main>';
    return { styles, content, detailed, html: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>' + styles + '</style></head><body>' + content + '</body></html>' };
  }

  const summaryStyles = `
    :host{display:block;min-width:0}:host([hidden]){display:none}
    .summary-report,.summary-report *{box-sizing:border-box}
    .summary-report{display:grid;gap:18px;justify-items:center;color:#1f2a44;font:13px/1.55 "Noto Sans KR","Malgun Gothic",system-ui,sans-serif}
    .summary-page{width:100%;max-width:794px;min-height:1123px;padding:36px 44px 28px;background:#fff;display:flex;flex-direction:column;gap:18px;border-radius:2px;box-shadow:0 1px 5px #25244820}
    .summary-report h1,.summary-report h2,.summary-report h3,.summary-report p{margin:0;overflow-wrap:anywhere}
    .summary-report h1{font-size:26px;font-weight:800;line-height:1.35}
    .summary-report h2{font-size:17px;font-weight:800}.summary-report h3{font-size:13px;font-weight:800}
    .summary-header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:12px;border-bottom:2px solid #5b4fc4}
    .summary-kicker{font-size:12px;font-weight:700;color:#5b4fc4}.summary-sub,.summary-note{color:#4a5470}
    .summary-note{font-size:11px}.summary-header-counts{display:flex;gap:8px;flex-shrink:0}
    .summary-counter{display:grid;place-content:center;text-align:center;min-width:92px;min-height:60px;padding:5px 8px;border-radius:12px;background:#f1effb;color:#3b3195}
    .summary-counter.caf{background:#fff1e6;color:#8a3b10}.summary-counter span{color:#4a5470;font-size:11px}.summary-counter strong{font-size:19px;font-weight:800}
    .summary-section{display:grid;gap:10px;min-width:0}.summary-title-line{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 10px}
    .summary-scroll{overflow:auto;min-width:0}.summary-chart{padding:12px;border-radius:14px;background:#f7f6fc}
    .summary-axis-row{display:grid;grid-template-columns:104px repeat(var(--days),minmax(0,1fr));gap:6px;align-items:center;min-width:calc(104px + var(--days) * 39px)}
    .summary-axis-row+.summary-axis-row{margin-top:4px}.summary-axis-row>span:not(:first-child),.summary-axis-row>div:not(:first-child){text-align:center}
    .summary-axis-row[data-row="dates"]{font-size:12px;font-weight:700}.summary-axis-row.compact[data-row="dates"]{font-size:10px}.summary-axis-row.compact .summary-dow{display:block}
    .summary-axis-label{font-size:12px;font-weight:700;color:#33416a;line-height:1.35}.summary-axis-label small{display:block;font-size:10px;font-weight:400;color:#4a5470}
    .summary-axis-label.caf{color:#a4521f}.summary-axis-label.hours{color:#2c5c9e}.summary-axis-label.condition{color:#1f6b4f}
    .summary-chart-bar{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px;height:66px;color:#7a3a12;font-size:11px;font-weight:700;line-height:1.25}
    .summary-chart-bar>span,.summary-chart-bar>i{position:relative;z-index:1}.summary-chart-bar i{display:block;width:22px;border-radius:4px 4px 0 0;background:#d98a55}.compact .summary-chart-bar i{width:17px}
    .summary-chart-bar.hours{color:#1f4a85}.summary-hours-band{position:absolute;z-index:0;bottom:35px;height:9px;inset-inline:0;background:#dfe8f7}
    .summary-chart-bar.hours i{background:#a9c0e6}.summary-chart-bar.hours i.in-range{background:#3f72bd}
    .summary-caf-zero{color:#185a41;background:#e3f3ec;border-radius:6px;padding:2px 4px}
    .summary-caf-missing{border:1px dashed #b8bccb;color:#555e7a;border-radius:6px;padding:2px 4px}
    .compact .summary-caf-zero,.compact .summary-caf-missing{white-space:nowrap;font-size:9.5px;padding-inline:2px}
    .summary-clock{min-height:28px;display:grid;place-items:center;font-size:13px;font-weight:700;border-radius:8px}
    .summary-clock.late{background:#fde7da;color:#8a2f0c}.summary-muted{color:#555e7a;font-weight:500}
    .summary-cond{margin:4px auto;display:grid;place-items:center;width:min(46px,100%);min-height:28px;border-radius:14px;font-size:13px;font-weight:800;background:#ebe8f7;color:#33296f}
    .summary-cond.low{background:#fbe0d0;color:#7a2e0b}.summary-cond.high{background:#d6efe4;color:#185a41}
    .summary-cond.summary-muted{background:#fff;border:1px dashed #b8bccb;color:#555e7a;font-size:11px}
    .summary-clock.summary-missing,.summary-chart-bar .summary-missing,.summary-cond.summary-missing,.summary-mark.missing{font-size:10px;line-height:1.15;text-align:center;word-break:keep-all}
    .summary-three,.summary-two{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.summary-two{grid-template-columns:repeat(2,minmax(0,1fr))}
    .summary-compare,.summary-reflect-card{display:grid;align-content:start;gap:5px;border:1.5px solid #e2def3;border-radius:12px;padding:10px 12px}
    .summary-compare-row{display:flex;justify-content:space-between;align-items:baseline;gap:5px;font-size:12px;color:#4a5470;font-weight:700}
    .summary-compare-row.drink{color:#8a3b10}.summary-compare-row strong{font-size:17px;color:#1f2a44;white-space:nowrap}
    .summary-callout{padding:9px 14px;border-radius:12px;background:#fff4e9;font-size:13px}
    .summary-callout.mint{background:#eef6f2}.summary-callout.blue{background:#eef3fa}
    .summary-goal-row{display:grid;grid-template-columns:180px repeat(var(--days),minmax(0,1fr)) 50px;gap:5px;align-items:center;min-width:calc(230px + var(--days) * 34px)}
    .summary-goal-row.compact{grid-template-columns:140px repeat(var(--days),minmax(0,1fr)) 40px;min-width:calc(180px + var(--days) * 35px)}
    .summary-goal-row+.summary-goal-row{margin-top:6px}.summary-goal-row .summary-goal-label{font-size:14px;font-weight:700;line-height:1.35}
    .summary-goal-tag{display:block;font-size:10px;font-weight:700;color:#5b4fc4}
    .summary-goal-total{text-align:center;font-size:15px;font-weight:800}.summary-goal-row .summary-note{text-align:center}.summary-goal-row.compact .summary-note{font-size:9px}.summary-goal-row.compact .summary-goal-total{font-size:13px;white-space:nowrap}
    .summary-mark{display:grid;place-items:center;min-height:30px;border-radius:8px;background:#eef0f4;color:#4a5470;font-weight:800}
    .summary-mark.ok{background:#2f7d62;color:white}.summary-mark.no,.summary-mark.short{border:2px solid #d0743f;background:white;color:#8a3b10}
    .summary-mark.long{border:2px solid #8a7fd0;background:white;color:#3b3195}
    .summary-mark.near{background:#edf2fa;color:#33486b;font-size:11px}
    .summary-mark.short,.summary-mark.long{font-size:11px;line-height:1.1}
    .summary-mark.short,.summary-mark.long{min-height:32px;align-content:center;gap:1px}
    .summary-mark-hours{font-size:10px}
    .summary-section{grid-template-columns:minmax(0,1fr)}
    .summary-title-line>.summary-note{min-width:0;max-width:100%;overflow-wrap:anywhere}
    .summary-title-line.stacked>.summary-note{flex:0 0 100%;text-align:right}
    .summary-weekly-area{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;min-width:0}
    .summary-week-scroll{border:1px solid #e2def3;border-radius:12px}
    .summary-week-table{width:100%;min-width:calc(143px + var(--week-cols) * 65px);table-layout:fixed;border-collapse:separate;border-spacing:0;color:#1f2a44;text-align:center;line-height:1.35}
    .summary-week-table th,.summary-week-table td{padding:8px 5px;border-bottom:1px solid #eeedf5}
    .summary-week-table thead th{background:#f1effb;font-size:12px;color:#3b3195}
    .summary-week-table tr:last-child td,.summary-week-table tbody tr:last-child th{border-bottom:0}
    .summary-week-table th:first-child{width:143px;text-align:left;padding-left:9px}
    .summary-week-table tbody th{font-size:12px;background:#fbfafd}
    .summary-week-table strong,.summary-week-table small{display:block}
    .summary-week-table small{font-size:10px;font-weight:500;color:#4a5470}
    .summary-week-range,.summary-week-days{display:inline-block;white-space:nowrap}
    .summary-week-table td strong{font-size:14px}.summary-week-table td.summary-week-total{background:#faf8fe}
    .summary-ratio{display:block;border-radius:7px;padding:5px 2px;font-size:13px;font-weight:800;color:#185a41}
    .summary-ratio.rate-0{background:#f0f6f3}.summary-ratio.rate-1{background:#dbeee6}.summary-ratio.rate-2{background:#b7dccf}
    .summary-ratio.rate-3{background:#307a63;color:#fff}.summary-ratio.rate-4{background:#22644f;color:#fff}
    .summary-ratio.no-data{background:#eef0f4;color:#4a5470}
    .summary-week-hint{display:none}
    .summary-weekly-area[data-dense="true"]{gap:5px}
    .summary-weekly-area[data-dense="true"] th,.summary-weekly-area[data-dense="true"] td{padding-block:2px;line-height:1.2;font-size:10px}
    .summary-weekly-area[data-dense="true"] td strong,.summary-weekly-area[data-dense="true"] td small{display:inline;font-size:9px}
    .summary-weekly-area[data-dense="true"] td small{margin-left:2px}
    .summary-weekly-area[data-dense="true"] thead small,.summary-weekly-area[data-dense="true"] .summary-goal-tag{font-size:8.5px}
    .summary-weekly-area[data-dense="true"] .summary-ratio{padding:2px;font-size:10px}
    .summary-page[data-size="many-weeks"]{gap:12px}
    .summary-page[data-size="many-weeks"] .summary-section{gap:5px}
    .summary-page[data-size="many-weeks"] .summary-goal-tag{display:inline;margin-right:4px}
    .summary-page[data-size="many-weeks"] .summary-weekly-area{gap:3px}
    .summary-page[data-size="many-weeks"] .summary-week-table th,.summary-page[data-size="many-weeks"] .summary-week-table td{padding-block:1px}
    @media(max-width:680px){
      .summary-title-line.stacked>.summary-note{text-align:left}
      .summary-week-table{min-width:calc(143px + var(--week-cols) * 78px)}
      .summary-week-table th:first-child{position:sticky;left:0;z-index:1}
      .summary-week-hint{display:block}
      .summary-page[data-size="many-weeks"] .summary-week-table th,.summary-page[data-size="many-weeks"] .summary-week-table td{padding-block:7px}
      .summary-weekly-area[data-dense="true"] th,.summary-weekly-area[data-dense="true"] td{padding-block:7px;font-size:12px}
      .summary-weekly-area[data-dense="true"] td strong,.summary-weekly-area[data-dense="true"] td small{display:block;font-size:11px}
      .summary-weekly-area[data-dense="true"] .summary-ratio{font-size:13px}
    }
    .summary-foot{margin-top:auto!important;font-size:10.5px;color:#4a5470;display:grid;gap:4px}
    .summary-foot-standards{display:grid;gap:2px}
    .summary-goal-row .summary-goal-total.no-weight,.summary-weekly-area .summary-ratio.no-weight{font-size:10px;line-height:1.25;white-space:normal;word-break:keep-all}
    .summary-page[data-page="2"]{gap:11px}
    .summary-page[data-page="2"] .summary-section{gap:7px}
    .summary-page[data-page="2"] .summary-header{align-items:baseline}
    .summary-intakes{border:1.5px solid #ecd9cb;border-radius:12px}
    .summary-intakes table{width:100%;min-width:570px;border-collapse:collapse;table-layout:fixed}
    .summary-intakes th,.summary-intakes td{padding:7px 6px;text-align:left;overflow-wrap:anywhere}
    .summary-intakes th{background:#fbeee4;color:#6b3a1c;font-size:11px}.summary-intakes td{border-top:1px solid #f1e4da}
    .summary-intakes tr .late,.summary-intakes tr .discomfort{color:#8a2f0c;font-weight:800}
    .summary-caf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .summary-caf-card{min-width:0;border:1.5px solid #ecd9cb;border-radius:12px;padding:8px 12px;display:grid;gap:4px;align-content:start}
    .summary-caf-card h3{color:#7a3a12;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 6px}
    .summary-caf-card h3 small,.summary-caf-count small{font-size:10.5px;font-weight:500;color:#4a5470}
    .summary-caf-hb{display:grid;grid-template-columns:minmax(0,104px) minmax(0,1fr) 40px;gap:6px;align-items:center;font-size:12px;line-height:1.35}
    .summary-caf-hb.wide{grid-template-columns:minmax(0,104px) minmax(0,1fr) 92px}
    .summary-caf-label{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .summary-caf-track{height:12px;background:#f8efe8;border-radius:4px;overflow:hidden}
    .summary-caf-track i{display:block;height:100%;background:#d98a55;border-radius:4px}
    .summary-caf-track i.soft{background:#efc3a1}.summary-caf-track i.symptom{background:#d0743f}
    .summary-caf-count{font-weight:800;color:#7a3a12;text-align:right;white-space:nowrap}
    .summary-caf-cols,.summary-caf-axis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .summary-caf-cols{align-items:end;height:92px;padding-top:2px}
    .summary-caf-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:100%;font-size:12px;font-weight:800;color:#7a3a12}
    .summary-caf-col i{display:block;width:min(34px,100%);border-radius:5px 5px 0 0;background:#efc3a1}
    .summary-caf-col.late i{background:#d98a55}.summary-caf-axis b{color:#8a2f0c}
    .summary-caf-axis{text-align:center;font-size:11px;color:#4a5470;border-top:1px solid #ecd9cb;padding-top:4px}
    .summary-caf-split{display:flex;min-height:20px;border-radius:6px;overflow:hidden;font-size:11px;font-weight:700}
    .summary-caf-split span{display:grid;place-items:center;min-width:max-content;padding-inline:4px}
    .summary-caf-split .none{background:#eef0f4;color:#4a5470}.summary-caf-split .has{background:#d0743f;color:#fff}
    .summary-caf-none{display:grid;grid-template-columns:150px minmax(0,1fr);gap:18px;align-items:center;border:1.5px solid #ecd9cb;background:#fffaf5;border-radius:14px;padding:16px 20px}
    .summary-caf-none svg{max-width:100%;height:auto}
    .summary-caf-big{font-size:40px;font-weight:800;color:#7a3a12;line-height:1}
    .summary-caf-big small{font-size:16px;margin-left:2px}
    .summary-caf-none .summary-caf-lead{font-size:15px;font-weight:800;margin-top:6px}
    .summary-caf-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .summary-caf-stats span{background:#fff;border:1.5px solid #ecd9cb;border-radius:10px;padding:6px 12px;font-size:11px;color:#4a5470}
    .summary-caf-stats b{display:block;font-size:17px;color:#7a3a12}
    .summary-caf-chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:10px}
    .summary-caf-chip{width:14px;height:14px;border-radius:4px;background:#d98a55}
    @media(max-width:580px){.summary-caf-grid{grid-template-columns:minmax(0,1fr)}.summary-caf-none{grid-template-columns:1fr;gap:6px}.summary-caf-none svg{width:90px}}
    .summary-habit{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:center;font-weight:700}
    .summary-habit-bar{display:flex;flex-wrap:wrap;gap:2px;overflow:hidden;border-radius:8px}
    .summary-habit-bar>span{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:26px;min-width:44px;padding:1px 2px;font-size:10.5px;line-height:1.15;text-align:center;overflow-wrap:anywhere;background:#e6ecf8;color:#24324f}
    .summary-habit-bar .band-1{background:#bccde9}.summary-habit-bar .band-2{background:#5978b4;color:white}.summary-habit-bar .band-3{background:#3f68ad;color:white}
    .summary-record-card{border-radius:12px;padding:12px 14px;display:grid;align-content:start;gap:5px}
    .summary-record-card.good{background:#eef6f2;color:#185a41}.summary-record-card.review{border:1.5px dashed #d0a07f;color:#8a3b10}
    .summary-record-card h2{font-size:15px}.summary-record-card [data-summary-text]{display:grid;gap:5px;color:#1f2a44}
    .summary-reflections>.summary-three{align-items:stretch}
    .summary-reflect-card h3,.summary-teacher b{color:#3b3195}
    [data-summary-text]{white-space:pre-line}
    .summary-edit-heading,.summary-edit-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .summary-edit-heading{justify-content:space-between}
    .summary-report [hidden]{display:none!important}
    .summary-reflections button{font:inherit;color:#3b3195;background:#f4f2fc;border:1px solid #d7d0ef;border-radius:7px;padding:5px 9px;cursor:pointer}
    .summary-reflections button:disabled{opacity:.55;cursor:wait}
    .summary-field-editor{display:block;width:100%;min-width:0;min-height:3em;max-height:12em;overflow:auto;font:inherit;line-height:1.5;white-space:pre-wrap;border:1px solid #a6a0d4;border-radius:7px;padding:6px;background:#fff;color:#1f2a44}
    .summary-field-editor:focus{outline:2px solid #776fc6;outline-offset:1px}
    .summary-format-bar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:5px}
    .summary-format-bar button{font:inherit;min-width:28px;min-height:28px;color:#3b3195;background:#fff;border:1px solid #d7d0ef;border-radius:6px;padding:2px 6px;cursor:pointer}
    .summary-format-bar button:disabled{opacity:.55;cursor:wait}
    .summary-format-bar .format-swatch::before{content:'';display:block;width:14px;height:14px;border-radius:2px;background:currentColor}
    .summary-format-bar .red{color:#b91c1c}.summary-format-bar .blue{color:#1d4ed8}.summary-format-bar .green{color:#047857}
    .summary-reflections.is-editing .summary-teacher{display:grid;grid-template-columns:minmax(0,1fr)}
    .summary-reflections.is-editing .summary-teacher button{justify-self:start}
    .summary-edit-status:empty{display:none}

    .summary-teacher{border-radius:12px;background:#f1effb;padding:10px 14px;min-height:42px;display:flex;gap:10px}
    .summary-teacher b{white-space:nowrap}
    @media(min-width:681px){
      .summary-page[data-late="true"]{gap:12px}
      .summary-page[data-late="true"] .summary-section{gap:8px}
      .summary-page[data-late="true"] .summary-record-card{padding:10px 12px;gap:4px}
      .summary-page[data-size="week"]{gap:16px;--bar-scale:1.25}
      .summary-page[data-size="week"] .summary-section{gap:12px}
      .summary-page[data-size="week"] .summary-chart{padding:16px 12px}
      .summary-page[data-size="week"] .summary-axis-row+.summary-axis-row{margin-top:7px}
      .summary-page[data-size="week"] .summary-chart-bar{height:82px}
      .summary-page[data-size="week"] .summary-hours-band{bottom:44px;height:11px}
      .summary-page[data-size="week"] .summary-compare{padding:15px 12px;gap:7px}
      .summary-page[data-size="week"] .summary-mark{min-height:34px}
    }
    @media(max-width:680px){.summary-page{padding:22px 18px;min-height:0}.summary-header{align-items:flex-start;flex-wrap:wrap}.summary-page[data-page="2"] .summary-header{flex-wrap:wrap}.summary-scroll:focus-visible{outline:2px solid #5b4fc4;outline-offset:2px}}
    @media(max-width:480px){.summary-three,.summary-two{grid-template-columns:1fr}.summary-report h1{font-size:22px}.summary-habit{grid-template-columns:1fr;gap:3px}}
  `;

  function renderSummaryWeeks(weeks, rows, { goals = false } = {}) {
    const label = goals ? '주차별 목표 실천 표' : '주차별 평균 표';
    const weekHeading = week => {
      const first = pdfDay(week.days[0].date), last = pdfDay(week.days.at(-1).date);
      return `<th scope="col"><strong>${week.number}주차</strong><small><span class="summary-week-range">${first === last ? first : `${first}~${last}`}</span> <span class="summary-week-days">· ${week.days.length}일</span></small></th>`;
    };
    const chunks = [];
    for (let i = 0; i < weeks.length; i += 7) chunks.push(weeks.slice(i, i + 7));
    return `<div class="summary-weekly-area"${(chunks.length > 1 || rows.length > 5) ? ' data-dense="true"' : ''}>
      ${chunks.map((chunk, index) => {
        const total = goals && index === chunks.length - 1;
        return `<div class="summary-scroll summary-week-scroll" role="region" tabindex="0" aria-label="${label}${chunks.length > 1 ? ` · ${chunk[0].number}~${chunk.at(-1).number}주차` : ''}">
          <table class="summary-week-table ${goals ? 'is-goals' : 'is-averages'}" style="--week-cols:${chunk.length + Number(total)}">
            <thead><tr><th scope="col">${goals ? '목표' : '항목'}</th>${chunk.map(weekHeading).join('')}${total ? '<th scope="col" class="summary-week-total">전체</th>' : ''}</tr></thead>
            <tbody>${rows.map(row => `<tr data-weekly-${goals ? 'goal' : 'metric'}="${pdfText(row.id)}">
              <th scope="row">${row.title}</th>${chunk.map(week => `<td>${row.cell(week.days)}</td>`).join('')}${total ? `<td class="summary-week-total">${row.total}</td>` : ''}
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      }).join('')}
      <p class="summary-note summary-week-hint">표를 옆으로 밀어 나머지 주차를 볼 수 있어요.</p>
    </div>`;
  }

  const reportPlainText = value => typeof value === 'string' ? value : (value?.text || '');
  const reportTextHtml = value => typeof value?.html === 'string' && window.safeRender
    ? window.safeRender.sanitizeRichHtml(value.html, { report: true }) : pdfText(reportPlainText(value));

  const caffeineChoiceLabels = new Map([
    ['공부나 일에 집중이 필요해서', '공부·일에 집중'], ['스트레스나 불안을 해소하려고', '스트레스·불안 해소'],
    ['커피나 음료 맛이 좋아서', '맛이 좋아서'], ['운동할 때 에너지를 얻으려고', '운동할 때 에너지'],
    ['속이 울렁거리거나 배가 아팠다', '속 울렁임·복통'], ['불안하거나 예민했다', '불안·예민'],
  ]);
  const noDiscomfort = symptom => /^(없음|해당 없음|없었어요|없다)$/.test(symptom);

  function buildSummaryCaffeineCharts(intakes) {
    const noResponse = '<p class="summary-note">표시할 응답이 없어요.</p>';
    const choices = value => (value || '').split(', ').map(item => item.trim()).filter(Boolean);
    const shortChoice = value => caffeineChoiceLabels.get(value) ?? pdfShort(value, 12);
    const rank = entries => {
      const rows = new Map();
      for (const [name, mg] of entries) {
        if (!rows.has(name)) rows.set(name, { name, count: 0, mg: null });
        const row = rows.get(name);
        row.count++;
        if (Number.isFinite(mg)) row.mg = (row.mg ?? 0) + mg;
      }
      return [...rows.values()].sort((a, b) => b.count - a.count);
    };
    const topFour = (rows, format = name => name) => {
      const rest = rows.slice(4);
      if (!rest.length) return rows;
      const amounts = rest.map(row => row.mg).filter(Number.isFinite);
      return [...rows.slice(0, 4), { name: `기타 (${format(rest[0].name)} 등)`,
        count: rest.reduce((sum, row) => sum + row.count, 0),
        mg: amounts.length ? amounts.reduce((sum, amount) => sum + amount, 0) : null }];
    };
    const horizontal = (rows, { tone = '', wide = false } = {}) => {
      if (!rows.length) return noResponse;
      const max = Math.max(...rows.map(row => row.count));
      return rows.map(({ name, count, mg }) => `<div class="summary-caf-hb${wide ? ' wide' : ''}">
        <span class="summary-caf-label" title="${pdfText(name)}">${pdfText(name)}</span><span class="summary-caf-track" aria-hidden="true"><i class="${tone}" style="width:${count / max * 100}%"></i></span>
        <span class="summary-caf-count">${count}번${wide && mg !== null ? ` <small>${mg.toLocaleString('ko-KR')}mg</small>` : ''}</span></div>`).join('');
    };
    const card = (key, title, detail, content) => `<article class="summary-caf-card" data-caffeine-card="${key}"><h3>${title}${detail ? ` <small>${detail}</small>` : ''}</h3>${content}</article>`;
    const drinks = rank(intakes.map(item => [item.drink?.replace(/\s+/g, ' ').trim() || '이름 없음', item.mg]));
    const reasons = rank(intakes.flatMap(item => choices(item.reason).map(value => [value])));
    const timeBands = [['morning', '오전', 0], ['midday', '12~15시', 720], ['afternoon', '15~18시', 900], ['evening', '18시 이후', 1080]];
    const counts = timeBands.map(([, , start], index) => intakes.filter(({ time }) => Number.isFinite(time) &&
      time >= start && time < (timeBands[index + 1]?.[2] ?? 1440)).length);
    const maxTime = Math.max(...counts);
    const times = maxTime ? `<div class="summary-caf-cols">${timeBands.map(([key], i) =>
      `<div class="summary-caf-col${i >= 2 ? ' late' : ''}" data-caffeine-time="${key}"><span>${counts[i]}번</span><i aria-hidden="true" style="height:${counts[i] / maxTime * 62}px"></i></div>`).join('')}</div>
      <div class="summary-caf-axis">${timeBands.map(([, text], i) => i >= 2 ? `<b>${text}</b>` : `<span>${text}</span>`).join('')}</div>` : noResponse;
    const answered = intakes.map(item => ({ ...item, options: choices(item.symptom) })).filter(item => item.options.length);
    const symptomatic = answered.map(item => ({ ...item, options: item.options.filter(value => !noDiscomfort(value)) }))
      .filter(item => item.options.length);
    const without = answered.length - symptomatic.length;
    const symptoms = rank(symptomatic.flatMap(item => item.options.map(value => [value])))
      .map(row => ({ ...row, name: shortChoice(row.name) }));
    const split = answered.length ? `<div class="summary-caf-split">
      ${without ? `<span class="none" style="flex:${without} 1 0">없음 ${without}번</span>` : ''}
      ${symptomatic.length ? `<span class="has" style="flex:${symptomatic.length} 1 0">있음 ${symptomatic.length}번</span>` : ''}</div>
      ${symptoms.length ? horizontal(symptoms, { tone: 'symptom' }) : ''}` : noResponse;
    const [top, second] = drinks;
    const late = counts[2] + counts[3];
    const side = symptomatic[0];
    const sideNote = symptomatic.length >= 2
      ? `불편함을 적은 ${symptomatic.length}번 중 ${symptomatic.filter(item => item.time >= 900).length}번은 15시 이후였어요.`
      : side && Number.isFinite(side.time) && Number.isFinite(side.bed)
        ? `${pdfDay(side.date)}에는 ${pdfClock(side.time)}에 카페인을 마시고 ‘${side.options.join(', ')}’고 적었어요. 그날 밤 ${pdfClock(side.bed)}에 잠들었어요.` : '';
    const note = [top.count >= 2 && top.count > (second?.count ?? 0) ? `가장 자주 마신 건 ‘${top.name}’(${top.count}번)예요.` : '',
      late ? `15시 이후에 마신 건 ${late}번이에요.` : '', sideNote].filter(Boolean).join(' ');
    const reasonRows = topFour(reasons.map(row => ({ ...row, name: shortChoice(row.name) })));
    return { note, content: `<div class="summary-caf-grid">
      ${card('drink', '① 자주 마신 음료', '횟수 · 합계', horizontal(topFour(drinks, name => pdfShort(name, 12)), { wide: true }))}
      ${card('time', '② 마신 시각', '15시 이후 진하게', times)}
      ${card('reason', '③ 마신 이유', '고른 횟수', horizontal(reasonRows, { tone: 'soft' }))}
      ${card('symptom', '④ 마신 뒤 불편함', answered.length ? `적은 ${answered.length}번 중` : '', split)}
    </div>` };
  }

  function buildSummaryNoCaffeine(zero, periodDays) {
    if (!zero.length) return { content: '<p class="summary-note">표시할 섭취 내역이 없어요.</p>', note: '' };
    let longest = 0, streak = 0, previous, last;
    for (const { date } of zero) {
      streak = previous === pdfShiftDate(date, -1) ? streak + 1 : 1;
      if (streak > longest) { longest = streak; last = date; }
      previous = date;
    }
    const lead = zero.length === periodDays ? '이 기간에는 카페인을 마시지 않았어요' : '기록한 날에는 카페인을 마시지 않았어요';
    const note = `${zero.length}일 ‘안 마심’을 남겼고, 가장 길게는 ${pdfDay(pdfShiftDate(last, 1 - longest))}부터 ${pdfDay(last)}까지 ${longest}일 이어졌어요.`;
    return { note: longest >= 2 ? note : `${zero.length}일 ‘안 마심’을 남겼어요.`, content: `<div class="summary-caf-none">
      <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#fbeee4"/>
      <path d="M30 46h52l-6 44a8 8 0 0 1-8 7H44a8 8 0 0 1-8-7z" fill="#fff" stroke="#d98a55" stroke-width="4" stroke-linejoin="round"/>
      <path d="M82 54h6a10 10 0 0 1 0 20h-8" fill="none" stroke="#d98a55" stroke-width="4"/>
      <text x="56" y="80" text-anchor="middle" font-size="22" font-weight="800" fill="#7a3a12" font-family="Noto Sans CJK KR">0</text></svg>
      <div><div class="summary-caf-big">0<small>mg</small></div><p class="summary-caf-lead">${lead}</p>
      <div class="summary-caf-stats"><span><b>${zero.length}일</b>‘안 마심’ 기록</span>${longest >= 2 ? `<span><b>${longest}일</b>가장 길게 이어진 날</span>` : ''}</div>
      <div class="summary-caf-chips" aria-hidden="true">${zero.map(() => '<i class="summary-caf-chip"></i>').join('')}</div></div></div>` };
  }

  function buildSummaryReportDocument(report, { now = Date.now() } = {}) {
    const { feedback, student, start, end } = report;
    const finding = id => feedback.engine.findings.find(item => item.id === id)?.data;
    const sleep = finding('bedtimeSeries')?.days || [];
    const caffeine = new Map((finding('caffeineSummary')?.days || []).map(day => [day.date, day]));
    const days = sleep.map(day => ({ ...day, caf: caffeine.get(day.date) }));
    const shown = days.length <= 14 ? days : [];
    const weeks = [];
    if (days.length > 14) {
      for (let i = 0; i < days.length; i += 7) weeks.push({ number: weeks.length + 1, days: days.slice(i, i + 7) });
    }
    const compact = shown.length > 7 ? ' compact' : '';
    const n = Math.max(1, shown.length);
    const today = days.find((day, i) => day.open && i > 0 && !days[i - 1].open)?.date
      || new Date(now + 9 * 3600000).toISOString().slice(0, 10);
    const closed = days.filter(day => !day.open);
    const validSleep = closed.filter(day => day.recorded && !day.held);
    const cafDays = days.filter(day => !day.open || day.caf?.recorded);
    const zero = cafDays.filter(day => day.caf?.status === 'zero');
    const counts = (label, recorded, total, tone = '') => `<div class="summary-counter ${tone}"><span>${label}</span><strong>${recorded} / ${total}일</strong></div>`;
    const wd = date => ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00:00Z').getUTCDay()];
    const dateText = date => `${pdfDay(date)}(${wd(date)})`;
    const name = pdfText(student?.이름 || '학생');
    const period = `${dateText(start)} ~ ${dateText(end)}`;
    const plainPeriod = start.slice(0, 4) === end.slice(0, 4) ? `${start.slice(0, 4)}년 · ${period}` : `${start} ~ ${end}`;
    const edit = feedback.summaryEdit;
    const summaryText = (key, label, message) => `<span data-summary-text="${key}" data-summary-label="${label}">${reportTextHtml(message)}</span>`;
    const callout = (key, label, fallback, tone = '') => {
      const message = edit?.[key] ?? fallback;
      return `<p class="summary-callout ${tone}" data-summary-callout${reportPlainText(message) ? '' : ' hidden'}><b data-summary-prefix${edit?.[key] === undefined ? '' : ' hidden'}>기록을 보면</b> ${summaryText(key, label, message)}</p>`;
    };
    const recordNote = (key, label, paragraphs) => `<div data-summary-text="${key}" data-summary-label="${label}">${edit?.[key] !== undefined
      ? reportTextHtml(edit[key]) : pdfParagraphs(paragraphs)}</div>`;
    const block = (title, body, note = '', stacked = false) => `<section class="summary-section"><div class="summary-title-line${stacked ? ' stacked' : ''}"><h2>${title}</h2>${note ? `<span class="summary-note">${pdfText(note)}</span>` : ''}</div>${body}</section>`;
    const axis = (key, label, render) => `<div class="summary-axis-row${compact}" style="--days:${n}" data-row="${key}">${label}${shown.map(render).join('')}</div>`;
    const markDate = day => `data-date="${pdfText(day.date)}"`;
    const label = (main, sub = '', tone = '') => `<span class="summary-axis-label ${tone}">${main}${sub ? `<small>${sub}</small>` : ''}</span>`;
    const asleep = value => Number.isFinite(value) ? pdfClock(value) : '–';
    const sleepMissingText = day => day.held ? '–' : '기록 없음';
    const sleepValue = (day, key) => day.open || day.held || !Number.isFinite(day[key]) ? null : day[key];
    const sleepClock = (day, key) => {
      const value = sleepValue(day, key);
      const tone = value === null ? ' summary-muted summary-missing' : key === 'bed' && value >= 1440 ? ' late' : '';
      return `<span ${markDate(day)} class="summary-clock${tone}">${value === null ? sleepMissingText(day) : asleep(value)}</span>`;
    };
    const maxCaffeine = Math.max(150, ...shown.map(day => day.caf?.totalMg || 0));
    const caffeineBar = day => {
      const caf = day.caf;
      const status = caf?.status;
      const amount = status === 'known' ? caf.totalMg : null;
      const text = status === 'zero' ? '<span class="summary-caf-zero">안 마심</span>'
        : status === 'unknown' ? '<span class="summary-caf-missing">함량 미상</span>'
        : status === 'known' ? `<span>${pdfText(amount)}</span>`
        : day.open ? `<span class="summary-muted">${day.date === today ? '오늘' : '아직'}</span>`
        : '<span class="summary-caf-missing">기록 없음</span>';
      return `<div ${markDate(day)} class="summary-chart-bar">${text}${amount > 0 ? `<i aria-hidden="true" style="height:calc(${Math.max(4, Math.round(44 * amount / maxCaffeine))}px * var(--bar-scale,1))"></i>` : ''}</div>`;
    };
    const inRange = h => h >= 8 && h <= 10;
    const roundedHours = day => {
      const value = sleepValue(day, 'hours');
      return value === null ? null : Math.round(value);
    };
    const hoursBar = day => {
      const value = roundedHours(day);
      return `<div ${markDate(day)} class="summary-chart-bar hours"><div class="summary-hours-band" aria-hidden="true"></div><span${value === null ? ' class="summary-missing"' : ''}>${value === null ? sleepMissingText(day) : value}</span>${value === null ? ''
        : `<i aria-hidden="true" class="${inRange(value) ? 'in-range' : ''}" style="height:calc(${Math.round(Math.min(value, 11) / 11 * 48)}px * var(--bar-scale,1))"></i>`}</div>`;
    };
    const condition = day => {
      const value = sleepValue(day, 'condition');
      const score = Number.isInteger(value) && value >= 1 && value <= 5;
      const text = score ? `${value}점` : sleepMissingText(day);
      const tone = score ? (value < 3 ? 'low' : value > 3 ? 'high' : '') : 'summary-muted summary-missing';
      return `<div ${markDate(day)}><span class="summary-cond ${tone}">${text}</span></div>`;
    };
    const dailyChart = () => `<div class="summary-scroll summary-chart" role="region" tabindex="0" aria-label="날짜별 카페인과 수면">
      ${axis('dates', '<span></span>', day => `<span ${markDate(day)}>${pdfDay(day.date)} <span class="summary-dow">(${wd(day.date)})</span></span>`)}
      ${axis('caffeine', label('카페인', 'mg', 'caf'), caffeineBar)}
      ${axis('bedtime', label('취침시각'), day => sleepClock(day, 'bed'))}
      ${axis('wake', label('기상시각'), day => sleepClock(day, 'wake'))}
      ${axis('hours', label('수면시간', '반올림 · 파란 띠 = 8~10시간', 'hours'), hoursBar)}
      ${axis('condition', label('다음 날 아침 컨디션', '5점 만점', 'condition'), condition)}
    </div>`;
    // Display summaries of facts already present in the report. No sheet reads or new engine output.
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const compare = (groups, key) => {
      const values = groups.map(group => group.map(day => day[key]).filter(Number.isFinite));
      const size = values.map(group => group.length);
      return { size, means: size.every(count => count >= 2) ? values.map(mean) : null };
    };
    const fixed = (value, unit) => value.toFixed(1) + unit;
    const groups = ['known', 'zero'].map(status => validSleep.filter(day => day.caf?.status === status));
    const metrics = [
      ['bed', '취침시각 평균', value => pdfClock(Math.round(value))],
      ['hours', '수면시간 평균', value => fixed(value, '시간')],
      ['condition', '아침 컨디션 평균', value => fixed(value, '점')],
    ].map(([key, title, format]) => ({ key, title, format, ...compare(groups, key) }));
    const comparisons = `<div class="summary-three">${metrics.map(item => `<article class="summary-compare" data-compare="${item.key === 'bed' ? 'bedtime' : item.key}"><h3>${item.title}</h3>
      ${['마신 날 밤', '안 마신 날 밤'].map((text, i) => `<div class="summary-compare-row${i === 0 ? ' drink' : ''}"><span>${text} (${item.size[i]}일)</span>${item.means ? `<strong>${item.format(item.means[i])}</strong>` : ''}</div>`).join('')}
      ${item.means ? '' : '<p class="summary-note"><b>비교 보류</b> · 양쪽 모두 유효 기록 2일 이상이 필요해요.</p>'}</article>`).join('')}</div>`;
    const weeklyMetric = (id, title, field, format) => ({ id, title, cell: week => {
      const values = week.map(field).filter(Number.isFinite);
      return `<strong>${values.length ? format(mean(values)) : '–'}</strong><small>${values.length}일</small>`;
    } });
    const sleepField = key => day => !day.open && day.recorded && !day.held ? day[key] : null;
    const chart = weeks.length ? renderSummaryWeeks(weeks, [
      weeklyMetric('caffeine', '평균 카페인', day => ['known', 'zero'].includes(day.caf?.status) ? day.caf.totalMg : null,
        value => Math.round(value * 10) / 10 + 'mg'),
      weeklyMetric('bedtime', '평균 취침시각', sleepField('bed'), value => pdfClock(Math.round(value))),
      weeklyMetric('hours', '평균 수면시간', sleepField('hours'), value => fixed(value, '시간')),
      weeklyMetric('condition', '평균 아침 컨디션', sleepField('condition'), value => fixed(value, '점')),
    ]) : dailyChart();
    const availableMetric = metrics.find(item => item.means);
    const aNote = availableMetric ? `카페인을 마신 날 밤의 ${availableMetric.title}은 ${availableMetric.format(availableMetric.means[0])}, 안 마신 날 밤은 ${availableMetric.format(availableMetric.means[1])}였어요.` : '';
    const standards = finding('healthStandards')?.rows || [];
    const limitInfo = feedback.engine.summaryCaffeineLimit || { basis: report.limitBasis, amountMg: report.limit };
    const noWeight = limitInfo.basis === 'noWeight';
    const maximumText = noWeight ? null : Number.isFinite(limitInfo.amountMg) && limitInfo.amountMg > 0
      ? String(limitInfo.amountMg)
      : standards.find(row => row.id === 'caffeineMax')?.label.match(/([\d.]+)mg/)?.[1];
    const displayGoal = goal => {
      const threshold = goal.label?.match(/([\d.]+)mg/)?.[1];
      return goal.criterion === 'caffeineMax' && threshold && /이하로 마시기/.test(goal.label) ? `하루 ${threshold}mg 넘지 않기`
        : goal.criterion === 'bedtime' && /^23:59까지 잠자리에 들기$/.test(goal.label) ? '12시 전에 자기'
        : (goal.label || '내 목표').replace('잠자리에 들기', '자기');
    };
    const registered = (finding('goalProgress')?.goals || []).filter(goal => goal.criterion || goal.label);
    const selected = registered.filter(goal => goal.source === 'class' ||
      !registered.some(other => other.source === 'class' && other.criterion && other.criterion === goal.criterion));
    const range = { id: 'range', label: '8~10시간 취침', days: days.map(day => {
      const hours = roundedHours(day);
      const kept = hours === null ? null : inRange(hours);
      const outcome = kept === false ? (hours < 7 ? 'short' : hours > 11 ? 'long' : 'near') : null;
      return { date: day.date, kept, outcome };
    }) };
    const defaults = standards.filter(row => row.id !== 'sleepMin' && !(noWeight && row.id === 'caffeineMax')).map(row => ({ ...row,
      label: row.id === 'caffeineMax' && maximumText ? `일일 최대 섭취량(${maximumText}mg) 넘지 않기` : '12시 전에 자기' }));
    const goalEligible = (goal, day) => !day.open || (goal.criterion || goal.id) === 'caffeineMax';
    const unavailableMaximum = { id: 'caffeineMax', label: '일일 최대 섭취량 넘지 않기',
      source: 'default', days: [], unavailable: true };
    const goals = [...(selected.length ? selected.map(goal => ({ ...goal, label: displayGoal(goal) })) : defaults),
      ...(noWeight ? [unavailableMaximum] : []), range]
      .map(goal => {
        const states = new Map(goal.days.filter(day => typeof day.kept === 'boolean').map(day => [day.date, day]));
        const measured = days.filter(day => states.has(day.date) && goalEligible(goal, day));
        return { ...goal, states, measured: measured.length, kept: measured.filter(day => states.get(day.date).kept).length };
      });
    const goalsShown = [...goals.filter(goal => goal.id !== 'range' && !goal.unavailable).slice(0, 4),
      ...goals.filter(goal => goal.id === 'range' || goal.unavailable)];
    const markLabels = { ok: '✓', no: '×', short: '짧음', long: '긺', none: '–', missing: '기록 없음' };
    const goalLabel = goal => `<span class="summary-goal-tag">${goal.source === 'class' || goal.source === 'student' ? '내 목표' : '기본 기준'}</span>${pdfText(goal.label)}`;
    const goalMark = (goal, day) => {
      const state = goal.states.get(day.date);
      const sleepGoal = ['range', 'bedtime', 'wakeTime', 'sleepMin'].includes(goal.criterion || goal.id);
      const missingSleep = sleepGoal && !day.held && (day.open || !day.recorded) &&
        goal.days.some(item => item.date === day.date);
      const mark = goal.unavailable ? 'none' : missingSleep ? 'missing'
        : !state || !goalEligible(goal, day) ? 'none' : state.outcome || (state.kept ? 'ok' : 'no');
      let text = markLabels[mark];
      if (mark === 'near') text = `${roundedHours(day)}h`;
      if (mark === 'short' || mark === 'long') {
        text = `<span>${text}</span><small class="summary-mark-hours">${roundedHours(day)}h</small>`;
      }
      return `<span ${markDate(day)} class="summary-mark ${mark}">${text}</span>`;
    };
    const dailyCalendar = () => `<div class="summary-scroll" role="region" tabindex="0" aria-label="날짜별 목표 실천 달력">
      <div class="summary-goal-row${compact}" style="--days:${n}"><span></span>${shown.map(day => `<span class="summary-note">${pdfDay(day.date)}</span>`).join('')}<span class="summary-note">지킨 날</span></div>
      ${goalsShown.map(goal => `<div class="summary-goal-row${compact}" style="--days:${n}" data-daily-goal="${pdfText(goal.id)}">
        <div class="summary-goal-label">${goalLabel(goal)}</div>
        ${shown.map(day => goalMark(goal, day)).join('')}<span class="summary-goal-total${goal.unavailable ? ' no-weight' : ''}">${goal.unavailable ? '체중 정보 없음' : goal.measured ? `${goal.kept}/${goal.measured}` : '–'}</span></div>`).join('')}
    </div>`;
    const goalLimitNote = goals.length > goalsShown.length ? `<p class="summary-note">개인 목표 ${selected.length}개 중 처음 ${selected.length - (goals.length - goalsShown.length)}개를 표시했어요.</p>` : '';
    const ratioCell = (kept, measured) => {
      const tone = measured ? 'rate-' + Math.floor(4 * kept / measured) : 'no-data';
      return `<span class="summary-ratio ${tone}">${kept}/${measured}</span>`;
    };
    const calendar = weeks.length ? renderSummaryWeeks(weeks, goals.map(goal => ({
      id: goal.id, title: goalLabel(goal),
      cell: week => {
        if (goal.unavailable) return '<span class="summary-ratio no-data">–</span>';
        const judged = week.filter(day => goalEligible(goal, day) && goal.states.has(day.date));
        return ratioCell(judged.filter(day => goal.states.get(day.date).kept).length, judged.length);
      },
      total: goal.unavailable ? '<span class="summary-ratio no-data no-weight">체중 정보 없음</span>' : ratioCell(goal.kept, goal.measured),
    })), { goals: true }) : dailyCalendar() + goalLimitNote;
    const conditionCompare = compare([validSleep.filter(day => Number.isFinite(day.hours) && inRange(day.hours)),
      validSleep.filter(day => Number.isFinite(day.hours) && !inRange(day.hours))], 'condition');
    const bNote = conditionCompare.means
      ? `다음 날 아침 컨디션은 8~10시간인 밤(${conditionCompare.size[0]}일) 평균 ${fixed(conditionCompare.means[0], '점')}, 그 밖의 밤(${conditionCompare.size[1]}일) 평균 ${fixed(conditionCompare.means[1], '점')}이었어요(반올림 전 기준).`
      : '컨디션 비교에는 반올림 전 8~10시간인 밤과 그 밖의 밤의 기록이 각각 2일 이상 필요해요.';
    const page1 = `<article class="summary-page"${weeks.length > 14 ? ' data-size="many-weeks"' : !weeks.length && n <= 7 ? ' data-size="week"' : ''}><header class="summary-header"><div>
      <p class="summary-kicker">카페인·수면 기록 요약 · 1쪽 한눈에 보기</p><h1>${name}의 기록</h1>
      <p class="summary-sub">${pdfText(plainPeriod)} · 날짜는 그날 밤 기준</p></div>
      <div class="summary-header-counts">${counts('수면 기록', validSleep.length, closed.length)}${counts('카페인 기록', cafDays.filter(day => day.caf?.recorded).length, cafDays.length, 'caf')}</div></header>
      ${block('A. 카페인과 수면', chart + comparisons + callout('caffeineSleep', 'A. 카페인과 수면 설명', aNote), weeks.length ? '주차별 평균 · 각 숫자 아래는 계산에 사용한 일수' : '')}
      ${block('B. 수면을 위한 행동과 결과', calendar + callout('behavior', 'B. 수면을 위한 행동과 결과 설명', bNote, 'mint'), weeks.length ? '지킨 날 / 판정 가능한 날 · 비율이 높을수록 진하게 표시 · 수면시간은 반올림해 판정' : '✓ 지킴 · × 못 지킴 · – 판정 없음 · 수면시간은 반올림해 판정', !weeks.length && n > 7)}
      <footer class="summary-foot">
        <p>날짜는 그날 밤 기준이에요. 12시를 넘겨 잠든 날도 전날 밤에 넣어요. 수면시간은 취침시각부터 기상시각까지예요. 비교는 양쪽 모두 유효 기록이 2일 이상일 때만 보여 줘요.</p>
        <div class="summary-foot-standards"><p>청소년 일일 최대 섭취량 = 내 체중 × 2.5mg(식품의약품안전처)</p><p>청소년 권장 수면 8~10시간(미국수면의학회, 2016)</p></div>
      </footer>
    </article>`;

    const intakes = days.flatMap(day => (day.caf?.intakes || []).filter(item => item.mg !== 0)
      .map(item => ({ ...item, date: day.date, bed: day.open ? null : day.bed })))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? 1440) - (b.time ?? 1440));
    const caffeineContent = intakes.length ? buildSummaryCaffeineCharts(intakes) : buildSummaryNoCaffeine(zero, days.length);
    const caffeineNote = [`섭취 ${intakes.length}번`, intakes.length ? `마신 날 ${new Set(intakes.map(item => item.date)).size}일` : '',
      zero.length ? `안 마신 날 ${zero.length}일` : ''].filter(Boolean).join(' · ');
    const habitOptions = {
      phone: ['안 함', '30분 미만', '30~60분', '60분 이상'],
      activity: ['안 함', '30분 미만', '30~60분', '60분 이상'],
      latency: ['15분 이내', '15~30분', '30~60분', '60분 이상'],
      awakenings: ['없음', '1번', '2번', '3회↑'],
      drowsy: ['없음', '조금 있었음', '꽤 힘들었음', '매우 심했음'],
    };
    const habits = (finding('sleepQuality')?.rows || []).filter(row => row.responses?.length);
    const byHabit = new Map(habits.map(row => [row.key, row]));
    const habitLabels = { phone: '자기 전 스마트폰', activity: '어제 신체활동', latency: '잠들기까지 걸린 시간', awakenings: '자다가 깬 횟수', drowsy: '낮 졸음' };
    const habitBars = Object.entries(habitLabels).map(([key, title]) => {
      const row = byHabit.get(key);
      if (!row) return '';
      const order = value => Math.max(0, habitOptions[key].indexOf(value) === -1 ? 2 : habitOptions[key].indexOf(value));
      return `<div class="summary-habit"><span>${title}</span><div class="summary-habit-bar">${[...row.responses]
        .sort((a, b) => order(a.value) - order(b.value)).map(item => `<span class="band-${order(item.value)}" style="flex:${item.n} 1 0"><span>${pdfText(item.value)}</span><span>${item.n}일</span></span>`).join('')}</div></div>`;
    }).join('');
    const phoneDates = finding('phoneBeforeBed')?.members || [[], []];
    const phoneGroups = phoneDates.map(list => { const keys = new Set(list); return validSleep.filter(day => keys.has(day.date)); });
    const phone = compare(phoneGroups, 'hours');
    const dNote = phone.means ? `자기 전 스마트폰을 30분 이상 쓴 밤(${phone.size[0]}일)은 수면시간이 평균 ${fixed(phone.means[0], '시간')}, 그보다 적게 사용했거나 사용하지 않은 밤(${phone.size[1]}일)은 ${fixed(phone.means[1], '시간')}이었어요.` : '';
    const good = [validSleep.length ? `수면은 ${closed.length}일 중 ${validSleep.length}일 기록했어요.` : '',
      zero.length ? `카페인을 안 마신 날도 ‘안 마심’으로 ${zero.length}일 남겼어요.` : ''].filter(Boolean);
    const sleepMissing = closed.filter(day => !day.recorded);
    const held = closed.filter(day => day.held);
    const conditionMissing = validSleep.filter(day => !Number.isFinite(day.condition));
    const incompleteIntakes = intakes.filter(item => !Number.isFinite(item.mg) || !Number.isFinite(item.time));
    const quantityMissing = incompleteIntakes.filter(item => !Number.isFinite(item.mg)).length;
    const timeMissing = incompleteIntakes.filter(item => !Number.isFinite(item.time)).length;
    const reviewDateLimit = 3;
    const reviewDates = entries => {
      const dates = [...new Set(entries.map(item => item.date))];
      const additional = dates.length - reviewDateLimit;
      return ` (${dates.slice(0, reviewDateLimit).map(pdfDay).join(', ')}${additional > 0 ? ` 외 ${additional}일` : ''})`;
    };
    const review = [sleepMissing.length ? `수면 기록이 비어 있는 밤은 ${sleepMissing.length}일이에요${reviewDates(sleepMissing)}.` : '',
      held.length ? `겹치거나 충돌해 수면 분석을 보류한 밤은 ${held.length}일이에요${reviewDates(held)}.` : '',
      conditionMissing.length ? `아침 컨디션이 빠진 밤은 ${conditionMissing.length}일이에요${reviewDates(conditionMissing)}.` : '',
      incompleteIntakes.length ? `섭취 기록에서 ${[quantityMissing ? `함량 ${quantityMissing}건` : '', timeMissing ? `시각 ${timeMissing}건` : ''].filter(Boolean).join('과 ')}이 빠졌어요${reviewDates(incompleteIntakes)}.` : ''].filter(Boolean);
    const lateEntries = feedback.engine.summaryLateEntries || [];
    const visibleLate = lateEntries.slice(0, reviewDateLimit);
    if (visibleLate.length) {
      const examples = visibleLate.map(({ kind, date, delayDays, count }) => {
        const when = delayDays === 1 ? '다음 날' : delayDays + '일 뒤';
        const topic = kind === 'sleep' ? '밤 수면' : '카페인';
        return pdfDay(date) + ' ' + topic + (count === 1 ? '은' : ' 기록 ' + count + '건은')
          + (kind === 'sleep' ? ' 일어난 ' : ' ') + when + ' 입력했어요.';
      });
      const additional = lateEntries.slice(reviewDateLimit).reduce((total, item) => total + item.count, 0);
      review.push(examples.join(' ') + (additional ? ' 외 ' + additional + '건' : ''));
    }
    const ranked = goals.filter(goal => goal.measured > 0).sort((a, b) => b.kept / b.measured - a.kept / a.measured);
    const best = ranked[0];
    const hardest = ranked.filter(goal => goal.kept < goal.measured).at(-1);
    const ratio = goal => `‘${goal.label}’는 확인한 ${goal.measured}일 중 ${goal.kept}일 지켰어요.`;
    const sample = hardest && validSleep.find(day => hardest.states.get(day.date)?.kept && Number.isFinite(day.bed));
    const plan = sample && ['range', 'bedtime', 'sleepMin'].includes(hardest.criterion || hardest.id) ?
      `‘${hardest.label}’를 지킨 ${pdfDay(sample.date)} 밤의 잠든 시각(${pdfClock(sample.bed)})을 다음 계획에 참고해 봐요.` : '';
    const reflectionText = feedback.summaryReflection || feedback.engine.summaryReflection?.rule;
    const reflection = [
      ['praise', '잘된 점', edit?.praise ?? reflectionText?.praise ?? (best ? ratio(best) : good[0])],
      ['difficulty', '어려웠던 점', edit?.difficulty ?? reflectionText?.difficulty ?? (hardest ? ratio(hardest) : '')],
      ['plan', '다음 계획', edit?.plan ?? reflectionText?.plan ?? plan],
    ];
    const noteKey = `${student?.학번 || student?.이름 || ''}|${start}|${end}`;
    const noteIndex = Array.from(noteKey).reduce((hash, char) => (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0, 0);
    const defaultMemo = cafDays.some(day => day.caf?.recorded) || validSleep.length
      ? teacherNoteExamples[noteIndex % teacherNoteExamples.length] : teacherNoteExamples[1];
    const memo = edit?.memo ?? (reportPlainText(feedback.savedPdfFeedback?.summary).trim() ||
      reportPlainText(feedback.summary).trim() || defaultMemo);
    const page2 = `<article class="summary-page" data-page="2"${visibleLate.length ? ' data-late="true"' : ''}><header class="summary-header">
      <p class="summary-kicker">카페인·수면 기록 요약 · 2쪽 자세히 보기</p><p class="summary-sub">${name} · ${period}</p></header>
      ${block('C. 카페인을 마신 날', caffeineContent.content + callout('caffeineDays', 'C. 카페인을 마신 날 설명', caffeineContent.note), caffeineNote)}
      ${block('D. 수면과 생활습관', (habitBars || '<p class="summary-note">표시할 생활습관 응답이 없어요.</p>') + callout('sleepHabits', 'D. 수면과 생활습관 설명', dNote, 'blue'), '밤 기록 중 고른 답 · 숫자는 일수')}
      <section class="summary-two">
        <div class="summary-record-card good"><h2>E. 기록 · 잘한 점</h2>${recordNote('recordGood', 'E. 기록 · 잘한 점', good.length ? good : ['아직 확인할 기록이 없어요.'])}</div>
        <div class="summary-record-card review"><h2>E. 기록 · 아쉬운 점</h2>${recordNote('recordReview', 'E. 기록 · 아쉬운 점', review.length ? review : ['확인한 기록에서 빠진 항목이 없어요.'])}${visibleLate.length ? '<small class="summary-note">저장 시각 기준이라 나중에 수정한 기록도 포함될 수 있어요.</small>' : ''}</div>
      </section>
      <section class="summary-section summary-reflections"><h2>F. 돌아보기</h2><div class="summary-three">
        ${reflection.map(([key, title, value]) => `<div class="summary-reflect-card"><h3>${title}</h3><p data-summary-text="${key}"${reportPlainText(value) ? '' : ' class="summary-note"'}>${reportTextHtml(reportPlainText(value) ? value : '기록에서 확인할 내용이 없어요.')}</p></div>`).join('')}
      </div><div class="summary-teacher"><b>선생님 한마디</b><p data-summary-text="memo">${reportTextHtml(memo)}</p></div></section>
    </article>`;
    const comparison = report.goalComparison && window.teacherGoalComparison;
    const firstPage = comparison ? comparison.renderPage(report.goalComparison, student?.이름 || '학생') : page1;
    const styles = comparison ? summaryStyles + comparison.styles : summaryStyles;
    return { styles, content: `<main class="summary-report" aria-label="카페인과 수면 기록 요약">${firstPage}${page2}</main>` };
  }

  const teacherNoteExamples = [
    '기록을 남겨 줘서 고마워요. 다음에는 실천하기 쉬운 것 한 가지부터 해 봐요.',
    '완벽하게 지키지 않아도 괜찮아요. 나에게 맞는 방법을 하나씩 찾아봐요.',
    '기록에서 발견한 점을 다음 계획에 하나만 써 봐요.',
    '이번에 해 보니 편했던 방법이 있다면, 다음에도 이어 가 봐요.',
  ];

  function createFeedbackTextEditor(content, { save, available = () => true } = {}) {
    const tools = document.getElementById('feedbackTextEditorTools').content.firstElementChild.cloneNode(true);
    content.before(tools);
    content.classList.add('ai-content');
    const editButton = tools.querySelector('[data-feedback-edit]');
    const saveButton = tools.querySelector('[data-feedback-save]');
    const cancelButton = tools.querySelector('[data-feedback-cancel]');
    const status = tools.querySelector('[role="status"]');
    const formatBar = tools.querySelector('.feedback-format-bar');
    let state = 'read', original = '', lastRange, revision = 0;

    function message(text = '', failure = false) {
      status.textContent = text;
      status.classList.toggle('error', failure);
    }

    function sync() {
      tools.hidden = content.hidden || !available();
      content.contentEditable = state === 'editing' ? 'true' : 'false';
      editButton.hidden = state !== 'read';
      saveButton.hidden = cancelButton.hidden = state === 'read';
      saveButton.disabled = cancelButton.disabled = state === 'saving';
      saveButton.textContent = state === 'saving' ? '저장 중…' : '💾 저장';
      formatBar.hidden = state !== 'editing';
    }

    function reset() {
      revision++;
      state = 'read';
      lastRange = undefined;
      message();
      sync();
      return api;
    }

    function start() {
      if (state !== 'read' || content.hidden || !available()) return;
      original = content.innerHTML;
      lastRange = undefined;
      state = 'editing';
      message();
      sync();
      content.focus({ preventScroll: true });
      tools.scrollIntoView({ block: 'nearest' });
    }

    function rememberSelection() {
      const selection = document.getSelection();
      if (state === 'editing' && selection?.rangeCount &&
          content.contains(selection.anchorNode) && content.contains(selection.focusNode)) {
        lastRange = selection.getRangeAt(0).cloneRange();
      }
    }

    const colors = { red: '#b91c1c', blue: '#1d4ed8', green: '#047857' };
    for (const button of formatBar.querySelectorAll('[data-format]')) {
      button.addEventListener('mousedown', event => { rememberSelection(); event.preventDefault(); });
      button.addEventListener('click', () => {
        if (state !== 'editing' || content.hidden) return;
        const format = button.dataset.format;
        rememberSelection();
        content.focus({ preventScroll: true });
        if (lastRange && content.contains(lastRange.commonAncestorContainer)) {
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(lastRange);
        }
        if (Object.hasOwn(colors, format)) document.execCommand('foreColor', false, colors[format]);
        else if (['bold', 'underline', 'removeFormat'].includes(format)) document.execCommand(format);
        rememberSelection();
      });
    }
    content.addEventListener('keyup', rememberSelection);
    content.addEventListener('pointerup', rememberSelection);
    content.addEventListener('reportviewchange', sync);
    editButton.addEventListener('click', start);
    cancelButton.addEventListener('click', () => {
      if (state !== 'editing') return;
      content.innerHTML = original;
      reset();
      editButton.focus({ preventScroll: true });
    });
    saveButton.addEventListener('click', async () => {
      if (state !== 'editing' || content.hidden || !available()) return;
      const current = ++revision;
      const html = window.safeRender.sanitizeRichHtml(content.innerHTML, { feedback: true });
      state = 'saving';
      message();
      sync();
      try {
        await save(html);
        if (current !== revision) return;
        content.innerHTML = html;
        state = 'read';
        message('✓ 저장됨');
      } catch (error) {
        if (current !== revision) return;
        state = 'editing';
        message(error?.message || '저장하지 못했습니다. 다시 시도해 주세요.', true);
      } finally {
        if (current === revision) {
          sync();
          if (!tools.hidden) (state === 'editing' ? content : editButton).focus({ preventScroll: true });
        }
      }
    });
    const api = { start, reset, message };
    return reset();
  }

  function addSummaryEditor(shadow, saveSummary) {
    const report = shadow.querySelector('.summary-report');
    const section = shadow.querySelector('.summary-reflections');
    const texts = [...report.querySelectorAll('[data-summary-text]')];
    const heading = document.createElement('div');
    heading.className = 'summary-edit-heading';
    const title = section.querySelector('h2');
    title.before(heading);
    heading.append(title);

    const button = (label, action) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.addEventListener('click', action);
      return element;
    };
    const top = document.createElement('div');
    top.className = 'summary-top-editor';
    const makeStatus = () => {
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.className = 'summary-note summary-edit-status';
      return status;
    };
    const status = makeStatus(), topStatus = makeStatus();
    const announce = message => { status.textContent = message; topStatus.textContent = message; };
    const toolbar = document.createElement('span');
    toolbar.className = 'summary-format-bar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', '보고서 문장 서식');
    toolbar.hidden = true;
    let activeField, lastRange;
    const selection = () => shadow.getSelection?.() || document.getSelection();
    const rememberSelection = () => {
      const current = selection();
      if (current.rangeCount && activeField?.contains(current.anchorNode) && activeField.contains(current.focusNode)) {
        lastRange = current.getRangeAt(0).cloneRange();
      }
    };
    const formats = [
      ['굵게', 'B', 'bold'], ['밑줄', 'U', 'underline'],
      ['빨간 글자색', '', 'foreColor', 'red', '#b91c1c'], ['파란 글자색', '', 'foreColor', 'blue', '#1d4ed8'],
      ['초록 글자색', '', 'foreColor', 'green', '#047857'], ['서식 지우기', '서식 지우기', 'removeFormat'],
    ].map(([label, glyph, command, color, value]) => {
      const control = button(glyph, () => {
        if (activeField?.contentEditable !== 'true') return;
        rememberSelection();
        activeField.focus({ preventScroll: true });
        if (lastRange && activeField.contains(lastRange.commonAncestorContainer)) {
          const current = selection();
          current.removeAllRanges();
          current.addRange(lastRange);
        }
        document.execCommand(command, false, value);
        rememberSelection();
      });
      if (color) control.className = 'format-swatch ' + color;
      if (command === 'bold') control.style.fontWeight = '800';
      if (command === 'underline') control.style.textDecoration = 'underline';
      control.title = label;
      control.setAttribute('aria-label', label);
      control.addEventListener('mousedown', event => { rememberSelection(); event.preventDefault(); });
      return control;
    });
    toolbar.append(...formats);
    const fields = new Map(texts.map(text => {
      const input = document.createElement('span');
      const key = text.dataset.summaryText;
      input.className = 'summary-field-editor';
      input.contentEditable = 'true';
      input.setAttribute('role', 'textbox');
      input.setAttribute('aria-multiline', 'true');
      input.setAttribute('aria-label', text.dataset.summaryLabel || text.previousElementSibling.textContent);
      input.hidden = true;
      input.addEventListener('focus', () => {
        if (activeField !== input) lastRange = undefined;
        activeField = input;
        if (toolbar.nextSibling !== input) input.before(toolbar);
        toolbar.hidden = false;
      });
      input.addEventListener('keyup', rememberSelection);
      input.addEventListener('pointerup', rememberSelection);
      input.addEventListener('paste', event => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
      });
      text.after(input);
      return [key, input];
    }));
    const sanitize = value => window.safeRender.sanitizeRichHtml(value, { report: true });
    const readField = input => {
      const text = input.innerText.trim();
      const html = sanitize(input.innerHTML).trim();
      return text && /<(?:b|strong|u|em|i)(?:\s|>)|style="color:/i.test(html) ? { text, html } : text;
    };
    let exampleIndex = 0, opener;
    const initial = new Map();
    const customized = new Set(texts.filter(text => text.closest('[data-summary-callout]')?.querySelector('[data-summary-prefix]')?.hidden)
      .map(text => text.dataset.summaryText));
    const begin = event => {
      opener = event.currentTarget;
      setEditing(true);
      for (const text of texts) {
        const key = text.dataset.summaryText;
        const input = fields.get(key);
        input.innerHTML = text.classList.contains('summary-note') ? '' : sanitize(text.innerHTML.trim());
        initial.set(key, JSON.stringify(readField(input)));
      }
      announce('글자를 선택해 서식을 적용할 수 있어요. 저장한 문장은 이미지와 PDF에도 반영됩니다.');
      fields.get(opener === topEdit ? 'caffeineSleep' : 'praise').focus();
    };
    const edit = button('보고서 문장 수정', begin), topEdit = button('보고서 문장 수정', begin);
    const examples = button('다른 예시 문구', () => {
      const memo = fields.get('memo');
      if (memo.innerText === teacherNoteExamples[exampleIndex]) exampleIndex = (exampleIndex + 1) % teacherNoteExamples.length;
      memo.textContent = teacherNoteExamples[exampleIndex];
      exampleIndex = (exampleIndex + 1) % teacherNoteExamples.length;
      memo.focus();
    });
    examples.dataset.summaryExample = '';
    fields.get('memo').after(examples);
    const cancelEdit = () => {
      announce('');
      setEditing(false);
      opener.focus();
    };
    const saveEdit = async () => {
      const values = Object.fromEntries([...fields]
        .map(([key, input]) => [key, readField(input)])
        .filter(([key, value]) => JSON.stringify(value) !== initial.get(key)));
      if (!Object.keys(values).length) {
        cancelEdit();
        return;
      }
      const controls = [...formats, examples, save, cancel, topSave, topCancel];
      for (const control of controls) control.disabled = true;
      for (const field of fields.values()) field.contentEditable = 'false';
      announce('저장 중…');
      try {
        const saved = await saveSummary(values) || values;
        for (const text of texts) {
          const key = text.dataset.summaryText;
          if (!Object.hasOwn(saved, key)) continue;
          const emptyReflection = ['praise', 'difficulty', 'plan'].includes(key) && !reportPlainText(saved[key]);
          customized.add(key);
          text.innerHTML = reportTextHtml(emptyReflection ? '기록에서 확인할 내용이 없어요.' : saved[key]);
          text.classList.toggle('summary-note', emptyReflection);
        }
        setEditing(false);
        announce('보고서 문장을 저장했습니다.');
        opener.focus();
      } catch {
        announce('저장하지 못했습니다. 다시 시도해 주세요.');
      } finally {
        for (const control of controls) control.disabled = false;
        for (const field of fields.values()) field.contentEditable = 'true';
      }
    };
    const save = button('보고서 문장 저장', saveEdit), cancel = button('취소', cancelEdit);
    const topSave = button('보고서 문장 저장', saveEdit), topCancel = button('취소', cancelEdit);
    topEdit.dataset.summaryEdit = '';
    topSave.dataset.summarySave = '';
    topSave.setAttribute('aria-keyshortcuts', 'Control+s Meta+s');
    save.setAttribute('aria-keyshortcuts', 'Control+s Meta+s');
    for (const control of [topEdit, topSave, topCancel]) control.className = 'btn btn-sm';
    top.append(topEdit, topSave, topCancel, topStatus);
    const actions = document.createElement('div');
    actions.className = 'summary-edit-actions';
    actions.append(save, cancel);
    heading.append(edit);
    section.append(actions, status);
    function setEditing(editing) {
      edit.hidden = topEdit.hidden = editing;
      actions.hidden = topSave.hidden = topCancel.hidden = examples.hidden = !editing;
      section.classList.toggle('is-editing', editing);
      if (!editing) { toolbar.hidden = true; activeField = lastRange = undefined; }
      for (const text of texts) {
        text.hidden = editing;
        fields.get(text.dataset.summaryText).hidden = !editing;
        const callout = text.closest('[data-summary-callout]');
        if (callout) {
          callout.hidden = !editing && !text.textContent.trim();
          callout.querySelector('[data-summary-prefix]').hidden = editing || customized.has(text.dataset.summaryText);
        }
      }
    }
    setEditing(false);
    return top;
  }

  function renderFeedbackReportView(target, report, text, { preferText = false, saveSummary } = {}) {
    target.replaceChildren();
    text.hidden = false;
    if (!report.feedback?.engine) return;
    const view = document.createElement('div');
    const shadow = view.attachShadow({ mode: 'open' });
    const { styles, content } = buildSummaryReportDocument(report);
    const style = document.createElement('style');
    style.textContent = styles;
    const template = document.createElement('template');
    template.innerHTML = content;
    shadow.append(style, template.content);
    const editor = saveSummary ? addSummaryEditor(shadow, saveSummary) : null;
    const controls = document.createElement('div');
    controls.className = 'report-view-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '피드백 표시 및 편집');
    const reportButton = document.createElement('button');
    const textButton = document.createElement('button');
    reportButton.textContent = '보고서 보기';
    reportButton.dataset.feedbackView = 'report';
    textButton.textContent = '피드백 문장 보기';
    textButton.dataset.feedbackView = 'text';
    for (const button of [reportButton, textButton]) {
      button.type = 'button';
      button.className = 'btn btn-sm';
    }
    const show = reportVisible => {
      view.hidden = !reportVisible;
      text.hidden = reportVisible;
      if (editor) editor.hidden = !reportVisible;
      reportButton.setAttribute('aria-pressed', String(reportVisible));
      textButton.setAttribute('aria-pressed', String(!reportVisible));
      text.dispatchEvent(new Event('reportviewchange'));
    };
    reportButton.addEventListener('click', () => show(true));
    textButton.addEventListener('click', () => show(false));
    if (preferText) controls.append(textButton, reportButton);
    else controls.append(reportButton, textButton);
    const mode = text.querySelector('.report-feedback-mode');
    if (mode) {
      const status = document.createElement('span');
      status.className = 'report-feedback-mode';
      status.textContent = mode.textContent;
      controls.append(status);
    }
    if (editor) controls.append(editor);
    target.append(controls, view);
    show(!preferText);
  }

  window.teacherReportFiles = { parseGoalCsv, createPdfZip, goalColumns, loadReportPdf, renderFeedback, renderSavedFeedback, readSavedPdfFeedback, buildGoalPdfDocument, buildSummaryReportDocument, renderFeedbackReportView, createFeedbackTextEditor };
}());
