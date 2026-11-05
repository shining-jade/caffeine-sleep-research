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
        : feedback.mode === 'ai' ? (feedback.engine ? 'AI 분석 · 설명 문장 다듬기' : 'AI 분석 · 실천 제안 우선순위 반영') : '규칙 기반 분석';
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
    const dates = [...days.map(day => day.date), pdfWakeDate(days.at(-1))];
    const width = phone ? 330 : 690;
    const spacing = (width - 61) / (dates.length - 1);
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
      const bed = day.bed === null ? label(x(i) - 2, 95, '–') :
        (previous?.bed != null ? line(x(i - 1), y(previous.bed), x(i), y(day.bed), '#655ab5') : '')
        + `<circle cx="${x(i)}" cy="${y(day.bed)}" r="3" fill="#655ab5" />`;
      const wakeX = x(i + 1);
      const wakeDate = dates[i + 1];
      const score = day.condition == null ? label(wakeX - 2, 127, '–')
        : `<rect x="${wakeX - 3}" y="${129 - day.condition * 5}" width="6" height="${day.condition * 5}" fill="#4c9780" data-wake-date="${pdfText(wakeDate)}"><title>${pdfDay(wakeDate)} 기상 후 컨디션 ${day.condition}점</title></rect>`;
      return bed + score;
    }).join('');
    const last = dates.length - 1;
    const step = Math.ceil(30 / spacing);
    const dateLabels = dates.map((date, i) => i === 0 || i === last || (i % step === 0 && (last - i) * spacing >= 30)
      ? label(x(i) - 10, 146, pdfDay(date)) : '').join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 152" width="100%" role="img" aria-label="취침 시각과 기상일별 컨디션">${guides}${targets}${label(1, 118, '컨디션')}${points}${dateLabels}</svg>`
      + '<small>보라색 점은 그날 밤에 잠자리에 든 시각이에요. 자정을 넘겨 잠자리에 든 시각은 전날 밤에 표시해요. 초록색 막대는 기상일의 컨디션(1~5점), 갈색 선은 목표 취침 시각이에요. –는 기록이 없음을 뜻해요. 21시 전이나 03시 후에 잠자리에 든 시각은 그래프 끝에 표시해요.</small>'
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
    const mark = decision => decision === true ? '✓' : decision === false ? '×' : '–';
    const markSummary = goal => goal.source === 'class' && !goal.criterion ? '앱 기록으로 확인할 수 없는 목표예요.'
      : goal.measured ? goal.kept + ' / ' + goal.measured + '일' : '확인할 기록 없음';
    const calendar = '<div class="goal-calendar">' + displayDays.map(day => {
      const decision = goals[0]?.days.find(item => item.date === day.date)?.kept;
      return '<span class="score-' + (day.condition ?? 0) + '" data-mark="' + mark(decision) + '">'
        + pdfDay(pdfWakeDate(day)) + '<br>' + (day.condition == null ? '–' : day.condition + '점')
        + (goals.length ? ' ' + mark(decision) : '') + '</span>';
    }).join('') + '</div><small>날짜와 점수는 기상일과 기상 후 컨디션이에요.'
      + (goals.length ? ' 목표 표시는 기상 전날 기준이에요. ✓ 지킴, × 못 지킴, – 확인할 기록 없음 또는 목표 기간 외.' : ' – 컨디션 기록 없음.') + '</small>';
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
        pdfShort(goal.label, phone ? 40 : 72), markSummary(goal), goal.days.filter(day => dateSet.has(day.date)).map(day => pdfDay(day.date) + ' ' + mark(day.kept)).join('  '),
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

  function renderFeedbackReportView(target, report, text, { preferText = false } = {}) {
    target.replaceChildren();
    text.hidden = false;
    if (!report.feedback?.engine) return;
    const view = document.createElement('div');
    const shadow = view.attachShadow({ mode: 'open' });
    const { styles, content } = buildGoalPdfDocument(report, {
      includeAi: true, includeMainChart: true, includePattern: true, includeCaffeineRecords: true,
      includeSleepRecords: true, maxRecordRows: 5,
    }, 'screen');
    const style = document.createElement('style');
    style.textContent = styles + `
      :host{display:block;color:#17263b;font:14px/1.5 system-ui,sans-serif}
      :host([hidden]){display:none}
      .goal-page{break-after:auto;page-break-after:auto}
      .goal-card{margin-bottom:10px;padding:10px 12px}
      .goal-page footer{display:none}
      .goal-record{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px 10px}
      .goal-record dd,.goal-record-group dd{overflow-wrap:anywhere}
      .goal-record dt,.goal-record-group dt,small{font-size:12px}
      @media(max-width:430px){
        .goal-record,.goal-sleep-record{grid-template-columns:repeat(2,minmax(0,1fr))}
        .goal-sleep-record .goal-record-group:first-child{grid-column:1/-1;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid #dce4ef;padding-bottom:4px}
        .goal-sleep-record .goal-record-group:nth-child(2){border-left:0;padding-left:0}
        h1{font-size:18px}h2{font-size:14px}table{font-size:12px}
      }
    `;
    const template = document.createElement('template');
    template.innerHTML = content;
    shadow.append(style, template.content);
    const controls = document.createElement('div');
    controls.className = 'report-view-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '피드백 표시 방식');
    const reportButton = document.createElement('button');
    const textButton = document.createElement('button');
    reportButton.textContent = '보고서 보기';
    textButton.textContent = '피드백 문장 보기';
    textButton.dataset.feedbackView = 'text';
    for (const button of [reportButton, textButton]) {
      button.type = 'button';
      button.className = 'btn btn-sm';
    }
    const show = reportVisible => {
      view.hidden = !reportVisible;
      text.hidden = reportVisible;
      reportButton.setAttribute('aria-pressed', String(reportVisible));
      textButton.setAttribute('aria-pressed', String(!reportVisible));
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
    target.append(controls, view);
    show(!preferText);
  }

  window.teacherReportFiles = { parseGoalCsv, createPdfZip, goalColumns, loadReportPdf, renderFeedback, renderSavedFeedback, readSavedPdfFeedback, buildGoalPdfDocument, renderFeedbackReportView };
}());
