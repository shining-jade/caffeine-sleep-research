import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('all inline teacher scripts parse with the statistics module outside PDF templates',()=>{
 const html=fs.readFileSync('teacher/index.html','utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if(/\bsrc=/.test(match[1]) || /\btype="module"/.test(match[1])) continue;
  assert.doesNotThrow(()=>new vm.Script(match[2]));
 }
});
