// Pure callback simulations using artificial full-engine OHLC. No real tab,
// native preset, market approval, order or fill is authenticated by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
import {createUserMarketExecutionFlow} from '../user-market-execution-flow.mjs';
const model=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
const baseNow=Date.UTC(2026,10,15,6),target={researchUrl:'https://www.tradingview.com/chart/MarketFixture1/',sourceTabId:17,instrument:'CME_MINI:NQ1!',timeframe:'1'};
function fullModel(direction='LONG'){
  const f=structuredClone(model),metadata=m=>({...m,instrument:'CME_MINI:NQ1!',synthetic:false,testOnly:false});f.options.metadata=metadata(f.options.metadata);f.options.risk.riskBudget=50;
  for(const h of Object.values(f.options.higherTimeframes)){h.instrument='CME_MINI:NQ1!';h.metadata=metadata(h.metadata);}
  if(direction==='SHORT'){const mirror=b=>({...b,open:56676-b.open,high:56676-b.low,low:56676-b.high,close:56676-b.close});f.bars=f.bars.map(mirror);for(const h of Object.values(f.options.higherTimeframes))h.bars=h.bars.map(mirror);}
  const analysis=analyzeGuideSignals(f.bars,f.options),technicalDecision=selectGuideTechnicalDecision({analysis});assert.equal(analysis.signals.length,0);assert.equal(technicalDecision.status,'CONFIRMED');
  return {analysis,technicalDecision,input:{bars:f.bars,options:f.options}};
}
const models={LONG:fullModel('LONG'),SHORT:fullModel('SHORT')};
function harness({direction='LONG',quantity=1,realEngine=false,modelOverride=null}={}){
  const model=modelOverride??models[direction],input=structuredClone(model.input),analysis=model.analysis,candidate={technicalDecision:structuredClone(model.technicalDecision)},ctx={active:true,generation:1,target,sourceSessionId:'LOCAL_CALLBACK_SIMULATION',sourceRunId:'CME_MINI:NQ1!|1|'+(baseNow-60000)},calls={read:0,preset:0,reserve:0,submit:0,verify:0,disarm:0},reserved=new Set();
  let clock=baseNow,submitHook=null,presetHook=null,verifyTransform=x=>x,readTransform=x=>x;
  const witness={kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,checksumsVerified:true,runId:ctx.sourceRunId,runEpoch:baseNow-60000,sequence:17,
    metadata:structuredClone(input.options.metadata),current:{...structuredClone(input.bars.at(-1)),sourceClosed:true,providerBarIndex:124,sessionFirst:false,sessionLast:false},previous:{...structuredClone(input.bars.at(-2)),sourceClosed:true,providerBarIndex:123,sessionFirst:false,sessionLast:false},sourceDocumentTimeOrigin:baseNow-400000};
  const source=()=>{witness.observedAt=clock-10;witness.sourceObservedEpochMs=clock-4654.9;witness.currentTime=witness.current.time;witness.currentCloseTime=witness.current.closeTime;const tag=witness.sequence%4096;
    witness.fields={ARROW2_RUN_EPOCH:String(witness.runEpoch),ARROW2_SEQ_BEGIN:String(witness.sequence),ARROW2_SEQ_END:String(witness.sequence),ARROW2_CURRENT_TIME:String(tag*1e12+witness.current.time-1577836800000),ARROW2_CURRENT_CLOSE_TIME:String(tag*1e12+witness.current.providerBarIndex*4),ARROW2_CHECKSUM_A:'424242',ARROW2_CHECKSUM_B:'656565'};
    return readTransform({analysisInput:input,replayWitness:structuredClone(witness)});};
  const options={getContext:()=>ctx,readSource:async()=>{calls.read++;return source();},
    readPresetAndInventory:async command=>{calls.preset++;const raw=String(quantity),control='input#dom-quantity-input[data-qa-id~="qty-dom-input"]',preset={kind:'NATIVE_REPLAY_DOM_MARKET_QUANTITY_V1',symbol:'NQ1!',quantity,quantityRaw:raw,sourceControl:control,scope:'NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED',bracketPresetVerified:false,fingerprint:JSON.stringify(['native-replay-dom-market-quantity-1','NQ1!',quantity,raw,control])};
      const reply={status:'USER_MARKET_NATIVE_READY',provider:'REPLAY_TRADING',mode:'USER_MARKET',observedAt:clock-1,documentTimeOrigin:witness.sourceDocumentTimeOrigin,sourceBinding:structuredClone(command.sourceBinding),sourceFields:structuredClone(witness.fields),nativeSide:direction==='LONG'?'BUY':'SELL',preset,
        lease:{id:'synthetic-private-lease',observedAt:clock-1,expiresAt:clock+700,maximumAgeMs:750},inventory:{kind:'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1',status:'FLAT_NO_PENDING',provider:'REPLAY_TRADING',scope:'CURRENT_REPLAY_SYMBOL_ONLY',sourceTabId:17,researchUrl:target.researchUrl,instrument:'CME_MINI:NQ1!',timeframe:'1',observedAt:clock-1,documentTimeOrigin:witness.sourceDocumentTimeOrigin,
          flat:true,positionEmpty:true,pendingEmpty:true,positionsComplete:true,workingOrdersComplete:true,buyCancelDisabled:true,sellCancelDisabled:true,positionMarker:'—',pnlMarker:'—',positions:[],workingOrders:[],quote:witness.current.close,sourceFields:structuredClone(witness.fields)}};
      if(presetHook)await presetHook(reply,command);return reply;},
    reserve:async(key,record)=>{calls.reserve++;if(reserved.has(key))return {ok:false,reason:'ALREADY_RESERVED'};reserved.add(key);return {ok:true,status:'RESERVED'};},
    submitMarket:async(command,guard)=>{calls.submit++;assert.equal(guard.isCurrent(),true);assert.equal(command.testOnly,!realEngine);if(submitHook)return submitHook(command,guard);return {status:'USER_MARKET_SUBMITTED_UNCONFIRMED',submitted:true,key:command.intent.key};},
    verifySubmission:async command=>{calls.verify++;const b=command.lifecycleSourceBinding,intent=command.intent;return verifyTransform({status:'USER_MARKET_FILLED',provider:'REPLAY_TRADING',mode:'USER_MARKET',submitted:true,ordersCreated:true,fillVerified:true,protectionVerified:false,userManaged:true,
      attribution:{kind:'OWN_USER_MARKET_SUBMISSION',key:intent.key,sourceTabId:17,runId:ctx.sourceRunId,baselineFlatVerified:true,submissionRecorded:true},position:{kind:'NATIVE_REPLAY_DOM_USER_MARKET_POSITION_V1',symbol:'NQ1!',direction:intent.direction,quantity:intent.quantity,entry:witness.current.close,sourceFields:structuredClone(b.fields),observedAt:clock,documentTimeOrigin:witness.sourceDocumentTimeOrigin,verificationEpochMs:clock-4500}},command);},
    disarmDriver:async()=>{calls.disarm++;return {status:'DISARMED'};},now:()=>clock,monotonic:()=>clock,wait:async()=>{}};
  if(!realEngine)options.recomputeAnalysis=()=>analysis;
  const flow=createUserMarketExecutionFlow(options);candidate.replayWitness=structuredClone(source().replayWitness);candidate.sessionId=ctx.sourceSessionId;candidate.sourceTabId=target.sourceTabId;
  return {flow,candidate,ctx,calls,options,witness,reserved,input,
    setFormingQuote:quote=>{const previous=structuredClone(witness.current);witness.previous=previous;witness.current={...previous,time:previous.closeTime,closeTime:previous.closeTime+60000,open:previous.close,high:Math.max(previous.close,quote),low:Math.min(previous.close,quote),close:quote,closed:false,sourceClosed:false,providerBarIndex:previous.providerBarIndex+1};},
    setRead:f=>{readTransform=f;},setPreset:f=>{presetHook=f;},setSubmit:f=>{submitHook=f;},setVerify:f=>{verifyTransform=f;},setClock:value=>{clock=value;}};
}
test('default full engine permits technical LONG and SHORT despite real sizing rejection, copying the observed user quantity unchanged',async()=>{
  for(const direction of ['LONG','SHORT']){const h=harness({direction,quantity:3,realEngine:true});assert.equal(h.flow.snapshot().armed,false);assert.equal(h.flow.arm(target).ok,true);const r=await h.flow.accept(h.candidate);
    assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.intent.quantity,3);assert.equal(r.intent.direction,direction);assert.equal(r.intent.bracketPresetVerified,false);assert.equal(h.calls.submit,1);assert.equal(h.calls.reserve,1);assert.equal(r.realBrokerOrdersAuthorized,false);assert.equal(r.postFillManagement,false);assert.equal(r.armed,false);
    for(const key of ['riskPlan','riskBudget','stop','target','stopTicks','targetTicks'])assert.equal(Object.hasOwn(r.intent,key),false);
    assert.ok(r.intent.sharedReservationKey.startsWith('replay-execution-intent-2:'));assert.equal(r.timing.sameSourceDocumentClockVerified,true);assert.ok(r.timing.sourceToFillVerificationMs>0);
  }
});

