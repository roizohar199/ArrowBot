import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';
import {validateHistoryBar} from './history-24-core.mjs';
const equal=(a,b)=>['time','closeTime','open','high','low','close'].every(k=>a[k]===b[k]);
const copy=x=>structuredClone(x);
// The historical worker never delivers an execution signal. This model only
// supplies verified preceding OHLC context to a NEW ordinary live analysis.
export function createWarmupModel(){
  let pending=null,active=null,lastReason='NOT_PROCESSED';
  const scope=state=>JSON.stringify([state.generation,state.metadata?.sourceId,state.metadata?.tabId,state.metadata?.sourceUrl,state.metadata?.instrument,state.metadata?.timeframe]);
  // A fresh execution baseline does not erase when matching historical OHLC
  // became known. Keep that knowledge only for the exact same source contract;
  // merge() must still revalidate native overlap, closure and continuity.
  const identity=state=>JSON.stringify(['sourceId','tabId','sourceUrl','source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType','availabilityClock'].map(key=>state.metadata?.[key]??null));
  const snapshot=()=>({status:active?'ACTIVE':pending?'WAITING_SAFE_ACTIVATION':'NOT_READY',availableAt:active?.availableAt??null,activeScope:active?.scope??null,processedBars:pending?.result.processedBars??0,reason:lastReason,ordersCreated:false});
  function offer(value){
    if(value?.result?.kind!=='CHRONOLOGICAL_WARMUP_RESULT_V1'||value.result.status!=='COMPLETE'||value.result.processedBars!==3000||value.dataset?.complete!==true||value.dataset.series?.['1']?.length!==3000)throw TypeError('COMPLETE_CHRONOLOGICAL_WARMUP_REQUIRED');
    pending=copy(value);active=null;lastReason='WAITING_QUIET_MODEL_HANDOFF';return snapshot();
  }
  function merge(archived,live,duration,availableAt,limit){
    if(!Array.isArray(archived)||!Array.isArray(live)||!live.length)throw Error('WARMUP_LIVE_OVERLAP_REQUIRED');
    const old=new Map(archived.map(b=>[b.time,b])),common=live.filter(b=>old.has(b.time));
    if(!common.length||common.some(b=>!equal(b,old.get(b.time))))throw Error('WARMUP_NATIVE_OVERLAP_CONFLICT');
    const shifts=new Set(common.map(b=>old.get(b.time).providerBarIndex-b.providerBarIndex));if(shifts.size!==1)throw Error('WARMUP_INDEX_ALIGNMENT_REQUIRED');
    const shift=[...shifts][0],map=new Map(archived.map(b=>[b.time,copy(b)]));
    for(const b of live){
      // Base store retains finalOhlcVerified; confirmed HTF store retains
      // sourceClosed. Normalize these existing proofs without manufacturing
      // either a closure from no proof, or overriding an explicit rejection.
      if(b.closed!==true||b.sourceClosed===false||b.finalOhlcVerified===false||b.sourceClosed!==true&&b.finalOhlcVerified!==true)throw Error('WARMUP_EXPLICIT_LIVE_CLOSE_PROOF_REQUIRED');
      map.set(b.time,{...copy(b),sourceClosed:true,finalOhlcVerified:true,originalProviderBarIndex:b.providerBarIndex,providerBarIndex:b.providerBarIndex+shift});
    }
    const end=live.at(-1).closeTime,rows=[...map.values()].filter(b=>b.closeTime<=end).sort((a,b)=>a.time-b.time).slice(-limit);
    if(rows.some(b=>!validateHistoryBar(b,duration)))throw Error('WARMUP_INVALID_MODEL_ROWS');
    const gaps=deriveVerifiedSessionGaps(rows);if(!gaps.valid)throw Error(gaps.reasonCodes[0]);
    let known=availableAt;for(const b of rows){b.originalKnownAt=b.knownAt??b.observedAt??null;b.knownAt=Math.max(b.closeTime,b.knownAt??0,availableAt,known);known=b.knownAt;b.availabilityPolicy='HISTORICAL_BACKFILL_AVAILABLE_AT_MODEL_ACTIVATION_NOT_AT_PAST_CLOSE';}
    return {rows,gaps:gaps.gaps};
  }
  function prepare({state,higherTimeframes,canActivate=false}={}){
    if(!pending)return null;
    if(!state?.ready||!state.liveEligible||state.stale||state.requiresSnapshot||!Number.isFinite(state.decisionAsOfTime))return null;
    const revalidating=active&&active.scope!==scope(state);
    if(revalidating&&active.identity!==identity(state)){active=null;lastReason='LIVE_SOURCE_REVALIDATION_REQUIRED';}
    if(revalidating&&active&&!canActivate){lastReason='WAITING_SAFE_SAME_SOURCE_REVALIDATION';return null;}
    if(!active&&!canActivate)return null;
    const availableAt=active?.availableAt??state.decisionAsOfTime;
    try{
      const previous=active?.series??pending.dataset.series;
      const base=merge(previous['1'],state.bars,60000,availableAt,3000);
      if(base.rows.length!==3000)throw Error('EXACT_3000_MODEL_ROWS_REQUIRED');
      const higher={};for(const tf of ['5','15']){
        const value=merge(previous[tf],higherTimeframes?.[tf]?.bars,Number(tf)*60000,availableAt,1000);
        higher[tf]={...copy(higherTimeframes[tf]),bars:value.rows,metadata:{...copy(higherTimeframes[tf].metadata),sessionGaps:value.gaps},sessionGaps:value.gaps};
      }
      active={scope:scope(state),identity:identity(state),availableAt,series:{'1':base.rows,'5':higher['5'].bars,'15':higher['15'].bars}};lastReason='FULL_3000_CAUSAL_CONTEXT_ACTIVE';
      return {bars:base.rows,higherTimeframes:higher,metadata:{...copy(state.metadata),sessionGaps:base.gaps},bootstrapAsOfTime:Math.max(state.bootstrapAsOfTime??0,active.availableAt),activation:snapshot()};
    }catch(error){lastReason=String(error?.message??error);active=null;return null;}
  }
  return {offer,prepare,snapshot,clear(){pending=null;active=null;lastReason='NOT_PROCESSED';}};
}
