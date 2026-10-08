# Student Record Push Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in iPhone/Android PWA push reminders that notify only students missing the relevant sleep or caffeine record, with teacher-controlled dates/times and private storage in the current Google Sheet.

**Architecture:** The public Vercel site becomes an installable PWA and registers standard Web Push subscriptions only after an authenticated student or teacher explicitly opts in. Vercel Node functions keep VAPID and Cron secrets server-side, call the existing signed Apps Script gateway for configuration and private Google Sheet storage, and send notifications from daily per-hour Cron slots. Apps Script gains a narrowly allowlisted `scheduler` role and three private operational sheets without changing existing research-data sheets.

**Tech Stack:** Static HTML/CSS/JavaScript, Service Worker and Web Push APIs, Vercel Node.js Functions and Cron, `web-push`, Node.js `node:test`, Google Apps Script, Google Sheets

**Spec:** `docs/superpowers/specs/2026-09-29-student-record-reminders-design.md`

## Global Constraints

- Preserve existing student, teacher, five-week journey, badge, caffeine, sleep, inquiry, and messaging behavior.
- Students and teachers must continue to use the Vercel URLs without a school Google login.
- Use only the spreadsheet configured by the current Apps Script `SPREADSHEET_ID` Script Property; never introduce the former `caffeine-sleep-diary` sheet ID.
- Never commit, log, return, or place in browser code the teacher password, spreadsheet ID, Apps Script URL/shared secret, session secret, VAPID private key, Cron secret, push endpoint/auth key, or student health data.
- The VAPID public key may be returned to authenticated browsers; the private key and `CRON_SECRET` remain Vercel-only.
- Notification permission is requested only after a user gesture on `알림 켜기`; a denial is not followed by repeated automatic prompts.
- Student identity always comes from the signed `HttpOnly` session. Browser-provided student identity is ignored.
- An explicit student logout deactivates that device's subscription before clearing the session; cookie clearing still occurs if the gateway call fails.
- Morning eligibility checks the previous Korean-calendar-day sleep record. Evening eligibility checks the current Korean-calendar-day caffeine record, and `섭취 안 함` counts as complete.
- Date/time, weekday, operation-period, and next-run calculations use `Asia/Seoul`. Teacher-selected times are whole hours only.
- Delivery is idempotent per `{referenceDate, type, subscriptionId}`. A successful prior delivery prevents another send.
- Push copy never includes student identifiers, health values, or missing-record counts.
- Apps Script remains a storage/query gateway. It must not install Apps Script time triggers or send push messages.
- Production student reminders default to disabled and remain disabled through deployment and verification until the teacher explicitly enables them.
- Each task follows TDD, keeps focused tests green, and ends with a focused commit.

## Review Focus

- Verify role boundaries at both Vercel and Apps Script: students can mutate only their subscriptions, teachers only administrator settings/test devices, and `scheduler` only dispatch snapshot/result actions.
- Verify the subscription endpoint, `p256dh`, and `auth` values never enter client-visible error text, delivery logs, repository fixtures, or console output.
- Verify overlapping Cron calls cannot produce duplicate notifications and an Apps Script/configuration failure sends nothing.
- Verify logout, 404/410 push responses, permission revocation, and browser-data deletion deactivate only the affected device subscription.
- Verify iOS standalone detection, Android install prompt behavior, Samsung Internet fallback, and Naver in-app-browser guidance do not block ordinary browser use.
- Verify deep links survive login restoration and open the correct sleep/caffeine entry view only after authentication.
- Verify all new controls render student-controlled text with safe DOM APIs and do not weaken existing CSP/security headers.

---

### Task 1: Reminder Time and Eligibility Domain

**Files:**
- Create: `api/_lib/reminder-policy.js`
- Create: `test/reminder-policy.test.js`

