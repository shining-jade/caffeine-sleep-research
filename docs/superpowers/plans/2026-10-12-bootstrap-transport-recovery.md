# Student bootstrap transport recovery

The user authorized unattended fixes and verification through 05:00 KST.

Production evidence: at 00:20 KST, all 12 bounded test-account reads failed with `GAS_UNAVAILABLE`. Vercel diagnostics show `stage=execution`, `reason=invalid_json`, `upstreamStatus=200`. A subsequent single read and 12-request run succeeded with both saved markers intact. The underlying Google response body and exact service cause remain unconfirmed.

Design: include authenticated student `getStudentBootstrap` in the existing idempotent snapshot transport recovery. Retry `GAS_UNAVAILABLE`/`GAS_TIMEOUT` once within the original total deadline, reserving at most 25 seconds for the first attempt. Preserve classified rejection rules and all authorization, redirect restrictions and mutation behavior. Apps Script remains version 29; no record writes are needed.

- [x] Add failing transport-recovery, bounded-retry, role/mutation-exclusion and deadline tests (three failed before implementation, then passed).
- [x] Make the minimal gateway change and run full verification (750 Node tests, 143 Apps Script tests, public scan and production build passed).
- [x] Obtain independent review (56 focused tests passed; no findings).
- [ ] Merge and confirm Vercel production deployment.
- [ ] Repeat bounded read-only production validation and record evidence for overnight checks.
