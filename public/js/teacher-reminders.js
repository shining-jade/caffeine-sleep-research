const CLASS_IDS = ['1', '2', '3', '4'];
const REMINDER_TYPES = new Set(['sleep', 'caffeine']);

export function wholeHourOptions() {
  return Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
}

function normalizeWholeHour(value) {
  const match = /^(\d{1,2}):00$/.exec(String(value || ''));
  if (!match) throw new Error('알림 시간은 정시 단위로 선택해 주세요.');
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('알림 시간이 올바르지 않습니다.');
  return `${String(hour).padStart(2, '0')}:00`;
}

function normalizeDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('반별 운영 기간을 모두 입력해 주세요.');
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('반별 운영 날짜가 올바르지 않습니다.');
  }
  return text;
}

export function normalizeTeacherReminderForm(value) {
  if (!value || typeof value !== 'object') throw new Error('알림 설정을 확인해 주세요.');
  for (const key of ['enabled', 'sleepEnabled', 'caffeineEnabled', 'includeWeekends']) {
    if (typeof value[key] !== 'boolean') throw new Error('알림 설정을 확인해 주세요.');
  }
  if (!Array.isArray(value.classPeriods) || value.classPeriods.length !== CLASS_IDS.length) {
    throw new Error('1~4반 운영 기간을 모두 입력해 주세요.');
  }
  const periods = new Map(value.classPeriods.map((period) => [String(period?.classId || ''), period]));
  if (periods.size !== CLASS_IDS.length || CLASS_IDS.some((classId) => !periods.has(classId))) {
    throw new Error('1~4반 운영 기간을 모두 입력해 주세요.');
  }
  const classPeriods = CLASS_IDS.map((classId) => {
    const period = periods.get(classId);
    const startDate = normalizeDate(period.startDate);
    const endDate = normalizeDate(period.endDate);
    if (startDate > endDate) throw new Error(`${classId}반 종료일은 시작일보다 빠를 수 없습니다.`);
    return { classId, startDate, endDate };
  });
  return {
    enabled: value.enabled,
    sleepEnabled: value.sleepEnabled,
    caffeineEnabled: value.caffeineEnabled,
    sleepTime: normalizeWholeHour(value.sleepTime),
    caffeineTime: normalizeWholeHour(value.caffeineTime),
    includeWeekends: value.includeWeekends,
    classPeriods,
  };
}

function normalizeLoadedConfig(value) {
  try {
    return normalizeTeacherReminderForm(value);
  } catch (error) {
    const periods = Array.isArray(value?.classPeriods) ? value.classPeriods : [];
    const initialDisabled = value?.enabled !== true
      && periods.length === CLASS_IDS.length
      && periods.every((period) => period?.startDate === '' && period?.endDate === '');
    if (!initialDisabled) throw error;
    const normalized = normalizeTeacherReminderForm({
      ...value,
      classPeriods: periods.map((period) => ({ ...period, startDate: '2000-01-01', endDate: '2000-01-01' })),
    });
    return {
      ...normalized,
      classPeriods: normalized.classPeriods.map((period) => ({ ...period, startDate: '', endDate: '' })),
    };
  }
}

function defaultLoadedConfig() {
  return {
    enabled: false,
    sleepEnabled: false,
    caffeineEnabled: false,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: false,
    classPeriods: CLASS_IDS.map((classId) => ({ classId, startDate: '', endDate: '' })),
  };
}

function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeTestResult(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    targeted: nonnegative(value.targeted),
    sent: nonnegative(value.sent),
    expired: nonnegative(value.expired),
    failed: nonnegative(value.failed),
  };
}

function safeTestStudentState(value = {}) {
  const sendingType = REMINDER_TYPES.has(value.sendingType) ? value.sendingType : null;
  return {
    status: typeof value.status === 'string' ? value.status : 'idle',
    name: '테스트',
    sleepDevices: nonnegative(value.sleepDevices),
    caffeineDevices: nonnegative(value.caffeineDevices),
    sendingType,
    result: safeTestResult(value.result),
    error: typeof value.error === 'string' ? value.error : '',
  };
}

