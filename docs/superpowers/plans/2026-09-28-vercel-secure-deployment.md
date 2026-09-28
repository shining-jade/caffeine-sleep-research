# Vercel Secure Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing student and teacher experiences from Vercel while keeping all secrets and student health data behind authenticated Vercel APIs and a secret-protected Apps Script data service connected to the current research spreadsheet.

**Architecture:** Static student and teacher pages retain the existing UI and call same-origin Vercel serverless functions through a `google.script.run` compatibility bridge. Vercel issues signed `HttpOnly` role sessions, enforces student/teacher action allowlists, and calls Apps Script with a server-only shared secret; Apps Script independently validates the secret, role, current spreadsheet property, and student record ownership.

**Tech Stack:** Static HTML/CSS/JavaScript, Vercel Node.js Functions, Node.js built-in `crypto` and `node:test`, Google Apps Script, Google Sheets, GitHub/Vercel Git integration

**Spec:** `docs/superpowers/specs/2026-09-28-vercel-secure-deployment-design.md`

## Global Constraints

- Public routes are `/` for students and `/teacher` for teachers.
- No Google account is required for either role.
- Never commit or print the teacher password, spreadsheet ID, shared backend secret, session signing key, Gemini key, or student health data.
- Browser JavaScript must not contain the Apps Script URL, spreadsheet ID, teacher password, backend secret, or session signing key.
- Apps Script must open only the current research spreadsheet through a private Script Property; do not reuse an ID from `caffeine-sleep-diary`.
- Student identity comes from the signed server session, not from browser-supplied `studentId` or `name` fields.
- Teacher data actions require a valid teacher session.
- Existing student, teacher, challenge, and badge behavior is preserved during this deployment phase; challenge rule changes are out of scope.
- Data operations use POST JSON bodies; credentials and health data never appear in query strings.
- All code changes follow TDD and each task ends with a focused commit.

## Review Focus

- Malformed or oversized JSON bodies return a safe `400/413` response without echoing the request or secrets; Task 2 and Task 3 tests pin this behavior.
- A valid student cookie combined with another student's ID, record ID, message row, inquiry row, or badge acknowledgement is rejected; Task 3 and Task 4 tests pin ownership enforcement.
- Missing, duplicate, malformed, expired, or tampered session cookies fail closed and clear sensitive UI state; Task 1 and Task 6 tests pin this behavior.
- Apps Script redirects, non-JSON HTML error pages, timeouts, and `success:false` responses become stable gateway errors without leaking upstream content; Task 2 tests pin this behavior.
- Existing HTML may issue concurrent `google.script.run` chains and handler-less calls; Task 5 tests pin per-call handler isolation and compatible chaining.

---

### Task 1: Vercel Project Foundation and Signed Sessions

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `api/_lib/http.js`
- Create: `api/_lib/env.js`
- Create: `api/_lib/session.js`
- Create: `test/http.test.js`
- Create: `test/session.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `readJson(req, { maxBytes }): Promise<object>` and `sendJson(res, status, body): void` from `api/_lib/http.js`.
- Produces: `requireEnv(name): string` and `getRuntimeConfig(): RuntimeConfig` from `api/_lib/env.js`.
- Produces: `createSession(payload, now?): string`, `verifySession(token, expectedRole, now?): SessionPayload`, `readSessionCookie(req): string | null`, `setSessionCookie(res, token, maxAge): void`, and `clearSessionCookie(res): void` from `api/_lib/session.js`.
- `SessionPayload` is `{ role: 'student', studentId: string, name: string, exp: number } | { role: 'teacher', exp: number }`.

- [ ] **Step 1: Write failing HTTP helper tests**

Add tests named `readJson rejects malformed JSON`, `readJson rejects bodies above 256 KiB`, and `sendJson sets no-store JSON headers`. Assert status metadata without including the submitted body in errors.

- [ ] **Step 2: Run HTTP tests and verify RED**

Run: `npm test -- --test-name-pattern="readJson|sendJson"`  
Expected: FAIL because `api/_lib/http.js` does not exist.

- [ ] **Step 3: Implement HTTP helpers**

Implement the exact Task 1 interfaces in `api/_lib/http.js`; use a 256 KiB default body limit and error objects with stable codes `INVALID_JSON` and `PAYLOAD_TOO_LARGE`.

- [ ] **Step 4: Run HTTP tests and verify GREEN**

Run: `npm test -- --test-name-pattern="readJson|sendJson"`  
Expected: PASS.

- [ ] **Step 5: Write failing session tests**

Add tests named `student session round trips`, `teacher session round trips`, `tampered session is rejected`, `expired session is rejected`, `wrong role is rejected`, and `duplicate or malformed cookie is rejected`. Assert `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and bounded `Max-Age` attributes.

