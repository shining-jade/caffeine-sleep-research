import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

for (const page of ['index.html', 'teacher/index.html']) {
  const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
  const start = html.indexOf('function formatTeacherMsgContent(');
  const end = html.indexOf('\n' + (page === 'index.html' ? '    function loadMyInquiries' : 'let allInquiries'), start);
  const context = vm.createContext({window:{}});
  vm.runInContext(readFileSync(new URL('../public/js/safe-render.js',import.meta.url),'utf8'),context);
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
  test(`${page}: quote and HTML-looking boundaries stay outside the URL`, () => {
    for (const [body, tail] of [['"https://example.invalid/report.pdf"','&quot;'], ['https://example.invalid/report.pdf<em>안내</em>','&lt;em&gt;안내&lt;/em&gt;']]) {
      const rendered = context.formatTeacherMsgContent(body,{attachmentUrl:'https://example.invalid/report.pdf',attachmentType:'pdf'});
      assert.match(rendered,/href="https:\/\/example\.invalid\/report\.pdf"/);
      assert.equal((rendered.match(/<a /g)||[]).length,1);
      assert.ok(rendered.endsWith(tail));assert.match(rendered,/PDF 열기/);
    }
  });
  test(`${page}: surrounding closing parentheses stay outside links while balanced URL parentheses remain`, () => {
    const rendered=context.formatTeacherMsgContent('(https://example.invalid/report_(part).pdf)');
    assert.match(rendered,/href="https:\/\/example\.invalid\/report_\(part\)\.pdf"/);
    assert.ok(rendered.endsWith(')'));
    assert.match(context.formatTeacherMsgContent('https://example.invalid/report_(part)'),/href="https:\/\/example\.invalid\/report_\(part\)"/);
  });
  test(`${page}: query strings and encoded delimiters are preserved`, () => {
    const rendered=context.formatTeacherMsgContent('https://example.invalid/report.pdf?a=1&b=%22text%22#page=2');
    assert.match(rendered,/href="https:\/\/example\.invalid\/report\.pdf\?a=1&amp;b=%22text%22#page=2"/);
  });
  test(`${page}: message links preserve the role color`, () => {
    const rendered=context.formatTeacherMsgContent('https://example.invalid/report.pdf');
    assert.match(rendered,new RegExp('background:'+(page==='index.html'?'#10b981':'#3b82f6')));
  });
}
test('shared date formatting retains existing timestamp, weekday and invalid-value behavior',()=>{
 const context=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../public/js/safe-render.js',import.meta.url),'utf8'),context);
 assert.equal(context.window.safeRender.formatTimestamp('2026-10-09T12:00:00'),'2026.10.09 12:00');
 assert.equal(context.window.safeRender.formatMsgDate('2026-10-09 12:00:00'),'2026.10.9.(금)');
 assert.equal(context.window.safeRender.formatTimestamp('invalid T date'),'invalid   date');
 assert.equal(context.window.safeRender.formatMsgDate('invalid date'),'invalid date');
});
