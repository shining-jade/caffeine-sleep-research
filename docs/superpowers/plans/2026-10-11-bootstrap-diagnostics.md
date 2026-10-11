# Student bootstrap failure diagnosis

> Execute inline under the user's authorization to fix and verify while unavailable.

**Goal:** Identify the intermittent production bootstrap rejection without exposing student data or replaying writes.

**Design:** Keep the generic rejection response and authorization rules. Add fixed stage/category diagnostics inside Apps Script; never log request bodies, identity, credentials, raw exception text or stacks. Preserve version 28 for rollback.

**Scope:** `apps-script/Api.gs`, its gateway tests and generated deployment source. Existing records must remain untouched.

- [ ] Add failing tests for profile-read stage diagnosis, authorization rejection and sensitive exception redaction.
- [ ] Implement bounded diagnostic enums and retain current success/error behavior.
- [ ] Run gateway tests, full verification and independent review.
- [ ] Save and deploy a new version of the existing Apps Script deployment, retaining its URL and permissions.
- [ ] Reproduce bounded test-account reads, inspect the sanitized failure evidence, then address the demonstrated cause and verify.
- [ ] Record final production evidence and any remaining limitation.