- [ ] **Step 6: Run session tests and verify RED**

Run: `npm test -- --test-name-pattern="session|cookie|role"`  
Expected: FAIL because session functions are undefined.

- [ ] **Step 7: Implement environment and session modules**

Use Node `crypto.createHmac('sha256', SESSION_SECRET)` for compact signed tokens and `crypto.timingSafeEqual` for signature comparison. Validate payload shape and integer expiry before returning it. `getRuntimeConfig()` reads `GAS_API_URL`, `GAS_SHARED_SECRET`, `SESSION_SECRET`, `TEACHER_PASSWORD_SALT`, and `TEACHER_PASSWORD_HASH` only on the server.

- [ ] **Step 8: Run Task 1 tests**

Run: `npm test`  
Expected: all Task 1 tests PASS.

- [ ] **Step 9: Commit Task 1**

Run: `git add package.json vercel.json .gitignore api/_lib test && git commit -m "feat: add secure Vercel session foundation"`

### Task 2: Apps Script Gateway Client and Safe Error Boundary

**Files:**
- Create: `api/_lib/gas.js`
- Create: `test/gas.test.js`
- Modify: `api/_lib/http.js`

**Interfaces:**
- Consumes: `getRuntimeConfig()` from Task 1.
- Produces: `callGas({ role, action, params, subject, fetchImpl?, timeoutMs? }): Promise<unknown>`.
- The outbound body is `{ secret, role, action, params, subject }`; the Apps Script URL is never returned to clients.

- [ ] **Step 1: Write failing gateway tests**

Add tests named `callGas sends POST text plain body`, `callGas follows a successful Apps Script response`, `callGas rejects upstream success false`, `callGas rejects an HTML redirect page`, `callGas times out`, and `callGas never exposes URL secret or upstream body in its public error`.

- [ ] **Step 2: Run gateway tests and verify RED**

Run: `npm test -- --test-name-pattern="callGas"`  
Expected: FAIL because `api/_lib/gas.js` does not exist.

- [ ] **Step 3: Implement `callGas`**

POST with `Content-Type: text/plain;charset=utf-8` to avoid a browser CORS preflight at the Apps Script boundary, use `AbortController` with a 20-second default timeout, require a JSON object response, and convert failures to stable codes `GAS_TIMEOUT`, `GAS_UNAVAILABLE`, or `GAS_REJECTED`.

- [ ] **Step 4: Run Task 2 tests**

Run: `npm test -- --test-name-pattern="callGas|readJson|sendJson"`  
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run: `git add api/_lib/gas.js api/_lib/http.js test/gas.test.js && git commit -m "feat: add safe Apps Script gateway client"`

### Task 3: Student Login, Session, and Action API

**Files:**
- Create: `api/_lib/actions.js`
- Create: `api/_lib/student-policy.js`
- Create: `api/student/login.js`
- Create: `api/student/logout.js`
- Create: `api/student/session.js`
- Create: `api/student/action.js`
- Create: `test/student-policy.test.js`
- Create: `test/student-api.test.js`

**Interfaces:**
- Consumes: HTTP, session, and Apps Script gateway interfaces from Tasks 1-2.
- Produces: `STUDENT_ACTIONS: ReadonlySet<string>` and `normalizeStudentRequest(action, params, session): { action, params, subject }`.
- Produces: serverless handlers for `/api/student/login`, `/api/student/logout`, `/api/student/session`, and `/api/student/action`.
- Student login calls Apps Script action `checkLogin` with role `public`; successful result must contain the normalized student ID and name before a cookie is issued.

- [ ] **Step 1: Write failing student policy tests**

Cover every student action used by the current student HTML. Include saves, reads, updates, deletes, statistics, AI analysis, inquiries, teacher messages, badge reads/acknowledgements, settings reads, and connection checks. Assert unknown and teacher-only actions are denied.

- [ ] **Step 2: Add failing identity enforcement tests**

Assert reads replace the first student argument with session identity, payload saves overwrite `studentId` and `name`, and ownership-sensitive record/row operations attach `{ studentId, name }` as `subject`. Assert attempts to submit a different identity do not reach `callGas`.

