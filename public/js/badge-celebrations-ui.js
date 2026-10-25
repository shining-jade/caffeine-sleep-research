(function() {
  'use strict';
  let receipts = new Set(), receiptOwner = '';
  const currentSubject = () => typeof user !== 'undefined' ? user : null;
  window.badgeCelebrations = BadgeCelebrations.create({
    subject: currentSubject,
    claim: () => new Promise((resolve, reject) => {
      const subject = currentSubject();
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)
        .claimBadgeCelebrations(subject.studentId, subject.name);
    }),
    available: () => !document.hidden && getComputedStyle(document.getElementById('teacherBadgeModal')).display === 'none',
    present: items => {
      window.activeBadgeCelebrations = items;
      _showTeacherBadgeModal(items);
      showUpdateNotification(items.length === 1 ? `🎉 ${items[0].name} 뱃지를 얻었습니다!` : `🎉 뱃지 ${items.length}개를 얻었습니다!`);
    },
    onError: () => { /* Keep the server claim authoritative; subsequent refresh/commit retries. */ }
  });
  window.addEventListener('student-sync-change', event => {
    const subject = currentSubject(); if (!subject) return;
    const owner = JSON.stringify([subject.studentId, subject.name]);
    if (receiptOwner !== owner) { receipts = new Set(); receiptOwner = owner; }
    let changed = false;
    (Array.isArray(event.detail) ? event.detail : []).forEach(row => {
      if (row.owner === owner && row.state === 'synced' && row.mutationId && !receipts.has(row.mutationId)) {
        receipts.add(row.mutationId); changed = true;
      }
    });
    if (changed && !document.hidden) void window.badgeCelebrations.refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { window.badgeCelebrations.closed(); void window.badgeCelebrations.refresh(); }
  });
})();