test('source-specific full-engine approval reaches one simulated Market attempt with its real strategy proof and no universal filter or money gate',async()=>{
  for(const direction of ['LONG','SHORT']){
    const input=structuredClone(models[direction].input);input.options.config.strategyPolicy='guide_scenarios_v1';input.options.config.requireRisk=false;input.options.risk=null;
    const analysis=analyzeGuideSignals(input.bars,input.options),technicalDecision=selectGuideTechnicalDecision({analysis});assert.equal(technicalDecision.status,'CONFIRMED');assert.equal(technicalDecision.signal.approvalPolicy,'guide_scenarios_v1');
    const h=harness({direction,quantity:1,realEngine:true,modelOverride:{input,analysis,technicalDecision}});h.flow.arm(target);const result=await h.flow.accept(h.candidate);
    assert.equal(result.state,'FILLED_USER_MANAGED');assert.equal(h.calls.submit,1);assert.equal(h.calls.reserve,1);assert.equal(result.intent.approvalProof.approvalPolicy,'guide_scenarios_v1');
    assert.deepEqual(result.intent.approvalProof.strategyProofs,technicalDecision.signal.strategyProofs);assert.equal(Object.hasOwn(result.intent.approvalProof,'requiredFlags'),false);
    assert.equal(result.intent.quantity,1);assert.equal(result.intent.presetProtectionRequired,false);assert.equal(result.intent.riskManagement,'USER_MANAGED_NOT_CALCULATED');
    assert.equal(result.intent.realBrokerOrdersAuthorized,false);assert.equal(result.protectionVerified,false);
  }
});

