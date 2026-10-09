import test from 'node:test';
import assert from 'node:assert/strict';

import { callGas } from '../api/_lib/gas.js';

process.env.GAS_API_URL = 'https://script.google.com/macros/s/private-deployment/exec';
process.env.GAS_SHARED_SECRET = 'private-gateway-secret';
process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-length';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

const request = {
  role: 'student',
  action: 'getStats',
  params: ['1101'],
  subject: { studentId: '1101', name: '테스트학생' },
  onDiagnostic() {},
};

test('a transient output failure recovers the committed receipt without replaying its write', async () => {
  for (const failure of ['http', 'network', 'body']) {
    let writes = 0;
    let reads = 0;
    const fetchImpl = async (url, options) => {
      if (options.method === 'POST') {
        writes++;
        return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=private-output' } });
      }
      assert.equal(url, 'https://script.googleusercontent.com/macros/echo?key=private-output');
      assert.equal(options.body, undefined);
      assert.equal(options.headers, undefined);
      reads++;
      if (reads === 1) {
        if (failure === 'network') throw new TypeError('private transport detail');
        if (failure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }));
        return new Response('temporary', { status: 503 });
      }
      return new Response(JSON.stringify({ success: true, data: { success: true, recordId: 'saved-once' } }));
    };
    const result = await callGas({ ...request, action: 'saveCaffeineData', fetchImpl });
    assert.equal(result.recordId, 'saved-once');
    assert.equal(writes, 1);
    assert.equal(reads, 2);
  }
});

test('a transient Google output 404 is reread once without reexecuting lookup or mutation', async () => {
  for (const action of ['getTestStudentReminderTargets', 'recordTestStudentReminderResults']) {
    let executions = 0, outputReads = 0;
    const result = await callGas({ ...request, role: 'teacher', action, fetchImpl: async (url, options) => {
      if (options.method === 'POST') {
        executions++;
        return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=private-output' } });
      }
      assert.equal(url, 'https://script.googleusercontent.com/macros/echo?key=private-output');
      outputReads++;
      return outputReads === 1 ? new Response('not ready', { status: 404 })
        : new Response(JSON.stringify({ success: true, data: { success: true } }));
    } });
    assert.equal(result.success, true);
    assert.equal(executions, 1);
    assert.equal(outputReads, 2);
  }
});

test('persistent output 404 has one bounded reread and execution 404 is never replayed', async () => {
  let executions = 0, outputReads = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === 'POST') {
      executions++;
      return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=private-output' } });
    }
    outputReads++; return new Response('missing', { status: 404 });
  };
  await assert.rejects(callGas({ ...request, action: 'saveCaffeineData', fetchImpl }), error => error.code === 'GAS_UNAVAILABLE');
  assert.equal(executions, 1); assert.equal(outputReads, 2);
  executions = 0;
  await assert.rejects(callGas({ ...request, action: 'saveCaffeineData', fetchImpl: async () => {
    executions++; return new Response('missing', { status: 404 });
  } }), error => error.code === 'GAS_UNAVAILABLE');
  assert.equal(executions, 1);
});

test('transient output 302 rereads the same result once without following its target or replaying a mutation', async () => {
  for (const action of ['getReminderStudentConfig', 'getReminderAdminConfig', 'saveCaffeineData']) {
    let executions = 0, reads = 0;
    const recoveries = [];
    const outputUrl = 'https://script.googleusercontent.com/macros/echo?key=private-output';
    const result = await callGas({ ...request, action, onRecovery: event => recoveries.push(event),
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') {
          executions++;
          return new Response(null, { status: 302, headers: { Location: outputUrl } });
        }
        assert.equal(url, outputUrl); assert.equal(options.body, undefined); assert.equal(options.headers, undefined);
        reads++;
        if (reads === 1) return new Response(null, { status: 302,
          headers: { Location: 'https://accounts.google.com/private-auth?token=private-value' } });
        return new Response(JSON.stringify({ success: true, data: { ok: true } }));
      },
    });
    assert.equal(result.ok, true); assert.equal(executions, 1); assert.equal(reads, 2);
    assert.deepEqual(recoveries, [{ role: request.role, action, upstreamStatus: 302, outputReads: 2 }]);
    assert.doesNotMatch(JSON.stringify(recoveries), /private|1101|테스트학생/);
  }
});

