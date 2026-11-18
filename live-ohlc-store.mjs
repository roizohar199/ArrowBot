// Provider-neutral live OHLC intake. This module performs no network, browser,
// trading or clock-based candle closure. The adapter owns provenance claims.
export const LIVE_OHLC_STORE_VERSION='live-ohlc-store-1';
import {declaredSessionGapMatches} from './session-gap-proof.mjs';
import {validateWindowClockGrant} from './live-window-clock.mjs';
const finite=Number.isFinite;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const fields=['provider','sourceId','instrument','timeframe','timezone','session'];
const identityFields=['source','provider','sourceId','tabId','sourceUrl','instrument','timeframe','timeframeMs','chartType','tickSize','pointValue','currency','timezone','session'];
const pricesEqual=(a,b)=>['time','closeTime','open','high','low','close','providerBarIndex','sessionFirst','sessionLast'].every(key=>a[key]===b[key]);
const firstAvailabilityFields=['knownAt','availableAt','receivedAt','localAvailableAt'];
const sameFinalContent=(previous,bar)=>previous?.closed===true&&previous.finalOhlcVerified===true&&previous.closureProvenance==='explicit_provider_close'
  &&pricesEqual(previous,bar)&&['volume','providerKnownAt'].every(key=>Object.hasOwn(previous,key)===Object.hasOwn(bar,key)&&previous[key]===bar[key]);