**Interfaces:**
- Produce `getKstClock(nowMs): { date: string, hour: number, weekday: number }`.
- Produce `previousKstDate(date): string`.
- Produce `normalizeReminderConfig(value): ReminderConfig`, where whole-hour strings are normalized to `HH:00` and each class period is `{ classId, startDate, endDate }`.
- Produce `selectReminderCandidates({ type, nowMs, config, students, completedStudentIds, subscriptions, successfulDeliveryKeys }): Candidate[]`.
- Produce `deliveryKey({ referenceDate, type, subscriptionId }): string`.
- `Candidate` contains only `{ studentId, subscriptionId, endpoint, keys, referenceDate, type }`; it contains no name or health values.

- [ ] **Step 1: Write failing timezone and date tests**

Cover UTC-to-KST day rollover, previous-day calculation across month/year boundaries, whole-hour normalization, invalid time rejection, and Saturday/Sunday detection.

- [ ] **Step 2: Run timezone tests and verify RED**

Run: `npm test -- --test-name-pattern="KST|previous day|whole-hour"`  
Expected: FAIL because `api/_lib/reminder-policy.js` does not exist.

- [ ] **Step 3: Implement the time/config functions**

Use `Intl.DateTimeFormat` with `timeZone: 'Asia/Seoul'`; do not derive Korean dates by mutating the server's local timezone. Reject missing class dates, reversed ranges, and non-hour times.

- [ ] **Step 4: Write failing eligibility tests**

Cover global/type disabled states, wrong hour, class boundary dates, weekend include/exclude, inactive subscription, per-device morning/evening preference, previous-day sleep completion, current-day caffeine completion including `섭취 안 함`, multiple devices, and existing delivery keys.

- [ ] **Step 5: Run eligibility tests and verify RED**

Run: `npm test -- --test-name-pattern="reminder candidate|sleep reminder|caffeine reminder|delivery key"`  
Expected: FAIL because candidate selection is not implemented.

- [ ] **Step 6: Implement candidate selection**

Return an empty list for disabled/out-of-slot/out-of-period runs. Deduplicate input subscriptions by subscription ID and use the type-specific reference date when forming delivery keys.

- [ ] **Step 7: Run Task 1 tests**

Run: `npm test -- test/reminder-policy.test.js`  
Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run: `git add api/_lib/reminder-policy.js test/reminder-policy.test.js && git commit -m "feat: add reminder eligibility policy"`

### Task 2: Web Push Sender and Server-Only Configuration

**Files:**
- Modify: `package.json`
- Create or Modify: `package-lock.json`
- Modify: `api/_lib/env.js`
- Create: `api/_lib/web-push.js`
- Create: `test/web-push.test.js`

**Interfaces:**
- Add server-only variables `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, and `CRON_SECRET`.
- Produce `getPushRuntimeConfig(): { publicKey, privateKey, subject, cronSecret }`.
- Produce `buildNotificationPayload({ type, referenceDate }): string` with the exact approved Korean title/body and `/\?open=<type>&date=<date>` URL.
- Produce `createPushSender({ sendNotification, setVapidDetails }): { send(subscription, payload): Promise<PushResult> }`.
- `PushResult` is `{ status: 'success'|'expired'|'failed', errorCode: string|null }`; raw provider errors and subscription secrets are never returned.

- [ ] **Step 1: Write failing notification-copy and sender tests**

Assert the exact approved morning/evening copy, deep links, VAPID setup, success mapping, 404/410 to `expired`, 429/5xx to bounded retry/failure, and sanitization of thrown provider errors.

- [ ] **Step 2: Run sender tests and verify RED**

Run: `npm test -- test/web-push.test.js`  
Expected: FAIL because the sender and push environment interface do not exist.

- [ ] **Step 3: Add `web-push` and implement the sender**

Install a pinned `web-push` dependency with npm so `package-lock.json` is generated. Keep retry count and delay injectable in tests; never log the subscription object.

- [ ] **Step 4: Run Task 2 tests**

Run: `npm test -- test/web-push.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run: `git add package.json package-lock.json api/_lib/env.js api/_lib/web-push.js test/web-push.test.js && git commit -m "feat: add private web push sender"`

### Task 3: Apps Script Reminder Sheets and Storage Functions