test('persistent output 302 stays blocked after one safe reread and diagnoses only a fixed redirect category', async () => {
  for (const [location, expectedKind] of [
    ['https://accounts.google.com/private?token=secret', 'google_sign_in'],
    ['https://example.com/collect?secret=private', 'external_host'],
    ['https://script.google.com/macros/s/private/exec', 'execution_from_output'],
  ]) {
    let executions = 0, reads = 0;
    const diagnostics = [];
    await assert.rejects(callGas({ ...request, action: 'saveCaffeineData', onDiagnostic: event => diagnostics.push(event),
      fetchImpl: async (url, options) => {
        if (options.method === 'POST') {
          executions++;
          return new Response(null, { status: 302, headers: {
            Location: 'https://script.googleusercontent.com/macros/echo?key=private-output' } });
        }
        assert.equal(new URL(url).hostname, 'script.googleusercontent.com');
        reads++; return new Response(null, { status: 302, headers: { Location: location } });
      },
    }), error => error.code === 'GAS_UNAVAILABLE');
    assert.equal(executions, 1); assert.equal(reads, 2);
    assert.equal(diagnostics[0].redirectKind, expectedKind);
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret|private|example\.com|1101|테스트학생/);
  }
});

test('recovery diagnostics count actual output reads across allowed output redirects', async () => {
  let reads = 0;
  const recoveries = [];
  const first = 'https://script.googleusercontent.com/macros/echo?key=first';
  const second = 'https://script.googleusercontent.com/macros/echo?key=second';
  const result = await callGas({ ...request, onRecovery: event => recoveries.push(event),
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') return new Response(null, { status: 302, headers: { Location: first } });
      reads++;
      if (reads <= 2) { assert.equal(url, first); return new Response(null, { status: 302, headers: { Location: second } }); }
      assert.equal(url, second); return new Response(JSON.stringify({ success: true, data: { ok: true } }));
    },
  });
  assert.equal(result.ok, true); assert.equal(reads, 3); assert.equal(recoveries[0].outputReads, 3);
});

test('output retries stop after one retry and log only safe failure metadata', async () => {
  const diagnostics = [];
  let writes = 0;
  let reads = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === 'POST') {
      writes++;
      return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=private-output' } });
    }
    reads++;
    return new Response('private student-health-value', { status: 503 });
  };
  await assert.rejects(callGas({ ...request, action: 'saveCaffeineData', fetchImpl, onDiagnostic: value => diagnostics.push(value) }), error => error.code === 'GAS_UNAVAILABLE');
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, 'output');
  assert.equal(diagnostics[0].reason, 'http_status');
  assert.equal(diagnostics[0].upstreamStatus, 503);
  const text = JSON.stringify(diagnostics);
  for (const privateValue of [process.env.GAS_SHARED_SECRET, process.env.GAS_API_URL, 'private-output', 'student-health-value', '1101', '테스트학생']) assert.equal(text.includes(privateValue), false);
});

test('output rejection and abort never replay the write or retry a rejected result', async () => {
  for (const failure of ['denied', 'abort', 'malformed']) {
    let reads = 0;
    let writes = 0;
    const fetchImpl = async (_url, options) => {
      if (options.method === 'POST') {
        writes++;
        return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=output' } });
      }
      reads++;
      if (failure === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (failure === 'malformed') return new Response('<html>invalid response</html>');
      return new Response('denied', { status: 403 });
    };
    await assert.rejects(callGas({ ...request, action: 'saveTeacherPdfAndSendMessage', fetchImpl }), error => error.code === (failure === 'abort' ? 'GAS_TIMEOUT' : 'GAS_UNAVAILABLE'));
    assert.equal(writes, 1);
    assert.equal(reads, 1);
  }
});

test('callGas sends POST text plain body', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
  };

  await callGas({ ...request, fetchImpl });

  assert.equal(captured.url, process.env.GAS_API_URL);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(captured.options.body), {
    secret: process.env.GAS_SHARED_SECRET,
    role: request.role,
    action: request.action,
    params: request.params,
    subject: request.subject,
  });
});

