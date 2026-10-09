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

function loadBridge({ role = 'student', fetchImpl, withStudentSync = false }) {
  const warnings = [];
  const window = {};
  const context = {
    window,
    document: { documentElement: { dataset: { appRole: role } }, addEventListener(){} },
    navigator: { onLine:true }, crypto:{randomUUID:()=> 'fixture-token'},
    setInterval:()=>0,
    fetch: fetchImpl,
    console: { log() {}, error() {}, warn: (...args) => warnings.push(args) },
    Error,
    Proxy,
    Promise,
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  window.addEventListener=()=>{};
  window.dispatchEvent=()=>{};
  context.CustomEvent=class {};
  if(withStudentSync){
    vm.runInNewContext(fs.readFileSync(new URL('../public/js/student-sync.js',import.meta.url),'utf8'),context);
    const create=window.StudentSync.create,snapshots=new Map();
    const store={list:async()=>[],snapshot:async(key,value)=>{
      if(value===undefined)return snapshots.get(key);
      snapshots.set(key,value);return value;
    },lease:async()=>true,release:async()=>{}};
    window.StudentSync.create=options=>create({...options,store});
  }
  vm.runInNewContext(SOURCE, context, { filename: 'api-bridge.js' });
  return { window, warnings };
}

test('confirmed edits and deletions update offline histories before a later sync refresh',async()=>{
 const subject={studentId:'0',name:'테스트'};let records=[{id:'caf-a',name:'old',amount:50,time:'2026-10-09T12:00'}];
 const x=loadBridge({withStudentSync:true,fetchImpl:async(url,options)=>{
   if(url.endsWith('/session'))return response({authenticated:true,...subject});
   const {action,params}=JSON.parse(options.body);
   if(action==='getCaffeineLogs')return response({success:true,data:records,subject});
   if(action==='updateCaffeineData'){records=[{...records[0],name:params[0].drink,amount:params[0].mg}];return response({success:true,data:{success:true},subject});}
   if(action==='deleteCaffeineData'){records=[];return response({success:true,data:{success:true},subject});}
 }});
 await x.window.appAuth.getSession();
 const run=(action,...params)=>new Promise((resolve,reject)=>x.window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[action](...params));
 await run('getCaffeineLogs','0');
 await run('updateCaffeineData',{id:'caf-a',drink:'new',mg:100,time:'2026-10-08T12:00',reason:'',symptom:''});
 const edited=await x.window.studentSync.read('getCaffeineLogs');assert.equal(edited[0].amount,100);assert.equal(edited[0].name,'new');assert.equal(edited[0].time,'2026-10-08T12:00');
 await run('deleteCaffeineData','caf-a');assert.equal((await x.window.studentSync.read('getCaffeineLogs')).length,0);
});

test('notification reads expose outage instead of claiming an old StudentSync cache is current',async()=>{
  for(const action of ['getTeacherMessages','getMyInquiries','getTeacherAwardsForStudent']){
    const subject={studentId:'0',name:'테스트'};let calls=0;
    const data=action==='getTeacherAwardsForStudent'?{success:true,awards:[{name:'old'}]}:{success:true,data:[{title:'old'}]};
    const {window}=loadBridge({withStudentSync:true,fetchImpl:async(url)=>{
      if(url.endsWith('/login'))return response({success:true,...subject});
      calls++;
      return calls===1?response({success:true,data,subject}):response({success:false,error:'GAS_TIMEOUT'},504);
    }});
    await window.appAuth.loginStudent('0','테스트');
    const invoke=()=>new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[action]('0'));
    assert.equal((await invoke()).success,true);
    await assert.rejects(invoke(),{code:'GAS_TIMEOUT'});
    assert.equal(calls,3);
    const cache=await window.studentSync.read(action);
    assert.equal(cache.success,true,'failure still exposed even when old cache exists');
  }
});

test('notification reads retry temporary transport failures once for both roles', async () => {
  for (const [role, action] of [
    ['student','getMyInquiries'], ['student','getTeacherMessages'],
    ['student','getTeacherAwardsForStudent'], ['student','getReminderStudentConfig'],
    ['teacher','getInquiries'], ['teacher','getSentTeacherMessages'], ['teacher','getUnreadInquiries'],
  ]) {
    let calls = 0;
    const { window } = loadBridge({ role, fetchImpl: async () => {
      calls++;
      return calls === 1 ? response({ success:false, error:'GAS_TIMEOUT' },504)
        : response({ success:true, data:{ success:true, data:[] } });
    } });
    const result = await new Promise((resolve,reject) => window.google.script.run
      .withSuccessHandler(resolve).withFailureHandler(reject)[action]('0'));
    assert.equal(calls,2,action);
    assert.equal(result.success,true,action);
  }
});