**Files:**
- Create: `apps-script/Reminders.gs`
- Modify: `scripts/build-apps-script.mjs`
- Modify: `apps-script/tests/harness.js`
- Create: `apps-script/tests/reminders.test.js`
- Modify: `apps-script/tests/static.test.js`

**Interfaces:**
- Produce `ensureReminderSheets_()` that creates only missing `알림설정`, `푸시구독`, and `알림발송로그` tabs and exact headers from the approved spec.
- Produce `getReminderConfig_()`, `saveReminderConfig_(config, actor)`, `upsertPushSubscription_(record)`, `getPushPreferences_(subscriptionId, subject)`, `setPushPreferences_(subscriptionId, subject, preferences)`, and `deactivatePushSubscription_(subscriptionId, subject)`.
- Produce `getReminderDispatchSnapshot_(type, nowIso)` returning config, roster/class membership, completion IDs, active subscription data, and successful delivery keys only.
- Produce `claimReminderDeliveries_(deliveryKeys, executionId, nowIso)` that atomically returns only keys not already successful or held by a live short lease; store leases in Script Properties, not in the delivery log.
- Produce `recordReminderDeliveryResults_(results)` with allowed result values `success`, `expired`, `failed`, `skipped`; expired subscriptions are deactivated in the same locked mutation.
- Hash endpoint values with SHA-256 for `subscriptionId`; never store student names in `푸시구독`.

- [ ] **Step 1: Extend the Apps Script harness and write failing schema tests**

Add a minimal in-memory spreadsheet/sheet/range double that supports header creation and row reads/writes. Test idempotent sheet creation, exact headers, no modification to pre-existing research tabs, and current-spreadsheet-only access.

- [ ] **Step 2: Run schema tests and verify RED**

Run: `npm run test:apps-script -- --test apps-script/tests/reminders.test.js`  
Expected: FAIL because `Reminders.gs` does not exist.

- [ ] **Step 3: Implement schema/config persistence**

Store one versioned config row, normalize booleans/dates/times, stamp update time/actor, and wrap writes with the existing script lock helper.

- [ ] **Step 4: Write failing subscription and dispatch-snapshot tests**

Cover create/update without duplicates, ownership rejection, multi-device subscriptions, preference updates, logout deactivation, active-only reads, completion detection for sleep/current caffeine/`섭취 안 함`, atomic live-lease claims, expired-lease recovery, and omission of names/health values from candidates/log rows.

- [ ] **Step 5: Run storage tests and verify RED**

Run: `npm run test:apps-script -- --test apps-script/tests/reminders.test.js`  
Expected: FAIL on unimplemented storage/query behavior.

- [ ] **Step 6: Implement subscription/snapshot/result functions**

Read the existing roster, caffeine, and sleep sheet layouts through named header lookup rather than new hard-coded column indexes. Fail closed when required headers or configuration are unavailable.

- [ ] **Step 7: Include the new source in the build**

Insert `apps-script/Reminders.gs` before `apps-script/Api.gs` in `scripts/build-apps-script.mjs`; extend static tests so every source required by the distribution is asserted.

- [ ] **Step 8: Run Task 3 tests and build**

Run: `npm run test:apps-script && npm run build:apps-script`  
Expected: PASS and `apps-script/dist/Code.gs` contains the reminder functions once.

- [ ] **Step 9: Commit Task 3**

Run: `git add apps-script/Reminders.gs apps-script/tests scripts/build-apps-script.mjs apps-script/dist/Code.gs && git commit -m "feat: store reminder settings and subscriptions"`

### Task 4: Apps Script Role Allowlists and Vercel Action Policies

**Files:**
- Modify: `apps-script/Api.gs`
- Modify: `apps-script/tests/security.test.js`
- Modify: `apps-script/tests/ownership.test.js`
- Modify: `api/_lib/actions.js`
- Modify: `api/_lib/student-policy.js`
- Modify: `api/_lib/teacher-policy.js`
- Create: `api/_lib/scheduler-policy.js`
- Modify: `test/student-policy.test.js`
- Modify: `test/teacher-api.test.js`
- Create: `test/scheduler-policy.test.js`