- [ ] **Step 3: Run student policy tests and verify RED**

Run: `npm test -- --test-name-pattern="student policy|student identity|student ownership"`  
Expected: FAIL because the policy module does not exist.

- [ ] **Step 4: Implement the student action policy**

Create explicit immutable action metadata in `api/_lib/actions.js` and implement `normalizeStudentRequest` without accepting arbitrary function names.

- [ ] **Step 5: Run policy tests and verify GREEN**

Run: `npm test -- --test-name-pattern="student policy|student identity|student ownership"`  
Expected: PASS.

- [ ] **Step 6: Write failing student endpoint tests**

Cover method rejection, malformed/oversized bodies, invalid login, valid login cookie, missing/tampered/expired cookie, action allowlist rejection, successful action forwarding, upstream failure mapping, session inspection, and logout cookie clearing.

- [ ] **Step 7: Run endpoint tests and verify RED**

Run: `npm test -- --test-name-pattern="student API"`  
Expected: FAIL because the endpoint handlers do not exist.

- [ ] **Step 8: Implement student endpoints**

Use dependency-injectable handler factories for tests and default exports for Vercel. Return only `{ authenticated, role, studentId, name }` from the session endpoint and never return the signed token.

- [ ] **Step 9: Run Task 3 tests**

Run: `npm test -- --test-name-pattern="student"`  
Expected: PASS.

- [ ] **Step 10: Commit Task 3**

Run: `git add api/student api/_lib/actions.js api/_lib/student-policy.js test/student-*.test.js && git commit -m "feat: secure student API actions"`

### Task 4: Teacher Password Login and Role API

**Files:**
- Create: `api/_lib/password.js`
- Create: `api/_lib/teacher-policy.js`
- Create: `api/teacher/login.js`
- Create: `api/teacher/logout.js`
- Create: `api/teacher/session.js`
- Create: `api/teacher/action.js`
- Create: `scripts/hash-teacher-password.mjs`
- Create: `test/password.test.js`
- Create: `test/teacher-api.test.js`

**Interfaces:**
- Consumes: Tasks 1-2 session, HTTP, and gateway interfaces.
- Produces: `verifyTeacherPassword(candidate, saltHex, expectedHashHex): Promise<boolean>` using Node `crypto.scrypt` and `timingSafeEqual`.
- Produces: `TEACHER_ACTIONS: ReadonlySet<string>` containing only functions invoked by the current teacher HTML.
- Produces: handlers for `/api/teacher/login`, `/api/teacher/logout`, `/api/teacher/session`, and `/api/teacher/action`.
- Produces: local-only password hashing script that writes the salt and hash to stdout only when the user explicitly runs it; those values are not committed.

- [ ] **Step 1: Write failing password tests**

Assert correct password passes, incorrect password fails, malformed salt/hash fails without throwing, equal-length comparison uses the derived buffer, and no error contains the candidate password.

- [ ] **Step 2: Run password tests and verify RED**

Run: `npm test -- --test-name-pattern="teacher password"`  
Expected: FAIL because `api/_lib/password.js` does not exist.

- [ ] **Step 3: Implement password verification and hashing script**

Use `scrypt` with a random 16-byte salt and a 64-byte derived key. The runtime accepts only `TEACHER_PASSWORD_SALT` and `TEACHER_PASSWORD_HASH`, never the plaintext password.

- [ ] **Step 4: Run password tests and verify GREEN**

Run: `npm test -- --test-name-pattern="teacher password"`  
Expected: PASS.

- [ ] **Step 5: Write failing teacher endpoint tests**

Cover missing/wrong/correct password, generic login failure text, teacher cookie issuance, method rejection, missing/wrong-role/tampered/expired session, unknown/student-only action denial, allowed action forwarding, session inspection, logout, and malformed/oversized JSON.

- [ ] **Step 6: Run teacher API tests and verify RED**

Run: `npm test -- --test-name-pattern="teacher API"`  
Expected: FAIL because teacher handlers do not exist.

- [ ] **Step 7: Implement teacher policy and endpoints**

Build the allowlist from calls extracted from the current teacher source. Do not forward password or session data to Apps Script.

- [ ] **Step 8: Run Task 4 tests**

Run: `npm test -- --test-name-pattern="teacher|password"`  
Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run: `git add api/teacher api/_lib/password.js api/_lib/teacher-policy.js scripts/hash-teacher-password.mjs test/password.test.js test/teacher-api.test.js && git commit -m "feat: secure teacher API actions"`

