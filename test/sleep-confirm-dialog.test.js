import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function showSeparateSleepConfirm('),fn=html.slice(start,html.indexOf('\n    }',start)+6);
function setup(){const selectors=new Map(),events=new Map();let modal;const edits=[],adds=[];
 function element(){return {children:[],style:{},attributes:{},innerHTML:'',textContent:'',setAttribute(k,v){this.attributes[k]=v;},appendChild(x){this.children.push(x);},querySelector(q){if(!selectors.has(q))selectors.set(q,element());return selectors.get(q);},addEventListener(k,v){events.set(k,v);},focus(){},remove(){this.removed=true;}};}
 const c=vm.createContext({document:{getElementById:()=>null,createElement:element,body:{appendChild(e){modal=e;}}},escapeHtml:String,openEditModal:(...p)=>edits.push(p)});
 vm.runInContext(fn,c);const records=[{id:'first',date:'2026-10-19',wakeDate:'2026-10-20',start:'23:30',end:'06:30'},{id:'second',date:'2026-10-20',wakeDate:'2026-10-21',start:'23:30',end:'06:30'}];
 c.showSeparateSleepConfirm('합성 확인',records,()=>adds.push(true),{start:'2026-10-20T02:30',end:'2026-10-20T06:30'});
 return {modal,selectors,events,edits,adds};
}
test('review identifies the new raw interval separately from saved records without saving',()=>{const f=setup();assert.equal(f.selectors.get('[data-new-start]')?.textContent,'2026-10-20 02:30');assert.equal(f.selectors.get('[data-new-end]')?.textContent,'2026-10-20 06:30');assert.equal(f.modal.attributes['aria-labelledby'],'sleepReviewTitle');assert.equal(f.adds.length,0);assert.equal(f.edits.length,0);});
test('visible record-edit actions retain the exact selected ID and never add a draft',()=>{const f=setup(),button=f.selectors.get('[data-records]').children[1].children[0];assert.match(button.attributes['aria-label']||'',/^이 기록 수정:/);button.onclick();assert.deepEqual(f.edits,[['sleep','second']]);assert.equal(f.adds.length,0);});
test('Escape dismisses review without selecting a record or saving the draft',()=>{const f=setup();assert.equal(typeof f.events.get('keydown'),'function');f.events.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(f.modal.removed,true);assert.equal(f.adds.length,0);assert.equal(f.edits.length,0);});
test('explicit new-record action invokes the existing add callback only',()=>{const f=setup();assert.match(f.modal.innerHTML,/새 수면 기록 추가/);f.selectors.get('[data-add]').onclick();assert.equal(f.adds.length,1);assert.equal(f.edits.length,0);assert.equal(f.modal.removed,true);});
