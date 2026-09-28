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

  window.safeRender = Object.freeze({ escapeHtml: escapeHtml, sanitizeRichHtml: sanitizeRichHtml });
}());
