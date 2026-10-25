import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createMemorySpreadsheet,loadAppsScript} from '../../apps-script/tests/harness.js';
export const subject={studentId:'9901',name:'합성'};
export const headers=['타임스탬프','학년','반','번호','전체학번','성명','날짜','취침시간','기상날짜','기상시간','수면시간','컨디션','메모','고유ID','취침전스마트폰','취침전활동','잠들기소요시간','수면중각성','낮졸림'];
export function readBaseline(path){const file='../baseline/'+path;return fs.existsSync(file)?fs.readFileSync(file,'utf8'):execFileSync('git',['show','9e57bc690bbeb0933f35dabdb18e6ec1b82d3a4f:'+path],{encoding:'utf8'});}
export const payload=(extra={})=>({studentId:'9901',name:'합성',id:'client-a',date:'2026-10-19',sleepTime:'02:30',wakeDate:'2026-10-19',wakeTime:'06:30',hours:4,condition:'😊',memo:'합성',...extra});
export function row(id='a',extra={}){const p=payload(extra);return ['2026-10-20 10:00:00',9,9,1,p.studentId,p.name,p.date,p.sleepTime,p.wakeDate,p.wakeTime,p.hours,p.condition,p.memo,id,'','','','',''];}
export async function fixture(initial=[],{baseline=false,nativeSleep=false}={}){
 const ss=createMemorySpreadsheet({sleep:[headers,...initial],_sync_receipts:[['key','digest','state','recordId','createdAt','receipt']]});
 const sheets=new Map();let nextId=100;
 function decorate(sheet){if(!sheet||sheets.has(sheet))return sheet;sheets.set(sheet,nativeSleep&&sheet.getName()==='sleep'?630091192:nextId++);sheet.getSheetId=()=>sheets.get(sheet);sheet.getParent=()=>ss;sheet.setFrozenRows=()=>sheet;sheet.deleteRow=n=>sheet.rows.splice(n-1,1);const getRange=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const r=getRange(...args);r.createTextFinder=text=>({matchEntireCell(){return this;},findNext(){for(let i=args[0]-1;i<Math.min(sheet.rows.length,args[0]-1+args[2]);i++)if(String(sheet.rows[i][args[1]-1])===String(text))return {getRow:()=>i+1};return null;}});return r;};return sheet;}
 const getSheet=ss.getSheetByName.bind(ss),insert=ss.insertSheet.bind(ss);ss.getSheetByName=n=>decorate(getSheet(n));ss.insertSheet=n=>decorate(insert(n));ss.getId=()=> 'SYNTHETIC_ONLY';ss.getSheets=()=>[...sheets.keys()];Object.keys({sleep:1,_sync_receipts:1}).forEach(n=>ss.getSheetByName(n));
 const requests=[];
 const Sheets={Spreadsheets:{batchUpdate(body){requests.push(body);for(const request of body.requests){const w=request.appendCells||request.updateCells;if(!w)throw Error('Unsupported test boundary request');const sheet=[...sheets.keys()].find(s=>s.getSheetId()===(w.sheetId??w.start?.sheetId));if(!sheet)throw Error('Unknown synthetic sheet');const values=w.rows.map(r=>r.values.map((cell,i)=>{const v=cell.userEnteredValue;if(!v)return '';if(v.stringValue!==undefined)return v.stringValue;if(v.numberValue!==undefined&&sheet.getName()==='sleep'&&[0,6,8].includes(i))return new Date((v.numberValue-25569)*86400000-9*3600000);return v.numberValue??v.boolValue??'';}));if(request.appendCells)values.forEach(r=>sheet.appendRow(r));else values.forEach((r,i)=>sheet.getRange(w.start.rowIndex+1+i,(w.start.columnIndex||0)+1,1,r.length).setValues([r]));}},Values:{get(_id,range){const name=range.match(/^'?([^'!]+)'?!/)[1],s=ss.getSheetByName(name);const m=range.match(/!A(\d+):F/);return {values:m?[s.rows[Number(m[1])-1]]:s.rows};}}}};
 const files=['Spreadsheet.gs','Security.gs','Ownership.gs','Sync.gs','Api.gs','Code.gs'];if(!baseline&&fs.existsSync('apps-script/SleepPreservation.gs'))files.push('SleepPreservation.gs');
 const {context:c}=await loadAppsScript({files:baseline?[]:files,properties:{SPREADSHEET_ID:'SYNTHETIC_ONLY'},globals:{__spreadsheet:ss,Sheets}});if(baseline)for(const file of ['Spreadsheet.gs','Security.gs','Ownership.gs','Sync.gs','Api.gs','Code.gs'])vm.runInContext(readBaseline('apps-script/'+file),c,{filename:'baseline/'+file});c.SpreadsheetApp.flush=()=>{};c.Utilities.getUuid=randomUUID;c.safeLog_=()=>{};
 return {c,ss,requests,rows:()=>ss.getSheetByName('sleep').rows.slice(1),send:(action,p)=>c.dispatchStudentAction_(action,[structuredClone(p)],subject,{})};
}
