import assert from 'node:assert/strict';
import test from 'node:test';

const feedbackModule = await import('../public/js/teacher-save-feedback.js').catch(() => ({}));
const { createTeacherSaveFeedback } = feedbackModule;

function keyboardEvent(overrides = {}) {
  return {
    key: 's',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

test('Ctrl or Command S saves only the active teacher settings tab', async () => {
  assert.equal(typeof createTeacherSaveFeedback, 'function');
  const calls = [];
  let activeTab = 'reminders';
  const feedback = createTeacherSaveFeedback({
    getActiveTab: () => activeTab,
    saveReminder: async () => { calls.push('reminders'); },
    saveSettings: async () => { calls.push('settings'); },
  });

  const ctrlEvent = keyboardEvent();
  assert.equal(feedback.handleKeydown(ctrlEvent), true);
  assert.equal(ctrlEvent.prevented, true);
  await Promise.resolve();

  activeTab = 'settings';
  const commandEvent = keyboardEvent({ ctrlKey: false, metaKey: true });
  assert.equal(feedback.handleKeydown(commandEvent), true);
  assert.equal(commandEvent.prevented, true);
  await Promise.resolve();

  activeTab = 'overview';
  const inactiveEvent = keyboardEvent();
  assert.equal(feedback.handleKeydown(inactiveEvent), false);
  assert.equal(inactiveEvent.prevented, false);
  assert.deepEqual(calls, ['reminders', 'settings']);
});

test('success feedback expires after five seconds while failure stays visible until dismissed', () => {
  assert.equal(typeof createTeacherSaveFeedback, 'function');
  const rendered = [];
  const timers = [];
  const feedback = createTeacherSaveFeedback({
    render: (state) => rendered.push(state),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
  });

  feedback.show('success', '알림 설정을 저장했습니다.');
  assert.deepEqual(rendered.at(-1), {
    visible: true, type: 'success', message: '알림 설정을 저장했습니다.', persistent: false,
  });
  assert.equal(timers.at(-1).delay, 5000);
  timers.at(-1).callback();
  assert.equal(rendered.at(-1).visible, false);

  const timerCount = timers.length;
  feedback.show('error', '저장하지 못했습니다. 다시 시도해 주세요.');
  assert.deepEqual(rendered.at(-1), {
    visible: true, type: 'error', message: '저장하지 못했습니다. 다시 시도해 주세요.', persistent: true,
  });
  assert.equal(timers.length, timerCount);
  feedback.dismiss();
  assert.equal(rendered.at(-1).visible, false);
});

test('save feedback reports progress and the real success or failure result', async () => {
  assert.equal(typeof createTeacherSaveFeedback, 'function');
  const rendered = [];
  const feedback = createTeacherSaveFeedback({
    render: (state) => rendered.push(state),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  await feedback.runSave('reminders', async () => 'saved');
  assert.deepEqual(rendered.slice(-2).map(({ type, message }) => [type, message]), [
    ['loading', '알림 설정을 저장하는 중입니다…'],
    ['success', '알림 설정을 저장했습니다.'],
  ]);

  await assert.rejects(() => feedback.runSave('settings', async () => { throw new Error('private detail'); }));
  assert.deepEqual(rendered.slice(-2).map(({ type, message, persistent }) => [type, message, persistent]), [
    ['loading', '설정을 저장하는 중입니다…', false],
    ['error', '저장하지 못했습니다. 다시 시도해 주세요.', true],
  ]);
});