**Interfaces:**
- Add student actions `savePushSubscription`, `getPushPreferences`, `savePushPreferences`, and `deactivatePushSubscription`, all subject-bound.
- Add teacher actions `getReminderAdminConfig`, `saveReminderAdminConfig`, `saveTeacherTestSubscription`, and `deactivateTeacherTestSubscription`.
- Add scheduler actions `getReminderDispatchSnapshot`, `claimReminderDeliveries`, and `recordReminderDeliveryResults` only.
- Produce `normalizeSchedulerRequest(action, params)` with an immutable scheduler allowlist.

- [ ] **Step 1: Write failing cross-role allowlist tests**

Assert every new action succeeds only for its intended role; public/health/other roles and arbitrary function names are rejected. Assert a student cannot change another student's subscription even when posting another student ID.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `npm test -- --test-name-pattern="push action|reminder action|scheduler role" && npm run test:apps-script -- --test apps-script/tests/security.test.js apps-script/tests/ownership.test.js`  
Expected: FAIL because the new actions/role are absent.

- [ ] **Step 3: Implement all three Vercel policies and Apps Script dispatch**

Bind student actions to `request.subject`, invoke the Task 3 functions from `invokeAction_`, and use the existing lock for every reminder mutation. Do not let scheduler dispatch arbitrary teacher actions.

- [ ] **Step 4: Run Task 4 tests**

Run: `npm test -- --test-name-pattern="policy|scheduler|reminder action" && npm run test:apps-script`  
Expected: PASS.

- [ ] **Step 5: Rebuild and commit Task 4**

Run: `npm run build:apps-script && git add api/_lib apps-script/Api.gs apps-script/tests apps-script/dist/Code.gs test && git commit -m "feat: enforce reminder role boundaries"`

### Task 5: Authenticated Student Push APIs and Safe Logout

**Files:**
- Create: `api/student/push/config.js`
- Create: `api/student/push/subscribe.js`
- Create: `api/student/push/preferences.js`
- Create: `api/student/push/unsubscribe.js`
- Modify: `api/student/logout.js`
- Create: `api/_lib/push-subscription.js`
- Create: `test/student-push-api.test.js`
- Modify: `test/student-api.test.js`

**Interfaces:**
- `GET /api/student/push/config` returns `{ publicKey, sleepTime, caffeineTime, globallyEnabled }` after student-session validation.
- `POST /api/student/push/subscribe` accepts only a valid PushSubscription JSON object plus `{ sleepEnabled, caffeineEnabled }`; the server adds session identity.
- `GET|POST /api/student/push/preferences` reads/updates the current device identified by its endpoint-derived subscription ID.
- `POST /api/student/push/unsubscribe` deactivates the current device.
- `POST /api/student/logout` accepts optional `{ endpoint }`, attempts subject-bound deactivation, and always clears the cookie.
- Produce `normalizePushSubscription(value)` and `subscriptionIdForEndpoint(endpoint)` with strict URL/key/size validation.

- [ ] **Step 1: Write failing validation and authentication tests**

Cover wrong methods, missing/tampered/expired session, malformed/oversized subscription, non-HTTPS endpoint, missing keys, cross-student identity injection, and safe generic errors.

- [ ] **Step 2: Run student push tests and verify RED**

Run: `npm test -- test/student-push-api.test.js test/student-api.test.js`  
Expected: FAIL because the endpoints and validator do not exist.

- [ ] **Step 3: Implement student push endpoints**

Use the existing session and Apps Script gateway helpers. Return only the public key, times, booleans, and subscription ID; never echo endpoint keys.

- [ ] **Step 4: Implement and test logout deactivation**

Inject `callGas` into `createLogoutHandler`. Tests must prove deactivation uses session identity, cookie clearing occurs on success and gateway failure, and an unauthenticated logout clears the cookie without calling Apps Script.

- [ ] **Step 5: Run Task 5 tests**

