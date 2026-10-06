import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAppsScript} from './harness.js';
test('hidden students persist across sessions and can be restored without changing research rows',async()=>{
 const properties={}; const {context:c}=await loadAppsScript({properties});
 assert.deepEqual(JSON.parse(JSON.stringify(c.getTeacherHiddenStudents())),{success:true,hiddenStudentIds:[]});
 c.updateTeacherHiddenStudents(['2410','2410','2411'],true);
 const {context:again}=await loadAppsScript({properties});
 assert.deepEqual(Array.from(again.getTeacherHiddenStudents().hiddenStudentIds),['2410','2411']);
 again.updateTeacherHiddenStudents(['2410'],false);
 assert.deepEqual(Array.from(again.getTeacherHiddenStudents().hiddenStudentIds),['2411']);
 assert.throws(()=>again.updateTeacherHiddenStudents(['<script>'],true));
 assert.equal(c.STUDENT_ACTIONS_.updateTeacherHiddenStudents,undefined);
 assert.equal(c.TEACHER_ACTIONS_.updateTeacherHiddenStudents,true);
});
