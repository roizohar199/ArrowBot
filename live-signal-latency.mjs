// Local live-data instrumentation. No OHLC bar time, media timestamp or receipt
// time is silently substituted for capture/exchange/provider emission time.
const finite=Number.isFinite;
const copy=value=>structuredClone(value);
const summarize=values=>{
  const sorted=values.filter(finite).sort((a,b)=>a-b);
  const percentile=p=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;
  return {count:sorted.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:percentile(1)};
};

export function createLiveSignalLatency({
  now=()=>performance.now(),wallNow=Date.now,
  requestAnimationFrame,cancelAnimationFrame,isVisible,isOnscreen,
  maxSamples=600,maxPending=64,maxDurationMs=10000,wallClockToleranceMs=100,onSample=()=>{},
}={}){
  if([now,wallNow,requestAnimationFrame,cancelAnimationFrame,isVisible,isOnscreen,onSample].some(fn=>typeof fn!=='function'))throw TypeError('Clocks, animation callbacks, visibility callbacks and onSample must be functions');
  if(!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>10000||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1000||!finite(maxDurationMs)||maxDurationMs<=0||!finite(wallClockToleranceMs)||wallClockToleranceMs<0)throw TypeError('Invalid live latency limits');
  let context=null,generation=0,serial=0,pending=null,newestRenderedSequence=0,startedAtWall=null,lastResetReason='INITIAL';
  let received=0,completed=0,discarded={},sourceUnavailable={},samples=[];
  const records=new Map();
  const count=(group,reason)=>{group[reason]=(group[reason]??0)+1;};
  function cancelPending(){
    const previous=pending;pending=null;
    if(previous)for(const handle of previous.handles)try{cancelAnimationFrame(handle);}catch{}
  }
  function discard(token,reason='EXPLICITLY_DISCARDED'){
    const item=records.get(token);if(!item)return false;
    if(pending?.token===token)cancelPending();
    records.delete(token);count(discarded,String(reason).slice(0,128));return true;
  }
  function reset(nextContext=null,reason='EXPLICIT_RESET'){
    if(nextContext!==null&&(typeof nextContext!=='string'||!nextContext||nextContext.length>1024))throw TypeError('Invalid latency context');
    cancelPending();records.clear();context=nextContext;generation++;serial=0;newestRenderedSequence=0;
    received=0;completed=0;discarded={};sourceUnavailable={};samples=[];startedAtWall=null;lastResetReason=reason;
  }
  function sourceInfo(value,receiptWall){
    if(value===undefined||value===null)return {sourceTimestamp:null,providerToReceiptAgeMs:null,sourceUnavailableReason:'SOURCE_TIMESTAMP_ABSENT'};
    const timestamp={epochMs:value.epochMs??null,clock:value.clock??null,meaning:value.meaning??null,synchronized:value.synchronized===true};
    let reason=null;
    if(timestamp.clock!=='unix_ms')reason='SOURCE_CLOCK_NOT_COMPARABLE';
    else if(!timestamp.synchronized)reason='SOURCE_CLOCK_NOT_VERIFIED_SYNCHRONIZED';
    else if(!['provider_emission','exchange_event'].includes(timestamp.meaning))reason='SOURCE_TIME_IS_NOT_EMISSION_OR_EXCHANGE_EVENT';
    else if(!finite(timestamp.epochMs)||timestamp.epochMs<0)reason='INVALID_SOURCE_TIMESTAMP';
    else if(timestamp.epochMs>receiptWall)reason='SOURCE_TIMESTAMP_IN_FUTURE';
    return {sourceTimestamp:timestamp,providerToReceiptAgeMs:reason?null:receiptWall-timestamp.epochMs,sourceUnavailableReason:reason};
  }
  function receive(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw TypeError('A latency input object is required');
    const {context:nextContext,eventId,sourceTimestamp}=input;
    if(typeof nextContext!=='string'||!nextContext||nextContext.length>1024||typeof eventId!=='string'||!eventId||eventId.length>1024)throw TypeError('A bounded context and eventId are required');
    const registrationAt=now(),registrationAtWall=wallNow(),hasPerformanceStamp=Object.hasOwn(input,'receivedAt'),hasWallStamp=Object.hasOwn(input,'receivedAtWall');
    if(!finite(registrationAt)||!finite(registrationAtWall))throw TypeError('Invalid receiving clock');
    if(hasPerformanceStamp!==hasWallStamp)throw TypeError('EXPLICIT_RECEIPT_CLOCK_PAIR_REQUIRED');
    const receivedAt=hasPerformanceStamp?input.receivedAt:registrationAt,receivedAtWall=hasWallStamp?input.receivedAtWall:registrationAtWall;
    if(!finite(receivedAt)||receivedAt<0||!finite(receivedAtWall)||receivedAtWall<0)throw TypeError('INVALID_EXPLICIT_RECEIPT_CLOCK_PAIR');
    // A caller may register after transport completes, retaining the real local
    // read-start pair captured before transport. Both stamps must belong to the
    // receiving host's clocks; provider/Pine clocks are never backdating proof.
    if(hasPerformanceStamp){
      const elapsed=registrationAt-receivedAt,wallElapsed=registrationAtWall-receivedAtWall;
      if(elapsed<0||elapsed>maxDurationMs||wallElapsed<0||Math.abs(wallElapsed-elapsed)>wallClockToleranceMs)throw TypeError('INVALID_EXPLICIT_RECEIPT_CLOCK_PAIR');
    }
    if(nextContext!==context)reset(nextContext,context===null?'INITIAL_CONTEXT':'CONTEXT_CHANGED');
    if(startedAtWall===null)startedAtWall=receivedAtWall;
    const token=Object.freeze({generation,sequence:++serial});
    records.set(token,{token,context,eventId,sequence:serial,receivedAt,receivedAtWall,registrationAt,registrationAtWall,receiptTimestampOrigin:hasPerformanceStamp?'EXPLICIT_PAIRED_LOCAL_BOUNDARY':'LOCAL_REGISTRATION',...sourceInfo(sourceTimestamp,receivedAtWall),analysisStartedAt:null,analysisFinishedAt:null,mutationAt:null});received++;
    while(records.size>maxPending)discard(records.keys().next().value,'PENDING_LIMIT');
    return token;
  }
  function stamp(token,field,previous){
    const item=records.get(token);if(!item)return false;
    if(item[field]!==null)return false;
    const at=now();
    if(!finite(at)||!finite(item[previous])||at<item[previous]||at-item.receivedAt>maxDurationMs){discard(token,'INVALID_STAGE_CLOCK');return false;}
    item[field]=at;return true;
  }
  const analysisStarted=token=>stamp(token,'analysisStartedAt','receivedAt');
  const analysisFinished=token=>stamp(token,'analysisFinishedAt','analysisStartedAt');
  function observable(token){
    try{
      if(!isVisible()){discard(token,'HIDDEN');return false;}
      if(!isOnscreen()){discard(token,'OFFSCREEN');return false;}
    }catch{discard(token,'VISIBILITY_CHECK_FAILED');return false;}
    return true;
  }
  function rendered(token){
    const item=records.get(token);if(!item)return false;
    if(item.sequence<newestRenderedSequence){discard(token,'OUTDATED_RENDER');return false;}
    if(!stamp(token,'mutationAt','analysisFinishedAt'))return false;
    if(pending)discard(pending.token,'SUPERSEDED_RENDER');
    newestRenderedSequence=item.sequence;
    if(!observable(token))return false;
    const work={token,handles:[],firstPaintOpportunityAt:null};pending=work;
    const failSchedule=()=>{discard(token,'ANIMATION_CALLBACK_FAILED');};
    try{
      work.handles.push(requestAnimationFrame(()=>{
        if(pending!==work||!records.has(token)||!observable(token))return;
        const first=now();
        if(!finite(first)||first<item.mutationAt||first-item.receivedAt>maxDurationMs){discard(token,'INVALID_PAINT_CLOCK');return;}
        work.firstPaintOpportunityAt=first;
        try{
          work.handles.push(requestAnimationFrame(()=>{
            if(pending!==work||!records.has(token)||!observable(token))return;
            const second=now(),finishedWall=wallNow();
            if(!finite(second)||second<first||second-item.receivedAt>maxDurationMs){discard(token,'INVALID_PAINT_CLOCK');return;}
            let sourceReason=item.sourceUnavailableReason,sourceAge=item.providerToReceiptAgeMs;
            if(sourceAge!==null&&(!finite(finishedWall)||Math.abs((finishedWall-item.receivedAtWall)-(second-item.receivedAt))>wallClockToleranceMs)){
              sourceReason='RECEIVER_WALL_CLOCK_SHIFT';sourceAge=null;
            }
            const lower=first-item.receivedAt,upper=second-item.receivedAt;
            const sample={context:item.context,eventId:item.eventId,sequence:item.sequence,receivedAt:item.receivedAt,receivedAtWall:item.receivedAtWall,registrationAt:item.registrationAt,registrationAtWall:item.registrationAtWall,receiptTimestampOrigin:item.receiptTimestampOrigin,
              analysisStartedAt:item.analysisStartedAt,analysisFinishedAt:item.analysisFinishedAt,mutationAt:item.mutationAt,firstPaintOpportunityAt:first,secondPaintOpportunityAt:second,
              queueMs:item.analysisStartedAt-item.receivedAt,analysisMs:item.analysisFinishedAt-item.analysisStartedAt,analysisToMutationMs:item.mutationAt-item.analysisFinishedAt,
              receiptToMutationMs:item.mutationAt-item.receivedAt,receiptToPaintOpportunityLowerMs:lower,receiptToPaintOpportunityUpperMs:upper,
              sourceTimestamp:item.sourceTimestamp,sourceUnavailableReason:sourceReason,providerToReceiptAgeMs:sourceAge,
              sourceToPaintOpportunityLowerMs:sourceAge===null?null:sourceAge+lower,sourceToPaintOpportunityUpperMs:sourceAge===null?null:sourceAge+upper};
            records.delete(token);pending=null;completed++;
            if(sourceReason)count(sourceUnavailable,sourceReason);
            samples.push(sample);if(samples.length>maxSamples)samples.shift();
            try{onSample(copy(sample));}catch{}
          }));
        }catch{failSchedule();}
      }));
    }catch{failSchedule();return false;}
    return true;
  }
  function snapshot(){
    const metrics={};
    for(const key of ['queueMs','analysisMs','analysisToMutationMs','receiptToMutationMs','receiptToPaintOpportunityLowerMs','receiptToPaintOpportunityUpperMs','providerToReceiptAgeMs','sourceToPaintOpportunityLowerMs','sourceToPaintOpportunityUpperMs'])metrics[key]=summarize(samples.map(sample=>sample[key]));
    return {schemaVersion:1,kind:'LIVE_SIGNAL_RECEIPT_TO_PAINT_OPPORTUNITY',context,generation,lastResetReason,startedAtWall,
      scope:'Measured local receiving-panel stages from live-data receipt through analysis and the actual result DOM update to two browser animation-frame opportunities.',
      clock:'Local stage timestamps are relative to the receiving panel performance clock. An explicit earlier boundary requires paired local performance/Unix stamps with consistent elapsed time. Provider age requires an explicitly synchronized Unix clock and an emission/exchange-event timestamp.',
      paintMethod:'Caller invokes rendered(token) immediately after the actual DOM result update; two requestAnimationFrame callbacks mark browser rendering opportunities.',
      physicalDisplayMeasured:false,captureToDisplayMeasured:false,marketToDisplayMeasured:false,
      received,completed,retainedSamples:samples.length,pending:records.size,discarded:{...discarded},sourceUnavailable:{...sourceUnavailable},metrics,samples:copy(samples),
      limitations:['Animation-frame callbacks do not prove physical pixel presentation.','A local receipt timestamp does not measure network, exchange or screen-capture latency.','OHLC bar-open/bar-close times are not provider emission times.','Source-to-paint values are conditional on the supplied clock synchronization and timestamp meaning, not an independently verified exchange measurement.','Hidden, offscreen, superseded, expired and context-mismatched render work is excluded.']};
  }
  return {receive,analysisStarted,analysisFinished,rendered,discard,reset,snapshot};
}
