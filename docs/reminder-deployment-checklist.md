# 카페인·수면 기록 알림 배포 체크리스트

실제 값, 시트 ID, 학생 식별정보, 푸시 구독 endpoint는 이 문서나 Git·채팅에 기록하지 않는다. 배포가 끝날 때까지 교사 화면의 `전체 학생 알림`은 꺼진 상태로 둔다.

## 1. 배포 전 검증

- 배포 대상 커밋에서 `npm run verify`를 실행한다.
- `git status --short`가 비어 있고 `npm run security:public`이 통과하는지 확인한다.
- `apps-script/dist/Code.gs`가 최신 소스 6개를 한 번씩 포함하는지 확인한다.
- 기존 연구 시트와 챌린지·뱃지 기능을 수정하는 미승인 변경이 없는지 확인한다.

## 2. Apps Script 새 버전

- 현재 연구용 Apps Script 프로젝트를 열고 기존 원본 및 현재 스프레드시트 구조를 다시 확인한다.
- 현재 프로젝트의 `SPREADSHEET_ID` Script Property를 그대로 유지한다. 이전 프로젝트의 시트 ID를 복사하지 않는다.
- 생성된 `apps-script/dist/Code.gs`로 편집기 코드를 교체하고 저장한다.
- 웹 앱을 새 버전으로 배포한다. 실행 사용자는 소유자, 접근은 Vercel 게이트웨이가 호출할 수 있는 범위로 두되 모든 데이터 작업은 `GAS_SHARED_SECRET`과 역할별 허용 목록으로 보호한다.
- 새 배포 주소가 생긴 경우에만 Vercel의 `GAS_API_URL`을 갱신한다. 주소를 공개 파일에 적지 않는다.
- 인증된 교사 설정 조회를 한 번 실행해 `알림설정`, `푸시구독`, `알림발송로그` 시트와 정확한 헤더가 생성되었는지 확인한다.
- 기존 연구 시트의 탭 수·헤더·기존 행을 배포 전과 비교하고, `알림설정`의 전체 활성화 값이 꺼짐인지 확인한다.

## 3. Vercel 보호 환경 변수

Vercel의 암호화된 프로젝트 환경 설정에만 다음 이름을 추가한다. 실제 값은 화면 밖 문서, 소스, 명령 기록, 채팅에 복사하지 않는다.

- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `CRON_SECRET`

VAPID 키 쌍은 신뢰할 수 있는 로컬 환경의 `web-push` 생성기로 새로 만들고, 생성 직후 공개키와 개인키를 각각 Vercel 보호 입력란에 직접 저장한다. `WEB_PUSH_SUBJECT`에는 관리 가능한 연락 주소를 사용한다. `CRON_SECRET`은 암호학적으로 안전한 난수 생성기로 충분히 긴 새 값을 만들고 Vercel 보호 입력란에 직접 저장한다. 화면 공유, 셸 기록, 문서, Git에 실제 값을 남기지 않는다.

Preview에 먼저 네 값과 기존 서버 전용 환경 변수를 설정한다. 검증된 동일 값을 Production에 별도로 설정하고, 브라우저에 전달되는 것은 인증 후 필요한 VAPID 공개키뿐인지 확인한다.

## 4. Preview 확인

- Preview를 배포하고 `/api/health`가 데이터 없이 정상 상태만 반환하는지 확인한다.
- 학생 로그인, 기존 기록 조회, 카페인·수면 기록 저장을 지정 테스트 계정으로 확인한다.
- 학생 로그인 화면에서 설치 안내의 iPhone Safari, Android Chrome, Samsung Internet, Naver 외부 브라우저 안내를 확인한다.
- 학생 설정에서 동의 전 권한 팝업이 자동으로 뜨지 않고, `알림 켜기`를 누른 경우에만 권한을 요청하는지 확인한다.
- 교사 로그인 후 대시보드와 `알림 설정`을 연다. 1~4반 기간, 08:00/20:00 기본 시간, 주말 설정, 구독 집계, 최근/다음 실행이 표시되는지 확인한다.
- 전체 학생 알림을 끈 상태로 설정 저장/재조회가 일치하는지 확인한다.
- 개발자 도구의 문서·스크립트·응답·콘솔에 개인키, Cron 비밀값, Apps Script 주소, 시트 ID, 학생 건강 데이터가 불필요하게 노출되지 않는지 확인한다.

