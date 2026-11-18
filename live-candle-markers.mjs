import {buildTechnicalCandleMarkerPayload,formatLiveDirectionMarkerPayload,verifyNativeCandleMarkerFields,LIVE_DIRECTION_MARKER_LIMITS} from './candle-marker-payload.mjs';
import {nativeCandleMarkerUiCommand} from './candle-marker-ui.mjs';
import {chartFillListCommand} from './chart-fill-list.mjs';
import {collectFillMarkerProofs as collectEntryMarkerProofs,formatFillMarkerPayload as formatEntryMarkerPayload} from './fill-marker-payload.mjs';

const copy=x=>structuredClone(x),integer=Number.isSafeInteger,KEY='arrow.confirmed-candle-markers.v1',ENTRY_KEY='arrow.verified-fill-markers.v1';
const recordValid=r=>r?.approvalKind==='TECHNICAL'&&r.sourceMode==='LIVE'&&typeof r.eventId==='string'&&r.eventId.length>0&&r.eventId.length<=1024
  &&['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','priceTicks','directionCode','confirmedAt'].every(k=>integer(r[k]))&&r.time>=0&&r.closeTime-r.time===60000&&r.confirmedAt>=r.closeTime
  &&r.openTicks>0&&r.lowTicks>0&&r.highTicks>=Math.max(r.openTicks,r.closeTicks,r.lowTicks)&&r.lowTicks<=Math.min(r.openTicks,r.closeTicks,r.highTicks)&&r.priceTicks===r.closeTicks
  &&(r.direction==='LONG'?r.directionCode===1:r.direction==='SHORT'&&r.directionCode===-1)&&typeof r.liveApproved==='boolean'
  &&!['riskPlan','quantity','riskMicros','synthetic','testOnly'].some(k=>Object.hasOwn(r,k));

export function mergeConfirmedMarkerHistory(payload,cached=[],bars=[]){
  if(!['READY','EMPTY'].includes(payload?.status)||payload.schemaVersion!==3)return payload;
  const byTime=new Map(),conflicts=new Set(),nativeHorizon=payload.asOfTime-86400000,known=new Map(bars.map(b=>[b.time,b]));
  for(const r of [...(Array.isArray(cached)?cached:[]),...payload.records]){
    if(!recordValid(r)||r.time<nativeHorizon||r.confirmedAt>(payload.analysisAsOfTime??payload.asOfTime)||r.closeTime>payload.asOfTime)continue;
    const bar=known.get(r.time);if(bar&&['open','high','low','close'].some(k=>bar[k]/.25!==r[k+'Ticks']))continue;
    const prior=byTime.get(r.time);
    if(prior&&(prior.direction!==r.direction||['openTicks','highTicks','lowTicks','closeTicks'].some(k=>prior[k]!==r[k]))){conflicts.add(r.time);continue;}
    byTime.set(r.time,copy(prior?.liveApproved===true&&r.liveApproved!==true?prior:{...r,liveApproved:r.liveApproved===true||prior?.liveApproved===true}));
  }
  const records=[...byTime.values()].filter(r=>!conflicts.has(r.time)).sort((a,b)=>a.time-b.time).slice(-LIVE_DIRECTION_MARKER_LIMITS.maxMarkers);
  return formatLiveDirectionMarkerPayload(payload,records,{retentionLimit:LIVE_DIRECTION_MARKER_LIMITS.maxMarkers,accountIndependent:true});
}