test('notification read retries are bounded and never replay writes or permission failures', async () => {
  for (const [action,code,status,expected] of [
    ['getTeacherMessages','GAS_UNAVAILABLE',503,2],
    ['getTeacherMessages','DENIED',403,1],
    ['getTeacherMessages','UNAUTHENTICATED',401,1],
    ['sendInquiry','GAS_TIMEOUT',504,1], ['markTeacherMessageRead','NETWORK_ERROR',503,1],
  ]) {
    let calls=0;
    const { window } = loadBridge({ fetchImpl: async () => {
      calls++; return response({ success:false, error:code },status);
    } });
    await new Promise(resolve => window.google.script.run.withFailureHandler(resolve)[action]('0'));
    assert.equal(calls,expected,action+code);
  }
});

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

test('filtered statistics bridge uses date-specific offline snapshots',async()=>{
  const subject={studentId:'fictional',name:'가상'}; let offline=false;
  const {window}=loadBridge({withStudentSync:true,fetchImpl:async(url,options)=>{
    if(url.endsWith('/login'))return response({success:true,...subject});
    if(offline)return response({success:false,error:'NETWORK_ERROR'},503);
    const {params}=JSON.parse(options.body);
    return response({success:true,data:{todayTotal:params[1]==='2000-01-07'?150:50},subject});
  }});
  await window.appAuth.loginStudent(subject.studentId,subject.name);
  const invoke=date=>new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getFilteredStats(subject.studentId,date));
  await invoke('2000-01-07');await invoke('2026-10-09');offline=true;
  assert.equal((await invoke('2000-01-07')).todayTotal,150);
  assert.equal((await invoke('2026-10-09')).todayTotal,50);
  await assert.rejects(invoke('2026-10-10'),{code:'OFFLINE_CACHE_MISSING'});
});

test('first visit without a session shows ordinary login without an expiry notification', async () => {
  for (const role of ['student', 'teacher']) {
    const { window } = loadBridge({ role, fetchImpl: async () => response({ authenticated:false },401) });
    let expired = 0;
    window.appAuth.onSessionExpired(() => expired++);
    await assert.rejects(window.appAuth.getSession(), { status:401 });
    assert.equal(expired, 0);
  }
});

