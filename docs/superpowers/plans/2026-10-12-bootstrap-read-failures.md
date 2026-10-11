# Bootstrap read failures must remain failures

The user authorized unattended diagnosis, fixes, review and production verification until 05:00 KST. Existing research records must remain untouched.

At 01:00 KST, 12/12 HTTP responses succeeded but only 11/12 contained both original test markers. Vercel also recorded three recoverable non-JSON execution responses and one classified `profile_sync/rate_limit` rejection. The missing response body was not retained, so its exact exception is unconfirmed.

Source inspection found a concrete failure mode: profile, statistics and history functions catch storage errors and return empty/default data. Bootstrap currently accepts these as a successful snapshot. Fault injection must reproduce this before changing code.

Design: make bootstrap reads strict through optional internal arguments. Storage exceptions and missing required sheets propagate to the existing sanitized gateway failure handling; genuinely empty sheets and a new student's absent profile remain valid. Other callers retain their existing behavior. Do not change authentication, mutation execution, or stored records.

- [x] Reproduce swallowed failures in real Apps Script functions with injected storage faults (three tests failed before implementation).
- [x] Implement strict bootstrap reads and verify legitimate empty data and unchanged standalone behavior.
- [x] Run full verification (753 Node tests, 146 Apps Script tests, public scan, build) and independent review (99 focused tests; no findings).
- [ ] Deploy the new Apps Script version to the existing URL with unchanged access; merge matching source.
- [ ] Verify a small production read batch, preserve incident evidence, and continue scheduled monitoring.