// Presentation only. Historical records are never passed into an execution
// controller. UI work is serialized behind any native entry/verification.
export function createLiveCandleMarkers({execute,getContext,runUi=fn=>fn(),storage,onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,entryDisplay=false,interactiveFillList=false}={}){
  let disposed=false,busy=false,timer=null,version=0,pending=null,lastKey=null,verifiedKey=null,cache={},entryCache={},lastPayload=null,lastInput=null;
  let state={status:'WAITING_SOURCE',reasonCodes:[],receipt:null,verification:null,ordersCreated:false,accountIndependent:true};
  const loaded=Promise.all([Promise.resolve(storage?.get?.(KEY)).then(value=>{const stored=value?.[KEY];if(stored?.version===1&&stored.recordsBySource&&typeof stored.recordsBySource==='object')cache=stored.recordsBySource;}),Promise.resolve(storage?.get?.(ENTRY_KEY)).then(value=>{if(value?.[ENTRY_KEY]?.version===1)entryCache=value[ENTRY_KEY].proofsByAccount??{};})]).catch(()=>{});
  const emit=()=>onChange(snapshot());
  const snapshot=()=>copy({...state,busy,payload:lastPayload,pending:!!pending});
  const validContext=c=>c?.active===true&&c.ready===true&&c.liveEligible===true&&integer(c.tabId)&&c.tabId>0&&c.sourceMode==='LIVE'&&typeof c.sourceUrl==='string'&&integer(c.runEpoch)&&c.runEpoch>1577836800000;
  const identity=c=>JSON.stringify([c.tabId,c.sourceUrl,c.runEpoch]);
  function schedule(ms=500){if(disposed||timer!==null)return;timer=setTimer(()=>{timer=null;void flush();},ms);}
  async function flush(){
    if(disposed||busy||!pending)return;const current=getContext();if(!validContext(current)){state={...state,status:'WAITING_SOURCE'};emit();schedule(1000);return;}
    if(identity(current)!==pending.identity){pending=null;return;}
    busy=true;const item=pending,token=version;
    try{
      const reply=await runUi(async()=>{
        if(disposed||version!==token||!validContext(getContext())||identity(getContext())!==item.identity)return {status:'STALE_MARKER_CONTEXT'};
        return execute(nativeCandleMarkerUiCommand,{action:'deliver',expected:{researchUrl:current.sourceUrl,instrument:item.payload.instrument,timeframe:'1',sourceMode:'LIVE',runEpoch:current.runEpoch,allowResearchLiveMultiChart:true,backgroundSync:true},payload:item.payload});
      });
      if(disposed||version!==token)return;
      if(reply?.status==='PRESENTATION_DEFERRED'){schedule(500);return;}
      const verification=verifyNativeCandleMarkerFields(item.payload,reply?.fields);
      state={...state,status:verification.verified?'VERIFIED':'BLOCKED',reasonCodes:verification.verified?[]:reply?.reasonCodes??verification.reasonCodes,receipt:copy(reply??null),verification};
      if(verification.verified){
        verifiedKey=item.key;if(pending===item)pending=null;
        if(interactiveFillList&&item.payload.schemaVersion===5&&validContext(getContext())&&identity(getContext())===item.identity){
          try{await execute(chartFillListCommand,{action:'show',expected:{researchUrl:current.sourceUrl,instrument:item.payload.instrument,runEpoch:current.runEpoch},textPayload:item.payload.textPayload});}catch{/* Native markers remain available if the companion list is unavailable. */}
        }
      }
      else schedule(15000);
    }catch(error){state={...state,status:'BLOCKED',reasonCodes:[String(error?.message??error).slice(0,160)]};schedule(15000);}
    finally{busy=false;emit();}
  }
  async function update(input){
    await loaded;if(disposed)return;const c=getContext();if(!validContext(c))return;
    lastInput=input;
    let payload=buildTechnicalCandleMarkerPayload({...input,sourceMode:'LIVE',displayPolicy:'LIVE_AND_HISTORICAL_TECHNICAL'});
    if(payload.status==='BLOCKED'){state={...state,status:'BLOCKED',reasonCodes:payload.reasonCodes};emit();return;}
    const sourceKey=payload.instrument+'|1',old=cache[sourceKey]?.records;
    payload=mergeConfirmedMarkerHistory(payload,old,input.bars);const researchPayload=payload;
    if(entryDisplay){const account=c.accountIdentity,accountKey=JSON.stringify([account?.provider,account?.environment,account?.nativeAccountId]),proofs=collectEntryMarkerProofs({execution:input.execution,records:payload.records,account,stored:entryCache[accountKey]??[]}).filter(p=>p.record.time>=payload.asOfTime-86400000&&p.record.closeTime<=payload.asOfTime);entryCache[accountKey]=proofs;payload=formatEntryMarkerPayload(payload,proofs);}
    const key=JSON.stringify([identity(c),payload.instrument,payload.schemaVersion,payload.records.map(r=>[r.time,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.liveApproved,r.entryFilled,r.fillTime,r.fillPriceTicks,r.fillUtcOffsetMinutes])]);
    if(key===lastKey&&(pending||verifiedKey===key))return;
    version++;lastKey=key;lastPayload=payload;pending={identity:identity(c),key,payload};state={...state,status:'PENDING',reasonCodes:[]};
    cache[sourceKey]={records:researchPayload.records,asOfTime:payload.asOfTime};
    // Cache is display-only and independent of account/session execution leases.
    try{await storage?.set?.({[KEY]:{version:1,recordsBySource:cache},...(entryDisplay?{[ENTRY_KEY]:{version:1,proofsByAccount:entryCache}}:{})});}catch{}
    emit();schedule();
  }
  async function acceptHistorical(result){
    await loaded;if(disposed||result?.kind!=='HISTORY24_RESEARCH_RESULT_V1'||result.status!=='COMPLETE'||result.ordersCreated!==false||result.orderEligible!==false||result.fillInferred!==false||!Array.isArray(result.signals))return;
    const rows=result.signals.filter(r=>r.historicalResearch===true&&r.liveApproved===false&&recordValid(r)),sourceKey='CME_MINI:NQ1!|1';
    const retain=r=>r.liveApproved===true||r.closeTime<=result.start||r.closeTime>result.end;
    cache[sourceKey]={records:[...(cache[sourceKey]?.records??[]).filter(retain),...rows].slice(-200),asOfTime:result.end};
    if(lastPayload&&!entryDisplay)lastPayload=formatLiveDirectionMarkerPayload(lastPayload,lastPayload.records.filter(retain));
    try{await storage?.set?.({[KEY]:{version:1,recordsBySource:cache}});}catch{}
    if(entryDisplay){if(lastInput)await update(lastInput);return;}
    if(lastPayload){const c=getContext();if(!validContext(c))return;const bound=Number.isSafeInteger(c.closedAsOfTime)&&result.end<=c.closedAsOfTime?Math.max(lastPayload.asOfTime,result.end):lastPayload.asOfTime;const payload=mergeConfirmedMarkerHistory({...lastPayload,asOfTime:bound,analysisAsOfTime:Math.max(lastPayload.analysisAsOfTime??0,bound)},cache[sourceKey].records);const key=JSON.stringify([identity(c),payload.instrument,payload.records.map(r=>[r.time,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.liveApproved])]);if(key!==lastKey){version++;lastKey=key;lastPayload=payload;pending={identity:identity(c),key,payload};state={...state,status:'PENDING'};emit();schedule();}}
  }
  return {update,acceptHistorical,flush,snapshot,dispose(){disposed=true;version++;if(timer!==null)clearTimer(timer);timer=null;pending=null;}};
}
