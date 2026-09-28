let deferredInstallPrompt = null;
let lastFocusedElement = null;

export function detectInstallEnvironment({ userAgent = '', standalone = false, displayMode = false } = {}) {
  if (standalone || displayMode) return 'installed';
  const ua = String(userAgent);
  if (/NAVER|NaverApp/i.test(ua)) return 'naver';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) return 'ios-safari';
  if (/Android/i.test(ua) && /Chrome|CriOS/i.test(ua)) return 'android-chrome';
  return 'unsupported';
}

const GUIDES = Object.freeze({
  'ios-safari': {
    label: 'iPhone · Safari',
    intro: 'Safari에서 아래 순서대로 홈 화면에 추가해 주세요.',
    screens: [
      ['1', 'Safari 아래쪽 도구 막대', '가운데의 <b>공유</b> 버튼(□↑)을 누르세요.', '□↑'],
      ['2', '공유 메뉴', '목록을 위로 올려 <b>홈 화면에 추가</b>를 누르세요.', '＋ 홈 화면에 추가'],
      ['3', '홈 화면에 추가', '오른쪽 위 <b>추가</b>를 누른 뒤 홈 화면 아이콘으로 여세요.', '추가'],
      ['4', '앱의 알림 설정', '로그인 후 <b>알림 켜기</b>를 눌러 iPhone 알림을 허용하세요.', '허용'],
    ],
  },
  'android-chrome': {
    label: 'Android · Chrome',
    intro: 'Chrome 메뉴나 아래 설치 버튼을 사용하세요.',
    screens: [
      ['1', 'Chrome 오른쪽 위', '<b>점 3개(⋮)</b> 메뉴를 누르세요.', '⋮'],
      ['2', 'Chrome 메뉴', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.', '앱 설치'],
      ['3', '설치 확인', '<b>설치</b>를 누르고 홈 화면 아이콘으로 여세요.', '설치'],
      ['4', '앱의 알림 설정', '로그인 후 <b>알림 켜기</b>를 눌러 알림을 허용하세요.', '허용'],
    ],
  },
  samsung: {
    label: 'Android · 삼성 인터넷',
    intro: '삼성 인터넷의 아래쪽 메뉴에서 추가할 수 있어요.',
    screens: [
      ['1', '삼성 인터넷 아래쪽', '<b>메뉴(☰)</b>를 누르세요.', '☰'],
      ['2', '페이지 도구', '<b>현재 페이지 추가</b>를 선택하세요.', '＋ 현재 페이지 추가'],
      ['3', '추가 위치', '<b>홈 화면</b>을 선택하고 추가하세요.', '홈 화면'],
      ['4', '앱의 알림 설정', '로그인 후 <b>알림 켜기</b>를 눌러 알림을 허용하세요.', '허용'],
    ],
  },
  naver: {
    label: '네이버 앱',
    intro: '네이버 앱 안에서는 설치·알림 기능이 제한될 수 있어요.',
    screens: [
      ['1', '현재 페이지 주소', '오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>를 찾으세요.', '다른 브라우저로 열기'],
      ['2', 'iPhone', '<b>Safari</b>로 연 뒤 iPhone 안내를 따라 주세요.', 'Safari'],
      ['3', 'Android', '<b>Chrome 또는 삼성 인터넷</b>으로 연 뒤 해당 안내를 따라 주세요.', 'Chrome'],
    ],
  },
  installed: {
    label: '설치된 앱',
    intro: '이미 홈 화면 앱으로 실행 중이에요.',
    screens: [
      ['✓', '설치 완료', '로그인한 뒤 <b>알림 켜기</b>에서 아침·저녁 알림을 선택할 수 있어요.', '알림 설정'],
    ],
  },
  unsupported: {
    label: '다른 브라우저',
    intro: '기록 기능은 그대로 사용할 수 있습니다.',
    screens: [
      ['1', '휴대폰에서 다시 열기', 'iPhone은 <b>Safari</b>, Android는 <b>Chrome 또는 삼성 인터넷</b>을 권장해요.', '권장 브라우저'],
      ['2', '설치하지 않아도 사용 가능', '홈 화면 설치 없이도 로그인과 기록은 계속 사용할 수 있어요.', '바로 사용'],
    ],
  },
});

function currentEnvironment() {
  return detectInstallEnvironment({
    userAgent: navigator.userAgent,
    standalone: navigator.standalone === true,
    displayMode: window.matchMedia?.('(display-mode: standalone)').matches === true,
  });
}

function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.id = 'installGuideDialog';
  dialog.setAttribute('aria-labelledby', 'installGuideTitle');
  dialog.innerHTML = `
    <style>
      #installGuideDialog{width:min(94vw,440px);max-height:90vh;border:0;border-radius:24px;padding:0;color:#1f2937;box-shadow:0 24px 80px rgba(15,23,42,.35);font-family:inherit}
      #installGuideDialog::backdrop{background:rgba(15,23,42,.66);backdrop-filter:blur(3px)}
      .ig-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 20px 14px;background:#fff;border-bottom:1px solid #eef2ff}
      .ig-head h2{font-size:20px;font-weight:800;margin:0}.ig-head p{font-size:12px;color:#6b7280;margin:5px 0 0}.ig-close{border:0;background:#f3f4f6;border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer}
      .ig-body{padding:16px 18px 22px;overflow:auto}.ig-switch{display:flex;gap:7px;overflow:auto;padding-bottom:12px}.ig-switch button{white-space:nowrap;border:1px solid #dbeafe;background:#fff;color:#475569;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:700}.ig-switch button[aria-pressed=true]{background:#4f46e5;color:#fff;border-color:#4f46e5}
      .ig-note{background:#eef2ff;color:#4338ca;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.55;margin-bottom:12px}.ig-phone{background:#111827;border-radius:28px;padding:9px;margin:12px auto;max-width:330px;box-shadow:0 12px 30px rgba(15,23,42,.18)}
      .ig-screen{background:#f8fafc;border-radius:21px;min-height:108px;padding:12px}.ig-toolbar{display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:12px;padding:8px 10px;font-size:11px;color:#64748b;margin-bottom:10px}.ig-pill{background:#e0e7ff;color:#4338ca;border-radius:9px;padding:6px 9px;font-size:11px;font-weight:800}
      .ig-step{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start}.ig-num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#4f46e5;color:#fff;font-size:12px;font-weight:800}.ig-step h3{font-size:14px;margin:0 0 4px;font-weight:800}.ig-step p{font-size:12px;line-height:1.55;color:#475569;margin:0}.ig-action{width:100%;border:0;border-radius:14px;padding:13px;background:#4f46e5;color:#fff;font:700 14px inherit;cursor:pointer;margin-top:6px}.ig-action[hidden]{display:none}.ig-help{font-size:11px;color:#64748b;text-align:center;margin-top:10px;line-height:1.5}
    </style>
    <div class="ig-head"><div><h2 id="installGuideTitle">📲 앱 설치·알림 설정 방법</h2><p>내 휴대폰 화면과 비슷한 안내를 보고 따라 하세요.</p></div><button class="ig-close" type="button" aria-label="닫기">×</button></div>
    <div class="ig-body"><div class="ig-switch" role="group" aria-label="브라우저 선택"></div><div class="ig-content"></div></div>`;
  dialog.querySelector('.ig-close').addEventListener('click', () => installGuide.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) installGuide.close(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); installGuide.close(); });
  document.body.appendChild(dialog);
  return dialog;
}

