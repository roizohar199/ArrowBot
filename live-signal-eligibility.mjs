// Select the eligible constituent setups before presenting a merged live alert.
// A fresh label must never borrow an older setup's stop, target or explanation.
const finite=Number.isFinite;
const unique=list=>[...new Set(list)];
const clone=value=>structuredClone(value);

export function selectFreshLiveSignal(signal,analysis,{bootstrapAsOfTime,eligibleCloseTimes,bars}={}){
  if(!signal||signal.status!=='CONFIRMED'||!['LONG','SHORT'].includes(signal.direction)||typeof signal.eventId!=='string'||
    !finite(bootstrapAsOfTime)||!finite(signal.confirmedAt)||signal.confirmedAt<bootstrapAsOfTime||
    !Array.isArray(eligibleCloseTimes)||!Array.isArray(bars)||!Array.isArray(analysis?.events))return null;
  const allowed=new Set(eligibleCloseTimes.filter(finite)),events=new Map(analysis.events.map(event=>[event.eventId,event]));
  const ids=unique(signal.setupEventIds?.length?signal.setupEventIds:signal.setupFormations?.length?signal.setupFormations.map(item=>item.eventId):[signal.eventId]);
  const signalBar=bars[signal.confirmationIndex],sourceClose=signal.confirmationBarCloseTime??signalBar?.closeTime;
  if(!finite(sourceClose)||!allowed.has(sourceClose))return null;
  const fresh=[];
  for(const id of ids){
    const event=events.get(id),bar=event&&bars[event.confirmationIndex],formation=event?.formationStartTime;
    if(!event||event.status!=='CONFIRMED'||event.direction!==signal.direction||event.instrument!==signal.instrument||event.timeframe!==signal.timeframe||
      !finite(formation)||formation<bootstrapAsOfTime||event.confirmedAt!==signal.confirmedAt||
      !bar||bar.closed!==true||bar.closeTime!==sourceClose||(event.confirmationBarCloseTime??bar.closeTime)!==sourceClose||
      !allowed.has(bar.closeTime)||bar.close!==event.confirmationClose||(bar.knownAt??bar.closeTime)!==event.confirmedAt||
      finite(analysis.asOfTime)&&event.confirmedAt>analysis.asOfTime)continue;
    if(event.parameterSnapshot?.config?.requireRisk===true&&event.riskPlan?.status!=='PLANNED'||event.riskPlan&&event.riskPlan.status!=='PLANNED')continue;
    fresh.push(event);
  }
  if(!fresh.length)return null;
  const representative=fresh[0];
  return {...clone(representative),eventId:signal.eventId,confirmationBarCloseTime:sourceClose,
    setupEventIds:fresh.map(event=>event.eventId),setupIds:unique(fresh.map(event=>event.setupId)),
    setupFormations:fresh.map(event=>({eventId:event.eventId,formationStartTime:event.formationStartTime,signalStartIndex:event.signalStartIndex,signalIndex:event.signalIndex,detectedAt:event.detectedAt,confirmedAt:event.confirmedAt,confirmationBarCloseTime:sourceClose})),
    patternIds:unique(fresh.flatMap(event=>event.patternIds??[])).sort(),
    setupRiskPlans:fresh.map(event=>({eventId:event.eventId,riskPlan:clone(event.riskPlan??null)})),
    liveEligibility:{policy:'POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE',bootstrapAsOfTime,confirmationBarCloseTime:sourceClose,representativeSetupEventId:representative.eventId,eligibleConstituentCount:fresh.length,excludedConstituentCount:ids.length-fresh.length},
    orderEligible:false,execution:'OBSERVATION_ONLY',
  };
}
