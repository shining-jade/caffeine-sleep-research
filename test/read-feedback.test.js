import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/js/read-feedback.js',import.meta.url),'utf8');
class Element {
  constructor(){this.children=[];this.attributes={};this.style={};this.hidden=false;this.listeners={};}
  appendChild(child){this.children.push(child);child.parentNode=this;}
  insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);child.parentNode=this;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(name,fn){this.listeners[name]=fn;}
  remove(){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);}
}
function setup(){
  const parent=new Element(),container=new Element(),card=new Element();
  card.draft='unsent reply';card.checked=true;container.appendChild(card);parent.appendChild(container);
  const window={};vm.runInNewContext(source,{window,document:{createElement:()=>new Element()}});
  return {feedback:window.ReadFeedback,parent,container,card};
}
test('read feedback keeps the exact card node, draft and selection throughout failed refresh and retry',()=>{
  const {feedback,parent,container,card}=setup();let retries=0;
  const retry=()=>{retries++;feedback.begin(container,retry);};
  assert.equal(feedback.begin(container,retry),true);
  const notice=parent.children[0],text=notice.children[0],button=notice.children[1];
  feedback.success(container);
  feedback.begin(container,retry);feedback.fail(container,retry);
  assert.match(text.textContent,/마지막으로 확인한/);
  assert.equal(notice.hidden,false);
  assert.equal(container.children[0],card);
  assert.equal(card.draft,'unsent reply');assert.equal(card.checked,true);
  assert.equal(container.attributes['aria-busy'],undefined);
  button.listeners.click();button.listeners.click();assert.equal(retries,1);
  feedback.success(container);assert.equal(notice.hidden,true);
});

test('refresh requested during a read queues a fresh request and rejects its older snapshot',()=>{
  const {feedback,container}=setup();let reads=0;
  const retry=()=>{reads++;return feedback.begin(container,retry);};
  assert.equal(retry(),true);
  assert.equal(retry(),false);assert.equal(retry(),false);
  assert.equal(feedback.success(container),false,'prewrite response must not render');
  assert.equal(reads,4,'only one queued read starts');
  assert.equal(container.attributes['aria-busy'],'true');
  assert.equal(feedback.success(container),true);
});
test('initial failure never claims confirmed content and reset removes private read state',()=>{
  const {feedback,parent,container}=setup();
  feedback.begin(container,()=>{});feedback.fail(container);
  assert.match(parent.children[0].children[0].textContent,/다시 조회/);
  assert.doesNotMatch(parent.children[0].children[0].textContent,/마지막으로/);
  feedback.success(container);feedback.reset();assert.equal(parent.children.length,1);
  feedback.begin(container,()=>{});feedback.fail(container);
  assert.doesNotMatch(parent.children[0].children[0].textContent,/마지막으로/);
});
test('notification warning remains until every failed read category recovers',()=>{
  const {feedback,parent,container}=setup();
  feedback.report(container,'messages',true,()=>{});
  feedback.report(container,'awards',true,()=>{});
  feedback.report(container,'messages',false,()=>{});
  assert.equal(parent.children[0].hidden,false);
  feedback.report(container,'replies',false,()=>{});
  assert.equal(parent.children[0].hidden,false);
  feedback.report(container,'awards',false,()=>{});
  assert.equal(parent.children[0].hidden,true);
});
