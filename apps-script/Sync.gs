// Optional local-first writes. Called under the existing student mutation lock.
function syncCanonical_(value) {
  if (Array.isArray(value)) return value.map(syncCanonical_);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).sort().forEach(function(key) { out[key] = syncCanonical_(value[key]); });
    return out;
  }
  return value;
}
function syncHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(syncCanonical_(value)), Utilities.Charset.UTF_8)
    .map(function(n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
}
function syncLedger_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('_sync_receipts');
  if (!sheet) {
    sheet = ss.insertSheet('_sync_receipts');
    sheet.appendRow(['key', 'digest', 'state', 'recordId', 'createdAt', 'receipt']);
  }
  return sheet;
}
function syncLedgerFind_(key) {
  var sheet = syncLedger_();
  if (sheet.getLastRow() < 2) return null;
  var match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!match) return null;
  var row = (Sheets.Spreadsheets.Values.get(sheet.getParent().getId(), "'_sync_receipts'!A" + match.getRow() + ':F' + match.getRow(), {valueRenderOption:'UNFORMATTED_VALUE'}).values || [[]])[0];
  return { row: match.getRow(), key: row[0], digest: row[1], state: row[2], id: row[3], result: row[5] ? JSON.parse(row[5]) : null };
}
function syncLedgerPending_(key, digest, id) {
  var sheet = syncLedger_();
  sheet.appendRow([key, digest, 'pending', id, new Date().toISOString(), '']);
  SpreadsheetApp.flush();
  return { row: sheet.getLastRow(), key: key, digest: digest, state: 'pending', id: id };
}
function syncLedgerCommit_(entry, result) {
  syncLedger_().getRange(entry.row, 3, 1, 4).setValues([['committed', entry.id, result.committedAt, JSON.stringify(result)]]);
  SpreadsheetApp.flush();
}
function syncProfileState_(subject) {
  var sheet = getSpreadsheet_().getSheetByName('info');
  // Sheets API writes bypass SpreadsheetApp's per-execution read cache.
  var rows = Sheets.Spreadsheets.Values.get(sheet.getParent().getId(), "'info'!A:K", { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).values || [];
  rows = rows.map(function(row) { return Array.from({length:11},function(_,i){return row[i] == null ? '' : row[i];}); });
  for (var i = 1; i < rows.length; i++) {
    if (normalizeId(rows[i][5]) === normalizeId(subject.studentId)) {
      return { sheet: sheet, row: i + 1, values: rows[i].slice(0, 11), version: syncHash_(rows[i].slice(6, 11)) };
    }
  }
  return { sheet: sheet, row: null, values: null, version: 'missing' };
}
function syncRecordExists_(action, id, subject) {
  var type = action === 'saveCaffeineData' ? 'caffeine' : 'sleep';
  var sheet = getSpreadsheet_().getSheetByName(type);
  if (sheet.getLastRow() < 2) return false;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var column = findHeaderColumn_(headers, ['고유ID', 'id', 'ID']) + 1;
  if (column < 1) throw new Error('REQUEST_REJECTED');
  var match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!match) return false;
  requireOwnedRecord_(type, id, subject);
  return true;
}
function syncCells_(values) {
  return values.map(function(value) {
    return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value == null ? '' : value) } };
  });
}
function syncConfirmation_(entry, receipt) {
  return { updateCells: { start: { sheetId: syncLedger_().getSheetId(), rowIndex: entry.row - 1, columnIndex: 2 },
    rows: [{ values: syncCells_(['committed', entry.id, receipt.committedAt, JSON.stringify(receipt)]) }], fields: 'userEnteredValue' } };
}
function syncSaveProfile_(payload, subject, entry, receipt) {
  var state = syncProfileState_(subject);
  if (payload._sync.baseVersion !== state.version) return { success: false, error: 'SYNC_CONFLICT' };
  var p = parseStudentId(normalizeId(subject.studentId));
  var values = [getKSTTimestamp(), p.grade, p.class, p.number, subject.name, studentIdCellValue_(subject.studentId),
    payload.weight, payload.targetCaf || '', payload.targetBedtime || '', payload.targetWakeTime || '', payload.ageGroup || 'teen'];
  receipt.version = syncHash_(values.slice(6, 11));
  var cells = syncCells_(values);
  cells[0] = { userEnteredValue: { numberValue: Date.parse(String(values[0]).replace(' ', 'T') + 'Z') / 86400000 + 25569 } };
  var write = state.row ? { updateCells: { start: { sheetId: state.sheet.getSheetId(), rowIndex: state.row - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } }
    : { appendCells: { sheetId: state.sheet.getSheetId(), rows: [{ values: cells }], fields: 'userEnteredValue' } };
  // Native table appends must supply sheetId as well as the known production table.
  if (!state.row && state.sheet.getSheetId() === 1695164716) write.appendCells.tableId = '1885862728';
  var confirmation = syncConfirmation_(entry, receipt);
  Sheets.Spreadsheets.batchUpdate({ requests: [write, confirmation] }, state.sheet.getParent().getId());
  return receipt;
}
function runSyncedMutation_(action, payload, subject, execute) {
  var meta = payload._sync;
  if (!meta || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.mutationId || '')) throw new Error('REQUEST_REJECTED');
  if (action === 'saveInitialSetup' && typeof meta.baseVersion !== 'string') return { success: false, error: 'SYNC_PROFILE_REQUIRED' };
  var fingerprint = Object.assign({}, payload);
  delete fingerprint.id;
  var key = syncHash_([subject.studentId, subject.name, action, meta.mutationId]);
  var digest = syncHash_(fingerprint);
  var entry = syncLedgerFind_(key);
  if (entry && entry.digest !== digest) throw new Error('REQUEST_REJECTED');
  if (entry && entry.state === 'committed') return entry.result;
  payload.id = 'sync_' + key;
  if (!entry) entry = syncLedgerPending_(key, digest, payload.id);
  var receipt = { success: true, mutationId: meta.mutationId, recordId: payload.id, committedAt: new Date().toISOString() };
  if (action === 'saveInitialSetup') return syncSaveProfile_(payload, subject, entry, receipt);
  if (action === 'saveSleepData') {
    // Sleep is replaceable by date: data and receipt must commit together.
    var saved = execute(syncConfirmation_(entry, receipt));
    return saved && saved.success === true ? receipt : saved || {success:false,error:'SYNC_UNCONFIRMED'};
  }
  var result;
  if (syncRecordExists_(action, payload.id, subject)) result = { success: true };
  else result = execute();
  if (!result || result.success !== true) return result || { success: false, error: 'SYNC_UNCONFIRMED' };
  receipt = Object.assign({}, result, receipt);
  if (action === 'saveCaffeineData') receipt.record = { id: payload.id, name: payload.drink, company: payload.company || '', foodName: payload.foodName || '', amount: Number(payload.mg), time: payload.time, reason: payload.reason || '', symptom: payload.symptom || '' };
  syncLedgerCommit_(entry, receipt);
  return receipt;
}
