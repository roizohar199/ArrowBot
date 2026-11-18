// Pure review staging. This module has no HTTP, browser, credential, storage,
// broker execution or order-submission capability. Supplied broker evidence is
// a caller assertion; this function does not authenticate it with Tradovate.
import {normalizeAccountProfile} from './account-profile.mjs';
import {planGuideRisk} from './guide-risk.mjs';
import {selectFreshLiveSignal} from './live-signal-eligibility.mjs';

export const TRADOVATE_DEMO_INTENT_VERSION='tradovate-independent-demo-intent-1';
export const TRADOVATE_DEMO_LIMITS=Object.freeze({riskBudget:200,quantity:1,signalAgeMs:15000,brokerStateAgeMs:2000,quoteAgeMs:2000,contractEvidenceAgeMs:300000,mappingAgeMs:300000,maxQuoteDeviationTicks:2,maxSpreadTicks:4});
const flags=['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checks=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
const finite=Number.isFinite;
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\u0000-\u001f\u007f]/.test(x);
const accountId=x=>Number.isSafeInteger(x)&&x>0;
const equal=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const onTick=x=>finite(x)&&equal(x/.25,Math.round(x/.25));
// performance.timeOrigin + performance.now() receipts can be fractional ms.
const fresh=(at,now,maximum)=>finite(at)&&at>=0&&at<=8640000000000000&&at<=now&&now-at<=maximum;
const apex=x=>typeof x==='string'&&/apex/i.test(x);
const hasApex=objects=>objects.some(x=>plain(x)&&['provider','accountProvider','accountOrigin','accountSpec','brokerLabel','label'].some(key=>apex(x[key])));
const dated=x=>typeof x==='string'&&/^CME_MINI:NQ[HMUZ]20\d\d$/.test(x);
const clone=x=>structuredClone(x);

/** Prepare an unsigned independent-demo OSO request for human review only.
 * source is the current in-process LIVE connection descriptor, not chart data.
 * Broker/contract/quote objects must come from the separately verified connector;
 * accepting their asserted shape here does not establish remote verification.
 */
