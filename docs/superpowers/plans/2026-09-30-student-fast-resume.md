# Student Fast Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the student login flash, accelerate initial data loading, and keep the research-period student session active without weakening push or identity security.

**Architecture:** Gate first paint behind a small boot state, renew valid student sessions at the session endpoint, and add one allowlisted Apps Script bootstrap action that returns the existing student datasets in one request. Keep the existing individual loaders as a failure fallback and preserve camera-analysis deferral only when analysis is actually active.

**Tech Stack:** Static HTML/JavaScript, Vercel Node functions, Google Apps Script, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-30-student-fast-resume-design.md`

## Global Constraints

- Do not store new student health data in browser storage.
- Keep student identity sourced from the signed HttpOnly session.
- Keep explicit logout unsubscribing only the current device.
- Preserve the current camera-analysis return path.
- All existing security and push tests must remain green.

## Review Focus

- Expired or malformed sessions must show login without exposing stale student UI.
- Session renewal must not change role or identity and must remain bounded to 90 days.
- A failed bootstrap request must fall back once without duplicate long-running requests.
- Camera analysis must not compete with bootstrap sheet reads.
- Explicit logout must still deactivate the current device subscription after moving the control.

---

### Task 1: Rolling student session and bootstrap gateway

**Files:**
- Modify: `api/student/session.js`
- Modify: `api/_lib/actions.js`
- Modify: `api/_lib/student-policy.js`
- Modify: `apps-script/Api.gs`
- Modify: `apps-script/Code.gs`
- Test: `test/student-api.test.js`
- Test: `test/student-policy.test.js`
- Test: `apps-script/tests/security.test.js`

**Interfaces:**
- Produces: `getStudentBootstrap(studentId)` returning `{ weight, stats, caffeineLogs, sleepLogs, sleepSettings }`.
- Produces: successful `GET /api/student/session` refreshes the same signed student session for 90 days.

- [ ] Write failing tests for session renewal, bootstrap allowlisting, trusted identity replacement, and Apps Script bootstrap aggregation.
- [ ] Run the focused tests and confirm failures are caused by the missing behavior.
- [ ] Implement the smallest server and Apps Script changes.
- [ ] Run focused tests and the Apps Script suite until green.
- [ ] Commit the task.

### Task 2: Flash-free student boot and faster loading

**Files:**
- Modify: `index.html`
- Test: `test/public-pages.test.js`

**Interfaces:**
- Consumes: `getStudentBootstrap` from Task 1.
- Produces: boot screen state and `loadStudentBootstrap()` with legacy loader fallback.

- [ ] Write failing page behavior tests covering hidden login at first paint, direct authenticated entry, immediate bootstrap, fallback, and camera-only deferral.
- [ ] Run the focused test and confirm the expected failures.
- [ ] Implement boot state, immediate bootstrap application, and deferred noncritical loads.
- [ ] Run focused and full web tests until green.
- [ ] Commit the task.

### Task 3: Research-safe logout placement

**Files:**
- Modify: `index.html`
- Test: `test/public-pages.test.js`

**Interfaces:**
- Consumes: existing `executeLogout()` current-device unsubscribe behavior.
- Produces: settings-only `학생 변경·로그아웃` with an alert-specific two-step confirmation.

- [ ] Write a failing UI behavior test that rejects a header logout and requires the settings warning flow.
- [ ] Run the focused test and confirm the expected failure.
- [ ] Move the control and update the confirmation copy without changing logout mechanics.
- [ ] Run focused and full verification including public-bundle security checks.
- [ ] Commit the task.
