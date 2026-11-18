// Directional rule observations only. Risk diagnostics are deliberately kept
// separate; nothing in this module authorizes an order or predicts a profit.
import {GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';
import {PATTERN_DEFINITION_VERSION} from './candle-patterns.mjs';
import {GUIDE_STRATEGY_POLICY,getGuideStrategyProfile,validateGuideStrategyProof} from './guide-strategy-policy.mjs';

export const GUIDE_TECHNICAL_DECISION_VERSION='guide-technical-decision-1';
export const GUIDE_TECHNICAL_CHECK_IDS=Object.freeze(['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME']);
const flags=['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'];
const riskReasons=new Set(['INVALID_DIRECTION','INVALID_PRICE','INSTRUMENT_METADATA_REQUIRED','EXPLICIT_RISK_CONFIGURATION_REQUIRED','INVALID_RISK_CONFIGURATION','INVALID_DAILY_RISK_REMAINING','INVALID_CONSECUTIVE_LOSS_CONFIGURATION','CONSECUTIVE_LOSS_LIMIT','DAILY_RISK_EXHAUSTED','NO_RISK_BUDGET','STOP_NOT_ON_PROTECTIVE_SIDE','UNSAFE_TICK_COORDINATES','ACTUAL_ENTRY_OFF_TICK','ENTRY_REPRICED','NONFINITE_RISK','TARGET_NOT_ON_PROFIT_SIDE','INSUFFICIENT_REWARD_RISK','STRUCTURAL_ROOM_INSUFFICIENT','OBSTACLE_BEFORE_TARGET','RISK_BUDGET_BELOW_ONE_CONTRACT']);
const finite=Number.isFinite,integer=Number.isSafeInteger,plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const time=x=>finite(x)&&x>=0&&x<=8640000000000000,clone=x=>structuredClone(x);
const frozenFlags=p=>plain(p)&&flags.every(key=>p.config?.[key]===true)&&p.contextConfig?.roleReversalEnabled===true&&p.contextConfig?.supplyDemandEnabled===true;
const strategyMode=p=>p?.config?.strategyPolicy===GUIDE_STRATEGY_POLICY;
const knownPolicy=p=>strategyMode(p)?p.contextConfig?.roleReversalEnabled===true&&p.contextConfig?.supplyDemandEnabled===true:(p?.config?.strategyPolicy===undefined||p.config.strategyPolicy==='configured')&&frozenFlags(p);
const eventStrategyValid=event=>{
  const profile=getGuideStrategyProfile(event.strategyId),config=event.parameterSnapshot?.config,flagsByCheck={KNOWN_LOCATION:'requireLocation',EMA:'requireEma',FIB:'requireFib',TRENDLINE:'requireTrendline',SUPPLY_DEMAND:'requireSupplyDemand',HIGHER_TIMEFRAME:'requireHigherTimeframe'};
  return !!profile&&event.contextSnapshot?.passed===true&&Object.entries(flagsByCheck).every(([id,key])=>config?.[key]===profile.requiredCheckIds.includes(id))
    &&config?.minConditions===profile.requiredCheckIds.length&&validateGuideStrategyProof(event.strategyProof,{eventId:event.eventId,checks:event.contextSnapshot.checks,patternIds:event.patternIds,setupKind:event.contextSnapshot.setupKind});
};
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
function seven(snapshot){return snapshot?.passed===true&&Array.isArray(snapshot.checks)&&snapshot.checks.length===7&&GUIDE_TECHNICAL_CHECK_IDS.every(id=>{
  const rows=snapshot.checks.filter(row=>row?.id===id);return rows.length===1&&['required','enabled','available','passed'].every(key=>rows[0][key]===true)&&rows[0].state==='PASS'&&rows[0].pendingConfirmation!==true;
});}
function riskOnly(event){
  if(event.status!=='REJECTED'||!Array.isArray(event.reasonCodes))return false;
  if(event.reasonCodes.length===1&&event.reasonCodes[0]==='RISK_PARAMETERS_REQUIRED')return event.riskPlan==null&&event.parameterSnapshot?.config?.requireRisk===true;
  const reasons=event.riskPlan?.reasonCodes;
  return event.riskPlan?.status==='BLOCKED'&&Array.isArray(reasons)&&reasons.length>0&&reasons.length<=32&&reasons.every(code=>riskReasons.has(code))
    &&JSON.stringify(event.reasonCodes)===JSON.stringify(['RISK_REJECTED',...reasons]);
}
function diagnostic(event){return {sourceEventStatus:event.status,status:event.riskPlan?.status??'NOT_PROVIDED',rejectedByRisk:event.status==='REJECTED',
  reasonCodes:event.status==='REJECTED'?[...event.reasonCodes]:[],sizingOrRiskApprovalGranted:false};}

/** Omitted bars are copied from the engine's closed pattern ledger, exactly as
 * describeGuideAnalysis builds entry-model inputs. No closed flag or timestamp
 * is invented. Supplied bars must match that same ledger exactly.
 */
export function selectGuideTechnicalDecision(input={}){
  const {analysis,bars,asOfTime=analysis?.asOfTime}=input??{};
  const profilesMode=strategyMode(analysis?.parameterSnapshot),approvalPolicy=profilesMode?GUIDE_STRATEGY_POLICY:'all_seven';
  const synthetic=analysis?.metadata?.synthetic===true||analysis?.synthetic===true,testOnly=synthetic||analysis?.metadata?.testOnly===true||analysis?.testOnly===true;
  const base={kind:'GUIDE_TECHNICAL_DIRECTION_DECISION',definitionVersion:GUIDE_TECHNICAL_DECISION_VERSION,engineVersion:GUIDE_SIGNAL_VERSION,status:'BLOCKED',direction:null,asOfTime:time(asOfTime)?asOfTime:null,
    currentClosedBarCloseTime:null,signal:null,historicalSignals:[],conflicts:[],reasonCodes:[],execution:'OBSERVATION_ONLY',orderEligible:false,profitabilityVerified:false,synthetic,testOnly,
    proofScope:'FULL_ENGINE_EVENT_COHERENCE_NOT_MARKET_AUTHENTICATION_OR_ORDER_AUTHORIZATION',approvalPolicy};
  const block=code=>freeze({...base,reasonCodes:[code]});
  try{
    if(!plain(analysis)||analysis.definitionVersion!==GUIDE_SIGNAL_VERSION||analysis.sourceKind!=='original_research_definition'||analysis.execution!=='OBSERVATION_ONLY'||analysis.orderEligible!==false
      ||analysis.dataQuality?.valid!==true||analysis.status==='BLOCKED'||!time(asOfTime)||analysis.asOfTime!==asOfTime||!knownPolicy(analysis.parameterSnapshot))return block('VALID_STRICT_FULL_ENGINE_ANALYSIS_REQUIRED');
    const meta=analysis.metadata,patterns=analysis.patterns;
    if(!plain(meta)||meta.source!=='ohlc'||!text(meta.instrument,200)||!text(meta.timeframe,32)||!integer(meta.timeframeMs)||meta.timeframeMs<=0||!finite(meta.tickSize)||meta.tickSize<=0||!['standard','candles'].includes(meta.chartType))return block('TECHNICAL_STANDARD_OHLC_IDENTITY_REQUIRED');
    if(patterns?.definitionVersion!==PATTERN_DEFINITION_VERSION||patterns.sourceKind!=='original_research_definition'||patterns.status!=='OK'||patterns.config?.mode!=='closed'||patterns.config?.unit!=='price'||patterns.config?.requireTimestamps!==true
      ||patterns.config.tickSize!==meta.tickSize||!Array.isArray(patterns.byBar)||patterns.byBar.length<1||patterns.byBar.length>4096||patterns.byBar.length>analysis.parameterSnapshot.config.maxBars)return block('MATCHING_CLOSED_PATTERN_LEDGER_REQUIRED');
    const rows=patterns.byBar,derived=rows.map(row=>({...row?.ohlc,time:row?.time,closeTime:row?.closeTime,knownAt:row?.knownAt,closed:row?.closed}));
    const selected=bars??derived,tick=x=>finite(x)&&x>0&&Math.abs(x/meta.tickSize-Math.round(x/meta.tickSize))<=1e-7;
    if(!Array.isArray(selected)||selected.length!==rows.length)return block('TECHNICAL_CLOSED_BAR_LEDGER_MISMATCH');
    for(let index=0;index<selected.length;index++){
      const b=selected[index],r=rows[index],known=b?.knownAt??b?.closeTime,previous=selected[index-1];
      if(!plain(b)||!integer(b.time)||!integer(b.closeTime)||b.time<0||b.closeTime-b.time!==meta.timeframeMs||b.closed!==true||b.sourceClosed===false
        ||!time(known)||known<b.closeTime||known>asOfTime||b.closeTime>asOfTime||previous&&(b.time<previous.closeTime||known<(previous.knownAt??previous.closeTime))
        ||!['open','high','low','close'].every(key=>tick(b[key]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low
        ||r?.barIndex!==index||r.closed!==true||r.available!==true||r.time!==b.time||r.closeTime!==b.closeTime||r.knownAt!==known||['open','high','low','close'].some(key=>r.ohlc?.[key]!==b[key]))return block('TECHNICAL_CLOSED_BAR_LEDGER_MISMATCH');
    }
    const cutoff=selected.at(-1).closeTime;
    if(!Array.isArray(analysis.events)||analysis.events.length>10000||analysis.events.some(e=>!plain(e)||!text(e.eventId))||new Set(analysis.events.map(e=>e.eventId)).size!==analysis.events.length)return block('BOUNDED_UNIQUE_ENGINE_EVENT_LEDGER_REQUIRED');
    const candidates=[],engineConflicts=new Map();
    for(const event of analysis.events){
      if(event.status==='AMBIGUOUS'&&event.reasonCodes?.includes('CONFLICTING_CONFIRMED_DIRECTIONS')&&time(event.confirmationBarCloseTime)&&event.confirmationBarCloseTime<=asOfTime){
        const ids=engineConflicts.get(event.confirmationBarCloseTime)??[];ids.push(event.eventId);engineConflicts.set(event.confirmationBarCloseTime,ids);continue;
      }
      if(event.status!=='CONFIRMED'&&!riskOnly(event))continue;
      const start=event.signalStartIndex,end=event.signalIndex,confirm=event.confirmationIndex,formation=selected[start],detected=selected[end],closed=selected[confirm];
      if(event.definitionVersion!==GUIDE_SIGNAL_VERSION||event.execution!=='OBSERVATION_ONLY'||event.orderEligible!==false||event.instrument!==meta.instrument||event.timeframe!==meta.timeframe||!text(event.setupId,100)||!['LONG','SHORT'].includes(event.direction)
        ||![start,end,confirm].every(integer)||start<0||end<start||confirm<=end||!formation||!detected||!closed||event.confirmationPolicy!=='later_close_beyond_setup'
        ||event.formationStartTime!==formation.time||event.detectedAt!==(detected.knownAt??detected.closeTime)||event.knownAt!==event.detectedAt||event.detectedAt>=event.confirmedAt
        ||event.confirmedAt!==(closed.knownAt??closed.closeTime)||event.confirmationBarCloseTime!==closed.closeTime||event.confirmationClose!==closed.close||event.confirmedAt>asOfTime
        ||event.invalidatedAt!=null||event.expiresAt!=null||!integer(event.expiresAfterBars)||confirm-end>event.expiresAfterBars||!tick(event.trigger)||!tick(event.invalidation)
        ||!(event.direction==='LONG'?closed.close>event.trigger&&closed.close>event.invalidation:closed.close<event.trigger&&closed.close<event.invalidation)
        ||strategyMode(event.parameterSnapshot)!==profilesMode||!knownPolicy(event.parameterSnapshot)||!(profilesMode?eventStrategyValid(event):seven(event.contextSnapshot))||!Array.isArray(event.patternIds)||event.patternIds.length<1||event.patternIds.length>64||event.patternIds.some(id=>!text(id,100)))return block(profilesMode?'TECHNICAL_LATER_CLOSE_OR_STRATEGY_PROOF_INVALID':'TECHNICAL_LATER_CLOSE_OR_ALL_SEVEN_PROOF_INVALID');
      if(event.status==='CONFIRMED'&&(JSON.stringify(event.reasonCodes)!==JSON.stringify(['LATER_CLOSED_BAR_CONFIRMED'])||event.riskPlan!=null&&event.riskPlan.status!=='PLANNED'||event.riskPlan==null&&event.parameterSnapshot.config.requireRisk!==false))return block('TECHNICAL_EVENT_STATUS_INCONSISTENT');
      candidates.push(event);
    }
    const groups=new Map();for(const event of candidates){const group=groups.get(event.confirmationBarCloseTime)??[];group.push(event);groups.set(event.confirmationBarCloseTime,group);}
    const signals=[],conflicts=[];
    for(const close of [...new Set([...groups.keys(),...engineConflicts.keys()])].sort((a,b)=>a-b)){
      const group=groups.get(close)??[],directions=[...new Set(group.map(e=>e.direction))];
      if(engineConflicts.has(close)||directions.length>1){conflicts.push({confirmationBarCloseTime:close,sourceEventIds:[...new Set([...group.map(e=>e.eventId),...(engineConflicts.get(close)??[])])].sort(),reason:'CONFLICTING_TECHNICAL_DIRECTIONS',orderEligible:false});continue;}
      if(!group.length)continue;group.sort((a,b)=>a.eventId.localeCompare(b.eventId));
      const proofGroups=new Map();if(profilesMode)for(const event of group){const members=proofGroups.get(event.strategyId)??[];members.push(event);proofGroups.set(event.strategyId,members);}
      const strategyProofs=[...proofGroups.entries()].map(([profileId,members])=>{const profile=getGuideStrategyProfile(profileId);return {profileId,requiredCheckIds:[...profile.requiredCheckIds],requiredChecks:profile.requiredCheckIds.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),sourceEventIds:members.map(e=>e.eventId)};});
      const requiredIds=profilesMode?new Set(strategyProofs.flatMap(p=>p.requiredCheckIds)):new Set(GUIDE_TECHNICAL_CHECK_IDS);
      const first=group[0],signal={kind:'GUIDE_TECHNICAL_DIRECTION_SIGNAL',definitionVersion:GUIDE_TECHNICAL_DECISION_VERSION,engineVersion:GUIDE_SIGNAL_VERSION,status:'CONFIRMED',approvalPolicy,...(profilesMode?{strategyProofs}:{}),
        eventId:['technical',GUIDE_TECHNICAL_DECISION_VERSION,meta.instrument,meta.timeframe,close,first.direction].join(':'),instrument:meta.instrument,timeframe:meta.timeframe,direction:first.direction,
        confirmationClose:first.confirmationClose,confirmedAt:first.confirmedAt,confirmationBarCloseTime:close,sourceEventIds:group.map(e=>e.eventId),setupIds:[...new Set(group.map(e=>e.setupId))],patternIds:[...new Set(group.flatMap(e=>e.patternIds))].sort(),
        requiredChecks:GUIDE_TECHNICAL_CHECK_IDS.filter(id=>requiredIds.has(id)).map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'})),
        setups:group.map(e=>({eventId:e.eventId,setupId:e.setupId,...(profilesMode?{strategyId:e.strategyId,strategyProof:clone(e.strategyProof)}:{}),direction:e.direction,formationStartTime:e.formationStartTime,detectedAt:e.detectedAt,confirmedAt:e.confirmedAt,confirmationBarCloseTime:e.confirmationBarCloseTime,confirmationClose:e.confirmationClose,structuralInvalidation:e.invalidation,riskDiagnostic:diagnostic(e)})),
        execution:'OBSERVATION_ONLY',orderEligible:false,profitabilityVerified:false,synthetic,testOnly,selectionPolicy:'COMPATIBLE_SETUPS_MERGED_NO_BEST_SETUP_RANKING'};signals.push(signal);
    }
    const currentConflict=conflicts.some(c=>c.confirmationBarCloseTime===cutoff),signal=signals.find(s=>s.confirmationBarCloseTime===cutoff)??null;
    return freeze({...base,status:currentConflict?'AMBIGUOUS':signal?'CONFIRMED':'NO_APPROVAL',direction:currentConflict?null:signal?.direction??null,currentClosedBarCloseTime:cutoff,signal:currentConflict?null:signal,
      historicalSignals:signals.filter(s=>s.confirmationBarCloseTime<cutoff),conflicts,reasonCodes:currentConflict?['CONFLICTING_TECHNICAL_DIRECTIONS']:signal?[profilesMode?'STRATEGY_REQUIRED_CHECKS_AND_LATER_CLOSE_CONFIRMED_RISK_SEPARATE':'ALL_SEVEN_AND_LATER_CLOSE_CONFIRMED_RISK_SEPARATE']:['NO_TECHNICAL_APPROVAL_AT_LATEST_CLOSED_BAR']});
  }catch{return block('TECHNICAL_DECISION_INPUT_INVALID');}
}

// Corroboration can veto an execution approval; it can never create one.
export function corroborateGuideTechnicalDecision(decision,signal){
  const reject=code=>({passed:false,reasonCodes:[code],orderAuthorizationGranted:false});
  if(decision?.kind!=='GUIDE_TECHNICAL_DIRECTION_DECISION'||decision.definitionVersion!==GUIDE_TECHNICAL_DECISION_VERSION||decision.engineVersion!==GUIDE_SIGNAL_VERSION||decision.status!=='CONFIRMED'||!decision.signal||decision.orderEligible!==false)return reject('TECHNICAL_DIRECTION_NOT_UNAMBIGUOUS');
  const technical=decision.signal,ids=signal?.setupEventIds;
  if(!plain(signal)||signal.status!=='CONFIRMED'||signal.definitionVersion!==GUIDE_SIGNAL_VERSION||signal.instrument!==technical.instrument||signal.timeframe!==technical.timeframe||signal.direction!==technical.direction
    ||signal.confirmationBarCloseTime!==technical.confirmationBarCloseTime||signal.confirmationClose!==technical.confirmationClose||signal.confirmedAt!==technical.confirmedAt
    ||!Array.isArray(ids)||ids.length<1||new Set(ids).size!==ids.length||ids.some(id=>!technical.sourceEventIds.includes(id)))return reject('TECHNICAL_EXECUTION_APPROVAL_MISMATCH');
  return {passed:true,reasonCodes:[],orderAuthorizationGranted:false};
}
