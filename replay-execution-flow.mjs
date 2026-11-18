// Pure asynchronous Replay lifecycle. All public UI/ledger actions are injected;
// this module has no DOM, browser, network, broker or order API access.
import {analyzeGuideSignals,GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';
import {prepareReplayExecutionIntent,REPLAY_EXECUTION_PUBLIC_FIELDS} from './replay-execution-intent.mjs';

export const REPLAY_EXECUTION_FLOW_VERSION='replay-execution-flow-1';
const integer=Number.isSafeInteger,finite=Number.isFinite,minute=60000;
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fresh=(at,now,max=2000)=>integer(at)&&at>=0&&at<=now&&now-at<=max;
const targetKey=t=>t&&t.instrument==='CME_MINI:NQ1!'&&t.timeframe==='1'&&integer(t.sourceTabId)&&t.sourceTabId>0&&typeof t.researchUrl==='string'?JSON.stringify([t.researchUrl,t.sourceTabId,t.instrument,t.timeframe]):null;
const uuid=id=>typeof id==='string'&&/^order_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
const comparableSignal=s=>s&&JSON.stringify([s.eventId,s.definitionVersion,s.confirmedAt,s.confirmationBarCloseTime,s.direction,s.confirmationClose,s.invalidation,s.riskPlan]);

/** Callbacks take one serializable command. executeApproved additionally gets
 * {isCurrent} for the OUTER extension wrapper only; never serialize functions.
 * readSource returns {analysisInput, replayWitness, decision?, analysis?}.
 * The default full engine is recomputed; injected engines are unit seams, not
 * source authenticity. Production must retain the default and native driver.
 */
export function createReplayExecutionFlow({getContext,readSource,preflight,executeApproved,verifyResult,cancelOwn,disarmDriver,reserve,
  now=Date.now,monotonic=()=>performance.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onChange=()=>{},recomputeAnalysis=analyzeGuideSignals}={}){
  if([getContext,readSource,preflight,executeApproved,verifyResult,cancelOwn,disarmDriver,reserve,now,monotonic,wait].some(f=>typeof f!=='function'))throw TypeError('REPLAY_FLOW_CALLBACKS_REQUIRED');
  let state='DISARMED',reason='REPLAY_NOT_ARMED',armed=false,busy=false,locked=false,epoch=0,target=null,generation=null;
  let lastIntent=null,lastSubmission=null,lastResult=null,parentOrderId=null,submissionAttempted=false,cancelAttempted=false,registered=false,lastLifecycleAsOf=null;
  const usedKeys=new Set(),journal=[],timing={};
  const snapshot=()=>({version:REPLAY_EXECUTION_FLOW_VERSION,state,reason,armed,busy,inFlight:busy,locked,target:target?clone(target):null,
    intent:lastIntent?clone(lastIntent):null,submission:lastSubmission?clone(lastSubmission):null,result:lastResult?clone(lastResult):null,
    knownParentOrderId:parentOrderId,submissionAttempted,cancelAttempted,pendingOrder:state==='WORKING',needsReconciliation:submissionAttempted&&state!=='CANCELLED',ordersCreated:registered?true:submissionAttempted?null:false,
    timing:clone(timing),journal:clone(journal),realBrokerOrdersAuthorized:false,
    engineMode:recomputeAnalysis===analyzeGuideSignals?'FULL_ENGINE_RECOMPUTED':'INJECTED_COMPONENT_TEST_ENGINE'});
  function publish(next,code){state=next;reason=code;journal.push({state,reason,at:now()});if(journal.length>100)journal.shift();try{onChange(snapshot());}catch{}return snapshot();}
  const context=()=>getContext()??{};
  function current(token){const c=context();return token===epoch&&armed&&!locked&&c.active===true&&c.generation===generation&&targetKey(c.target)===targetKey(target);}
  function pinned(){const c=context();return !!targetKey(target)&&(!c.target||targetKey(c.target)===targetKey(target));}
  function failure(code,unknown=submissionAttempted){if(unknown){armed=false;locked=true;return publish('UNKNOWNLOCK',code);}return publish(armed?'BLOCKED':'DISARMED',code);}
  function arm(requested){
    const c=context();if(busy||locked||submissionAttempted&& !['CANCELLED'].includes(state))return {ok:false,...failure('REPLAY_EXISTING_ATTEMPT_REQUIRES_RECONCILIATION',submissionAttempted)};
    if(!targetKey(requested)||c.active!==true||!integer(c.generation)||targetKey(c.target)!==targetKey(requested))return {ok:false,...failure('REPLAY_ACTIVE_PINNED_RESEARCH_TARGET_REQUIRED',false)};
    target=clone(requested);generation=c.generation;epoch++;armed=true;locked=false;return {ok:true,...publish('ARMED','REPLAY_WAITING_FOR_STRICT_NATURAL_SIGNAL')};
  }
  async function disarm(code='REPLAY_DISARMED'){
    epoch++;armed=false;
    if(submissionAttempted&&!['CANCELLED','FILLED_PROTECTED'].includes(state))locked=true;
    publish(locked?'UNKNOWNLOCK':state==='FILLED_PROTECTED'?'FILLED_PROTECTED':'DISARMED',code);
    try{
      if(target){const ack=await disarmDriver({expected:clone(target),reason:code});if(!['DISARMED','UNKNOWNLOCK'].includes(ack?.status))return {ok:false,...failure('REPLAY_NATIVE_INVALIDATION_UNCONFIRMED',submissionAttempted)};}
      for(let attempt=0;busy&&attempt<40;attempt++)await wait(25);
      if(busy)return {ok:false,...failure('REPLAY_OLD_NATIVE_ATTEMPT_NOT_SETTLED',submissionAttempted)};
      if(submissionAttempted&&!['CANCELLED','FILLED_PROTECTED'].includes(state))return reconcile({cancel:true,reason:code});
      return {ok:true,...publish(state==='FILLED_PROTECTED'?'FILLED_PROTECTED':'DISARMED',code)};
    }catch{return {ok:false,...failure('REPLAY_NATIVE_INVALIDATION_UNCONFIRMED',submissionAttempted)};}
  }
  function bindingFor(intent,bundle){
    const w=bundle?.replayWitness,c=w?.current,p=w?.previous,at=now(),role=c?.closed===true?'current':'previous',closed=role==='current'?c:p;
    if(w?.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||w.mode!=='REPLAY'||w.replay!==true||w.liveEligible!==false||w.checksumsVerified!==true
      ||w.runId!==intent.sourceBinding.runId||w.runEpoch!==intent.sourceBinding.runEpoch||w.sourceDocumentTimeOrigin!==intent.quoteProof.documentTimeOrigin
      ||!fresh(w.observedAt,at)||!finite(w.sourceObservedEpochMs)||w.sourceObservedEpochMs<w.sourceDocumentTimeOrigin
      ||!integer(w.sequence)||!integer(c?.time)||c.closeTime-c.time!==minute||typeof c.closed!=='boolean'||c.closed!==c.sourceClosed
      ||closed?.closed!==true||closed.sourceClosed!==true||!integer(closed.closeTime)||closed.closeTime<intent.sourceBinding.asOfTime||lastLifecycleAsOf!==null&&closed.closeTime<lastLifecycleAsOf
      ||role==='previous'&&closed.closeTime!==c.time||REPLAY_EXECUTION_PUBLIC_FIELDS.some(k=>typeof w.fields?.[k]!=='string'))throw Error('REPLAY_LIFECYCLE_SOURCE_NOT_CURRENT');
    lastLifecycleAsOf=closed.closeTime;
    return {sourceTabId:target.sourceTabId,runId:w.runId,runEpoch:w.runEpoch,eventId:intent.sourceBinding.eventId,
      approvalAsOfTime:intent.sourceBinding.asOfTime,sequence:w.sequence,currentTime:c.time,currentCloseTime:c.closeTime,
      asOfTime:closed.closeTime,closedBarRole:role,fields:clone(w.fields)};
  }
  function attribution(result,intent,id){
    const a=result?.attribution??result?.evidence?.attribution;
    return a?.kind==='OWN_SUBMITTED_REPLAY_INTENT'&&a.key===intent.key&&a.sourceTabId===target.sourceTabId
      &&a.runId===intent.sourceBinding.runId&&a.baselineFlatVerified===true&&a.submissionRecorded===true
      &&uuid(a.parentOrderId)&&(!id||a.parentOrderId===id);
  }
  function nativeLegProtection(f,result,intent,binding){
    const origin=intent.quoteProof.documentTimeOrigin,source=f?.sourceProof,counter=f?.nativeCounter,side=intent.direction==='LONG'?'SELL':'BUY';
    const epoch=value=>finite(value)&&value>=origin&&value<=result.verificationEpochMs;
    if(!binding||f.testOnly===true||f.registeredParentOrderId!==parentOrderId||f.documentTimeOrigin!==origin||result.documentTimeOrigin!==origin||!epoch(f.verificationEpochMs)
      ||!finite(f.totalPlannedRisk)||Math.abs(f.totalPlannedRisk-intent.riskPlan.totalPlannedRisk)>1e-8
      ||source?.kind!=='PAUSED_REPLAY_SAME_SOURCE_SCAN'||source.sourceTabId!==target.sourceTabId
      ||source.runId!==intent.sourceBinding.runId||source.runEpoch!==intent.sourceBinding.runEpoch||source.eventId!==intent.sourceBinding.eventId
      ||source.approvalAsOfTime!==intent.sourceBinding.asOfTime||source.asOfTime!==binding.asOfTime
      ||source.currentTime!==binding.currentTime||source.currentCloseTime!==binding.currentCloseTime
      ||source.documentTimeOrigin!==origin||source.stableAcrossScan!==true||source.pausedReplayVerified!==true
      ||REPLAY_EXECUTION_PUBLIC_FIELDS.some(key=>source.fields?.[key]!==binding.fields[key])
      ||counter?.kind!=='NATIVE_REPLAY_DOM_ACTIVE_ORDER_COUNTER'||counter.count!==2||counter.quantity!==2||counter.side!==side
      ||counter.title!=='2 active orders x 2'||counter.otherSideCancelDisabled!==true||result.pausedReplayVerified!==true)return false;
    return [['target','TAKE_PROFIT','TAKEPROFIT',intent.target],['stop','STOP_LOSS','STOPLOSS',intent.stop]].every(([key,role,type,price])=>{
      const leg=f.nativeLegs?.[key];return leg?.kind==='NATIVE_REPLAY_DOM_PROTECTIVE_LEG'&&leg.role===role&&leg.nativeType===type
        &&leg.side===side&&leg.quantity===1&&leg.price===price&&typeof leg.cellDataQa==='string'&&leg.cellDataQa.length>0&&leg.cellDataQa.length<=256&&!/[\u0000-\u001f\u007f]/.test(leg.cellDataQa)
        &&leg.documentTimeOrigin===origin&&epoch(leg.verificationEpochMs)&&leg.verificationEpochMs<=f.verificationEpochMs
        &&REPLAY_EXECUTION_PUBLIC_FIELDS.every(field=>leg.sourceFields?.[field]===binding.fields[field]);
    });
  }
  function observedState(result,intent,binding){
    const e=result?.evidence??result,p=result?.registeredParent??e?.registeredParent,f=result?.protectedPosition??e?.protectedPosition;
    if(result?.provider!=='REPLAY_TRADING'||result?.mode!=='REPLAY_TRADING'||result.testOnly===true||e?.testOnly===true)return null;
    const matches=p=>p?.symbol==='NQ1!'&&p.direction===intent.direction&&p.quantity===1&&p.entry===intent.entry&&p.stop===intent.stop&&p.target===intent.target
      &&p.stopTicks===intent.stopTicks&&p.targetTicks===intent.targetTicks&&p.configurationVerified===true&&p.expectedPlanComparison?.matches===true
      &&Math.abs(p.expectedPlanComparison.totalPlannedRisk-intent.riskPlan.totalPlannedRisk)<1e-8&&fresh(p.observedAt,now());
    if(p?.kind==='REPLAY_EXISTING_PARENT_MODIFY_PUBLIC_V1'&&p.status==='REGISTERED_PARENT_BRACKETS_VERIFIED'&&p.orderType==='LIMIT'
      &&uuid(p.orderId)&&(!parentOrderId||parentOrderId===p.orderId)&&matches(p)&&p.bracketsEnabled===true&&p.confirmDisabled===true
      &&p.fillVerified===false&&p.protectionVerified===false&&attribution(result,intent,p.orderId))return {state:'WORKING',orderId:p.orderId};
    if(['REPLAY_EXISTING_POSITION_PROTECTION_PUBLIC_V1','REPLAY_NATIVE_PROTECTIVE_LEGS_PUBLIC_V1'].includes(f?.kind)&&f.status==='PROTECTED_POSITION_VERIFIED'&&matches(f)
      &&f.fillVerified===true&&f.protectionVerified===true&&parentOrderId&&attribution(result,intent,parentOrderId)
      &&(f.kind==='REPLAY_EXISTING_POSITION_PROTECTION_PUBLIC_V1'||nativeLegProtection(f,result,intent,binding)))return {state:'FILLED_PROTECTED',orderId:parentOrderId};
    return null;
  }
  function applyProof(result,intent,binding){
    const proof=observedState(result,intent,binding);if(!proof)return false;
    parentOrderId=proof.orderId;registered=true;lastResult=clone(result);timing.lastVerifiedAt=now();
    const sameClock=result.documentTimeOrigin===intent.quoteProof.documentTimeOrigin&&finite(result.verificationEpochMs)
      &&result.verificationEpochMs>=intent.quoteProof.sourceObservedEpochMs;
    timing.measurementScope='FIRST_COHERENT_SOURCE_DOM_TO_NATIVE_PROOF_NOT_MARKET_OR_PHYSICAL_DISPLAY';timing.marketLatencyMeasured=false;
    if(proof.state==='FILLED_PROTECTED'){
      timing.protectedFillVerifiedAt??=now();if(timing.sourceToProtectedVerificationMs===undefined)timing.sourceToProtectedVerificationMs=sameClock?result.verificationEpochMs-intent.quoteProof.sourceObservedEpochMs:null;
      publish('FILLED_PROTECTED','REPLAY_OWN_POSITION_AND_SAVED_PROTECTION_VERIFIED');
    }else{timing.parentRegisteredAt??=now();if(timing.sourceToRegisteredVerificationMs===undefined)timing.sourceToRegisteredVerificationMs=sameClock?result.verificationEpochMs-intent.quoteProof.sourceObservedEpochMs:null;publish('WORKING','REPLAY_OWN_PARENT_REGISTERED_BRACKETS_PENDING_FILL');}
    return true;
  }
  async function pollProof(intent,token){
    for(let attempt=0;attempt<6;attempt++){
      if(!pinned())return false;
      const source=await readSource({expected:clone(target),reason:'RECONCILE'});if(token!==epoch||!pinned())return false;
      const lifecycleSourceBinding=bindingFor(intent,source),reply=await verifyResult({expected:clone(target),intent:clone(intent),lifecycleSourceBinding,knownParentOrderId:parentOrderId,submission:clone(lastSubmission)});
      if(token!==epoch||!pinned())return false;lastResult=clone(reply??{status:'UNKNOWN'});if(applyProof(reply,intent,lifecycleSourceBinding))return true;
      if(attempt<5)await wait(100);
    }
    return false;
  }
  async function accept(candidate){
    if(busy)return {ok:false,...snapshot()};
    if(submissionAttempted&&['WORKING','FILLED_PROTECTED','UNKNOWNLOCK'].includes(state))return reconcile();
    if(!armed||locked)return {ok:false,...snapshot()};
    if([candidate,candidate?.decision,candidate?.decision?.signal].some(v=>v?.testOnly===true||v?.synthetic===true))return {ok:false,...failure('REPLAY_TEST_OR_SYNTHETIC_CANDIDATE_FORBIDDEN',false)};
    if(candidate?.decision?.status!=='CONFIRMED')return {ok:false,...publish('ARMED','REPLAY_WAITING_FOR_STRICT_NATURAL_SIGNAL')};
    const token=epoch;busy=true;
    try{
      if(!current(token))return {ok:false,...failure('REPLAY_ENTRY_CONTEXT_CHANGED',false)};
      const expectedEvent=candidate.decision.signal?.eventId,source=await readSource({expected:clone(target),reason:'ENTRY'});
      if(!current(token))return {ok:false,...failure('REPLAY_ENTRY_CONTEXT_CHANGED',false)};
      const input=clone(source?.analysisInput??source?.analysisInputs),witness=clone(source?.replayWitness);
      if(!input||!witness||source.testOnly===true||source.synthetic===true||input.options?.metadata?.synthetic===true||input.options?.metadata?.testOnly===true
        ||input.options?.metadata?.instrument!=='CME_MINI:NQ1!'||Object.values(input.options?.higherTimeframes??{}).some(h=>h.metadata?.synthetic===true||h.metadata?.testOnly===true))throw Error('REPLAY_REAL_SOURCE_INPUT_REQUIRED');
      const at=monotonic(),analysis=await recomputeAnalysis(input.bars,input.options);timing.recomputeMs=monotonic()-at;
      if(!current(token))return {ok:false,...failure('REPLAY_ENTRY_CONTEXT_CHANGED',false)};
      const asOf=input.options?.asOfTime,signals=analysis?.signals?.filter(s=>s.status==='CONFIRMED'&&s.confirmationBarCloseTime===asOf)??[];
      if(analysis?.definitionVersion!==GUIDE_SIGNAL_VERSION||signals.length!==1||signals[0].eventId!==expectedEvent
        ||candidate.decision.asOfTime!==asOf||comparableSignal(candidate.decision.signal)!==comparableSignal(signals[0]))return {ok:false,...failure('REPLAY_FULL_ENGINE_CURRENT_SIGNAL_NOT_REPRODUCED',false)};
      const signal=signals[0],decision={status:'CONFIRMED',mode:'REPLAY',liveEligible:false,orderEligible:false,execution:'REPLAY_RESEARCH_ONLY',asOfTime:asOf,confirmedAtCurrentClose:1,signal};
      const w=witness,sourceBinding={sourceTabId:target.sourceTabId,runId:w.runId,runEpoch:w.runEpoch,sequence:w.sequence,currentTime:w.currentTime,currentCloseTime:w.currentCloseTime,
        asOfTime:asOf,eventId:signal.eventId,closedBarRole:w.current.closed?'current':'previous',fields:clone(w.fields)};
      publish('PREFLIGHT','REPLAY_READING_NATIVE_ZERO_INVENTORY_AND_PASSIVE_QUOTE');
      const uiEvidence=await preflight({expected:clone(target),sourceBinding,testOnly:recomputeAnalysis!==analyzeGuideSignals,expectedPlan:{direction:signal.direction,quantity:1,entry:signal.riskPlan.plannedEntry,stop:signal.riskPlan.initialStop,target:signal.riskPlan.target,riskPlan:clone(signal.riskPlan)}});
      if(!current(token))return {ok:false,...failure('REPLAY_ENTRY_CONTEXT_CHANGED',false)};
      const prepared=prepareReplayExecutionIntent({decision,analysis,analysisInput:input,replayWitness:witness,uiEvidence,now:now()});
      if(prepared.status!=='PREPARED')return {ok:false,...failure(prepared.reasonCodes.join(' · '),false)};
      const intent=clone(prepared.intent);
      if(uiEvidence.pausedReplayVerified!==true||uiEvidence.capabilities?.pausedReplayStateVerified!==true
        ||uiEvidence.capabilities?.ownParentCancelVerified!==true||uiEvidence.capabilities?.domEntryPriceVerified!==true)return {ok:false,...failure('REPLAY_PASSIVE_LIFECYCLE_CAPABILITIES_NOT_READY',false)};
      const bounds=uiEvidence.inventory?.visiblePriceBounds;if(!finite(bounds?.min)||!finite(bounds?.max)||intent.entry<bounds.min||intent.entry>bounds.max)return {ok:false,...failure('REPLAY_FROZEN_ENTRY_OUTSIDE_VERIFIED_DOM_RANGE',false)};
      if(usedKeys.has(intent.key))return {ok:false,...failure('REPLAY_EVENT_ALREADY_RESERVED',false)};
      const reservation=await reserve(intent.key,{eventId:signal.eventId,asOfTime:asOf,sourceTabId:target.sourceTabId,runId:witness.runId});
      if(!current(token))return {ok:false,...failure('REPLAY_ENTRY_CONTEXT_CHANGED',false)};
      if(reservation?.ok!==true)return {ok:false,...failure(reservation?.reason??'REPLAY_DURABLE_RESERVATION_REJECTED',false)};
      usedKeys.add(intent.key);
      // A cancelled parent permits a different event. Its verification times
      // must not inherit the previous event's first-registration latency.
      const recomputeMs=timing.recomputeMs;for(const key of Object.keys(timing))delete timing[key];timing.recomputeMs=recomputeMs;
      lastIntent=clone(intent);lastSubmission=null;lastResult=null;parentOrderId=null;registered=false;cancelAttempted=false;lastLifecycleAsOf=intent.sourceBinding.asOfTime;
      timing.sourceObservedEpochMs=witness.sourceObservedEpochMs;timing.executionStartedAt=now();publish('SUBMITTING','REPLAY_SINGLE_PASSIVE_NATIVE_ATTEMPT');submissionAttempted=true;
      // A substituted engine is an explicit component-test seam. Its command
      // remains TEST-only so the actual native driver must reject submission.
      const reply=await executeApproved({expected:clone(target),intent:clone(intent),testOnly:recomputeAnalysis!==analyzeGuideSignals},{isCurrent:()=>current(token)&&now()<=intent.expiresAt});
      lastSubmission=clone(reply??{status:'UNKNOWN'});lastResult=clone(lastSubmission);
      if(reply?.submitted===false)submissionAttempted=false;
      if(!current(token))return {ok:false,...failure('REPLAY_SOURCE_OR_ARM_CHANGED_DURING_NATIVE_ATTEMPT',submissionAttempted)};
      if(reply?.status!=='SUBMITTED_UNCONFIRMED'||reply.submitted!==true)return {ok:false,...failure(reply?.reasonCodes?.join(' · ')??reply?.status??'REPLAY_SUBMISSION_RESULT_UNKNOWN',submissionAttempted)};
      timing.submissionReplyAt=now();
      if(!await pollProof(intent,token))return {ok:false,...failure('REPLAY_OWN_PARENT_OR_PROTECTED_FILL_NOT_VERIFIED',true)};
      return {ok:true,...snapshot()};
    }catch(error){return {ok:false,...failure(error?.message??'REPLAY_FLOW_FAILED',submissionAttempted)};}
    finally{busy=false;try{onChange(snapshot());}catch{}}
  }
  async function reconcile({cancel=false,reason:cancelReason=null}={}){
    if(state==='CANCELLED')return {ok:true,...snapshot()};
    if(busy||!lastIntent||!submissionAttempted)return {ok:false,...snapshot()};
    busy=true;const token=epoch,intent=clone(lastIntent);
    try{
      if(!pinned())return {ok:false,...failure('REPLAY_PINNED_LIFECYCLE_TARGET_CHANGED',true)};
      const source=await readSource({expected:clone(target),reason:'RECONCILE'});if(token!==epoch||!pinned())return {ok:false,...failure('REPLAY_LIFECYCLE_CONTEXT_CHANGED',true)};
      const lifecycleSourceBinding=bindingFor(intent,source),reply=await verifyResult({expected:clone(target),intent,lifecycleSourceBinding,knownParentOrderId:parentOrderId,submission:clone(lastSubmission)});
      if(token!==epoch||!pinned())return {ok:false,...failure('REPLAY_LIFECYCLE_CONTEXT_CHANGED',true)};
      lastResult=clone(reply??{status:'UNKNOWN'});if(!applyProof(reply,intent,lifecycleSourceBinding))return {ok:false,...failure('REPLAY_OWN_ORDER_RECONCILIATION_UNVERIFIED',true)};
      const expired=lifecycleSourceBinding.asOfTime>=intent.pendingPolicy.expiresAtReplayCloseTime;
      if(state==='WORKING'&&(cancel||expired)){
        if(cancelAttempted)return {ok:false,...failure('REPLAY_CANCEL_ALREADY_ATTEMPTED_RECONCILIATION_ONLY',true)};
        if(reply.pausedReplayVerified!==true||!uuid(parentOrderId))return {ok:false,...failure('REPLAY_PAUSED_OWN_PARENT_CANCELLATION_REQUIRED',true)};
        const id=parentOrderId;publish('CANCELLING',cancelReason??(expired?'REPLAY_PENDING_LIMIT_EXPIRED':'REPLAY_CANCEL_OWN_PARENT'));
        cancelAttempted=true;
        const result=await cancelOwn({expected:clone(target),intent,lifecycleSourceBinding,orderId:id,parentOrderId:id,reason:cancelReason??(expired?'EXPIRED':'DISARMED')});
        if(token!==epoch||!pinned())return {ok:false,...failure('REPLAY_CANCEL_RESULT_REQUIRES_RECONCILIATION',true)};
        const inv=result?.inventory;
        if(result?.status!=='OWN_PARENT_CANCELLED'||result.cancelVerified!==true||result.cancelledOrderId!==id
          ||result.pausedReplayVerified!==true||!attribution(result,intent,id)||inv?.kind!=='REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1'
          ||inv.status!=='FLAT_NO_PENDING'||inv.provider!=='REPLAY_TRADING'||inv.instrument!=='CME_MINI:NQ1!'||inv.timeframe!=='1'
          ||inv.researchUrl!==target.researchUrl||inv.sourceTabId!==target.sourceTabId||inv.documentTimeOrigin!==intent.quoteProof.documentTimeOrigin
          ||!['flat','positionsComplete','workingOrdersComplete','positionEmpty','pendingEmpty','buyCancelDisabled','sellCancelDisabled'].every(k=>inv[k]===true)
          ||inv.positionMarker!=='—'||inv.pnlMarker!=='—'||REPLAY_EXECUTION_PUBLIC_FIELDS.some(k=>inv.sourceFields?.[k]!==lifecycleSourceBinding.fields[k])
          ||!Array.isArray(inv.positions)||inv.positions.length||!Array.isArray(inv.workingOrders)||inv.workingOrders.length||!fresh(inv.observedAt,now()))return {ok:false,...failure('REPLAY_OWN_PARENT_CANCELLATION_NOT_VERIFIED',true)};
        lastResult=clone(result);locked=false;publish('CANCELLED','REPLAY_EXACT_PARENT_CANCELLED_AND_NATIVE_ZERO_VERIFIED');
      }
      return {ok:true,...snapshot()};
    }catch(error){return {ok:false,...failure(error?.message??'REPLAY_RECONCILIATION_FAILED',true)};}
    finally{busy=false;try{onChange(snapshot());}catch{}}
  }
  return Object.freeze({arm,disarm,accept,reconcile,snapshot});
}
