export const ROI_BRR_APPROVAL_POLICY='roi_brr_market_on_ready_v1';
export const ROI_BRR_LIVE_ELIGIBILITY='ROI_BRR_REALTIME_READY_ON_VERIFIED_CLOSE';
export const roiBrrEventId=(closeTime,direction)=>`CME_MINI:NQ1!:1:${closeTime}:${direction}:ROI_BRR`;

export function matchRoiBrrReady(observation,closed,{sessionId,runId,sourceUrl,now}={}){
  const o=observation;
  return o?.kind==='ROI_BRR_LIVE_READY_V1'&&o.sessionId===sessionId&&o.runId===runId&&o.sourceUrl===sourceUrl&&
    closed?.closed===true&&closed.finalOhlcVerified===true&&o.closeTime===closed.closeTime&&['LONG','SHORT'].includes(o.direction)&&
    Number.isSafeInteger(o.priceTicks)&&o.priceTicks>0&&o.priceTicks===closed.close/.25&&Number.isSafeInteger(o.sourceEmittedAt)&&
    o.sourceEmittedAt>=o.closeTime&&o.sourceEmittedAt-o.closeTime<=15000&&Number.isSafeInteger(o.observedAtWall)&&now>=o.observedAtWall&&now-o.observedAtWall<=2000;
}

export function selectRoiBrrLiveSignal(observation,state,origin,{sessionId,runId,sourceUrl,now}={}){
  const closed=state?.bars?.at(-1);
  if(state?.liveEligible!==true||state.contextOnly===true||!Number.isSafeInteger(state.bootstrapAsOfTime)||state.bootstrapAsOfTime>=closed?.closeTime||
    state.metadata?.instrument!=='CME_MINI:NQ1!'||state.metadata.timeframe!=='1'||origin?.generation!==state.generation||origin.runId!==runId||
    origin.closeTime!==closed?.closeTime||!Number.isSafeInteger(origin.receivedAt)||now<origin.receivedAt||now-origin.receivedAt>15000||
    !matchRoiBrrReady(observation,closed,{sessionId,runId,sourceUrl,now}))return null;
  const {closeTime,direction}=observation,eventId=roiBrrEventId(closeTime,direction);
  return {eventId,direction,instrument:'CME_MINI:NQ1!',timeframe:'1',status:'CONFIRMED',confirmedAt:closeTime,confirmationBarCloseTime:closeTime,
    confirmationClose:closed.close,patternIds:['ROI_BRR_READY'],reasonCodes:['ROI_BRR_MARKET_ON_READY'],approvalPolicy:ROI_BRR_APPROVAL_POLICY,
    liveEligibility:{policy:ROI_BRR_LIVE_ELIGIBILITY},execution:'OBSERVATION_ONLY',orderEligible:false};
}
