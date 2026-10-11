(function () {
  'use strict';
  function evaluate({ caffeine = [], profile = {}, today, sleep, sleepSettings = {} }) {
    const seen = new Set();
    let caffeineTotal = 0;
    for (const row of caffeine) {
      const id = String(row.id || JSON.stringify(row));
      if (seen.has(id)) continue;
      seen.add(id);
      const date = String(row.time || '').substring(0, 10);
      if (date === today) caffeineTotal += Number(row.amount) || 0;
    }
    const goal = Number(profile.targetCaf);
    return {
      caffeineTotal, goalMissing: !(goal > 0), caffeineExceeded: goal > 0 && caffeineTotal >= goal,
      sleepInsufficient: sleep ? Number(sleep.hours) < (Number(sleepSettings.sleepSevere) || 7) : false,
    };
  }
  function createSaveToast({
    document = window.document,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    let root, message, hideTimer = null, revision = 0;
    function dismiss() {
      revision++;
      if (hideTimer !== null) clearTimer(hideTimer);
      hideTimer = null;
      if (root) { root.hidden = true; message.textContent = ''; }
    }
    function show(text) {
      dismiss();
      if (!root) {
        root = document.createElement('div');
        root.id = 'studentSaveToast';
        root.className = 'student-save-toast';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.setAttribute('aria-atomic', 'true');
        root.hidden = true;
        const icon = document.createElement('span');
        icon.className = 'student-save-toast-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '✓';
        message = document.createElement('span');
        message.className = 'student-save-toast-message';
        const progress = document.createElement('div');
        progress.className = 'student-save-toast-progress';
        progress.setAttribute('aria-hidden', 'true');
        root.append(icon, message, progress);
        document.body.appendChild(root);
      }
      root.hidden = false;
      message.textContent = String(text || '기록이 저장됐어요');
      root.classList.remove('is-visible');
      void root.offsetWidth;
      root.classList.add('is-visible');
      const currentRevision = revision;
      hideTimer = setTimer(() => {
        if (currentRevision !== revision) return;
        hideTimer = null;
        root.hidden = true;
        message.textContent = '';
      }, 3000);
    }
    return { show, dismiss };
  }
  let saveToast;
  window.StudentFeedback = {
    evaluate, createSaveToast,
    showSaved(message) {
      if (!saveToast) saveToast = createSaveToast();
      saveToast.show(message);
    },
    dismissSaved() { if (saveToast) saveToast.dismiss(); },
  };
}());
