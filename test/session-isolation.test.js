import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, readSessionCookie, setSessionCookie, clearSessionCookie, verifySession } from '../api/_lib/session.js';
import { createSessionHandler as teacherSession } from '../api/teacher/session.js';
import { createSessionHandler as studentSession } from '../api/student/session.js';
process.env.SESSION_SECRET = 'role-isolation-test-secret';
const NOW = 1800000000;
function res() {
  const headers = new Map();
  return { headers, statusCode: 0, setHeader(k,v) { headers.set(k.toLowerCase(),v); }, end() {} };
}
function token(role, studentId = '0') {
  return createSession({ role, ...(role === 'student' ? { studentId, name: '가상학생' } : {}), exp: NOW + 86400 }, NOW);
}
test('teacher session inspection never deletes an existing legacy student session', async () => {
  for (const studentId of ['0', 'synthetic-A', 'synthetic-B']) {
    const req = { method: 'GET', headers: { cookie: 'caffeine_session=' + token('student', studentId) } };
    const result = res();
    await teacherSession({ now: () => NOW })(req,result);
    assert.equal(result.statusCode,401);
    assert.doesNotMatch(String(result.headers.get('set-cookie')), /(?:^|,)caffeine_session=/);
  }
});
test('student and teacher cookies coexist and each role reads only its own token', () => {
  const student = res(), teacher = res();
  setSessionCookie(student,token('student'),86400,'student');
  setSessionCookie(teacher,token('teacher'),86400,'teacher');
  const a = student.headers.get('set-cookie').split(';')[0];
  const b = teacher.headers.get('set-cookie').split(';')[0];
  assert.notEqual(a.split('=')[0],b.split('=')[0]);
  const req = { headers: { cookie: a + '; ' + b } };
  assert.equal(verifySession(readSessionCookie(req,'student'),'student',NOW).studentId,'0');
  assert.equal(verifySession(readSessionCookie(req,'teacher'),'teacher',NOW).role,'teacher');
  const out = res();
  clearSessionCookie(out,'teacher',req);
  assert.doesNotMatch(String(out.headers.get('set-cookie')), /caffeine_student_session=/);
});
test('student restore remains valid after teacher restore with both cookies', async () => {
  const req = { method:'GET', headers:{ cookie:`caffeine_student_session=${token('student')}; caffeine_teacher_session=${token('teacher')}` } };
  const teacher = res(), student = res();
  await teacherSession({now:()=>NOW})(req,teacher);
  await studentSession({now:()=>NOW+3600})(req,student);
  assert.equal(teacher.statusCode,200);
  assert.equal(student.statusCode,200);
});
test('logout also removes its own legacy token so an old login cannot return', () => {
  const out = res();
  clearSessionCookie(out,'student',{headers:{cookie:'caffeine_session='+token('student')}});
  const cookies = String(out.headers.get('set-cookie'));
  assert.match(cookies,/caffeine_student_session=;/);
  assert.match(cookies,/caffeine_session=;/);
});

test('malformed or duplicate role cookies never restore an older student login', () => {
  const legacy = `caffeine_session=${token('student', 'older-student')}`;
  for (const invalid of ['caffeine_student_session=%ZZ', 'caffeine_student_session=', `caffeine_student_session=${token('student')}; caffeine_student_session=${token('student')}`]) {
    assert.equal(readSessionCookie({ headers: { cookie: `${legacy}; ${invalid}` } }, 'student'), null);
  }
});
test('student session inspection and logout preserve a legacy teacher login', async () => {
  const req = { method: 'GET', headers: { cookie: `caffeine_session=${token('teacher')}` } };
  const result = res();
  await studentSession({ now: () => NOW })(req, result);
  assert.equal(result.statusCode, 401);
  assert.doesNotMatch(String(result.headers.get('set-cookie')), /(?:^|,)caffeine_session=/);
  const out = res();
  clearSessionCookie(out, 'student', req);
  assert.doesNotMatch(String(out.headers.get('set-cookie')), /caffeine_teacher_session=|(?:^|,)caffeine_session=/);
  assert.equal(verifySession(readSessionCookie(req, 'teacher'), 'teacher', NOW).role, 'teacher');
});
