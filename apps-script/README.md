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
# Native table record writes

Enable the Google Sheets v4 advanced service with identifier `Sheets` in the Apps Script project. `appendRecordRow_` appends to the existing native table, so ARRAYFORMULA output does not push new records below blank rows. Existing sleep records are updated in place; an unsuccessful update retains the old record.

The table and sheet IDs in `Spreadsheet.gs` identify this deployment's research workbook. When recreating tables or moving to another workbook, update those IDs and run the read-only `verifyTableAppendAccess` function before deploying. A newly created recovery sheet uses the original plain-range write path until it has its own configured table.
