import { detectInstallEnvironment } from './install-guide.js';

const SUBSCRIPTION_ID_KEY = 'caffeinePushSubscriptionId';
const PENDING_LINK_KEY = 'caffeinePendingReminderLink';
const DENIED_KEY = 'caffeinePushPermissionDenied';

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseReminderDeepLink(search) {
  const params = new URLSearchParams(search || '');
  const type = params.get('open');
  const date = params.get('date');
  if ((type !== 'sleep' && type !== 'caffeine') || !validDate(date)) return null;
  return { type, date };
}

function applicationServerKey(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function defaultHashEndpoint(endpoint) {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function safeState(state) {
  return {
    status: state.status,
    permission: state.permission,
    supported: state.supported,
    sleepEnabled: state.sleepEnabled,
    caffeineEnabled: state.caffeineEnabled,
    sleepTime: state.sleepTime,
    caffeineTime: state.caffeineTime,
    globallyEnabled: state.globallyEnabled,
  };
}

export function createPushReminders({
  api,
  navigatorRef,
  NotificationRef,
  PushManagerRef,
  localStorageRef,
  sessionStorageRef,
  locationRef,
  historyRef,
  detectEnvironment,
  openInstallGuide,
  openRecord,
  hashEndpoint = defaultHashEndpoint,
  onState = () => {},
} = {}) {
  let config = null;
  let subscriptionId = null;
  let currentSubscription = null;
  let preferences = { sleepEnabled: true, caffeineEnabled: true };
  let state = {
    status: 'default', permission: 'default', supported: false,
    ...preferences, sleepTime: '', caffeineTime: '', globallyEnabled: false,
  };

  const pendingFromUrl = parseReminderDeepLink(locationRef?.search || '');
  if (pendingFromUrl) {
    try { sessionStorageRef?.setItem(PENDING_LINK_KEY, JSON.stringify(pendingFromUrl)); } catch { /* optional storage */ }
  }

  function environment() {
    return detectEnvironment();
  }

  function isSupported() {
    return Boolean(navigatorRef?.serviceWorker && NotificationRef && PushManagerRef && api);
  }

  function emit(patch = {}) {
    state = { ...state, ...patch };
    const visible = safeState(state);
    onState(visible);
    return visible;
  }

  function permissionState() {
    if (!isSupported()) return 'unsupported';
    const currentEnvironment = environment();
    if (['ios-safari', 'android-chrome', 'samsung'].includes(currentEnvironment)) return 'needs-install';
    if (currentEnvironment === 'naver') return 'needs-browser';
    return ['granted', 'denied'].includes(NotificationRef.permission) ? NotificationRef.permission : 'default';
  }

  async function getRegistration() {
    const registration = await navigatorRef.serviceWorker.register('/public/sw.js', { scope: '/' });
    if (!registration?.pushManager) throw new Error('Push is not supported.');
    return registration;
  }

  async function ensureConfig() {
    if (!config) config = await api.getConfig();
    return config;
  }

  async function idForSubscription(subscription) {
    const stored = localStorageRef?.getItem(SUBSCRIPTION_ID_KEY);
    if (/^[a-f0-9]{64}$/.test(stored || '')) return stored;
    const id = await hashEndpoint(subscription.endpoint);
    if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid subscription identifier.');
    localStorageRef?.setItem(SUBSCRIPTION_ID_KEY, id);
    return id;
  }

  function consumePendingLink() {
    let pending = null;
    try { pending = JSON.parse(sessionStorageRef?.getItem(PENDING_LINK_KEY) || 'null'); } catch { pending = null; }
    if (!pending || !validDate(pending.date) || !['sleep', 'caffeine'].includes(pending.type)) return;
    sessionStorageRef?.removeItem(PENDING_LINK_KEY);
    openRecord(pending);
    if (pendingFromUrl) historyRef?.replaceState?.({}, '', `${locationRef.pathname || '/'}${locationRef.hash || ''}`);
  }

  async function loadPreferences() {
    const registration = await getRegistration();
    currentSubscription = await registration.pushManager.getSubscription();
    if (!currentSubscription) return emit({ status: 'default' });
    subscriptionId = await idForSubscription(currentSubscription);
    const loaded = await api.getPreferences(subscriptionId);
    preferences = {
      sleepEnabled: loaded.sleepEnabled === true,
      caffeineEnabled: loaded.caffeineEnabled === true,
    };
    return emit({
      status: loaded.active === true ? 'enabled' : 'default',
      permission: NotificationRef.permission,
      ...preferences,
    });
  }

  async function initialize(session) {
    if (!session?.studentId) return emit();
    consumePendingLink();
    const supported = isSupported();
    const permission = permissionState();
    emit({ supported, permission, status: permission });
    try {
      if (!supported || permission === 'needs-install' || permission === 'needs-browser') return safeState(state);
      config = await ensureConfig();
      emit({
        sleepTime: String(config.sleepTime || ''),
        caffeineTime: String(config.caffeineTime || ''),
        globallyEnabled: config.globallyEnabled === true,
      });
      if (permission === 'granted') return await loadPreferences();
      return safeState(state);
    } catch {
      return emit({ status: 'error' });
    }
  }

  async function enable() {
    const permission = permissionState();
    if (permission === 'unsupported') return emit({ supported: false, status: 'unsupported', permission });
    if (permission === 'needs-install' || permission === 'needs-browser') {
      openInstallGuide();
      return emit({ supported: true, status: permission, permission });
    }
    try {
      config = await ensureConfig();
      const registration = await getRegistration();
      let resolvedPermission = NotificationRef.permission;
      if (resolvedPermission === 'default') resolvedPermission = await NotificationRef.requestPermission();
      if (resolvedPermission !== 'granted') {
        if (resolvedPermission === 'denied') localStorageRef?.setItem(DENIED_KEY, '1');
        return emit({ status: resolvedPermission, permission: resolvedPermission });
      }
      localStorageRef?.removeItem(DENIED_KEY);
      currentSubscription = await registration.pushManager.getSubscription();
      if (!currentSubscription) {
        currentSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.publicKey),
        });
      }
      const serialized = typeof currentSubscription.toJSON === 'function'
        ? currentSubscription.toJSON()
        : currentSubscription;
      const saved = await api.subscribe(serialized, preferences);
      subscriptionId = saved.subscriptionId;
      localStorageRef?.setItem(SUBSCRIPTION_ID_KEY, subscriptionId);
      return emit({
        supported: true,
        status: 'enabled',
        permission: 'granted',
        sleepTime: String(config.sleepTime || ''),
        caffeineTime: String(config.caffeineTime || ''),
        globallyEnabled: config.globallyEnabled === true,
        ...preferences,
      });
    } catch {
      return emit({ status: 'error' });
    }
  }

  async function savePreferences(value) {
    if (typeof value?.sleepEnabled !== 'boolean' || typeof value?.caffeineEnabled !== 'boolean') {
      throw new Error('Invalid reminder preferences.');
    }
    if (!subscriptionId && currentSubscription) subscriptionId = await idForSubscription(currentSubscription);
    if (!subscriptionId) return emit({ status: 'default' });
    const saved = await api.savePreferences({ subscriptionId, ...value });
    preferences = {
      sleepEnabled: saved.sleepEnabled === true,
      caffeineEnabled: saved.caffeineEnabled === true,
    };
    return emit({ status: saved.active === true ? 'enabled' : 'default', ...preferences });
  }

  async function unsubscribeCurrentDevice() {
    let subscription = currentSubscription;
    try {
      if (!subscription && isSupported()) subscription = await (await getRegistration()).pushManager.getSubscription();
    } catch { subscription = null; }
    const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : null;
    if (endpoint) {
      try { await api.unsubscribe({ endpoint }); } catch { /* Push provider expiry will also deactivate it later. */ }
      try { await subscription.unsubscribe(); } catch { /* Logout must continue. */ }
    }
    currentSubscription = null;
    subscriptionId = null;
    localStorageRef?.removeItem(SUBSCRIPTION_ID_KEY);
    emit({ status: 'default', sleepEnabled: false, caffeineEnabled: false });
    return endpoint;
  }

  return {
    initialize,
    enable,
    loadPreferences,
    savePreferences,
    unsubscribeCurrentDevice,
    permissionState,
  };
}

