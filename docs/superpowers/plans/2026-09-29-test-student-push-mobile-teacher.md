# Test Student Push and Mobile Teacher Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated teacher send sleep or caffeine test notifications only to the unique roster student named exactly `테스트`, and make the existing teacher dashboard usable on phones without changing its desktop URL or features.

**Architecture:** Apps Script resolves the fixed test identity and owns subscription lookup/result persistence; the authenticated Vercel catch-all API validates the request, sends through the existing Web Push sender, and returns aggregate counts only. The teacher client adds a separate test-student control card, while focused CSS and minimal semantic wrappers adapt the existing dashboard at 768px and 480px breakpoints without creating a second page.

**Tech Stack:** Static HTML/CSS/JavaScript, Vercel Node.js Functions, Web Push, Node.js `node:test`, Google Apps Script, Google Sheets

**Spec:** `docs/superpowers/specs/2026-09-29-test-student-push-mobile-teacher-design.md`

## Global Constraints

- Match only the roster name after trimming when it is exactly `테스트`; `테스트1`, `테스트 학생`, zero matches, and duplicate matches must never send.
- The browser must not submit a student ID, subscription ID, endpoint, encryption key, teacher password, spreadsheet ID, Apps Script URL, or shared secret.
- GET exposes only `{ name: '테스트', sleepDevices, caffeineDevices }`; POST exposes only aggregate `{ targeted, sent, expired, failed }` plus safe status fields.
- Only active `student` subscriptions owned by the resolved roster student and enabled for the selected `sleep` or `caffeine` type may receive a test.
- Manual test delivery keys must not collide with scheduled keys; expired subscriptions are deactivated through the existing result policy.
- Manual tests work while the global scheduled reminder switch is off and never enable or alter that setting.
- Preserve all student recording, teacher analysis, badge, journey, inquiry, messaging, and current teacher-browser preview behavior.
- Keep `/api/teacher/reminders/[...path].js` as the single teacher-reminder function and `/teacher` as the single teacher page.
- Preserve desktop layout above 1024px; at 768px and 480px, prevent whole-page horizontal overflow and give primary controls approximately 44px touch targets.
- Do not commit or print real credentials, VAPID private material, subscription secrets, spreadsheet identifiers, or health records.
- Each implementation task follows TDD, runs its focused regression suite, and ends with a focused commit.

## Review Focus

- A crafted POST containing `studentId`, `subscriptionId`, `subscription`, `endpoint`, or an extra notification type must receive 400 before any Apps Script or push call; Task 2 pins this with API rejection tests.
- A roster with no exact `테스트`, multiple exact `테스트` rows, or only lookalike names must return a safe unavailable state and send nothing; Task 1 pins every case in Apps Script tests.
- A student with several active/inactive devices and different type preferences must target only the active, type-enabled devices and record/deactivate every result correctly; Tasks 1 and 2 pin selection and lifecycle tests.
- Slow repeated taps or a status refresh during a send must not issue duplicate client POSTs, expose identifiers, or leave controls stuck; Task 3 pins request-lock and sanitized-state tests.
- Long Korean labels, wide tables/charts, small viewport browser chrome, and the logout control must not clip or create page-level overflow at 390, 412, 480, 768, and 1440 widths; Tasks 4 and 6 pin structural assertions and live viewport checks.

---

### Task 1: Apps Script Exact Test-Student Resolution and Result Storage

**Files:**
- Modify: `apps-script/Reminders.gs`
- Modify: `apps-script/Api.gs`
- Modify: `apps-script/tests/reminders.test.js`
- Modify: `apps-script/tests/security.test.js`
- Modify: `apps-script/tests/ownership.test.js`
- Regenerate: `apps-script/dist/Code.gs`

**Interfaces:**
- Produce `getTestStudentReminderStatus_(): { name: '테스트', sleepDevices: number, caffeineDevices: number }`.
- Produce `getTestStudentReminderTargets_(type): { name: '테스트', subscriptions: TestSubscription[] }`, where `type` is only `sleep|caffeine` and each private `TestSubscription` is `{ studentId, subscriptionId, endpoint, keys }`.
- Produce `recordTestStudentReminderResults_(type, referenceDate, results): { recorded: number }`; each result is `{ deliveryKey, studentId, subscriptionId, status, errorCode }`.
- Add teacher actions `getTestStudentReminderStatus`, `getTestStudentReminderTargets`, and `recordTestStudentReminderResults` to both the Apps Script teacher allowlist and `invokeAction_` only.
- Manual log keys use `manual-test:<requestId>:<type>:<subscriptionId>` and therefore never equal scheduled `<date>:<type>:<subscriptionId>` keys.

