const SAVE_COPY = {
  reminders: {
    loading: '알림 설정을 저장하는 중입니다…',
    success: '알림 설정을 저장했습니다.',
  },
  settings: {
    loading: '설정을 저장하는 중입니다…',
    success: '설정을 저장했습니다.',
  },
};

const FAILURE_COPY = '저장하지 못했습니다. 다시 시도해 주세요.';

export function createTeacherSaveFeedback({
  getActiveTab = () => '',
  saveReminder = () => {},
  saveSettings = () => {},
  render = () => {},
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  let hideTimer = null;

  function emit(state) {
    render({ visible: false, type: '', message: '', persistent: false, ...state });
  }

  function dismiss() {
    if (hideTimer !== null) clearTimer(hideTimer);
    hideTimer = null;
    emit({ visible: false });
  }

  function show(type, message) {
    if (hideTimer !== null) clearTimer(hideTimer);
    hideTimer = null;
    const persistent = type === 'error';
    emit({ visible: true, type, message, persistent });
    if (type === 'success') {
      hideTimer = setTimer(() => {
        hideTimer = null;
        emit({ visible: false });
      }, 5000);
    }
  }

  async function runSave(kind, action) {
    const copy = SAVE_COPY[kind] || SAVE_COPY.settings;
    show('loading', copy.loading);
    try {
      const result = await action();
      show('success', copy.success);
      return result;
    } catch (error) {
      show('error', FAILURE_COPY);
      throw error;
    }
  }

  function handleKeydown(event) {
    const shortcut = String(event?.key || '').toLowerCase() === 's'
      && (event.ctrlKey === true || event.metaKey === true)
      && event.altKey !== true
      && event.shiftKey !== true;
    if (!shortcut) return false;
    const handlers = { reminders: saveReminder, settings: saveSettings };
    const handler = handlers[getActiveTab()];
    if (typeof handler !== 'function') return false;
    event.preventDefault();
    Promise.resolve().then(() => handler()).catch(() => {});
    return true;
  }

  return { dismiss, handleKeydown, runSave, show };
}

function installBrowserFeedback() {
  const root = document.createElement('div');
  root.id = 'teacherSaveToast';
  root.className = 'teacher-save-toast';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const message = document.createElement('span');
  message.className = 'teacher-save-toast-message';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'teacher-save-toast-close';
  close.setAttribute('aria-label', '저장 알림 닫기');
  close.textContent = '×';
  root.append(message, close);
  document.body.appendChild(root);

  const feedback = createTeacherSaveFeedback({
    getActiveTab: () => document.querySelector('.tab-content.active')?.id?.replace(/^tab-/, '') || '',
    saveReminder: () => window.teacherReminders?.saveConfig(),
    saveSettings: () => window.saveSettings?.(),
    render: (state) => {
      root.className = `teacher-save-toast teacher-save-toast-${state.type || 'idle'}${state.visible ? ' is-visible' : ''}`;
      root.setAttribute('aria-live', state.type === 'error' ? 'assertive' : 'polite');
      message.textContent = state.message;
      close.hidden = !state.persistent;
    },
  });
  close.addEventListener('click', feedback.dismiss);
  document.addEventListener('keydown', feedback.handleKeydown);
  window.teacherSaveFeedback = feedback;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installBrowserFeedback, { once: true });
  else installBrowserFeedback();
}
