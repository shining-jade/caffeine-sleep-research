import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../public/js/api-bridge.js', import.meta.url), 'utf8');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function loadBridge({ role = 'student', fetchImpl }) {
  const warnings = [];
  const window = {};
  const context = {
    window,
    document: { documentElement: { dataset: { appRole: role } } },
    fetch: fetchImpl,
    console: { log() {}, error() {}, warn: (...args) => warnings.push(args) },
    Error,
    Proxy,
    Promise,
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  vm.runInNewContext(SOURCE, context, { filename: 'api-bridge.js' });
  return { window, warnings };
}

test('API bridge supports success and failure chaining', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => response({ success: true, data: { total: 3 } }),
  });
  const success = await new Promise((resolve, reject) => {
    window.google.script.run
      .withFailureHandler(reject)
      .withSuccessHandler(resolve)
      .getStats('1101');
  });
  assert.equal(success.total, 3);

  const { window: failedWindow } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'DENIED' }, 403),
  });
  const error = await new Promise((resolve) => {
    failedWindow.google.script.run
      .withSuccessHandler(() => assert.fail('success handler must not run'))
      .withFailureHandler(resolve)
      .getStats('1101');
  });
  assert.equal(error.code, 'DENIED');
});

test('API bridge supports handler-less calls', async () => {
  const { window, warnings } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'FAILED' }, 500),
  });
  assert.doesNotThrow(() => window.google.script.run.getStats('1101'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(warnings.length, 1);
});

test('API bridge keeps concurrent call handlers isolated', async () => {
  const pending = [];
  const { window } = loadBridge({
    fetchImpl: () => new Promise((resolve) => pending.push(resolve)),
  });
  const results = [];
  window.google.script.run.withSuccessHandler((value) => results.push(`first:${value}`)).getStats('1');
  window.google.script.run.withSuccessHandler((value) => results.push(`second:${value}`)).getStats('2');

  pending[1](response({ success: true, data: 'B' }));
  pending[0](response({ success: true, data: 'A' }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(results.sort(), ['first:A', 'second:B']);
});

test('API bridge selects student and teacher action endpoints', async () => {
  for (const role of ['student', 'teacher']) {
    let captured;
    const { window } = loadBridge({
      role,
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return response({ success: true, data: true });
      },
    });
    await new Promise((resolve, reject) => {
      window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getStats('1101');
    });
    assert.equal(captured.url, `/api/${role}/action`);
    assert.equal(captured.options.credentials, 'same-origin');
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.options.body), { action: 'getStats', params: ['1101'] });
  }
});

test('API bridge auth helpers use login session and logout routes', async () => {
  const calls = [];
  const { window } = loadBridge({
    role: 'teacher',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({ success: true, authenticated: true, role: 'teacher' });
    },
  });

  await window.appAuth.loginTeacher('password-value');
  await window.appAuth.getSession();
  await window.appAuth.logout();

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/teacher/login', '/api/teacher/session', '/api/teacher/logout',
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { password: 'password-value' });
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].options.method, 'POST');
});

test('student push bridge uses same-origin endpoints and logout can include the current endpoint', async () => {
  const calls = [];
  const { window } = loadBridge({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({ success: true, subscriptionId: 'a'.repeat(64) });
    },
  });
  const subscription = { endpoint: 'https://push.example/device', keys: { p256dh: 'p', auth: 'a' } };
  await window.appPush.getConfig();
  await window.appPush.subscribe(subscription, { sleepEnabled: true, caffeineEnabled: false });
  await window.appPush.getPreferences('a'.repeat(64));
  await window.appPush.savePreferences({ subscriptionId: 'a'.repeat(64), sleepEnabled: false, caffeineEnabled: true });
  await window.appPush.unsubscribe({ endpoint: subscription.endpoint });
  await window.appAuth.logout(subscription.endpoint);

  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/student/push/config', '/api/student/push/subscribe', '/api/student/push/preferences',
    '/api/student/push/preferences', '/api/student/push/unsubscribe', '/api/student/logout',
  ]);
  assert.equal(calls[2].options.headers['X-Push-Subscription-Id'], 'a'.repeat(64));
  assert.deepEqual(JSON.parse(calls[5].options.body), { endpoint: subscription.endpoint });
});

