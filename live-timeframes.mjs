import {pineFixedTimeframeMs} from './pine-ohlc-protocol.mjs';
import {deriveVerifiedSessionGaps,verifiedSessionGap} from './session-gap-proof.mjs';

export const DEFAULT_LIVE_HIGHER_TIMEFRAMES=Object.freeze(['5','15']);
export const LIVE_TIMEFRAME_DEFAULTS=Object.freeze({maxBars:600,minBars:20});
const finite=Number.isFinite,integer=Number.isSafeInteger;
const clone=value=>structuredClone(value),unique=list=>[...new Set(list)];
const identityKeys=['instrument','timeframe','timeframeMs','tickSize','pointValue','timezone','session','currency','chartType','tabId'];
const identityOf=packet=>JSON.stringify([packet.runId,...identityKeys.map(key=>packet.metadata?.[key]??null)]);
const barEqual=(a,b)=>['time','closeTime','open','high','low','close','volume','closed','sourceClosed','providerBarIndex','sessionFirst','sessionLast'].every(key=>(a[key]??null)===(b[key]??null));
const providerProofValid=bar=>!['providerBarIndex','sessionFirst','sessionLast'].some(key=>Object.hasOwn(bar,key))||integer(bar.providerBarIndex)&&bar.providerBarIndex>=0&&typeof bar.sessionFirst==='boolean'&&typeof bar.sessionLast==='boolean';

