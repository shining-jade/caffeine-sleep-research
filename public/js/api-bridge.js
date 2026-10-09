(function installApiBridge() {
  'use strict';

  var role = document.documentElement.dataset.appRole;
  if (role !== 'student' && role !== 'teacher') {
    throw new Error('Invalid application role.');
  }

  var expiredHandler = null;
  var sessionGeneration = 0;
  var studentIdentity = null;
  var pendingReads = new Map();
  var sync = role === 'student' && window.StudentSync ? window.StudentSync.create({
    send: function(action, payload) { return callAction(action, [payload]); },
    online: function() { return navigator.onLine !== false; },
    onChange: function(rows) { window.dispatchEvent(new CustomEvent('student-sync-change', { detail: rows })); },
  }) : null;
  if (sync) {
    window.studentSync = sync;
    window.addEventListener('online', function() { sync.flush(true); });
    window.addEventListener('pageshow', function() { sync.flush(); });
    document.addEventListener('visibilitychange', function() { if (!document.hidden) sync.flush(); });
    setInterval(function() { if (!document.hidden) sync.flush(); }, 15000);
  }
  var readRevision = 0;
  var sharedReads = new Set([
    'getStudentBootstrap', 'getWeightData', 'getStats', 'getFilteredStats', 'getCaffeineLogs', 'getSleepLogs',
    'getMyInquiries', 'getTeacherMessages', 'getTeacherAwardsForStudent',
    'getCaffeineDB', 'getBadgeConfig', 'getChallengeBadgeConfig', 'getSleepSettings',
  ]);

  function invalidateSession() {
    sessionGeneration++;
    pendingReads.clear();
    studentIdentity = null;
    if (sync) sync.setSubject(null);
  }

  function publicError(code, message, status) {
    var error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  async function requestJson(url, options) {
    var generation = sessionGeneration;
    var response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
    } catch (_error) {
      throw publicError('NETWORK_ERROR', '서버에 연결할 수 없습니다.', 503);
    }

    var payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw publicError('INVALID_RESPONSE', '서버 응답을 확인할 수 없습니다.', 502);
    }

    var currentSessionExpired = !url.endsWith('/login')
      && (response.status === 401 || payload?.error === 'SESSION_CHANGED') && generation === sessionGeneration;
    if (currentSessionExpired && typeof expiredHandler === 'function') {
      invalidateSession();
      try { expiredHandler(); } catch (_error) { /* UI callback errors do not change auth state. */ }
    }

    if (!response.ok || payload?.success === false) {
      var error = publicError(
        typeof payload?.error === 'string' ? payload.error : 'REQUEST_FAILED',
        '요청을 처리하지 못했습니다.',
        response.status,
      );
      error.currentSessionExpired = currentSessionExpired;
      throw error;
    }
    return payload;
  }

  var teacherQueue=[];
  var teacherActive=0;
  function scheduleTeacherRead(run,action,generation){
    return new Promise(function(resolve,reject){
      var job={run:run,resolve:resolve,reject:reject,generation:generation};
      if(action==='getTeacherData')teacherQueue.unshift(job);else teacherQueue.push(job);
      drainTeacherQueue();
    });
  }
  function drainTeacherQueue(){
    while(teacherActive<2&&teacherQueue.length){
      let job=teacherQueue.shift();
      if(job.generation!==sessionGeneration){job.reject(publicError('STALE_SESSION','로그인 정보가 변경되었습니다.',409));continue;}
      teacherActive++;
      Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(function(){teacherActive--;drainTeacherQueue();});
    }
  }
  function editedRecordMatches(action, expected, record) {
    if (!expected || !expected.id || String(record.id) !== String(expected.id)) return false;
    if (action === 'updateCaffeineData') {
      function timestamp(value) {
        var match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/);
        return match ? match[1] + 'T' + match[2] + ':' + (match[3] || '00') : null;
      }
      return typeof expected.drink === 'string' && record.name === expected.drink
        && Number.isFinite(expected.mg) && record.amount === expected.mg
        && timestamp(expected.time) !== null && timestamp(record.time) === timestamp(expected.time)
        && record.reason === (expected.reason || '') && record.symptom === (expected.symptom || '');
    }
    return ['date','wakeDate','condition'].every(function(key) {
      return typeof expected[key] === 'string' && expected[key] !== '' && record[key] === expected[key];
    }) && typeof expected.sleepTime === 'string' && record.start === expected.sleepTime
      && typeof expected.wakeTime === 'string' && record.end === expected.wakeTime
      && Number.isFinite(expected.hours) && record.hours === expected.hours
      && record.memo === (expected.memo || '')
      && ['smartphone','activity','latency','awakenings','daytime'].every(function(key) {
        return !Object.hasOwn(expected, key) || record[key] === (expected[key] || '');
      });
  }
  function callAction(action, params) {
    var generation = sessionGeneration;
    var revision = readRevision;
    var isRead = action.startsWith('get');
    var expectedSubject = studentIdentity;
    var key = JSON.stringify([sessionGeneration, action, params]);
    var share = (role === 'student' && sharedReads.has(action)) || (role === 'teacher' && action === 'getTeacherData');
    if (share && pendingReads.has(key)) return pendingReads.get(key);
    var requestOptions = {
      method: 'POST',
      body: JSON.stringify({ action: action, params: params, ...(expectedSubject ? { expectedSubject: expectedSubject } : {}) }),
    };
    var runRequest=function(){return requestJson('/api/' + role + '/action', requestOptions);};
    var request = (role==='teacher'?scheduleTeacherRead(runRequest,action,generation):runRequest()).catch(async function(error) {
      var recoverEdit = role === 'student' && expectedSubject
        && ['updateCaffeineData','updateSleepData'].includes(action)
        && ['GAS_UNAVAILABLE','GAS_TIMEOUT','NETWORK_ERROR','INVALID_RESPONSE'].includes(error.code);
      if (recoverEdit && generation === sessionGeneration) {
        // A lost acknowledgment does not prove a failed write. Read fresh server data;
        // never replay the edit or use an offline/shared snapshot as confirmation.
        readRevision++;
        pendingReads.clear();
        try {
          var records = await callAction(action === 'updateCaffeineData' ? 'getCaffeineLogs' : 'getSleepLogs', [expectedSubject.studentId]);
          if (generation !== sessionGeneration) throw publicError('STALE_SESSION', '로그인 정보가 변경되었습니다.', 409);
          var expected = JSON.parse(requestOptions.body).params[0];
          var matchingIds = Array.isArray(records) ? records.filter(function(record) {
            return record && expected?.id && String(record.id) === String(expected.id);
          }) : [];
          if (matchingIds.length === 1 && editedRecordMatches(action, expected, matchingIds[0])) {
            return { data: { success: true, reconciled: true }, subject: expectedSubject };
          }
        } catch (readError) {
          if (['STALE_SESSION','SESSION_CHANGED','UNAUTHENTICATED'].includes(readError.code)) throw readError;
        }
        throw error;
      }
      var retryableRead = role === 'student' && ['getStudentBootstrap', 'getStats', 'getFilteredStats', 'getCaffeineLogs', 'getSleepLogs'].includes(action);
      if (!retryableRead || !['GAS_UNAVAILABLE', 'NETWORK_ERROR'].includes(error.code) || generation !== sessionGeneration) throw error;
      await new Promise(function(resolve) { setTimeout(resolve, 600); });
      if (generation !== sessionGeneration) throw publicError('STALE_SESSION', '로그인 정보가 변경되었습니다.', 409);
      return requestJson('/api/' + role + '/action', requestOptions);
    }).then(function(payload) {
      if (isRead && revision !== readRevision && generation === sessionGeneration) return callAction(action, params);
      if (role === 'student' && expectedSubject && generation === sessionGeneration
          && (payload.subject?.studentId !== expectedSubject.studentId || payload.subject?.name !== expectedSubject.name)) {
        invalidateSession();
        if (typeof expiredHandler === 'function') expiredHandler();
        throw publicError('SESSION_CHANGED', '로그인 정보가 변경되었습니다.', 409);
      }
      if (role === 'student' && !isRead && generation === sessionGeneration) {
        readRevision++;
        pendingReads.clear();
      }
      return payload.data;
    });
    if (share) {
      pendingReads.set(key, request);
      var clean = function() { if (pendingReads.get(key) === request) pendingReads.delete(key); };
      request.then(clean, clean);
    }
    return request;
  }

  function buildRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function getRunnerProperty(_target, property) {
        if (property === 'withSuccessHandler') {
          return function withSuccessHandler(handler) {
            return buildRunner(handler, failureHandler);
          };
        }
        if (property === 'withFailureHandler') {
          return function withFailureHandler(handler) {
            return buildRunner(successHandler, handler);
          };
        }
        return function invokeAction() {
          var generation = sessionGeneration;
          var params = Array.prototype.slice.call(arguments);
          var action = String(property);
          var localId = action.startsWith('update') ? params[0]?.id : params[0];
          var localOperation = sync && typeof localId === 'string' && localId.startsWith('local_') && ['updateCaffeineData','updateSleepData','deleteCaffeineData','deleteSleepData'].includes(action);
          var invocation = localOperation ? (action.startsWith('update') ? sync.editPending(localId.slice(6), params[0]) : sync.cancelPending(localId.slice(6))).then(function() { return {success:true,localSaved:true}; }) : sync && window.StudentSync.actions.has(action)
            ? sync.enqueue(action, params[0])
            : callAction(action, params).then(function(value) { return sync && action.startsWith('get') ? sync.capture(action, value) : value; })
              .catch(function(error) {
                if (sync && action.startsWith('get') && ['NETWORK_ERROR','GAS_TIMEOUT','GAS_UNAVAILABLE'].includes(error.code)) return sync.read(action);
                throw error;
              });
          invocation
            .then(function onSuccess(value) {
              if (generation !== sessionGeneration) return;
              if (typeof successHandler === 'function') successHandler(value);
            })
            .catch(function onFailure(error) {
              if (generation !== sessionGeneration && !error.currentSessionExpired) return;
              if (generation + 1 < sessionGeneration) return;
              if (typeof failureHandler === 'function') failureHandler(error);
              else console.warn('요청 처리 실패:', error.code || 'REQUEST_FAILED');
            });
        };
      },
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = buildRunner(null, null);
  window.google.script.history = window.google.script.history || {
    push: function push() {},
    replace: function replace() {},
  };
  window.google.script.url = window.google.script.url || {
    getLocation: function getLocation(callback) {
      if (typeof callback === 'function') callback({});
    },
  };

  window.appAuth = {
    loginStudent: function loginStudent(studentId, name) {
      invalidateSession();
      return authenticate('/api/student/login', {
        method: 'POST',
        body: JSON.stringify({ studentId: studentId, name: name }),
      });
    },
    loginTeacher: function loginTeacher(password) {
      invalidateSession();
      return requestJson('/api/teacher/login', {
        method: 'POST',
        body: JSON.stringify({ password: password }),
      });
    },
    getSession: function getSession() {
      return authenticate('/api/' + role + '/session', { method: 'GET' }).catch(function(error) {
        if (!sync || error.code !== 'NETWORK_ERROR' || navigator.onLine !== false) throw error;
        var cached;
        try { cached = JSON.parse(localStorage.getItem('studentOfflineSession')); } catch (_) {}
        if (!cached?.studentId || !cached?.name) throw error;
        studentIdentity = { studentId: cached.studentId, name: cached.name };
        sync.setSubject(studentIdentity);
        return { ...cached, offline: true };
      });
    },
    logout: function logout(endpoint) {
      if (role === 'student') { try { localStorage.removeItem('studentOfflineSession'); } catch (_) {} }
      invalidateSession();
      var body = role === 'student' && typeof endpoint === 'string' && endpoint.length > 0
        ? { endpoint: endpoint }
        : {};
      return requestJson('/api/' + role + '/logout', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSessionExpired: function onSessionExpired(handler) {
      expiredHandler = typeof handler === 'function' ? handler : null;
    },
    invalidateSession: invalidateSession,
  };

  if (role === 'student') {
    window.appPush = {
      getConfig: function getConfig() {
        return requestJson('/api/student/push/config', { method: 'GET' });
      },
      subscribe: function subscribe(subscription, preferences) {
        return requestJson('/api/student/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            subscription: subscription,
            sleepEnabled: preferences.sleepEnabled,
            caffeineEnabled: preferences.caffeineEnabled,
          }),
        });
      },
      getPreferences: function getPreferences(subscriptionId) {
        return requestJson('/api/student/push/preferences', {
          method: 'GET',
          headers: { 'X-Push-Subscription-Id': subscriptionId },
        });
      },
      savePreferences: function savePreferences(value) {
        return requestJson('/api/student/push/preferences', {
          method: 'POST',
          body: JSON.stringify(value),
        });
      },
      unsubscribe: function unsubscribe(value) {
        return requestJson('/api/student/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify(value),
        });
      },
    };
  }

  function authenticate(url, options) {
    var generation = sessionGeneration;
    return requestJson(url, options).then(function(payload) {
      if (generation !== sessionGeneration) throw publicError('STALE_SESSION', '로그인 정보가 변경되었습니다.', 409);
      if (role === 'student' && payload.studentId && payload.name) {
        studentIdentity = { studentId: payload.studentId, name: payload.name };
        if (sync) {
          sync.setSubject(studentIdentity);
          try { localStorage.setItem('studentOfflineSession', JSON.stringify(payload)); } catch (_) {}
          sync.flush();
          if (navigator.storage?.persist) navigator.storage.persist().catch(function() {});
        }
      }
      return payload;
    }).catch(function(error) {
      if (generation !== sessionGeneration) throw publicError('STALE_SESSION', '로그인 정보가 변경되었습니다.', 409);
      throw error;
    });
  }
}());