Run: `npm test -- --test-name-pattern="student push|student API logout"`  
Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run: `git add api/student api/_lib/push-subscription.js test/student-push-api.test.js test/student-api.test.js && git commit -m "feat: add student push subscription APIs"`

### Task 6: Teacher Reminder Configuration and Test-Push APIs

**Files:**
- Create: `api/teacher/reminders/config.js`
- Create: `api/teacher/reminders/test-subscribe.js`
- Create: `api/teacher/reminders/test-send.js`
- Create: `test/teacher-reminder-api.test.js`

**Interfaces:**
- `GET /api/teacher/reminders/config` returns the VAPID public key, normalized settings, aggregate subscriber counts, latest run summary, and next KST times without returning student IDs or subscription secrets.
- `POST /api/teacher/reminders/config` accepts global/type toggles, whole-hour times, weekend toggle, and four class date ranges.
- `POST /api/teacher/reminders/test-subscribe` registers the authenticated teacher's current browser with role `teacher-test`.
- `POST /api/teacher/reminders/test-send` sends one selected preview type to the current teacher-test device only.

- [ ] **Step 1: Write failing teacher reminder API tests**

Cover authentication, invalid dates/times, reversed ranges, safe aggregate output, absence of student/device secrets, teacher-test-only recipient enforcement, exact approved copy, and provider failure mapping.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- test/teacher-reminder-api.test.js`  
Expected: FAIL because the teacher reminder endpoints do not exist.

- [ ] **Step 3: Implement configuration and test-device endpoints**

Reuse Task 1 normalization, Task 2 sender, and the Apps Script teacher allowlist. Never accept a student subscription ID in `test-send`.

- [ ] **Step 4: Run Task 6 tests**

Run: `npm test -- test/teacher-reminder-api.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run: `git add api/teacher/reminders test/teacher-reminder-api.test.js && git commit -m "feat: add teacher reminder administration APIs"`

### Task 7: Idempotent Vercel Cron Dispatch

**Files:**
- Create: `api/reminders/run.js`
- Modify: `vercel.json`
- Create: `test/reminder-run.test.js`
- Modify: `test/integration.test.js`

**Interfaces:**
- `GET /api/reminders/run` accepts only `Authorization: Bearer <CRON_SECRET>`.
- The handler gets a scheduler snapshot, applies `selectReminderCandidates`, atomically claims the resulting delivery keys through Apps Script, sends only claimed candidates with limited concurrency, and persists a result for every claimed candidate.
- It returns aggregate counts only: `{ success, type, targeted, sent, expired, failed, skipped }`.
- Configure 24 distinct once-daily UTC Cron paths (`/api/reminders/run?slot=00` through `slot=23`); the handler uses actual KST server time, not the query value, for eligibility.

- [ ] **Step 1: Write failing Cron authentication and fail-closed tests**

Cover missing/wrong/duplicate authorization, wrong method, Apps Script failure, invalid snapshot, disabled/out-of-hour run, and response/body secrecy.

- [ ] **Step 2: Run Cron tests and verify RED**

Run: `npm test -- test/reminder-run.test.js`  
Expected: FAIL because the Cron handler does not exist.

- [ ] **Step 3: Write failing delivery lifecycle tests**

Cover successful result persistence, duplicate successful delivery skip, concurrent duplicate snapshots, multi-device sends, 404/410 deactivation, transient failure logging, limited concurrency, and partial-batch failure.

- [ ] **Step 4: Implement the Cron handler**

Use an execution key/Apps Script lock reservation before send so overlapping Cron requests cannot both claim the same delivery key. Persist only non-sensitive error codes and aggregate response counts.

- [ ] **Step 5: Add and validate Hobby-compatible Cron slots**

Add 24 once-daily schedules to `vercel.json`. Integration tests must assert 24 unique `slot` paths, one UTC hour per entry, no more-frequent-than-daily schedule per entry, and unchanged student/teacher rewrites.

- [ ] **Step 6: Run Task 7 tests**