function safeDashboardState(payload, extra = {}) {
  const byClass = {};
  for (const classId of CLASS_IDS) byClass[classId] = nonnegative(payload?.subscriberCounts?.byClass?.[classId]);
  return {
    hasLoadedConfig: Boolean(payload?.config),
    config: normalizeLoadedConfig(payload?.config || defaultLoadedConfig()),
    subscriberCounts: {
      students: nonnegative(payload?.subscriberCounts?.students),
      devices: nonnegative(payload?.subscriberCounts?.devices),
      byClass,
    },
    lastRun: {
      at: typeof payload?.lastRun?.at === 'string' ? payload.lastRun.at : '',
      targeted: nonnegative(payload?.lastRun?.targeted),
      sent: nonnegative(payload?.lastRun?.sent),
      expired: nonnegative(payload?.lastRun?.expired),
      failed: nonnegative(payload?.lastRun?.failed),
    },
    nextRuns: {
      sleep: typeof payload?.nextRuns?.sleep === 'string' ? payload.nextRuns.sleep : '',
      caffeine: typeof payload?.nextRuns?.caffeine === 'string' ? payload.nextRuns.caffeine : '',
    },
    status: typeof extra.status === 'string' ? extra.status : 'ready',
    testRegistered: extra.testRegistered === true,
    testStudent: safeTestStudentState(extra.testStudent),
  };
}