### Task 5: Browser Compatibility Bridge

**Files:**
- Create: `public/js/api-bridge.js`
- Create: `test/api-bridge.test.js`

**Interfaces:**
- Consumes: student and teacher endpoints from Tasks 3-4.
- Produces: browser global `window.google.script.run` compatible with `.withSuccessHandler(fn).withFailureHandler(fn).action(...params)`.
- Produces: `window.appAuth.loginStudent(studentId, name)`, `loginTeacher(password)`, `logout()`, and `getSession()`.
- Reads `document.documentElement.dataset.appRole` with exact values `student` or `teacher`; it contains no upstream URL or secret.

- [ ] **Step 1: Write failing bridge tests**

Using a minimal VM DOM/fetch stub, test success and failure chaining, handler-less calls, concurrent calls with isolated handlers, student versus teacher endpoint selection, login/session/logout routes, `401` session expiry callback, malformed JSON, and absence of Apps Script URLs or secret names in the public file.

- [ ] **Step 2: Run bridge tests and verify RED**

Run: `npm test -- --test-name-pattern="API bridge"`  
Expected: FAIL because `public/js/api-bridge.js` does not exist.

- [ ] **Step 3: Implement the bridge**

Keep each runner chain immutable so concurrent calls cannot overwrite handlers. Send `credentials:'same-origin'`, `Content-Type:'application/json'`, and `{ action, params }` only.

- [ ] **Step 4: Run Task 5 tests**

Run: `npm test -- --test-name-pattern="API bridge"`  
Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run: `git add public/js/api-bridge.js test/api-bridge.test.js && git commit -m "feat: bridge legacy UI to secure APIs"`

### Task 6: Preserve and Adapt Student and Teacher Interfaces

**Files:**
- Replace: `index.html`
- Create: `teacher/index.html`
- Create: `public/js/student-auth.js`
- Create: `public/js/teacher-auth.js`
- Create: `scripts/check-public-bundle.mjs`
- Create: `test/frontend-static.test.js`

**Interfaces:**
- Consumes: `window.google.script.run` and `window.appAuth` from Task 5.
- Produces: student page at `/` and teacher page at `/teacher`.
- Student auth adapter converts the existing successful `checkLogin` UI flow to `/api/student/login` without changing visible login fields.
- Teacher auth adapter blocks dashboard initialization until `/api/teacher/login` succeeds and clears rendered research data on logout or session expiry.

- [ ] **Step 1: Capture current Apps Script HTML sources without editing them**

Copy the complete current `index.html` and `teacher.html` from the Apps Script editor into the target repository files. Record SHA-256 hashes in the task notes only, not in runtime output.

- [ ] **Step 2: Write failing static integration tests**

Assert both pages load `public/js/api-bridge.js`, set the correct `data-app-role`, contain no Apps Script URL or spreadsheet ID, preserve required student and teacher DOM IDs, and expose teacher login/logout controls. Assert missing/tampered/expired sessions hide protected content and clear rendered values.

- [ ] **Step 3: Run frontend tests and verify RED**

Run: `npm test -- --test-name-pattern="frontend static|protected UI"`  
Expected: FAIL because the adapted pages and auth scripts do not exist.

- [ ] **Step 4: Adapt the student page**

Remove hardcoded `window.GAS_API_URL`, load the bridge before existing application code, route the existing login button through `loginStudent`, restore only a server-validated session, and preserve all existing record, chart, inquiry, message, AI, challenge, and badge markup/logic.

- [ ] **Step 5: Adapt the teacher page**

Add a password login gate before dashboard initialization, use `loginTeacher`, add logout, restore only a valid teacher session, and clear protected DOM state after `401` or logout. Preserve current teacher actions and challenge/badge settings.

- [ ] **Step 6: Implement the public bundle scanner**

Scan Git-tracked public/API client files for the known spreadsheet ID format, Apps Script deployment URL format, secret environment variable values when present, password-like literals, and accidental student fixture data. Exit nonzero on a match and print only file/line/category, never the matched value.

- [ ] **Step 7: Run Task 6 tests and security scan**

Run: `npm test && npm run security:public`  
Expected: all tests PASS and scan exits 0.

- [ ] **Step 8: Commit Task 6**

Run: `git add index.html teacher public scripts/check-public-bundle.mjs test/frontend-static.test.js && git commit -m "feat: serve student and teacher interfaces on Vercel"`

### Task 7: Secure Apps Script API and Spreadsheet Binding