test('an authenticated student still receives an expiry notification for a rejected record read', async () => {
  const { window } = loadBridge({ fetchImpl: async url => url.endsWith('/login')
    ? response({ success:true, studentId:'0', name:'테스트' })
    : response({ success:false, error:'UNAUTHENTICATED' },401) });
  await window.appAuth.loginStudent('0','테스트');
  let expired = 0;
  window.appAuth.onSessionExpired(() => expired++);
  await assert.rejects(new Promise((resolve,reject) => window.google.script.run
    .withSuccessHandler(resolve).withFailureHandler(reject).getSleepLogs('0')), { status:401 });
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

const editSubject = {studentId:'0', name:'테스트'};
const caffeineEdit = {id:'saved', drink:'검증', mg:0, time:'2026-10-08T06:00', reason:'', symptom:''};
const caffeineEdited = {id:'saved', name:'검증', amount:0, time:'2026-10-08 06:00:00', reason:'', symptom:''};
const sleepEdit = {id:'saved', date:'2026-10-04', wakeDate:'2026-10-05', sleepTime:'22:30', wakeTime:'07:00', hours:8.5, condition:'😐', memo:'검증', smartphone:'안 함', activity:'안 함', latency:'15분 이내', awakenings:'없음', daytime:'없음'};
const sleepEdited = {...sleepEdit, start:'22:30', end:'07:00'};
async function invokeEdit(window, action, payload) {
  return new Promise((resolve, reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[action](payload));
}
async function recoveryBridge(action, records, errorCode='GAS_UNAVAILABLE') {
  const calls=[];
  const {window}=loadBridge({fetchImpl:async(url, options)=>{
    if(url.endsWith('/login'))return response({success:true,...editSubject});
    const body=JSON.parse(options.body); calls.push(body);
    if(body.action===action)return response({success:false,error:errorCode},502);
    return response({success:true,data:records,subject:editSubject});
  }});
  await window.appAuth.loginStudent('0','테스트');
  return {window,calls};
}
for(const [action,payload,record,read] of [
  ['updateCaffeineData',caffeineEdit,caffeineEdited,'getCaffeineLogs'],
  ['updateSleepData',sleepEdit,sleepEdited,'getSleepLogs'],
]) {
  test(`${action} confirms a committed edit after a lost response without replaying the write`,async()=>{
    const {window,calls}=await recoveryBridge(action,[record]);
    const result=await invokeEdit(window,action,payload);
    assert.equal(result.success,true);
    assert.equal(result.reconciled,true);
    assert.deepEqual(calls.map(c=>c.action),[action,read]);
    assert.deepEqual(calls[1].expectedSubject,editSubject);
    assert.deepEqual(calls[1].params,['0']);
  });
}
test('edit recovery never treats a partial, missing or duplicate match as confirmed',async()=>{
  const caffeineFields={id:'other',name:'other',amount:1,time:'2026-10-08 06:00:01',reason:'other',symptom:'other'};
  const sleepFields={id:'other',date:'2026-10-03',wakeDate:'2026-10-06',start:'23:00',end:'08:00',hours:8,condition:'🙂',memo:'other',smartphone:'30분 미만',activity:'30분 미만',latency:'15~30분',awakenings:'1번',daytime:'조금 있었음'};
  for(const [action,payload,record,fields] of [['updateCaffeineData',caffeineEdit,caffeineEdited,caffeineFields],['updateSleepData',sleepEdit,sleepEdited,sleepFields]]) {
    for(const records of [[],[record,record], ...Object.entries(fields).map(([key,value])=>[{...record,[key]:value}])]) {
      const {window,calls}=await recoveryBridge(action,records);
      await assert.rejects(invokeEdit(window,action,payload),{code:'GAS_UNAVAILABLE'});
      assert.equal(calls.filter(c=>c.action===action).length,1);
    }
  }
});
test('a rejected edit is not reconciled as a transport failure',async()=>{
  const {window,calls}=await recoveryBridge('updateCaffeineData',[caffeineEdited],'GAS_REJECTED');
  await assert.rejects(invokeEdit(window,'updateCaffeineData',caffeineEdit),{code:'GAS_REJECTED'});
  assert.equal(calls.length,1);
});
test('edit recovery bypasses an older shared history request',async()=>{
  let oldRead, reads=0;
  const {window}=loadBridge({fetchImpl:async(url,options)=>{
    if(url.endsWith('/login'))return response({success:true,...editSubject});
    const body=JSON.parse(options.body);
    if(body.action==='updateCaffeineData')return response({success:false,error:'GAS_UNAVAILABLE'},502);
    if(++reads===1)return new Promise(resolve=>{oldRead=resolve;});
    return response({success:true,data:[caffeineEdited],subject:editSubject});
  }});
  await window.appAuth.loginStudent('0','테스트');
  const history=invokeEdit(window,'getCaffeineLogs','0');
  const result=await invokeEdit(window,'updateCaffeineData',caffeineEdit);
  assert.equal(result.reconciled,true); assert.equal(reads,2);
  oldRead(response({success:true,data:[],subject:editSubject}));
  assert.equal((await history)[0].id,'saved');
});
test('edit recovery keeps failure when the server history is unavailable and never retries the edit',async()=>{
  for(const readResponse of [()=>response({success:false,error:'GAS_UNAVAILABLE'},502),()=>response({success:true,data:{id:'saved'},subject:editSubject})]) {
    const calls=[];
    const {window}=loadBridge({fetchImpl:async(url,options)=>{
      if(url.endsWith('/login'))return response({success:true,...editSubject});
      const action=JSON.parse(options.body).action; calls.push(action);
      return action==='updateCaffeineData'?response({success:false,error:'GAS_UNAVAILABLE'},502):readResponse();
    }});
    await window.appAuth.loginStudent('0','테스트');
    await assert.rejects(invokeEdit(window,'updateCaffeineData',caffeineEdit),{code:'GAS_UNAVAILABLE'});
    assert.equal(calls.filter(c=>c==='updateCaffeineData').length,1);
  }
});
test('edit recovery does not deliver data after a session changes while verification is pending',async()=>{
  let finishRead, readStarted;
  const reading=new Promise(resolve=>{readStarted=resolve;});
  const {window}=loadBridge({fetchImpl:async(url,options)=>{
    if(url.endsWith('/login'))return response({success:true,...editSubject});
    if(JSON.parse(options.body).action==='updateCaffeineData')return response({success:false,error:'GAS_UNAVAILABLE'},502);
    readStarted();return new Promise(resolve=>{finishRead=resolve;});
  }});
  await window.appAuth.loginStudent('0','테스트');
  let callbacks=0;
  window.google.script.run.withSuccessHandler(()=>callbacks++).withFailureHandler(()=>callbacks++).updateCaffeineData(caffeineEdit);
  await reading; window.appAuth.invalidateSession();
  finishRead(response({success:true,data:[caffeineEdited],subject:editSubject}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(callbacks,0);
});
test('edit recovery rejects another students verification response',async()=>{
  let expired=0;
  const {window}=loadBridge({fetchImpl:async(url,options)=>{
    if(url.endsWith('/login'))return response({success:true,...editSubject});
    if(JSON.parse(options.body).action==='updateCaffeineData')return response({success:false,error:'GAS_UNAVAILABLE'},502);
    return response({success:true,data:[caffeineEdited],subject:{studentId:'1',name:'다른학생'}});
  }});
  await window.appAuth.loginStudent('0','테스트'); window.appAuth.onSessionExpired(()=>expired++);
  let callbacks=0;
  window.google.script.run.withSuccessHandler(()=>callbacks++).withFailureHandler(()=>callbacks++).updateCaffeineData(caffeineEdit);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(callbacks,0);
  assert.equal(expired,1);
});
