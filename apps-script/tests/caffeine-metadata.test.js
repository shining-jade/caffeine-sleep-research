import assert from 'node:assert/strict';
import test from 'node:test';
import {loadAppsScript} from './harness.js';
test('caffeine save preserves subject code formula position and stores DB metadata',async()=>{
 const {context}=await loadAppsScript({files:['Code.gs']});let written;
 context.getSpreadsheet_=()=>({getSheetByName:()=>({})});context.getKSTTimestamp=()=> '2026-10-08 12:00:00';
 context.normalizeId=String;context.parseStudentId=()=>({grade:2,class:1,number:1});context.appendRecordRow_=(_,values)=>written=values;
 context.saveCaffeineData({studentId:'2101',name:'합성',drink:'메가커피 아메리카노',mg:100,time:'2026-10-08 12:00:00',company:'메가커피',foodName:'커피_아메리카노'});
 assert.equal(written[12],'');assert.equal(written[13],'메가커피');assert.equal(written[14],'커피_아메리카노');
});
test('student caffeine history returns the saved metadata',async()=>{
 const {context}=await loadAppsScript({files:['Code.gs']});
 const row=['',2,1,1,2101,'합성','메가 아메리카노',100,'2026-10-08 12:00:00','id','','','R2101','메가커피','커피_아메리카노'];
 context.getSpreadsheet_=()=>({getSheetByName:()=>({getLastRow:()=>2,getLastColumn:()=>15,getRange:(r,c,n,width)=>({getValues:()=>[row.slice(0,width)]})})});context.normalizeId=String;
 const result=context.getCaffeineLogs('2101');assert.equal(result[0].company,'메가커피');assert.equal(result[0].foodName,'커피_아메리카노');
});
