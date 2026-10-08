function getSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_NOT_CONFIGURED');
  return SpreadsheetApp.openById(spreadsheetId);
}

// Keep numeric student IDs compatible with the students-sheet VLOOKUP keys.
function studentIdCellValue_(value) {
  var text = String(value == null ? '' : value).trim();
  var number = Number(text);
  return /^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(number) ? number : text;
}

// Native table append grows the table atomically and ignores ARRAYFORMULA spill rows.
function appendRecordRow_(sheet, values, replaceRow, confirmation) {
  var idColumns = { caffeine: 4, sleep: 4, info: 5 };
  var idColumn = idColumns[sheet.getName()];
  if (idColumn !== undefined && values.length > idColumn) {
    values = values.slice();
    values[idColumn] = studentIdCellValue_(values[idColumn]);
  }
  var tableIds = {
    students: '2014874531', caffeine: '2029527919', sleep: '363107583',
    info: '1885862728', inquiries: '1093000658', teacher_awards: '1664194152',
    teacher_messages: '1114109815', ai_reports: '828886298'
  };
  var sheetIds = { students: 1719931031, caffeine: 1399656889, sleep: 630091192, info: 1695164716,
    inquiries: 1181027465, teacher_awards: 1683406443, teacher_messages: 2044179537, ai_reports: 1501207574 };
  var tableId = tableIds[sheet.getName()];
  // A recovery-created sheet has a new ID and no existing native table.
  var nativeTable = tableId && sheet.getSheetId() === sheetIds[sheet.getName()];
  if (!nativeTable && !confirmation) {
    if (replaceRow) return sheet.getRange(replaceRow, 1, 1, values.length).setValues([values]);
    return sheet.appendRow(values);
  }
  var dateColumns = { caffeine: [0,8], sleep: [0,6,8], info: [0], inquiries: [0,10], teacher_messages: [0], ai_reports: [5] };
  var cells = values.map(function(value, index) {
    if (value === null || value === undefined || value === '') return {};
    if (value instanceof Date) return { userEnteredValue: { numberValue: value.getTime() / 86400000 + 25569 + 9 / 24 } };
    if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
    if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
    var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match && (dateColumns[sheet.getName()] || []).indexOf(index) >= 0) {
      return { userEnteredValue: { numberValue: Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]), Number(match[4]||0), Number(match[5]||0), Number(match[6]||0)) / 86400000 + 25569 } };
    }
    return { userEnteredValue: { stringValue: String(value) } };
  });
  var request = replaceRow
    ? { updateCells: { start: { sheetId: sheet.getSheetId(), rowIndex: replaceRow-1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } }
    : { appendCells: { sheetId: sheet.getSheetId(), ...(nativeTable ? { tableId: tableId } : {}), rows: [{ values: cells }], fields: 'userEnteredValue' } };
  var requests = confirmation ? [request, confirmation] : [request];
  try {
    // Sheets rejects appendCells on a message table containing only its header.
    // Reserve its first body row in the same batch, keeping the existing columns.
    if (nativeTable && !replaceRow && sheet.getName() === 'teacher_messages' && sheet.getLastRow() === 1) {
      var metadata = Sheets.Spreadsheets.get(sheet.getParent().getId(), { fields: 'sheets(tables(tableId,range))' });
      var table;
      (metadata.sheets || []).forEach(function(item) {
        (item.tables || []).forEach(function(candidate) { if (candidate.tableId === tableId) table = candidate; });
      });
      if (!table) throw new Error('TABLE_MAPPING_MISMATCH');
      var firstBodyRow = (table.range.startRowIndex || 0) + 2;
      if (table.range.endRowIndex < firstBodyRow) {
        requests.unshift({ updateTable: { table: { tableId: tableId, range: Object.assign({}, table.range, { endRowIndex: firstBodyRow }) }, fields: 'range' } });
      }
    }
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, sheet.getParent().getId());
  }
  catch (error) { throw new Error('TABLE_APPEND_FAILED'); }
  return sheet;
}

// Read-only deployment check: no research rows are written.
function verifyTableAppendAccess() {
  var ss = getSpreadsheet_();
  var sheets = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(properties(sheetId,title),tables(tableId,range))' }).sheets || [];
  var expected = { caffeine: '2029527919', sleep: '363107583', info: '1885862728', inquiries: '1093000658', teacher_awards: '1664194152', teacher_messages: '1114109815', ai_reports: '828886298' };
  Object.keys(expected).forEach(function(name) {
    var found = sheets.filter(function(item) { return item.properties.title === name; })[0];
    if (!found || !(found.tables || []).some(function(table) { return table.tableId === expected[name] && table.range.sheetId === found.properties.sheetId; })) throw new Error('TABLE_MAPPING_MISMATCH');
  });
  Logger.log('Native table API access confirmed');
}