test('Chrome dictionary key ordering cannot change a valid source binding, while exact schema and values remain required',async()=>{
  const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
  for(const direction of ['LONG','SHORT']){
    const h=harness({direction,realEngine:true});h.setPreset((reply,command)=>{reply.sourceBinding=sorted(reply.sourceBinding);assert.notEqual(JSON.stringify(reply.sourceBinding),JSON.stringify(command.sourceBinding));reply.sourceFields=sorted(reply.sourceFields);reply.inventory.sourceFields=sorted(reply.inventory.sourceFields);});
    h.flow.arm(target);const result=await h.flow.accept(h.candidate);assert.equal(result.state,'FILLED_USER_MANAGED');assert.equal(h.calls.reserve,1);assert.equal(h.calls.submit,1);
  }
  for(const change of [b=>{b.extra='unexpected';},b=>{delete b.direction;},b=>{b.direction='SHORT';},b=>{b.fields.extra='unexpected';},b=>{b.fields.ARROW2_SEQ_END='changed';}]){
    const h=harness();h.setPreset(reply=>{reply.sourceBinding=sorted(reply.sourceBinding);change(reply.sourceBinding);});h.flow.arm(target);const result=await h.flow.accept(h.candidate);assert.equal(result.reason,'USER_MARKET_NATIVE_ZERO_INVENTORY_REQUIRED');assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);
  }
});
test('arm is explicit, session-pinned, and an unapproved/ambiguous technical candidate cannot reach native controls',async()=>{
  const h=harness();assert.equal((await h.flow.accept(h.candidate)).submissionAttempted,false);assert.equal(h.calls.read,0);
  h.ctx.sourceRunId=null;assert.equal(h.flow.arm(target).ok,false);h.ctx.sourceRunId=h.witness.runId;h.flow.arm(target);h.candidate.technicalDecision.status='AMBIGUOUS';await h.flow.accept(h.candidate);assert.equal(h.calls.read,0);assert.equal(h.calls.preset,0);assert.equal(h.calls.submit,0);
});
test('no incomplete, nonflat, stale, wrong-side or invented-preset native evidence can reserve or submit',async()=>{
  for(const change of [r=>{r.inventory.positions=[{quantity:1}];},r=>{r.inventory.pendingEmpty=false;},r=>{r.inventory.workingOrdersComplete=false;},r=>{r.inventory.quote+=.25;},r=>{r.nativeSide='SELL';},r=>{r.preset.fingerprint='invented';},r=>{r.preset.bracketPresetVerified=true;},r=>{r.lease.observedAt-=751;r.lease.expiresAt-=751;},r=>{r.inventory.sourceFields.ARROW2_SEQ_BEGIN='0';}]){
    const h=harness();h.setPreset(change);h.flow.arm(target);const r=await h.flow.accept(h.candidate);assert.equal(r.ok,false);assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);
  }
});
test('a forming price on the wrong side of every frozen trigger or structural invalidation blocks LONG and SHORT before native preflight',async()=>{
  for(const direction of ['LONG','SHORT']){
    const event=models[direction].analysis.events.find(e=>e.confirmationBarCloseTime===models[direction].analysis.asOfTime);
    for(const quote of [event.trigger,event.invalidation+(direction==='LONG'?-.25:.25)]){
      const h=harness({direction,realEngine:true});h.setFormingQuote(quote);h.flow.arm(target);const r=await h.flow.accept(h.candidate);
      assert.equal(r.reason,'USER_MARKET_CURRENT_PRICE_INVALIDATES_ALL_CONFIRMED_SETUPS');assert.equal(h.calls.preset,0);assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);
    }
  }
});
test('one still-valid merged setup is enough, and the frozen strategy witness never creates risk or protection orders',async()=>{
  for(const direction of ['LONG','SHORT']){
    // Artificial event-contract composition, not another full-engine or market
    // occurrence. The normal default-engine path is exercised in tests above.
    const m=structuredClone(models[direction]),event=m.analysis.events.find(e=>e.confirmationBarCloseTime===m.analysis.asOfTime),alternate=structuredClone(event);
    alternate.eventId+=':compatible-alternate';alternate.trigger+=direction==='LONG'?-.5:.5;m.analysis.events.push(alternate);m.technicalDecision=selectGuideTechnicalDecision({analysis:m.analysis});assert.equal(m.technicalDecision.status,'CONFIRMED');
    const quote=event.trigger+(direction==='LONG'?-.25:.25),h=harness({direction,modelOverride:m});h.setFormingQuote(quote);h.flow.arm(target);const r=await h.flow.accept(h.candidate);
    assert.equal(r.state,'FILLED_USER_MANAGED');const witness=r.intent.technicalEntryWitness;assert.equal(witness.quote,quote);assert.deepEqual(witness.eligibleSetupIds,[alternate.eventId]);assert.equal(witness.setups.length,2);assert.equal(witness.pricesAdjusted,false);
    assert.equal(witness.setups.find(s=>s.eventId===event.eventId).trigger,event.trigger);assert.equal(witness.setups.find(s=>s.eventId===alternate.eventId).structuralInvalidation,alternate.invalidation);
    assert.equal(r.intent.firstSourceCaptureStatus,'VERIFIED');assert.equal(r.intent.firstSourceCapture.closedBarRole,'current');assert.equal(r.intent.sourceBinding.closedBarRole,'previous','a same-bar current-to-previous rollover preserves the original timing proof');
    for(const key of ['riskPlan','riskBudget','stop','target'])assert.equal(Object.hasOwn(r.intent,key),false);assert.equal(h.calls.submit,1);
  }
});
test('same technical event consumes the shared cross-mode reservation before exactly one market gesture',async()=>{
  const h=harness();h.flow.arm(target);let key;h.setSubmit(command=>{key=command.intent.sharedReservationKey;assert.ok(h.reserved.has(key));return {status:'USER_MARKET_SUBMITTED_UNCONFIRMED',submitted:true,key:command.intent.key};});
  await h.flow.accept(h.candidate);await h.flow.accept(h.candidate);await h.flow.reconcile();assert.equal(h.calls.submit,1);assert.equal(h.calls.reserve,1);assert.equal(h.flow.arm(target).ok,false);
  assert.equal(h.flow.snapshot().state,'FILLED_USER_MANAGED','refusing another entry preserves the known fill proof');await h.flow.disarm('OPERATOR_STOP');assert.equal(h.flow.snapshot().state,'FILLED_USER_MANAGED');assert.equal(h.calls.submit,1);
  const other=harness();other.options.reserve=async()=>({ok:false,reason:'OLD_LIMIT_EVENT_ALREADY_CONSUMED'});const f=createUserMarketExecutionFlow(other.options);f.arm(target);assert.equal((await f.accept(other.candidate)).reason,'OLD_LIMIT_EVENT_ALREADY_CONSUMED');assert.equal(other.calls.submit,0);
});
test('unknown submit/fill evidence locks with read-only reconciliation and no blind retry',async()=>{
  const h=harness();h.setSubmit(()=>{throw Error('TRANSPORT_UNCERTAIN');});h.flow.arm(target);let r=await h.flow.accept(h.candidate);assert.equal(r.state,'UNKNOWNLOCK');assert.equal(r.ordersCreated,null);await h.flow.accept(h.candidate);assert.equal(h.calls.submit,1);
  r=await h.flow.reconcile();assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(h.calls.submit,1);
  const no=harness();no.setVerify(r=>{delete r.attribution;return r;});no.flow.arm(target);assert.equal((await no.flow.accept(no.candidate)).state,'UNKNOWNLOCK');assert.equal(no.calls.verify,6);assert.equal(no.calls.submit,1);
});
test('fill attribution, exact side/quantity, current raw7 and explicit user-managed scope are required',async()=>{
  for(const change of [r=>{r.position.quantity++;},r=>{r.position.direction='SHORT';},r=>{r.position.sourceFields.ARROW2_SEQ_END='old';},r=>{r.attribution.key='foreign';},r=>{r.fillVerified=false;},r=>{r.protectionVerified=true;},r=>{r.position.documentTimeOrigin++;}]){
    const h=harness();h.setVerify(r=>{change(r);return r;});h.flow.arm(target);assert.equal((await h.flow.accept(h.candidate)).state,'UNKNOWNLOCK');assert.equal(h.calls.submit,1);
  }
});
test('LIVE, TEST, corrupted source and changed session cannot borrow a technical approval',async()=>{
  for(const change of [s=>{s.replayWitness.replay=false;},s=>{s.replayWitness.fields.ARROW2_SEQ_END='0';},s=>{s.replayWitness.metadata.testOnly=true;},s=>{s.replayWitness.runId+='other';},s=>{s.analysisInput.options.metadata.synthetic=true;}]){
    const h=harness();h.setRead(s=>{change(s);return s;});h.flow.arm(target);assert.equal((await h.flow.accept(h.candidate)).ok,false);assert.equal(h.calls.preset,0);assert.equal(h.calls.submit,0);
  }
  const h=harness();h.flow.arm(target);h.ctx.sourceSessionId='OTHER';assert.equal((await h.flow.accept(h.candidate)).ok,false);assert.equal(h.calls.submit,0);
});
test('disarm during preflight prevents reservation; injected component engines remain TEST-only at the real gesture boundary',async()=>{
  const h=harness();let release;const gate=new Promise(resolve=>{release=resolve;});h.setPreset(async()=>gate);h.flow.arm(target);const entry=h.flow.accept(h.candidate);
  for(let i=0;i<20&&!h.calls.preset;i++)await Promise.resolve();assert.equal(h.calls.preset,1);await h.flow.disarm('STOP');release();await entry;assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);assert.equal(h.flow.snapshot().armed,false);
  const q=harness();q.setSubmit(command=>{assert.equal(command.testOnly,true);return {status:'BLOCKED',submitted:false};});q.flow.arm(target);const r=await q.flow.accept(q.candidate);assert.equal(r.submissionAttempted,false);assert.equal(r.state,'DISARMED');assert.equal(q.flow.arm(target).ok,false,'consumed event is not silently retried');
});
test('disarm racing a not-yet-clicked native submission invalidates its final guard and retains a known no-click result',async()=>{
  const h=harness();let release;const gate=new Promise(resolve=>{release=resolve;});h.setSubmit(async(command,guard)=>{await gate;assert.equal(guard.isCurrent(),false);return {status:'BLOCKED',submitted:false};});
  h.flow.arm(target);const entry=h.flow.accept(h.candidate);for(let i=0;i<50&&!h.calls.submit;i++)await Promise.resolve();assert.equal(h.calls.submit,1);
  await h.flow.disarm('OPERATOR_STOP');release();const r=await entry;assert.equal(r.state,'DISARMED');assert.equal(r.submissionAttempted,false);assert.equal(r.ordersCreated,false);assert.equal(r.locked,false);assert.equal(h.calls.disarm,1);assert.equal(h.flow.arm(target).ok,false);
});

