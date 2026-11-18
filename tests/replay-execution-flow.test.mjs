// Callback/lifecycle simulations only; no actual browser, market approval or
// order is created. The production default engine rejects the manual PASS seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayExecutionFlow} from '../replay-execution-flow.mjs';
import {fixture,bindPublicProof,synchronizeSignal,clone,minute} from './fixtures/replay-execution-fixture.mjs';

const orderId='order_11111111-1111-1111-1111-111111111111';
function harness({realEngine=false}={}){
  const f=fixture(),target={researchUrl:f.uiEvidence.researchUrl,sourceTabId:17,instrument:'CME_MINI:NQ1!',timeframe:'1'},ctx={active:true,generation:1,target},calls={preflight:0,execute:0,verify:0,cancel:0,invalidate:0,reserve:0},keys=new Set();
  let clock=f.now,phase='WORKING',verificationTransform=x=>x,executeHook=null,preflightHook=null,cancelHook=null;
  Object.assign(f.uiEvidence,{pausedReplayVerified:true,capabilities:{ownParentCancelVerified:true,pausedReplayStateVerified:true,domEntryPriceVerified:true}});f.uiEvidence.inventory.visiblePriceBounds={min:27900,max:28100};
  const freshen=()=>{f.now=clock;f.replayWitness.observedAt=clock-10;f.replayWitness.sourceObservedEpochMs=clock-9.5;f.uiEvidence.observedAt=clock-5;f.uiEvidence.inventory.observedAt=clock-5;bindPublicProof(f);};
  const attr=intent=>({kind:'OWN_SUBMITTED_REPLAY_INTENT',key:intent.key,parentOrderId:orderId,sourceTabId:17,runId:intent.sourceBinding.runId,baselineFlatVerified:true,submissionRecorded:true});
  function proof(intent,binding){
    const common={symbol:'NQ1!',direction:intent.direction,quantity:1,entry:intent.entry,stop:intent.stop,target:intent.target,stopTicks:intent.stopTicks,targetTicks:intent.targetTicks,configurationVerified:true,
      expectedPlanComparison:{matches:true,totalPlannedRisk:intent.riskPlan.totalPlannedRisk},observedAt:clock};
    return verificationTransform({provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',pausedReplayVerified:true,attribution:attr(intent),documentTimeOrigin:f.replayWitness.sourceDocumentTimeOrigin,verificationEpochMs:clock+.25,
      ...(phase==='FILLED'?{protectedPosition:{...common,kind:'REPLAY_EXISTING_POSITION_PROTECTION_PUBLIC_V1',status:'PROTECTED_POSITION_VERIFIED',fillVerified:true,protectionVerified:true}}
        :{registeredParent:{...common,kind:'REPLAY_EXISTING_PARENT_MODIFY_PUBLIC_V1',status:'REGISTERED_PARENT_BRACKETS_VERIFIED',orderId,orderType:'LIMIT',bracketsEnabled:true,confirmDisabled:true,fillVerified:false,protectionVerified:false}})},binding,intent);
  }
  const options={getContext:()=>ctx,readSource:async()=>{freshen();return clone(f);},
    preflight:async command=>{calls.preflight++;if(preflightHook)await preflightHook(command);freshen();return clone(f.uiEvidence);},
    executeApproved:async(command,guard)=>{calls.execute++;if(executeHook)return executeHook(command,guard);assert.equal(command.testOnly,true,'injected engine contracts cannot be submitted by the actual native driver');assert.equal(guard.isCurrent(),true);return {status:'SUBMITTED_UNCONFIRMED',submitted:true,key:command.intent.key,submittedAt:clock,ordersCreated:null};},
    verifyResult:async command=>{calls.verify++;return proof(command.intent,command.lifecycleSourceBinding);},
    cancelOwn:async command=>{calls.cancel++;if(cancelHook)return cancelHook(command);assert.equal(command.orderId,orderId);freshen();const inventory=clone(f.uiEvidence.inventory);inventory.sourceFields=clone(command.lifecycleSourceBinding.fields);return {status:'OWN_PARENT_CANCELLED',cancelVerified:true,cancelledOrderId:orderId,pausedReplayVerified:true,attribution:attr(command.intent),inventory};},
    disarmDriver:async()=>{calls.invalidate++;return {status:'DISARMED'};},reserve:async key=>{calls.reserve++;if(keys.has(key))return {ok:false,reason:'DUPLICATE'};keys.add(key);return {ok:true,status:'RESERVED'};},
    now:()=>clock,monotonic:()=>clock,wait:async()=>{},onChange:()=>{}};
  if(!realEngine)options.recomputeAnalysis=()=>clone(f.analysis);
  const flow=createReplayExecutionFlow(options);
  return {flow,f,ctx,target,calls,keys,options,setClock:v=>{clock=v;freshen();},getClock:()=>clock,setPhase:v=>{phase=v;},setVerify:fn=>{verificationTransform=fn;},setExecute:fn=>{executeHook=fn;},setPreflight:fn=>{preflightHook=fn;},setCancel:fn=>{cancelHook=fn;},freshen};
}

