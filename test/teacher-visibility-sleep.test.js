import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html=readFileSync(new URL('../teacher/index.html',import.meta.url),'utf8');
function extract(name){const start=html.indexOf('function '+name+'(');const next=html.indexOf('\nfunction ',start+1);return html.slice(start,next);}
test('sleep goal is explicitly unset until both times are configured',()=>{
 const context=vm.createContext({infoData:[],getPersonalInfo:id=>context.infoData.find(i=>i.학번===id)||null});
 vm.runInContext(['getTargetSleepText','getTargetSleepCompactText','getSleepDurationText'].map(extract).join('\n'),context);
 assert.equal(context.getTargetSleepText('2101'),'미설정');
 assert.equal(context.getTargetSleepCompactText('2101'),'미설정');
 context.infoData=[{학번:'2101',목표취침:'23:00'}];
 assert.equal(context.getTargetSleepText('2101'),'미설정');
 context.infoData=[{학번:'2101',목표취침:'23:00',목표기상:'07:00'}];
 assert.equal(context.getTargetSleepText('2101'),'23:00 / 07:00 (총 8시간)');
});
test('test inclusion is visible on student list and settings and survives reload',()=>{
 assert.match(html,/id="studentTestToggle"/);
 assert.match(html,/id="settingsTestToggle"/);
 let refreshes=0;
 const storage=new Map();const elements={};
 for(const id of ['overviewTestToggle','cafTestToggle','sleepTestToggle','studentTestToggle','settingsTestToggle'])elements[id]={style:{}};
 const context=vm.createContext({localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},document:{getElementById:id=>elements[id]},refreshAnalysisVisibility:()=>refreshes++});
 const start=html.indexOf('let showTestStudents=');const end=html.indexOf('// 탭별 날짜',start);
 vm.runInContext(html.slice(start,end)+'\nsyncTestStudentsControls();toggleTestStudents();',context);
 assert.equal(refreshes,1);
 assert.equal(elements.studentTestToggle.textContent,'테스트 포함 ✓');
 assert.equal(elements.settingsTestToggle.textContent,'테스트 포함 ✓');
 const reload=vm.createContext({localStorage:context.localStorage,document:context.document,refreshAnalysisVisibility(){}});
 vm.runInContext(html.slice(start,end)+'\nsyncTestStudentsControls();',reload);
 assert.equal(vm.runInContext('showTestStudents',reload),true);
});