test('full timing retains the original source capture and includes400ms first analysis before the second validation read',async()=>{
  const h=harness({realEngine:true}),first=structuredClone(h.candidate.replayWitness);h.setClock(baseNow+400);
  h.setSubmit(command=>{
    const clickEpoch=h.witness.sourceObservedEpochMs+50;
    return {status:'USER_MARKET_SUBMITTED_UNCONFIRMED',submitted:true,key:command.intent.key,provider:'REPLAY_TRADING',mode:'USER_MARKET',documentTimeOrigin:h.witness.sourceDocumentTimeOrigin,
      submittedPerformance:clickEpoch-h.witness.sourceDocumentTimeOrigin,verificationEpochMs:clickEpoch+1};
  });
  h.flow.arm(target);const r=await h.flow.accept(h.candidate);
  assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.intent.firstSourceCaptureStatus,'VERIFIED');assert.equal(r.intent.firstSourceCapture.sourceObservedEpochMs,first.sourceObservedEpochMs);
  assert.equal(r.intent.firstSourceCapture.observedAt,first.observedAt);assert.deepEqual(r.intent.firstSourceCapture.fields,first.fields);
  assert.equal(r.intent.sourceObservedEpochMs-first.sourceObservedEpochMs,400,'revalidation source stays distinct and fresh');
  assert.equal(r.timing.firstCaptureToFillVerificationMs-r.timing.revalidationCaptureToFillVerificationMs,400);
  assert.equal(r.timing.firstCaptureToClickMs-r.timing.revalidationCaptureToClickMs,400);assert.equal(r.timing.revalidationCaptureToClickMs,50);
  assert.equal(r.timing.firstCaptureSameSourceDocumentClockVerified,true);assert.equal(r.timing.sourceToFillVerificationScope,'REVALIDATION_CAPTURE_ONLY');assert.equal(r.timing.sourceToFillVerificationMs,r.timing.revalidationCaptureToFillVerificationMs);
  assert.equal(r.timing.clickTimingStatus,'NATIVE_CLICK_DISPATCH_START_RECEIPT');assert.equal(r.timing.protectedFillMeasured,false);assert.equal(r.timing.firstCaptureToProtectedFillVerificationMs,null);assert.equal(r.timing.marketLatencyMeasured,false);
});