function applicationServerKey(value) {
  if (typeof value !== 'string' || value.length < 3) throw new Error('시험 알림 공개키를 확인할 수 없습니다.');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function serializeSubscription(subscription) {
  return typeof subscription?.toJSON === 'function' ? subscription.toJSON() : subscription;
}

export function createTeacherReminders({
  api,
  navigatorRef,
  NotificationRef,
  PushManagerRef,
  readForm,
  onState = () => {},
} = {}) {
  let payload = null;
  let state = null;
  let subscription = null;
  let initializing = null;
  let configSaving = null;
  let configRevision = 0;
  let testStudentRefreshing = null;
  let testStudentSending = null;

  function emit(extra = {}) {
    state = safeDashboardState(payload, { ...state, ...extra });
    onState(state);
    return state;
  }

  async function initialize() {
    if (initializing) return initializing;
    emit({ status: 'loading' });
    initializing = (async () => {
      try {
        payload = await api.getConfig();
        emit({ status: 'ready' });
        return refreshTestStudent();
      } catch (error) {
        emit({ status: 'load-error' });
        throw error;
      }
    })();
    try { return await initializing; } finally { initializing = null; }
  }

  function saveConfig() {
    if (configSaving) return configSaving;
    const normalized = normalizeTeacherReminderForm(readForm());
    const revision = ++configRevision;
    payload = { ...(payload || {}), config: normalized };
    emit({ status: 'saving' });
    configSaving = (async () => {
      try {
        const saved = await api.saveConfig(normalized);
        payload = { ...payload, config: saved?.config || normalized };
        const confirmed = emit({ status: 'saved' });
        Promise.resolve()
          .then(() => api.getConfig())
          .then((refreshed) => {
            if (revision !== configRevision) return;
            payload = refreshed;
            emit({ status: 'saved' });
          })
          .catch(() => { /* The save already succeeded; keep the confirmed values. */ });
        return confirmed;
      } finally {
        configSaving = null;
      }
    })();
    return configSaving;
  }

  function pushSupported() {
    return Boolean(navigatorRef?.serviceWorker && NotificationRef && PushManagerRef);
  }

  async function registration() {
    if (!pushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
    const value = await navigatorRef.serviceWorker.register('/public/sw.js', { scope: '/' });
    if (!value?.pushManager) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
    return value;
  }

  async function currentSubscription({ requestPermission = false } = {}) {
    const registered = await registration();
    let permission = NotificationRef.permission;
    if (permission === 'default' && requestPermission) permission = await NotificationRef.requestPermission();
    if (permission !== 'granted') throw new Error('브라우저 알림 권한을 허용해 주세요.');
    subscription = subscription || await registered.pushManager.getSubscription();
    if (!subscription && requestPermission) {
      subscription = await registered.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(payload?.publicKey),
      });
    }
    if (!subscription) throw new Error('먼저 이 기기를 시험 알림 기기로 등록해 주세요.');
    return serializeSubscription(subscription);
  }

  async function registerTestDevice() {
    if (!payload) await initialize();
    emit({ status: 'registering' });
    const serialized = await currentSubscription({ requestPermission: true });
    await api.testSubscribe(serialized);
    return emit({ status: 'test-registered', testRegistered: true });
  }

  async function sendTest(type) {
    if (!REMINDER_TYPES.has(type)) throw new Error('시험 알림 종류가 올바르지 않습니다.');
    if (!payload) await initialize();
    emit({ status: 'sending-test' });
    const serialized = await currentSubscription();
    await api.testSend(type, serialized);
    return emit({ status: 'test-sent', testRegistered: true });
  }

  function refreshTestStudent() {
    if (testStudentRefreshing) return testStudentRefreshing;
    const previous = safeTestStudentState(state?.testStudent);
    emit({ testStudent: { ...previous, status: 'loading', error: '' } });
    testStudentRefreshing = (async () => {
      try {
        const loaded = await api.getTestStudent();
        return emit({
          testStudent: {
            ...previous,
            status: 'ready',
            name: '테스트',
            sleepDevices: nonnegative(loaded?.sleepDevices),
            caffeineDevices: nonnegative(loaded?.caffeineDevices),
            sendingType: null,
            error: '',
          },
        });
      } catch {
        return emit({
          testStudent: {
            ...previous,
            status: 'error',
            sendingType: null,
            error: '테스트 학생 연결 상태를 확인하지 못했습니다.',
          },
        });
      } finally {
        testStudentRefreshing = null;
      }
    })();
    return testStudentRefreshing;
  }

  function sendTestStudent(type) {
    if (!REMINDER_TYPES.has(type)) return Promise.reject(new Error('시험 알림 종류가 올바르지 않습니다.'));
    if (testStudentSending) {
      if (testStudentSending.type === type) return testStudentSending.promise;
      return Promise.reject(new Error('다른 시험 알림 전송이 진행 중입니다.'));
    }
    const previous = safeTestStudentState(state?.testStudent);
    const deviceCount = type === 'sleep' ? previous.sleepDevices : previous.caffeineDevices;
    if (deviceCount < 1) return Promise.reject(new Error('이 알림 유형에 등록된 기기가 없습니다.'));

    const promise = (async () => {
      emit({ testStudent: { ...previous, status: 'sending', sendingType: type, error: '' } });
      try {
        const result = safeTestResult(await api.sendTestStudent(type));
        let latest = previous;
        try {
          const loaded = await api.getTestStudent();
          latest = {
            ...previous,
            sleepDevices: nonnegative(loaded?.sleepDevices),
            caffeineDevices: nonnegative(loaded?.caffeineDevices),
          };
        } catch { /* Preserve the last known counts after a successful send. */ }
        return emit({
          testStudent: {
            ...latest, status: 'sent', sendingType: null, result, error: '',
          },
        });
      } catch {
        emit({
          testStudent: {
            ...previous,
            status: 'error',
            sendingType: null,
            error: '테스트 학생 알림 요청을 처리하지 못했습니다.',
          },
        });
        throw new Error('테스트 학생 알림 요청을 처리하지 못했습니다.');
      } finally {
        testStudentSending = null;
      }
    })();
    testStudentSending = { type, promise };
    return promise;
  }

  return {
    initialize, saveConfig, registerTestDevice, sendTest,
    refreshTestStudent, sendTestStudent, getState: () => state,
  };
}

