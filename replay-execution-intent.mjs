// Pure, unsigned Replay Trading ticket plan. No DOM, network, order or submission
// primitive exists here. Caller-supplied proof coherence is checked; this module
// cannot attest DOM provenance or replace full engine / actual fill verification.
import {planGuideRisk,roundGuidePriceToTick} from './guide-risk.mjs';
import {GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';

export const REPLAY_EXECUTION_INTENT_VERSION='replay-execution-intent-2';
export const REPLAY_EXECUTION_INTENT_LIMITS=Object.freeze({evidenceAgeMs:2000,inventoryAgeMs:750,maxBars:600,maxEvents:5000,maxSetups:32});
export const REPLAY_EXECUTION_PUBLIC_FIELDS=Object.freeze(['ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN','ARROW2_SEQ_END',
  'ARROW2_CURRENT_TIME','ARROW2_CURRENT_CLOSE_TIME','ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B']);
const instrument='CME_MINI:NQ1!',minute=60000,origin=1577836800000,scalarBase=1000000000000;
const flags=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checkIds=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
const finite=Number.isFinite,integer=Number.isSafeInteger;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const text=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*Number.EPSILON*32;
const tick=value=>finite(value)&&value>0&&Number.isSafeInteger(value/.25);
const fresh=(at,now)=>integer(at)&&at>=0&&at<=now&&now-at<=REPLAY_EXECUTION_INTENT_LIMITS.evidenceAgeMs;
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function canonical(value,budget={nodes:0},depth=0){
  if(++budget.nodes>50000||depth>32)throw Error('BOUNDED_PROOF_REQUIRED');
  if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=16384||finite(value))return JSON.stringify(value);
  if(Array.isArray(value)&&value.length<=5000)return '['+value.map(item=>canonical(item,budget,depth+1)).join(',')+']';
  if(plain(value)&&Object.keys(value).length<=1000)return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>{
    if(!text(key,256))throw Error('BOUNDED_PROOF_REQUIRED');
    return JSON.stringify(key)+':'+canonical(value[key],budget,depth+1);
  }).join(',')+'}';
  throw Error('JSON_PROOF_REQUIRED');
}
const equal=(left,right)=>canonical(left)===canonical(right);
const clone=value=>JSON.parse(canonical(value));
function metadata(meta,timeframe='1',explicitReplay=true){
  if(!plain(meta)||meta.source!=='ohlc'||meta.instrument!==instrument||meta.timeframe!==timeframe||meta.timeframeMs!==Number(timeframe)*minute
    ||meta.tickSize!==.25||meta.pointValue!==20||meta.currency!=='USD'||meta.chartType!=='standard'
    ||(explicitReplay?meta.replay!==true||meta.realtime!==false:meta.replay===false||meta.realtime===true)
    ||meta.synthetic===true||meta.testOnly===true||!text(meta.session,100)||!text(meta.timezone,100))return false;
  try{new Intl.DateTimeFormat('en',{timeZone:meta.timezone});return true;}catch{return false;}
}
function bar(value,duration,{source=false,closed=true}={}){
  return plain(value)&&integer(value.time)&&value.time>=origin&&integer(value.closeTime)&&value.closeTime-value.time===duration
    &&['open','high','low','close'].every(key=>tick(value[key]))&&value.high>=Math.max(value.open,value.close)
    &&value.low<=Math.min(value.open,value.close)&&value.high>=value.low
    &&(value.volume==null||finite(value.volume)&&value.volume>=0)
    &&(closed?value.closed===true:typeof value.closed==='boolean')
    &&(!source||typeof value.sourceClosed==='boolean'&&value.sourceClosed===value.closed);
}
const ohlcMatches=(a,b)=>a.time===b.time&&a.closeTime===b.closeTime&&['open','high','low','close'].every(key=>a[key]===b[key]);
function series(bars,duration,asOfTime,minBars=1){
  return Array.isArray(bars)&&bars.length>=minBars&&bars.length<=REPLAY_EXECUTION_INTENT_LIMITS.maxBars
    &&bars.every((item,index)=>bar(item,duration)&&item.knownAt===item.closeTime&&item.closeTime<=asOfTime
      &&(!index||item.time===bars[index-1].closeTime));
}
function renderedInteger(value){
  if(!text(value,128))return null;
  const normalized=value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[ ,\u00a0\u202f\u2009]/g,'').replace(/\u2212/g,'-');
  return /^[+-]?\d+(?:\.0+)?$/.test(normalized)&&integer(Number(normalized))?Number(normalized):null;
}
function publicFields(witness){
  if(!plain(witness.fields)||REPLAY_EXECUTION_PUBLIC_FIELDS.some(key=>!text(witness.fields[key],128)))return false;
  const raw=Object.fromEntries(REPLAY_EXECUTION_PUBLIC_FIELDS.map(key=>[key,renderedInteger(witness.fields[key])]));
  if(Object.values(raw).some(value=>value===null)||raw.ARROW2_RUN_EPOCH!==witness.runEpoch
    ||raw.ARROW2_SEQ_BEGIN!==witness.sequence||raw.ARROW2_SEQ_END!==witness.sequence
    ||raw.ARROW2_CHECKSUM_A<0||raw.ARROW2_CHECKSUM_A>=1000000007
    ||raw.ARROW2_CHECKSUM_B<0||raw.ARROW2_CHECKSUM_B>=1000000009)return false;
  const tag=witness.sequence%4096,current=witness.current;
  if(!integer(current.providerBarIndex)||current.providerBarIndex<0||typeof current.sessionFirst!=='boolean'||typeof current.sessionLast!=='boolean')return false;
  const carrier=current.providerBarIndex*4+(current.sessionFirst?1:0)+(current.sessionLast?2:0);
  return integer(carrier)&&carrier<scalarBase&&Math.floor(raw.ARROW2_CURRENT_TIME/scalarBase)===tag
    &&raw.ARROW2_CURRENT_TIME%scalarBase+origin===current.time
    &&Math.floor(raw.ARROW2_CURRENT_CLOSE_TIME/scalarBase)===tag&&raw.ARROW2_CURRENT_CLOSE_TIME%scalarBase===carrier;
}
function frozenFilters(value){
  return plain(value)&&flags.every(key=>value.config?.[key]===true)
    &&value.contextConfig?.roleReversalEnabled===true&&value.contextConfig?.supplyDemandEnabled===true;
}
function passedChecks(snapshot){
  return snapshot?.passed===true&&Array.isArray(snapshot.checks)&&snapshot.checks.length<=64
    &&checkIds.every(id=>{const matching=snapshot.checks.filter(check=>check?.id===id);return matching.length===1
      &&['required','enabled','available','passed'].every(key=>matching[0][key]===true)&&matching[0].state==='PASS';});
}
const riskMatches=(a,b)=>['riskBudget','maxContracts','pointValue','commissionPerContract','slippageTicks','rewardRisk'].every(key=>near(a?.[key],b?.[key]))&&equal(a,b);
function safeResearchUrl(value){
  if(!text(value,500))return false;
  try{const url=new URL(value);return url.protocol==='https:'&&['tradingview.com','www.tradingview.com'].includes(url.hostname)
    &&/^\/chart\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
}

/** uiEvidence.sourceBinding pins the exact seven public witness strings plus
 * run/cursor/cutoff/event. The fresh DOM zero inventory and Order quotes must
 * agree with source CURRENT.close, at least one tick beyond the frozen entry
 * on the passive side. Initial ticket entry/toggles are not the approved plan:
 * PREPARED is only an unsigned plan. A UI executor must freshly validate the
 * enabled absolute-price bracket ticket, source and account before any gesture.
 */
export function prepareReplayExecutionIntent(request={}){
  const base={kind:'TRADINGVIEW_REPLAY_EXECUTION_INTENT',definitionVersion:REPLAY_EXECUTION_INTENT_VERSION,
    status:'BLOCKED',reasonCodes:[],intent:null,unsigned:true,ordersCreated:false,submissionAuthorized:false,
    orderEligible:false,realBrokerOrdersAuthorized:false};
  const block=reason=>freeze({...base,reasonCodes:[reason]});
  try{
    const {decision,analysis,analysisInput,replayWitness,uiEvidence,now}=request??{};
    if(!integer(now)||now<0)return block('REPLAY_RECEIVER_TIME_REQUIRED');
    if([decision,analysis,analysisInput,replayWitness,uiEvidence].some(value=>!plain(value)||value.testOnly===true||value.synthetic===true))return block('REPLAY_NONTEST_PROOFS_REQUIRED');
    const witness=replayWitness,input=analysisInput,options=input.options,asOf=input.options?.asOfTime;
    if(witness.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||witness.mode!=='REPLAY'||witness.replay!==true
      ||witness.liveEligible!==false||witness.checksumsVerified!==true||typeof witness.pineRealtimeExecution!=='boolean'
      ||!integer(witness.runEpoch)||witness.runEpoch<origin||!integer(witness.sequence)||witness.sequence<0
      ||witness.sequence>Math.floor((Number.MAX_SAFE_INTEGER-7)/8)||witness.runId!==instrument+'|1|'+witness.runEpoch
      ||!metadata(witness.metadata,'1',false)||!bar(witness.current,minute,{source:true,closed:false})
      ||witness.currentTime!==witness.current.time||witness.currentCloseTime!==witness.current.closeTime||!publicFields(witness))return block('REPLAY_COHERENT_PUBLIC_WITNESS_REQUIRED');
    // Date.now freshness and source-document performance epochs are different
    // clock domains. Actual captures show a several-second affine offset.
    // Keep the wall observation lease; use performance epochs only with their
    // own document origin and native same-clock verification receipts.
    if(!fresh(witness.observedAt,now)||!finite(witness.sourceObservedEpochMs)||witness.sourceObservedEpochMs<0
      ||!finite(witness.sourceDocumentTimeOrigin)||witness.sourceDocumentTimeOrigin<origin
      ||witness.sourceDocumentTimeOrigin>witness.sourceObservedEpochMs)return block('REPLAY_FRESH_PUBLIC_OBSERVATION_REQUIRED');
    const closedRole=witness.current.closed?'current':'previous',closed=witness[closedRole];
    if(!bar(closed,minute,{source:true})||closedRole==='previous'&&closed.closeTime!==witness.current.time)return block('REPLAY_PROVIDER_CLOSED_CUTOFF_REQUIRED');
    const cutoff=input.cutoff;
    if(input.mode!=='REPLAY'||input.liveEligible!==false||input.orderEligible!==false||!metadata(options?.metadata)
      ||witness.metadata.timezone!==options.metadata.timezone||witness.metadata.session!==options.metadata.session
      ||!integer(asOf)||asOf!==closed.closeTime||decision.asOfTime!==asOf||analysis.asOfTime!==asOf
      ||cutoff?.asOfTime!==asOf||cutoff.exactTimeAndOhlcMatch!==true||cutoff.selectedClosedBarRole!==closedRole
      ||cutoff.matchedClosedBarTime!==closed.time||cutoff.matchedClosedBarCloseTime!==closed.closeTime
      ||cutoff.observedCurrentTime!==witness.currentTime||cutoff.observedCurrentCloseTime!==witness.currentCloseTime
      ||cutoff.observedCurrentProviderFinal!==witness.current.closed||cutoff.openCurrentExcluded!==!witness.current.closed
      ||!series(input.bars,minute,asOf)||!ohlcMatches(input.bars.at(-1),closed))return block('REPLAY_EXACT_CURRENT_CLOSED_PREFIX_REQUIRED');
    for(const timeframe of ['5','15']){
      const higher=options.higherTimeframes?.[timeframe];
      if(!plain(higher)||higher.timeframe!==timeframe||higher.timeframeMs!==Number(timeframe)*minute
        ||!metadata(higher.metadata,timeframe)||higher.metadata.timezone!==options.metadata.timezone
        ||higher.metadata.session!==options.metadata.session||!series(higher.bars,Number(timeframe)*minute,asOf,20))return block('REPLAY_NATIVE_CAUSAL_HIGHER_TIMEFRAMES_REQUIRED');
    }
    if(!metadata(analysis.metadata)||analysis.metadata.timezone!==options.metadata.timezone
      ||analysis.metadata.session!==options.metadata.session||analysis.execution!=='OBSERVATION_ONLY'
      ||analysis.orderEligible!==false||analysis.dataQuality?.valid!==true||analysis.sourceKind!=='original_research_definition'
      ||analysis.definitionVersion!==GUIDE_SIGNAL_VERSION||!frozenFilters(options)
      ||!frozenFilters(analysis.parameterSnapshot))return block('REPLAY_STRICT_ANALYSIS_CONFIGURATION_REQUIRED');
    const risk=options.risk;
    if(!plain(risk)||risk.riskBudget!==200||risk.maxContracts!==1||risk.pointValue!==20
      ||!finite(risk.commissionPerContract)||risk.commissionPerContract<0||risk.commissionPerContract>200
      ||!finite(risk.slippageTicks)||risk.slippageTicks<0||risk.slippageTicks>40
      ||!finite(risk.rewardRisk)||risk.rewardRisk<=0||!riskMatches(risk,analysis.parameterSnapshot.risk))return block('REPLAY_EXPLICIT_ONE_CONTRACT_COSTS_REQUIRED');
    const signal=decision.signal;
    if(decision.mode!=='REPLAY'||decision.liveEligible!==false||decision.orderEligible!==false||decision.execution!=='REPLAY_RESEARCH_ONLY'
      ||decision.status!=='CONFIRMED'||decision.confirmedAtCurrentClose!==1||!plain(signal)
      ||signal.testOnly===true||signal.status!=='CONFIRMED'||signal.execution!=='OBSERVATION_ONLY'||signal.orderEligible!==false
      ||signal.instrument!==instrument||signal.timeframe!=='1'||signal.definitionVersion!==analysis.definitionVersion||!['LONG','SHORT'].includes(signal.direction)
      ||!text(signal.eventId)||signal.eventId!==instrument+':1:'+asOf+':'+signal.direction
      ||signal.confirmedAt!==asOf||signal.confirmationBarCloseTime!==asOf||signal.confirmationClose!==closed.close
      ||signal.confirmationPolicy!=='later_close_beyond_setup'||!frozenFilters(signal.parameterSnapshot)
      ||!passedChecks(signal.contextSnapshot)||!riskMatches(risk,signal.parameterSnapshot.risk))return block('REPLAY_FROZEN_CURRENT_CONFIRMATION_REQUIRED');
    if(!Array.isArray(analysis.signals)||analysis.signals.length>600||!Array.isArray(analysis.events)
      ||analysis.events.length>REPLAY_EXECUTION_INTENT_LIMITS.maxEvents)return block('REPLAY_BOUNDED_ENGINE_LEDGER_REQUIRED');
    const currentSignals=analysis.signals.filter(item=>item?.status==='CONFIRMED'&&item.confirmationBarCloseTime===asOf);
    if(currentSignals.length!==1||!equal(currentSignals[0],signal))return block('REPLAY_DECISION_ENGINE_EVENT_MISMATCH');
    if(!Array.isArray(signal.setupEventIds)||signal.setupEventIds.length<1||signal.setupEventIds.length>32
      ||new Set(signal.setupEventIds).size!==signal.setupEventIds.length||signal.setupEventIds.some(id=>!text(id)))return block('REPLAY_SETUP_EVENT_LEDGER_REQUIRED');
    const setups=signal.setupEventIds.map(id=>analysis.events.filter(event=>event?.eventId===id));
    if(setups.some(matches=>matches.length!==1||matches[0].definitionVersion!==GUIDE_SIGNAL_VERSION
      ||matches[0].execution!=='OBSERVATION_ONLY'||matches[0].orderEligible!==false
      ||matches[0].instrument!==instrument||matches[0].timeframe!=='1'||matches[0].status!=='CONFIRMED'||matches[0].direction!==signal.direction
      ||matches[0].confirmedAt!==asOf||matches[0].confirmationBarCloseTime!==asOf||matches[0].confirmationClose!==closed.close
      ||!frozenFilters(matches[0].parameterSnapshot)||!passedChecks(matches[0].contextSnapshot)))return block('REPLAY_SETUP_EVENT_LEDGER_REQUIRED');
    const representative=setups[0][0];
    if(['signalStartIndex','signalIndex','confirmationIndex','formationStartTime','detectedAt','invalidation','trigger','confirmationClose'].some(key=>representative[key]!==signal[key])
      ||!equal(representative.riskPlan,signal.riskPlan)||!equal(representative.contextSnapshot,signal.contextSnapshot)
      ||!equal(representative.parameterSnapshot,signal.parameterSnapshot))return block('REPLAY_REPRESENTATIVE_SETUP_MISMATCH');
    const {signalStartIndex:start,signalIndex:end,confirmationIndex:confirm}=signal,bars=input.bars;
    if(![start,end,confirm].every(integer)||start<0||end<start||confirm<=end||confirm!==bars.length-1
      ||signal.formationStartTime!==bars[start].time||signal.detectedAt!==bars[end].knownAt
      ||signal.detectedAt>=asOf||!tick(signal.trigger)||!tick(signal.invalidation)
      ||!(signal.direction==='LONG'?closed.close>signal.trigger:closed.close<signal.trigger))return block('REPLAY_LATER_CLOSED_CONFIRMATION_REQUIRED');
    const reference=signal.stopReference,formation=bars.slice(start,end+1);
    if(!plain(reference)||!['formation','signal_bar'].includes(reference.mode)||!integer(reference.bufferTicks)
      ||reference.bufferTicks<0||reference.bufferTicks>1000)return block('REPLAY_UNCHANGED_STRUCTURAL_STOP_REQUIRED');
    const structural=reference.mode==='signal_bar'?[bars[end]]:formation,
      low=Math.min(...structural.map(item=>item.low)),high=Math.max(...structural.map(item=>item.high)),long=signal.direction==='LONG';
    const expectedStop=roundGuidePriceToTick((long?low:high)+(long?-1:1)*reference.bufferTicks*.25,.25,long?'DOWN':'UP');
    if(reference.low!==low||reference.high!==high||signal.invalidation!==expectedStop
      ||bars.slice(end+1,confirm).some(item=>long?item.close<signal.invalidation:item.close>signal.invalidation))return block('REPLAY_UNCHANGED_STRUCTURAL_STOP_REQUIRED');
    const plan=signal.riskPlan;
    if(!plain(plan)||plan.status!=='PLANNED'||plan.quantity!==1||plan.ordersCreated!==false||plan.fillInferred!==false
      ||plan.plannedEntry!==signal.confirmationClose||plan.effectiveEntry!==plan.plannedEntry||plan.actualEntry!==null
      ||plan.initialStop!==signal.invalidation||![plan.plannedEntry,plan.initialStop,plan.target].every(tick))return block('REPLAY_UNCHANGED_STRUCTURAL_PLAN_REQUIRED');
    const computed=planGuideRisk({...risk,direction:signal.direction,entry:plan.plannedEntry,stop:signal.invalidation,
      target:plan.target,tickSize:.25,stopBufferTicks:0});
    if(computed.status!=='PLANNED'||computed.quantity!==1||computed.totalPlannedRisk>200)return block('REPLAY_TOTAL_PLANNED_RISK_EXCEEDS_200_USD');
    if(['plannedEntry','effectiveEntry','initialStop','target','riskTicks','perContractRisk','totalPlannedRisk','commissionAllowance','slippageAllowance'].some(key=>!near(plan[key],computed[key])))return block('REPLAY_RISK_ARITHMETIC_MISMATCH');
    const ui=uiEvidence,binding=ui.sourceBinding,ticket=ui.ticket;
    if(ui.status!=='REPLAY_TRADING_UI_VERIFIED'||ui.provider!=='REPLAY_TRADING'||ui.mode!=='REPLAY_TRADING'
      ||ui.replay!==true||ui.chartCount!==1||ui.instrument!==instrument||ui.timeframe!=='1'||ui.flat!==true
      ||ui.positionsComplete!==true||ui.workingOrdersComplete!==true
      ||!Array.isArray(ui.positions)||ui.positions.length||!Array.isArray(ui.workingOrders)||ui.workingOrders.length
      ||!integer(ui.sourceTabId)||ui.sourceTabId<1||!safeResearchUrl(ui.researchUrl)||!fresh(ui.observedAt,now))return block('REPLAY_TRADING_VISIBLE_FLAT_RESEARCH_UI_REQUIRED');
    if(!plain(binding)||binding.runId!==witness.runId||binding.runEpoch!==witness.runEpoch||binding.sequence!==witness.sequence
      ||binding.currentTime!==witness.currentTime||binding.currentCloseTime!==witness.currentCloseTime||binding.asOfTime!==asOf
      ||binding.eventId!==signal.eventId||REPLAY_EXECUTION_PUBLIC_FIELDS.some(key=>binding.fields?.[key]!==witness.fields[key]))return block('REPLAY_UI_CURSOR_EVENT_OR_PUBLIC_FIELDS_CHANGED');
    const inventory=ui.inventory;
    if(!plain(inventory)||inventory.kind!=='REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1'||inventory.status!=='FLAT_NO_PENDING'
      ||inventory.provider!=='REPLAY_TRADING'||inventory.scope!=='CURRENT_REPLAY_SYMBOL_ONLY'||inventory.instrument!==instrument||inventory.timeframe!=='1'
      ||inventory.researchUrl!==ui.researchUrl||inventory.sourceTabId!==ui.sourceTabId||!fresh(inventory.observedAt,now)||now-inventory.observedAt>REPLAY_EXECUTION_INTENT_LIMITS.inventoryAgeMs
      ||inventory.documentTimeOrigin!==witness.sourceDocumentTimeOrigin||inventory.positionMarker!=='—'||inventory.pnlMarker!=='—'
      ||!['buyCancelDisabled','sellCancelDisabled','positionEmpty','pendingEmpty','flat','positionsComplete','workingOrdersComplete'].every(key=>inventory[key]===true)
      ||!Array.isArray(inventory.positions)||inventory.positions.length||!Array.isArray(inventory.workingOrders)||inventory.workingOrders.length
      ||!equal(inventory.sourceBinding,binding)||REPLAY_EXECUTION_PUBLIC_FIELDS.some(key=>inventory.sourceFields?.[key]!==witness.fields[key]))return block('REPLAY_NATIVE_COMPLETE_ZERO_INVENTORY_REQUIRED');
    if(!plain(ticket)||ticket.stage!=='NEW_ORDER_TICKET'||ticket.symbol!=='NQ1!'||ticket.type!=='LIMIT'||ticket.quantity!==1||ticket.tickValue!==5
      ||!tick(ticket.entry)||!tick(ticket.quote)||ticket.bid!==ticket.quote||ticket.ask!==ticket.quote
      ||ticket.quote!==witness.current.close||inventory.quote!==ticket.quote
      ||ticket.stopMode!=='PRICE'||ticket.targetMode!=='PRICE')return block('REPLAY_LIMIT_TICKET_QUOTE_OR_UNITS_MISMATCH');
    const distanceTicks=(ticket.quote-computed.plannedEntry)*(long?1:-1)/.25;
    if(!integer(distanceTicks)||distanceTicks<1)return block('REPLAY_MARKETABLE_LIMIT_BRACKET_UNSAFE');
    const sourceBinding={sourceTabId:ui.sourceTabId,runId:witness.runId,runEpoch:witness.runEpoch,sequence:witness.sequence,
      currentTime:witness.currentTime,currentCloseTime:witness.currentCloseTime,asOfTime:asOf,eventId:signal.eventId,
      closedBarRole:closedRole,fields:Object.fromEntries(REPLAY_EXECUTION_PUBLIC_FIELDS.map(key=>[key,witness.fields[key]]))};
    // Quote, sequence and CURRENT/PREVIOUS cursor role intentionally do not
    // change this reservation: one confirmed event is one entry per source run.
    const key=[REPLAY_EXECUTION_INTENT_VERSION,ui.researchUrl,ui.sourceTabId,witness.runId,asOf,signal.eventId].map(encodeURIComponent).join(':');
    const expiresAfterClosedBars=signal.parameterSnapshot.config.entryExpiryBars??signal.expiresAfterBars??signal.parameterSnapshot.config.expiryBars??3;
    if(!integer(expiresAfterClosedBars)||expiresAfterClosedBars<1||expiresAfterClosedBars>100)return block('REPLAY_PENDING_EXPIRY_POLICY_REQUIRED');
    const intent={kind:'TRADINGVIEW_REPLAY_TRADING_LIMIT_INTENT',definitionVersion:REPLAY_EXECUTION_INTENT_VERSION,key,
      provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',scope:'VIRTUAL_REPLAY_TRADING_INTENT_ONLY',unsigned:true,
      direction:signal.direction,action:long?'Buy':'Sell',orderType:'LIMIT',symbol:'NQ1!',instrument,timeframe:'1',quantity:1,
      entry:computed.plannedEntry,stop:computed.initialStop,target:computed.target,stopMode:'PRICE',targetMode:'PRICE',
      stopTicks:computed.riskTicks,targetTicks:Math.abs(computed.target-computed.plannedEntry)/.25,
      preparedAt:now,expiresAt:Math.min(ui.observedAt,witness.observedAt)+2000,researchUrl:ui.researchUrl,sourceBinding,
      quoteProof:{kind:'PASSIVE_NATIVE_REPLAY_QUOTE',quote:ticket.quote,bid:ticket.bid,ask:ticket.ask,observedAt:ui.observedAt,
        sourceCurrentClose:witness.current.close,sourceObservedEpochMs:witness.sourceObservedEpochMs,documentTimeOrigin:inventory.documentTimeOrigin,minimumDistanceTicks:1,distanceTicks,pricesAdjusted:false},
      approvalProof:{engineDefinitionVersion:GUIDE_SIGNAL_VERSION,eventId:signal.eventId,asOfTime:asOf,direction:signal.direction,
        confirmationPolicy:signal.confirmationPolicy,detectedAt:signal.detectedAt,confirmationBarCloseTime:signal.confirmationBarCloseTime,
        signalApproved:true,testOnly:false,requiredChecks:checkIds.map(id=>{const check=signal.contextSnapshot.checks.find(row=>row.id===id);return Object.fromEntries(['id','required','enabled','available','passed','state'].map(key=>[key,check[key]]));}),
        requiredFlags:Object.fromEntries(flags.map(key=>[key,true])),roleReversalEnabled:true,supplyDemandEnabled:true},
      pendingPolicy:{kind:'KNOWN_PARENT_ONLY_CLOSED_REPLAY_BAR_EXPIRY',expiresAfterClosedBars,afterConfirmationClose:asOf,
        expiresAtReplayCloseTime:asOf+expiresAfterClosedBars*minute,cancelOnlyWhileReplayPaused:true,neverCancelAll:true},
      riskPlan:clone(computed),signalApproved:true,testOnly:false,ordersCreated:false,submissionAuthorized:false,
      orderEligible:false,realBrokerOrdersAuthorized:false,requiresReplayUiRevalidation:true,
      proofScope:'CALLER_SUPPLIED_PROOF_COHERENCE_NOT_DOM_PROVENANCE_OR_FULL_ENGINE_ATTESTATION',
      riskScope:'PLANNED_RISK_NOT_REALIZED_LOSS_GUARANTEE'};
    return freeze({...base,status:'PREPARED',intent});
  }catch{return block('REPLAY_INVALID_OR_UNBOUNDED_PROOF');}
}
