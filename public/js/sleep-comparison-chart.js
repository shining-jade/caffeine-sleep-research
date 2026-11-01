(function(root){
  'use strict';
  // Display coordinates only. Does not classify records or add collection days.
  function build(dates,caffeine,sleep){
    const number=value=>value===null||value===undefined||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
    const axisLabels=dates.map(day=>String(day).slice(5));
    if(dates.length){const end=new Date(dates[dates.length-1]+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);axisLabels.push(end.toISOString().slice(5,10)+' · 경계');}
    return {
      dayCount:dates.length,axisLabels,
      caffeine:dates.map((day,i)=>({x:i,y:number(caffeine[i])})),
      sleep:dates.map((day,i)=>({x:i+.5,y:number(sleep[i])})),
      reference:value=>number(value)===null||!dates.length?[]:[{x:0,y:number(value)},{x:dates.length,y:number(value)}],
      xScale:{type:'linear',min:-.35,max:Math.max(.65,dates.length+.35),offset:false,grid:{display:false},afterBuildTicks:axis=>{axis.ticks=axisLabels.map((_,value)=>({value}));},ticks:{stepSize:1,autoSkip:false,font:{size:10},callback:value=>Number.isInteger(value)?axisLabels[value]||'':''}},
    };
  }
  // Chart.js draws lower order values last: keep sleep above bars and reference lines.
  function sleepStyle(){return {order:-1,borderColor:'#4C8ED9',backgroundColor:'#BFDBFE',pointBackgroundColor:'#BFDBFE',pointBorderColor:'#4C8ED9',pointBorderWidth:2,pointStyle:'circle',pointRadius:5,pointHoverRadius:6,borderWidth:3.5,tension:0,fill:false,spanGaps:false};}
  // Text only: retain raw durations and plot coordinates.
  const hoursNumberFormat=new Intl.NumberFormat('en-US',{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:false,roundingMode:'halfExpand'});
  function formatHours(value){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    if(typeof value==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))return null;
    const number=Number(value);if(!Number.isFinite(number)||number<0)return null;
    return hoursNumberFormat.format(number===0?0:number);
  }
  // Display only. The policy owns KST grouping and totals; names only refine a
  // confirmed zero, never convert missing/unknown amounts to a numeric zero.
  function caffeineStates(dates,groups,summary){
    const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
    const amount=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
    const noIntake=r=>String(r?.name??r?.음료명??'').replace(/\s/g,'')==='카페인섭취안함'&&amount(r?.amount??r?.함량)===0;
    return dates.map((date,i)=>{
      const group=groups?.get(date),hasSummary=summary&&typeof summary.hasData?.[i]==='boolean';
      const has=hasSummary?summary.hasData[i]:groups?!!group:null;
      const total=hasSummary?amount(summary.amounts?.[i]):group?.total??null;
      const detailMatches=!!group&&((group.total===null&&total===null)||(known(group.total)&&known(total)&&Math.abs(group.total-total)<1e-9));
      const rows=detailMatches?group.records:[],none=rows.filter(noIntake).length;
      const positive=rows.some(r=>Number(r?.amount??r?.함량)>0);
      let status,label,short,symbol,color,detail='';
      if(has===null||(has===false&&group)||(has===true&&group&&!detailMatches)){
        status='unverified';label='기록 확인 필요';short='확인';symbol='△';color='#92400e';detail='요약과 기록 상세를 다시 확인해 주세요.';
      }else if(!has){status='missing';label='미기록';short='미기록';symbol='×';color='#64748b';detail='이 날짜의 섭취 기록이 없습니다.';
      }else if(total===null){status='unknown';label='함량 미상';short='미상';symbol='◇';color='#92400e';detail='기록은 있지만 함량 미상이 포함되어 총량을 확인할 수 없습니다.';
      }else if(none&&positive){status='conflict';label=total+'mg · 확인 필요';short='확인';symbol='△';color='#92400e';detail='미섭취 기록과 양수 섭취 기록이 함께 있습니다. 합산값과 원기록은 유지됩니다.';
      }else if(total>0){status='positive';label=total+'mg 기록';short='';symbol='';color='#475569';
      }else if(rows.length&&none===rows.length){status='no_intake';label='미섭취 완료 · 0mg';short='0mg';symbol='✓';color='#0f766e';detail='카페인 섭취 안 함으로 명시한 기록입니다.';
      }else{status='zero';label='0mg 기록';short='0mg';symbol='□';color='#0369a1';detail=rows.length?'0mg 제품 또는 일반 0mg 기록입니다.':'0mg 기록 완료 · 상세가 없어 미섭취와 0mg 제품은 구분하지 않습니다.';}
      return {date,status,label,short,symbol,color,detail,total};
    });
  }
  function caffeineStateDataset(states){
    const radius=context=>{const x=context.chart?.scales?.x;return x?Math.min(6,Math.max(1.5,Math.abs(x.getPixelForValue(1)-x.getPixelForValue(0))/3)):6;};
    return {type:'line',label:'카페인 기록 상태',caffeineStatus:true,order:-.5,
      data:states.map((s,i)=>({x:i,y:s.status==='positive'?null:0})),
      showLine:false,spanGaps:false,clip:false,yAxisID:'y',borderWidth:0,
      pointRadius:radius,pointHoverRadius:radius,pointHitRadius:16,
      pointStyle:states.map(s=>s.status==='missing'?'crossRot':s.status==='unknown'?'rectRot':['conflict','unverified'].includes(s.status)?'triangle':s.status==='zero'?'rect':'circle'),
      pointBackgroundColor:states.map(s=>s.status==='no_intake'?'#ccfbf1':'#ffffff'),
      pointBorderColor:states.map(s=>s.color),pointBorderWidth:2};
  }
  // Labels are decorations at the actual 0 baseline, not amount coordinates.
  const caffeineStatePlugin={id:'caffeineBaselineState',afterDatasetsDraw(chart){
    const states=chart.options.plugins?.caffeineBaselineState?.states||[],ctx=chart.ctx;
    const index=chart.data.datasets.findIndex(d=>d.caffeineStatus);if(index<0||!chart.isDatasetVisible(index))return;
    const points=chart.getDatasetMeta(index).data,step=chart.scales.x.getPixelForValue(1)-chart.scales.x.getPixelForValue(0);
    ctx.save();ctx.textAlign='center';ctx.textBaseline='bottom';ctx.font='600 10px sans-serif';
    states.forEach((state,i)=>{const point=points[i];if(!point||point.skip||state.status==='positive')return;
      ctx.fillStyle=state.color;
      if(state.status==='no_intake'&&point.options.radius>=5){ctx.textBaseline='middle';ctx.fillText('✓',point.x,point.y);ctx.textBaseline='bottom';}
      if(ctx.measureText(state.short).width+2<=Math.abs(step))ctx.fillText(state.short,point.x,point.y-11);
    });ctx.restore();
  }};
  function caffeineStateLegend(){return '<p data-caffeine-state-legend style="font-size:12px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;margin:8px 0;">0선 기호: <span style="display:inline-block;color:#0f766e;">○✓ 미섭취 완료(0mg)</span> · <span style="display:inline-block;color:#0369a1;">□ 0mg 기록</span> · <span style="display:inline-block;color:#64748b;">× 미기록</span> · <span style="display:inline-block;color:#92400e;">◇ 함량 미상</span> · <span style="display:inline-block;color:#92400e;">△ 확인 필요</span></p>';}
  root.SleepComparisonChart={build,sleepStyle,formatHours,caffeineStates,caffeineStateDataset,caffeineStatePlugin,caffeineStateLegend};
})(window);
