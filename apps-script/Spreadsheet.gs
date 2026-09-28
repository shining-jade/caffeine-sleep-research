function getSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_NOT_CONFIGURED');
  return SpreadsheetApp.openById(spreadsheetId);
}
