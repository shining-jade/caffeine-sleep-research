import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createLoginHandler } from '../api/student/login.js';

process.env.SESSION_SECRET = 'shared-network-login-test-secret';
process.env.GAS_API_URL = 'https://example.invalid/gas';
process.env.GAS_SHARED_SECRET = 'test-only-gateway-secret';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

function request(studentId, ip) {
  const req = Readable.from([Buffer.from(JSON.stringify({ studentId, name: '테스트' }))]);
  req.method = 'POST';
  req.headers = { 'x-forwarded-for': ip };
  return req;
}

function response() {
  const headers = new Map();
  return { statusCode: 0, body: '', setHeader(key, value) { headers.set(key.toLowerCase(), value); },
    getHeader(key) { return headers.get(key.toLowerCase()); }, end(value) { this.body = value; } };
}

function handler() {
  return createLoginHandler({ callGas: async input => ({ success: true, studentId: input.params[0], name: input.params[1] }) });
}

test('forty distinct students sharing school Wi-Fi can log in without sharing a twelve-attempt bucket', async () => {
  const login = handler();
  for (let i = 0; i < 40; i++) {
    const res = response();
    await login(request('synthetic-class-' + i, '192.0.2.141'), res);
    assert.equal(res.statusCode, 200, 'different classroom accounts must not consume one small bucket');
  }
});

test('repeated attempts remain limited per student and network without blocking a classmate', async () => {
  const login = handler();
  for (let i = 0; i < 12; i++) {
    const res = response();
    await login(request('synthetic-repeat', '192.0.2.142'), res);
    assert.equal(res.statusCode, 200);
  }
  const blocked = response();
  await login(request('synthetic-repeat', '192.0.2.142'), blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(JSON.parse(blocked.body).error, 'TOO_MANY_REQUESTS');
  assert.ok(Number(blocked.getHeader('retry-after')) > 0);
  const classmate = response();
  await login(request('synthetic-classmate', '192.0.2.142'), classmate);
  assert.equal(classmate.statusCode, 200);
  const otherNetwork = response();
  await login(request('synthetic-repeat', '192.0.2.143'), otherNetwork);
  assert.equal(otherNetwork.statusCode, 200);
});

test('rotating student IDs still encounters an aggregate network cap before roster access', async () => {
  let calls = 0;
  const login = createLoginHandler({ callGas: async input => { calls++; return { success:true, studentId:input.params[0], name:input.params[1] }; } });
  for (let i = 0; i < 120; i++) {
    const res = response();
    await login(request('synthetic-rotation-' + i, '192.0.2.144'), res);
    assert.equal(res.statusCode, 200);
  }
  const blocked = response();
  await login(request('synthetic-rotation-next', '192.0.2.144'), blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(calls, 120);
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const loginStart = html.indexOf('    async function login()');
const loginEnd = html.indexOf('\n    }', loginStart) + 6;
const loginSource = html.slice(loginStart, loginEnd);

for (const [code, retryAfter, expected] of [
  ['TOO_MANY_REQUESTS', 125, /3분/],
  ['TOO_MANY_REQUESTS', undefined, /로그인 시도/],
  ['INVALID_CREDENTIALS', undefined, /등록되지 않은 정보/],
  ['NETWORK_ERROR', undefined, /서버에 연결/],
]) {
  test('login UI distinguishes ' + code + ' from an unavailable server', async () => {
    const nodes = { sid:{value:'0'}, sname:{value:'테스트'}, loginMsg:{innerText:''}, loginBtn:{innerText:'로그인',disabled:false} };
    const context = vm.createContext({ document:{getElementById:id=>nodes[id]},
      window:{appAuth:{loginStudent:async()=>{ throw Object.assign(new Error('fixture'), {code,retryAfter}); }}},
      enterApp(){ assert.fail('failed login must not enter app'); } });
    vm.runInContext(loginSource, context);
    await context.login();
    assert.match(nodes.loginMsg.innerText, expected);
    if (code === 'TOO_MANY_REQUESTS') assert.doesNotMatch(nodes.loginMsg.innerText, /서버에 연결/);
    assert.equal(nodes.loginBtn.disabled, false);
  });
}
