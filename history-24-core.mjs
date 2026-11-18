import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';
export const HISTORY24_MS=86400000,HISTORY24_STORAGE_KEY='arrow.history24.verified.v2';
export const HISTORY_RETAINED_BARS=4000;
const copy=x=>structuredClone(x),integer=Number.isSafeInteger;
const equal=(a,b)=>['time','closeTime','open','high','low','close'].every(k=>a[k]===b[k]);
export function validateHistoryBar(b,duration){return b?.closed===true&&b.sourceClosed===true&&b.finalOhlcVerified===true&&integer(b.time)&&integer(b.closeTime)&&b.closeTime-b.time===duration&&['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0&&Number.isSafeInteger(b[k]/.25))&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high)&&integer(b.providerBarIndex)&&b.providerBarIndex>=0&&typeof b.sessionFirst==='boolean'&&typeof b.sessionLast==='boolean';}

export function createHistory24Cache(saved){
  let data={version:2,instrument:'CME_MINI:NQ1!',series:{'1':[],'5':[],'15':[]},coverage:{},offsets:{},pending:{},updatedAt:null};
  if(saved?.version===2&&saved.instrument===data.instrument&&saved.series){
    for(const tf of ['1','5','15']){const rows=saved.series[tf];if(Array.isArray(rows)&&rows.length<=HISTORY_RETAINED_BARS&&rows.every(b=>validateHistoryBar(b,Number(tf)*60000))){data.series[tf]=copy(rows);data.coverage[tf]=copy(saved.coverage?.[tf]??null);}}
    for(const [key,value]of Object.entries(saved.offsets??{}).slice(-64))if(/^(1|5|15)\|/.test(key)&&integer(value))data.offsets[key]=value;
    for(const [key,rows]of Object.entries(saved.pending??{}).slice(-6)){const tf=key.split('|')[0];if(['1','5','15'].includes(tf)&&Array.isArray(rows)&&rows.length<=HISTORY_RETAINED_BARS&&rows.every(b=>validateHistoryBar(b,Number(tf)*60000)))data.pending[key]=copy(rows);}
  }
  const snapshot=()=>copy(data);
  function ingest(bars,tf,{runKey,windowEnd,retainEnd,totalRows,pageIndex,pageCount,source='ARCHIVE',now=Date.now()}={}){
    const duration=Number(tf)*60000;if(!['1','5','15'].includes(tf)||!Array.isArray(bars)||bars.some(b=>!validateHistoryBar(b,duration)))return {accepted:false,reason:'INVALID_HISTORY_ROWS'};
    const existing=data.series[tf],byTime=new Map(existing.map(b=>[b.time,b])),key=tf+'|'+runKey;
    const waiting=new Map((data.pending[key]??[]).map(b=>[b.time,b]));for(const b of bars)waiting.set(b.time,b);
    const incoming=[...waiting.values()],common=incoming.filter(b=>byTime.has(b.time)&&equal(b,byTime.get(b.time))),offsets=new Set(common.map(b=>b.providerBarIndex-byTime.get(b.time).providerBarIndex));
    if(existing.length===0&&incoming.length)data.offsets[key]=-10000;
    // A run without a witnessed overlap stays buffered in its native index
    // namespace. It must never overwrite already mapped bars with raw indices.
    if(data.offsets[key]===undefined&&common.length>=1&&offsets.size===1)data.offsets[key]=[...offsets][0];
    const offset=data.offsets[key];
    if(offset===undefined){data.pending[key]=copy(incoming.sort((a,b)=>a.time-b.time).slice(-HISTORY_RETAINED_BARS));for(const old of Object.keys(data.pending).filter(k=>k.startsWith(tf+'|')).slice(0,-2))delete data.pending[old];}
    else {delete data.pending[key];for(const raw of incoming){const known=byTime.get(raw.time);if(known&&!equal(raw,known)){// Corrected native historical OHLC invalidates previous coverage.
        data.coverage[tf]=null;
      }
      const b={...copy(raw),providerBarIndex:raw.providerBarIndex-offset,originalProviderBarIndex:raw.providerBarIndex,archiveSource:source,archiveRunKey:runKey};if(b.providerBarIndex<0)continue;byTime.set(b.time,b);
    }}
    // A verified overlap with a newly mapped run can also unlock older pages
    // saved before a source restart. Their original receipt times stay intact.
    let advanced=true;while(advanced){advanced=false;for(const [waitingKey,pages]of Object.entries(data.pending)){
      if(!waitingKey.startsWith(tf+'|'))continue;if(!pages.length){delete data.pending[waitingKey];continue;}
      const matches=pages.filter(b=>byTime.has(b.time)&&equal(b,byTime.get(b.time))),shifts=new Set(matches.map(b=>b.providerBarIndex-byTime.get(b.time).providerBarIndex));
      if(!matches.length||shifts.size!==1)continue;const shift=[...shifts][0],waitingRun=waitingKey.slice(tf.length+1);if(pages.some(b=>b.providerBarIndex-shift<0))continue;
      data.offsets[waitingKey]=shift;for(const b of pages)if(!byTime.has(b.time))byTime.set(b.time,{...copy(b),providerBarIndex:b.providerBarIndex-shift,originalProviderBarIndex:b.providerBarIndex,archiveRunKey:waitingRun,archiveSource:waitingRun.startsWith('archive:')?'ARCHIVE':'LIVE_CLOSED_CONTEXT'});
      delete data.pending[waitingKey];advanced=true;
    }}
    const recent=retainEnd??windowEnd??Math.max(0,...bars.map(b=>b.closeTime),...existing.map(b=>b.closeTime));
    // Keep the requested24h plus causal indicator warmup; only24h is reported.
    const sorted=[...byTime.values()].sort((a,b)=>a.time-b.time),boundary=recent-HISTORY24_MS;
    const all=sorted.slice(-HISTORY_RETAINED_BARS);data.series[tf]=all;data.updatedAt=now;
    if(source==='ARCHIVE'&&integer(windowEnd)&&integer(totalRows)&&integer(pageIndex)&&integer(pageCount)){
      const id=String(runKey)+'|'+windowEnd+'|'+totalRows,old=data.coverage[tf];const coverage=old?.id===id?old:{id,windowEnd,totalRows,pageCount,pages:[],complete:false};
      coverage.pages=[...new Set([...coverage.pages,pageIndex])].sort((a,b)=>a-b);coverage.complete=coverage.pages.length===pageCount;data.coverage[tf]=coverage;
    }
    return {accepted:true,count:all.length};
  }
  function forRange(end){
    const start=end-HISTORY24_MS,series={},coverage=[],reasons=[];
    for(const tf of ['1','5','15']){
      const duration=Number(tf)*60000,all=data.series[tf].filter(b=>b.closeTime<=end),inside=all.filter(b=>b.closeTime>start),before=all.filter(b=>b.closeTime<=start).slice(-(tf==='1'?600:100)),rows=[...before,...inside];series[tf]=rows;
      const proof=deriveVerifiedSessionGaps(rows),savedCoverage=data.coverage[tf],expectedEnd=Math.floor(end/duration)*duration;
      const tail=rows.at(-1)?.closeTime??null;
      // Leave a transport margin around the fixed activation boundary. The
      //600/100-row archive supplies at least400/80 causal warmup rows while
      //its source snapshot advances during a cold background scan.
      const coversStart=before.length>=(tf==='1'?400:80);
      // The uninterrupted native provider index chain between a witnessed
      // pre-window bar and the current closed boundary proves missing-only
      // completion, even when cached pages came from different snapshots.
      const complete=coversStart&&tail===expectedEnd&&proof.valid;
      coverage.push({timeframe:tf,rows:inside.length,warmup:before.length,from:inside[0]?.time??null,to:tail,complete,pages:savedCoverage?.pages.length??0,totalPages:savedCoverage?.pageCount??null,reasonCodes:proof.reasonCodes});
      if(!complete)reasons.push('HISTORY24_INCOMPLETE:'+tf);
    }
    return {kind:'HISTORY24_VERIFIED_DATASET_V1',instrument:data.instrument,start,end,series,coverage,complete:reasons.length===0,reasonCodes:reasons,ordersCreated:false,liveEligible:false};
  }
  function forBars(end,count=3000){
    if(!integer(end)||!integer(count)||count<20||count>3000)throw TypeError('INVALID_WARMUP_COUNT');
    const base=data.series['1'].filter(b=>b.closeTime<=end).slice(-count),start=base[0]?.time??end,series={'1':base},coverage=[],reasonCodes=[],repairRequests=[];
    for(const tf of ['1','5','15']){
      const available=tf==='1'?base:data.series[tf].filter(b=>b.closeTime<=end).slice(-1000);
      // Only require the HTF context belonging to this 3000-bar run and its
      // preceding 100 closed context bars. Unrelated older cache holes must
      // not hold up an otherwise complete causal dataset.
      const rows=tf==='1'?base:[...available.filter(b=>b.closeTime<=start).slice(-100),...available.filter(b=>b.closeTime>start)];series[tf]=copy(rows);
      const proof=deriveVerifiedSessionGaps(rows),expectedEnd=Math.floor(end/(Number(tf)*60000))*Number(tf)*60000;
      const duration=Number(tf)*60000;
      for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(b.time>a.closeTime&&b.providerBarIndex>a.providerBarIndex+1)repairRequests.push({timeframe:tf,time:b.time-duration,reason:'MISSING_PROVIDER_ROWS'});}
      if(rows.length&&rows.at(-1).closeTime<expectedEnd)repairRequests.push({timeframe:tf,time:expectedEnd-duration,reason:'MISSING_CLOSED_TAIL'});
      const complete=proof.valid&&rows.at(-1)?.closeTime===expectedEnd&&(tf==='1'?rows.length===count:rows.filter(b=>b.closeTime<=start).length>=100);
      coverage.push({timeframe:tf,rows:rows.length,required:tf==='1'?count:100,complete,from:rows[0]?.time??null,to:rows.at(-1)?.closeTime??null,reasonCodes:proof.reasonCodes});if(!complete)reasonCodes.push('WARMUP_HISTORY_INCOMPLETE:'+tf);
    }
    const missing=repairRequests.slice(0,4);
    // New Pine runs have a native index namespace. Gap-only rows cannot
    // establish its offset, so send a known OHLC anchor for each requested TF.
    const anchors=[...new Set(missing.map(r=>r.timeframe))].map(timeframe=>({timeframe,time:series[timeframe].at(-1).time,reason:'NATIVE_INDEX_ALIGNMENT_ANCHOR'}));
    return {kind:'WARMUP_VERIFIED_COUNT_DATASET_V1',instrument:data.instrument,start,end,requestedBars:count,series,coverage,complete:!reasonCodes.length,reasonCodes,repairRequests:[...missing,...anchors],ordersCreated:false,liveEligible:false};
  }
  return {ingest,forRange,forBars,snapshot};
}
