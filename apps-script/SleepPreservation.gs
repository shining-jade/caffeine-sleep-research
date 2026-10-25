// Current-row storage, stable ID/CAS/replay and separate classification metadata.
function preservedSleepCells_(row) {
  return Array.from({length:19},function(_,i){var v=row[i];if(i===0)return recordTimestampText_(v);if(i===6||i===8)return recordDateText_(v);if(i===7||i===9)return recordTimeText_(v);if(i===10&&v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v)))return String(Number(v));return String(v===null||v===undefined?'':v);});
}
function preservedSleepVersion_(row,meta) {
  if(arguments.length<2)meta=preservedSleepMetadataForRow_(row);
  var version=[String(row[13]),syncHash_(preservedSleepCells_(row))];
  if(meta.exists)version.push(syncHash_([preservedSleepMetadataFields_(meta),meta.revision,meta.identityConflict]));
  return JSON.stringify(version);
}
function preservedSleepMatches_(sheet,id) {
  if(!id)throw new Error('REQUEST_REJECTED');
  return sheet.getDataRange().getValues().slice(1).map(function(row,i){return {row:row,index:i+2};}).filter(function(item){return String(item.row[13])===String(id);});
}
function preservedSleepValues_(p,old) {
  var who=parseStudentId(normalizeId(p.studentId)),r=old?old.slice(0,19):Array(19).fill('');r[0]=getKSTTimestamp();
  if(!old){r[1]=who.grade;r[2]=who.class;r[3]=who.number;r[4]=normalizeId(p.studentId);r[5]=p.name;r[13]=p.id;}
  r[6]=p.date;r[7]=p.sleepTime;r[8]=p.wakeDate===undefined?(old?old[8]:''):p.wakeDate;r[9]=p.wakeTime;r[10]=p.hours;r[11]=p.condition;r[12]=p.memo||'';
  ['smartphone','activity','latency','awakenings','daytime'].forEach(function(k,i){if(p[k]!==undefined)r[14+i]=p[k]||'';});return r;
}
function savePreservedSleep_(p,confirmation) {
  if(!p||!p.studentId||!p.name||!p.date||!p.id)throw new Error('REQUEST_REJECTED');
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName('sleep');
  if(!sheet){sheet=ss.insertSheet('sleep');sheet.appendRow(['타임스탬프','학년','반','번호','전체학번','성명','날짜','취침시간','기상날짜','기상시간','수면시간','컨디션','메모','고유ID','취침전스마트폰','취침전활동','잠들기소요시간','수면중각성','낮졸림']);sheet.setFrozenRows(1);}
  var matches=preservedSleepMatches_(sheet,p.id),values=preservedSleepValues_(p);
  if(matches.some(function(m){return !ownerMatchesSubject_(m.row[4],m.row[5],p);}))throw new Error('REQUEST_REJECTED');
  if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  var currentMeta=preservedSleepMetadataForRow_(matches.length?matches[0].row:values);
  if(currentMeta.identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  var nextMeta=preservedSleepMetadataFromPayload_(p,currentMeta);
  if(nextMeta.error)return {success:false,error:nextMeta.error};
  if(matches.length){
    if(JSON.stringify(preservedSleepCells_(matches[0].row).slice(6))!==JSON.stringify(preservedSleepCells_(values).slice(6))||nextMeta.write)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
    if(confirmation)Sheets.Spreadsheets.batchUpdate({requests:[confirmation]},ss.getId());
    return {success:true,recordId:String(p.id),duplicateRequest:true,updated:false};
  }
  if(currentMeta.exists)return {success:false,error:'SLEEP_RECORD_DELETED'};
  var intervalCheck=preservedSleepIntervalGuard_(values,sheet,p);if(intervalCheck.error)return intervalCheck;
  var extra=[],metadataRequest=preservedSleepMetadataRequest_(values,nextMeta);
  if(metadataRequest)extra.push(metadataRequest);if(confirmation)extra.push(confirmation);
  appendRecordRow_(sheet,values,null,extra.length?extra:null);
  return Object.assign({success:true,recordId:String(p.id),updated:false},intervalCheck.intervalReviewRequired?{intervalReviewRequired:true}:{});
}
function updatePreservedSleep_(p) {
  var sheet=getSpreadsheet_().getSheetByName('sleep');if(!sheet)throw new Error('REQUEST_REJECTED');
  var matches=preservedSleepMatches_(sheet,p.id);if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(matches.length!==1||!ownerMatchesSubject_(matches[0].row[4],matches[0].row[5],p))throw new Error('REQUEST_REJECTED');
  var old=matches[0].row,currentMeta=preservedSleepMetadataForRow_(old);
  if(currentMeta.identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(typeof p.baseVersion!=='string'||!p.baseVersion)return {success:false,error:'SLEEP_EDIT_VERSION_REQUIRED'};
  var nextMeta=preservedSleepMetadataFromPayload_(p,currentMeta);if(nextMeta.error)return {success:false,error:nextMeta.error};
  var version=preservedSleepVersion_(old,currentMeta),values=preservedSleepValues_(p,old);
  if(p.baseVersion!==version){var previousTarget;try{previousTarget=JSON.parse(p.baseVersion)[0];}catch(_invalidVersion){}
    if(previousTarget===String(p.id)&&JSON.stringify(preservedSleepCells_(values).slice(1))===JSON.stringify(preservedSleepCells_(old).slice(1))&&preservedSleepMetadataEqual_(nextMeta,currentMeta))return {success:true,recordId:String(p.id),editVersion:version,duplicateRequest:true};
    return {success:false,error:'SLEEP_EDIT_CONFLICT'};
  }
  var intervalCheck=preservedSleepIntervalGuard_(values,sheet,p);if(intervalCheck.error)return intervalCheck;
  var metadataRequest=preservedSleepMetadataRequest_(values,nextMeta);
  appendRecordRow_(sheet,values,matches[0].index,metadataRequest?[metadataRequest]:null);
  return {success:true,recordId:String(p.id),editVersion:preservedSleepVersion_(values,nextMeta)};
}
function deletePreservedSleep_(id) {
  var sheet=getSpreadsheet_().getSheetByName('sleep');if(!sheet)throw new Error('REQUEST_REJECTED');var matches=preservedSleepMatches_(sheet,id);
  if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(matches.length!==1)throw new Error('REQUEST_REJECTED');
  if(preservedSleepMetadataForRow_(matches[0].row).identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  sheet.deleteRow(matches[0].index);return {success:true};
}