function render(environment) {
  const dialog = document.getElementById('installGuideDialog') || createDialog();
  const switcher = dialog.querySelector('.ig-switch');
  switcher.replaceChildren();
  for (const [key, label] of [
    ['ios-safari', 'iPhone Safari'], ['android-chrome', 'Android Chrome'],
    ['samsung', '삼성 인터넷'], ['naver', '네이버 앱'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(key === environment));
    button.addEventListener('click', () => render(key));
    switcher.appendChild(button);
  }
  const guide = GUIDES[environment] || GUIDES.unsupported;
  const content = dialog.querySelector('.ig-content');
  content.innerHTML = `<div class="ig-note"><b>${guide.label}</b><br>${guide.intro}</div>${guide.screens.map(([number, title, body, control]) => `
    <div class="ig-phone"><div class="ig-screen"><div class="ig-toolbar"><span>카페인·수면 기록</span><span class="ig-pill">${control}</span></div><div class="ig-step"><span class="ig-num">${number}</span><div><h3>${title}</h3><p>${body}</p></div></div></div></div>`).join('')}
    <button type="button" class="ig-action" ${environment === 'android-chrome' && deferredInstallPrompt ? '' : 'hidden'}>지금 앱 설치하기</button>
    <p class="ig-help">설치 후 알림은 자동으로 켜지지 않아요. 로그인한 뒤 직접 “알림 켜기”를 눌러 선택합니다.</p>`;
  content.querySelector('.ig-action')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    render(currentEnvironment());
  });
}

export const installGuide = {
  open() {
    if (typeof document === 'undefined') return;
    lastFocusedElement = document.activeElement;
    render(currentEnvironment());
    const dialog = document.getElementById('installGuideDialog');
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.ig-close')?.focus();
  },
  close() {
    const dialog = typeof document === 'undefined' ? null : document.getElementById('installGuideDialog');
    if (dialog?.open) dialog.close();
    lastFocusedElement?.focus?.();
  },
  select(environment) {
    if (GUIDES[environment]) render(environment);
  },
};

if (typeof window !== 'undefined') {
  window.installGuide = installGuide;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/public/sw.js', { scope: '/' }).catch(() => {});
    });
  }
}