**Files:**
- Create: `apps-script/Api.gs`
- Create: `apps-script/Security.gs`
- Create: `apps-script/Spreadsheet.gs`
- Create: `apps-script/Ownership.gs`
- Create: `apps-script/tests/security.test.js`
- Create: `apps-script/tests/ownership.test.js`
- Create: `scripts/test-apps-script.mjs`
- Create: `apps-script/README.md`
- Modify: `apps-script/Code.gs`

**Interfaces:**
- Consumes: outbound request shape from `callGas` in Task 2.
- Produces: `doPost(e): TextOutput`, `handleApiRequest_(request): object`, and non-sensitive `doGet(): TextOutput`.
- Produces: `getSpreadsheet_(): Spreadsheet`, which reads only private Script Property `SPREADSHEET_ID` and calls `SpreadsheetApp.openById`.
- Produces: `verifyGatewaySecret_(candidate): void`, `dispatchStudentAction_(action, params, subject): unknown`, `dispatchTeacherAction_(action, params): unknown`, and ownership guards for caffeine IDs, sleep IDs, inquiry rows, teacher-message rows, and badge acknowledgements.

- [ ] **Step 1: Write failing Apps Script security tests**

Use a Node VM harness with mocked `PropertiesService`, `SpreadsheetApp`, `ContentService`, and action functions. Test missing/malformed body, missing/wrong secret, unknown role, unknown action, public `checkLogin`, student and teacher allowlists, `doGet` non-sensitive response, and errors that omit secrets and request data.

- [ ] **Step 2: Run security tests and verify RED**

Run: `node scripts/test-apps-script.mjs --test apps-script/tests/security.test.js`  
Expected: FAIL because the Apps Script gateway files do not exist.

- [ ] **Step 3: Implement Apps Script gateway and spreadsheet provider**

Validate the shared secret before role/action dispatch. Replace all `SpreadsheetApp.getActiveSpreadsheet()` calls in tracked Apps Script source with `getSpreadsheet_()`. Add a static test that fails if `getActiveSpreadsheet` or a literal spreadsheet ID remains.

- [ ] **Step 4: Run security tests and verify GREEN**

Run: `node scripts/test-apps-script.mjs --test apps-script/tests/security.test.js`  
Expected: PASS.

- [ ] **Step 5: Write failing ownership tests**

Mock sheet rows and assert a student can access only their caffeine/sleep records, inquiry rows, teacher-message rows, and badge rows. Test numeric and nonnumeric normalized IDs, mismatched names for nonnumeric IDs, missing owner columns, invalid row numbers, and another student's record ID.

- [ ] **Step 6: Run ownership tests and verify RED**

Run: `node scripts/test-apps-script.mjs --test apps-script/tests/ownership.test.js`  
Expected: FAIL because ownership guards are missing.

- [ ] **Step 7: Implement ownership-aware student dispatch**

Force session subject identity into save/read functions and validate ownership before update, delete, reply, read acknowledgement, or badge acknowledgement functions. Teacher dispatch retains the existing business functions but requires role and gateway secret checks.

- [ ] **Step 8: Run Task 7 tests and static checks**

Run: `npm test && npm run test:apps-script && npm run security:public`  
Expected: all tests PASS; no active-spreadsheet call, literal sheet ID, deployment URL, or secret appears in tracked source.

- [ ] **Step 9: Commit Task 7**

Run: `git add apps-script scripts/test-apps-script.mjs package.json test && git commit -m "feat: secure Apps Script data gateway"`

### Task 8: Local Integration, Documentation, and Preview Readiness

**Files:**
- Create: `.env.example`
- Create: `README.md` updates or replacement
- Create: `docs/deployment-checklist.md`
- Create: `test/integration.test.js`
- Modify: `package.json`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: deterministic commands `npm test`, `npm run test:apps-script`, `npm run security:public`, and `npm run verify`.
- `.env.example` contains names and descriptions only, never values.

- [ ] **Step 1: Write failing local integration tests**

Start the handlers with a mocked Apps Script server and test student login → own save/read, cross-student denial, teacher login → teacher read, logout denial, malformed upstream response, and concurrent student/teacher sessions.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `npm test -- --test-name-pattern="integration"`  
Expected: FAIL until all routes are wired through the same runtime configuration.

- [ ] **Step 3: Complete Vercel routing and deployment documentation**

Document exact environment variable names, Apps Script Script Property names, local verification commands, Preview-to-Production order, rollback procedure, and the rule that challenge settings are preserved but not redesigned in this phase.

