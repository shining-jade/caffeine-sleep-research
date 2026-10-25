import {installHistoryView} from './support/history-view.js';
import {SleepRecordPolicy} from './support/sleep-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name){const start=html.indexOf(`    function ${name}(`);return start<0?'':html.slice(start,html.indexOf('\n    }',start)+6);}
function element(){
 const classes=new Set(),selectors=new Map();let markup='';
 return {children:[],dataset:{},style:{},className:'',textContent:'',value:'',disabled:false,scrolls:0,
 classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
 get innerHTML(){return markup;},set innerHTML(v){markup=v;this.children=[];},
 appendChild(child){this.children.push(child);},addEventListener(){},setAttribute(){},scrollIntoView(){this.scrolls++;},
 querySelector(selector){if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector);}};
}
function setup({caffeine=[],sleep=[],active=true}={}){
 const elements=Object.fromEntries(['calendarTitle','calendarGrid','calendarDetailPanel','calendarDetailDate','calendarDetailContent','tab-calendar','caffeineLogsContainer','sleepLogsContainer'].map(id=>[id,element()]));
 if(active)elements['tab-calendar'].classList.add('active');elements.calendarDetailPanel.classList.add('hidden');
 const clicked=[];
 const c=vm.createContext({SleepRecordPolicy,window:{},Date,calendarYear:2026,calendarMonth:9,caffeineLogs:caffeine,sleepLogs:sleep,teacherAwards:[],pendingCaffeineSave:null,caffeineHistoryLoaded:true,
 user:{studentId:'fictional',name:'가상'},lastDashboardData:null,
 document:{getElementById:id=>elements[id]||null,createElement:()=>element(),querySelectorAll:()=>[]},
 getTodayKST:()=> '2026-10-09',getLogDateKST:v=>String(v).slice(0,10),
 escapeHtml:v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 updateBadges(){},applyRecentSleepTimeDefaults(){},formatConditionWithLabel:v=>v||'',getSleepTimingInfo:()=>({badgeClass:'badge',label:'밤 취침',graphText:'수면 기록'}),
 openEditModal:(...args)=>clicked.push(args),showDeleteConfirm:(...args)=>clicked.push(args),
 cacheStudentRecords(){},updateCaffeineBadge(){},syncConfirmedCaffeineStats(){}
 });
 installHistoryView(c);vm.runInContext(['sleepLogEndKey','compareSleepLogsByEndDesc','initCalendarDate','calendarPrevMonth','calendarNextMonth','getSleepLogForDate','getCaffeineLogsForDate','renderCalendar','showCalendarDetail','refreshCalendarIfVisible','renderCaffeineLogs','renderSleepLogs','applyConfirmedDeletion'].map(extract).join('\n'),c);
 return {c,elements,clicked};
}
const sleepRecord={id:'sleep-a',date:'2026-10-08',wakeDate:'2026-10-09',start:'23:00',end:'07:00',hours:8,condition:'😐'};
test('record buttons pass quoted names and IDs literally without inline script',()=>{
 const record={id:"record-'a",name:"오늘의 '커피' <b>한 잔</b>",amount:50,time:'2026-10-08T12:00',reason:'<img src=x onerror=bad()>'};
 const x=setup({caffeine:[record]});x.c.renderCaffeineLogs();const row=x.elements.caffeineLogsContainer.children[0];
 assert.doesNotMatch(row.innerHTML,/<b>|<img|onclick=/);assert.match(row.innerHTML,/&lt;b&gt;/);
 row.querySelector('[data-record-edit]').onclick();row.querySelector('[data-record-delete]').onclick();
 assert.deepEqual(x.clicked,[['caffeine',record.id],['caffeine',record.id,record.name]]);
});
test('sleep memo and condition remain literal in both history and calendar',()=>{
 const log={...sleepRecord,memo:'<b>메모</b>',condition:'<img src=x onerror=bad()>'};const x=setup({sleep:[log]});
 x.c.renderSleepLogs();assert.doesNotMatch(x.elements.sleepLogsContainer.children[0].innerHTML,/<b>|<img/);
 x.c.showCalendarDetail(log.wakeDate,log,[]);assert.doesNotMatch(x.elements.calendarDetailContent.innerHTML,/<b>|<img/);assert.match(x.elements.calendarDetailContent.innerHTML,/&lt;b&gt;메모/);
});