function retainRecoveryAvailability(rows,previousRows,{receivedAt,intakeAt,decisionAt}){
  const previousByTime=new Map(previousRows.map(bar=>[bar.time,bar]));let knownAt=-Infinity,availableAt=-Infinity;
  return rows.map(incoming=>{
    const bar=copy(incoming),previous=previousByTime.get(bar.time);
    // Only our earlier explicit final observation can supply availability.
    // Provider knownAt values and matching prices alone cannot backdate it.
    if(sameFinalContent(previous,bar)&&firstAvailabilityFields.every(key=>finite(previous[key])&&previous[key]>=0)
      &&previous.knownAt>=previous.closeTime&&previous.availableAt>=previous.closeTime
      &&previous.knownAt<=decisionAt&&previous.availableAt<=decisionAt&&previous.receivedAt<=receivedAt&&previous.localAvailableAt<=intakeAt){
      for(const key of firstAvailabilityFields)bar[key]=previous[key];
    }
    // Newly learned/corrected older rows cannot make later rows appear known
    // earlier than that prefix. Original receipt timestamps remain factual.
    knownAt=Math.max(knownAt,bar.knownAt);availableAt=Math.max(availableAt,bar.availableAt);
    bar.knownAt=knownAt;bar.availableAt=availableAt;return bar;
  });
}
function validateMetadata(value){
  if(!plain(value)||value.source!=='ohlc'||fields.some(key=>typeof value[key]!=='string'||!value[key].trim())||!Number.isSafeInteger(value.tabId)||value.tabId<0)return 'SOURCE_PROVENANCE_REQUIRED';
  if(!['standard','candles'].includes(value.chartType))return 'STANDARD_CANDLES_REQUIRED';
  if(!Number.isSafeInteger(value.timeframeMs)||value.timeframeMs<1||!finite(value.tickSize)||value.tickSize<=0)return 'INVALID_INSTRUMENT_METADATA';
  if(value.pointValue!==undefined&&(!finite(value.pointValue)||value.pointValue<=0))return 'INVALID_INSTRUMENT_METADATA';
  if(value.currency!==undefined&&(typeof value.currency!=='string'||!value.currency.length||value.currency.length>20||/[\u0000-\u001f]/.test(value.currency)))return 'INVALID_INSTRUMENT_METADATA';
  for(const key of ['realtime','replay'])if(value[key]!==undefined&&typeof value[key]!=='boolean')return 'INVALID_LIVE_STATUS';
  try{new Intl.DateTimeFormat('en',{timeZone:value.timezone});}catch{return 'INVALID_TIMEZONE';}
  if(value.sessionGaps!==undefined&&(!Array.isArray(value.sessionGaps)||value.sessionGaps.length>600||value.sessionGaps.some(g=>!plain(g)||g.kind!=='market_closed'||!finite(g.from)||!finite(g.to)||g.to<=g.from)))return 'INVALID_SESSION_GAPS';
  return null;
}
function normalizedBar(value,metadata,receivedAt,intakeAt,decisionAt,availabilityClock){
  if(!plain(value)||!['time','closeTime','open','high','low','close'].every(key=>finite(value[key]))||typeof value.closed!=='boolean')return {error:'INVALID_BAR'};
  if(!Number.isSafeInteger(value.time)||!Number.isSafeInteger(value.closeTime)||value.time<0||value.closeTime-value.time!==metadata.timeframeMs)return {error:'INVALID_BAR_TIMES'};
  if(value.high<Math.max(value.open,value.close)||value.low>Math.min(value.open,value.close)||value.high<value.low)return {error:'INVALID_OHLC'};
  if(value.chartType!==undefined&&!['standard','candles'].includes(value.chartType))return {error:'STANDARD_CANDLES_REQUIRED'};
  if(value.volume!==undefined&&value.volume!==null&&(!finite(value.volume)||value.volume<0))return {error:'INVALID_VOLUME'};
  if(value.time>decisionAt||value.closed&&value.closeTime>decisionAt)return {error:'FUTURE_BAR_DATA'};
  if(value.knownAt!==undefined&&(!finite(value.knownAt)||value.knownAt<value.closeTime))return {error:'INVALID_PROVIDER_KNOWN_AT'};
  const bar={time:value.time,closeTime:value.closeTime,open:value.open,high:value.high,low:value.low,close:value.close,closed:value.closed,chartType:'standard',receivedAt,localAvailableAt:intakeAt,availableAt:decisionAt,availabilityClock};
  if(value.volume!==undefined)bar.volume=value.volume;
  if(['providerBarIndex','sessionFirst','sessionLast'].some(key=>Object.hasOwn(value,key))){
    if(!Number.isSafeInteger(value.providerBarIndex)||value.providerBarIndex<0||typeof value.sessionFirst!=='boolean'||typeof value.sessionLast!=='boolean')return {error:'INVALID_PROVIDER_BAR_PROOF'};
    Object.assign(bar,{providerBarIndex:value.providerBarIndex,sessionFirst:value.sessionFirst,sessionLast:value.sessionLast});
  }
  if(value.knownAt!==undefined)bar.providerKnownAt=value.knownAt;
  if(value.closed)Object.assign(bar,{knownAt:Math.max(value.closeTime,decisionAt),closureProvenance:'explicit_provider_close',finalOhlcVerified:true});
  return {bar};
}
const gapDeclared=(metadata,previous,next)=>(metadata.sessionGaps??[]).some(g=>g.from===previous.closeTime&&g.to===next.time&&g.kind==='market_closed'&&(g.basis===undefined||declaredSessionGapMatches(g,previous,next)));
function retainedSessionGaps(incoming,existing,bars){
  const candidates=[...(incoming??[]),...(existing??[])];
  return bars.flatMap((bar,index)=>{
    if(index===0||bar.time===bars[index-1].closeTime)return [];
    const previous=bars[index-1],gap=candidates.find(item=>item.from===previous.closeTime&&item.to===bar.time&&item.kind==='market_closed'&&(item.basis===undefined||declaredSessionGapMatches(item,previous,bar)));
    return gap?[copy(gap)]:[];
  });
}
const liveReasons=metadata=>metadata?.replay===true?['REPLAY_SOURCE']:metadata?.realtime!==true||metadata?.replay!==false?['LIVE_STATUS_UNVERIFIED']:[];

