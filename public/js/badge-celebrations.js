(function(root) {
  'use strict';
  function create({subject, claim, present, available = () => true, onError = () => {}}) {
    let generation = 0, owner = '', active = false, again = false, queued = [], delivered = new Set();
    const key = () => { const s = subject(); return s?.studentId && s?.name ? JSON.stringify([s.studentId, s.name]) : ''; };
    function reset() { generation++; owner = key(); active = false; again = false; queued = []; delivered = new Set(); }
    function drain() {
      if (key() !== owner) { reset(); return; }
      if (queued.length && available()) present(queued.splice(0));
    }
    async function refresh() {
      if (key() !== owner) reset();
      if (!owner) return;
      if (active) { again = true; return; }
      active = true; const ticket = generation;
      try {
        const response = await claim();
        if (ticket !== generation || key() !== owner) return;
        if (!response || response.success !== true || !Array.isArray(response.items)) throw new Error('BADGE_CLAIM_UNCONFIRMED');
        for (const item of response.items) {
          if (!item || !['automatic', 'teacher'].includes(item.kind) || typeof item.claimKey !== 'string' || !item.claimKey || typeof item.name !== 'string') continue;
          if (!delivered.has(item.claimKey)) { delivered.add(item.claimKey); queued.push(item); }
        }
        drain();
      } catch (error) { if (ticket === generation && key() === owner) onError(error); }
      finally {
        if (ticket === generation) { active = false; if (again) { again = false; void refresh(); } }
      }
    }
    return Object.freeze({refresh, reset, closed: drain});
  }
  root.BadgeCelebrations = Object.freeze({create});
})(globalThis);