test('default full engine rejects manually forged PASS seed before native preflight or reservation',async()=>{
  const h=harness({realEngine:true});assert.equal(h.flow.arm(h.target).ok,true);const r=await h.flow.accept(h.f);
  assert.equal(r.ok,false);assert.equal(r.reason,'REPLAY_FULL_ENGINE_CURRENT_SIGNAL_NOT_REPRODUCED');assert.equal(h.calls.preflight,0);assert.equal(h.calls.execute,0);assert.equal(h.calls.reserve,0);assert.equal(r.ordersCreated,false);
});

test('simulated private attributed parent remains WORKING and never claims active fill protection',async()=>{
  const h=harness();h.flow.arm(h.target);const r=await h.flow.accept(h.f);
  assert.equal(r.ok,true);assert.equal(r.state,'WORKING');assert.equal(r.knownParentOrderId,orderId);assert.equal(r.result.registeredParent.fillVerified,false);assert.equal(r.result.registeredParent.protectionVerified,false);assert.equal(r.engineMode,'INJECTED_COMPONENT_TEST_ENGINE');
  assert.equal(r.intent.entry,28000);assert.equal(r.intent.stop,27990.75);assert.equal(r.intent.riskPlan.totalPlannedRisk,198.1);assert.equal(h.calls.execute,1);assert.equal(h.calls.reserve,1);
  assert.ok(r.timing.sourceToRegisteredVerificationMs>=0);assert.equal(r.timing.marketLatencyMeasured,false);
});

test('missing own cancellation/paused/visible-entry capability never starts a native attempt',async()=>{
  for(const key of ['ownParentCancelVerified','pausedReplayStateVerified','domEntryPriceVerified']){const h=harness();h.f.uiEvidence.capabilities[key]=false;h.flow.arm(h.target);const r=await h.flow.accept(h.f);assert.equal(r.reason,'REPLAY_PASSIVE_LIFECYCLE_CAPABILITIES_NOT_READY');assert.equal(h.calls.execute,0);assert.equal(h.calls.reserve,0);}
  const h=harness();h.f.uiEvidence.inventory.visiblePriceBounds.max=27999;h.flow.arm(h.target);assert.equal((await h.flow.accept(h.f)).reason,'REPLAY_FROZEN_ENTRY_OUTSIDE_VERIFIED_DOM_RANGE');assert.equal(h.calls.execute,0);
});

test('unknown submission locks without any resubmission and matching-looking unowned parent is never promoted',async()=>{
  const h=harness();h.setVerify(result=>{delete result.attribution;return result;});h.flow.arm(h.target);const r=await h.flow.accept(h.f);
  assert.equal(r.state,'UNKNOWNLOCK');assert.equal(r.locked,true);assert.equal(r.ordersCreated,null);assert.equal(h.calls.execute,1);assert.equal(h.calls.verify,6);
  await h.flow.accept(h.f);assert.equal(h.calls.execute,1);assert.equal(h.flow.arm(h.target).ok,false);
  const q=harness();q.setExecute(()=>{throw Error('TRANSPORT_UNKNOWN');});q.flow.arm(q.target);assert.equal((await q.flow.accept(q.f)).state,'UNKNOWNLOCK');assert.equal(q.calls.execute,1);
});