test('the optional original capture is frozen synchronously before the first awaited source read',async()=>{
  const h=harness(),first=structuredClone(h.candidate.replayWitness);h.setClock(baseNow+400);
  h.setRead(source=>{h.candidate.replayWitness.sourceObservedEpochMs+=99999;h.candidate.replayWitness.fields.ARROW2_CHECKSUM_A='changed-after-await';return source;});
  h.flow.arm(target);const r=await h.flow.accept(h.candidate);
  assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.intent.firstSourceCaptureStatus,'VERIFIED');assert.equal(r.intent.firstSourceCapture.sourceObservedEpochMs,first.sourceObservedEpochMs);assert.deepEqual(r.intent.firstSourceCapture.fields,first.fields);
  assert.equal(r.timing.firstCaptureToFillVerificationMs-r.timing.revalidationCaptureToFillVerificationMs,400);
});

test('absent or invalid original source proof never falls back to the later read or a wall-clock timestamp',async()=>{
  for(const change of [c=>{delete c.replayWitness;},c=>{c.replayWitness.fields.ARROW2_SEQ_END='0';},c=>{c.replayWitness.runId+='wrong';},c=>{c.replayWitness.current.close+=.25;},c=>{c.replayWitness.sourceDocumentTimeOrigin++;},c=>{c.replayWitness.sourceObservedEpochMs+=1;},c=>{c.replayWitness.observedAt=baseNow+10000;},c=>{c.replayWitness.metadata.testOnly=true;}]){
    const h=harness();change(h.candidate);h.flow.arm(target);const r=await h.flow.accept(h.candidate);
    assert.equal(r.state,'FILLED_USER_MANAGED','measurement absence does not change a separately revalidated authorization');
    assert.equal(r.intent.firstSourceCaptureStatus,'UNAVAILABLE',change.toString());assert.equal(r.intent.firstSourceCapture,null);assert.ok(r.intent.firstSourceCaptureReasonCodes.length);
    assert.equal(r.timing.firstCaptureAvailable,false);assert.equal(r.timing.firstCaptureToFillVerificationMs,null);assert.equal(r.timing.firstCaptureToClickMs,null);assert.equal(r.timing.firstCaptureSameSourceDocumentClockVerified,false);
    assert.ok(r.timing.revalidationCaptureToFillVerificationMs>0);assert.equal(r.timing.protectedFillMeasured,false);
  }
});

