function normalizeOwnerId_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(Math.round(value)).trim();
  return String(value).replace(/\.0+$/, '').trim();
}

function ownerMatchesSubject_(rowId, rowName, subject) {
  var subjectId = normalizeOwnerId_(subject.studentId);
  var subjectName = String(subject.name || '').trim();
  var storedId = normalizeOwnerId_(rowId);
  var storedName = String(rowName || '').trim();
  if (!subjectId || !subjectName || !storedId) return false;
  if (/^\d+$/.test(subjectId)) return storedId === subjectId;
  return storedName === subjectName
    && (storedId === subjectId || storedId + '_' + storedName === subjectId);
}

function requireOwnedRecord_(sheetName, recordId, subject) {
  if (!recordId) throw new Error('REQUEST_REJECTED');
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('REQUEST_REJECTED');
  var rows = sheet.getDataRange().getValues();
  if (!rows.length) throw new Error('REQUEST_REJECTED');
  var headers = rows[0].map(function(value) { return String(value || '').trim(); });
  var idColumn = findHeaderColumn_(headers, ['고유ID', 'id', 'ID']);
  var ownerColumn = findHeaderColumn_(headers, ['전체학번', '학번', 'studentId']);
  var nameColumn = findHeaderColumn_(headers, ['성명', '이름', 'name']);
  if (idColumn < 0 || ownerColumn < 0 || nameColumn < 0) throw new Error('REQUEST_REJECTED');
  var found = false;
  for (var row = 1; row < rows.length; row++) {
    if (String(rows[row][idColumn]) !== String(recordId)) continue;
    found = true;
    if (!ownerMatchesSubject_(rows[row][ownerColumn], rows[row][nameColumn], subject)) {
      throw new Error('REQUEST_REJECTED');
    }
  }
  if (found) return;
  throw new Error('REQUEST_REJECTED');
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function requireOwnedRow_(sheetName, rowIndex, subject) {
  var normalizedRow = Number(rowIndex);
  if (!Number.isInteger(normalizedRow) || normalizedRow < 2) throw new Error('REQUEST_REJECTED');
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || normalizedRow > sheet.getLastRow()) throw new Error('REQUEST_REJECTED');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(value) { return String(value || '').trim(); });
  var ownerColumn = findHeaderColumn_(headers, ['전체학번', '학번', 'studentId']);
  var nameColumn = findHeaderColumn_(headers, ['성명', '이름', 'name', 'studentName']);
  if (ownerColumn < 0 || nameColumn < 0) throw new Error('REQUEST_REJECTED');
  var values = sheet.getRange(normalizedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!ownerMatchesSubject_(values[ownerColumn], values[nameColumn], subject)) {
    throw new Error('REQUEST_REJECTED');
  }
}

function findHeaderColumn_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var index = headers.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
}
