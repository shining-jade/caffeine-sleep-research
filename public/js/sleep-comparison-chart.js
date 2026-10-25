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
  root.SleepComparisonChart={build,sleepStyle,formatHours};
})(window);
