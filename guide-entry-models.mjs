import {planGuideRisk,roundGuidePriceToTick} from './guide-risk.mjs';

// These are counterfactual research candidates. Reaching a price in OHLC is
// never promoted to an order, a fill, an intrabar sequence or live approval.
export const GUIDE_ENTRY_DEFINITION_VERSION='guide-entry-models-1';
const finite=Number.isFinite,integer=Number.isSafeInteger;
const definitions=[
  ['LATER_CLOSE_CONFIRMATION','אישור בסגירת נר מאוחר','4.3',[333,347]],
  ['MARKET_AFTER_SIGNAL_CLOSE','כניסת שוק לאחר סגירת האיתות','4.4',[343,347]],
  ['BREAKOUT_STOP','תכנון Stop בפריצת קצה הנר','4.4',[343,347]],
  ['RETEST_LIMIT','תכנון Limit בחזרה לטווח האיתות','4.4',[343,347]],
];

export function describeGuideEntryModels(event,{bars=[],metadata={},risk=null,asOfTime=Date.now()}={}){
  const config=event?.parameterSnapshot?.config??{},side=event?.direction,createdAt=event?.knownAt??event?.detectedAt,
    expiresAfterBars=config.entryExpiryBars??event?.expiresAfterBars??config.expiryBars??3,
    retracement=config.entryLimitRetracement??.5,tickSize=metadata.tickSize??event?.parameterSnapshot?.patternConfig?.tickSize,
    stop=event?.invalidation,trigger=event?.trigger,signalClose=event?.signalClose,high=event?.signalHigh,low=event?.signalLow;
  const reasons=[];
  if(!['LONG','SHORT'].includes(side)||!finite(createdAt)||finite(event?.barCloseTime)&&createdAt<event.barCloseTime)reasons.push('INVALID_ENTRY_CANDIDATE');
  if(!integer(expiresAfterBars)||expiresAfterBars<1||expiresAfterBars>100||!finite(retracement)||retracement<0||retracement>1)reasons.push('INVALID_ENTRY_MODEL_CONFIGURATION');
  if(!finite(asOfTime)||!finite(tickSize)||tickSize<=0||![stop,trigger,signalClose,high,low].every(finite)||high<=low)reasons.push('ENTRY_PRICE_OR_CLOCK_REQUIRED');
  if(!Array.isArray(bars)||bars.length>10000)reasons.push('INVALID_ENTRY_BAR_SERIES');
  const available=[];
  if(Array.isArray(bars)&&finite(asOfTime))for(const bar of bars){
    const knownAt=bar?.knownAt??bar?.closeTime;
    // A full bar is usable only once closed and known. A bar which already
    // began before candidate creation cannot prove a later-created order was
    // present during its earlier high/low, so it is not a research trigger.
    if(bar?.closed!==true||!finite(knownAt)||knownAt>asOfTime||!finite(bar?.time)||bar.time<createdAt)continue;
    if(!['open','high','low','close','closeTime'].every(key=>finite(bar[key]))||bar.closeTime<=bar.time||knownAt<bar.closeTime||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low){reasons.push('INVALID_ENTRY_BAR');continue;}
    const previous=available.at(-1);
    if(previous&&(bar.time<previous.closeTime||knownAt<previous.knownAt)){reasons.push('UNORDERED_ENTRY_BARS');continue;}
    if(previous&&bar.time>previous.closeTime&&metadata.timeframeMs&&!(Array.isArray(metadata.sessionGaps)?metadata.sessionGaps:[]).some(gap=>gap?.kind==='market_closed'&&gap.from===previous.closeTime&&gap.to===bar.time))reasons.push('UNDECLARED_ENTRY_DATA_GAP');
    available.push({...bar,knownAt});
  }
  const uniqueReasons=[...new Set(reasons)],observed=available.slice(0,expiresAfterBars),expired=observed.length===expiresAfterBars;
  const barEvidence=bar=>({openTime:bar.time,closeTime:bar.closeTime,knownAt:bar.knownAt,open:bar.open,high:bar.high,low:bar.low,close:bar.close});
  const riskAt=(entry,target)=>{
    if(!risk)return {status:'NOT_CONFIGURED',quantity:0,reasonCodes:['RISK_PARAMETERS_NOT_SUPPLIED'],ordersCreated:false,fillInferred:false};
    if(finite(metadata.pointValue)&&(!finite(risk.pointValue)||Math.abs(metadata.pointValue-risk.pointValue)>Math.max(1,Math.abs(metadata.pointValue))*Number.EPSILON*8))return {status:'BLOCKED',quantity:0,reasonCodes:['INSTRUMENT_POINT_VALUE_MISMATCH'],ordersCreated:false,fillInferred:false};
    return planGuideRisk({...risk,direction:side,entry,stop,tickSize,stopBufferTicks:0,...(finite(target)?{target}:{})});
  };
  const finish=(model,state,bar=null,extra={})=>{
    const planned=model.plannedEntry!==null&&finite(model.plannedEntry)?riskAt(model.plannedEntry):null;
    const result={...model,state,reachabilityStatus:state,observedAt:bar?.knownAt??null,observedBar:bar?barEvidence(bar):null,
      expiresAt:state==='EXPIRED'?observed.at(-1).knownAt:null,observedLaterClosedBars:bar?observed.indexOf(bar)+1:observed.length,plannedRisk:planned,...extra};
    if(finite(result.observedOpenReference))result.observedReferenceRisk={basis:'OBSERVED_OPEN_REFERENCE_NOT_A_FILL',plan:riskAt(result.observedOpenReference,planned?.target)};
    return result;
  };
  return definitions.map(([id,label,guideSection,sourceLines])=>{
    const model={id,label,guideSection,definitionVersion:GUIDE_ENTRY_DEFINITION_VERSION,sourceKind:'original_research_definition',
      planningOnly:true,activeDefault:id==='LATER_CLOSE_CONFIRMATION',execution:'OBSERVATION_ONLY',orderEligible:false,executionApproved:false,ordersCreated:false,orderCreatedAt:null,fillInferred:false,intrabarSequenceInferred:false,riskMustBeRecalculatedAtActualEntry:true,
      sourceEventId:event?.eventId??null,setupStatus:event?.status??'UNKNOWN',sourceConfirmationReported:finite(event?.confirmedAt)&&event.confirmedAt<=asOfTime,
      createdAt:finite(createdAt)?createdAt:null,expiresAfterBars,stopPrice:finite(stop)?stop:null,trigger:finite(trigger)?trigger:null,
      plannedEntry:null,referencePrice:null,referenceArea:finite(low)&&finite(high)?{lower:low,upper:high}:null,
      reasonCodes:[...uniqueReasons],provenance:{guideSection,sourceLines,contextFrozenAt:event?.contextSnapshot?.freezeTime??null,parameterSnapshot:{entryExpiryBars:expiresAfterBars,entryLimitRetracement:retracement,limitRetracementSource:'research_choice',creationPolicy:'AFTER_SIGNAL_KNOWN',stopPolicy:'CANONICAL_EVENT_INVALIDATION_ALREADY_BUFFERED',additionalStopBufferTicks:0,observations:'LATER_CLOSED_KNOWN_BARS_ONLY',fillPolicy:'NO_FILL_INFERENCE'}}};
    if(uniqueReasons.length)return finish(model,'BLOCKED');
    if(createdAt>asOfTime)return finish(model,'CANDIDATE_NOT_YET_KNOWN');
    if(id==='MARKET_AFTER_SIGNAL_CLOSE'){
      model.plannedEntry=signalClose;model.referencePrice=signalClose;model.trigger=null;
      model.rule='מחיר סגירת האיתות הוא ייחוס; פתיחה מאוחרת שנצפתה אינה מחיר מילוי מובטח';
      return observed.length?finish(model,'NEXT_OPEN_REFERENCE_OBSERVED',observed[0],{observedOpenReference:observed[0].open}):finish(model,'WAITING_FOR_NEXT_CLOSED_BAR');
    }
    if(id==='BREAKOUT_STOP'){
      model.plannedEntry=trigger;model.rule='מעבר ברמת Stop לאחר יצירת המועמד; חציית שני הצדדים באותו OHLC עמומה';
    }else if(id==='RETEST_LIMIT'){
      try{model.plannedEntry=roundGuidePriceToTick(side==='LONG'?high-retracement*(high-low):low+retracement*(high-low),tickSize,side==='LONG'?'DOWN':'UP');}catch{return finish({...model,reasonCodes:['UNSAFE_ENTRY_TICK_COORDINATES']},'BLOCKED');}
      model.referencePrice=model.plannedEntry;model.limitPrice=model.plannedEntry;model.trigger=null;
      model.rule='מחיר Limit מפורש ועיגול לטיק; נגיעה או מחיר טוב יותר אינם הוכחת מילוי';
    }else model.rule='סגירה מאוחרת ממש מעבר לרמת האישור; אישור זה אינו ביצוע עסקה';
    if(id!=='LATER_CLOSE_CONFIRMATION'&&!(side==='LONG'?model.plannedEntry>stop:model.plannedEntry<stop))return finish({...model,reasonCodes:['STOP_NOT_ON_PROTECTIVE_SIDE']},'BLOCKED');
    for(const bar of observed){
      if(id==='LATER_CLOSE_CONFIRMATION'){
        if(side==='LONG'?bar.close<stop:bar.close>stop)return finish(model,'INVALIDATED_BY_LATER_CLOSE',bar);
        if(side==='LONG'?bar.close>trigger:bar.close<trigger){model.plannedEntry=bar.close;model.referencePrice=bar.close;return finish(model,'CLOSED_CONFIRMATION_OBSERVED',bar);}
        continue;
      }
      const entryReached=id==='BREAKOUT_STOP'?(side==='LONG'?bar.high>=trigger:bar.low<=trigger):(side==='LONG'?bar.low<=model.plannedEntry:bar.high>=model.plannedEntry),stopReached=side==='LONG'?bar.low<=stop:bar.high>=stop;
      if(entryReached&&stopReached)return finish(model,'AMBIGUOUS',bar,{entryLevelReached:true,invalidationLevelReached:true,reasonCodes:['BOTH_ENTRY_AND_INVALIDATION_REACHED_ORDER_UNKNOWN']});
      if(stopReached)return finish(model,'INVALIDATED_BEFORE_ENTRY_REFERENCE',bar,{entryLevelReached:false,invalidationLevelReached:true});
      if(!entryReached)continue;
      const gap=id==='BREAKOUT_STOP'?(side==='LONG'?bar.open>trigger:bar.open<trigger):(side==='LONG'?bar.open<model.plannedEntry:bar.open>model.plannedEntry);
      return finish(model,gap?id==='BREAKOUT_STOP'?'GAP_OPEN_PRICE_OBSERVED':'LIMIT_PRICE_OR_BETTER_OBSERVED_AT_OPEN':id==='BREAKOUT_STOP'?'BREAKOUT_LEVEL_REACHED_NO_FILL_PROOF':'LIMIT_LEVEL_REACHED_NO_FILL_PROOF',bar,
        {entryLevelReached:true,invalidationLevelReached:false,...(gap?{observedOpenReference:bar.open,riskRecalculationRequired:true}:{}),reasonCodes:['PRICE_REACHABILITY_IS_NOT_A_FILL']});
    }
    return finish(model,expired?'EXPIRED':observed.length?'WAITING_FOR_PRICE_CONDITION':'WAITING_FOR_LATER_CLOSED_BAR');
  });
}
