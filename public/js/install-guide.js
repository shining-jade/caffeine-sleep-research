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
    intro: '알림은 앱 설치 후 사용할 수 있어요. 바로가기 만들기만으로는 알림이 정상 작동하지 않을 수 있습니다.',
    screens: [
      ['1', 'Chrome 오른쪽 위', '<b>점 3개(⋮)</b> 메뉴를 누르세요.', '⋮'],
      ['2', 'Chrome 메뉴', '<b>앱 설치</b>를 누르세요. <b>바로가기 만들기</b>는 선택하지 마세요.', '앱 설치'],
      ['3', '설치 확인', '<b>설치</b>를 누르고 홈 화면 아이콘으로 여세요.', '설치'],
      ['4', '앱의 알림 설정', '로그인 후 <b>알림 켜기</b>를 눌러 알림을 허용하세요.', '허용'],
    ],
  },
  samsung: {
    label: 'Android · 삼성 인터넷',
    intro: '삼성 인터넷의 아래쪽 메뉴에서 추가할 수 있어요.',
    screens: [
      ['1', '삼성 인터넷 메뉴', '아래쪽의 <b>메뉴(☰)</b>를 누르세요.', '☰'],
      ['2', '페이지 도구', '<b>현재 페이지 추가</b>를 선택하세요.', '＋ 현재 페이지 추가'],
      ['3', '추가 위치', '<b>홈 화면</b>을 선택하고 추가하세요.', '홈 화면'],
      ['4', '앱의 알림 설정', '로그인 후 <b>알림 켜기</b>를 눌러 알림을 허용하세요.', '허용'],
    ],
  },
  naver: {
    label: '네이버 앱',
    intro: '네이버 앱 안에서는 설치·알림 기능이 제한될 수 있어요.',
    screens: [
      ['1', '네이버 앱 메뉴', '오른쪽 위 <b>점 3개(⋮)</b>를 누르세요.', '⋮'],
      ['2', '브라우저 선택 메뉴', '<b>다른 브라우저로 열기</b>를 누르세요.', '다른 브라우저로 열기'],
      ['3', 'iPhone', '<b>Safari</b>로 연 뒤 iPhone 안내를 따라 주세요.', 'Safari'],
      ['4', 'Android', '<b>Chrome 또는 삼성 인터넷</b>으로 연 뒤 해당 안내를 따라 주세요.', 'Chrome'],
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

const BROWSER_UI = Object.freeze({
  'ios-safari': 'safari',
  'android-chrome': 'chrome',
  samsung: 'samsung',
  naver: 'naver',
});

const BROWSER_VISUALS = Object.freeze({
  'ios-safari': [
    `<div class="ig-status"><span>9:41</span><span>●●● ᯤ ▰</span></div><div class="ig-webpage"><b>카페인·수면 기록</b><span>오늘의 기록</span></div><div class="ig-safari-url"><span>가가</span><b>🔒 caffeine-sleep…</b><span>↻</span></div><div class="ig-safari-bar"><span>‹</span><span>›</span><span class="ig-focus">⇧<small>공유</small></span><span>▤</span><span>▢</span></div><div class="ig-callout">Safari 도구 막대</div>`,
    `<div class="ig-status"><span>9:41</span><span>●●● ᯤ ▰</span></div><div class="ig-dim-page"></div><div class="ig-ios-sheet"><div class="ig-grabber"></div><div class="ig-share-title"><span class="ig-app-dot">기록</span><span><b>카페인·수면 기록</b><small>caffeine-sleep-research.vercel.app</small></span></div><div class="ig-ios-row"><span>＋</span><b>홈 화면에 추가</b><span>›</span></div><div class="ig-ios-row muted"><span>☆</span><span>즐겨찾기에 추가</span><span>›</span></div></div>`,
    `<div class="ig-status"><span>9:41</span><span>●●● ᯤ ▰</span></div><div class="ig-ios-nav"><button>취소</button><b>홈 화면에 추가</b><button class="primary">추가</button></div><div class="ig-add-preview"><span class="ig-app-icon">☕</span><div><b>카페인·수면 기록</b><small>caffeine-sleep-research.vercel.app</small></div></div><div class="ig-ios-toggle"><span><b>웹 앱으로 열기</b><small>앱처럼 전체 화면으로 열립니다.</small></span><i></i></div>`,
    `<div class="ig-status"><span>9:41</span><span>●●● ᯤ ▰</span></div><div class="ig-webpage compact"><b>카페인·수면 기록</b><span>로그인 후 알림 켜기</span></div><div class="ig-ios-alert"><b>“카페인·수면 기록”이<br>알림을 보내고자 합니다</b><p>아침 수면 기록과 저녁 카페인 기록을 알려드려요.</p><div><button>허용 안 함</button><button class="primary">허용</button></div></div>`,
  ],
  'android-chrome': [
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-chrome-top"><span class="ig-home-dot">⌂</span><div><span>🔒</span><b>caffeine-sleep-research.vercel.app</b></div><span>□</span><span class="ig-focus">⋮</span></div><div class="ig-webpage tall"><b>카페인·수면 기록</b><span>오늘의 기록</span></div><div class="ig-callout top">Chrome 메뉴</div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-chrome-top faded"><div><b>caffeine-sleep-research.vercel.app</b></div><span>⋮</span></div><div class="ig-chrome-menu"><div>새 탭</div><div>시크릿 탭</div><div>공유…</div><div class="selected"><span>▣</span><b>앱 설치</b></div><div>데스크톱 사이트</div></div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-dim-page android"></div><div class="ig-android-sheet"><div class="ig-app-line"><span class="ig-app-icon">☕</span><span><b>카페인·수면 기록</b><small>앱을 설치하시겠어요?</small></span></div><p>홈 화면에서 빠르게 열고 알림을 받을 수 있습니다.</p><div class="ig-sheet-actions"><button>취소</button><button class="primary">설치</button></div></div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-webpage compact"><b>카페인·수면 기록</b><span>로그인 후 알림 켜기</span></div><div class="ig-android-dialog"><span class="ig-bell">🔔</span><b>카페인·수면 기록에서<br>알림을 보내도록 허용하시겠어요?</b><div class="ig-dialog-actions"><button class="primary">허용</button><button>허용 안 함</button></div></div>`,
  ],
  samsung: [
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-samsung-url"><span>🔒</span><b>caffeine-sleep-research.vercel.app</b><span>↻</span></div><div class="ig-webpage samsung-page"><b>카페인·수면 기록</b><span>오늘의 기록</span></div><div class="ig-samsung-bar"><span>‹</span><span>›</span><span>⌂</span><span>▢</span><span class="ig-focus">☰<small>메뉴</small></span></div><div class="ig-callout">삼성 인터넷 메뉴</div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-dim-page android"></div><div class="ig-samsung-menu"><div><span>⇩</span><small>다운로드</small></div><div><span>☾</span><small>다크 모드</small></div><div><span>▤</span><small>광고 차단</small></div><div class="selected"><span>＋</span><b>현재 페이지 추가</b></div><div><span>↗</span><small>공유</small></div><div><span>⚙</span><small>설정</small></div></div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-dim-page android"></div><div class="ig-samsung-sheet"><b>현재 페이지 추가</b><div><span>☆</span><span>북마크</span></div><div class="selected"><span>⌂</span><b>홈 화면</b></div><div><span>▦</span><span>빠른 실행</span></div><button>추가</button></div>`,
    `<div class="ig-android-status"><span>9:41</span><span>◉ ᯤ ▰</span></div><div class="ig-webpage compact"><b>카페인·수면 기록</b><span>로그인 후 알림 켜기</span></div><div class="ig-android-dialog samsung-dialog"><span class="ig-bell">🔔</span><b>이 앱의 알림을 허용할까요?</b><p>설정은 나중에 변경할 수 있습니다.</p><div class="ig-dialog-actions"><button class="primary">허용</button><button>허용 안 함</button></div></div>`,
  ],
  naver: [
    `<div class="ig-naver-top"><span>×</span><span>⌄</span><b>caffeine-sleep-research.vercel.app</b><span>●‹</span><span class="ig-focus">⋮</span></div><div class="ig-webpage naver-page"><b>카페인·수면 기록</b><span>네이버 앱 안에서 열린 화면</span></div><div class="ig-callout top">네이버 앱 메뉴</div>`,
    `<div class="ig-naver-top faded"><span>×</span><span>⌄</span><b>caffeine-sleep-research.vercel.app</b><span>●‹</span><span>⋮</span></div><div class="ig-dim-page naver"></div><div class="ig-naver-menu"><div>URL 복사</div><div>공유하기</div><div class="selected"><span>↗</span><b>다른 브라우저로 열기</b></div><div>화면 캡처</div></div>`,
    `<div class="ig-naver-choice"><span class="ig-browser-logo safari">S</span><div><b>iPhone은 Safari</b><p>Safari로 연 뒤 아래쪽 공유 버튼을 눌러 설치하세요.</p></div><span>›</span></div><div class="ig-choice-note">Safari 안내 탭으로 이동해 같은 순서로 따라 하세요.</div>`,
    `<div class="ig-naver-choice"><span class="ig-browser-logo chrome">●</span><div><b>Android는 Chrome</b><p>Chrome 또는 삼성 인터넷으로 연 뒤 설치하세요.</p></div><span>›</span></div><div class="ig-naver-choice secondary"><span class="ig-browser-logo samsung">◉</span><div><b>삼성 인터넷</b><p>아래쪽 메뉴에서 홈 화면에 추가할 수 있어요.</p></div><span>›</span></div>`,
  ],
});

export function buildInstallGuideMarkup(environment, { canPromptInstall = false } = {}) {
  const guide = GUIDES[environment] || GUIDES.unsupported;
  const browserUi = BROWSER_UI[environment];
  const visuals = BROWSER_VISUALS[environment];
  const screens = guide.screens.map(([number, title, body, control], index) => {
    const visual = visuals?.[index] || `<div class="ig-generic-control">${control}</div>`;
    return `<section class="ig-phone ig-phone-${browserUi || 'generic'}"${browserUi ? ` data-browser-ui="${browserUi}"` : ''}><div class="ig-screen"><div class="ig-visual">${visual}</div><div class="ig-step"><span class="ig-num">${number}</span><div><h3>${title}</h3><p>${body}</p></div></div></div></section>`;
  }).join('');
  return `<div class="ig-note"><b>${guide.label}</b><br>${guide.intro}</div>${screens}
    <button type="button" class="ig-action" ${environment === 'android-chrome' && canPromptInstall ? '' : 'hidden'}>지금 앱 설치하기</button>
    <p class="ig-help">휴대폰·브라우저 버전에 따라 메뉴 이름이나 위치가 조금 다를 수 있어요.<br>설치 후 로그인하고 직접 <b>“알림 켜기”</b>를 눌러 허용해 주세요.</p>`;
}

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
      .ig-body{padding:16px 18px 22px;overflow:auto}.ig-switch{display:flex;gap:7px;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 1px 12px;scrollbar-width:none}.ig-switch::-webkit-scrollbar{display:none}.ig-switch button{flex:0 0 auto;scroll-snap-align:start;white-space:nowrap;border:1px solid #dbeafe;background:#fff;color:#475569;border-radius:999px;padding:9px 12px;font-size:12px;font-weight:700}.ig-switch button[aria-pressed=true]{background:#4f46e5;color:#fff;border-color:#4f46e5}
      .ig-note{background:#eef2ff;color:#4338ca;border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.55;margin-bottom:12px}.ig-phone{border-radius:28px;padding:9px;margin:14px auto;max-width:344px;box-shadow:0 12px 30px rgba(15,23,42,.18)}.ig-phone-safari{background:#0f172a}.ig-phone-chrome{background:#202124}.ig-phone-samsung{background:#171a22}.ig-phone-naver{background:#27303d}
      .ig-screen{background:#f8fafc;border-radius:21px;overflow:hidden;padding-bottom:13px}.ig-visual{position:relative;min-height:178px;overflow:hidden;background:#f4f6fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.ig-step{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:start;padding:13px 13px 0}.ig-num{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#4f46e5;color:#fff;font-size:12px;font-weight:800}.ig-step h3{font-size:14px;margin:0 0 4px;font-weight:800}.ig-step p{font-size:12px;line-height:1.55;color:#475569;margin:0}.ig-action{width:100%;border:0;border-radius:14px;padding:13px;background:#4f46e5;color:#fff;font:700 14px inherit;cursor:pointer;margin-top:6px}.ig-action[hidden]{display:none}.ig-help{font-size:11px;color:#64748b;text-align:center;margin-top:12px;line-height:1.6}
      .ig-status,.ig-android-status{height:25px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:9px;font-weight:700;color:#111827;background:#fff}.ig-android-status{height:22px;background:#f8f9fa;color:#303134}.ig-webpage{height:83px;padding:22px 18px;background:linear-gradient(145deg,#eef2ff,#fff);display:flex;flex-direction:column;gap:6px}.ig-webpage b{font-size:15px}.ig-webpage span{font-size:10px;color:#64748b}.ig-webpage.tall{height:111px}.ig-webpage.compact{height:65px}.ig-webpage.samsung-page{height:105px;background:linear-gradient(145deg,#eef6ff,#fff)}.ig-webpage.naver-page{height:134px;background:linear-gradient(145deg,#e8fff2,#fff)}
      .ig-safari-url{height:34px;margin:0 8px 5px;padding:0 10px;border-radius:10px;background:#e9ebf1;display:grid;grid-template-columns:28px 1fr 20px;align-items:center;text-align:center;font-size:9px}.ig-safari-url b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-safari-bar{height:37px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;background:#fff;font-size:24px;color:#1476d4}.ig-safari-bar .ig-focus{position:relative;background:#dbeafe;border-radius:10px;padding:1px 9px}.ig-safari-bar small,.ig-samsung-bar small{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);font-size:8px;white-space:nowrap;color:#4338ca}.ig-callout{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);background:#4f46e5;color:#fff;padding:4px 9px;border-radius:999px;font-size:9px;font-weight:800;white-space:nowrap}.ig-callout.top{top:52px;bottom:auto;left:auto;right:10px;transform:none}.ig-dim-page{height:153px;background:linear-gradient(rgba(15,23,42,.34),rgba(15,23,42,.34)),linear-gradient(145deg,#eef2ff,#fff)}.ig-dim-page.android{height:156px}.ig-dim-page.naver{height:143px}
      .ig-ios-sheet{position:absolute;left:7px;right:7px;bottom:5px;background:#f7f7fb;border-radius:18px 18px 12px 12px;padding:6px 9px 9px;box-shadow:0 -6px 18px rgba(0,0,0,.12)}.ig-grabber{width:34px;height:4px;border-radius:99px;background:#c7c9cf;margin:0 auto 7px}.ig-share-title{display:flex;gap:8px;align-items:center;padding:2px 4px 8px}.ig-share-title span:last-child{display:flex;flex-direction:column;font-size:9px}.ig-share-title small{font-size:7px;color:#6b7280}.ig-app-dot,.ig-app-icon{display:grid!important;place-items:center;width:31px;height:31px;border-radius:8px;background:linear-gradient(145deg,#6366f1,#312e81);color:#fff;font-size:8px;font-weight:800;flex:none}.ig-ios-row{display:grid;grid-template-columns:20px 1fr 12px;gap:5px;align-items:center;background:#fff;border-radius:9px;padding:8px;font-size:9px;margin-top:4px}.ig-ios-row.muted{color:#667085}.ig-ios-nav{height:40px;display:grid;grid-template-columns:54px 1fr 48px;align-items:center;text-align:center;background:#fff;border-bottom:1px solid #e5e7eb;font-size:10px}.ig-ios-nav button{border:0;background:none;color:#1476d4;font-size:9px}.ig-ios-nav .primary{font-weight:800}.ig-add-preview{display:flex;gap:10px;align-items:center;padding:17px;background:#fff}.ig-add-preview div{display:flex;flex-direction:column;font-size:10px}.ig-add-preview small{color:#6b7280;font-size:8px}.ig-ios-toggle{display:flex;justify-content:space-between;align-items:center;margin:0 12px;padding:11px;background:#fff;border-radius:11px;font-size:9px}.ig-ios-toggle span{display:flex;flex-direction:column}.ig-ios-toggle small{color:#6b7280}.ig-ios-toggle i{width:29px;height:17px;border-radius:99px;background:#34c759;position:relative}.ig-ios-toggle i:after{content:"";position:absolute;right:2px;top:2px;width:13px;height:13px;border-radius:50%;background:#fff}.ig-ios-alert{position:absolute;left:22px;right:22px;top:42px;background:rgba(248,248,250,.96);border-radius:13px;text-align:center;box-shadow:0 8px 25px rgba(0,0,0,.22);font-size:10px}.ig-ios-alert>b{display:block;padding:12px 14px 3px}.ig-ios-alert p{font-size:8px;margin:3px 12px 9px;color:#475569}.ig-ios-alert div{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #cbd5e1}.ig-ios-alert button{border:0;background:transparent;padding:9px 3px;color:#1476d4;font-size:9px}.ig-ios-alert button+button{border-left:1px solid #cbd5e1}.ig-ios-alert .primary{font-weight:800}
      .ig-chrome-top{height:43px;display:grid;grid-template-columns:25px 1fr 20px 20px;gap:5px;align-items:center;background:#fff;padding:0 9px;font-size:17px}.ig-chrome-top>div{display:flex;align-items:center;gap:4px;background:#f1f3f4;border-radius:18px;height:29px;padding:0 9px;font-size:8px;overflow:hidden}.ig-chrome-top b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-chrome-top .ig-focus{background:#dbeafe;border-radius:50%;text-align:center}.ig-chrome-top.faded{grid-template-columns:1fr 20px;opacity:.7}.ig-home-dot{font-size:14px}.ig-chrome-menu{position:absolute;right:7px;top:27px;width:155px;background:#fff;border-radius:5px;padding:6px 0;box-shadow:0 7px 20px rgba(0,0,0,.26);font-size:9px}.ig-chrome-menu div{padding:7px 12px}.ig-chrome-menu .selected{display:flex;gap:8px;background:#e8f0fe;color:#174ea6}.ig-android-sheet{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:20px 20px 0 0;padding:14px 16px 12px;box-shadow:0 -5px 20px rgba(0,0,0,.18);font-size:9px}.ig-app-line{display:flex;gap:10px;align-items:center}.ig-app-line>span:last-child{display:flex;flex-direction:column}.ig-app-line small{color:#6b7280}.ig-android-sheet p{font-size:8px;color:#64748b}.ig-sheet-actions{display:flex;justify-content:flex-end;gap:10px}.ig-sheet-actions button,.ig-dialog-actions button{border:0;background:none;color:#275bd7;font-weight:800;font-size:9px;padding:6px 9px}.ig-sheet-actions .primary{background:#275bd7;color:#fff;border-radius:16px}.ig-android-dialog{position:absolute;left:18px;right:18px;top:37px;background:#fff;border-radius:20px;padding:15px;box-shadow:0 8px 25px rgba(0,0,0,.2);font-size:10px}.ig-bell{font-size:20px;display:block;margin-bottom:7px}.ig-android-dialog p{font-size:8px;color:#64748b}.ig-dialog-actions{display:flex;flex-direction:column;margin-top:10px;gap:3px}.ig-dialog-actions .primary{background:#275bd7;color:#fff;border-radius:18px}
      .ig-samsung-url{height:40px;display:grid;grid-template-columns:20px 1fr 20px;align-items:center;gap:5px;background:#fff;padding:0 12px;font-size:8px}.ig-samsung-url b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-samsung-bar{height:41px;padding:0 21px;display:flex;align-items:center;justify-content:space-between;background:#fff;font-size:19px}.ig-samsung-bar .ig-focus{position:relative;background:#dbeafe;border-radius:10px;padding:2px 8px;color:#275bd7}.ig-samsung-menu{position:absolute;left:7px;right:7px;bottom:5px;background:#fff;border-radius:16px;padding:11px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;box-shadow:0 -5px 20px rgba(0,0,0,.2)}.ig-samsung-menu div{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:39px;gap:3px;font-size:8px;text-align:center}.ig-samsung-menu div>span{font-size:17px}.ig-samsung-menu .selected{background:#e8f0ff;color:#1d4ed8;border-radius:10px}.ig-samsung-sheet{position:absolute;left:12px;right:12px;top:31px;background:#fff;border-radius:16px;padding:12px;box-shadow:0 7px 20px rgba(0,0,0,.2);font-size:9px}.ig-samsung-sheet>b{display:block;margin-bottom:8px}.ig-samsung-sheet div{display:flex;gap:10px;padding:7px;border-radius:8px}.ig-samsung-sheet .selected{background:#eaf1ff;color:#1d4ed8}.ig-samsung-sheet button{float:right;border:0;background:#275bd7;color:#fff;border-radius:14px;padding:5px 13px;font-size:8px}.samsung-dialog .primary{background:#4b63d3}
      .ig-naver-top{height:46px;display:grid;grid-template-columns:24px 24px 1fr 25px 22px;align-items:center;gap:4px;background:#fff;padding:0 8px;font-size:20px}.ig-naver-top b{font-size:8px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ig-naver-top .ig-focus{background:#d1fae5;border-radius:50%;text-align:center;color:#03c75a}.ig-naver-top.faded{opacity:.7}.ig-naver-menu{position:absolute;right:7px;top:42px;width:166px;background:#fff;border-radius:10px;padding:6px;box-shadow:0 7px 20px rgba(0,0,0,.25);font-size:9px}.ig-naver-menu div{padding:8px;border-radius:7px}.ig-naver-menu .selected{display:flex;gap:8px;background:#e7f9ef;color:#087d3d}.ig-naver-choice{display:grid;grid-template-columns:36px 1fr 12px;align-items:center;gap:10px;margin:18px 12px 8px;padding:13px;background:#fff;border-radius:14px;box-shadow:0 6px 20px rgba(15,23,42,.12);font-size:10px}.ig-naver-choice p{font-size:8px;color:#64748b;margin:4px 0 0;line-height:1.35}.ig-naver-choice.secondary{margin-top:7px}.ig-browser-logo{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:900;font-size:16px}.ig-browser-logo.safari{background:linear-gradient(145deg,#56b9ff,#1266db)}.ig-browser-logo.chrome{background:conic-gradient(#e53935 0 33%,#fbc02d 0 66%,#43a047 0);border-radius:50%}.ig-browser-logo.samsung{background:#6b5cff}.ig-choice-note{margin:0 15px;color:#087d3d;font-size:8px;text-align:center}.ig-generic-control{margin:40px auto;background:#e0e7ff;color:#4338ca;border-radius:12px;padding:12px;width:max-content;font-size:10px;font-weight:800}
      @media(max-width:380px){#installGuideDialog{width:96vw}.ig-head{padding:16px 15px 12px}.ig-head h2{font-size:18px}.ig-body{padding:13px 12px 18px}.ig-phone{margin:12px auto}.ig-visual{min-height:170px}}
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
  const content = dialog.querySelector('.ig-content');
  content.innerHTML = buildInstallGuideMarkup(environment, { canPromptInstall: Boolean(deferredInstallPrompt) });
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
