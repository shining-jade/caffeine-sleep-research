import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,payload,row} from '../scripts/test-support/preservation-fixture.js';

test('existing legacy history is opaque and unchanged during a current-record edit',async()=>{
  const f=await fixture([row('a')]);
  const legacy=f.ss.insertSheet('_sleep_edit_history');
  legacy.appendRow(['recordId','beforeVersion','afterVersion','changedAt','beforeRow','afterRow']);
  legacy.appendRow(['legacy','old','new','synthetic','["old synthetic content"]','["new synthetic content"]']);
  const legacyBefore=JSON.stringify(legacy.rows);
  const original=f.ss.getSheetByName.bind(f.ss);
  f.ss.getSheetByName=name=>{if(name==='_sleep_edit_history')throw Error('LEGACY_HISTORY_MUST_NOT_BE_ACCESSED');return original(name);};
  const current=f.c.getSleepLogs('9901')[0];
  const result=f.send('updateSleepData',payload({id:'a',baseVersion:current.editVersion,memo:'current value only'}));
  assert.equal(result.success,true);
  assert.equal(f.rows()[0][12],'current value only');
  assert.equal(JSON.stringify(legacy.rows),legacyBefore);
});

test('successive edits and a lost-response retry keep only the current 19-column row',async()=>{
  const f=await fixture([row('a')]);
  let current=f.c.getSleepLogs('9901')[0];
  const first=payload({id:'a',baseVersion:current.editVersion,memo:'first replacement'});
  assert.equal(f.send('updateSleepData',first).success,true);
  assert.equal(f.send('updateSleepData',first).success,true);
  current=f.c.getSleepLogs('9901')[0];
  assert.equal(f.send('updateSleepData',payload({id:'a',baseVersion:current.editVersion,memo:'final replacement'})).success,true);
  assert.equal(f.rows().length,1);
  assert.equal(f.rows()[0].length,19);
  assert.equal(f.rows()[0][12],'final replacement');
  assert.equal(f.ss.getSheetByName('_sleep_edit_history'),null);
  assert.equal(f.ss.getSheetByName('_sync_receipts').rows.length,1);
});

test('pending receipt with no original recovers once and still suppresses replay after deletion',async()=>{
  const f=await fixture([],{nativeSleep:true});
  const p=payload({_sync:{mutationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
  const submit=f.c.Sheets.Spreadsheets.batchUpdate;
  f.c.Sheets.Spreadsheets.batchUpdate=()=>{throw Error('synthetic batch unavailable before commit');};
  assert.throws(()=>f.send('saveSleepData',p),/TABLE_APPEND_FAILED/);
  const ledger=f.ss.getSheetByName('_sync_receipts');
  assert.equal(f.rows().length,0);
  assert.equal(ledger.rows.length,2);
  assert.equal(ledger.rows[1][2],'pending');
  f.c.Sheets.Spreadsheets.batchUpdate=submit;
  const saved=f.send('saveSleepData',p);
  assert.equal(saved.success,true);
  assert.equal(f.rows().length,1);
  assert.equal(ledger.rows.length,2);
  assert.equal(ledger.rows[1][2],'committed');
  assert.equal(f.requests.at(-1).requests.length,2);
  assert.equal(f.requests.at(-1).requests[0].appendCells.tableId,'363107583');
  assert.deepEqual(JSON.parse(JSON.stringify(f.send('saveSleepData',p))),JSON.parse(JSON.stringify(saved)));
  f.send('deleteSleepData',saved.recordId);
  assert.deepEqual(JSON.parse(JSON.stringify(f.send('saveSleepData',p))),JSON.parse(JSON.stringify(saved)));
  assert.equal(f.rows().length,0);
  assert.equal(f.ss.getSheetByName('_sleep_edit_history'),null);
});