function requestJson(url, options = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(async (response) => {
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 확인할 수 없습니다.'); }
    if (!response.ok || data?.success === false) throw new Error('요청을 처리하지 못했습니다.');
    return data;
  });
}

function browserApi() {
  return {
    getConfig: () => requestJson('/api/teacher/reminders/config'),
    saveConfig: (config) => requestJson('/api/teacher/reminders/config', { method: 'POST', body: JSON.stringify(config) }),
    testSubscribe: (subscription) => requestJson('/api/teacher/reminders/test-subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),
    testSend: (type, subscription) => requestJson('/api/teacher/reminders/test-send', { method: 'POST', body: JSON.stringify({ type, subscription }) }),
    getTestStudent: () => requestJson('/api/teacher/reminders/test-student'),
    sendTestStudent: (type) => requestJson('/api/teacher/reminders/test-student', { method: 'POST', body: JSON.stringify({ type }) }),
  };
}

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = String(value ?? '');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function installTimeOptions() {
  for (const id of ['teacherReminderSleepTime', 'teacherReminderCaffeineTime']) {
    const select = element(id);
    if (!select || select.options.length) continue;
    for (const time of wholeHourOptions()) {
      const option = document.createElement('option');
      option.value = time;
      option.textContent = time;
      select.appendChild(option);
    }
  }
}

function readBrowserForm() {
  return {
    enabled: element('teacherReminderEnabled').checked,
    sleepEnabled: element('teacherReminderSleepEnabled').checked,
    caffeineEnabled: element('teacherReminderCaffeineEnabled').checked,
    sleepTime: element('teacherReminderSleepTime').value,
    caffeineTime: element('teacherReminderCaffeineTime').value,
    includeWeekends: element('teacherReminderIncludeWeekends').checked,
    classPeriods: CLASS_IDS.map((classId) => ({
      classId,
      startDate: element(`teacherReminderClass${classId}Start`).value,
      endDate: element(`teacherReminderClass${classId}End`).value,
    })),
  };
}

function renderBrowserState(state) {
  const config = state.config;
  const grid = document.querySelector('#tab-reminders .reminder-grid');
  if (grid) { grid.hidden = !state.hasLoadedConfig; grid.setAttribute('aria-busy', String(state.status === 'loading')); }
  if (state.hasLoadedConfig && state.status !== 'loading' && state.status !== 'load-error') {
  element('teacherReminderEnabled').checked = config.enabled;
  element('teacherReminderSleepEnabled').checked = config.sleepEnabled;
  element('teacherReminderCaffeineEnabled').checked = config.caffeineEnabled;
  element('teacherReminderSleepTime').value = config.sleepTime;
  element('teacherReminderCaffeineTime').value = config.caffeineTime;
  element('teacherReminderIncludeWeekends').checked = config.includeWeekends;
  for (const period of config.classPeriods) {
    element(`teacherReminderClass${period.classId}Start`).value = period.startDate;
    element(`teacherReminderClass${period.classId}End`).value = period.endDate;
  }
  setText('teacherReminderStudentCount', `${state.subscriberCounts.students}명`);
  setText('teacherReminderDeviceCount', `${state.subscriberCounts.devices}대`);
  for (const classId of CLASS_IDS) setText(`teacherReminderClass${classId}Count`, `${state.subscriberCounts.byClass[classId]}대`);
  setText('teacherReminderLastAt', formatDateTime(state.lastRun.at));
  setText('teacherReminderLastMetrics', `대상 ${state.lastRun.targeted} · 성공 ${state.lastRun.sent} · 만료 ${state.lastRun.expired} · 실패 ${state.lastRun.failed}`);
  setText('teacherReminderNextSleep', formatDateTime(state.nextRuns.sleep));
  setText('teacherReminderNextCaffeine', formatDateTime(state.nextRuns.caffeine));
  }
  const messages = {
    loading: state.hasLoadedConfig ? '저장된 설정을 표시하고 있습니다. 최신 정보를 확인하는 중입니다…' : '알림 설정을 불러오는 중입니다…',
    'load-error': state.hasLoadedConfig ? '최신 정보를 불러오지 못했습니다. 기존 설정을 표시합니다.' : '알림 설정을 불러오지 못했습니다. 알림 설정 탭을 다시 열어 주세요.',
    ready: config.enabled ? '알림 운영 중' : '현재 학생 알림은 꺼져 있습니다.',
    saving: '설정을 저장하는 중입니다…',
    saved: '설정을 저장했습니다.',
    registering: '이 기기를 등록하는 중입니다…',
    'test-registered': '이 브라우저를 시험 알림 기기로 등록했습니다.',
    'sending-test': '시험 알림을 보내는 중입니다…',
    'test-sent': '이 브라우저로 시험 알림을 보냈습니다.',
  };
  setText('teacherReminderStatus', messages[state.status] || '');
  const saveButton = element('teacherReminderSaveButton');
  if (saveButton) saveButton.disabled = !state.hasLoadedConfig || ['loading', 'load-error', 'saving'].includes(state.status);

  const testStudent = state.testStudent;
  setText('teacherTestStudentSummary', `${testStudent.name} · 수면 가능 기기 ${testStudent.sleepDevices}대 · 카페인 가능 기기 ${testStudent.caffeineDevices}대`);
  const testMessages = {
    idle: '연결 상태를 확인해 주세요.',
    loading: '테스트 학생의 알림 연결 상태를 확인하는 중입니다…',
    ready: (testStudent.sleepDevices + testStudent.caffeineDevices) > 0
      ? '유형별로 등록된 기기에만 시험 알림을 보냅니다.'
      : '학생 화면에서 앱 설치, 알림 켜기, 브라우저 알림 허용을 완료해 주세요.',
    sending: `${testStudent.sendingType === 'sleep' ? '수면' : '카페인'} 시험 알림을 보내는 중입니다…`,
    sent: '시험 알림 전송을 마쳤습니다.',
    error: testStudent.error,
  };
  setText('teacherTestStudentGuide', testMessages[testStudent.status] || '');
  setText('teacherTestStudentError', testStudent.error);
  setText('teacherTestStudentResult', testStudent.result
    ? `대상 ${testStudent.result.targeted} · 성공 ${testStudent.result.sent} · 만료 ${testStudent.result.expired} · 실패 ${testStudent.result.failed}`
    : '');
  const busy = testStudent.status === 'loading' || testStudent.sendingType !== null;
  const refreshButton = element('teacherTestStudentRefreshButton');
  const sleepButton = element('teacherTestStudentSleepButton');
  const caffeineButton = element('teacherTestStudentCaffeineButton');
  if (refreshButton) refreshButton.disabled = busy;
  if (sleepButton) sleepButton.disabled = busy || testStudent.sleepDevices < 1;
  if (caffeineButton) caffeineButton.disabled = busy || testStudent.caffeineDevices < 1;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installTimeOptions();
  const controller = createTeacherReminders({
    api: browserApi(),
    navigatorRef: window.navigator,
    NotificationRef: window.Notification,
    PushManagerRef: window.PushManager,
    readForm: readBrowserForm,
    onState: renderBrowserState,
  });
  async function run(action) {
    setText('teacherReminderError', '');
    try { return await action(); } catch (error) {
      setText('teacherReminderError', error?.message || '요청을 처리하지 못했습니다.');
      throw error;
    }
  }
  window.teacherReminders = {
    initialize: () => run(() => controller.initialize()),
    saveConfig: () => {
      const action = () => run(() => controller.saveConfig());
      return window.teacherSaveFeedback
        ? window.teacherSaveFeedback.runSave('reminders', action)
        : action();
    },
    registerTestDevice: () => run(() => controller.registerTestDevice()),
    sendTest: (type) => run(() => controller.sendTest(type)),
    refreshTestStudent: () => run(() => controller.refreshTestStudent()),
    sendTestStudent: (type) => run(() => controller.sendTestStudent(type)),
  };
}