test('sleep history escapes timing descriptions derived from malformed date fields',()=>{
 const log={...sleepRecord,date:'2026-<svg onload=bad()>',wakeDate:'2026-<img src=x onerror=bad()>'};
 const x=setup({sleep:[log],active:false});
 vm.runInContext(['shortDate','getSleepLifeDate','getSleepTimingInfo'].map(extract).join('\n'),x.c);
 x.c.renderSleepLogs();const markup=x.elements.sleepLogsContainer.children[0].innerHTML;
 assert.doesNotMatch(markup,/<svg|<img/);
 assert.match(markup,/&lt;img src=x onerror=bad\(\)&gt;/);
 assert.match(markup,/날짜·시간 확인 필요/);
});
test('calendar sums numeric strings as amounts rather than concatenating',()=>{
 const x=setup();x.c.showCalendarDetail('2026-10-08',null,[{amount:'50',name:'a'},{amount:'100',name:'b'}]);
 assert.match(x.elements.calendarDetailContent.innerHTML,/총 150mg/);
});
test('calendar retains same-wake multiples as a count without choosing a representative',()=>{
 const x=setup({sleep:[{...sleepRecord,id:'old',end:'06:00',hours:7},sleepRecord]});
 assert.equal(x.c.getSleepLogForDate(sleepRecord.wakeDate).recordCount,2);assert.equal(x.c.getSleepLogForDate(sleepRecord.wakeDate).hours,null);
});
test('visible calendar detail updates when caffeine history is refreshed',()=>{
 const old={id:'record-a',name:'가상',amount:50,time:'2026-10-08T12:00'};const x=setup({caffeine:[old]});
 x.c.showCalendarDetail('2026-10-08',null,[old]);x.c.caffeineLogs=[{...old,amount:100}];x.c.renderCaffeineLogs();
 assert.match(x.elements.calendarDetailContent.innerHTML,/총 100mg/);assert.equal(x.elements.calendarDetailPanel.scrolls,1);
});
test('deleting last caffeine record removes the calendar dot and opened detail',()=>{
 const log={id:'record-a',name:'가상',amount:0,time:'2026-10-08T12:00'};const x=setup({caffeine:[log]});
 x.c.showCalendarDetail('2026-10-08',null,[log]);x.c.applyConfirmedDeletion('caffeine',log.id);
 assert.match(x.elements.calendarDetailContent.innerHTML,/카페인 기록 없음/);assert.equal(x.c.caffeineLogs.length,0);
});
test('deleting last sleep record clears the opened calendar detail',()=>{
 const x=setup({sleep:[sleepRecord]});x.c.showCalendarDetail(sleepRecord.date,sleepRecord,[]);x.c.applyConfirmedDeletion('sleep',sleepRecord.id);
 assert.match(x.elements.calendarDetailContent.innerHTML,/수면 기록 없음/);
});
test('moving calendar month hides details from the previous month and handles year boundary',()=>{
 const x=setup();x.c.calendarMonth=0;x.c.showCalendarDetail('2026-01-08',null,[]);x.c.calendarPrevMonth();
 assert.equal(x.c.calendarYear,2025);assert.equal(x.c.calendarMonth,11);assert.equal(x.elements.calendarDetailPanel.classList.contains('hidden'),true);
 x.c.calendarNextMonth();assert.equal(x.c.calendarYear,2026);assert.equal(x.c.calendarMonth,0);
});
test('calendar includes leap day and distinguishes recorded zero caffeine from missing',()=>{
 const x=setup({caffeine:[{time:'2024-02-29T12:00',amount:0,name:'안 함'}]});x.c.calendarYear=2024;x.c.calendarMonth=1;x.c.renderCalendar();
 const days=x.elements.calendarGrid.children.filter(e=>e.children.length);assert.equal(days.length,29);
 const last=days.at(-1);assert.equal(last.children[0].textContent,29);assert.match(last.children[1].children[0].className,/bg-teal-400/);
});
test('calendar initial month follows Korean today even in a different browser timezone',()=>{
 const x=setup();const fixed=Date.parse('2026-10-31T16:00:00Z');x.c.Date=class extends Date{constructor(...args){super(...(args.length?args:[fixed]));}getMonth(){return this.getUTCMonth();}getFullYear(){return this.getUTCFullYear();}};
 x.c.getTodayKST=()=> '2026-11-01';x.c.initCalendarDate();assert.equal(x.c.calendarMonth,10);
});
test('edit form retains quoted drink names and literal memo text',()=>{
 const x=setup({caffeine:[{id:'record-a',name:'가상 "커피" <b>한 잔</b>',amount:50,time:'2026-10-08T12:00'}],sleep:[{...sleepRecord,memo:'</textarea><b>메모</b>'}]});
 for(const id of ['editModalOverlay','editModalTitle','editModalBody'])x.elements[id]=element();
 x.c.combineDateAndTime=(d,t)=>d+'T'+t;x.c.document.querySelector=()=>null;
 for(const id of ['editSleepStart','editSleepEnd','editSleepStartPreview','editSleepEndPreview'])x.elements[id]=element();
 vm.runInContext(extract('updateSleepEditDateTimePreviews')+'\n'+extract('openEditModal'),x.c);x.c.openEditModal('caffeine','record-a');
 assert.match(x.elements.editModalBody.innerHTML,/value="가상 &quot;커피&quot; &lt;b&gt;한 잔&lt;\/b&gt;"/);
 x.c.openEditModal('sleep',sleepRecord.id);assert.doesNotMatch(x.elements.editModalBody.innerHTML,/<b>메모/);
 assert.match(x.elements.editModalBody.innerHTML,/&lt;\/textarea&gt;&lt;b&gt;메모/);
});
test('calendar award names, messages and image attributes remain literal',()=>{
 const x=setup();x.c.teacherAwards=[{grantedAt:'2026-10-08T12:00',name:'<b>뱃지</b>',message:'<img src=x>',image:'https://example.com/a.png" onload="bad()',bg:'red;position:fixed',color:'url(https://example.com)'}];
 x.c.showCalendarDetail('2026-10-08',null,[]);
 assert.doesNotMatch(x.elements.calendarDetailContent.innerHTML,/<b>|<img src=x|" onload="|position:fixed|color:url/);
 assert.match(x.elements.calendarDetailContent.innerHTML,/&lt;b&gt;뱃지/);
});