- [ ] **Step 1: Write failing exact-identity tests**

Add tests proving one trimmed exact `테스트` row resolves, while zero matches, two exact matches, `테스트1`, and `테스트 학생` fail closed without returning student IDs.

- [ ] **Step 2: Run identity tests and verify RED**

Run: `npm run test:apps-script -- --test apps-script/tests/reminders.test.js`

Expected: FAIL because the test-student functions do not exist.

- [ ] **Step 3: Implement roster resolution and safe status**

Read the current `students` sheet through named header lookup. Trim the name only for equality, require exactly one match, derive its student ID internally, and count active type-enabled `student` rows without returning private subscription fields from the status function.

- [ ] **Step 4: Write failing target and result-lifecycle tests**

Cover active/inactive rows, `teacher-test` exclusion, mismatched student IDs, independent sleep/caffeine preferences, multiple eligible devices, invalid type rejection, success logging, expired-device deactivation, and manual-key separation from scheduled delivery keys.

- [ ] **Step 5: Implement private target lookup and result recording**

Return endpoint/key material only from the private target action. Validate all result fields, require the `manual-test:` key shape, append the existing `알림발송로그` columns, update last success/error fields, and deactivate only expired matching subscriptions under the existing script lock.

- [ ] **Step 6: Add and test teacher-only Apps Script dispatch**

Assert student, scheduler, public, and unknown roles cannot invoke any of the three actions; assert the teacher role can invoke only the declared signatures.

- [ ] **Step 7: Run Apps Script verification and build**

Run: `npm run test:apps-script && npm run build:apps-script`

Expected: all Apps Script tests PASS and the generated distribution contains each new function/action once.

- [ ] **Step 8: Commit Task 1**

Run: `git add apps-script/Reminders.gs apps-script/Api.gs apps-script/tests apps-script/dist/Code.gs && git commit -m "feat: resolve test student reminder targets"`

### Task 2: Authenticated Aggregate Test-Student Push API

**Files:**
- Create: `api/_lib/teacher/reminders/test-student.js`
- Modify: `api/teacher/reminders/[...path].js`
- Modify: `api/_lib/teacher-policy.js`
- Modify: `test/teacher-reminder-api.test.js`
- Modify: `test/reminder-route-consolidation.test.js`

**Interfaces:**
- Produce `createTestStudentHandler({ callGas, createSender, now, randomId }): (req, res) => Promise<void>`.
- `GET /api/teacher/reminders/test-student` returns `{ success: true, name: '테스트', sleepDevices, caffeineDevices }` after teacher-session validation.
- `POST /api/teacher/reminders/test-student` accepts exactly `{ type: 'sleep'|'caffeine' }` and returns `{ success: true, type, targeted, sent, expired, failed }`.
- Add the same three Apps Script action names to `TEACHER_ACTIONS`; no client identity fields are accepted.

- [ ] **Step 1: Write failing authentication and input tests**

