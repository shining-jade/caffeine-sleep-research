const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalidConfig() {
  return new Error('Invalid reminder config.');
}

function normalizeDate(value) {
  if (typeof value !== 'string') throw invalidConfig();
  const match = value.match(DATE_PATTERN);
  if (!match) throw invalidConfig();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalidConfig();
  }
  return value;
}

function normalizeHour(value) {
  if (typeof value !== 'string') throw invalidConfig();
  const match = value.trim().match(/^(\d{1,2})(?::00)?$/);
  if (!match) throw invalidConfig();
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) throw invalidConfig();
  return `${String(hour).padStart(2, '0')}:00`;
}

export function getKstClock(nowMs) {
  const date = new Date(nowMs);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid clock value.');
  const parts = Object.fromEntries(
    KST_FORMATTER.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: WEEKDAYS[parts.weekday],
  };
}

export function previousKstDate(value) {
  const normalized = normalizeDate(value);
  const [year, month, day] = normalized.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return [
    String(previous.getUTCFullYear()).padStart(4, '0'),
    String(previous.getUTCMonth() + 1).padStart(2, '0'),
    String(previous.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function normalizeReminderConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidConfig();
  if (!Array.isArray(value.classPeriods)) throw invalidConfig();

  const classPeriods = value.classPeriods.map((period) => {
    if (!period || typeof period !== 'object' || Array.isArray(period)) throw invalidConfig();
    const classId = String(period.classId ?? '').trim();
    const startDate = normalizeDate(period.startDate);
    const endDate = normalizeDate(period.endDate);
    if (!classId || startDate > endDate) throw invalidConfig();
    return { classId, startDate, endDate };
  });

  return {
    enabled: value.enabled === true,
    sleepEnabled: value.sleepEnabled === true,
    caffeineEnabled: value.caffeineEnabled === true,
    sleepTime: normalizeHour(value.sleepTime),
    caffeineTime: normalizeHour(value.caffeineTime),
    includeWeekends: value.includeWeekends === true,
    classPeriods,
  };
}

export function normalizeStoredReminderConfig(value) {
  try {
    return normalizeReminderConfig(value);
  } catch (error) {
    const periods = Array.isArray(value?.classPeriods) ? value.classPeriods : [];
    const isInitialDisabledConfig = value?.enabled !== true && periods.length > 0
      && periods.every((period) => period?.startDate === '' && period?.endDate === '');
    if (!isInitialDisabledConfig) throw error;

    const normalized = normalizeReminderConfig({
      ...value,
      classPeriods: periods.map((period) => ({
        ...period,
        startDate: '2000-01-01',
        endDate: '2000-01-01',
      })),
    });
    return {
      ...normalized,
      classPeriods: normalized.classPeriods.map((period) => ({
        ...period,
        startDate: '',
        endDate: '',
      })),
    };
  }
}

export function deliveryKey({ referenceDate, type, subscriptionId }) {
  return `${referenceDate}:${type}:${subscriptionId}`;
}

function addCalendarDays(dateText, offset) {
  const [year, month, day] = dateText.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return [
    String(value.getUTCFullYear()).padStart(4, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function weekdayForCalendarDate(dateText) {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getNextReminderTimes({ config, nowMs }) {
  const clock = getKstClock(nowMs);
  const result = { sleep: null, caffeine: null };
  for (const type of ['sleep', 'caffeine']) {
    if (!config?.[`${type}Enabled`]) continue;
    const hour = Number(config[`${type}Time`]?.slice(0, 2));
    if (!Number.isInteger(hour)) continue;
    for (let offset = 0; offset <= 370; offset += 1) {
      const date = addCalendarDays(clock.date, offset);
      const weekday = weekdayForCalendarDate(date);
      if (!config.includeWeekends && (weekday === 0 || weekday === 6)) continue;
      const active = (config.classPeriods || []).some((period) => (
        period.startDate <= date && date <= period.endDate
      ));
      if (!active || (offset === 0 && hour < clock.hour)) continue;
      result[type] = `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`;
      break;
    }
  }
  return result;
}

export function selectReminderCandidates({
  type,
  nowMs,
  config,
  students,
  completedStudentIds,
  subscriptions,
  successfulDeliveryKeys,
}) {
  if (type !== 'sleep' && type !== 'caffeine') return [];
  if (!config?.enabled || !config?.[`${type}Enabled`]) return [];

  const clock = getKstClock(nowMs);
  if (!config.includeWeekends && (clock.weekday === 0 || clock.weekday === 6)) return [];
  const configuredHour = Number(config[`${type}Time`]?.slice(0, 2));
  if (!Number.isInteger(configuredHour) || configuredHour !== clock.hour) return [];

  const periods = new Map((config.classPeriods || []).map((period) => [String(period.classId), period]));
  const eligibleStudents = new Set();
  for (const student of students || []) {
    const period = periods.get(String(student?.classId ?? ''));
    const studentId = String(student?.studentId ?? '').trim();
    if (studentId && period && period.startDate <= clock.date && clock.date <= period.endDate) {
      eligibleStudents.add(studentId);
    }
  }

  const completed = new Set(Array.from(completedStudentIds || [], (value) => String(value)));
  const successful = new Set(Array.from(successfulDeliveryKeys || [], (value) => String(value)));
  const referenceDate = type === 'sleep' ? previousKstDate(clock.date) : clock.date;
  const seenSubscriptions = new Set();
  const candidates = [];

  for (const subscription of subscriptions || []) {
    const studentId = String(subscription?.studentId ?? '').trim();
    const subscriptionId = String(subscription?.subscriptionId ?? '').trim();
    if (!studentId || !subscriptionId || seenSubscriptions.has(subscriptionId)) continue;
    seenSubscriptions.add(subscriptionId);
    if (!eligibleStudents.has(studentId) || completed.has(studentId)) continue;
    if (subscription.active !== true || subscription[`${type}Enabled`] !== true) continue;

    const key = deliveryKey({ referenceDate, type, subscriptionId });
    if (successful.has(key)) continue;
    candidates.push({
      studentId,
      subscriptionId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      referenceDate,
      type,
    });
  }

  return candidates;
}
