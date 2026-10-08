(function () {
  'use strict';
  if (!window.studentSync) return;
  let rendering = 0, currentOwner = null, appliedProfile = null;
  const panel = document.createElement('section');
  panel.id = 'deviceSyncStatus';
  panel.setAttribute('aria-live', 'polite');
  panel.style.cssText = 'display:none;position:sticky;top:0;z-index:40;padding:10px 14px;margin:8px 12px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:12px;';
  const status = document.createElement('span');
  const button = document.createElement('button');
  button.textContent = '지금 전송';
  button.style.cssText = 'margin-left:8px;padding:5px 9px;border-radius:8px;border:1px solid #93c5fd;background:white;';
  button.onclick = async () => { button.disabled = true; await window.studentSync.flush(true); button.disabled = false; await update(); };
  const feedback = document.createElement('p');
  feedback.style.cssText = 'margin:5px 0 0;font-weight:600;';
  panel.append(status, button, feedback);
  document.body.prepend(panel);
  async function update(rows) {
    const ticket = ++rendering;
    if (typeof user === 'undefined' || !user?.studentId) { panel.style.display = 'none'; return; }
    const owner = JSON.stringify([user.studentId, user.name]);
    const identity = user.studentId;
    rows = (rows || await window.studentSync.list()).filter(r => r.owner === owner);
    if (ticket !== rendering) return;
    currentOwner = owner;
    const pending = rows.filter(r => !['synced','cancelled'].includes(r.state));
    const attention = pending.some(r => r.state === 'needsAttention');
    const sending = pending.some(r => r.state === 'sending');
    const synced = rows.filter(r => r.state === 'synced');
    const last = synced.sort((a, b) => String(b.receipt?.committedAt).localeCompare(String(a.receipt?.committedAt)))[0];
    status.textContent = attention ? `휴대폰에 보관 중 · 확인 필요 ${pending.length}건. 연결된 상태에서 설정을 확인하고 다시 저장해주세요.` : pending.length ? `휴대폰 저장 완료 · ${sending ? '전송 중' : '전송 대기'} ${pending.length}건` : last ? `구글시트 반영 완료 · ${new Date(last.receipt.committedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}` : '휴대폰에 먼저 저장하고 자동 전송합니다';
    button.style.display = pending.length ? 'inline-block' : 'none';
    panel.style.display = 'block';
    try {
      const [caf, sleep, profile] = await Promise.all([
        window.studentSync.read('getCaffeineLogs'), window.studentSync.read('getSleepLogs'), window.studentSync.read('getWeightData'),
      ]);
      if (ticket !== rendering || user?.studentId !== identity || currentOwner !== owner) return;
      window.studentSyncProfile = profile;
      caffeineLogs = caf; sleepLogs = sleep;
      const profileKey = JSON.stringify(profile);
      if (profile?.success && profileKey !== appliedProfile && typeof applyWeightData === 'function') { applyWeightData(profile); appliedProfile = profileKey; }
      if (typeof renderCaffeineLogs === 'function') renderCaffeineLogs();
      if (typeof renderSleepLogs === 'function') renderSleepLogs();
      const today = typeof getTodayKST === 'function' ? getTodayKST() : '';
      const recentSleep = rows.filter(r => r.action === 'saveSleepData').sort((a, b) => b.createdAt - a.createdAt)[0];
      const result = window.StudentFeedback.evaluate({ caffeine: caf, profile: profile || {}, today, sleep: recentSleep?.payload, sleepSettings: typeof SLEEP_CFG !== 'undefined' ? SLEEP_CFG : {} });
      feedback.textContent = [result.caffeineExceeded ? `오늘 카페인 ${result.caffeineTotal}mg · 설정한 목표에 도달했습니다.` : '', result.sleepInsufficient ? '입력한 수면 시간이 수면 부족 기준보다 짧습니다.' : ''].filter(Boolean).join(' ');
      // Update local dashboard totals even when the network is unavailable.
      if (typeof syncConfirmedCaffeineStats === 'function') syncConfirmedCaffeineStats();
      if (typeof updateCaffeineBadge === 'function') updateCaffeineBadge();
    } catch (_) { /* A first-time device may not have any cached server records yet. */ }
  }
  window.addEventListener('student-sync-change', event => { void update(event.detail); });
  window.addEventListener('pageshow', () => { void update(); });
  setInterval(() => {
    if (typeof user === 'undefined' || !user?.studentId) { panel.style.display = 'none'; currentOwner = null; window.studentSyncProfile = null; }
    else if (currentOwner !== JSON.stringify([user.studentId, user.name])) void update();
  }, 1000);
}());