Run: `npm test -- test/reminder-run.test.js test/integration.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit Task 7**

Run: `git add api/reminders/run.js vercel.json test/reminder-run.test.js test/integration.test.js && git commit -m "feat: dispatch idempotent reminder cron jobs"`

### Task 8: PWA Manifest, Service Worker, and Install Guide

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/icons/icon.svg`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Create: `public/js/install-guide.js`
- Modify: `index.html`
- Create: `test/pwa-install.test.js`
- Modify: `test/public-pages.test.js`

**Interfaces:**
- Manifest uses `id: '/'`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`, Korean app name `카페인·수면 기록`, 192/512 px PNG icons, and a maskable-capable same-origin icon. The page links `apple-touch-icon.png` for iOS.
- Service worker handles `push` and `notificationclick`; it focuses an existing same-origin window or opens the payload URL.
- Produce `detectInstallEnvironment({ userAgent, standalone, displayMode }): 'ios-safari'|'android-chrome'|'samsung'|'naver'|'installed'|'unsupported'`.
- Produce `window.installGuide.open()` and retain a captured `beforeinstallprompt` event for the Android `지금 앱 설치하기` action.

- [ ] **Step 1: Write failing PWA asset and browser-detection tests**

Assert manifest fields/icons, service worker same-origin URL validation, exact deep-link focus/open behavior, iPhone Safari, Android Chrome, Samsung Internet, Naver in-app-browser, and standalone detection.

- [ ] **Step 2: Run PWA tests and verify RED**

Run: `npm test -- test/pwa-install.test.js test/public-pages.test.js`  
Expected: FAIL because PWA assets and the guide are absent.

- [ ] **Step 3: Implement manifest, icon, and service worker**

Create one repository-native SVG source matching the existing caffeine/sleep visual identity and rasterize it to the declared PNG sizes. Do not cache authenticated API responses or student record pages; the worker's initial scope is push reception and notification click handling only.

- [ ] **Step 4: Implement the actual-screen-style guide**

Add `📲 앱 설치·알림 설정 방법` below the student login controls. Build accessible dialog panels showing representative browser toolbar/menu/home-screen/permission screens for the detected route, with a manual platform switch and keyboard-close behavior.

- [ ] **Step 5: Add registration and progressive fallback**

Register `/public/sw.js` only on secure contexts; an unsupported browser still allows normal login and recording, while Naver directs the student to Safari/Chrome.

- [ ] **Step 6: Run Task 8 tests**

Run: `npm test -- test/pwa-install.test.js test/public-pages.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit Task 8**

Run: `git add public/manifest.webmanifest public/sw.js public/icons public/js/install-guide.js index.html test/pwa-install.test.js test/public-pages.test.js && git commit -m "feat: add installable student PWA guide"`

### Task 9: Student Opt-In, Preferences, Deep Links, and Logout UI

**Files:**
- Create: `public/js/push-reminders.js`
- Modify: `public/js/api-bridge.js`
- Modify: `index.html`
- Create: `test/push-reminders-client.test.js`
- Modify: `test/api-bridge.test.js`
- Modify: `test/public-pages.test.js`

**Interfaces:**
- Produce `window.pushReminders.initialize(session)`, `.enable()`, `.loadPreferences()`, `.savePreferences(value)`, `.unsubscribeCurrentDevice()`, and `.permissionState()`.
- `enable()` registers the worker, requests permission only inside the click flow, subscribes with the VAPID public key, and posts the subscription to Task 5.
- `window.appAuth.logout(endpoint?)` sends the current endpoint to the safe logout endpoint.
- Login/deep-link startup stores `open=sleep|caffeine` and `date` until session restoration succeeds, then opens the corresponding existing record UI.

- [ ] **Step 1: Write failing client state-machine tests**

Cover unsupported browser, not-installed iOS guidance, default prompt, granted/denied/default permission, successful subscription, endpoint-free UI state, independent morning/evening preferences, and no automatic repeat prompt after denial.

- [ ] **Step 2: Run client tests and verify RED**

Run: `npm test -- test/push-reminders-client.test.js test/api-bridge.test.js`  
Expected: FAIL because the client module/API helpers do not exist.

- [ ] **Step 3: Implement the student opt-in and settings UI**

