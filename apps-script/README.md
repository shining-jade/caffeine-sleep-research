# Apps Script backend

The tracked source preserves the current spreadsheet business logic while adding a server-to-server gateway for the Vercel API routes.

## Private script properties

Configure these in Apps Script **Project settings → Script properties**. Never put their values in this repository or browser JavaScript.

- `SPREADSHEET_ID`: the current research spreadsheet ID.
- `GAS_SHARED_SECRET`: a long random value shared only with the Vercel server environment.

The teacher password does not belong in Apps Script. Vercel stores only its scrypt salt and hash.

## Build and deploy

Run `npm run build:apps-script`. Paste the generated `apps-script/dist/Code.gs` over the project's existing `Code.gs`, save, create a new web-app version, execute as the owner, and allow access for anyone. Requests still require the shared gateway secret and a role-specific allowlist.

`doGet` returns only a health response. Student and teacher data actions are accepted only through authenticated Vercel API routes and the shared-secret `doPost` gateway.