test('same event is not executed twice and pending expiry cancels only the pinned parent with paused native zero proof',async()=>{
  const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);await h.flow.accept(h.f);assert.equal(h.calls.execute,1);
  h.f.replayWitness.current.time+=3*minute;h.f.replayWitness.current.closeTime+=3*minute;h.f.replayWitness.current.providerBarIndex+=3;
  h.f.replayWitness.previous.time+=3*minute;h.f.replayWitness.previous.closeTime+=3*minute;h.f.replayWitness.previous.providerBarIndex+=3;h.f.replayWitness.currentTime=h.f.replayWitness.current.time;h.f.replayWitness.currentCloseTime=h.f.replayWitness.current.closeTime;
  h.f.replayWitness.sequence++;h.freshen();const r=await h.flow.reconcile();assert.equal(r.state,'CANCELLED');assert.equal(h.calls.cancel,1);assert.equal(h.calls.execute,1);
  const repeat=await h.flow.accept(h.f);assert.equal(repeat.ok,false);assert.equal(h.calls.execute,1);
});

test('expiry cannot cancel while Replay is running or after another parent ID appears',async()=>{
  const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);h.setVerify(r=>({...r,pausedReplayVerified:false}));
  const r=await h.flow.reconcile({cancel:true});assert.equal(r.state,'UNKNOWNLOCK');assert.equal(h.calls.cancel,0);
  const q=harness();q.flow.arm(q.target);await q.flow.accept(q.f);q.setVerify(r=>{r.registeredParent.orderId='order_22222222-2222-2222-2222-222222222222';return r;});assert.equal((await q.flow.reconcile({cancel:true})).state,'UNKNOWNLOCK');assert.equal(q.calls.cancel,0);
});

test('uncertain cancellation locks and is never automatically retried by another reconciliation',async()=>{
  const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);h.setCancel(()=>{throw Error('CANCEL_REPLY_UNKNOWN');});
  const first=await h.flow.reconcile({cancel:true});assert.equal(first.state,'UNKNOWNLOCK');assert.equal(first.cancelAttempted,true);
  const second=await h.flow.reconcile({cancel:true});assert.equal(second.state,'UNKNOWNLOCK');assert.equal(second.reason,'REPLAY_CANCEL_ALREADY_ATTEMPTED_RECONCILIATION_ONLY');assert.equal(h.calls.cancel,1);assert.equal(h.calls.execute,1);
});

test('async disarm invalidates native work, cancels a known pending parent and never flattens a protected position',async()=>{
  const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);const stopped=await h.flow.disarm('STOP');assert.equal(stopped.armed,false);assert.equal(stopped.state,'CANCELLED');assert.equal(h.calls.invalidate,1);assert.equal(h.calls.cancel,1);
  const p=harness();p.flow.arm(p.target);await p.flow.accept(p.f);p.setPhase('FILLED');let filled=await p.flow.reconcile();assert.equal(filled.state,'FILLED_PROTECTED');const first=filled.timing.protectedFillVerifiedAt;
  p.setClock(p.getClock()+50);filled=await p.flow.reconcile();assert.equal(filled.timing.protectedFillVerifiedAt,first);await p.flow.disarm('STOP');assert.equal(p.calls.cancel,0);assert.equal(p.calls.invalidate,1);
});