Use the approved strings exactly: `카페인·수면 기록 알림 받기`, the approved explanatory copy, `알림 켜기`, and `알림은 언제든 설정에서 끌 수 있어요.` Add independent sleep/caffeine toggles, permission status, configured times, and a link back to the install guide.

- [ ] **Step 4: Implement deep-link restoration**

Validate query values, retain them through an unauthenticated login screen, then call the existing sleep/caffeine navigation functions after student-session restoration. Ignore unknown routes and malformed dates.

- [ ] **Step 5: Implement logout cleanup**

Read the current PushSubscription endpoint, call unsubscribe/deactivate before clearing local UI state, and allow logout to finish even if the device has no subscription or the gateway is unavailable.

- [ ] **Step 6: Run Task 9 tests**

Run: `npm test -- test/push-reminders-client.test.js test/api-bridge.test.js test/public-pages.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit Task 9**

Run: `git add public/js/push-reminders.js public/js/api-bridge.js index.html test && git commit -m "feat: add student reminder opt-in and settings"`

### Task 10: Teacher Reminder Administration UI

**Files:**
- Create: `public/js/teacher-reminders.js`
- Modify: `teacher/index.html`
- Create: `test/teacher-reminders-client.test.js`
- Modify: `test/public-pages.test.js`

**Interfaces:**
- Produce `window.teacherReminders.initialize()`, `.saveConfig()`, `.registerTestDevice()`, and `.sendTest(type)`.
- Render global/type toggles, four class date ranges, whole-hour sleep/caffeine selects (default 08:00/20:00), weekend toggle, approved copy previews, subscriber aggregates, last-run metrics, and next-run times.
- Test send targets only the current teacher browser and exposes `sleep`/`caffeine` preview choices.

- [ ] **Step 1: Write failing rendering and validation tests**

Cover initial load, 24 whole-hour options, four class rows, reversed/missing date blocking, disabled-by-default state, exact copy preview, aggregate status, no student identifiers, and teacher test-subscribe/send flows.

- [ ] **Step 2: Run teacher UI tests and verify RED**

Run: `npm test -- test/teacher-reminders-client.test.js test/public-pages.test.js`  
Expected: FAIL because the teacher module/panel do not exist.

- [ ] **Step 3: Implement the administrator panel**

Match the current teacher dashboard's component styles. Display `선택한 시간대 안에서 발송될 수 있습니다` near time controls. Use safe DOM text assignment for all returned fields and require an explicit save before settings change.

- [ ] **Step 4: Implement teacher-device test notifications**

Reuse the same service worker and browser permission rules. Never offer a student selector or bulk test-send button.

- [ ] **Step 5: Run Task 10 tests**

Run: `npm test -- test/teacher-reminders-client.test.js test/public-pages.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit Task 10**

Run: `git add public/js/teacher-reminders.js teacher/index.html test/teacher-reminders-client.test.js test/public-pages.test.js && git commit -m "feat: add teacher reminder controls"`

### Task 11: Secret Scanning, Documentation, and Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `scripts/check-public-bundle.mjs`
- Modify: `scripts/verify.mjs`
- Modify: `README.md`
- Create: `docs/reminder-deployment-checklist.md`
- Modify: `test/integration.test.js`

**Interfaces:**
- `.env.example` documents names only for the four push/Cron variables.
- Public bundle scanning rejects `WEB_PUSH_VAPID_PRIVATE_KEY`, `CRON_SECRET`, known private-key prefixes, Apps Script URLs, and the existing secret names while allowing `WEB_PUSH_VAPID_PUBLIC_KEY` only in server responses.
- Deployment checklist contains Apps Script build/deploy, Vercel environment setup, preview smoke test, production deploy, and iPhone/Android pilot steps without any secret values.

- [ ] **Step 1: Write failing security/integration assertions**

Add a fixture-based test proving private VAPID/Cron names or values in public files fail the scanner. Assert all API endpoints are same-origin and the reminder system remains disabled in default/empty configuration.

- [ ] **Step 2: Run security tests and verify RED**