test('callGas follows a successful Apps Script response', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ success: true, data: { count: 3 } }),
    { status: 200 },
  );

  assert.deepEqual(await callGas({ ...request, fetchImpl }), { count: 3 });
});

test('DB retries a GET service response but never treats it as database data', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify(calls === 1
      ? { success: true, service: 'caffeine-sleep-api' }
      : { success: true, data: { success: true, data: [{ f: '커피' }] } }));
  };
  const result = await callGas({ ...request, action: 'getCaffeineDB', fetchImpl });
  assert.equal(result.data.length, 1);
  assert.equal(calls, 2);
});

test('DB retries are bounded and writes are never replayed', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('unavailable', { status: 503 }); };
  await assert.rejects(callGas({ ...request, action: 'getCaffeineDB', fetchImpl }));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(callGas({ ...request, action: 'saveCaffeineData', fetchImpl }));
  assert.equal(calls, 1);
});

test('script execution redirects retain POST, output redirects use GET without secret', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: 'https://script.google.com/a/domain/macros/s/private-deployment/exec' } });
    if (calls.length === 2) return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=output' } });
    return new Response(JSON.stringify({ success: true, data: { success: true, data: [{ f: '커피' }] } }));
  };
  const result = await callGas({ ...request, action: 'getCaffeineDB', fetchImpl });
  assert.equal(result.data.length, 1);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, calls[0].options.body);
  assert.equal(calls[2].options.method, 'GET');
  assert.equal(calls[2].options.body, undefined);
});

test('callGas rejects upstream success false', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ success: false, error: 'private sheet detail' }),
    { status: 200 },
  );

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => error.code === 'GAS_REJECTED'
      && error.status === 502
      && !error.message.includes('private sheet detail'),
  );
});

test('redirects cannot send the gateway secret to another host', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/collect' } });
  };
  await assert.rejects(callGas({ ...request, fetchImpl }), error => error.code === 'GAS_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('callGas rejects an HTML redirect page', async () => {
  const fetchImpl = async () => new Response('<html>Google login</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => error.code === 'GAS_UNAVAILABLE' && error.status === 502,
  );
});

test('callGas times out', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  await assert.rejects(
    callGas({ ...request, fetchImpl, timeoutMs: 5 }),
    (error) => error.code === 'GAS_TIMEOUT' && error.status === 504,
  );
});

test('callGas never exposes URL secret or upstream body in its public error', async () => {
  const privateBody = 'student-health-value';
  const fetchImpl = async () => new Response(privateBody, { status: 500 });

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => {
      const rendered = `${error.message} ${error.stack}`;
      return error.code === 'GAS_UNAVAILABLE'
        && !rendered.includes(process.env.GAS_API_URL)
        && !rendered.includes(process.env.GAS_SHARED_SECRET)
        && !rendered.includes(privateBody);
    },
  );
});

test('personal record reads reject a health response instead of returning missing data', async () => {
  for (const action of ['getCaffeineLogs', 'getSleepLogs', 'getStats']) {
    await assert.rejects(callGas({ ...request, action, fetchImpl: async () => new Response(JSON.stringify({success:true,service:'caffeine-sleep-api'})) }), error => error.code === 'GAS_UNAVAILABLE');
  }
});

test('teacher primary read retries transient upstream failure once without retrying mutations',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return calls===1?new Response('temporary',{status:502}):new Response(JSON.stringify({success:true,data:{success:true,students:[]}}));};
 const result=await callGas({role:'teacher',action:'getTeacherData',params:[],fetchImpl});assert.equal(result.success,true);assert.equal(calls,2);
 calls=0;await assert.rejects(callGas({role:'teacher',action:'updateTeacherHiddenStudents',params:[['2410'],true],fetchImpl:async()=>{calls++;return new Response('temporary',{status:502})}}));assert.equal(calls,1);
});
