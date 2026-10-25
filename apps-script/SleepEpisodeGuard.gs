// Called inside dispatchStudentAction_'s script lock, after replay recognition.
function preservedSleepRecordForPolicy_(row) {
  return {id:String(row[13] === undefined ? '' : row[13]),date:recordDateText_(row[6]),start:recordTimeText_(row[7]),wakeDate:recordDateText_(row[8]),end:recordTimeText_(row[9]),hours:row[10],condition:row[11]};
}
function preservedSleepIntervalGuard_(values, sheet, payload) {
  var incoming = preservedSleepRecordForPolicy_(values), d = SleepRecordPolicy.describe(incoming);
  if (d.intervalHours === null) {
    var missing = [6,7,8,9].some(function(i) { return values[i] === undefined || values[i] === null || String(values[i]).trim() === ''; });
    // Old clients may have never collected a wake date. Preserve that absence.
    if (missing && !payload.sleepPolicyVersion) return {intervalReviewRequired:true};
    return {success:false,error:'SLEEP_INTERVAL_INVALID'};
  }
  var peers = sheet.getDataRange().getValues().slice(1).filter(function(row) { return ownerMatchesSubject_(row[4],row[5],payload); }).map(preservedSleepRecordForPolicy_);
  var conflicts = SleepRecordPolicy.overlaps(incoming,peers);
  if (!conflicts.length) return {};
  return {success:false,error:'SLEEP_INTERVAL_OVERLAP',conflicts:conflicts.map(function(c) { return {id:c.id,date:c.source.date,start:c.source.start,wakeDate:c.source.wakeDate,end:c.source.end}; })};
}