Cover GET/POST without a teacher session, unsupported methods, invalid JSON, unknown type, extra keys, and explicit injection of `studentId`, `subscriptionId`, `subscription`, `endpoint`, or keys. Assert no gateway or sender call occurs for rejected input.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test -- test/teacher-reminder-api.test.js test/reminder-route-consolidation.test.js`

Expected: FAIL because the handler and route are absent.

- [ ] **Step 3: Implement safe GET status flow**

Normalize the Apps Script response to bounded nonnegative device counts and the fixed public name. Map missing/duplicate-target gateway errors to a safe unavailable response without leaking Apps Script messages or identifiers.

- [ ] **Step 4: Write failing delivery aggregation tests**

Cover zero targets, one and multiple sends, exact approved sleep/caffeine payloads, KST reference dates, sender throws, `success|expired|failed` mapping, result persistence after partial failure, and aggregate-only response secrecy.

- [ ] **Step 5: Implement POST sending and persistence**

Generate one opaque `requestId` server-side, request type-filtered targets from Apps Script, normalize each subscription, send with the existing `buildNotificationPayload`, and persist one result per target with `manual-test:<requestId>:<type>:<subscriptionId>`. Never log or return targets.

- [ ] **Step 6: Route `test-student` through the existing catch-all**

Add the handler to `createTeacherReminderRouter` and update consolidation tests to assert `config`, `test-subscribe`, `test-send`, and `test-student` paths without adding another Vercel function.

- [ ] **Step 7: Run Task 2 tests**

Run: `npm test -- test/teacher-reminder-api.test.js test/reminder-route-consolidation.test.js`

Expected: PASS with no endpoint, key, student ID, or provider detail in responses.

- [ ] **Step 8: Commit Task 2**

Run: `git add api/_lib/teacher/reminders/test-student.js api/teacher/reminders/[...path].js api/_lib/teacher-policy.js test/teacher-reminder-api.test.js test/reminder-route-consolidation.test.js && git commit -m "feat: add test student push endpoint"`

### Task 3: Teacher Test-Student Notification Controls

**Files:**
- Modify: `public/js/teacher-reminders.js`
- Modify: `teacher/index.html`
- Modify: `test/teacher-reminders-client.test.js`
- Modify: `test/public-pages.test.js`

**Interfaces:**
- Extend `createTeacherReminders` with `refreshTestStudent()` and `sendTestStudent(type)`.
- Extend state with `testStudent: { status, name, sleepDevices, caffeineDevices, sendingType, result, error }` containing no student/device identifier.
- Add browser API methods `getTestStudent()` and `sendTestStudent(type)` for the same-origin `test-student` route.
- Expose `window.teacherReminders.refreshTestStudent()` and `.sendTestStudent(type)`.

- [ ] **Step 1: Write failing client state tests**

Cover initial safe state, refresh success/unavailable/error, separate type counts, zero-count button disablement, sending-state disablement, sanitized aggregate result, and no identifiers in emitted state.

- [ ] **Step 2: Run client tests and verify RED**

Run: `npm test -- test/teacher-reminders-client.test.js`

Expected: FAIL because the controller methods and state do not exist.

- [ ] **Step 3: Implement controller and duplicate-click lock**

Permit only `sleep|caffeine`, return the same in-flight promise for repeated same-type calls, reject a second type while sending, refresh status after completion, and always clear `sendingType` in `finally`.

- [ ] **Step 4: Add the separate `테스트 학생 알림 확인` card**

Place it after the existing current-teacher-browser preview. Include status refresh, `테스트 · 수면 가능 기기 N대 · 카페인 가능 기기 N대`, two send buttons, zero-device guidance, and `대상 N · 성공 N · 만료 N · 실패 N`; use `textContent` for server values and `aria-live` for result/error text.

- [ ] **Step 5: Update public-page assertions**

Replace the obsolete assertion forbidding every student-test UI with assertions that the fixed `테스트` control exists, no selector exists, and no `studentId`, subscription field, or secret configuration is embedded in the page.

- [ ] **Step 6: Run Task 3 tests**

Run: `npm test -- test/teacher-reminders-client.test.js test/public-pages.test.js`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run: `git add public/js/teacher-reminders.js teacher/index.html test/teacher-reminders-client.test.js test/public-pages.test.js && git commit -m "feat: add test student notification controls"`

### Task 4: Teacher Dashboard Mobile Layout

**Files:**
- Modify: `teacher/index.html`
- Create: `test/teacher-responsive.test.js`
- Modify: `test/public-pages.test.js`

**Interfaces:**
- Preserve the existing DOM IDs and inline event entry points used by dashboard JavaScript.
- Add reusable layout classes for header actions, toolbar rows, scroll regions, responsive tables, chart viewports, settings actions, and card-form rows.
- At `max-width: 768px`, hide `.zoom-box`, force the app visual scale to 100%, stack header tools, horizontally scroll `.tab-nav`, move logout into the header action flow, and use one-column content grids.
- At `max-width: 480px`, collapse small metrics/forms as needed and keep inputs/buttons at full available width with primary controls at least 44px high.

- [ ] **Step 1: Write failing responsive-structure tests**

Assert viewport metadata, 768/480 breakpoints, hidden mobile zoom control, nonshrinking horizontally scrollable tabs, in-flow logout, `min-width:0` grid children, bounded table/chart overflow containers, full-width mobile form controls, and 44px primary touch targets.

- [ ] **Step 2: Run layout tests and verify RED**

Run: `npm test -- test/teacher-responsive.test.js test/public-pages.test.js`

Expected: FAIL on the missing semantic wrappers/rules.

- [ ] **Step 3: Refactor header and toolbar wrappers without changing behavior**

Keep title/subtitle/update text, automatic refresh, interval selection, refresh action, and logout. Remove fixed-position logout behavior, place logout in `.header-actions`, and suppress the desktop scale control only at mobile widths.

- [ ] **Step 4: Implement mobile tabs, filters, cards, and settings**

Add scoped rules for scroll-snap tabs, one-column dashboards/student cards/settings, wrapping filter/period controls, full-width number/date/select fields, stacked sleep/badge/reminder rows, and mobile-friendly save buttons. Preserve all labels and values.

- [ ] **Step 5: Contain tables and charts**

Give wide analysis tables and chart canvases their own overflow viewport, convert class/reminder schedule rows to card-like rows where labels remain unambiguous, and ensure no child forces `body` wider than the viewport.

- [ ] **Step 6: Run Task 4 tests**

Run: `npm test -- test/teacher-responsive.test.js test/public-pages.test.js`

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run: `git add teacher/index.html test/teacher-responsive.test.js test/public-pages.test.js && git commit -m "feat: optimize teacher dashboard for mobile"`

### Task 5: Full Security and Regression Verification

**Files:**
- Modify only if a failing assertion reveals an implementation defect.

**Interfaces:**
- No new production interface; this task proves the combined change does not weaken the existing system.

- [ ] **Step 1: Run focused push and responsive suites**

Run: `npm test -- test/teacher-reminder-api.test.js test/teacher-reminders-client.test.js test/reminder-route-consolidation.test.js test/teacher-responsive.test.js test/public-pages.test.js`

Expected: PASS.

- [ ] **Step 2: Run complete repository verification**

Run: `npm run verify`

Expected: all Node tests, Apps Script tests, public-bundle security checks, and Apps Script build PASS.

- [ ] **Step 3: Inspect generated artifacts and diffs**

Run: `git diff --check && git status --short`

Expected: no whitespace errors, no unplanned files, and no real endpoint/key/password/spreadsheet/health-data value in source or generated files.

- [ ] **Step 4: Review responsive and security boundaries**

Inspect the final diff against the spec: exact-name fail-closed behavior, teacher-session enforcement, aggregate-only browser state, existing teacher preview preservation, and scoped 768/480 rules with desktop defaults unchanged.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required changes, commit only those fixes with `git commit -m "fix: harden test push and mobile layout"`; otherwise leave the task without an empty commit.

### Task 6: Apps Script, Vercel, and Controlled Device Verification

**Files:**
- Verify: `apps-script/dist/Code.gs`
- Verify: `docs/reminder-deployment-checklist.md`
- No repository file may contain secret values or student health records.

**Interfaces:**
- Production student URL remains `https://caffeine-sleep-research.vercel.app/`.
- Production teacher URL remains `https://caffeine-sleep-research.vercel.app/teacher`.
- Scheduled reminders remain disabled unless the teacher separately chooses to enable them.