test('a different event after verified cancellation receives its own registration clock and latency',async()=>{
  const h=harness();h.flow.arm(h.target);const first=await h.flow.accept(h.f);
  await h.flow.reconcile({cancel:true});h.setClock(h.getClock()+250);
  const timeKeys=new Set(['time','closeTime','knownAt','asOfTime','formationStartTime','detectedAt','confirmedAt','confirmationBarCloseTime','currentTime','currentCloseTime','matchedClosedBarTime','matchedClosedBarCloseTime','observedCurrentTime','observedCurrentCloseTime']);
  const advance=value=>{if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(timeKeys.has(key)&&Number.isSafeInteger(item))value[key]+=minute;else advance(item);}};
  advance(h.f);h.f.decision.signal.eventId='CME_MINI:NQ1!:1:'+h.f.decision.asOfTime+':LONG';h.f.decision.signal.setupEventIds[0]+=':second';synchronizeSignal(h.f);h.freshen();
  h.setVerify(result=>({...result,verificationEpochMs:result.verificationEpochMs+20}));
  h.flow.arm(h.target);const second=await h.flow.accept(h.f);
  assert.equal(second.state,'WORKING',second.reason);assert.equal(h.calls.execute,2);assert.notEqual(second.intent.key,first.intent.key);
  assert.equal(second.timing.parentRegisteredAt,first.timing.parentRegisteredAt+250);
  assert.equal(second.timing.sourceToRegisteredVerificationMs,first.timing.sourceToRegisteredVerificationMs+20);
  assert.equal(second.timing.protectedFillVerifiedAt,undefined);
});

// Synthetic callback proof contracts only. Native schema/gestures are tested
// separately by the driver and must still be observed in the actual browser.
function protectiveLegProof(result,binding,intent){
  const f=result.protectedPosition,origin=result.documentTimeOrigin,at=result.verificationEpochMs,side=intent.direction==='LONG'?'SELL':'BUY';
  Object.assign(f,{kind:'REPLAY_NATIVE_PROTECTIVE_LEGS_PUBLIC_V1',registeredParentOrderId:orderId,totalPlannedRisk:intent.riskPlan.totalPlannedRisk,documentTimeOrigin:origin,verificationEpochMs:at,
    sourceProof:{kind:'PAUSED_REPLAY_SAME_SOURCE_SCAN',...clone(binding),documentTimeOrigin:origin,stableAcrossScan:true,pausedReplayVerified:true},
    nativeCounter:{kind:'NATIVE_REPLAY_DOM_ACTIVE_ORDER_COUNTER',count:2,quantity:2,side,title:'2 active orders x 2',otherSideCancelDisabled:true},
    nativeLegs:Object.fromEntries([['target','TAKE_PROFIT','TAKEPROFIT',intent.target],['stop','STOP_LOSS','STOPLOSS',intent.stop]].map(([key,role,nativeType,price])=>[key,{kind:'NATIVE_REPLAY_DOM_PROTECTIVE_LEG',role,nativeType,side,quantity:1,price,cellDataQa:'synthetic-public-'+key,sourceFields:clone(binding.fields),documentTimeOrigin:origin,verificationEpochMs:at-.125}]))});
  return result;
}
test('a known own parent plus two exact native leg contracts verifies protection only for the same paused lifecycle source',async()=>{
  const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);h.setPhase('FILLED');h.setVerify(protectiveLegProof);
  const r=await h.flow.reconcile();assert.equal(r.state,'FILLED_PROTECTED');assert.equal(r.result.protectedPosition.kind,'REPLAY_NATIVE_PROTECTIVE_LEGS_PUBLIC_V1');assert.equal(h.calls.execute,1);assert.equal(h.calls.cancel,0);
});
test('missing, wrong-side, stale-source, ambiguous-count and TEST native leg contracts cannot promote a protected fill',async()=>{
  const changes=[f=>{delete f.nativeLegs.stop;},f=>{f.nativeLegs.stop.quantity=2;},f=>{f.nativeLegs.target.side='BUY';},f=>{f.nativeLegs.target.price+=.25;},
    f=>{f.nativeLegs.stop.nativeType='LIMIT';},f=>{f.nativeLegs.stop.sourceFields.ARROW2_SEQ_END='other';},f=>{f.nativeCounter.count=3;},f=>{f.nativeCounter.otherSideCancelDisabled=false;},
    f=>{f.sourceProof.asOfTime-=minute;},f=>{f.sourceProof.stableAcrossScan=false;},f=>{f.sourceProof.pausedReplayVerified=false;},f=>{f.registeredParentOrderId='order_22222222-2222-2222-2222-222222222222';},
    f=>{f.totalPlannedRisk=undefined;},f=>{f.testOnly=true;}];
  for(const change of changes){const h=harness();h.flow.arm(h.target);await h.flow.accept(h.f);h.setPhase('FILLED');h.setVerify((result,binding,intent)=>{protectiveLegProof(result,binding,intent);change(result.protectedPosition);return result;});
    const r=await h.flow.reconcile();assert.equal(r.state,'UNKNOWNLOCK');assert.equal(r.locked,true);assert.equal(h.calls.execute,1);assert.equal(h.calls.cancel,0);
  }
});

