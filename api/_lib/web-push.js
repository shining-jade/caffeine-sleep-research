import webPush from 'web-push';

import { getPushRuntimeConfig } from './env.js';

const COPY = Object.freeze({
  sleep: Object.freeze({
    title: '좋은 아침이에요 ☀️',
    body: '어젯밤 수면 기록을 간단히 남겨보세요.',
  }),
  caffeine: Object.freeze({
    title: '오늘의 기록을 돌아볼 시간이에요 🌙',
    body: '오늘의 카페인 기록을 확인해 주세요. 마시지 않았다면 ‘섭취 안 함’을 선택하면 돼요.',
  }),
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function statusCodeOf(error) {
  const value = Number(error?.statusCode);
  return Number.isInteger(value) ? value : null;
}

function failureCode(statusCode) {
  if (statusCode === 429) return 'PUSH_RATE_LIMITED';
  if (statusCode !== null && statusCode >= 500) return 'PUSH_SERVER_ERROR';
  if (statusCode !== null) return 'PUSH_REJECTED';
  return 'PUSH_UNAVAILABLE';
}

export function buildNotificationPayload({ type, referenceDate }) {
  const copy = COPY[type];
  if (!copy || typeof referenceDate !== 'string' || !DATE_PATTERN.test(referenceDate)) {
    throw new Error('Invalid notification payload.');
  }
  const legacy = {
    title: copy.title,
    body: copy.body,
    tag: `record-${type}-${referenceDate}`,
    data: {
      type,
      referenceDate,
      url: `/?open=${type}&date=${referenceDate}`,
    },
  };
  // Supporting browsers open the record URL natively, even when worker click
  // handling is unavailable. Other browsers keep using the legacy fields.
  return JSON.stringify({
    ...legacy,
    web_push: 8030,
    mutable: false,
    notification: {
      ...legacy,
      navigate: legacy.data.url,
      icon: '/public/icons/icon-192.png',
      badge: '/public/icons/icon-192.png',
    },
  });
}

export function createPushSender({
  config = getPushRuntimeConfig(),
  sendNotification = webPush.sendNotification.bind(webPush),
  setVapidDetails = webPush.setVapidDetails.bind(webPush),
  delay = defaultDelay,
  maxAttempts = 2,
} = {}) {
  const attemptsLimit = Math.max(1, Math.min(3, Math.floor(maxAttempts)));
  setVapidDetails(config.subject, config.publicKey, config.privateKey);

  return {
    async send(subscription, payload) {
      for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
        try {
          await sendNotification(subscription, payload, { timeout: 10_000 });
          return { status: 'success', errorCode: null };
        } catch (error) {
          const statusCode = statusCodeOf(error);
          if (statusCode === 404 || statusCode === 410) {
            return { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' };
          }
          const retryable = statusCode === 429 || (statusCode !== null && statusCode >= 500);
          if (!retryable || attempt === attemptsLimit) {
            return { status: 'failed', errorCode: failureCode(statusCode) };
          }
          await delay(100 * attempt);
        }
      }
      return { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' };
    },
  };
}