- [ ] **Step 1: Deploy a new Apps Script version**

Copy the verified `apps-script/dist/Code.gs` into the current Apps Script project, preserve the current Script Properties and sheet binding, create a new web-app version, and stop only if Google requires the user to approve account/deployment access.

- [ ] **Step 2: Deploy the matching Vercel build**

Push the reviewed commits to the configured repository and deploy/promote production without exposing environment values. Confirm health, teacher session, config, and `test-student` status routes.

- [ ] **Step 3: Perform unauthenticated and injection smoke checks**

Verify the route returns 401 without a teacher session and 400 for a crafted body with an identity/subscription field; confirm the Apps Script call and push sender do not run for rejected input.

- [ ] **Step 4: Perform mobile viewport visual QA**

Check the teacher dashboard at 390×844, 412×915, 480px, 768px, and 1440px. Visit dashboard, caffeine, sleep, students, badges, reminders, and settings; confirm full tab labels, no page-level horizontal scroll, no logout overlap, readable student cards, bounded tables/charts, and usable badge/sleep/reminder forms.

- [ ] **Step 5: Confirm the `테스트` student subscription state**

Use the teacher card to refresh counts. If either count is zero, ask the user at that point to open the logged-in `테스트` student device, install/open the home-screen app, tap `알림 켜기`, and approve the browser notification prompt. Do not request or repeat any password.

- [ ] **Step 6: Send the controlled real notifications**

With the user's device ready, send one sleep and one caffeine test only when each type reports at least one eligible device. Confirm the exact approved copy, operating-system notification display, vibration/sound according to device settings, and the correct record screen after tapping.

- [ ] **Step 7: Verify isolation and persistence**

Confirm aggregate result counts, a manual-test log entry, expired-device deactivation if applicable, global scheduled reminders still disabled, and no notification delivered to another student. Do not expose the log's student/subscription fields in chat.

- [ ] **Step 8: Final verification and handoff**

Run: `npm run verify && git status --short`

Expected: PASS and clean working tree. Report the two production URLs, deployment status, mobile viewports checked, aggregate test-send results, and any device-side limitation without reporting secrets or health data.
