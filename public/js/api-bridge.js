(function installApiBridge() {
  'use strict';

  var role = document.documentElement.dataset.appRole;
  if (role !== 'student' && role !== 'teacher') {
    throw new Error('Invalid application role.');
  }

  var expiredHandler = null;

  function publicError(code, message, status) {
    var error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  async function requestJson(url, options) {
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

    if (response.status === 401 && typeof expiredHandler === 'function') {
      try { expiredHandler(); } catch (_error) { /* UI callback errors do not change auth state. */ }
    }

    if (!response.ok || payload?.success === false) {
      throw publicError(
        typeof payload?.error === 'string' ? payload.error : 'REQUEST_FAILED',
        '요청을 처리하지 못했습니다.',
        response.status,
      );
    }
    return payload;
  }

  async function callAction(action, params) {
    var payload = await requestJson('/api/' + role + '/action', {
      method: 'POST',
      body: JSON.stringify({ action: action, params: params }),
    });
    return payload.data;
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
          var params = Array.prototype.slice.call(arguments);
          callAction(String(property), params)
            .then(function onSuccess(value) {
              if (typeof successHandler === 'function') successHandler(value);
            })
            .catch(function onFailure(error) {
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
      return requestJson('/api/student/login', {
        method: 'POST',
        body: JSON.stringify({ studentId: studentId, name: name }),
      });
    },
    loginTeacher: function loginTeacher(password) {
      return requestJson('/api/teacher/login', {
        method: 'POST',
        body: JSON.stringify({ password: password }),
      });
    },
    getSession: function getSession() {
      return requestJson('/api/' + role + '/session', { method: 'GET' });
    },
    logout: function logout() {
      return requestJson('/api/' + role + '/logout', { method: 'POST' });
    },
    onSessionExpired: function onSessionExpired(handler) {
      expiredHandler = typeof handler === 'function' ? handler : null;
    },
  };
}());
