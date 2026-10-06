(function installTeacherAuth() {
  'use strict';
  var enteredDashboard = false;

  document.documentElement.classList.add('teacher-auth-pending');
  var style = document.createElement('style');
  style.textContent = [
    '.teacher-auth-pending body > :not(#teacherAuthOverlay){visibility:hidden!important}',
    '#teacherAuthOverlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(145deg,#eef2ff,#f5f3ff);font-family:Pretendard,sans-serif}',
    '#teacherAuthCard{width:min(100%,390px);padding:32px;border-radius:24px;background:#fff;box-shadow:0 20px 60px rgba(30,41,59,.18)}',
    '#teacherAuthCard h1{margin:0 0 8px;font-size:24px;color:#1f2937}',
    '#teacherAuthCard p{margin:0 0 22px;color:#6b7280;font-size:14px}',
    '#teacherPassword{box-sizing:border-box;width:100%;padding:14px 16px;border:2px solid #e5e7eb;border-radius:14px;font-size:16px;outline:none}',
    '#teacherPassword:focus{border-color:#6366f1}',
    '#teacherLoginButton{width:100%;margin-top:12px;padding:14px;border:0;border-radius:14px;background:#4f46e5;color:#fff;font-weight:800;font-size:16px;cursor:pointer}',
    '#teacherAuthMessage{min-height:20px;margin:10px 0 0!important;color:#dc2626!important;font-size:13px!important}',
    '#teacherSecureLogout{position:static;padding:10px 14px;border:0;border-radius:12px;background:#1f2937;color:#fff;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap}',
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
      overlay.innerHTML = '<div id="teacherAuthCard" role="status" aria-live="polite"><h1>로그인 상태 확인 중...</h1><p>잠시만 기다려주세요.</p></div>';
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
      try { await window.appAuth.logout(); } finally { window.location.reload(); }
    });
    var logoutHost = document.querySelector('.header-actions') || document.body;
    logoutHost.appendChild(button);
  }

  function enterDashboard() {
    enteredDashboard = true;
    document.getElementById('teacherAuthOverlay')?.remove();
    document.documentElement.classList.remove('teacher-auth-pending');
    addLogoutButton();
    if (typeof window.startTeacherApp === 'function') window.startTeacherApp();
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
      enterDashboard();
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
      if (enteredDashboard) {
        window.location.replace('/teacher');
        return;
      }
      document.documentElement.classList.add('teacher-auth-pending');
      ensureOverlay();
    });
    try {
      await window.appAuth.getSession();
      enterDashboard();
    } catch (_error) {
      ensureOverlay();
      document.getElementById('teacherPassword')?.focus();
    }
  });
}());