// A provider-confirmed series is kept separately from the base chart. We do
// not infer exchange/session bucket origins by rounding timestamps in UTC.
// Legacy sources that have no HTF packets stay explicitly unready.
export function createLiveTimeframes({timeframes=DEFAULT_LIVE_HIGHER_TIMEFRAMES,maxBars=600,minBars=20}={}){
  if(!Array.isArray(timeframes)||timeframes.length<1||timeframes.length>3||new Set(timeframes).size!==timeframes.length||timeframes.some(tf=>!pineFixedTimeframeMs(tf)))throw TypeError('INVALID_LIVE_HIGHER_TIMEFRAMES');
  if(!integer(maxBars)||maxBars<20||maxBars>600||!integer(minBars)||minBars<1||minBars>maxBars)throw TypeError('INVALID_LIVE_TIMEFRAME_LIMITS');
  const configured=[...timeframes],series=new Map();
  let identity=null,metadata=null,sourceId=null,lastSourceAt=null,lastObservedAt=null,resetReason='HIGHER_TIMEFRAME_NOT_SUPPLIED';
  function fresh(reason){for(const tf of configured)series.set(tf,{timeframe:tf,timeframeMs:pineFixedTimeframeMs(tf),bars:[],valid:false,lastSequence:0,lastSourceAt:null,reasonCodes:[reason],snapshotRequired:true});}
  fresh(resetReason);
  function reset(reason='HIGHER_TIMEFRAME_NOT_SUPPLIED'){
    identity=null;metadata=null;sourceId=null;lastSourceAt=null;lastObservedAt=null;resetReason=reason;fresh(reason);return snapshot();
  }
  function snapshot({asOfTime=lastObservedAt??lastSourceAt??Date.now(),includeBars=true}={}){
    if(!finite(asOfTime))throw TypeError('INVALID_LIVE_TIMEFRAME_AS_OF');
    if(typeof includeBars!=='boolean')throw TypeError('INVALID_LIVE_TIMEFRAME_INCLUDE_BARS');
    const entries=[],higherTimeframes={},reasonCodes=[];
    for(const tf of configured){
      const state=series.get(tf),duration=state.timeframeMs,available=state.bars.filter(bar=>bar.closeTime<=asOfTime&&bar.knownAt<=asOfTime);
      const reasons=[...state.reasonCodes];
      if(!metadata)reasons.push('HIGHER_TIMEFRAME_NOT_SUPPLIED');
      else if(duration<=metadata.timeframeMs)reasons.push('HIGHER_TIMEFRAME_MUST_EXCEED_BASE');
      if(available.length<minBars)reasons.push('HIGHER_TIMEFRAME_WARMUP');
      const ready=state.valid&&!!metadata&&duration>metadata.timeframeMs&&available.length>=minBars;
      const entry={timeframe:tf,timeframeMs:duration,status:ready?'READY':state.snapshotRequired?'SNAPSHOT_REQUIRED':'WARMUP',ready,closedBars:available.length,retainedBars:state.bars.length,minBars,lastKnownAt:available.at(-1)?.knownAt??null,lastCloseTime:available.at(-1)?.closeTime??null,lastSourceAt:state.lastSourceAt,reasonCodes:unique(reasons),volumeAvailable:available.length>0&&available.every(bar=>finite(bar.volume))};
      entries.push(entry);
      // Always expose every required TF, including an empty invalid series.
      // Omitting a missing TF would let the signal engine evaluate a subset.
      if(includeBars)higherTimeframes[tf]={timeframe:tf,timeframeMs:duration,bars:ready?clone(available):[],metadata:metadata?{...clone(metadata),timeframe:tf,timeframeMs:duration,source:'ohlc',provider:(metadata.provider??'TradingView Pine Logs')+' confirmed HTF',sourceId,sessionGaps:deriveVerifiedSessionGaps(available).gaps}:undefined,ready,reasonCodes:entry.reasonCodes};
      if(!ready)reasonCodes.push(...entry.reasonCodes.map(reason=>reason+':'+tf));
    }
    return {ready:entries.every(entry=>entry.ready),sourceId,baseTimeframe:metadata?.timeframe??null,asOfTime,series:entries,...(includeBars?{higherTimeframes}:{}),reasonCodes:unique(reasonCodes)};
  }
  function summary({asOfTime}={}){return snapshot({asOfTime,includeBars:false});}
  function result(ok,accepted,reasons=[],asOfTime,includeBars=true){return {...snapshot({asOfTime:asOfTime??lastObservedAt??lastSourceAt??Date.now(),includeBars}),ok,accepted,ingestReasonCodes:unique(reasons)};}
  function invalidate(state,reason){state.valid=false;state.snapshotRequired=true;state.reasonCodes=unique([...state.reasonCodes,reason]);}
  function ingest(packet,{observedAsOfTime=packet?.sourceEmittedAt,includeBars=true}={}){
    if(typeof includeBars!=='boolean')throw TypeError('INVALID_LIVE_TIMEFRAME_INCLUDE_BARS');
    const finish=(ok,accepted,reasons=[],asOfTime)=>result(ok,accepted,reasons,asOfTime,includeBars);
    if(!packet||!packet.metadata||typeof packet.runId!=='string'||!integer(packet.sequence)||packet.sequence<1||!integer(packet.sourceEmittedAt)||!integer(observedAsOfTime)||observedAsOfTime<packet.sourceEmittedAt)return finish(false,false,['INVALID_HIGHER_TIMEFRAME_PACKET']);
    const meta=packet.metadata;
    if(meta.source!=='ohlc'||meta.chartType!=='standard'||pineFixedTimeframeMs(meta.timeframe)!==meta.timeframeMs||!['tickSize','pointValue'].every(key=>finite(meta[key])&&meta[key]>0)||!['instrument','timezone','session'].every(key=>typeof meta[key]==='string'&&meta[key].length>0))return finish(false,false,['INVALID_HIGHER_TIMEFRAME_BASE_METADATA']);
    const nextIdentity=identityOf(packet);
    if(identity!==nextIdentity){
      const hadIdentity=identity!==null;fresh(hadIdentity?'HIGHER_TIMEFRAME_SOURCE_CHANGED':'HIGHER_TIMEFRAME_NOT_SUPPLIED');
      identity=nextIdentity;metadata=clone(meta);sourceId=packet.runId;lastSourceAt=null;lastObservedAt=null;
    }
    // Older retained bootstrap logs can be first observed together with a fresh
    // update. Availability is when THIS receiver could first know their data,
    // using the producer clock domain supplied by the current DOM read.
    const observed=Math.max(packet.sourceEmittedAt,observedAsOfTime);
    lastSourceAt=Math.max(lastSourceAt??0,packet.sourceEmittedAt);lastObservedAt=Math.max(lastObservedAt??0,observed);
    const isSnapshot=packet.kind==='timeframe_snapshot',isUpdate=packet.kind==='timeframe_update';
    if(!isSnapshot&&!isUpdate)return finish(true,false,[],observed);
    if(!Array.isArray(packet.higherTimeframes)||!packet.higherTimeframes.length||packet.higherTimeframes.length>3)return finish(false,false,['INVALID_HIGHER_TIMEFRAME_PACKET'],observed);
    let accepted=false;const ingestReasons=[];
    for(const incoming of packet.higherTimeframes){
      const state=series.get(incoming?.timeframe);if(!state){ingestReasons.push('UNCONFIGURED_HIGHER_TIMEFRAME');continue;}
      if(packet.sequence<=state.lastSequence)continue;
      if(state.lastSourceAt!==null&&packet.sourceEmittedAt<state.lastSourceAt){invalidate(state,'HIGHER_TIMEFRAME_CLOCK_REGRESSION');ingestReasons.push('HIGHER_TIMEFRAME_CLOCK_REGRESSION');continue;}
      state.lastSequence=packet.sequence;state.lastSourceAt=packet.sourceEmittedAt;
      if(incoming.timeframeMs!==state.timeframeMs||state.timeframeMs<=meta.timeframeMs){invalidate(state,'HIGHER_TIMEFRAME_MUST_EXCEED_BASE');ingestReasons.push('HIGHER_TIMEFRAME_MUST_EXCEED_BASE');continue;}
      if(!Array.isArray(incoming.bars)||incoming.bars.length<1){invalidate(state,(incoming.reasonCodes??[])[0]??'HIGHER_TIMEFRAME_NOT_SUPPLIED');ingestReasons.push(...state.reasonCodes);continue;}
      const rows=incoming.bars;
      if(rows.some((bar,index)=>!bar||!providerProofValid(bar)||index>0&&integer(bar.providerBarIndex)&&integer(rows[index-1].providerBarIndex)&&bar.providerBarIndex!==rows[index-1].providerBarIndex+1)){invalidate(state,'INVALID_HIGHER_TIMEFRAME_PROVIDER_PROOF');ingestReasons.push('INVALID_HIGHER_TIMEFRAME_PROVIDER_PROOF');continue;}
      if(rows.length>(isSnapshot?100:2)||rows.some((bar,index)=>!bar||!['open','high','low','close'].every(key=>finite(bar[key]))||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low||!integer(bar.time)||!integer(bar.closeTime)||bar.closeTime-bar.time!==state.timeframeMs||bar.closeTime>packet.sourceEmittedAt||bar.closed!==true||bar.sourceClosed!==true||Object.hasOwn(bar,'volume')&&bar.volume!==null&&(!finite(bar.volume)||bar.volume<0)||index>0&&bar.time<rows[index-1].closeTime)){
        invalidate(state,'INVALID_HIGHER_TIMEFRAME_BARS');ingestReasons.push('INVALID_HIGHER_TIMEFRAME_BARS');continue;
      }
      if(isUpdate&&state.snapshotRequired){ingestReasons.push('HIGHER_TIMEFRAME_SNAPSHOT_REQUIRED');continue;}
      let suffix=rows;
      const gaps=rows.flatMap((bar,index)=>index>0&&bar.time!==rows[index-1].closeTime&&!verifiedSessionGap(rows[index-1],bar)?[index]:[]);
      if(gaps.length){
        if(!isSnapshot){invalidate(state,'HIGHER_TIMEFRAME_DATA_GAP');ingestReasons.push('HIGHER_TIMEFRAME_DATA_GAP');continue;}
        suffix=rows.slice(gaps.at(-1));
      }
      const previous=new Map(state.bars.map(bar=>[bar.time,bar])),correction=suffix.some(bar=>previous.has(bar.time)&&!barEqual(previous.get(bar.time),bar));
      if(correction&&!isSnapshot){invalidate(state,'HIGHER_TIMEFRAME_CLOSED_BAR_CORRECTION');ingestReasons.push('HIGHER_TIMEFRAME_CLOSED_BAR_CORRECTION');continue;}
      // A healthy recovery snapshot merges with earlier verified bars and keeps
      // their first availability. A correction is a new nonactionable baseline.
      let combined=isSnapshot&&(state.snapshotRequired||correction||gaps.length)?[]:[...state.bars];
      const retainKnown=isSnapshot&&!correction;
      const map=new Map(combined.map(bar=>[bar.time,bar]));
      for(const bar of suffix){
        const existing=previous.get(bar.time),same=existing&&barEqual(existing,bar);
        map.set(bar.time,{...clone(bar),knownAt:same&&retainKnown?existing.knownAt:same&&!isSnapshot?existing.knownAt:observed,availableAt:same&&retainKnown?existing.availableAt:same&&!isSnapshot?existing.availableAt:observed,receivedAt:same?existing.receivedAt:packet.receivedAt??null,chartType:'standard'});
      }
      combined=[...map.values()].sort((a,b)=>a.time-b.time);
      // A snapshot may contain only the suffix after a session/data gap. Never
      // pretend that a discontinuity was an exchange closure without proof.
      let latestGap=-1;
      for(let i=1;i<combined.length;i++)if(combined[i].time!==combined[i-1].closeTime&&!verifiedSessionGap(combined[i-1],combined[i]))latestGap=i;
      if(latestGap>=0){
        if(!isSnapshot){invalidate(state,'HIGHER_TIMEFRAME_DATA_GAP');ingestReasons.push('HIGHER_TIMEFRAME_DATA_GAP');continue;}
        combined=combined.slice(latestGap);
      }
      // Late recovery of older bars must not make knownAt decrease through the
      // chronological series. Preserve the causal exclusion by moving later
      // availability forward, never by backdating the newly observed bars.
      let known=-Infinity;
      for(const bar of combined){bar.knownAt=Math.max(bar.knownAt,known);bar.availableAt=bar.knownAt;known=bar.knownAt;}
      state.bars=combined.slice(-maxBars);state.valid=true;state.snapshotRequired=false;state.reasonCodes=[];
      if(gaps.length||latestGap>=0)state.reasonCodes.push('HIGHER_TIMEFRAME_WARMUP_TRIMMED_AT_GAP');
      accepted=true;
    }
    return finish(ingestReasons.length===0,accepted,ingestReasons,observed);
  }
  return {ingest,snapshot,summary,reset};
}
