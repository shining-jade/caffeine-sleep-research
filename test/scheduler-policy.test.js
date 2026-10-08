import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSchedulerRequest, SCHEDULER_ACTIONS } from '../api/_lib/scheduler-policy.js';

test('scheduler role contains only reminder dispatch actions', () => {
  assert.deepEqual([...SCHEDULER_ACTIONS].sort(), [
    'claimReminderDeliveries', 'getReminderDispatchSnapshot', 'recordReminderDeliveryResults',
  ]);
  assert.deepEqual(normalizeSchedulerRequest('getReminderDispatchSnapshot', ['sleep', 'now']), {
    action: 'getReminderDispatchSnapshot', params: ['sleep', 'now'], subject: null,
  });
});

test('scheduler role rejects student teacher and arbitrary actions', () => {
  for (const action of ['savePushSubscription', 'getReminderAdminConfig', 'getTeacherData', 'constructor']) {
    assert.throws(() => normalizeSchedulerRequest(action, []), /not allowed/i);
  }
  assert.throws(() => normalizeSchedulerRequest('claimReminderDeliveries', {}), /array/i);
});