test('only a same-document native click receipt can produce click timing, and no receipt is guessed from Date.now',async()=>{
  for(const change of [r=>{r.documentTimeOrigin++;},r=>{delete r.submittedPerformance;},r=>{r.submittedPerformance=-1;},r=>{r.verificationEpochMs--;},r=>{r.provider='OTHER';}]){
    const h=harness();h.setSubmit(command=>{
      const at=h.witness.sourceObservedEpochMs+50,reply={status:'USER_MARKET_SUBMITTED_UNCONFIRMED',submitted:true,key:command.intent.key,provider:'REPLAY_TRADING',mode:'USER_MARKET',documentTimeOrigin:h.witness.sourceDocumentTimeOrigin,submittedPerformance:at-h.witness.sourceDocumentTimeOrigin,verificationEpochMs:at};
      change(reply);return reply;
    });h.flow.arm(target);const r=await h.flow.accept(h.candidate);assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.timing.firstCaptureToClickMs,null);assert.equal(r.timing.revalidationCaptureToClickMs,null);assert.equal(r.timing.clickTimingStatus,'UNAVAILABLE');
  }
  const h=harness();h.flow.arm(target);const r=await h.flow.accept(h.candidate);assert.equal(r.timing.firstCaptureToClickMs,null);assert.deepEqual(r.timing.clickTimingReasonCodes,['NATIVE_CLICK_RECEIPT_NOT_AVAILABLE']);
});