test('target or generation changes while preflight awaits prevent reservation and execution',async()=>{
  const h=harness();h.setPreflight(async()=>{h.ctx.generation++;});h.flow.arm(h.target);const r=await h.flow.accept(h.f);assert.equal(r.ok,false);assert.equal(h.calls.reserve,0);assert.equal(h.calls.execute,0);
  const q=harness();q.flow.arm(q.target);await q.flow.accept(q.f);q.ctx.target={...q.target,sourceTabId:99};assert.equal((await q.flow.reconcile({cancel:true})).state,'UNKNOWNLOCK');assert.equal(q.calls.cancel,0);
});

test('disarm racing an awaited preflight or not-yet-clicked native command invalidates the final gesture',async()=>{
  for(const stage of ['PREFLIGHT','EXECUTE']){
    const h=harness();let release;const gate=new Promise(resolve=>{release=resolve;});
    if(stage==='PREFLIGHT')h.setPreflight(()=>gate);
    else h.setExecute(async(command,guard)=>{await gate;assert.equal(guard.isCurrent(),false);return {status:'BLOCKED',submitted:false,reasonCodes:['NATIVE_GENERATION_INVALIDATED']};});
    h.flow.arm(h.target);const accepting=h.flow.accept(h.f);
    for(let n=0;n<20&&(stage==='PREFLIGHT'?h.calls.preflight:h.calls.execute)===0;n++)await Promise.resolve();
    assert.equal(stage==='PREFLIGHT'?h.calls.preflight:h.calls.execute,1);
    const stopping=h.flow.disarm('STOP_DURING_AWAIT');assert.equal(h.flow.snapshot().armed,false);release();await accepting;const stopped=await stopping;
    assert.equal(stopped.armed,false);assert.equal(stopped.submissionAttempted,false);assert.equal(h.calls.invalidate,1);assert.equal(h.calls.cancel,0);
    if(stage==='PREFLIGHT'){assert.equal(h.calls.execute,0);assert.equal(h.calls.reserve,0);}
  }
});

test('LIVE/source rewind and synthetic candidates cannot acquire a native gesture',async()=>{
  const h=harness();h.flow.arm(h.target);h.f.decision.testOnly=true;assert.equal((await h.flow.accept(h.f)).reason,'REPLAY_TEST_OR_SYNTHETIC_CANDIDATE_FORBIDDEN');assert.equal(h.calls.execute,0);
  const q=harness();q.flow.arm(q.target);await q.flow.accept(q.f);q.f.replayWitness.replay=false;assert.equal((await q.flow.reconcile()).state,'UNKNOWNLOCK');assert.equal(q.calls.execute,1);
  for(const change of [f=>{f.analysisInput.options.metadata.synthetic=true;},f=>{f.analysisInput.options.higherTimeframes['5'].metadata.testOnly=true;}]){const s=harness();change(s.f);s.flow.arm(s.target);assert.equal((await s.flow.accept(s.f)).reason,'REPLAY_REAL_SOURCE_INPUT_REQUIRED');assert.equal(s.calls.preflight,0);assert.equal(s.calls.execute,0);}
});

test('injected component engine produces TEST-only command rejected by the actual native boundary',async()=>{
  const h=harness();let observed;h.setExecute(command=>{observed=command;return {status:'BLOCKED',submitted:false,reasonCodes:['TEST_FORBIDDEN']};});h.flow.arm(h.target);const r=await h.flow.accept(h.f);assert.equal(observed.testOnly,true);assert.equal(r.ok,false);assert.equal(r.ordersCreated,false);assert.equal(r.submissionAttempted,false);
});
