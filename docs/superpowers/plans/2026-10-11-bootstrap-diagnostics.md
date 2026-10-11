# Student bootstrap failure diagnosis

> Execute inline under the user's authorization to fix and verify while unavailable.

**Goal:** Identify the intermittent production bootstrap rejection without exposing student data or replaying writes.

**Design:** Keep the generic rejection response and authorization rules. Add fixed stage/category diagnostics inside Apps Script; never log request bodies, identity, credentials, raw exception text or stacks. Preserve version 28 for rollback.

**Scope:** `apps-script/Api.gs`, its gateway tests and generated deployment source. Existing records must remain untouched.

- [x] Add failing tests for profile-read stage diagnosis, authorization rejection and sensitive exception redaction.
- [x] Implement bounded diagnostic enums and retain current success/error behavior.
- [x] Run gateway tests, full verification and independent review.
- [x] Save and deploy Apps Script version 29 to the existing deployment URL with unchanged permissions; retain version 28.
- [x] Repeat bounded test-account reads: 48/48 passed after instrumentation. Historical Vercel log confirms upstream unsuccessful output; exact cause remains unobserved.
- [x] Add fault-tested recovery for future explicitly transient bootstrap read failures: exactly one retry, same deadline, student role only, no writes/auth/unknown-error replay. Independent review passed.
- [ ] Verify the recovery production deployment and record final evidence.

The historical error's underlying exception is still unknown. The recovery only handles fixed `service_unavailable`/`rate_limit` categories at `student_operation`/`profile_sync`; it must not be described as a confirmed historical root-cause repair.
