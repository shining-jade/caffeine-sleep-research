const ACTION_NAMES = [
  'getReminderDispatchSnapshot',
  'claimReminderDeliveries',
  'recordReminderDeliveryResults',
];

export const SCHEDULER_ACTIONS = new Set(ACTION_NAMES);

export function normalizeSchedulerRequest(action, params) {
  if (!SCHEDULER_ACTIONS.has(action)) throw new Error('Scheduler action is not allowed.');
  if (!Array.isArray(params)) throw new Error('Action parameters must be an array.');
  return { action, params: [...params], subject: null };
}
