import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../../',import.meta.url);
test('server and browser share the exact same badge model',()=>{
 const client=fs.readFileSync(new URL('vercel/public/js/badge-journey.js',root),'utf8').trim();
 const server=fs.readFileSync(new URL('gas/Code.js',root),'utf8');
 const start=server.indexOf('(function attachBadgeJourney(root) {');
 const end=server.indexOf('})(globalThis);',start)+'})(globalThis);'.length;
 assert.equal(server.slice(start,end).replace(/\r\n/g,'\n'),client.replace(/\r\n/g,'\n'));
 new vm.Script(server,{filename:'gas/Code.js'});
});
for(const path of ['vercel/index.html','vercel/teacher/index.html'])test(path+' inline scripts parse',()=>{
 const html=fs.readFileSync(new URL(path,root),'utf8');let checked=0;
 for(const [full,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/.test(attrs)||!body.trim()||/\btype\s*=\s*["'](?:module|application\/)/.test(attrs))continue;
  new vm.Script(body,{filename:path+'#script-'+checked++});
 }
 assert.ok(checked>0);
});
