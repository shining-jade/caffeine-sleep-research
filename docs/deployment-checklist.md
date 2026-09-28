# Secure deployment checklist

## 1. Local verification

- Run `npm run verify`.
- Confirm the public-bundle scan reports no Apps Script URL, spreadsheet ID, password, or secret.
- Confirm the existing challenge and badge behavior remains unchanged; redesign is a separate phase.

## 2. Apps Script private configuration

- Build the deployment source with `npm run build:apps-script`.
- In the current Apps Script project, replace `Code.gs` with `apps-script/dist/Code.gs`.
- Add Script Properties `SPREADSHEET_ID` and `GAS_SHARED_SECRET` without copying either value into Git.
- Save and create a new web-app version. Execute as the owner and allow access to anyone; the gateway secret still blocks direct data actions.
- Verify a GET request returns only the service health JSON.

## 3. Vercel private configuration

- Generate the teacher password salt/hash locally with `npm run hash:teacher`; never paste the password into source or chat.
- Configure `GAS_API_URL`, `GAS_SHARED_SECRET`, `SESSION_SECRET`, `TEACHER_PASSWORD_SALT`, and `TEACHER_PASSWORD_HASH` for Preview first, then Production.
- Configure Vercel Firewall rate limits for `/api/student/login` and `/api/teacher/login`; the function-level limiter is defense in depth and is not a durable distributed counter.
- Deploy Preview and verify student login, an own-record save/read, teacher login, and teacher data read.
- Verify `/api/health` returns only `{ "ok": true, "service": "caffeine-sleep" }`.
- Promote the verified commit to Production.

## 4. Live acceptance

- Open the student URL without a Google account, log in with a designated test student, submit a clearly marked test record, and confirm it appears in the current spreadsheet.
- Open `/teacher` without a Google account, log in, and confirm that same test record is visible.
- Remove the acceptance-test row only with explicit approval; otherwise leave it clearly labeled for the owner to remove.
- Confirm wrong student identity, missing teacher session, and direct Apps Script action requests are denied.

## 5. Cutover and rollback

- Keep the current Apps Script deployment version available for rollback until Production acceptance passes.
- Roll back Vercel by promoting the preceding known-good deployment.
- Roll back Apps Script by selecting the preceding web-app version, then restore the matching `GAS_API_URL` in Vercel.
- Disable GitHub Pages only after the Vercel student and teacher flows pass; deleting the repository is not required.