## 5. Production과 Cron

- 검증된 커밋을 Production에 배포하고 학생 루트 URL과 `/teacher` URL을 확인한다.
- Vercel에 하루 한 번 실행되는 UTC 기준 Cron 24개가 등록되어 매 KST 정시를 포괄하는지 확인한다.
- 전체 학생 알림을 끈 상태에서 인증된 Cron을 한 번 호출해 대상 0명인지 확인한다.
- 기존 학생 기록 제출과 교사 조회를 다시 확인한다. 검증 전용 기록은 사용자가 보존을 요청하지 않은 경우 승인된 절차로만 삭제한다.

## 6. 교사 기기 미리보기

- 교사 화면에서 현재 브라우저만 시험 기기로 등록한다.
- 수면 알림과 카페인 알림을 각각 한 번 보내 제목·본문·아이콘을 확인한다.
- 알림을 눌렀을 때 동일 출처의 올바른 기록 화면으로 이동하는지 확인한다.
- 이 과정에 학생 선택, 학생 구독, 학생 건강 데이터가 사용되지 않았는지 확인한다.

## 7. 통제된 휴대폰 파일럿

- 동의한 테스트 계정과 기기 각 1대로 iPhone Safari와 Android Chrome을 확인한다.
- 홈 화면 설치, 로그인 유지, 알림 동의, 수면/카페인 개별 선택, 딥링크를 확인한다.
- 미기록일에는 알림이 오고, 수면 기록 또는 카페인 기록을 완료한 날에는 해당 알림이 억제되는지 확인한다. 카페인은 `섭취 안 함`도 완료로 처리되는지 확인한다.
- 로그아웃 뒤 해당 기기 구독이 비활성화되는지 확인한다.
- Samsung Internet의 지원 여부와 안내를 확인하고, Naver 인앱 브라우저에서는 Safari/Chrome으로 여는 안내가 표시되는지 확인한다.

## 8. 활성화와 롤백

- 파일럿 결과와 반별 운영 기간을 교사가 확인한 뒤에만 `전체 학생 알림`을 명시적으로 켠다.
- 문제가 생기면 먼저 전체 학생 알림을 끈다. 필요하면 직전 Vercel 배포를 승격하고 Apps Script 웹 앱을 직전 버전으로 되돌린 뒤 대응하는 `GAS_API_URL`을 복원한다.
- 최종 인계에는 학생·교사 URL, Apps Script 버전, 수행한 시험 결과, Cron 등록 상태, 전체 학생 알림 활성화 여부만 기록한다. 비밀값·시트 ID·구독 식별자·학생 건강 행은 기록하지 않는다.
# Temporary scheduled device check (2026-10-10)

- Approved recipient: student ID `0`, exact name `테스트`, active sleep subscriptions only.
- Extra Cron: `/api/reminders/run?scheduledTest=20261010-sleep-03`, `0 18 * * *` UTC.
- Eligible window: 2026-10-10 03:00–03:59 KST. Other dates/hours return zero without gateway calls.
- Existing 24 Cron jobs and teacher settings remain unchanged. This pilot bypasses class periods and completed-record suppression only for the approved test account.
- Requests require the existing Cron secret; there is no browser-accessible scheduling control or new credential.
- Existing delivery claims prevent overlapping sends for five minutes; successful persisted results deduplicate repeated invocation. There is no durable exactly-once guarantee after logging fails or a send fails. Do not manually rerun the pilot after an uncertain provider/logging outcome; this is a single automatic Cron invocation.
- Logs include only aggregate `scheduled_test_reminder_result` counts. A provider acceptance does not establish actual phone receipt: obtain user confirmation separately.
- After the test, remove the extra Cron and pilot code/tests in a follow-up change. The exact-date guard makes it inert even before cleanup.