export function prepareTradovateDemoIntent(input={}){
  const {alert,state,analysis,source,brokerBinding:binding,brokerSnapshot:broker,contract,quote,now}=input??{};
  const base={kind:'TRADOVATE_DEMO_INTENT_REVIEW',definitionVersion:TRADOVATE_DEMO_INTENT_VERSION,status:'BLOCKED',reasonCodes:[],intent:null,
    ordersCreated:false,orderEligible:false,readyForSubmission:false,remoteVerificationPerformed:false,
    evidenceTrust:'SUPPLIED_CALLER_ASSERTIONS_NOT_AUTHENTICATED_BY_THIS_MODULE'};
  const block=reason=>({...base,reasonCodes:[reason]});
  // demo.tradovateapi.com is also used for prop/evaluation accounts. A DEMO
  // environment flag or SIM account name is never independent-account proof.
  if(hasApex([binding,broker,alert?.accountReview?.profile]))return block('READINESS_APEX_BLOCK');
  if(!Number.isSafeInteger(now)||now<0)return block('VALID_RECEIVER_TIME_REQUIRED');
  if(!plain(binding)||binding.provider!=='TRADOVATE_INDEPENDENT_DEMO'||binding.environment!=='DEMO'||binding.accountOrigin!=='INDEPENDENT_DEMO'||binding.verified!==true||!accountId(binding.accountId))return block('INDEPENDENT_DEMO_BINDING_REQUIRED');
  if(binding.automationConsent!==true||binding.costsReviewed!==true)return block('INDEPENDENT_DEMO_EXPLICIT_REVIEW_REQUIRED');
  const independent=binding.independentAccountEvidence;
  if(!plain(independent)||independent.kind!=='BROKER_VERIFIED_INDEPENDENT_DEMO'||independent.accountId!==binding.accountId||!id(independent.reference)||!fresh(independent.observedAt,now,TRADOVATE_DEMO_LIMITS.brokerStateAgeMs))return block('INDEPENDENT_DEMO_ACCOUNT_EVIDENCE_REQUIRED');
  if(!plain(broker)||broker.environment!=='DEMO'||broker.accountOrigin!=='INDEPENDENT_DEMO'||broker.provider!=='TRADOVATE_INDEPENDENT_DEMO'||broker.accountId!==binding.accountId||broker.verified!==true||broker.tradingEnabled!==true||!id(broker.accountSpec)||!fresh(broker.observedAt,now,TRADOVATE_DEMO_LIMITS.brokerStateAgeMs))return block('FRESH_DEMO_BROKER_STATE_REQUIRED');
  if(!Array.isArray(broker.positions)||broker.positions.some(p=>!plain(p)||!finite(p.netPos)||p.netPos!==0)||!Array.isArray(broker.workingOrders)||broker.workingOrders.length)return block('FLAT_ACCOUNT_WITHOUT_WORKING_ORDERS_REQUIRED');
  if(!plain(source)||source.active!==true||source.settingsDirty!==false||source.mode!=='LIVE'||!id(source.sessionId)||!id(source.runId)||!Number.isSafeInteger(source.sourceTabId)||source.sourceTabId<1)return block('ACTIVE_LIVE_SOURCE_REQUIRED');
  if(!plain(state)||state.status!=='READY'||state.ready!==true||state.liveEligible!==true||state.stale!==false||state.requiresSnapshot!==false||state.contextOnly===true||state.bootstrap===true||state.connected!==true||!Number.isSafeInteger(state.generation)||state.generation!==source.generation||!fresh(state.lastReceivedAt,now,TRADOVATE_DEMO_LIMITS.signalAgeMs))return block('CURRENT_LIVE_STATE_REQUIRED');
  const meta=state.metadata;
  if(!plain(meta)||meta.source!=='ohlc'||meta.sourceId!==source.runId||meta.tabId!==source.sourceTabId||meta.timeframe!=='1'||meta.timeframeMs!==60000||meta.currency!=='USD'||meta.tickSize!==.25||meta.pointValue!==20||!['standard','candles'].includes(meta.chartType)||meta.replay!==false||meta.realtime!==true||meta.testOnly===true)return block('CURRENT_STANDARD_NQ_SOURCE_REQUIRED');
  if(!plain(alert)||alert.testOnly===true||alert.sessionId!==source.sessionId||alert.runId!==source.runId||alert.sourceTabId!==source.sourceTabId||!id(alert.sourcePacketId)||!alert.sourcePacketId.startsWith(source.runId+':')||!fresh(alert.receivedAt,now,TRADOVATE_DEMO_LIMITS.signalAgeMs)||!fresh(alert.approvedAtReceiverEpoch,now,TRADOVATE_DEMO_LIMITS.signalAgeMs))return block('FRESH_CURRENT_CONNECTION_ALERT_REQUIRED');
  const review=alert.accountReview,normalized=normalizeAccountProfile(review?.profile);
  if(!normalized.ok||!id(review.reviewId)||review.reviewId!==source.accountReviewId||review.reviewId!==binding.localReviewId||!Number.isSafeInteger(review.reviewedAt)||review.reviewedAt>alert.receivedAt||review.ordersAuthorized!==false)return block('CURRENT_EXPLICIT_ACCOUNT_REVIEW_REQUIRED');
  const profile=normalized.profile;
  if(!['PAPER','RESEARCH'].includes(profile.mode)||profile.instrument!==meta.instrument||profile.currency!=='USD'||profile.tickSize!==.25||profile.pointValue!==20||profile.riskBudget>200||profile.maxContracts!==1||profile.costBasis!=='USER_SPECIFIED')return block('ONE_NQ_200_USD_REVIEW_PROFILE_REQUIRED');
  if(!plain(contract)||contract.verified!==true||!fresh(contract.observedAt,now,TRADOVATE_DEMO_LIMITS.contractEvidenceAgeMs)||!accountId(contract.id)||contract.product!=='NQ'||!dated(contract.instrument)||typeof contract.symbol!=='string'||!/^NQ[HMUZ](?:\d|\d{2}|\d{4})$/.test(contract.symbol)||contract.tickSize!==.25||contract.pointValue!==20||contract.currency!=='USD'||!Number.isSafeInteger(contract.expirationTime)||contract.expirationTime<=now)return block('VERIFIED_DATED_NQ_CONTRACT_REQUIRED');
  const parts=/^CME_MINI:NQ([HMUZ])(20\d\d)$/.exec(contract.instrument),brokerParts=/^NQ([HMUZ])(\d{1,4})$/.exec(contract.symbol),expiration=new Date(contract.expirationTime);
  if(parts[1]!==brokerParts[1]||!parts[2].endsWith(brokerParts[2])||Number(parts[2])!==expiration.getUTCFullYear()||{H:2,M:5,U:8,Z:11}[parts[1]]!==expiration.getUTCMonth())return block('DATED_NQ_CONTRACT_IDENTITY_MISMATCH');
  if(meta.instrument!==contract.instrument){
    const mapping=binding.continuousMapping;
    if(meta.instrument!=='CME_MINI:NQ1!'||!plain(mapping)||mapping.verified!==true||mapping.priceBasisVerified!==true||mapping.sourceInstrument!==meta.instrument||mapping.datedInstrument!==contract.instrument||mapping.contractId!==contract.id||!id(mapping.reference)||!fresh(mapping.observedAt,now,TRADOVATE_DEMO_LIMITS.mappingAgeMs))return block('CONTINUOUS_TO_DATED_CONTRACT_PROOF_REQUIRED');
  }
  const sourcePrice=state.current?.close??state.bars?.at(-1)?.close;
  if(!plain(quote)||quote.verified!==true||quote.environment!=='DEMO'||quote.contractId!==contract.id||quote.instrument!==contract.instrument||!fresh(quote.observedAt,now,TRADOVATE_DEMO_LIMITS.quoteAgeMs)||![quote.bid,quote.ask,quote.last,sourcePrice].every(onTick)||quote.bid>quote.ask||quote.ask-quote.bid>TRADOVATE_DEMO_LIMITS.maxSpreadTicks*.25||Math.abs(quote.last-sourcePrice)>TRADOVATE_DEMO_LIMITS.maxQuoteDeviationTicks*.25)return block('FRESH_MATCHING_NQ_BROKER_QUOTE_REQUIRED');
  const original=alert.signal;
  if(!plain(original)||original.orderEligible!==false||original.execution!=='OBSERVATION_ONLY'||original.testOnly===true||original.instrument!==meta.instrument||original.timeframe!=='1'||original.confirmationPolicy!=='later_close_beyond_setup')return block('CONFIRMED_OBSERVATION_SIGNAL_REQUIRED');
  if(!id(original.eventId)||!Array.isArray(analysis?.signals)||!analysis.signals.some(s=>s.eventId===original.eventId&&s.direction===original.direction&&s.confirmedAt===original.confirmedAt&&s.confirmationBarCloseTime===original.confirmationBarCloseTime))return block('KNOWN_CURRENT_ANALYSIS_SIGNAL_REQUIRED');
  let signal;
  try{signal=selectFreshLiveSignal(original,analysis,{bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:state.eligibleCloseTimes,bars:state.bars});}catch{return block('FRESH_PROVIDER_CLOSED_CONFIRMATION_REQUIRED');}
  if(!signal||signal.confirmationIndex<=signal.signalIndex||!finite(state.decisionAsOfTime)||signal.confirmedAt>state.decisionAsOfTime||!Array.isArray(state.newlyClosed)||!state.newlyClosed.some(b=>b.closeTime===signal.confirmationBarCloseTime&&b.finalOhlcVerified===true&&b.closed===true)||!state.bars?.[signal.confirmationIndex]?.finalOhlcVerified)return block('FRESH_PROVIDER_CLOSED_CONFIRMATION_REQUIRED');
  const frozen=signal.parameterSnapshot;
  if(!plain(frozen)||flags.some(key=>frozen.config?.[key]!==true)||frozen.contextConfig?.roleReversalEnabled!==true||frozen.contextConfig?.supplyDemandEnabled!==true||signal.contextSnapshot?.passed!==true||!Array.isArray(signal.contextSnapshot?.checks)||checks.some(key=>{const rows=signal.contextSnapshot.checks.filter(c=>c.id===key);return rows.length!==1||rows[0].required!==true||rows[0].passed!==true||rows[0].available!==true||rows[0].enabled!==true||rows[0].state!=='PASS';}))return block('ALL_MANDATORY_FROZEN_FILTERS_REQUIRED');
  const riskKeys=['riskBudget','pointValue','commissionPerContract','slippageTicks','maxContracts','rewardRisk'];
  if(riskKeys.some(key=>!equal(frozen.risk?.[key],profile[key])))return block('SIGNAL_ACCOUNT_RISK_CONFIGURATION_MISMATCH');
  const planned=signal.riskPlan;
  if(!plain(planned)||planned.status!=='PLANNED'||planned.quantity!==1||planned.ordersCreated!==false||planned.fillInferred!==false||planned.initialStop!==signal.invalidation||planned.plannedEntry!==signal.confirmationClose||planned.effectiveEntry!==planned.plannedEntry||planned.actualEntry!==null||![planned.plannedEntry,planned.initialStop,planned.target].every(onTick))return block('UNCHANGED_ONE_CONTRACT_STRUCTURAL_PLAN_REQUIRED');
  const risk=planGuideRisk({direction:signal.direction,entry:planned.plannedEntry,stop:signal.invalidation,target:planned.target,tickSize:.25,pointValue:20,riskBudget:profile.riskBudget,maxContracts:1,commissionPerContract:profile.commissionPerContract,slippageTicks:profile.slippageTicks,rewardRisk:profile.rewardRisk,stopBufferTicks:0});
  if(risk.status!=='PLANNED'||risk.quantity!==1||risk.totalPlannedRisk>200)return block('TOTAL_PLANNED_RISK_EXCEEDS_200_USD');
  if(!equal(planned.totalPlannedRisk,risk.totalPlannedRisk)||!equal(planned.perContractRisk,risk.perContractRisk)||!equal(planned.initialStop,risk.initialStop)||!equal(planned.target,risk.target))return block('RISK_PLAN_ARITHMETIC_MISMATCH');
  const action=signal.direction==='LONG'?'Buy':'Sell',opposite=action==='Buy'?'Sell':'Buy';
  const key=[TRADOVATE_DEMO_INTENT_VERSION,binding.accountId,source.sessionId,source.runId,signal.eventId].map(encodeURIComponent).join(':');
  const intent={kind:'UNSIGNED_INDEPENDENT_DEMO_OSO_REVIEW',definitionVersion:TRADOVATE_DEMO_INTENT_VERSION,idempotencyKey:key,
    environment:'DEMO',accountId:binding.accountId,contractId:contract.id,contractSymbol:contract.symbol,sourceInstrument:meta.instrument,
    sourceBinding:{sessionId:source.sessionId,runId:source.runId,sourceTabId:source.sourceTabId,generation:state.generation,reviewId:review.reviewId,eventId:signal.eventId,sourcePacketId:alert.sourcePacketId},
    preparedAt:now,expiresAt:Math.min(alert.receivedAt+TRADOVATE_DEMO_LIMITS.signalAgeMs,quote.observedAt+TRADOVATE_DEMO_LIMITS.quoteAgeMs,broker.observedAt+TRADOVATE_DEMO_LIMITS.brokerStateAgeMs),
    quantity:1,direction:signal.direction,entry:{type:'LIMIT',action,quantity:1,price:risk.plannedEntry},protectiveStop:{type:'STOP',action:opposite,quantity:1,stopPrice:risk.initialStop},target:{type:'LIMIT',action:opposite,quantity:1,price:risk.target},
    osoRequest:{accountSpec:broker.accountSpec,accountId:binding.accountId,action,symbol:contract.symbol,orderQty:1,orderType:'Limit',price:risk.plannedEntry,isAutomated:true,bracket1:{action:opposite,orderType:'Stop',stopPrice:risk.initialStop},bracket2:{action:opposite,orderType:'Limit',price:risk.target}},
    risk:clone(risk),ordersCreated:false,orderEligible:false,readyForSubmission:false,simulationOnly:input.simulationOnly===true,
    requiresBeforeAnySubmission:['REVALIDATE_CURRENT_CONNECTION_AND_DISARM_STATE','REVALIDATE_BROKER_ACCOUNT_CONTRACT_QUOTE','DURABLE_IDEMPOTENCY_CLAIM','USER_OWNED_EXECUTION_HANDOFF','VERIFY_SERVER_PROTECTIVE_CHILD_ORDERS'],
    limitations:['UNSIGNED_REVIEW_ONLY_NO_REMOTE_VERIFICATION_OR_SUBMISSION','PLANNED_RISK_IS_NOT_A_REALIZED_LOSS_GUARANTEE','STOP_GAPS_AND_SLIPPAGE_CAN_EXCEED_ALLOWANCE']};
  return {...base,status:'PREPARED',reasonCodes:[],intent};
}
