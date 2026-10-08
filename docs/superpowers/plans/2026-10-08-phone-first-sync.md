# 휴대폰 우선 저장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 현재 대화에서 직접 구현하며 사용자 요청 없이 하위 에이전트를 만들지 않는다.

**Goal:** 카페인·수면·체중·목표를 휴대폰에 안전하게 기록한 직후 시트로 자동 전송하고, 실패 시 보관·재전송하며 건강 안내를 즉시 표시한다.

**Architecture:** IndexedDB 원본/대기열, 서버의 학생별 mutationId 중복 방지, 기존 학생 API 브리지와 화면의 저장 상태 연동. 서버의 확인 영수증을 받은 뒤에만 시트 반영 완료로 표시한다.

**Tech Stack:** 기존 JavaScript, IndexedDB, Node API, Google Apps Script와 Sheets batchUpdate. 새 제품 의존성은 추가하지 않는다.

**Spec:** ../specs/2026-10-08-phone-first-sync-design.md

## Global Constraints

- 정상 연결: 기기 저장 완료 직후 첫 전송을 시작한다.
- 오프라인/서버 오류: 자동 재전송하며 학생 입력을 버리지 않는다.
- 알림: 앱 내 과다 카페인·수면 부족 안내는 서버 응답을 기다리지 않는다.
- 대상: saveCaffeineData, saveSleepData, saveInitialSetup. 기존 서버 기록의 수정·삭제는 온라인 전용이다.
- 학생 소유자는 서버 세션에서 확정한다. 계정 전환 시 다른 학생 자료를 표시·전송하지 않는다.
- 운영 native table append의 sheetId 수정을 보존한다.
- 새 테스트는 실제 학생의 건강 기록을 생성하지 않는다.
- 최신 운영 저장소 복사본에서 작업하고 다른 로컬 수정은 함께 배포하지 않는다.

## Review Focus

- 서버가 쓴 뒤 응답이 유실돼도 재시도로 중복 행을 만들지 않는다.
- 저장소 오류 시 성공 메시지를 표시하지 않고 입력을 남긴다.
- 다른 계정으로 전환된 뒤 이전 계정의 대기열을 전송하지 않는다.
- 오프라인 입력을 새로고침 후에도 표시하며 연결 복구 후 자동 전송한다.
- 다른 기기에서 최신 목표를 저장한 경우 오래된 대기 목표가 덮어쓰지 않는다.

### Task 1: 서버에서 재전송을 한 번만 적용

**Files:** api/student/action.js, api/_lib/student-policy.js, apps-script/Api.gs, apps-script/Code.gs, test/student-api.test.js, test/apps-script-ownership.test.js 또는 현재 해당 테스트 파일.

**Interfaces:** 기존 action 요청에 선택적 mutationId(UUID)를 추가한다. 이전 클라이언트는 계속 동작한다. 성공한 동기화 요청은 { success:true, mutationId, recordId, committedAt, version? } 확인 영수증을 반환한다. 같은 mutationId와 다른 payload는 거부한다.

- [ ] 기존 운영 게이트웨이의 최신 원본과 append 도우미를 확인해 보존한다.
- [ ] 같은 소유자·action·mutationId 재전송, 쓰기 후 응답 유실, 다른 학생/다른 payload 재사용, 기존 클라이언트 호환 회귀 테스트를 작성하고 실패를 확인한다.
- [ ] 서버 세션 소유자와 action을 고정하고 UUID 형식을 검증한다.
- [ ] 기존 script lock 안에서 확인 영수증과 행 ID를 조회한다. caffeine/sleep은 안정적인 서버 ID로 저장 후 이력 영수증을 남긴다.
- [ ] info 설정에 기준 버전과 적용 mutationId를 저장한다. Sheets batchUpdate로 설정·버전을 함께 갱신하고 충돌을 명시한다.
- [ ] 테스트를 통과시키고 비밀·개인 자료 없이 변경을 검토한다.
- [ ] 서버만 먼저 배포하고 합성 테스트로 영수증·중복 방지 및 이전 클라이언트 호환성을 확인한다.

### Task 2: 기기 원본 저장 및 전송 대기열

**Files:** Create public/js/student-sync.js; Create test/student-sync.test.js. IndexedDB 테스트용 메모리 저장소 어댑터는 제품 코드와 분리한다.

**Interfaces:** StudentSync.create({store, send, getSubject, onChange}); enqueue(action,payload); flush(); list(); setSubject(subject|null). 저장소 어댑터는 원자적인 put/list/update 및 탭 임대 획득/해제를 제공한다. 실제 제품 저장소는 IndexedDB다.

