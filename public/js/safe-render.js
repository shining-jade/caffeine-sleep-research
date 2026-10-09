(function installSafeRender() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, function(character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character];
    });
  }

  function sanitizeRichHtml(value) {
    var template = document.createElement('template');
    template.innerHTML = String(value ?? '');
    var allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'DIV', 'SPAN', 'A']);
    Array.from(template.content.querySelectorAll('*')).forEach(function(element) {
      if (!allowed.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ''));
        return;
      }
      var originalHref = element.tagName === 'A' ? element.getAttribute('href') || '' : '';
      Array.from(element.attributes).forEach(function(attribute) { element.removeAttribute(attribute.name); });
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
      const label = url.includes('drive.google.com') || (url === attachmentUrl && message.attachmentType === 'pdf') ? 'PDF 열기' : '링크 열기';
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
    return rendered;
  }

  window.safeRender = Object.freeze({ escapeHtml, sanitizeRichHtml, formatTimestamp, formatMsgDate, formatMessageContent });
}());