Run: `npm run security:public && npm test -- test/integration.test.js`  
Expected: FAIL until the scanner/config/docs are updated.

- [ ] **Step 3: Update the scanner, environment template, verifier, and runbook**

Document generation of VAPID keys and `CRON_SECRET` without printing or committing real values. Add focused reminder tests to `scripts/verify.mjs` only if they are not already discovered by `node --test`.

- [ ] **Step 4: Run full verification**

Run: `npm run verify`  
Expected: all Node tests, Apps Script tests, public security scan, and Apps Script build PASS.

- [ ] **Step 5: Inspect generated artifacts and working tree**

Run: `git diff --check && git status --short`  
Expected: no whitespace errors, no `.env*` secrets, no endpoint/auth fixtures, and only intended files.

- [ ] **Step 6: Commit Task 11**

Run: `git add .env.example scripts README.md docs/reminder-deployment-checklist.md test/integration.test.js && git commit -m "docs: add secure reminder deployment checks"`

### Task 12: Apps Script and Vercel Deployment, Then Device Pilot

**Files:**
- Verify: `apps-script/dist/Code.gs`
- Verify: `docs/reminder-deployment-checklist.md`
- No repository file may contain deployment secret values.

- [ ] **Step 1: Run pre-deployment verification from a clean commit**

Run: `npm run verify && git status --short`  
Expected: verification PASS and a clean working tree.

- [ ] **Step 2: Deploy Apps Script as a new version**

Copy the generated `apps-script/dist/Code.gs` into the current Apps Script project, preserve the current spreadsheet Script Property, add no old sheet ID, create a new web-app version, and retain anonymous Vercel gateway access protected by `GAS_SHARED_SECRET`. If Google requires account confirmation, stop only at that confirmation screen and ask the user to complete it.

- [ ] **Step 3: Verify private sheet initialization**

Call only the authenticated teacher configuration read once. Confirm `알림설정`, `푸시구독`, and `알림발송로그` exist with exact headers, existing research sheets/rows are unchanged, and global reminders remain off.

- [ ] **Step 4: Configure Vercel secrets and deploy preview**

Generate VAPID keys and a Cron secret directly into Vercel's protected environment settings without copying values into chat, source, terminal logs, or docs. Update `GAS_API_URL` only if the Apps Script deployment URL changed. Deploy a preview and run health/session/config smoke checks.

- [ ] **Step 5: Run automated browser smoke tests on preview**

Verify student login, existing record read/write, teacher login/dashboard, install-guide routes, service worker registration, opt-in UI, teacher configuration save/read, test-device registration, and no console/network secret leakage. Delete any synthetic health record created solely for smoke testing unless the user has asked to retain it.

- [ ] **Step 6: Deploy production with reminders still disabled**

Promote the verified build, confirm the public student and teacher URLs, inspect Cron registration, and verify an authorized manual Cron invocation returns zero targets while global reminders are off.

- [ ] **Step 7: Perform teacher-device test pushes**

Register only the teacher's current device and send one sleep and one caffeine test. Confirm exact copy, icon, click destination, and that no student subscription or health data is involved.

- [ ] **Step 8: Perform controlled iPhone and Android pilot**

On one consenting test account/device per platform, follow the visible install guide, enable notifications, verify missing-record delivery, verify completed-record suppression (including `섭취 안 함`), verify deep links, and verify logout deactivation. Also check Samsung Internet capability/fallback and Naver external-browser guidance.

- [ ] **Step 9: Final production verification and handoff**

Run: `npm run verify`  
Expected: PASS. Report student URL, teacher URL, Apps Script version, exact tests performed/results, Cron registration state, and that student reminders are still disabled pending the teacher's explicit activation. Do not report any secret value, sheet ID, subscription identifier, or student health row.

- [ ] **Step 10: Commit any verification-only documentation updates**

If the checklist gained non-sensitive results, run: `git add docs/reminder-deployment-checklist.md && git commit -m "docs: record reminder deployment verification"`. Otherwise leave the repository unchanged.
