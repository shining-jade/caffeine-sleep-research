import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';
test('first worker installation precaches every local student script before taking control',async()=>{
 const events={},cached=new Set();let installed,claimed=false;
 const cache={async addAll(urls){urls.forEach(url=>cached.add(url));},async add(){}};
 const c=vm.createContext({self:{location:{origin:'https://example.test'},addEventListener:(name,handler)=>events[name]=handler,skipWaiting(){claimed=true;}},URL,Request,caches:{async open(){return cache;}}});
 vm.runInContext(fs.readFileSync('public/sw.js','utf8'),c);
 events.install({waitUntil(promise){installed=promise;}});await installed;
 const html=fs.readFileSync('index.html','utf8');
 const scripts=Array.from(html.matchAll(/<script\b[^>]*\bsrc="(\/public\/js\/[^\"]+)"/g),match=>match[1]);
 assert.ok(scripts.length>0);assert.equal(claimed,true);
 for(const script of scripts)assert.ok(cached.has(script),`Missing offline startup dependency: ${script}`);
});
test('offline worker handles student shell and never caches authenticated API responses',()=>{const events={};const c=vm.createContext({self:{location:{origin:'https://example.test'},addEventListener:(n,f)=>events[n]=f},URL});vm.runInContext(fs.readFileSync('public/sw.js','utf8'),c);assert.equal(typeof events.fetch,'function');let handled=false;events.fetch({request:{url:'https://example.test/api/student/session',method:'GET',mode:'cors'},respondWith(){handled=true;}});assert.equal(handled,false);});
