(function installReadFeedback() {
  'use strict';
  var states = new Map();

  function stateFor(container, retry) {
    var state = states.get(container);
    if (!state) {
      var notice = document.createElement('div');
      notice.className = 'app-read-status';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'margin:8px 0;padding:10px 12px;background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:10px;font-size:13px;line-height:1.5;';
      var text = document.createElement('span');
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = '다시 조회';
      button.style.cssText = 'margin-left:10px;padding:4px 10px;border:1px solid #d97706;border-radius:6px;background:white;color:#92400e;cursor:pointer;';
      notice.appendChild(text);
      notice.appendChild(button);
      container.parentNode.insertBefore(notice, container);
      state = { notice:notice, text:text, button:button, loaded:false, pending:false, errors:new Set(), retry:retry };
      button.addEventListener('click', function() { if (!state.pending && state.retry) state.retry(); });
      states.set(container, state);
    }
    state.retry = retry || state.retry;
    return state;
  }

  window.ReadFeedback = {
    begin: function(container, retry) {
      var state = stateFor(container, retry);
      if (state.pending) { state.queued = true; return false; }
      state.pending = true;
      container.setAttribute('aria-busy', 'true');
      state.text.textContent = state.loaded ? '최신 내용을 확인하고 있습니다.' : '내용을 불러오고 있습니다.';
      state.button.hidden = true;
      state.notice.hidden = false;
      return true;
    },
    success: function(container) {
      var state = stateFor(container);
      state.pending = false;
      container.removeAttribute('aria-busy');
      // A refresh requested during this read (including after a confirmed write)
      // must run fresh. Its predecessor must not render an older snapshot.
      if (state.queued) {
        state.queued = false;
        state.retry();
        return false;
      }
      state.loaded = true;
      state.notice.hidden = true;
      return true;
    },
    fail: function(container, retry) {
      var state = stateFor(container, retry);
      state.pending = false;
      container.removeAttribute('aria-busy');
      if (state.queued) {
        state.queued = false;
        state.retry();
        return;
      }
      state.text.textContent = state.loaded
        ? '최신 내용을 불러오지 못했습니다. 마지막으로 확인한 내용을 표시합니다.'
        : '내용을 불러오지 못했습니다. 다시 조회해주세요.';
      state.button.hidden = false;
      state.notice.hidden = false;
    },
    report: function(container, kind, failed, retry) {
      if (!container) return;
      var state = stateFor(container, retry);
      if (failed) state.errors.add(kind); else state.errors.delete(kind);
      state.text.textContent = '새 알림을 확인하지 못했습니다. 기존 알림은 유지됩니다.';
      state.button.hidden = false;
      state.notice.hidden = state.errors.size === 0;
    },
    reset: function() {
      states.forEach(function(state, container) {
        state.notice.remove();
        container.removeAttribute('aria-busy');
      });
      states.clear();
    },
  };
})();