test('calendar unknown amount does not become zero or a complete known subtotal',()=>{for(const rows of [[{amount:'',name:'unknown'}],[{amount:50,name:'known'},{amount:'',name:'unknown'}]]){const x=setup();x.c.showCalendarDetail('2026-10-08',null,rows);const text=x.elements.calendarDetailContent.innerHTML;assert.match(text,/총량 미확인/);assert.doesNotMatch(text,/총 (?:0|50)mg/);assert.match(text,/함량 미상/);}});

test('calendar mini hours use one decimal without changing the record',()=>{const record={...sleepRecord,start:'23:00',end:'06:10',hours:7.166666666666667},x=setup({sleep:[record]});x.c.renderCalendar();const text=node=>[node.textContent||'',...(node.children||[]).map(text)].join(' ');const rendered=text(x.elements.calendarGrid);assert.match(rendered,/7\.2h/);assert.ok(!rendered.includes('7.166666'));assert.equal(record.hours,7.166666666666667);});

test('calendar mini observed zero stays 0.0 and missing hours remain unlabelled',()=>{for(const [hours,expected]of [[0,true],[null,false],['',false],[NaN,false]]){const x=setup({sleep:[]});x.c.getSleepLogForDate=date=>date==='2026-10-09'?{...sleepRecord,hours}:null;x.c.renderCalendar();const text=node=>[node.textContent||'',...(node.children||[]).map(text)].join(' ');assert.equal(text(x.elements.calendarGrid).includes('0.0h'),expected);}});
