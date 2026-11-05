(function installSafeRender() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, function(character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character];
    });
  }

  const feedbackPalette = new Map([
    ['#b91c1c', '#b91c1c'], ['rgb(185,28,28)', '#b91c1c'], ['#ef4444', '#b91c1c'], ['rgb(239,68,68)', '#b91c1c'],
    ['#1d4ed8', '#1d4ed8'], ['rgb(29,78,216)', '#1d4ed8'],
    ['#047857', '#047857'], ['rgb(4,120,87)', '#047857'],
  ]);
  const feedbackClasses = new Set([
    'report-feedback', 'report-feedback-mode', 'report-feedback-lead', 'report-feedback-card',
    'report-feedback-title', 'report-feedback-items', 'report-feedback-note', 'report-feedback-sources',
    'report-feedback-metrics', 'report-feedback-metric', 'report-feedback-label', 'report-feedback-value', 'report-feedback-detail',
    'report-feedback-caffeine', 'report-feedback-sleep', 'report-feedback-habit', 'report-feedback-goal', 'report-feedback-next',
  ]);

  function sanitizeRichHtml(value, { feedback = false, report = false } = {}) {
    var template = document.createElement('template');
    template.innerHTML = String(value ?? '');
    var allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'DIV', 'SPAN', 'A']);
    if (feedback) for (const tag of ['SECTION', 'SMALL', 'U', 'FONT']) allowed.add(tag);
    if (report) {
      allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'U', 'EM', 'I', 'SPAN', 'FONT']);
    }
    Array.from(template.content.querySelectorAll('*')).forEach(function(element) {
      if (!allowed.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ''));
        return;
      }
      var originalHref = element.tagName === 'A' ? element.getAttribute('href') || '' : '';
      const color = (feedback || report) && feedbackPalette.get((element.style.color || element.getAttribute('color') || '').replace(/\s/g, '').toLowerCase());
      const classes = feedback ? [...element.classList].filter(value => feedbackClasses.has(value)) : [];
      const block = report && ['P', 'DIV'].includes(element.tagName);
      if (block || ((feedback || report) && element.tagName === 'FONT')) {
        if (block && element.previousSibling && element.previousSibling.nodeName !== 'BR') {
          element.before(document.createElement('br'));
        }
        const span = document.createElement('span');
        span.append(...element.childNodes);
        element.replaceWith(span);
        element = span;
      }
      Array.from(element.attributes).forEach(function(attribute) { element.removeAttribute(attribute.name); });
      if (classes.length) element.className = classes.join(' ');
      if (color) element.style.color = color;
      if (element.tagName === 'A') {
        if (/^https?:\/\//i.test(originalHref)) {
          element.setAttribute('href', originalHref);
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
    return template.innerHTML;
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).substring(0, 16).replace('T', ' ');
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatMsgDate(ts) {
    if (!ts) return '';
    const d = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(d)) return ts;
    const days = ['일','월','화','수','목','금','토'];
    return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}.(${days[d.getDay()]})`;
  }

  function messageUrl(rawUrl) {
    let url = rawUrl;
    const pairs = { ')': '(', ']': '[', '}': '{' };
    while (pairs[url.at(-1)]) {
      const closing = url.at(-1);
      const opening = pairs[closing];
      if (url.split(closing).length <= url.split(opening).length) break;
      url = url.slice(0, -1);
    }
    return url;
  }

  function formatMessageContent(content, message = {}, role = 'student') {
    const text = String(content || '');
    const attachmentUrl = String(message.attachmentUrl || '').trim();
    const bodyUrls = [];
    const color = role === 'teacher' ? '#3b82f6' : '#10b981';
    const link = url => {
      const label = url.includes('drive.google.com') || (url === attachmentUrl && message.attachmentType === 'pdf')
        || url.startsWith('/api/student/action?report=') ? 'PDF 열기' : '링크 열기';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;background:${color};color:white;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;text-decoration:none;">📎 ${label}</a>`;
    };
    let end = 0;
    let rendered = '';
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'“”‘’]+/gi)) {
      const url = messageUrl(match[0]);
      bodyUrls.push(url);
      rendered += escapeHtml(text.slice(end, match.index)) + link(url);
      end = match.index + url.length;
    }
    rendered += escapeHtml(text.slice(end));
    if (/^https?:\/\/[^\s<>"'“”‘’]+$/i.test(attachmentUrl) && !bodyUrls.includes(attachmentUrl)) rendered += '\n\n' + link(attachmentUrl);
    if (message.attachmentType === 'privatePdf' && /^[a-f0-9]{64}$/.test(message.messageKey || '')) {
      const viewer = role === 'teacher' ? '&viewer=teacher' : '';
      rendered += '\n\n' + link('/api/student/action?report=' + message.messageKey + viewer);
    }
    return rendered;
  }

  window.safeRender = Object.freeze({ escapeHtml, sanitizeRichHtml, formatTimestamp, formatMsgDate, formatMessageContent });
}());
