(function installTeacherAuth() {
  'use strict';
  var enteredDashboard = false;

  document.documentElement.classList.add('teacher-auth-pending');
  var style = document.createElement('style');
  style.textContent = [
    '.teacher-auth-pending body > :not(#teacherAuthOverlay){visibility:hidden!important}',
    '#teacherAuthOverlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(145deg,#eef2ff,#f5f3ff);font-family:Pretendard,sans-serif}',
    '#teacherAuthCard{width:min(100%,390px);padding:32px;border-radius:24px;background:#fff;box-shadow:0 20px 60px rgba(30,41,59,.18)}',
    '#teacherAuthCard h1{margin:0 0 8px;font-size:24px;color:#1f2937;word-break:keep-all}',
    '#teacherAuthCard p{margin:0 0 22px;color:#6b7280;font-size:14px;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere}',
    '#teacherAuthOverlay{opacity:1;transition:opacity .18s ease}',
    '#teacherAuthOverlay[data-leaving="true"]{opacity:0;pointer-events:none}',
    '#teacherPassword{box-sizing:border-box;width:100%;padding:14px 16px;border:2px solid #e5e7eb;border-radius:14px;font-size:16px;outline:none}',
    '#teacherPassword:focus{border-color:#6366f1}',
    '#teacherLoginButton{width:100%;margin-top:12px;padding:14px;border:0;border-radius:14px;background:#4f46e5;color:#fff;font-weight:800;font-size:16px;cursor:pointer}',
    '#teacherAuthMessage{min-height:20px;margin:10px 0 0!important;color:#dc2626!important;font-size:13px!important}',
    '#teacherSecureLogout{position:static;padding:10px 14px;border:0;border-radius:12px;background:#1f2937;color:#fff;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap}',
    '#teacherLoadingBar{position:relative}',
    '#teacherLoadingBar[data-loading="true"] #teacherLoadingFill{animation:teacherLoadingSweep 1.4s ease-in-out infinite}',
    '@keyframes teacherLoadingSweep{0%,100%{transform:translateX(0)}50%{transform:translateX(185%)}}',
    '@media(prefers-reduced-motion:reduce){#teacherLoadingBar[data-loading="true"] #teacherLoadingFill{animation:none;transform:translateX(90%)}#teacherAuthOverlay{transition:none}}',
  ].join('');
  document.head.appendChild(style);

  function ensureOverlay(checking) {
    var overlay = document.getElementById('teacherAuthOverlay');
    if (overlay && !overlay.dataset.checking) return overlay;
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'teacherAuthOverlay';
    if (checking) {
      overlay.dataset.checking = 'true';
      overlay.innerHTML = '<div id="teacherAuthCard" role="status" aria-live="polite"><h1 id="teacherLoadingTitle">로그인 상태 확인 중...</h1><p id="teacherLoadingStage">잠시만 기다려주세요.</p><div id="teacherLoadingBar" data-loading="true" role="progressbar" aria-label="대시보드 준비 상태" aria-busy="true" style="height:12px;background:#e5e7eb;border-radius:8px;overflow:hidden;"><div id="teacherLoadingFill" style="height:100%;width:35%;background:#6366f1;transition:width .2s;"></div></div><p id="teacherLoadingStatus" style="margin:12px 0 0;font-weight:700;color:#4f46e5;">로그인 확인 중</p></div>';
      document.body.appendChild(overlay);
      return overlay;
    }
    overlay.innerHTML = '<form id="teacherAuthCard">'
      + '<h1>교사 화면 로그인</h1>'
      + '<p>교사 비밀번호를 입력해 주세요.</p>'
      + '<input id="teacherPassword" type="password" autocomplete="current-password" aria-label="교사 비밀번호">'
      + '<button id="teacherLoginButton" type="submit">로그인</button>'
      + '<p id="teacherAuthMessage" role="alert"></p>'
      + '</form>';
    document.body.appendChild(overlay);
    overlay.querySelector('form').addEventListener('submit', login);
    return overlay;
  }

  function addLogoutButton() {
    if (document.getElementById('teacherSecureLogout')) return;
    var button = document.createElement('button');
    button.id = 'teacherSecureLogout';
    button.type = 'button';
    button.textContent = '교사 로그아웃';
    button.addEventListener('click', async function() {
      try { window.clearTeacherViewCache?.();await window.appAuth.logout(); } finally { window.location.reload(); }
    });
    var logoutHost = document.querySelector('.header-actions') || document.body;
    logoutHost.appendChild(button);
  }

  window.teacherLoadingProgress = function(percent,label) {
    var complete=percent>=100;
    var bar=document.getElementById('teacherLoadingBar');
    if(bar?.dataset.complete==='true'&&!complete)return;
    if(bar){
      bar.dataset.complete=String(complete);
      bar.dataset.loading=complete?'false':'true';bar.setAttribute('aria-busy',String(!complete));
      if(complete)bar.setAttribute('aria-valuenow','100');else bar.removeAttribute('aria-valuenow');
    }
    var fill=document.getElementById('teacherLoadingFill');if(fill)fill.style.width=complete?'100%':'35%';
    var title=document.getElementById('teacherLoadingTitle');if(title)title.textContent=complete?'준비가 완료되었습니다':percent>=30?'대시보드 준비 중...':'로그인 상태 확인 중...';
    var text=document.getElementById('teacherLoadingStatus');
    if(text)text.textContent=complete?'✓ 대시보드를 엽니다':percent>=90?'화면 구성 중':percent>=70?'자료 확인 완료':percent>=30?'로그인 확인 완료':'로그인 확인 중';
    var stage=document.getElementById('teacherLoadingStage');if(stage)stage.textContent=label;
  };
  async function enterDashboard() {
    enteredDashboard = true;
    document.getElementById('teacherAuthOverlay')?.remove();
    ensureOverlay(true);
    window.teacherLoadingProgress(30,'로그인 확인 완료 · 데이터를 불러오는 중입니다');
    try {
      if (typeof window.startTeacherApp === 'function') await window.startTeacherApp();
      window.teacherLoadingProgress(100,'기록과 통계 화면을 준비했습니다.');
      await new Promise(resolve=>window.setTimeout(resolve,260));
      document.documentElement.classList.remove('teacher-auth-pending');
      addLogoutButton();
      var overlay=document.getElementById('teacherAuthOverlay');if(overlay)overlay.dataset.leaving='true';
      await new Promise(resolve=>window.setTimeout(resolve,180));
      overlay?.remove();
    } catch (_error) {
      var bar=document.getElementById('teacherLoadingBar');if(bar){bar.dataset.loading='false';bar.setAttribute('aria-busy','false');bar.removeAttribute('aria-valuenow');}
      var title=document.getElementById('teacherLoadingTitle');if(title)title.textContent='연결을 확인해주세요';
      var status=document.getElementById('teacherLoadingStatus');if(status)status.textContent='데이터 조회 실패';
      var stage=document.getElementById('teacherLoadingStage');if(stage)stage.textContent='데이터를 불러오지 못했습니다. 다시 시도해주세요.';
      var retry=document.createElement('button');retry.id='teacherLoadingRetry';retry.type='button';retry.textContent='다시 시도';
      retry.style.cssText='margin-top:16px;padding:12px 20px;border:0;border-radius:12px;background:#4f46e5;color:white;cursor:pointer;';
      retry.addEventListener('click',enterDashboard);
      document.getElementById('teacherAuthCard')?.appendChild(retry);
    }
  }

  async function login(event) {
    event.preventDefault();
    var input = document.getElementById('teacherPassword');
    var message = document.getElementById('teacherAuthMessage');
    var button = document.getElementById('teacherLoginButton');
    var password = input.value;
    if (!password) {
      message.textContent = '비밀번호를 입력해 주세요.';
      return;
    }
    button.disabled = true;
    button.textContent = '확인 중...';
    message.textContent = '';
    try {
      await window.appAuth.loginTeacher(password);
      input.value = '';
      await enterDashboard();
    } catch (_error) {
      input.value = '';
      message.textContent = '비밀번호가 올바르지 않거나 서버에 연결할 수 없습니다.';
      button.disabled = false;
      button.textContent = '로그인';
      input.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', async function() {
    ensureOverlay(true);
    window.appAuth.onSessionExpired(function() {
      window.clearTeacherViewCache?.();
      if (enteredDashboard) {
        window.location.replace('/teacher');
        return;
      }
      document.documentElement.classList.add('teacher-auth-pending');
      ensureOverlay();
    });
    try {
      await window.appAuth.getSession();
      await enterDashboard();
    } catch (_error) {
      window.clearTeacherViewCache?.();
      ensureOverlay();
      document.getElementById('teacherPassword')?.focus();
    }
  });
}());
