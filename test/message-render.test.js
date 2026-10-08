import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

for (const page of ['index.html', 'teacher/index.html']) {
  const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
  const start = html.indexOf('function formatTeacherMsgContent(');
  const end = html.indexOf('\n' + (page === 'index.html' ? '    function loadMyInquiries' : 'let allInquiries'), start);
  const context = vm.createContext({});
  vm.runInContext(html.slice(start, end), context);

  test(`${page}: attachment-only messages expose a PDF link`, () => {
    const rendered = context.formatTeacherMsgContent('합성 메시지', { attachmentUrl: 'https://example.invalid/report.pdf', attachmentType: 'pdf' });
    assert.match(rendered, /href="https:\/\/example\.invalid\/report\.pdf"/);
    assert.match(rendered, /PDF 열기/);
  });

  test(`${page}: legacy PDF links are not duplicated`, () => {
    const rendered = context.formatTeacherMsgContent('PDF 링크: https://example.invalid/report.pdf', { attachmentUrl: 'https://example.invalid/report.pdf', attachmentType: 'pdf' });
    assert.equal((rendered.match(/<a /g) || []).length, 1);
  });

  test(`${page}: message URLs cannot inject HTML attributes`, () => {
    const rendered = context.formatTeacherMsgContent('https://example.invalid/"onmouseover="alert(1)');
    assert.doesNotMatch(rendered, /href="[^"]*"onmouseover=/);
    assert.match(rendered, /&quot;/);
  });

  test(`${page}: script attachments are not rendered as links`, () => {
    const rendered = context.formatTeacherMsgContent('합성 메시지', { attachmentUrl: 'javascript:alert(1)', attachmentType: 'pdf' });
    assert.doesNotMatch(rendered, /<a /);
  });

  test(`${page}: uppercase HTTPS attachments remain clickable`, () => {
    const rendered = context.formatTeacherMsgContent('합성 메시지', { attachmentUrl: 'HTTPS://example.invalid/report.pdf', attachmentType: 'pdf' });
    assert.match(rendered, /href="HTTPS:\/\/example\.invalid\/report\.pdf"/);
  });

  test(`${page}: a similar body URL never hides a distinct attachment`, () => {
    const rendered = context.formatTeacherMsgContent('이전 링크: https://example.invalid/report.pdf.backup', { attachmentUrl: 'https://example.invalid/report.pdf', attachmentType: 'pdf' });
    assert.match(rendered, /href="https:\/\/example\.invalid\/report\.pdf"/);
    assert.equal((rendered.match(/<a /g) || []).length, 2);
  });
}