test('a nonmonotonic fill timestamp cannot create either original or revalidation elapsed time even when wall observations are fresh',async()=>{
  const h=harness();h.setClock(baseNow+400);h.setVerify(reply=>{reply.position.verificationEpochMs=h.witness.sourceObservedEpochMs-1;return reply;});h.flow.arm(target);const r=await h.flow.accept(h.candidate);
  assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.timing.sameSourceDocumentClockVerified,false);assert.equal(r.timing.firstCaptureSameSourceDocumentClockVerified,false);assert.equal(r.timing.firstCaptureToFillVerificationMs,null);assert.equal(r.timing.revalidationCaptureToFillVerificationMs,null);assert.equal(r.timing.protectedFillMeasured,false);
});

test('same-close high or low correction makes the first capture unavailable while the independently fresh execution remains valid',async()=>{
  for(const key of ['high','low']){
    const h=harness();h.candidate.replayWitness.current[key]+=key==='high'?.25:-.25;h.flow.arm(target);const r=await h.flow.accept(h.candidate);
    assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.intent.firstSourceCaptureStatus,'UNAVAILABLE');assert.deepEqual(r.intent.firstSourceCaptureReasonCodes,['ORIGINAL_CAPTURE_CLOSED_OHLC_CHANGED']);assert.equal(r.timing.firstCaptureToFillVerificationMs,null);assert.ok(r.timing.revalidationCaptureToFillVerificationMs>0);assert.equal(h.calls.submit,1);
  }
});

