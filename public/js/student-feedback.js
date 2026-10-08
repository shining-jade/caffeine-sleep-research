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
  window.StudentFeedback = { evaluate };
}());