- [ ] **Step 4: Run integration tests and verify GREEN**

Run: `npm test -- --test-name-pattern="integration"`  
Expected: PASS.

- [ ] **Step 5: Run complete local verification**

Run: `npm run verify`  
Expected: Node tests, Apps Script VM tests, public bundle scan, and syntax checks all exit 0.

- [ ] **Step 6: Commit Task 8**

Run: `git add .env.example README.md docs/deployment-checklist.md test/integration.test.js package.json vercel.json && git commit -m "docs: add secure deployment and verification workflow"`

### Task 9: Apps Script, Vercel, and End-to-End Deployment

**Files:**
- Modify remotely: current Apps Script project `Code.gs` and new `.gs` files
- Modify remotely: current Apps Script Script Properties
- Modify remotely: current Apps Script active deployment
- Modify remotely: GitHub branch and pull request for `caffeine-sleep-research`
- Modify remotely: Vercel project settings and environment variables
- Evidence: `docs/deployment-verification.md` with identifiers redacted

**Interfaces:**
- Consumes: verified repository and Apps Script files from Tasks 1-8.
- Produces: public student and teacher URLs plus redacted evidence of student submission and teacher retrieval.

- [ ] **Step 1: Prepare secret values without exposing them**

Generate a random session key and Vercel↔Apps Script shared secret locally. Derive the teacher password salt/hash with `scripts/hash-teacher-password.mjs` through a non-echoing input path. Never paste values into chat, logs, command arguments, or tracked files.

- [ ] **Step 2: Configure Apps Script properties**

Set the current spreadsheet ID and shared secret in Script Properties. Confirm the property names exist while keeping values masked.

- [ ] **Step 3: Update Apps Script source and save**

Add the new gateway/security/ownership files, replace the business source with the tested version, save, and verify the editor reports the project stored in Drive.

- [ ] **Step 4: Create a new Apps Script version and update the active web-app deployment**

Keep execution as the project owner and access as all users. Record the active deployment URL only in the Vercel environment, not in Git. Confirm unauthenticated data actions now fail and the non-sensitive health response succeeds.

- [ ] **Step 5: Push the implementation branch and open/attach a pull request**

Push `vercel-secure-deployment`, open a PR against `main`, and attach the PR to the task. Wait for Vercel Preview and repository checks.

- [ ] **Step 6: Connect or reuse the Vercel project and set Preview variables**

Import `caffeine-sleep-research` if no project exists. Set the Apps Script URL, shared secret, session key, and teacher password salt/hash as masked Preview variables. Do not expose values in screenshots.

- [ ] **Step 7: Verify Preview without real student writes**

Open `/`, `/teacher`, and `/api/health` in a logged-out browser context. Verify the two login screens, denied unauthenticated APIs, valid teacher login, and no secret/App Script URL in page source or network responses.

- [ ] **Step 8: Merge after Preview verification and set Production variables**

Merge only after local verification and Preview checks pass. Set the same categories of masked variables for Production and wait for Production deployment.

- [ ] **Step 9: Obtain or confirm a test student identity at the last responsible moment**

If no dedicated test identity is already present, ask the user for one specific existing test account or permission to add a clearly marked test student. Do not display the identity in the final report.

- [ ] **Step 10: Run the authorized end-to-end data test**

On the Production student URL: log in, submit a uniquely identifiable test caffeine or sleep record, and confirm it appears in the current sheet. On the Production teacher URL: log in and confirm the same record appears. Record timestamps and sheet/tab names only; redact identity and health values.

- [ ] **Step 11: Run post-deployment security verification**

Confirm direct Apps Script calls without the shared secret fail, student cross-identity requests fail, unauthenticated teacher requests fail, public GitHub files contain no protected values, and both URLs work without Google login.

- [ ] **Step 12: Document verified results**

Create `docs/deployment-verification.md` containing the final URLs, deployment date, commands/tests run, redacted end-to-end results, known limitation of name+student-number login, rollback point, and deferred challenge work.

- [ ] **Step 13: Ask before disabling GitHub Pages**

Disabling the existing public page changes an externally visible website. Present the verified Vercel URLs and request action-time confirmation before turning GitHub Pages off.

- [ ] **Step 14: Final verification and commit**

Run: `npm run verify && git diff --check && git status --short`  
Expected: all checks exit 0; only the redacted verification document is pending. Commit it with `git commit -m "docs: record deployment verification"`.

