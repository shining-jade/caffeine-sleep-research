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
  var sharedReads = new Set([
    'getStudentBootstrap', 'getWeightData', 'getStats', 'getFilteredStats', 'getCaffeineLogs', 'getSleepLogs',
    'getMyInquiries', 'getTeacherMessages', 'getTeacherAwardsForStudent',
    'getCaffeineDB', 'getBadgeConfig', 'getChallengeBadgeConfig', 'getSleepSettings',
  ]);

  function invalidateSession() {
    sessionGeneration++;
    pendingReads.clear();
    studentIdentity = null;
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

  function callAction(action, params) {
    var generation = sessionGeneration;
    var expectedSubject = studentIdentity;
    var key = JSON.stringify([sessionGeneration, action, params]);
    var share = role === 'student' && sharedReads.has(action);
    if (share && pendingReads.has(key)) return pendingReads.get(key);
    var request = requestJson('/api/' + role + '/action', {
      method: 'POST',
      body: JSON.stringify({ action: action, params: params, ...(expectedSubject ? { expectedSubject: expectedSubject } : {}) }),
    }).then(function(payload) {
      if (role === 'student' && expectedSubject && generation === sessionGeneration
          && (payload.subject?.studentId !== expectedSubject.studentId || payload.subject?.name !== expectedSubject.name)) {
        invalidateSession();
        if (typeof expiredHandler === 'function') expiredHandler();
        throw publicError('SESSION_CHANGED', '로그인 정보가 변경되었습니다.', 409);
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
          callAction(String(property), params)
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
      return authenticate('/api/' + role + '/session', { method: 'GET' });
    },
    logout: function logout(endpoint) {
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
      }
      return payload;
    }).catch(function(error) {
      if (generation !== sessionGeneration) throw publicError('STALE_SESSION', '로그인 정보가 변경되었습니다.', 409);
      throw error;
    });
  }
}());