test('required inherited-preset policy blocks an all-seven risk:null approval with valid native quantity and zero inventory before any reservation or click',async()=>{
  const model=structuredClone(models.LONG);model.input.options.risk=null;model.input.options.config.requireRisk=false;
  model.analysis=analyzeGuideSignals(model.input.bars,model.input.options);model.technicalDecision=selectGuideTechnicalDecision({analysis:model.analysis});assert.equal(model.technicalDecision.status,'CONFIRMED');
  const h=harness({realEngine:true,quantity:3,modelOverride:model}),seen=[],read=h.options.readPresetAndInventory,disarm=h.options.disarmDriver;
  const f=createUserMarketExecutionFlow({...h.options,requireInheritedPreset:true,
    readPresetAndInventory:async command=>{seen.push({callback:'preset',required:command.requireInheritedPreset});return read(command);},
    disarmDriver:async command=>{seen.push({callback:'disarm',required:command.requireInheritedPreset});return disarm(command);}});
  assert.equal(f.snapshot().presetProtectionRequired,true);assert.equal(f.snapshot().protectionVerified,false);assert.equal(f.arm(target).ok,true);
  const r=await f.accept(h.candidate);assert.equal(r.state,'DISARMED');assert.equal(r.reason,'USER_MARKET_SAVED_BRACKET_PRESET_REQUIRED');assert.equal(r.armed,false);
  assert.equal(r.intent,null);assert.equal(r.submissionAttempted,false);assert.equal(r.ordersCreated,false);assert.equal(h.calls.preset,1);assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);assert.equal(h.calls.verify,0);
  await f.disarm();assert.deepEqual(seen,[{callback:'preset',required:true},{callback:'disarm',required:true}]);
});

test('required mode does not accept invented future bracket schema or a bare verified flag as native inheritance proof',async()=>{
  for(const direction of ['LONG','SHORT']){
    const h=harness({direction,realEngine:true});h.setPreset(reply=>{reply.preset.kind='INVENTED_SAVED_BRACKET_PRESET';reply.preset.bracketPresetVerified=true;reply.preset.stopLoss={enabled:true,ticks:11};reply.preset.takeProfit={enabled:true,ticks:23};});
    const f=createUserMarketExecutionFlow({...h.options,requireInheritedPreset:true});f.arm(target);const r=await f.accept(h.candidate);
    assert.equal(r.reason,'USER_MARKET_SAVED_BRACKET_PRESET_REQUIRED');assert.equal(r.state,'DISARMED');assert.equal(r.protectionVerified,false);assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);
  }
});

test('native missing-preset rejection also stops required mode instead of leaving an armed retry loop',async()=>{
  const h=harness();h.setPreset(reply=>{reply.status='BLOCKED';reply.reasonCodes=['NATIVE_SAVED_PRESET_MISSING'];});
  const f=createUserMarketExecutionFlow({...h.options,requireInheritedPreset:true});f.arm(target);const r=await f.accept(h.candidate);
  assert.equal(r.state,'DISARMED');assert.equal(r.armed,false);assert.equal(r.reason,'USER_MARKET_SAVED_BRACKET_PRESET_REQUIRED');assert.equal(h.calls.reserve,0);assert.equal(h.calls.submit,0);assert.equal(r.intent,null);
});

test('preset requirement is explicit while legacy default remains separately quantity-only and does not claim protection',async()=>{
  const h=harness();for(const requireInheritedPreset of ['true',1,null])assert.throws(()=>createUserMarketExecutionFlow({...h.options,requireInheritedPreset}),/USER_MARKET_EXPLICIT_PRESET_POLICY_REQUIRED/);
  assert.equal(h.flow.snapshot().presetProtectionRequired,false);h.flow.arm(target);const r=await h.flow.accept(h.candidate);assert.equal(r.state,'FILLED_USER_MANAGED');assert.equal(r.intent.presetProtectionRequired,false);assert.equal(r.protectionVerified,false);assert.equal(r.timing.protectedFillMeasured,false);
});
