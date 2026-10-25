// Classification/provenance only. The original 19-column sleep row is not extended.
var SLEEP_EPISODE_META_HEADERS_=['record_id','owner_key','sleep_type','classification_status','classification_source','policy_version','revision','updated_at'];
function preservedSleepOwnerKey_(row) {
  var owner=normalizeOwnerId_(row[4]);
  return syncHash_([owner,/^\d+$/.test(owner)?'':String(row[5]||'').trim()]);
}
function preservedSleepMetadataIndex_() {
  var sheet=getSpreadsheet_().getSheetByName('_sleep_record_meta'),groups=new Map();
  if(sheet)sheet.getDataRange().getValues().slice(1).forEach(function(row,i){var key=SleepRecordPolicy.id(row[0]);if(!key)return;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row:row,index:i+2});});
  return {sheet:sheet,groups:groups};
}
function preservedSleepMetadataForRow_(row,index) {
  index=index||preservedSleepMetadataIndex_();var entries=index.groups.get(SleepRecordPolicy.id(row[13]))||[],owner=preservedSleepOwnerKey_(row);
  if(!entries.length)return {exists:false,kind:'',status:'uncollected',source:'legacy_uncollected',policyVersion:'',revision:0,identityConflict:false};
  if(entries.length!==1||String(entries[0].row[1])!==owner)return {exists:true,kind:'',status:'conflict',source:'metadata_conflict',policyVersion:'',revision:0,identityConflict:true};
  var entry=entries[0],r=entry.row,revision=Number(r[6]);
  if(!Number.isSafeInteger(revision)||revision<1)return {exists:true,kind:'',status:'conflict',source:'metadata_conflict',policyVersion:'',revision:0,identityConflict:true};
  return {exists:true,kind:String(r[2]||''),status:String(r[3]||''),source:String(r[4]||''),policyVersion:String(r[5]||''),revision:revision,index:entry.index,identityConflict:false};
}
function preservedSleepMetadataFields_(meta){return [meta.kind,meta.status,meta.source,meta.policyVersion];}
function preservedSleepMetadataEqual_(a,b){return JSON.stringify(preservedSleepMetadataFields_(a))===JSON.stringify(preservedSleepMetadataFields_(b));}
function preservedSleepMetadataFromPayload_(payload,current) {
  var has=function(k){return Object.prototype.hasOwnProperty.call(payload,k);};
  if(!['sleepType','classificationStatus','typeSource'].some(has))return Object.assign({},current,{write:false});
  var kind=has('sleepType')?String(payload.sleepType||'').trim():current.kind;
  if(!kind&&!current.exists)return Object.assign({},current,{write:false});
  if(['main','main_candidate','nap','unclassified'].indexOf(kind)<0)return {error:'SLEEP_CLASSIFICATION_INVALID'};
  var status=has('classificationStatus')?String(payload.classificationStatus):current.exists&&kind===current.kind?current.status:kind==='main_candidate'?'candidate':'unconfirmed';
  var source=has('typeSource')?String(payload.typeSource):current.exists&&kind===current.kind?current.source:'client_unspecified';
  if(['candidate','unconfirmed','student_selected','student_confirmed'].indexOf(status)<0||!/^[a-z0-9_-]{1,80}$/.test(source))return {error:'SLEEP_CLASSIFICATION_INVALID'};
  var next={exists:true,kind:kind,status:status,source:source,policyVersion:SleepRecordPolicy.version,revision:current.exists?current.revision+1:1,index:current.index,identityConflict:false,write:true};
  if(current.exists&&preservedSleepMetadataEqual_(next,current))return Object.assign({},current,{write:false});
  return next;
}
function preservedSleepMetadataRequest_(row,next) {
  if(!next.write)return null;
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName('_sleep_record_meta');
  if(!sheet){sheet=ss.insertSheet('_sleep_record_meta');sheet.appendRow(SLEEP_EPISODE_META_HEADERS_);}
  var values=[String(row[13]),preservedSleepOwnerKey_(row),next.kind,next.status,next.source,next.policyVersion,next.revision,getKSTTimestamp()];
  var cells=values.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}};});
  return next.index?{updateCells:{start:{sheetId:sheet.getSheetId(),rowIndex:next.index-1,columnIndex:0},rows:[{values:cells}],fields:'userEnteredValue'}}
    :{appendCells:{sheetId:sheet.getSheetId(),rows:[{values:cells}],fields:'userEnteredValue'}};
}
function preservedSleepMetadataView_(row,meta) {
  meta=meta||preservedSleepMetadataForRow_(row);
  var record=Object.assign(preservedSleepRecordForPolicy_(row),{sleepType:meta.kind,classificationStatus:meta.status,typeSource:meta.source,identityConflict:meta.identityConflict});
  var d=SleepRecordPolicy.describe(record);
  return {sleepType:meta.kind,classificationStatus:meta.status,typeSource:meta.source,classificationPolicyVersion:meta.policyVersion,metaRevision:meta.revision,identityConflict:meta.identityConflict,intervalHours:d.intervalHours,analysisDate:d.analysisDate,analysisDateBasis:d.analysisDateBasis,analysisTargetDate:d.targetDate,recordUsable:d.eligibleRecord,policyVersion:SleepRecordPolicy.version};
}