export function createLiveOhlcStore({maxBars=600,minClosedBars=3,staleAfterMs=15000,maxLiveCloseLagMs=15000,maxSourceClockOffsetMs=3000,now=Date.now}={}){
  if(!Number.isSafeInteger(maxBars)||maxBars<3||maxBars>600||!Number.isSafeInteger(minClosedBars)||minClosedBars<1||minClosedBars>maxBars||!finite(staleAfterMs)||staleAfterMs<=0||!finite(maxLiveCloseLagMs)||maxLiveCloseLagMs<0||!finite(maxSourceClockOffsetMs)||maxSourceClockOffsetMs<0||maxSourceClockOffsetMs>5000||typeof now!=='function')throw TypeError('INVALID_LIVE_STORE_CONFIGURATION');
  let metadata=null,binding=null,closed=[],current=null,generation=0,bootstrapAt=null,bootstrapAsOfTime=null,lastReceivedAt=null,lastIntakeAt=null,lastSourceAsOfTime=null,lastSourceAdvanceReceivedAt=null,availabilityClock='receiver_wall',requiresSnapshot=true,connected=false,blockedReason=null,evictedClosedBars=0,contextOnlyBaseline=false,lastSourceClockCorrelation=null;
  const bind=value=>JSON.stringify(identityFields.map(key=>value[key]));
  function clear(reason='RESET'){
    metadata=null;binding=null;closed=[];current=null;generation++;bootstrapAt=null;bootstrapAsOfTime=null;lastReceivedAt=null;lastIntakeAt=null;lastSourceAsOfTime=null;lastSourceAdvanceReceivedAt=null;availabilityClock='receiver_wall';requiresSnapshot=true;connected=false;blockedReason=reason;evictedClosedBars=0;contextOnlyBaseline=false;lastSourceClockCorrelation=null;
  }
  function view(at=now()){
    if(!finite(at))throw TypeError('INVALID_LIVE_STORE_CLOCK');
    const stale=lastReceivedAt!==null&&(at<lastReceivedAt||at-lastReceivedAt>staleAfterMs),producerStale=lastSourceAdvanceReceivedAt!==null&&at-lastSourceAdvanceReceivedAt>staleAfterMs,unverified=closed.some(bar=>!bar.finalOhlcVerified),reasonCodes=[];
    if(blockedReason)reasonCodes.push(blockedReason);
    if(stale)reasonCodes.push(at<lastReceivedAt?'CLOCK_WENT_BACKWARD':'FEED_STALE');
    if(producerStale)reasonCodes.push('PRODUCER_CLOCK_STALE');
    if(unverified)reasonCodes.push('FINAL_OHLC_NOT_VERIFIED');
    if(contextOnlyBaseline)reasonCodes.push('CONTEXT_BASELINE_REQUIRES_FRESH_SNAPSHOT');
    if(closed.length<minClosedBars)reasonCodes.push('HISTORY_WARMUP');
    const latest=current??closed.at(-1),decisionAt=lastSourceAsOfTime??lastIntakeAt,sourceBarAgeAtReceipt=latest&&finite(decisionAt)?decisionAt-latest.closeTime:null,sourceBarStale=sourceBarAgeAtReceipt!==null&&sourceBarAgeAtReceipt+Math.max(0,at-(lastReceivedAt??at))>maxLiveCloseLagMs;
    const ready=connected&&!requiresSnapshot&&!stale&&!producerStale&&!unverified&&!contextOnlyBaseline&&closed.length>=minClosedBars;
    const liveReasonCodes=[...liveReasons(metadata),...(sourceBarStale?['SOURCE_BAR_TOO_OLD']:[])];
    return {version:LIVE_OHLC_STORE_VERSION,status:requiresSnapshot?(metadata?'BLOCKED':'EMPTY'):!connected?'DISCONNECTED':contextOnlyBaseline?'CONTEXT_READY':stale||producerStale?'STALE':ready?'READY':'WARMING',ready,liveEligible:ready&&liveReasonCodes.length===0,contextOnly:contextOnlyBaseline,
      reasonCodes:[...new Set(reasonCodes)],liveReasonCodes,generation,metadata:copy(metadata),bars:copy(closed),current:copy(current),bootstrapAt,bootstrapAsOfTime,lastReceivedAt,lastIntakeAt,sourceDecisionTime:lastSourceAsOfTime,decisionAsOfTime:decisionAt,availabilityClock,sourceClockCorrelation:copy(lastSourceClockCorrelation),producerStale,sourceBarAgeAtReceipt,requiresSnapshot,connected,stale,evictedClosedBars,orderEligible:false};
  }
  function fail(reason,at){
    requiresSnapshot=true;connected=false;blockedReason=reason;
    return {...view(at),accepted:false,changed:false,bootstrap:false,newlyClosed:[],eligibleNewlyClosed:[],eligibleCloseTimes:[]};
  }
  function ingest(packet,{intakeAt,sourceAsOfTime,windowClockGrant}={}){
    const receivedAt=packet?.receivedAt??now();
    if(intakeAt===undefined)intakeAt=receivedAt;
    if(!finite(receivedAt)||receivedAt<0)return fail('INVALID_RECEIPT_TIME',finite(lastReceivedAt)?lastReceivedAt:0);
    const wallNow=now();
    if(!finite(intakeAt)||intakeAt<receivedAt||!finite(wallNow)||intakeAt>wallNow)return fail('INVALID_INTAKE_TIME',finite(wallNow)?wallNow:receivedAt);
    const producerMode=sourceAsOfTime!==undefined,decisionAt=producerMode?sourceAsOfTime:intakeAt,nextClock=producerMode?'pine_source_execution_unverified_sync':'receiver_wall';
    const contextOnly=packet?.bootstrapOnly===true;
    if(contextOnly&&(packet.kind!=='snapshot'||packet.realtime!==false))return fail('INVALID_CONTEXT_BASELINE_SCOPE',intakeAt);
    if(producerMode&&(!Number.isSafeInteger(sourceAsOfTime)||sourceAsOfTime<0||sourceAsOfTime!==packet?.sourceEmittedAt))return fail('INVALID_SOURCE_DECISION_TIME',intakeAt);
    // Old, validated history can restore context without claiming currentness.
    // Future clocks retain exactly the same guard, and an ordinary update may
    // never turn this context baseline into a live source.
    const offsetExceeded=producerMode&&(sourceAsOfTime>receivedAt+maxSourceClockOffsetMs||!contextOnly&&receivedAt-sourceAsOfTime>maxSourceClockOffsetMs);
    const clockCorrelation=offsetExceeded&&!contextOnly&&sourceAsOfTime>receivedAt?validateWindowClockGrant(windowClockGrant,{packet,receivedAt,now:wallNow}):null;
    if(offsetExceeded&&clockCorrelation?.ok!==true)return fail('SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED',intakeAt);
    if(!plain(packet)||!['snapshot','update'].includes(packet.kind))return fail('INVALID_PACKET',receivedAt);
    const metadataError=validateMetadata(packet.metadata);if(metadataError)return fail(metadataError,receivedAt);
    if(!Array.isArray(packet.bars)||!packet.bars.length||packet.bars.length>maxBars+1)return fail('BAR_COUNT_LIMIT',receivedAt);
    const rows=[];
    for(let i=0;i<packet.bars.length;i++){
      const normalized=normalizedBar(packet.bars[i],packet.metadata,receivedAt,intakeAt,decisionAt,nextClock);if(normalized.error)return fail(normalized.error,intakeAt);
      const bar=normalized.bar,previous=rows.at(-1);
      if(previous&&(bar.time<previous.closeTime||!previous.closed))return fail('INVALID_BAR_ORDER',receivedAt);
      if(previous&&Number.isSafeInteger(previous.providerBarIndex)&&Number.isSafeInteger(bar.providerBarIndex)&&bar.providerBarIndex!==previous.providerBarIndex+1)return fail('PROVIDER_BAR_INDEX_GAP',receivedAt);
      if(previous&&bar.time>previous.closeTime&&!gapDeclared(packet.metadata,previous,bar))return fail('UNDECLARED_DATA_GAP',receivedAt);
      if(!bar.closed&&i!==packet.bars.length-1)return fail('OPEN_INTERIOR_BAR',receivedAt);
      rows.push(bar);
    }
    const nextBinding=bind(packet.metadata),sourceChanged=binding!==null&&binding!==nextBinding;
    if(!sourceChanged&&producerMode&&lastSourceAsOfTime!==null&&sourceAsOfTime<lastSourceAsOfTime)return fail('PRODUCER_CLOCK_WENT_BACKWARD',intakeAt);
    if(binding!==null&&!sourceChanged&&availabilityClock!==nextClock&&packet.kind!=='snapshot')return fail('AVAILABILITY_CLOCK_CHANGED',intakeAt);
    if(packet.kind==='snapshot'){
      // Every snapshot is a fresh baseline; no historical close is announced.
      let seeded=rows.filter(bar=>bar.closed);if(seeded.length>maxBars)return fail('BAR_COUNT_LIMIT',receivedAt);
      if(requiresSnapshot&&binding!==null&&!sourceChanged&&availabilityClock===nextClock)seeded=retainRecoveryAvailability(seeded,closed,{receivedAt,intakeAt,decisionAt});
      generation++;metadata={...copy(packet.metadata),availabilityClock:nextClock};binding=nextBinding;closed=seeded;current=rows.at(-1).closed?null:rows.at(-1);bootstrapAt=intakeAt;bootstrapAsOfTime=decisionAt;lastReceivedAt=receivedAt;lastIntakeAt=intakeAt;lastSourceAsOfTime=producerMode?sourceAsOfTime:null;lastSourceAdvanceReceivedAt=producerMode?receivedAt:null;availabilityClock=nextClock;requiresSnapshot=false;connected=true;blockedReason=null;evictedClosedBars=0;contextOnlyBaseline=contextOnly;
      lastSourceClockCorrelation=clockCorrelation?.ok?copy(clockCorrelation):null;
      const result=view(intakeAt);
      return {...result,accepted:true,changed:true,bootstrap:true,reasonCodes:[...result.reasonCodes,...(sourceChanged?['SOURCE_CHANGED']:[]),'HISTORICAL_BOOTSTRAP_NO_ALERT'],newlyClosed:[],eligibleNewlyClosed:[],eligibleCloseTimes:[]};
    }
    if(sourceChanged){clear('SOURCE_CHANGED');return fail('SOURCE_CHANGED',receivedAt);}
    if(contextOnlyBaseline)return fail('CONTEXT_BASELINE_REQUIRES_FRESH_SNAPSHOT',intakeAt);
    if(requiresSnapshot||binding===null)return fail('SNAPSHOT_REQUIRED',receivedAt);
    if(lastReceivedAt!==null&&receivedAt<lastReceivedAt)return fail('RECEIPT_TIME_WENT_BACKWARD',receivedAt);
    if(lastIntakeAt!==null&&intakeAt<lastIntakeAt)return fail('INTAKE_TIME_WENT_BACKWARD',intakeAt);
    if(lastReceivedAt!==null&&receivedAt-lastReceivedAt>staleAfterMs)return fail('RECONNECT_SNAPSHOT_REQUIRED',receivedAt);
    // Work on copies so a bad later row cannot partially apply an earlier row.
    const nextClosed=copy(closed),byTime=new Map(nextClosed.map(bar=>[bar.time,bar]));let nextCurrent=copy(current),changed=false;
    const newlyClosed=[],verifiedNow=[];
    for(const bar of rows){
      const previousClosed=byTime.get(bar.time);
      if(previousClosed){
        if(!bar.closed)return fail('CLOSED_BAR_REOPENED',receivedAt);
        if(previousClosed.finalOhlcVerified){
          if(!pricesEqual(previousClosed,bar)||bar.volume!==undefined&&previousClosed.volume!==undefined&&bar.volume!==previousClosed.volume)return fail('CLOSED_BAR_CORRECTION',receivedAt);
          continue;
        }
        // A next-bar boundary alone was never eligible. Provider-final values
        // may verify this pending row before it enters any confirmed alert.
        if(nextClosed.some(later=>later.time>bar.time&&later.knownAt<decisionAt))return fail('LATE_FINAL_VERIFICATION',intakeAt);
        Object.assign(previousClosed,bar);changed=true;newlyClosed.push(copy(previousClosed));verifiedNow.push(previousClosed);continue;
      }
      const first=nextClosed[0];if(first&&bar.time<first.time)return fail('OUTSIDE_RETAINED_HISTORY',receivedAt);
      const last=nextClosed.at(-1);
      if(last&&bar.time<last.closeTime)return fail('INVALID_BAR_ORDER',receivedAt);
      if(nextCurrent){
        if(bar.time<nextCurrent.time)return fail('LATE_OPEN_BAR',receivedAt);
        if(bar.time===nextCurrent.time){
          if(!bar.closed){if(!pricesEqual(nextCurrent,bar)||nextCurrent.volume!==bar.volume)changed=true;nextCurrent=bar;continue;}
          nextCurrent=null;
        }else{
          if(bar.time!==nextCurrent.closeTime)return fail('NEXT_BAR_NOT_CONTIGUOUS',receivedAt);
          if(nextCurrent.closeTime>decisionAt)return fail('FUTURE_BAR_DATA',intakeAt);
          const inferred={...nextCurrent,closed:true,knownAt:Math.max(nextCurrent.closeTime,decisionAt),receivedAt,localAvailableAt:intakeAt,availableAt:decisionAt,availabilityClock:nextClock,closureProvenance:'observed_next_contiguous_bar',finalOhlcVerified:false};
          nextClosed.push(inferred);byTime.set(inferred.time,inferred);newlyClosed.push(copy(inferred));nextCurrent=null;changed=true;
        }
      }
      const tail=nextClosed.at(-1);
      if(tail&&Number.isSafeInteger(tail.providerBarIndex)&&Number.isSafeInteger(bar.providerBarIndex)&&bar.providerBarIndex!==tail.providerBarIndex+1)return fail('PROVIDER_BAR_INDEX_GAP',receivedAt);
      if(tail&&bar.time>tail.closeTime&&!gapDeclared(packet.metadata,tail,bar))return fail('UNDECLARED_DATA_GAP',receivedAt);
      if(bar.closed){nextClosed.push(bar);byTime.set(bar.time,bar);newlyClosed.push(copy(bar));verifiedNow.push(bar);changed=true;}
      else{nextCurrent=bar;changed=true;}
    }
    let evicted=0;while(nextClosed.length>maxBars){nextClosed.shift();evicted++;}
    const gapMetadata=packet.metadata.sessionGaps!==undefined||metadata?.sessionGaps!==undefined?{sessionGaps:retainedSessionGaps(packet.metadata.sessionGaps,metadata?.sessionGaps,[...nextClosed,...(nextCurrent?[nextCurrent]:[])])}:{};
    closed=nextClosed;current=nextCurrent;metadata={...copy(packet.metadata),...gapMetadata,availabilityClock:nextClock};lastReceivedAt=receivedAt;lastIntakeAt=intakeAt;
    if(producerMode&&(lastSourceAsOfTime===null||sourceAsOfTime>lastSourceAsOfTime))lastSourceAdvanceReceivedAt=receivedAt;
    lastSourceAsOfTime=producerMode?sourceAsOfTime:null;availabilityClock=nextClock;connected=true;blockedReason=null;evictedClosedBars+=evicted;
    lastSourceClockCorrelation=clockCorrelation?.ok?copy(clockCorrelation):null;
    const result=view(intakeAt),eligible=result.liveEligible?verifiedNow.filter(bar=>bar.knownAt>bootstrapAsOfTime&&decisionAt-bar.closeTime<=maxLiveCloseLagMs):[];
    const skippedOld=verifiedNow.some(bar=>decisionAt-bar.closeTime>maxLiveCloseLagMs);
    return {...result,accepted:true,changed,bootstrap:false,reasonCodes:[...result.reasonCodes,...(evicted?['HISTORY_WINDOW_ADVANCED']:[]),...(skippedOld?['LIVE_CLOSE_TOO_OLD']:[])],newlyClosed:copy(newlyClosed),eligibleNewlyClosed:copy(eligible),eligibleCloseTimes:eligible.map(bar=>bar.closeTime)};
  }
  return {ingest,snapshot:view,reset(reason='RESET'){clear(String(reason).slice(0,120));return view();},
    quarantine(reason='SOURCE_REVALIDATION_REQUIRED'){generation++;requiresSnapshot=true;connected=false;current=null;bootstrapAt=null;bootstrapAsOfTime=null;blockedReason=String(reason).slice(0,120);return view();},
    disconnect(reason='FEED_DISCONNECTED'){requiresSnapshot=true;connected=false;blockedReason=String(reason).slice(0,120);return view();}};
}
