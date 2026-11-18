// TradingView built-in Paper Trading only. No real broker API or shortcut path.
// DOM actions are injected by the caller; evidence must be read from public UI.
import {normalizeAccountProfile} from './account-profile.mjs';
import {planGuideRisk} from './guide-risk.mjs';
import {selectFreshLiveSignal} from './live-signal-eligibility.mjs';
export const PAPER_EXECUTION_VERSION='tradingview-paper-execution-1';
export const PAPER_EXECUTION_LIMITS=Object.freeze({riskBudget:200,quantity:1,signalAgeMs:15000,evidenceAgeMs:2000,maxSpreadTicks:4,maxQuoteDeviationTicks:2});
const finite=Number.isFinite,clone=x=>structuredClone(x),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&!/[\u0000-\u001f\u007f]/.test(x);
const fresh=(at,now,maximum)=>finite(at)&&at>=0&&at<=now&&now-at<=maximum;
const same=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const tick=x=>finite(x)&&same(x/.25,Math.round(x/.25));
const flags=['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checks=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
const fingerprint=c=>JSON.stringify([c?.source?.sessionId,c?.source?.runId,c?.source?.sourceTabId,c?.source?.generation,c?.source?.accountReviewId,c?.state?.generation,c?.state?.bootstrapAsOfTime,c?.state?.metadata?.instrument]);
function sourceCurrent(c,now){
  const {source:s,state:v}=c??{};
  return plain(s)&&s.active===true&&s.mode==='LIVE'&&s.settingsDirty===false&&text(s.sessionId)&&text(s.runId)&&Number.isSafeInteger(s.sourceTabId)&&s.sourceTabId>0&&plain(v)&&v.status==='READY'&&v.ready===true&&v.liveEligible===true&&v.stale===false&&v.requiresSnapshot===false&&v.contextOnly!==true&&v.connected===true&&Number.isSafeInteger(v.generation)&&v.generation===s.generation&&fresh(v.lastReceivedAt,now,PAPER_EXECUTION_LIMITS.signalAgeMs)&&v.metadata?.replay===false&&v.metadata?.realtime===true;
}
function publicPaperEvidence(e,s,now){
  if(!plain(e)||e.status!=='PAPER_UI_VERIFIED'||e.provider!=='TRADINGVIEW_PAPER'||!text(e.accountKey)||!fresh(e.observedAt,now,PAPER_EXECUTION_LIMITS.evidenceAgeMs)||e.chartCount!==1||e.timeframe!=='1'||e.replay!==false||e.instrument!==s.metadata.instrument||e.flat!==true||!Array.isArray(e.positions)||e.positions.length!==0||!Array.isArray(e.workingOrders)||e.workingOrders.length!==0)return false;
  let url;try{url=new URL(e.researchUrl);}catch{return false;}
  return url.protocol==='https:'&&['tradingview.com','www.tradingview.com'].includes(url.hostname)&&/^\/chart\/[^/]+\/?$/.test(url.pathname);
}
function ticketIdentity(e,meta){
  const t=e?.ticket;
  if(!plain(t)||typeof t.symbol!=='string'||!/^NQ[HMUZ]20\d\d$/.test(t.symbol)||t.quantity!==1||t.tickValue!==5)return false;
  const dated='CME_MINI:'+t.symbol;
  return meta.instrument===dated||meta.instrument==='CME_MINI:NQ1!'&&typeof t.mappingNotice==='string'&&/continuous\s+futures/i.test(t.mappingNotice)&&t.mappingNotice.includes(t.symbol);
}
export function preparePaperExecutionIntent(input={}){
  const {alert,state,analysis,source,brokerEvidence:e,now}=input??{};
  const base={kind:'TRADINGVIEW_PAPER_INTENT',definitionVersion:PAPER_EXECUTION_VERSION,status:'BLOCKED',reasonCodes:[],intent:null,ordersCreated:false,realBrokerOrdersAuthorized:false};
  const block=code=>({...base,reasonCodes:[code]});
  if(!Number.isSafeInteger(now)||now<0)return block('PAPER_VALID_RECEIVER_TIME_REQUIRED');
  if(!sourceCurrent({source,state},now))return block('PAPER_CURRENT_LIVE_SOURCE_REQUIRED');
  const meta=state.metadata;
  if(meta.source!=='ohlc'||meta.sourceId!==source.runId||meta.tabId!==source.sourceTabId||meta.timeframe!=='1'||meta.timeframeMs!==60000||meta.currency!=='USD'||meta.tickSize!==.25||meta.pointValue!==20||!['standard','candles'].includes(meta.chartType)||meta.testOnly===true||!(meta.instrument==='CME_MINI:NQ1!'||/^CME_MINI:NQ[HMUZ]20\d\d$/.test(meta.instrument)))return block('PAPER_EXACT_STANDARD_NQ_MINUTE_REQUIRED');
  if(!publicPaperEvidence(e,state,now)||!ticketIdentity(e,meta))return block('PAPER_VISIBLE_ACCOUNT_AND_NQ_TICKET_REQUIRED');
  const quote=e.ticket,sourcePrice=state.current?.close??state.bars?.at(-1)?.close;
  if(![quote.bid,quote.ask,sourcePrice].every(tick)||quote.bid>quote.ask||quote.ask-quote.bid>PAPER_EXECUTION_LIMITS.maxSpreadTicks*.25||sourcePrice<quote.bid-PAPER_EXECUTION_LIMITS.maxQuoteDeviationTicks*.25||sourcePrice>quote.ask+PAPER_EXECUTION_LIMITS.maxQuoteDeviationTicks*.25)return block('PAPER_QUOTE_SOURCE_MISMATCH');
  if(!plain(alert)||alert.testOnly===true||alert.sessionId!==source.sessionId||alert.runId!==source.runId||alert.sourceTabId!==source.sourceTabId||!text(alert.sourcePacketId)||!alert.sourcePacketId.startsWith(source.runId+':')||!fresh(alert.receivedAt,now,PAPER_EXECUTION_LIMITS.signalAgeMs)||!fresh(alert.approvedAtReceiverEpoch,now,PAPER_EXECUTION_LIMITS.signalAgeMs))return block('PAPER_FRESH_CONNECTION_ALERT_REQUIRED');
  const review=alert.accountReview,p=normalizeAccountProfile(review?.profile);
  if(!p.ok||!text(review.reviewId)||review.reviewId!==source.accountReviewId||!Number.isSafeInteger(review.reviewedAt)||review.reviewedAt>alert.receivedAt||review.ordersAuthorized!==false)return block('PAPER_CURRENT_ACCOUNT_REVIEW_REQUIRED');
  const profile=p.profile;
  if(profile.mode!=='PAPER'||profile.instrument!==meta.instrument||profile.riskBudget>200||profile.maxContracts!==1||profile.tickSize!==.25||profile.pointValue!==20||profile.costBasis!=='USER_SPECIFIED')return block('PAPER_ONE_NQ_200_USD_PROFILE_REQUIRED');
  const candidate=alert.signal;
  if(!plain(candidate)||candidate.execution!=='OBSERVATION_ONLY'||candidate.orderEligible!==false||candidate.testOnly===true||candidate.instrument!==meta.instrument||candidate.timeframe!=='1'||candidate.confirmationPolicy!=='later_close_beyond_setup'||!text(candidate.eventId)||analysis?.execution!=='OBSERVATION_ONLY'||analysis?.orderEligible!==false||analysis?.dataQuality?.valid!==true||!analysis.signals?.some(x=>x.eventId===candidate.eventId&&x.direction===candidate.direction&&x.confirmedAt===candidate.confirmedAt))return block('PAPER_CONFIRMED_ENGINE_SIGNAL_REQUIRED');
  let signal;try{signal=selectFreshLiveSignal(candidate,analysis,{bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:state.eligibleCloseTimes,bars:state.bars});}catch{return block('PAPER_FRESH_PROVIDER_CLOSED_CONFIRMATION_REQUIRED');}
  if(!signal||signal.confirmationIndex<=signal.signalIndex||signal.confirmedAt>state.decisionAsOfTime||!finite(state.decisionAsOfTime)||!state.newlyClosed?.some(b=>b.closed===true&&b.finalOhlcVerified===true&&b.closeTime===signal.confirmationBarCloseTime)||state.bars?.[signal.confirmationIndex]?.finalOhlcVerified!==true||state.bootstrap===true)return block('PAPER_FRESH_PROVIDER_CLOSED_CONFIRMATION_REQUIRED');
  const frozen=signal.parameterSnapshot;
  if(flags.some(key=>frozen?.config?.[key]!==true)||frozen.contextConfig?.roleReversalEnabled!==true||frozen.contextConfig?.supplyDemandEnabled!==true||signal.contextSnapshot?.passed!==true||checks.some(key=>{const rows=signal.contextSnapshot?.checks?.filter(x=>x.id===key)??[];return rows.length!==1||['required','passed','available','enabled'].some(k=>rows[0][k]!==true)||rows[0].state!=='PASS';}))return block('PAPER_ALL_MANDATORY_FROZEN_FILTERS_REQUIRED');
  if(['riskBudget','pointValue','maxContracts','commissionPerContract','slippageTicks','rewardRisk'].some(key=>!same(frozen.risk?.[key],profile[key])))return block('PAPER_FROZEN_RISK_CONFIGURATION_MISMATCH');
  const plan=signal.riskPlan;
  if(!plain(plan)||plan.status!=='PLANNED'||plan.quantity!==1||plan.ordersCreated!==false||plan.fillInferred!==false||plan.initialStop!==signal.invalidation||plan.plannedEntry!==signal.confirmationClose||plan.effectiveEntry!==plan.plannedEntry||plan.actualEntry!==null||![plan.plannedEntry,plan.initialStop,plan.target].every(tick))return block('PAPER_UNCHANGED_STRUCTURAL_PLAN_REQUIRED');
  const risk=planGuideRisk({direction:signal.direction,entry:plan.plannedEntry,stop:signal.invalidation,target:plan.target,tickSize:.25,pointValue:20,riskBudget:profile.riskBudget,maxContracts:1,commissionPerContract:profile.commissionPerContract,slippageTicks:profile.slippageTicks,rewardRisk:profile.rewardRisk,stopBufferTicks:0});
  if(risk.status!=='PLANNED'||risk.quantity!==1||risk.totalPlannedRisk>200)return block('PAPER_TOTAL_PLANNED_RISK_EXCEEDS_200_USD');
  if(!same(plan.totalPlannedRisk,risk.totalPlannedRisk)||!same(plan.perContractRisk,risk.perContractRisk))return block('PAPER_RISK_ARITHMETIC_MISMATCH');
  const key=[PAPER_EXECUTION_VERSION,e.accountKey,source.sessionId,source.runId,signal.eventId].map(encodeURIComponent).join(':');
  const intent={kind:'TRADINGVIEW_BUILTIN_PAPER_ENTRY',definitionVersion:PAPER_EXECUTION_VERSION,key,accountKey:e.accountKey,provider:'TRADINGVIEW_PAPER',quantity:1,direction:signal.direction,entry:risk.plannedEntry,stop:risk.initialStop,target:risk.target,stopTicks:Math.round(risk.riskTicks),targetTicks:Math.round(Math.abs(risk.target-risk.plannedEntry)/.25),expectedSymbol:e.ticket.symbol,
    preparedAt:now,expiresAt:alert.receivedAt+PAPER_EXECUTION_LIMITS.signalAgeMs,signalApproved:true,testOnly:false,ordersCreated:false,realBrokerOrdersAuthorized:false,riskPlan:clone(risk),sourceBinding:{sessionId:source.sessionId,runId:source.runId,sourceTabId:source.sourceTabId,generation:state.generation,bootstrapAsOfTime:state.bootstrapAsOfTime,reviewId:review.reviewId,eventId:signal.eventId,sourcePacketId:alert.sourcePacketId,instrument:meta.instrument,timeframe:'1'},researchUrl:e.researchUrl,
    scope:'VIRTUAL_TRADINGVIEW_BUILTIN_PAPER_ONLY',riskScope:'PLANNED_RISK_NOT_REALIZED_LOSS_GUARANTEE'};
  return {...base,status:'PREPARED',intent};
}
function ticketMatches(intent,e){
  const t=e?.ticket;
  return plain(t)&&e.accountKey===intent.accountKey&&t.symbol===intent.expectedSymbol&&t.quantity===1&&t.type==='LIMIT'&&same(t.entry,intent.entry)&&t.stopEnabled===true&&t.targetEnabled===true&&t.stopTicks===intent.stopTicks&&t.targetTicks===intent.targetTicks;
}

/** All injected UI operations must be Paper-only. submitTicket must invoke
 * isCurrent() immediately before its single final gesture and synchronously
 * re-read broker/account/chart/ticket/flat evidence. Unknown results never retry.
 */
export function createPaperExecutionController({getContext,readEvidence,prepareTicket,submitTicket,verifyResult,reserve,now=Date.now,onChange=()=>{}}={}){
  if([getContext,readEvidence,prepareTicket,submitTicket,verifyResult,reserve,now,onChange].some(fn=>typeof fn!=='function'))throw TypeError('PAPER_CONTROLLER_DEPENDENCIES_REQUIRED');
  let state='DISARMED',armed=false,busy=false,locked=false,epoch=0,armedBinding=null,reason='PAPER_DISARMED',lastIntent=null,lastResult=null,lastSubmission=null,submissionAttempted=false;
  const journal=[];
  const snapshot=()=>({definitionVersion:PAPER_EXECUTION_VERSION,state,status:state,armed,busy,locked,reason,accountKey:armedBinding?.accountKey??null,lastIntent:lastIntent?clone(lastIntent):null,lastResult:lastResult?clone(lastResult):null,lastSubmission:lastSubmission?clone(lastSubmission):null,submissionAttempted,ordersCreated:journal.some(x=>['WORKING','FILLED_PROTECTED'].includes(x.state))?true:submissionAttempted||locked?null:false,realBrokerOrdersAuthorized:false,journal:clone(journal)});
  const publish=(next,why)=>{state=next;reason=why;const row={at:now(),state,reason};journal.push(row);if(journal.length>100)journal.shift();try{onChange(snapshot());}catch{}return snapshot();};
  function context(){try{return getContext();}catch{return null;}}
  function current(token){const c=context();return armed&&!locked&&token.epoch===epoch&&armedBinding?.fingerprint===token.fingerprint&&fingerprint(c)===token.fingerprint&&sourceCurrent(c,now());}
  function verifiedState(verified,intent){
    if(verified?.provider!=='TRADINGVIEW_PAPER'||verified.accountKey!==intent.accountKey||verified.quantity!==1||verified.entryVerified!==true||verified.stopVerified!==true||verified.targetVerified!==true)return null;
    if(verified.status==='WORKING'&&verified.protectionState==='PENDING_PARENT_FILL'&&verified.fillVerified===false&&verified.stopActive===false&&verified.targetActive===false)return 'WORKING';
    if(verified.status==='FILLED_PROTECTED'&&verified.fillVerified===true&&verified.positionStateVerified===true&&verified.stopActive===true&&verified.targetActive===true&&verified.protectionState==='ACTIVE_FILLED_POSITION')return 'FILLED_PROTECTED';
    return null;
  }
  const verifiedReason=state=>state==='WORKING'?'PAPER_WORKING_PARENT_BRACKETS_REGISTERED':'PAPER_FILLED_ONE_NQ_PROTECTED';
  function readonlyTarget(c,intent){
    const instrument=c?.state?.metadata?.instrument??c?.profile?.instrument??c?.account?.review?.profile?.instrument??c?.source?.instrument;
    let url;try{const u=new URL(c?.source?.researchUrl);url=u.origin+u.pathname;}catch{return null;}
    if(c?.source?.sourceTabId!==intent.sourceBinding.sourceTabId||url!==intent.researchUrl||instrument!==intent.sourceBinding.instrument)return null;
    return JSON.stringify([c.source.sourceTabId,url,instrument,intent.accountKey]);
  }
  function disarm(why='PAPER_DISARMED'){
    epoch++;armed=false;
    if(submissionAttempted&&busy&&state==='SUBMITTING'){locked=true;return publish('UNKNOWNLOCK','PAPER_DISARMED_DURING_SUBMISSION');}
    return publish(locked?'UNKNOWNLOCK':'DISARMED',why);
  }
  function arm({accountKey}={}){
    if(locked||busy)return publish(locked?'UNKNOWNLOCK':state,locked?'PAPER_RECONCILIATION_REQUIRED':'PAPER_BUSY');
    const c=context();if(!text(accountKey)||!sourceCurrent(c,now()))return publish('DISARMED','PAPER_CURRENT_LIVE_SOURCE_REQUIRED');
    epoch++;armed=true;armedBinding={accountKey,fingerprint:fingerprint(c)};return publish('ARMED','PAPER_ARMED_VIRTUAL_ONLY');
  }
  async function accept(alert,approvalAnalysis,approvalState){
    if(!armed||locked||busy||!['ARMED'].includes(state))return {ok:false,...snapshot()};
    const initial=context(),token={epoch,fingerprint:armedBinding.fingerprint};
    if(!current(token)){disarm('PAPER_SOURCE_CHANGED');return {ok:false,...snapshot()};}
    // Freeze only the original approval proof. Later current-tick updates
    // legitimately clear newlyClosed/eligibleCloseTimes and must not erase it.
    const a=approvalAnalysis??initial.analysis,s=approvalState??initial.state;
    if(s?.generation!==initial.state.generation||s?.bootstrapAsOfTime!==initial.state.bootstrapAsOfTime||s?.lastReceivedAt!==alert?.receivedAt)return {ok:false,...publish('ARMED','PAPER_APPROVAL_CONTEXT_MISMATCH')};
    const ids=new Set(alert?.signal?.setupEventIds?.length?alert.signal.setupEventIds:[alert?.signal?.eventId]);
    const frozen={alert:clone(alert),source:clone(initial.source),state:clone(s),analysis:clone({...a,events:(a?.events??[]).filter(e=>ids.has(e.eventId)),signals:(a?.signals??[]).filter(e=>e.eventId===alert?.signal?.eventId)})};
    busy=true;submissionAttempted=false;lastSubmission=null;publish('PREPARING','PAPER_CHECKING_ACCOUNT');
    let reserved=false;
    const fail=(why,uncertain=false)=>{lastResult={status:uncertain?'UNKNOWN': 'BLOCKED',reason:why};if(uncertain){locked=true;armed=false;return publish('UNKNOWNLOCK',why);}return publish(locked?'UNKNOWNLOCK':armed?'ARMED':'DISARMED',why);};
    const plan=e=>{
      const c=context(),currentPrice=c?.state?.current;
      const approval={...frozen.state,current:currentPrice?clone(currentPrice):frozen.state.current};
      return preparePaperExecutionIntent({...frozen,state:approval,brokerEvidence:e,now:now()});
    };
    try{
      let evidence=await readEvidence({sourceTabId:frozen.source.sourceTabId,accountKey:armedBinding.accountKey});
      if(!current(token)){disarm('PAPER_SOURCE_CHANGED');return {ok:false,...snapshot()};}
      let prepared=plan(evidence);if(prepared.status!=='PREPARED')return {ok:false,...fail(prepared.reasonCodes[0])};
      if(prepared.intent.accountKey!==armedBinding.accountKey)return {ok:false,...fail('PAPER_ACCOUNT_CHANGED')};
      const intent=prepared.intent;lastIntent=clone(intent);
      const ticket=await prepareTicket(clone(intent));
      if(!current(token)){disarm('PAPER_SOURCE_CHANGED');return {ok:false,...snapshot()};}
      if(ticket?.status!=='TICKET_PREPARED')return {ok:false,...fail(ticket?.reason??ticket?.status??'PAPER_TICKET_NOT_PREPARED')};
      evidence=ticket.evidence;
      prepared=plan(evidence);if(prepared.status!=='PREPARED'||prepared.intent.key!==intent.key||!ticketMatches(intent,evidence))return {ok:false,...fail('PAPER_PREPARED_TICKET_MISMATCH')};
      const claim=await reserve(intent.key,{eventId:intent.sourceBinding.eventId,accountKey:intent.accountKey,sourceBinding:clone(intent.sourceBinding),reservedAt:now()});
      if(!current(token)){disarm('PAPER_SOURCE_CHANGED');return {ok:false,...snapshot()};}
      if(claim?.ok!==true||claim.status!=='RESERVED')return {ok:false,...fail(claim?.reason??'PAPER_ENTRY_ALREADY_RESERVED',true)};
      reserved=true;
      evidence=await readEvidence({sourceTabId:frozen.source.sourceTabId,accountKey:intent.accountKey});
      if(!current(token)){disarm('PAPER_SOURCE_CHANGED');return {ok:false,...snapshot()};}
      prepared=plan(evidence);if(prepared.status!=='PREPARED'||prepared.intent.key!==intent.key||!ticketMatches(intent,evidence))return {ok:false,...fail('PAPER_FINAL_PREFLIGHT_MISMATCH')};
      // The immutable signal lease is retained byte-for-byte for the prepared
      // UI capability. Evidence freshness was rechecked separately above.
      lastIntent=clone(intent);
      if(now()>intent.expiresAt||!current(token))return {ok:false,...fail('PAPER_INTENT_EXPIRED')};
      publish('SUBMITTING','PAPER_SUBMITTING_VIRTUAL_ORDER');submissionAttempted=true;
      const submission=await submitTicket(clone(intent),{isCurrent:()=>current(token)&&now()<=intent.expiresAt});
      lastSubmission=clone(submission??{status:'UNKNOWN'});
      lastResult=clone(submission??{status:'UNKNOWN'});
      if(submission?.submitted===false){submissionAttempted=false;if(reason==='PAPER_DISARMED_DURING_SUBMISSION')locked=false;}
      if(submission?.status!=='SUBMITTED_UNCONFIRMED')return {ok:false,...fail(submission?.reason??submission?.status??'PAPER_SUBMISSION_UNKNOWN',submission?.submitted!==false)};
      if(!current(token))return {ok:false,...fail('PAPER_SOURCE_CHANGED_AFTER_SUBMISSION',true)};
      const verified=await verifyResult(clone(intent),{submission:clone(submission)});lastResult=clone(verified??{status:'UNKNOWN'});
      if(!current(token))return {ok:false,...fail('PAPER_SOURCE_CHANGED_DURING_VERIFICATION',true)};
      const proven=verifiedState(verified,intent);if(!proven)return {ok:false,...fail('PAPER_RESULT_REQUIRES_RECONCILIATION',true)};
      publish(proven,verifiedReason(proven));return {ok:true,...snapshot()};
    }catch(error){return {ok:false,...fail(submissionAttempted?'PAPER_TRANSPORT_RESULT_UNKNOWN':reserved?'PAPER_RESERVED_ENTRY_BLOCKED':'PAPER_PREPARATION_FAILED',submissionAttempted)};}
    finally{busy=false;try{onChange(snapshot());}catch{}}
  }
  async function reconcile(){
    if(busy||!lastIntent)return {ok:false,...snapshot()};
    armed=false;
    const intent=clone(lastIntent),target=readonlyTarget(context(),intent);
    if(!target){locked=true;return {ok:false,...publish('UNKNOWNLOCK','PAPER_PINNED_RECONCILIATION_TARGET_REQUIRED')};}
    // Past-order observation is allowed after stop/recovery and after the
    // signal lease expires. It never authorizes another entry or rearms.
    armed=false;busy=true;const token=++epoch;
    publish(state,'PAPER_RECONCILING_READONLY');
    try{
      const verified=await verifyResult(intent,{submission:lastSubmission?clone(lastSubmission):null});
      if(token!==epoch||readonlyTarget(context(),intent)!==target){locked=true;return {ok:false,...publish('UNKNOWNLOCK','PAPER_RECONCILIATION_TARGET_CHANGED')};}
      lastResult=clone(verified??{status:'UNKNOWN'});const proven=verifiedState(verified,intent);
      if(!proven){locked=true;return {ok:false,...publish('UNKNOWNLOCK','PAPER_RESULT_REQUIRES_RECONCILIATION')};}
      locked=false;publish(proven,verifiedReason(proven));return {ok:true,...snapshot()};
    }catch{locked=true;return {ok:false,...publish('UNKNOWNLOCK','PAPER_RECONCILIATION_READ_FAILED')};}
    finally{armed=false;busy=false;try{onChange(snapshot());}catch{}}
  }
  return Object.freeze({arm,disarm,accept,reconcile,snapshot});
}