- [ ] 저장 후 재시작, 502, 응답 유실, 저장소 실패, 여러 탭의 재시도, 계정 변경 테스트를 작성하고 실패를 확인한다.
- [ ] 학생별 IndexedDB 원본과 mutationId 대기열을 구현한다. 트랜잭션 완료 뒤에만 기기 저장 성공을 반환한다.
- [ ] confirmed 원본을 유지하고 pending/needsAttention/synced 상태 및 서버 영수증을 기록한다.
- [ ] 한 학생의 작업을 순서대로 보내며 정상 연결 시 즉시 flush한다. 네트워크 오류는 backoff, 인증 오류는 재로그인, 유효성·충돌 오류는 확인 필요로 남긴다.
- [ ] online/visibilitychange/pageshow 및 전경 타이머에서 재전송하고, 세션 변경 시 즉시 중단한다.
- [ ] 테스트 통과와 제품 저장소 오류 처리·다중 탭 임대를 검토한다.

### Task 3: 기존 저장 흐름과 상태 표시 연결

**Files:** public/js/api-bridge.js, index.html, test/api-bridge.test.js, test/student-ui.test.js.

**Interfaces:** 학생 쓰기 action만 StudentSync.enqueue를 거친다. 영수증 원시 요청은 대기열로 재귀 진입하지 않도록 분리한다. callback 결과에 localSaved/queued/confirmed와 mutationId를 명시한다.

- [ ] 새 초기 설정·목표 저장에서 서버 실패를 성공으로 오인하는 분기 회귀 테스트를 작성한다.
- [ ] 정상 입력을 기기에 저장하고 화면에 즉시 반영한 뒤 전송을 시작한다. 기기 실패는 입력을 유지한다.
- [ ] 기존 성공 모달을 ‘휴대폰 저장 완료 · 전송 대기’와 ‘구글시트 반영 완료’로 구분한다.
- [ ] 대기 건수·마지막 확인 시각·‘지금 전송’ UI를 연결한다. 반복 클릭해도 동일 대기열만 전송한다.
- [ ] bootstrap 및 카페인/수면 화면에 로컬 pending 데이터를 병합하고 서버의 recordId로 중복 표시를 제거한다.
- [ ] 같은 학생의 재로그인 때 복구한다. 다른 학생·로그아웃에서는 대기 자료를 화면에 노출하지 않는다.
- [ ] 미전송 신규 기록의 수정과 기존 서버 기록의 온라인 전용 수정·삭제를 명확히 구분한다.
- [ ] 관련 UI와 bridge 회귀 테스트 및 제품 문구를 검토한다.

### Task 4: 입력 직후 카페인·수면 안내

**Files:** public/js/student-sync.js 또는 별도 public/js/student-feedback.js, index.html, test/student-feedback.test.js.

**Interfaces:** evaluateLocalFeedback({records, profile, sleepSettings})는 현재 앱 기준을 사용해 저장 완료 직후의 안내를 반환한다. 네트워크 요청을 하지 않는다.

- [ ] 오프라인 카페인 누계, 0mg, pending과 confirmed 중복, 목표 미설정, 취침/기상 날짜 경계, 수면 부족 및 정상 기록 테스트를 작성한다.
- [ ] 개인 목표가 있으면 그 목표를 기준으로 카페인 누계를 평가한다. 없으면 개인 목표를 임의 생성하지 않는다.
- [ ] 마지막 수신한 수면 기준과 입력 시간을 사용해 수면 부족 여부를 계산한다.
- [ ] IndexedDB 저장 성공 직후 안내를 표시하고 서버 응답 지연과 무관한지 검증한다.
- [ ] 기존 푸시·알림 설정을 보존하고 OS 알림 허가를 추가 요청하지 않는다.

### Task 5: 통합 검증과 운영 배포

**Files:** 위 변경 파일, 운영 검증 문서와 합성 테스트.

- [ ] 운영 최신 저장소의 의존성을 준비하고 전체 테스트 및 public bundle 검사·스크립트 문법 검사를 실행한다.
- [ ] 합성 계정/데이터로 온라인 즉시 전송, 실제 오프라인, 새로고침, 복귀, 502, 응답 유실, 인증 만료와 계정 전환을 확인한다.
- [ ] 시트에서 동일 mutationId의 단일 반영과 info 버전 충돌 보호를 대조한다.
- [ ] 서버 호환 검증 후 클라이언트를 배포한다. 기존 사용자에게 새 버전 로딩 후 동작하는지 확인한다.
- [ ] 운영 화면의 저장 상태·대기 건수·즉시 안내와 시트 반영을 확인하고 결과 스크린샷을 저장한다.
- [ ] 사용자가 앱을 닫은 동안의 자동 전송 제한과 이전에 누락된 기록의 복구 범위를 짧게 보고한다.