test('API bridge student login sends only student credentials', async () => {
  let captured;
  const { window } = loadBridge({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ success: true, authenticated: true, role: 'student' });
    },
  });
  await window.appAuth.loginStudent('1101', '테스트학생');
  assert.equal(captured.url, '/api/student/login');
  assert.deepEqual(JSON.parse(captured.options.body), { studentId: '1101', name: '테스트학생' });
});

test('API bridge invokes session expiry callback on 401', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'UNAUTHENTICATED' }, 401),
  });
  let expired = 0;
  window.appAuth.onSessionExpired(() => { expired += 1; });
  await new Promise((resolve) => {
    window.google.script.run.withFailureHandler(resolve).getStats('1101');
  });
  assert.equal(expired, 1);
});

test('API bridge rejects malformed JSON responses safely', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('private html'); } }),
  });
  const error = await new Promise((resolve) => {
    window.google.script.run.withFailureHandler(resolve).getStats('1101');
  });
  assert.equal(error.code, 'INVALID_RESPONSE');
  assert.equal(error.message.includes('private html'), false);
});

test('API bridge public source contains no upstream URL or secret names', () => {
  assert.doesNotMatch(SOURCE, /script\.google\.com\/macros\/s\//i);
  assert.doesNotMatch(SOURCE, /GAS_API_URL|GAS_SHARED_SECRET|SESSION_SECRET|TEACHER_PASSWORD_HASH/);
});

test('duplicate in-flight student reads share one request and both receive results', async () => {
  const pending = [];
  const { window } = loadBridge({ fetchImpl: () => new Promise(resolve => pending.push(resolve)) });
  const values = [];
  window.google.script.run.withSuccessHandler(v => values.push(v)).getStats('1101');
  window.google.script.run.withSuccessHandler(v => values.push(v)).getStats('1101');
  assert.equal(pending.length, 1);
  pending[0](response({ success: true, data: 7 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(values, [7, 7]);
});

test('old student success and failure responses are discarded after a new login', async () => {
  const pending = [];
  const { window } = loadBridge({ fetchImpl: url => url.endsWith('/login')
    ? Promise.resolve(response({ success: true })) : new Promise(resolve => pending.push(resolve)) });
  let callbacks = 0;
  let expired = 0;
  window.appAuth.onSessionExpired(() => expired++);
  const runner = window.google.script.run.withSuccessHandler(() => callbacks++).withFailureHandler(() => callbacks++);
  runner.getStats('1101');
  runner.getSleepLogs('1101');
  await window.appAuth.loginStudent('1102', '다른학생');
  pending[0](response({ success: true, data: { private: 'previous student' } }));
  pending[1](response({ success: false }, 401));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(callbacks, 0);
  assert.equal(expired, 0);
});

test('student data from a cookie changed by another tab never reaches the current screen', async () => {
  const { window } = loadBridge({ fetchImpl: async url => url.endsWith('/login')
    ? response({ success: true, studentId: '1101', name: '학생A' })
    : response({ success: true, subject: { studentId: '1102', name: '학생B' }, data: ['private B record'] }) });
  await window.appAuth.loginStudent('1101', '학생A');
  let shown = false;
  let expired = 0;
  window.appAuth.onSessionExpired(() => expired++);
  window.google.script.run.withSuccessHandler(() => { shown = true; }).withFailureHandler(() => {}).getCaffeineLogs('1101');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(shown, false);
  assert.equal(expired, 1);
});

test('delayed session restoration cannot overwrite a completed new login', async () => {
  let restore;
  const { window } = loadBridge({ fetchImpl: url => url.endsWith('/session')
    ? new Promise(resolve => { restore = resolve; })
    : Promise.resolve(response({ success: true, studentId: '1102', name: '학생B' })) });
  const session = window.appAuth.getSession().catch(error => error);
  await window.appAuth.loginStudent('1102', '학생B');
  restore(response({ success: true, studentId: '1101', name: '학생A' }));
  assert.equal((await session).code, 'STALE_SESSION');
});

test('writes are never deduplicated and completed reads are fetched again', async () => {
  let calls = 0;
  const { window } = loadBridge({ fetchImpl: async () => { calls++; return response({ success: true, data: [] }); } });
  const read = () => new Promise(resolve => window.google.script.run.withSuccessHandler(resolve).getStats('1101'));
  await read();
  await read();
  window.google.script.run.saveSleepData({ id: '1' });
  window.google.script.run.saveSleepData({ id: '1' });
  assert.equal(calls, 4);
});

test('transient student reads retry once while writes are never replayed', async () => {
  let calls=0;
  const {window}=loadBridge({fetchImpl:async()=>{calls++;return calls===1?response({success:false,error:'GAS_UNAVAILABLE'},502):response({success:true,data:[{id:'saved'}]});}});
  const result=await new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getCaffeineLogs('0'));
  assert.equal(result[0].id,'saved'); assert.equal(calls,2);
  calls=0;
  const failed=loadBridge({fetchImpl:async()=>{calls++;return response({success:false,error:'GAS_UNAVAILABLE'},502);}}).window;
  await new Promise(resolve=>failed.google.script.run.withFailureHandler(resolve).saveCaffeineData({}));
  assert.equal(calls,1);
});

test('changing session during a read retry never sends the old student request again', async () => {
  let calls=0, firstFailure;
  const first = new Promise(resolve=>{firstFailure=resolve;});
  const {window}=loadBridge({fetchImpl:async()=>{calls++;firstFailure();return response({success:false,error:'GAS_UNAVAILABLE'},502);}});
  let settled=false;
  window.google.script.run.withSuccessHandler(()=>{settled=true;}).withFailureHandler(()=>{settled=true;}).getCaffeineLogs('0');
  await first;
  await new Promise(resolve=>setImmediate(resolve));
  window.appAuth.invalidateSession();
  await new Promise(resolve=>setTimeout(resolve,650));
  assert.equal(calls,1); assert.equal(settled,false);
});

test('a confirmed write forces fresh history and an older snapshot cannot overwrite it', async () => {
  let finishOld, reads=0;
  const {window}=loadBridge({fetchImpl:async(_url,options)=>{
    const action=JSON.parse(options.body).action;
    if(action==='saveCaffeineData')return response({success:true,data:{success:true}});
    reads++;
    if(reads===1)return new Promise(resolve=>{finishOld=()=>resolve(response({success:true,data:[{id:'old'}]}));});
    return response({success:true,data:[{id:'new'}]});
  }});
  const old=new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getCaffeineLogs('0'));
  await new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).saveCaffeineData({}));
  const fresh=await new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getCaffeineLogs('0'));
  finishOld(); const refreshedOld=await old;
  assert.equal(fresh[0].id,'new');assert.equal(refreshedOld[0].id,'new');
});

test('teacher requests are bounded and queued dashboard reads receive priority',async()=>{
 const calls=[];const releases=[];const {window}=loadBridge({role:'teacher',fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body).action);return new Promise(resolve=>releases.push(()=>resolve(response({success:true,data:{success:true}}))));}});
 const invoke=action=>new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[action]());
 const jobs=['getAwardSettings','getPendingBadges','getDismissedBadges','getTeacherData'].map(invoke);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);
 releases.shift()();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls[2],'getTeacherData');
 while(releases.length){releases.shift()();await new Promise(resolve=>setImmediate(resolve));}
 await Promise.all(jobs);assert.equal(calls.length,4);
});
test('simultaneous teacher dashboard reads share a single request',async()=>{
 let count=0;let release;const {window}=loadBridge({role:'teacher',fetchImpl:()=>{count++;return new Promise(resolve=>release=()=>resolve(response({success:true,data:{success:true}})));}});
 const invoke=()=>new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getTeacherData());
 const a=invoke(),b=invoke();await new Promise(resolve=>setImmediate(resolve));assert.equal(count,1);release();await Promise.all([a,b]);
});