function renderStudentReminderState(state) {
  if (typeof document === 'undefined') return;
  const status = document.getElementById('pushPermissionStatus');
  const enable = document.getElementById('pushEnableBtn');
  const controls = document.getElementById('pushPreferenceControls');
  const sleep = document.getElementById('pushSleepEnabled');
  const caffeine = document.getElementById('pushCaffeineEnabled');
  const sleepTime = document.getElementById('pushSleepTime');
  const caffeineTime = document.getElementById('pushCaffeineTime');
  const labels = {
    unsupported: '이 브라우저에서는 알림을 지원하지 않아요.',
    'needs-install': '휴대폰은 앱으로 설치한 뒤 알림을 켤 수 있어요.',
    'needs-browser': '네이버 앱에서는 Safari, Chrome 또는 삼성 인터넷으로 열어 주세요.',
    default: '알림을 사용하지 않고 있어요.',
    denied: '브라우저 설정에서 알림을 허용해 주세요.',
    granted: '알림을 등록하는 중이에요.',
    enabled: state.globallyEnabled ? '이 기기의 알림이 켜져 있어요.' : '기기 설정은 완료됐어요. 선생님이 운영을 시작하면 알림이 와요.',
    error: '알림 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  };
  if (status) status.textContent = labels[state.status] || labels.default;
  if (enable) enable.hidden = state.status === 'enabled';
  if (controls) controls.hidden = state.status !== 'enabled';
  if (sleep) sleep.checked = state.sleepEnabled === true;
  if (caffeine) caffeine.checked = state.caffeineEnabled === true;
  if (sleepTime) sleepTime.textContent = state.sleepTime || '08:00';
  if (caffeineTime) caffeineTime.textContent = state.caffeineTime || '20:00';
}

function openRecordFromReminder(value) {
  if (typeof window.showTab !== 'function') return;
  window.showTab(value.type);
  if (value.type === 'sleep' && typeof window.applySleepReminderDate === 'function') {
    window.applySleepReminderDate(value.date);
    return;
  }
  const dateInput = document.getElementById(value.type === 'sleep' ? 'sleepDate' : 'caffeineTime');
  if (!dateInput) return;
  if (value.type === 'sleep') dateInput.value = value.date;
  else dateInput.value = `${value.date}T${String(dateInput.value || '').slice(11, 16) || '20:00'}`;
}

if (typeof window !== 'undefined') {
  const controller = createPushReminders({
    api: window.appPush,
    navigatorRef: navigator,
    NotificationRef: window.Notification,
    PushManagerRef: window.PushManager,
    localStorageRef: window.localStorage,
    sessionStorageRef: window.sessionStorage,
    locationRef: window.location,
    historyRef: window.history,
    detectEnvironment: () => detectInstallEnvironment({
      userAgent: navigator.userAgent,
      standalone: navigator.standalone === true,
      displayMode: window.matchMedia?.('(display-mode: standalone)').matches === true,
    }),
    openInstallGuide: () => window.installGuide?.open(),
    openRecord: openRecordFromReminder,
    onState: renderStudentReminderState,
  });
  window.pushReminders = controller;

  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pushEnableBtn')?.addEventListener('click', () => controller.enable());
    document.getElementById('pushDisableBtn')?.addEventListener('click', () => controller.unsubscribeCurrentDevice());
    const save = () => controller.savePreferences({
      sleepEnabled: document.getElementById('pushSleepEnabled')?.checked === true,
      caffeineEnabled: document.getElementById('pushCaffeineEnabled')?.checked === true,
    }).catch(() => renderStudentReminderState({ status: 'error' }));
    document.getElementById('pushSleepEnabled')?.addEventListener('change', save);
    document.getElementById('pushCaffeineEnabled')?.addEventListener('change', save);
  });
}
