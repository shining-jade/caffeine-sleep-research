(function(root){
  'use strict';
  const defaults=()=>({month:'all',order:'desc'});
  const validMonth=value=>typeof value==='string'&&(value==='all'||/^\d{4}-(0[1-9]|1[0-2])$/.test(value));
  const choice=value=>({month:validMonth(value?.month)?value.month:'all',order:value?.order==='asc'?'asc':'desc'});
  function ownerKey(subject){
    if(!subject||subject.studentId===undefined||subject.studentId===null)return null;
    const id=String(subject.studentId).trim(),name=String(subject.name??'').trim();
    return id&&name?JSON.stringify([id,name]):null;
  }
  function create(options={}){
    let storage=options.storage;
    if(storage===undefined)try{storage=root.localStorage;}catch(_){storage=null;}
    const policy=options.policy||root.SleepRecordPolicy,doc=options.document||root.document,memory=new Map(),persisted=new Map();
    const storageKey=key=>'student-history-view-v1:'+key;
    function read(subject){
      const key=ownerKey(subject);if(!key)return{version:1,caffeine:defaults(),sleep:defaults()};
      if(memory.has(key))return memory.get(key);
      let saved;try{saved=JSON.parse(storage?.getItem(storageKey(key))||'null');persisted.set(key,!!storage);}catch(_){persisted.set(key,false);}
      const value={version:1,caffeine:choice(saved?.caffeine),sleep:choice(saved?.sleep)};memory.set(key,value);return value;
    }
    function setPreference(kind,field,value,subject){
      const key=ownerKey(subject);if(!key||!['sleep','caffeine'].includes(kind)||!['month','order'].includes(field))return false;
      const saved=read(subject);saved[kind]=choice({...saved[kind],[field]:value});
      try{if(!storage)throw Error('STORAGE_UNAVAILABLE');storage.setItem(storageKey(key),JSON.stringify(saved));persisted.set(key,true);return true;}catch(_){persisted.set(key,false);return false;}
    }
    function describe(kind,record,index){
      const raw=kind==='caffeine'?record.time:record.wakeDateTime||(record.wakeDate&&(record.end||record.wakeTime)?record.wakeDate+'T'+(record.end||record.wakeTime):'');
      const timed=typeof raw==='string'&&/[T ]\d{1,2}:\d{2}/.test(raw),timestamp=timed?policy.instant(raw):NaN,valid=Number.isFinite(timestamp);
      const local=valid?new Date(timestamp+9*3600000).toISOString():'';
      const seconds=typeof raw==='string'&&/\d{1,2}:\d{2}:\d{2}/.test(raw);
      return{record,index,valid,timestamp:valid?timestamp:null,month:valid?local.slice(0,7):'',dateTime:valid?local.slice(0,seconds?19:16).replace('T',' '):'날짜·시간 확인 필요',stableId:String(record.id??record.recordId??'')};
    }
    function view(kind,records,subject){
      if(!['sleep','caffeine'].includes(kind))throw Error('INVALID_HISTORY_KIND');
      const prefs=read(subject)[kind],all=(Array.isArray(records)?records:[]).map((record,index)=>describe(kind,record,index)),counts=new Map();
      all.forEach(row=>{if(row.valid)counts.set(row.month,(counts.get(row.month)||0)+1);});
      const months=[...counts].sort((a,b)=>b[0].localeCompare(a[0])).map(([value,count])=>({value,count,label:value}));
      // Loading an empty/partial list must not erase a remembered month for this owner.
      const month=prefs.month==='all'||counts.has(prefs.month)?prefs.month:'all';
      const rows=all.filter(row=>!row.valid||month==='all'||row.month===month).sort((a,b)=>{
        if(a.valid!==b.valid)return a.valid?-1:1;
        if(a.valid&&a.timestamp!==b.timestamp)return prefs.order==='asc'?a.timestamp-b.timestamp:b.timestamp-a.timestamp;
        if(a.stableId!==b.stableId)return a.stableId<b.stableId?-1:1;
        return a.index-b.index;
      });
      return{rows,months,month,order:prefs.order,invalidCount:all.filter(row=>!row.valid).length,selectedCount:rows.filter(row=>row.valid).length,totalCount:all.length,owner:ownerKey(subject),persisted:persisted.get(ownerKey(subject))!==false};
    }
    function renderControls(kind,model,subject,onChange,getSubject){
      if(!doc)return;
      const month=doc.getElementById(kind+'HistoryMonth'),order=doc.getElementById(kind+'HistoryOrder'),status=doc.getElementById(kind+'HistoryStatus');
      if(month){
        month.innerHTML='';const add=(value,label)=>{const option=doc.createElement('option');option.value=value;option.textContent=label;month.appendChild(option);};
        add('all','전체 ('+model.totalCount+'건)');model.months.forEach(item=>add(item.value,item.label));month.value=model.month;
      }
      const key=ownerKey(subject);
      for(const [element,field]of [[month,'month'],[order,'order']])if(element){
        if(field==='order')element.value=model.order;element.disabled=!key;
        element.onchange=()=>{if(!key||ownerKey(getSubject())!==key)return;setPreference(kind,field,element.value,subject);onChange();};
      }
      if(status){
        const basis=kind==='caffeine'?'섭취일':'기상일';
        status.textContent=(model.month==='all'?'전체 '+model.totalCount+'건':model.month+' '+basis+' '+model.selectedCount+'건')+(model.invalidCount?' · 날짜·시간 확인 필요 '+model.invalidCount+'건 별도 표시':'')+' · '+(model.persisted?'보기 설정은 이 기기에 기억돼요.':'이번 화면에만 적용돼요. 기기 저장을 확인해주세요.');
      }
    }
    return{ownerKey,view,setPreference,renderControls};
  }
  root.RecordHistoryView=create();root.RecordHistoryView.create=create;
})(window);
