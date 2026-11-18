import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLivePaperUserControls} from '../live-paper-user-controls.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {EXECUTION_ATTEMPT_STORAGE_KEY} from '../execution-attempt-ledger.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
import {roiBrrEventId,ROI_BRR_APPROVAL_POLICY} from '../roi-brr-live-signal.mjs';

// Full engine computations on artificial OHLC, wrapped in an artificial trusted
// LIVE transport contract. No fixture leaves Node, opens a native page or proves
// a market signal, native identity, real order, fill or strategy profitability.
const original=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
const RESEARCH_URL='https://www.tradingview.com/chart/PaperResearch/';
const ids=['paper-user-panel','paper-user-inspect','paper-user-consent','paper-user-arm','paper-user-disarm','paper-user-status','paper-user-account','paper-user-journal'];
class Node{constructor(){this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.dataset={};this.listeners=new Map();}addEventListener(k,f){this.listeners.set(k,f);}removeEventListener(k){this.listeners.delete(k);}async emit(k){return this.listeners.get(k)?.();}}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

test('presentation shares native serialization without disarming or dispatching, and resumes normal signal checks afterwards',async()=>{
  const f=fixture({powerBar:true});try{await f.inspectArm();let release;const pending=new Promise(resolve=>{release=resolve;});const work=f.controls.runPresentation(async()=>{await pending;return {status:'MARKERS_ONLY'};});await flush();assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().presentationBusy,true);assert.equal((await f.controls.runPresentation(()=>assert.fail('concurrent UI write'))).status,'PRESENTATION_DEFERRED');release();assert.equal((await work).status,'MARKERS_ONLY');assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().busy,false);assert.equal(f.dispatches.length,0);assert.equal(f.$('paper-user-power-state').textContent,'פעיל וממתין לאיתות');}finally{f.close();}
});
function nativeUserMarketUiCommand(){}
function fixture({direction='LONG',provider='TRADINGVIEW_PAPER',environment='DEMO',quantity=3,holdPrepare=false,holdInspect=false,owned='UNKNOWN',lateKnownAt=false,surface='DOM_MARKET',powerBar=false,prepareSession,prepareOtherAccount,prepareBrokerSession,sharedNative=false}={}){
  const data={},calls=[],dispatches=[],timers=new Map(),frames=new Map(),nodes=new Map([...ids,...(powerBar?['paper-user-power-bar','paper-user-power-state','paper-user-power-detail']:[])].map(id=>[id,new Node()]));let token=0,tail=Promise.resolve(),timerId=0,clock=original.options.asOfTime+100,resolvePrepare,connectionPatch={},holdRead=false,readPending,resolveRead,displayVisible=true,displayOnscreen=true,nativeTimingPatch={},protectionPatch={};
  const nativeOrigin=original.options.asOfTime-1000;let receivingOrigin=nativeOrigin;
  const pending=new Promise(resolve=>{resolvePrepare=resolve;}),input=structuredClone(original);
  if(direction==='SHORT'){const mirror=b=>({...b,open:56676-b.open,high:56676-b.low,low:56676-b.high,close:56676-b.close});input.bars=input.bars.map(mirror);for(const h of Object.values(input.options.higherTimeframes))h.bars=h.bars.map(mirror);}
  input.options.metadata={...input.options.metadata,instrument:'CME_MINI:NQ1!',replay:false,realtime:true,synthetic:false,testOnly:false};input.options.risk=null;input.options.config={...input.options.config,requireRisk:false,strategyPolicy:'guide_scenarios_v1'};
  if(lateKnownAt){
    const last=input.bars.at(-1),raw=b=>Object.fromEntries(['time','closeTime','open','high','low','close','closed'].map(k=>[k,b[k]]));let sourceClock=last.time+145;
    const store=createLiveOhlcStore({now:()=>sourceClock}),metadata={...input.options.metadata,provider:'FIXTURE_VERIFIED_NATIVE_SOURCE',sourceId:'CME_MINI:NQ1!|1|1794394740000',tabId:77};
    const forming={time:last.time,closeTime:last.closeTime,open:last.open,high:last.open,low:last.open,close:last.open,closed:false};
    const packet=(kind,bars)=>({kind,metadata,bars,receivedAt:sourceClock,sourceEmittedAt:sourceClock});
    assert.equal(store.ingest(packet('snapshot',[...input.bars.slice(-4,-1).map(raw),forming]),{sourceAsOfTime:sourceClock}).accepted,true);
    for(sourceClock=last.time+10145;sourceClock<last.closeTime;sourceClock+=10000)assert.equal(store.ingest(packet('update',[forming]),{sourceAsOfTime:sourceClock}).accepted,true);
    sourceClock=last.closeTime+145;const final=store.ingest(packet('update',[raw(last)]),{sourceAsOfTime:sourceClock});assert.equal(final.accepted,true);
    assert.equal(final.newlyClosed[0].knownAt,last.closeTime+145);input.bars[input.bars.length-1]=final.newlyClosed[0];input.options.asOfTime=final.decisionAsOfTime;clock=sourceClock+100;
  }
  const analysis=analyzeGuideSignals(input.bars,input.options),closed=input.bars.map(b=>({...b,sourceClosed:true,finalOhlcVerified:true})),last=closed.at(-1),p={id:'paper-component',label:'Paper component',provider,environment,nativeAccountId:'FixturePaperExact',adapterId:'tradingview-account-ui',revision:1,enabled:true,userManagedRisk:true};
  const ctx={source:{active:true,mode:'LIVE',sessionId:'live-component-session',runId:'CME_MINI:NQ1!|1|1794394740000',sourceTabId:77,generation:1,settingsDirty:false,accountReviewId:'review-component',researchUrl:RESEARCH_URL},profile:{mode:'USER_MANAGED',risk:null},account:{brokerProfile:p,selectionFingerprint:'selection-component',reviewAccepted:true,review:{reviewId:'review-component',nativeIdentityVerified:true,environmentVerified:true,sourceTabId:77,sourceUrl:RESEARCH_URL,brokerProfile:structuredClone(p)}}};
  function state(bars){return {ready:true,liveEligible:true,connected:true,stale:false,requiresSnapshot:false,contextOnly:false,lastReceivedAt:clock,generation:ctx.source.generation,metadata:{...input.options.metadata,sourceId:ctx.source.runId,tabId:77},bars:structuredClone(bars),current:{...last,closed:false,closeTime:last.closeTime+60000,time:last.closeTime},bootstrapAsOfTime:closed[0].time,bootstrap:false,newlyClosed:[],eligibleCloseTimes:[]};}
  ctx.state=state(closed.slice(0,-1));ctx.analysis=null;
  const storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}},locks={request(name,options,fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
  const nativeIdentity=sharedNative?{provider,environment,environmentVerified:provider==='TRADINGVIEW_PAPER',nativeIdentityVerified:true,...(provider==='TRADOVATE'?{environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'}:{})}:{provider:'TRADINGVIEW_PAPER',environment:'DEMO',environmentVerified:true};
  const statusPrefix=sharedNative?'NATIVE_USER_':'PAPER_USER_';
  const nativeConnection=s=>({status:statusPrefix+'CONNECTION_VERIFIED',...nativeIdentity,nativeAccountId:p.nativeAccountId,sourceVerified:true,observedAt:clock,sampleId:'native-'+(++token),symbol:'NQZ2026',quantity,latestClosedAt:s.asOfTime,flat:true,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],executionSurface:surface,
    nativePreset:surface==='ORDER_TICKET_PRESET'?{application:{name:'ROI MARKET 20/30',nameVerified:true,freshNoticeVerified:true},stop:{value:20,unit:'TICKS'},target:{value:30,unit:'TICKS'}}:surface==='USER_MANAGED_CHART_MARKET'?{kind:'NATIVE_CHART_USER_MANAGED_MARKET_PRESET_V1',fingerprint:'native-preset-observation-fixture',sideNames:{LONG:'ROI LONG',SHORT:'ROI SHORT'},stopTargetRead:false,inputValuesSetByDriver:false}:null,synthetic:false,testOnly:false,...connectionPatch});
  const chrome={storage:{local:storage},tabs:{async get(id){return {id,url:RESEARCH_URL};}},scripting:{async executeScript(command){
    assert.equal(command.func.name,sharedNative?'nativeUserMarketUiCommand':'paperUserMarketUiCommand');const a=command.args[0];calls.push(structuredClone(a));
    if(['inspect','read_connection'].includes(a.action)){const value=nativeConnection(a.sourceBinding);if(a.action==='inspect'&&holdInspect)await pending;if(a.action==='read_connection'&&holdRead){holdRead=false;await readPending;}return [{result:value}];}
    if(a.action==='disarm')return [{result:{status:'DISARMED',ordersCreated:false}}];
    if(a.action==='prepare'){
      if(a.approvalProof.approvalPolicy===ROI_BRR_APPROVAL_POLICY)assert.equal(a.approvalProof.kind,'ROI_BRR_MARKET_APPROVAL_V1');
      else{assert.equal(a.approvalProof.approvalPolicy,'guide_scenarios_v1');assert.ok(a.approvalProof.strategyProofs.length);assert.ok(a.technicalEntryWitness.eligibleSetupIds.length);}
      if(holdPrepare)await pending;
      return [{result:{kind:'EXECUTION_SESSION_NATIVE_PREPARATION_V1',status:'READY',binding:structuredClone(a.permit.binding),direction:a.permit.signal.direction,quantity,privateLeaseId:'fixture-native-private-lease',expiresAt:Math.min(clock+750,a.permit.expiresAt),connection:nativeConnection(a.sourceBinding)}}];
    }
    if(a.action==='submit'){if(sharedNative){assert.equal(a.nativePrepared.connection.status,'NATIVE_USER_CONNECTION_VERIFIED','the private lease preparation must remain byte-exact');assert.equal(Object.hasOwn(a.nativePrepared.connection,'nativeStatus'),false);}assert.equal(data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.at(-1).status,'UNKNOWN');dispatches.push(structuredClone(a));return [{result:{status:statusPrefix+'SUBMITTED_UNCONFIRMED',attemptKey:a.attemptKey,submitted:true,ordersCreated:null,documentTimeOrigin:nativeTimingPatch.clickOrigin??nativeOrigin,submittedPerformance:clock+.125-(nativeTimingPatch.clickOrigin??nativeOrigin),verificationEpochMs:clock+.25}}];}
    assert.equal(a.action,'reconcile');if(owned==='UNKNOWN')return [{result:{status:'UNKNOWN'}}];
    if(owned==='PENDING')return [{result:{status:statusPrefix+'RECONCILIATION_PENDING',...nativeIdentity,nativeAccountId:p.nativeAccountId,sourceVerified:true,sourceBinding:structuredClone(a.sourceBinding),intentKey:a.record.key,attemptKey:a.record.key,observedAt:clock,latestClosedAt:a.sourceBinding.asOfTime,submitted:true,ordersCreated:null,inventoryRead:false,inventoryFresh:false,ownedStateChanged:false,synthetic:false,testOnly:false,...protectionPatch}}];
    const r=a.record;return [{result:{status:statusPrefix+'OWNED_STATE_VERIFIED',...nativeIdentity,nativeAccountId:p.nativeAccountId,sourceVerified:true,ownershipVerified:true,observedAt:clock,documentTimeOrigin:nativeTimingPatch.fillOrigin??nativeOrigin,verificationEpochMs:clock+.5,sampleId:'owned-'+(++token),nativeOrderId:'fixture-paper-order',intentKey:r.key,ownedStatus:owned,closedVerified:owned==='CLOSED',positionsComplete:true,workingOrdersComplete:true,positions:owned==='FILLED'?[{symbol:r.eventIdentity.symbol,direction:r.eventIdentity.direction,quantity}]:[],workingOrders:[],synthetic:false,testOnly:false,...protectionPatch}}];
  }}};
  const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
  const controls=createLivePaperUserControls({document:{getElementById:id=>nodes.get(id)},chrome,extension:true,locks,getContext:()=>ctx,prepareSession,prepareOtherAccount,prepareBrokerSession,...(sharedNative?{nativeCommandForProfile:()=>nativeUserMarketUiCommand}:{}),now:()=>clock,
    performanceEpoch:()=>clock+2,receiverTimeOrigin:()=>receivingOrigin,isVisible:()=>displayVisible,isOnscreen:()=>displayOnscreen,
    requestAnimationFrame:fn=>{const id=++timerId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  const $=id=>nodes.get(id);
  async function inspectArm(){await $('paper-user-inspect').emit('click');$('paper-user-consent').checked=true;await $('paper-user-consent').emit('change');await $('paper-user-arm').emit('click');}
  function publish(){ctx.state=state(closed);ctx.state.newlyClosed=[structuredClone(last)];ctx.state.eligibleCloseTimes=[last.closeTime];ctx.analysis=analysis;const signal=analysis.signals.find(s=>s.confirmationBarCloseTime===last.closeTime);assert.ok(signal);return {item:{id:'fixture-alert',sessionId:ctx.source.sessionId,runId:ctx.source.runId,sourceTabId:77,readEventId:'read:fixture-original',sourcePacketId:'fixture-packet-1',sourceEmittedAt:input.options.asOfTime,receivedAt:clock,approvedAtReceiverEpoch:clock+.25,signal:structuredClone(signal)},analysis,state:structuredClone(ctx.state)};}
  return {controls,ctx,$,calls,dispatches,data,publish,inspectArm,resolvePrepare,async pulse(ms=500,{freshReceipt=true}={}){clock+=ms;if(freshReceipt)ctx.state.lastReceivedAt=clock;const timer=[...timers.entries()][0];if(timer){timers.delete(timer[0]);timer[1].fn();}else controls.refresh();await flush();},
    sourceOrigin({calibration=true,...patch}={}){const s=clock-100;return {kind:'OWNED_SOURCE_PACKET_ORIGIN_V1',sessionId:ctx.source.sessionId,packetId:'fixture-packet-1',sourceAppearanceEpochMs:s,sourceDocumentTimeOrigin:nativeOrigin,sourceSequence:42,sourceTransport:'PUBLIC_DATA_WINDOW_V2',sourceObservationMeaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',...(calibration?{calibrationBracketMs:10,calibration:{receiverTimeOrigin:receivingOrigin,sourceAppearanceEarliestReceiverPerformanceMs:s-receivingOrigin-5,sourceAppearanceLatestReceiverPerformanceMs:s-receivingOrigin+5}}:{}),...patch};},
    paint(ms=16){clock+=ms;const first=[...frames.entries()][0];assert.ok(first,'a paint callback is pending');frames.delete(first[0]);first[1]();},firstFrame:()=>[...frames.values()][0],frameCount:()=>frames.size,
    setVisible:value=>{displayVisible=value;},setOnscreen:value=>{displayOnscreen=value;},setReceiverOrigin:value=>{receivingOrigin=value;},setNativeTiming:value=>{nativeTimingPatch=value;},setProtection:value=>{protectionPatch=value;},
    holdNextRead(){holdRead=true;readPending=new Promise(resolve=>{resolveRead=resolve;});},releaseRead:()=>resolveRead?.(),nextDelay:()=>[...timers.values()][0]?.ms,setOwned:value=>{owned=value;},setConnection:value=>{connectionPatch=value;},close(){controls.dispose();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;},tick:ms=>{clock+=ms;}};
}

test('Paper user controls do not inspect, arm or create durable claims on initialization and never allow PA/native Tradovate',async()=>{
  for(const args of [{},{provider:'TRADOVATE',environment:'PA'}]){const f=fixture(args);try{assert.equal(f.calls.length,0);assert.equal(Object.keys(f.data).length,0);assert.equal(f.controls.snapshot().armed,false);if(args.provider){await f.inspectArm();assert.equal(f.dispatches.length,0);assert.equal(f.calls.filter(a=>a.action!=='disarm').length,0);assert.equal(f.controls.snapshot().armed,false);}}finally{f.close();}}
});

test('full-engine per-strategy LONG and SHORT use actual observed quantity3, durable UNKNOWN before one Market dispatch and no risk or exit setter',async()=>{
  for(const direction of ['LONG','SHORT']){const f=fixture({direction});try{await f.inspectArm();assert.equal(f.controls.snapshot().armed,true);const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,1);
    const d=f.dispatches[0],record=f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0];assert.equal(d.permit.signal.direction,direction);assert.equal(d.permit.binding.quantity,3);assert.equal(record.status,'UNKNOWN');
    const prepare=f.calls.find(a=>a.action==='prepare');assert.equal(prepare.approvalProof.approvalPolicy,'guide_scenarios_v1');assert.ok(prepare.approvalProof.requiredChecks.length<7);assert.equal(prepare.sourceBinding.mode,'LIVE');
    for(const key of ['riskPlan','riskBudget','stop','target','stopTicks','targetTicks'])assert.equal(Object.hasOwn(d.permit,key),false);
    await f.pulse();assert.equal(f.controls.snapshot().lifecycle.ownedAttempt.status,'UNKNOWN');await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();assert.equal(f.dispatches.length,1);
    assert.equal(f.calls.some(a=>/set|cancel|close/i.test(a.action)),false);assert.equal(f.controls.snapshot().realBrokerOrdersAuthorized,false);
  }finally{f.close();}}
});

test('bootstrap, TEST, historical close, stale source and invalid current trigger cannot produce a Paper entry',async()=>{
  for(const mutate of [b=>{b.state.bootstrap=true;},b=>{b.item.testOnly=true;},b=>{b.state.eligibleCloseTimes=[];},(b,f)=>{f.ctx.state.lastReceivedAt-=2001;},(b,f)=>{f.ctx.state.current.close=1;}]){const f=fixture();try{await f.inspectArm();const b=f.publish();mutate(b,f);await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(a=>a.action==='prepare'),false);}finally{f.close();}}
});

test('Roi BRR routes through the armed native lifecycle without depending on a Guide strategy decision',async()=>{
  for(const enabled of [false,true]){
    const f=fixture({direction:'SHORT',sharedNative:true,surface:'USER_MANAGED_CHART_MARKET'});
    try{
      if(enabled)await f.inspectArm();
      const {item,state}=f.publish(),closed=state.bars.at(-1),closeTime=closed.closeTime;
      f.ctx.analysis=null;
      f.ctx.latestEvidence={roiBrr:{kind:'ROI_BRR_LIVE_READY_V1',sessionId:item.sessionId,runId:item.runId,sourceUrl:RESEARCH_URL,
        direction:'SHORT',closeTime,priceTicks:closed.close/.25,sourceEmittedAt:item.sourceEmittedAt,observedAtWall:item.receivedAt}};
      item.signal={approvalPolicy:ROI_BRR_APPROVAL_POLICY,direction:'SHORT',eventId:roiBrrEventId(closeTime,'SHORT')};
      const origin={generation:state.generation,runId:item.runId,closeTime,receivedAt:item.receivedAt};
      await f.controls.acceptBrr(item,origin);
      assert.equal(f.dispatches.length,enabled?1:0);
      if(enabled){
        const prepare=f.calls.find(call=>call.action==='prepare');
        assert.equal(prepare.approvalProof.approvalPolicy,ROI_BRR_APPROVAL_POLICY);
        assert.equal(f.dispatches[0].permit.signal.direction,'SHORT');
        assert.equal(f.dispatches[0].permit.binding.quantity,3);
        await f.controls.acceptBrr(item,origin);await f.pulse();assert.equal(f.dispatches.length,1);
      }
    }finally{f.close();}
  }
});

test('a fresh closed confirmation survives an ordinary trigger retest while structural invalidation still vetoes Market',async()=>{
  for(const direction of ['LONG','SHORT'])for(const invalid of [false,true]){
    const f=fixture({direction});try{
      await f.inspectArm();const b=f.publish(),signal=b.item.signal,event=b.analysis.events.find(e=>e.eventId===signal.setupEventIds[0]);
      const quote=invalid?(direction==='LONG'?event.invalidation-.25:event.invalidation+.25):event.trigger;
      f.ctx.state.current.close=quote;
      await f.controls.accept(b.item,b.analysis,b.state);
      assert.equal(f.dispatches.length,invalid?0:1,direction+' '+invalid);
      if(!invalid)assert.equal(f.calls.find(a=>a.action==='prepare').technicalEntryWitness.quote,quote);
    }finally{f.close();}
  }
});
test('a new minute closing during a read-only health RPC is re-read without disconnecting past its fresh strategy signal',async()=>{
  const f=fixture({powerBar:true,sharedNative:true,surface:'USER_MANAGED_CHART_MARKET'});
  try{
    await f.inspectArm();const baseline=f.controls.snapshot().lifecycle.baselineClosedAt;
    f.holdNextRead();await f.pulse();const bundle=f.publish();f.releaseRead();await flush();
    assert.equal(f.controls.snapshot().status,'WAITING_NEW_SIGNAL');assert.equal(f.controls.snapshot().lifecycle.baselineClosedAt,baseline);
    const reads=f.calls.filter(c=>c.action==='read_connection');assert.ok(reads.length>=2);assert.ok(reads.at(-1).sourceBinding.asOfTime>reads.at(-2).sourceBinding.asOfTime);
    await f.controls.accept(bundle.item,bundle.analysis,bundle.state);assert.equal(f.dispatches.length,1);assert.equal(f.dispatches[0].permit.signal.direction,'LONG');
  }finally{f.releaseRead();f.close();}
});
test('a bounded partial native source read waits without consuming a new approval, but an expired source cannot keep that grace alive',async()=>{
  const patch={status:'BLOCKED',reasonCodes:['NATIVE_USER_SOURCE_CHECKSUM_MISMATCH'],submitted:false,ordersCreated:false};
  for(const code of ['NATIVE_USER_SOURCE_CHECKSUM_MISMATCH','NATIVE_USER_LIVE_SOURCE_CURRENTNESS_REQUIRED']){const f=fixture({powerBar:true,sharedNative:true,surface:'USER_MANAGED_CHART_MARKET'});
  try{
    await f.inspectArm();const baseline=f.controls.snapshot().lifecycle.baselineClosedAt;f.setConnection({...patch,reasonCodes:[code]});await f.pulse(100);
    assert.equal(f.controls.snapshot().status,'WAITING_SOURCE_FRAME');assert.equal(f.controls.snapshot().lifecycle.baselineClosedAt,baseline);assert.equal(f.dispatches.length,0);
    const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,0);assert.equal(f.controls.snapshot().lifecycle.baselineClosedAt,baseline);
    f.setConnection({});await f.pulse(100);assert.equal(f.dispatches.length,1);
  }finally{f.close();}}
  const expired=fixture({sharedNative:true,surface:'USER_MANAGED_CHART_MARKET'});try{await expired.inspectArm();expired.setConnection(patch);await expired.pulse(2001,{freshReceipt:false});assert.equal(expired.controls.snapshot().status,'DISCONNECTED');assert.equal(expired.dispatches.length,0);}finally{expired.close();}
});

test('stop during native preparation invalidates the permit before reservation or Market and preserves user quantity and exits',async()=>{
  const f=fixture({holdPrepare:true});try{await f.inspectArm();const b=f.publish(),pending=f.controls.accept(b.item,b.analysis,b.state);await flush();assert.ok(f.calls.some(a=>a.action==='prepare'));
    f.controls.disarm('USER_STOP');f.resolvePrepare();await pending;assert.equal(f.dispatches.length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.equal(f.controls.snapshot().armed,false);assert.equal(f.$('paper-user-consent').checked,false);
  }finally{f.close();}
});

test('fresh native attributed fill is required, followed by two separate closed observations before next-signal readiness',async()=>{
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.controls.snapshot().lifecycle.ownedAttempt.status,'UNKNOWN');
    await f.pulse();assert.equal(f.controls.snapshot().status,'FILLED');assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'FILLED');
    f.setOwned('CLOSED');await f.pulse();assert.equal(f.controls.snapshot().status,'CLOSED_VERIFYING');await f.pulse();assert.equal(f.controls.snapshot().status,'WAITING_NEXT_SIGNAL');
    assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'CLOSED');assert.equal(f.dispatches.length,1);await f.pulse();assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('temporary source disconnect retains consent and owned UNKNOWN while a fresh run reconciles without resending its recovered confirmation',async()=>{
  const f=fixture();try{await f.inspectArm();const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);f.controls.disconnect('SOURCE_RESET');assert.equal(f.controls.snapshot().armed,true);assert.equal(f.$('paper-user-consent').checked,true);
    f.ctx.source.runId='CME_MINI:NQ1!|1|1794394740999';f.ctx.state.metadata.sourceId=f.ctx.source.runId;f.ctx.source.generation++;f.ctx.state.generation=f.ctx.source.generation;
    await f.pulse();assert.equal(f.dispatches.length,1);assert.ok(f.controls.snapshot().lifecycle.ownedAttempt);assert.equal(f.controls.snapshot().candidate,null);
    f.setOwned('FILLED');await f.pulse();assert.equal(f.controls.snapshot().status,'FILLED');assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('a valid technical confirmation already present before arm becomes baseline and cannot be entered from a later refresh',async()=>{
  const f=fixture();try{const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);await f.inspectArm();
    assert.equal(f.controls.snapshot().armed,true);await f.pulse();await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();
    assert.equal(f.dispatches.length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);
  }finally{f.close();}
});

test('an unrelated Paper position or incomplete native empty evidence blocks a new arm rather than inferring a flat account',async()=>{
  for(const patch of [{flat:false,positions:[{symbol:'ESZ2026',direction:'LONG',quantity:1}]},{positionsComplete:false},{workingOrdersComplete:false}]){
    const f=fixture();try{f.setConnection(patch);await f.inspectArm();assert.equal(f.$('paper-user-arm').disabled,true);assert.equal(f.controls.snapshot().armed,false);const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],undefined);}finally{f.close();}
  }
});

test('native account or environment changes after arm prevent preparation and reserve even with an unchanged genuine engine decision',async()=>{
  for(const patch of [{nativeAccountId:'AnotherPaperAccount'},{provider:'TRADOVATE',environment:'PA'},{environmentVerified:false},{sourceVerified:false},{synthetic:true}]){
    const f=fixture();try{await f.inspectArm();f.setConnection(patch);const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);}finally{f.close();}
  }
});

test('an actual store-derived confirmation known145ms after minute close preserves producer availability separately from LC bar-boundary identity and raw measurement anchors',async()=>{
  const f=fixture({lateKnownAt:true,owned:'FILLED'});try{await f.inspectArm();const b=f.publish(),close=b.state.bars.at(-1).closeTime;
    assert.equal(b.state.bars.at(-1).knownAt,close+145);assert.equal(b.analysis.asOfTime,close+145);await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,1);
    const prepare=f.calls.find(a=>a.action==='prepare');assert.equal(prepare.approvalProof.confirmedAt,close+145);assert.equal(prepare.approvalProof.analysisAsOfTime,close+145);
    assert.equal(prepare.approvalProof.confirmationBarCloseTime,close);assert.equal(prepare.sourceBinding.asOfTime,close);assert.equal(prepare.permit.signal.confirmedAt,close);
    const anchor=f.controls.snapshot().candidate.measurementAnchor;assert.equal(anchor.readEventId,b.item.readEventId);assert.equal(anchor.sourcePacketId,b.item.sourcePacketId);assert.equal(anchor.receivedAt,b.item.receivedAt);assert.equal(anchor.approvedAtReceiverEpoch,b.item.approvedAtReceiverEpoch);
    await f.pulse();const first=f.controls.snapshot().lastVerifiedFill;assert.ok(first.verificationEpochMs);await f.pulse();assert.deepEqual(f.controls.snapshot().lastVerifiedFill,first);
    const records=f.controls.snapshot().journal.filter(r=>r.phase==='NATIVE_FILLED_VERIFIED');assert.equal(records.length,1);assert.deepEqual(records[0].measurementAnchor,anchor);assert.equal(records[0].result.verificationEpochMs,first.verificationEpochMs);
  }finally{f.close();}
});

test('one fresh approval arriving during an in-flight connection read wakes one immediate serialized tick instead of adding a500ms poll delay',async()=>{
  const f=fixture();try{await f.inspectArm();f.holdNextRead();await f.pulse();const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);
    assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(a=>a.action==='prepare'),false);f.releaseRead();await flush();assert.equal(f.nextDelay(),0);
    await f.pulse(0);assert.equal(f.dispatches.length,1);assert.equal(f.nextDelay(),500);await f.pulse();assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('a later root analysis veto during native preparation blocks the cached direction before reserve even though the closed OHLC is unchanged',async()=>{
  const f=fixture({holdPrepare:true});try{await f.inspectArm();const b=f.publish(),pending=f.controls.accept(b.item,b.analysis,b.state);await flush();assert.ok(f.calls.some(a=>a.action==='prepare'));
    f.ctx.analysis={...structuredClone(b.analysis),status:'BLOCKED'};f.resolvePrepare();await pending;
    assert.equal(f.dispatches.length,0);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.length,0);assert.match(f.controls.snapshot().reason,/VETOED/);
  }finally{f.close();}
});

test('matched original source packet measures source-to-click and verified fill on one native clock and calibrated first fill-status paint bounds',async()=>{
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();const origin=structuredClone(b.item.sourceObservation);
    await f.controls.accept(b.item,b.analysis,b.state);b.item.sourceObservation.sourceAppearanceEpochMs=-1;await f.pulse();
    const t=f.controls.snapshot().timing;assert.deepEqual(t.measurementAnchor.sourceObservation,origin);assert.equal(t.sourceToClickMs,100.125);assert.equal(t.sourceToVerifiedFillMs,600.5);assert.equal(t.clickToVerifiedFillMs,500.375);assert.equal(t.protectionVerified,false);
    assert.equal(t.fillStatusDisplay.status,'PENDING');f.paint();f.paint();const d=f.controls.snapshot().timing.fillStatusDisplay,c=origin.calibration;
    assert.equal(d.status,'MEASURED_SOURCE_CALIBRATED_INTERVAL');assert.equal(d.sourceToPaintLowerMs,d.firstPaintOpportunityEpochMs-d.receiverDocumentTimeOrigin-c.sourceAppearanceLatestReceiverPerformanceMs);
    assert.equal(d.sourceToPaintUpperMs,d.secondPaintOpportunityEpochMs-d.receiverDocumentTimeOrigin-c.sourceAppearanceEarliestReceiverPerformanceMs);
    assert.match(f.$('paper-user-status').textContent,/ms/);assert.match(f.$('paper-user-status').textContent,/הזדמנויות ציור/);assert.equal(d.physicalDisplayMeasured,false);
  }finally{f.close();}
});

test('missing source origin or absent receiver calibration never becomes a full-source display claim and never changes entry authorization',async()=>{
  for(const hasOrigin of [false,true]){const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();if(hasOrigin)b.item.sourceObservation=f.sourceOrigin({calibration:false});await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();f.paint();f.paint();
    const t=f.controls.snapshot().timing;assert.equal(f.dispatches.length,1);assert.equal(t.fillStatusDisplay.status,'MEASURED_RECEIVER_CLOCK_ONLY');assert.equal(t.fillStatusDisplay.sourceToPaintUpperMs,null);
    assert.equal(t.sourceToVerifiedFillMs,hasOrigin?600.5:null);if(!hasOrigin)assert.ok(t.reasonCodes.includes('SOURCE_PACKET_ORIGIN_MISSING'));
  }finally{f.close();}}
});

test('wrong session, packet or invalid source clock is rejected only for measurement, while different native fill clocks are not subtracted',async()=>{
  for(const change of [o=>({...o,sessionId:'another-session'}),o=>({...o,packetId:'another-packet'}),o=>({...o,sourceAppearanceEpochMs:NaN}),o=>({...o,sourceDocumentTimeOrigin:o.sourceDocumentTimeOrigin+1})]){
    const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=change(f.sourceOrigin());await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();assert.equal(f.dispatches.length,1);assert.equal(f.controls.snapshot().timing.sourceToVerifiedFillMs,null);assert.ok(f.controls.snapshot().timing.reasonCodes.length);}finally{f.close();}
  }
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();f.setNativeTiming({fillOrigin:b.item.sourceObservation.sourceDocumentTimeOrigin+1});await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();
    assert.equal(f.controls.snapshot().timing.sourceToVerifiedFillMs,null);assert.ok(f.controls.snapshot().timing.reasonCodes.includes('NATIVE_FILL_DOCUMENT_CLOCK_UNVERIFIED'));
  }finally{f.close();}
});

test('an original source observation older than30seconds at click is explicitly stale rather than being replaced with native revalidation',async()=>{
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish(),origin=f.sourceOrigin(),oldD=origin.sourceDocumentTimeOrigin-60000;
    b.item.sourceObservation={...origin,sourceDocumentTimeOrigin:oldD,sourceAppearanceEpochMs:origin.sourceAppearanceEpochMs-31000};f.setNativeTiming({clickOrigin:oldD,fillOrigin:oldD});await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();
    const t=f.controls.snapshot().timing;assert.equal(t.sourceToClickMs,null);assert.equal(t.sourceToVerifiedFillMs,null);assert.ok(t.reasonCodes.includes('SOURCE_PACKET_ORIGIN_STALE_AT_CLICK'));assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('hidden and offscreen filled status never receive paint timestamps, while stop invalidates already queued paint callbacks',async()=>{
  for(const kind of ['hidden','offscreen']){const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();await f.controls.accept(b.item,b.analysis,b.state);if(kind==='hidden')f.setVisible(false);else f.setOnscreen(false);await f.pulse();
    const d=f.controls.snapshot().timing.fillStatusDisplay;assert.equal(d.status,'UNAVAILABLE');assert.ok(d.reasonCodes[0].includes(kind==='hidden'?'HIDDEN':'OFFSCREEN'));assert.equal(d.secondPaintOpportunityEpochMs,null);assert.equal(f.frameCount(),0);
  }finally{f.close();}}
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();const callback=f.firstFrame();f.controls.disarm('USER_STOP');callback();
    const d=f.controls.snapshot().timing.fillStatusDisplay;assert.equal(d.status,'UNAVAILABLE');assert.ok(d.reasonCodes.includes('FILLED_STATUS_DISARMED_BEFORE_PAINT'));assert.equal(d.secondPaintOpportunityEpochMs,null);
  }finally{f.close();}
});

test('a receiver clock identity change invalidates calibration and pending paint instead of producing negative or cross-clock latency',async()=>{
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();f.paint();f.setReceiverOrigin(1);f.paint();
    const d=f.controls.snapshot().timing.fillStatusDisplay;assert.equal(d.status,'UNAVAILABLE');assert.ok(d.reasonCodes.includes('RECEIVER_PERFORMANCE_CLOCK_CHANGED_OR_REGRESSED'));assert.equal(d.sourceToPaintUpperMs,null);
  }finally{f.close();}
});

test('an inspected Order preset freezes the native surface and exact name through arm and rejects a DOM fallback before prepare',async()=>{
  const f=fixture({surface:'ORDER_TICKET_PRESET'});try{await f.inspectArm();const bound=f.calls.find(a=>a.action==='read_connection').expected;assert.equal(bound.executionSurface,'ORDER_TICKET_PRESET');assert.equal(bound.nativePresetName,'ROI MARKET 20/30');
    f.setConnection({executionSurface:'DOM_MARKET',nativePreset:null});const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.match(f.controls.snapshot().reason,/PRESET_OR_SURFACE_CHANGED/);
  }finally{f.close();}
});

test('protected-fill latency is labeled only from the strict native inherited-protection proof on the verified first fill',async()=>{
  const f=fixture({owned:'FILLED'});try{await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();f.setProtection({protectionVerified:true,nativeProtection:{kind:'PUBLIC_NATIVE_POSITION_BRACKET_FIELDS_AND_MATCHING_WORKING_ORDERS',status:'INHERITED_NATIVE_PRESET_PROTECTION_VERIFIED',nativeOrderId:'fixture-paper-order',protectionVerified:true,inheritanceVerified:true,linkVerified:true}});
    await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();assert.equal(f.controls.snapshot().protectionVerified,true);assert.equal(f.controls.snapshot().timing.sourceToVerifiedProtectedFillMs,600.5);assert.match(f.$('paper-user-status').textContent,/מילוי והגנות/);
  }finally{f.close();}
});

test('optional power bar remains off after inspection, shows connecting during start, and follows the existing arm and stop buttons',async()=>{
  const f=fixture({powerBar:true});try{
    assert.equal(f.$('paper-user-power-state').textContent,'כבוי');assert.equal(f.$('paper-user-power-bar').dataset.state,'off');assert.equal(f.calls.length,0);
    await f.$('paper-user-inspect').emit('click');assert.equal(f.$('paper-user-power-state').textContent,'כבוי');
    f.$('paper-user-consent').checked=true;await f.$('paper-user-consent').emit('change');f.holdNextRead();const starting=f.$('paper-user-arm').emit('click');await flush();f.controls.refresh();
    assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');assert.match(f.$('paper-user-power-state').textContent,/מתחבר/);
    f.releaseRead();await starting;assert.equal(f.$('paper-user-power-state').textContent,'פעיל וממתין לאיתות');assert.equal(f.$('paper-user-power-bar').dataset.state,'active');
    assert.equal(f.controls.snapshot().startupMeasurement.status,'ACTIVE');assert.equal(f.controls.snapshot().startupMeasurement.elapsedMs,0);
    await f.$('paper-user-disarm').emit('click');assert.equal(f.$('paper-user-power-state').textContent,'כבוי');assert.equal(f.$('paper-user-power-bar').dataset.state,'off');assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('a pending routine connection read preserves verified active status while an explicit disconnect remains amber',async()=>{
  const f=fixture({powerBar:true,prepareSession:async()=>{}});
  try{
    await f.controls.activate();assert.equal(f.$('paper-user-power-bar').dataset.state,'active');
    f.holdNextRead();await f.pulse();f.controls.refresh();
    assert.equal(f.controls.snapshot().busy,true);assert.equal(f.controls.snapshot().lifecycle.connected,true);assert.equal(f.controls.snapshot().lifecycle.entryAllowed,true);
    assert.equal(f.$('paper-user-power-bar').dataset.state,'active');assert.equal(f.$('paper-user-power-state').textContent,'פעיל וממתין לאיתות');
    f.controls.disconnect('SOURCE_LOST_DURING_READ');
    assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');assert.equal(f.$('paper-user-power-state').textContent,'פעיל · ממתין לחיבור');assert.equal(f.controls.snapshot().lifecycle.entryAllowed,false);
    f.releaseRead();await flush();assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');assert.equal(f.controls.snapshot().lifecycle.entryAllowed,false);assert.equal(f.dispatches.length,0);
  }finally{f.releaseRead();f.close();}
});

test('power bar shows disconnected waiting and unresolved submission review without marking either state green',async()=>{
  const f=fixture({powerBar:true});try{
    await f.inspectArm();f.controls.disconnect('SOURCE_RESET');assert.equal(f.$('paper-user-power-state').textContent,'פעיל · ממתין לחיבור');assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');
    await f.pulse();assert.equal(f.$('paper-user-power-state').textContent,'פעיל וממתין לאיתות');
    const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,1);assert.equal(f.$('paper-user-power-state').textContent,'נדרשת בדיקה');assert.equal(f.$('paper-user-power-bar').dataset.state,'review');
    await f.pulse();assert.equal(f.$('paper-user-power-state').textContent,'נדרשת בדיקה');assert.equal(f.$('paper-user-power-bar').dataset.state,'review');assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('power bar distinguishes an armed filled trade from stopped entries while preserving the detailed fill timing',async()=>{
  const f=fixture({powerBar:true,owned:'FILLED'});try{
    await f.inspectArm();const b=f.publish();b.item.sourceObservation=f.sourceOrigin();await f.controls.accept(b.item,b.analysis,b.state);await f.pulse();
    assert.equal(f.$('paper-user-power-state').textContent,'פעיל · עסקה פתוחה');assert.equal(f.$('paper-user-power-bar').dataset.state,'active');
    const detailed=f.$('paper-user-status').textContent;assert.match(detailed,/מילוי Paper אומת/);assert.match(detailed,/600\.5 ms/);f.controls.refresh();assert.equal(f.$('paper-user-status').textContent,detailed);
    await f.$('paper-user-disarm').emit('click');assert.equal(f.$('paper-user-power-state').textContent,'כבוי · עסקה קיימת');assert.equal(f.$('paper-user-power-bar').dataset.state,'off');assert.match(f.$('paper-user-status').textContent,/600\.5 ms/);assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('explicit top Start prepares a cold source, reads the native preset, grants Paper consent and arms only after real source readiness',async()=>{
  let preparation,release;const ready=new Promise(resolve=>{release=resolve;});
  const f=fixture({surface:'ORDER_TICKET_PRESET',powerBar:true,prepareSession:async args=>{preparation=args;args.onProgress('טוען היסטוריה · 69 מתוך 100 נרות');await ready;}});
  try{
    f.ctx.source.active=false;f.ctx.state.ready=false;f.controls.refresh();assert.equal(f.$('paper-user-arm').disabled,false);assert.equal(f.calls.length,0);
    const starting=f.$('paper-user-arm').emit('click');await flush();assert.equal(f.controls.snapshot().startup.phase,'SOURCE_PREPARATION');assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');assert.match(f.$('paper-user-power-detail').textContent,/69 מתוך 100/);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.calls.length,0);
    f.controls.disconnect('EXPECTED_BOOTSTRAP_SOURCE_RESET');assert.equal(preparation.isCancelled(),false);
    f.ctx.source.active=true;f.ctx.state.ready=true;release();await starting;
    assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().lifecycle.entryAllowed,true);assert.equal(f.controls.snapshot().startup,null);assert.equal(f.$('paper-user-consent').checked,true);assert.equal(f.$('paper-user-power-bar').dataset.state,'active');
    assert.equal(f.calls.filter(a=>a.action==='inspect').length,1);assert.equal(f.calls.find(a=>a.action==='read_connection').expected.nativePresetName,'ROI MARKET 20/30');assert.equal(f.dispatches.length,0);
    await f.$('paper-user-disarm').emit('click');assert.equal(f.ctx.source.active,true);assert.equal(f.$('paper-user-arm').disabled,false);await f.controls.activate();
    assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().lifecycle.entryAllowed,true);assert.equal(f.calls.filter(a=>a.action==='inspect').length,2);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('session preparation returning a pretend READY cannot bypass the actual source guard or arm Paper',async()=>{
  const f=fixture({powerBar:true,prepareSession:async()=>({ready:true,sourceVerified:true})});try{
    f.ctx.state.ready=false;f.controls.refresh();await f.controls.activate();assert.equal(f.controls.snapshot().armed,false);assert.equal(f.controls.snapshot().running,false);assert.match(f.controls.snapshot().lastError,/FRESH_VERIFIED_LIVE_SOURCE_REQUIRED/);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.calls.length,0);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('Stop cancels pending source preparation and late progress or success cannot inspect, consent or start the runner',async()=>{
  let preparation,release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({powerBar:true,prepareSession:async args=>{preparation=args;await pending;}});try{
    const starting=f.controls.activate();await flush();assert.equal(f.controls.snapshot().startupMeasurement.status,'STARTING');await f.$('paper-user-disarm').emit('click');assert.equal(preparation.isCancelled(),true);preparation.onProgress('late progress');release();await starting;
    assert.equal(f.controls.snapshot().startup,null);assert.equal(f.controls.snapshot().running,false);assert.equal(f.controls.snapshot().armed,false);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.$('paper-user-power-state').textContent,'כבוי');assert.equal(f.calls.length,0);assert.equal(f.dispatches.length,0);
    assert.equal(f.controls.snapshot().startupMeasurement.status,'CANCELLED');assert.equal(f.controls.snapshot().startupMeasurement.activeAt,null);assert.equal(f.controls.snapshot().startupMeasurement.elapsedMs,null);
  }finally{f.close();}
});

test('Stop during startup native inspection or runner connection invalidates late results before any reservation or entry',async()=>{
  for(const phase of ['inspect','start']){
    const f=fixture({holdInspect:phase==='inspect',powerBar:true,prepareSession:async()=>{}});try{
      if(phase==='start')f.holdNextRead();const starting=f.controls.activate();await flush();assert.ok(f.calls.some(a=>a.action===(phase==='inspect'?'inspect':'read_connection')));
      f.controls.disarm('USER_STOP_DURING_STARTUP');if(phase==='inspect')f.resolvePrepare();else f.releaseRead();await starting;await flush();
      assert.equal(f.controls.snapshot().running,false);assert.equal(f.controls.snapshot().armed,false);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY]?.attempts?.length??0,0);
    }finally{f.close();}
  }
});

test('startup rejects a changed Paper selection and never prepares a real broker profile',async()=>{
  let preparation,release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({prepareSession:async args=>{preparation=args;await pending;}});try{
    const starting=f.controls.activate();await flush();f.ctx.account.selectionFingerprint='another-selection';assert.equal(preparation.isCancelled(),true);release();await starting;assert.equal(f.controls.snapshot().armed,false);assert.equal(f.calls.length,0);assert.equal(f.$('paper-user-consent').checked,false);
  }finally{f.close();}
  let called=0;const broker=fixture({provider:'TRADOVATE',environment:'PA',prepareSession:async()=>{called++;}});try{await broker.controls.activate();assert.equal(called,0);assert.equal(broker.$('paper-user-arm').disabled,true);assert.equal(broker.calls.length,0);assert.equal(broker.controls.snapshot().armed,false);}finally{broker.close();}
});

test('a stopped older polling loop cannot release the busy state of a new explicit startup',async()=>{
  let delay=false,release;const preparation=new Promise(resolve=>{release=resolve;});
  const f=fixture({powerBar:true,prepareSession:async()=>{if(delay)await preparation;}});try{
    await f.controls.activate();f.holdNextRead();await f.pulse();f.controls.disarm('USER_STOP');delay=true;const starting=f.controls.activate();await flush();
    f.releaseRead();await flush();assert.equal(f.controls.snapshot().startup.phase,'SOURCE_PREPARATION');assert.equal(f.$('paper-user-arm').disabled,true);assert.equal(f.$('paper-user-disarm').disabled,false);assert.equal(f.$('paper-user-power-bar').dataset.state,'waiting');
    release();await starting;assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().lifecycle.entryAllowed,true);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('startup measurement starts at the explicit click and ends only at verified entry readiness, not at read-only restart recovery',async()=>{
  let release;const ready=new Promise(resolve=>{release=resolve;});const f=fixture({powerBar:true,prepareSession:async()=>{await ready;}});try{
    assert.equal(f.controls.snapshot().startupMeasurement,null);const starting=f.$('paper-user-arm').emit('click');await flush();const before=f.controls.snapshot().startupMeasurement;assert.equal(before.status,'STARTING');assert.equal(before.activeAt,null);
    f.tick(400);release();await starting;const active=f.controls.snapshot().startupMeasurement;assert.equal(active.status,'ACTIVE');assert.equal(active.activeAt,active.startedAt+400);assert.equal(active.elapsedMs,400);assert.equal(active.clockDomain,'RECEIVER_PERFORMANCE_EPOCH');assert.match(f.$('paper-user-power-detail').textContent,/הפעלה אחרונה: 400\.0 ms/);
    const b=f.publish();await f.controls.accept(b.item,b.analysis,b.state);assert.equal(f.dispatches.length,1);f.controls.disarm('USER_STOP');await f.controls.activate();const recovery=f.controls.snapshot();
    assert.equal(recovery.status,'RECOVERY_REQUIRED');assert.equal(recovery.lifecycle.entryAllowed,false);assert.equal(recovery.startupMeasurement.status,'REVIEW_REQUIRED');assert.equal(recovery.startupMeasurement.activeAt,null);assert.equal(recovery.startupMeasurement.elapsedMs,null);assert.doesNotMatch(f.$('paper-user-power-detail').textContent,/הפעלה אחרונה/);assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('quickstart failures show Hebrew explanations while retaining exact diagnostic codes and never recording an active timestamp',async()=>{
  const failures={PAPER_DEMO_PROFILE_REQUIRED:/פרופיל Paper/,MULTIPLE_RESEARCH_TABS:/כמה לשוניות מחקר/,RESEARCH_START_TIMEOUT:/מוכן בזמן הקצוב/,RESEARCH_PAPER_UI_UNAVAILABLE:/בקרי המסחר/,STOP_OTHER_SOURCE_BEFORE_START:/מקור אחר כבר פעיל/,RESEARCH_SOURCE_CHANGED:/השתנו במהלך ההפעלה/};let code;
  const f=fixture({powerBar:true,prepareSession:async()=>{throw Error(code);}});try{
    for(const [value,explanation]of Object.entries(failures)){code=value;await f.controls.activate();const current=f.controls.snapshot();assert.equal(current.lastError,value);assert.equal(current.startupMeasurement.status,'FAILED');assert.equal(current.startupMeasurement.activeAt,null);assert.equal(current.startupMeasurement.elapsedMs,null);assert.match(f.$('paper-user-status').textContent,explanation);assert.match(f.$('paper-user-power-detail').textContent,explanation);assert.doesNotMatch(f.$('paper-user-status').textContent,new RegExp(value));assert.equal(current.armed,false);}
    assert.equal(f.calls.length,0);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('a changed receiver clock cannot yield a numeric startup duration even when the actual Paper session becomes ready',async()=>{
  let release;const ready=new Promise(resolve=>{release=resolve;});const f=fixture({powerBar:true,prepareSession:async()=>{await ready;}});try{
    const starting=f.controls.activate();await flush();f.setReceiverOrigin(1);f.tick(400);release();await starting;const current=f.controls.snapshot();
    assert.equal(current.armed,true);assert.equal(current.lifecycle.entryAllowed,true);assert.equal(current.startupMeasurement.status,'ACTIVE');assert.equal(current.startupMeasurement.activeAt,null);assert.equal(current.startupMeasurement.elapsedMs,null);assert.doesNotMatch(f.$('paper-user-power-detail').textContent,/הפעלה אחרונה/);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('observed quiet 2500ms and7500ms receipt gaps preserve read-only connection baseline while stale technical approval cannot prepare or submit',async()=>{
  const f=fixture();try{
    await f.inspectArm();const initial=f.controls.snapshot().lifecycle,receipt=f.ctx.state.lastReceivedAt;
    for(let i=0;i<5;i++)await f.pulse(500,{freshReceipt:false});f.controls.refresh();
    let state=f.controls.snapshot();assert.equal(state.running,true);assert.equal(state.lifecycle.connected,true);assert.equal(state.lifecycle.baselineClosedAt,initial.baselineClosedAt);assert.equal(state.lifecycle.generation,initial.generation);
    const old=f.publish();f.ctx.state.lastReceivedAt=receipt;old.state.lastReceivedAt=receipt;await f.controls.accept(old.item,old.analysis,old.state);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.equal(f.dispatches.length,0);
    for(let i=0;i<10;i++)await f.pulse(500,{freshReceipt:false});f.controls.refresh();state=f.controls.snapshot();
    assert.equal(state.running,true);assert.equal(state.lifecycle.connected,true);assert.equal(state.lifecycle.entryAllowed,true);assert.equal(state.lifecycle.generation,initial.generation);assert.equal(state.lifecycle.baselineClosedAt,initial.baselineClosedAt);assert.equal(f.ctx.state.lastReceivedAt,receipt);assert.equal(f.dispatches.length,0);
    const fresh=f.publish();await f.controls.accept(fresh.item,fresh.analysis,fresh.state);assert.equal(f.dispatches.length,1);assert.equal(f.calls.filter(a=>a.action==='prepare').length,1);
  }finally{f.close();}
});

test('connection health still disconnects after15seconds without a source receipt and never restamps the old packet',async()=>{
  const f=fixture();try{
    await f.inspectArm();const initial=f.controls.snapshot().lifecycle,receipt=f.ctx.state.lastReceivedAt;
    for(let i=0;i<31;i++)await f.pulse(500,{freshReceipt:false});f.controls.refresh();const state=f.controls.snapshot();
    assert.equal(state.status,'DISCONNECTED');assert.equal(state.lifecycle.connected,false);assert.equal(state.lifecycle.entryAllowed,false);assert.ok(state.lifecycle.generation>initial.generation);assert.equal(f.ctx.state.lastReceivedAt,receipt);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('the read-only health allowance preserves hard snapshot, identity and stale-store rejection during quiet gaps',async()=>{
  for(const mutate of [c=>{c.state.requiresSnapshot=true;},c=>{c.state.metadata.instrument='CME:ES1!';},c=>{c.state.stale=true;},c=>{c.state.metadata.sourceId='another-run';}]){
    const f=fixture();try{await f.inspectArm();for(let i=0;i<5;i++)await f.pulse(500,{freshReceipt:false});mutate(f.ctx);f.controls.refresh();await flush();const state=f.controls.snapshot();assert.equal(state.lifecycle.connected,false);assert.equal(state.lifecycle.entryAllowed,false);assert.equal(f.calls.some(a=>a.action==='prepare'),false);assert.equal(f.dispatches.length,0);}finally{f.close();}
  }
});

const paObservation=(f,patch={})=>({kind:'TRADOVATE_NATIVE_READINESS_V1',status:'PREPARATION_ONLY',observedAt:f.ctx.state.lastReceivedAt,readOnly:true,ordersCreated:false,submitted:false,botActive:false,executionReady:false,realBrokerOrdersAuthorized:false,
  capabilities:{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false},account:{provider:'TRADOVATE',environment:'PA',environmentVerified:false,nativeIdentityVerified:true,nativeAccountId:f.ctx.account.brokerProfile.nativeAccountId,ordersAuthorized:false},source:{tabId:77,url:RESEARCH_URL},preset:null,inventory:null,checks:[],missingChecks:['EXECUTION_ADAPTER_NOT_IMPLEMENTED'],...patch});

test('same top button prepares the selected PA for read-only review and never inspects Paper, consents, claims or arms',async()=>{
  let f,called=0;f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,prepareOtherAccount:async({isCancelled,onProgress})=>{called++;assert.equal(isCancelled(),false);onProgress('קורא את זהות ה־PA ואת פרטי הפריסט');return paObservation(f);}});
  try{
    assert.equal(f.$('paper-user-arm').textContent,'בדיקת חיבור PA');assert.equal(f.$('paper-user-arm').disabled,false);assert.equal(f.$('paper-user-consent').disabled,true);assert.equal(f.$('paper-user-inspect').disabled,true);assert.equal(called,0);
    await f.$('paper-user-arm').emit('click');const r=f.controls.snapshot();assert.equal(called,1);assert.equal(r.armed,false);assert.equal(r.running,false);assert.equal(r.lifecycle.entryAllowed,false);assert.equal(r.startupMeasurement,null);
    assert.equal(r.otherAccountPreparation.status,'PREPARATION_ONLY');assert.equal(r.otherAccountPreparation.readOnly,true);assert.equal(r.otherAccountPreparation.botActive,false);assert.equal(r.otherAccountPreparation.executionReady,false);assert.equal(r.otherAccountPreparation.capabilities.submitMarket,false);assert.ok(r.otherAccountPreparation.missingChecks.includes('EXECUTION_ADAPTER_NOT_IMPLEMENTED'));
    assert.match(f.$('paper-user-power-state').textContent,/PA.*לא פעיל/);assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');assert.match(f.$('paper-user-power-detail').textContent,/מסלול ביצוע אוטומטי ל־PA עדיין אינו מחובר/);assert.equal(f.$('paper-user-consent').checked,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.data,{});assert.equal(f.dispatches.length,0);
  }finally{f.close();}
});

test('a PA preparation callback cannot launder READY, writer capabilities or claimed native protection into an active session',async()=>{
  let f,value;f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,prepareOtherAccount:async()=>value});
  try{
    for(const patch of [{status:'READY',botActive:true,executionReady:true,realBrokerOrdersAuthorized:true},{capabilities:{inspectAccount:true,preflight:true,submitMarket:true,reconcile:true}},{preset:{readOnly:true,freshApplicationVerified:true,inheritanceVerified:true,protectionVerified:true,inputValuesSetByDriver:false}},{inventory:{positionsComplete:true,workingOrdersComplete:true,flatVerified:true}},{account:{provider:'TRADOVATE',environment:'PA',nativeAccountId:'DIFFERENT',environmentVerified:false,ordersAuthorized:false}}]){
      value=paObservation(f,patch);await f.controls.activate();const r=f.controls.snapshot();assert.equal(r.armed,false);assert.equal(r.running,false);assert.equal(r.otherAccountPreparation.status,'BLOCKED');assert.equal(r.otherAccountPreparation.executionReady,false);assert.equal(r.otherAccountPreparation.capabilities.submitMarket,false);assert.equal(r.otherAccountPreparation.account,null);assert.equal(r.otherAccountPreparation.preset,null);assert.ok(r.otherAccountPreparation.missingChecks.includes('PA_PREPARATION_RESULT_NOT_VERIFIED'));assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');assert.equal(f.$('paper-user-consent').checked,false);
    }
    assert.equal(f.calls.length,0);assert.equal(f.dispatches.length,0);assert.deepEqual(f.data,{});
  }finally{f.close();}
});

test('Stop cancels a pending PA preparation and late success/progress cannot revive its result or invoke a writer',async()=>{
  let f,args,release;const pending=new Promise(resolve=>{release=resolve;});f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,prepareOtherAccount:async a=>{args=a;await pending;return paObservation(f);}});
  try{
    const running=f.controls.activate();await flush();assert.equal(f.controls.snapshot().startup.phase,'OTHER_ACCOUNT_PREPARATION');assert.equal(f.$('paper-user-disarm').disabled,false);assert.equal(f.$('paper-user-arm').disabled,true);assert.match(f.$('paper-user-power-state').textContent,/בדיקת PA.*לא פעיל/);
    await f.$('paper-user-disarm').emit('click');assert.equal(args.isCancelled(),true);args.onProgress('late progress');release();await running;
    const r=f.controls.snapshot();assert.equal(r.startup,null);assert.equal(r.otherAccountPreparation.status,'CANCELLED');assert.equal(r.armed,false);assert.equal(r.running,false);assert.equal(r.otherAccountPreparation.botActive,false);assert.match(f.$('paper-user-power-detail').textContent,/בוטלה/);assert.equal(f.$('paper-user-consent').checked,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.data,{});
  }finally{f.close();}
});

test('changing a selected PA account invalidates pending and completed read-only preparations',async()=>{
  let f,args,release;const pending=new Promise(resolve=>{release=resolve;});f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,prepareOtherAccount:async a=>{args=a;await pending;return paObservation(f);}});
  try{
    const running=f.controls.activate();await flush();f.ctx.account.selectionFingerprint='other-account-selection';f.ctx.account.brokerProfile={...f.ctx.account.brokerProfile,nativeAccountId:'SECOND-PA',revision:2};assert.equal(args.isCancelled(),true);f.controls.refresh();release();await running;
    assert.equal(f.controls.snapshot().otherAccountPreparation,null);assert.equal(f.controls.snapshot().armed,false);assert.equal(f.controls.snapshot().running,false);assert.deepEqual(f.calls,[]);assert.deepEqual(f.data,{});
    await f.controls.activate();assert.equal(f.controls.snapshot().otherAccountPreparation.account.nativeAccountId,'SECOND-PA');f.ctx.account.selectionFingerprint='third-selection';f.controls.refresh();assert.equal(f.controls.snapshot().otherAccountPreparation,null);
  }finally{f.close();}
});

test('expected source preparation disconnects do not cancel PA read-only inspection, but observed provider mismatch remains nonactive',async()=>{
  let f;f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,prepareOtherAccount:async args=>{f.controls.disconnect('EXPECTED_NEW_SOURCE_BASELINE');assert.equal(args.isCancelled(),false);return paObservation(f,{status:'BLOCKED',account:null,missingChecks:['EXECUTION_ADAPTER_NOT_IMPLEMENTED','EXACT_TRADOVATE_PROVIDER_REQUIRED']});}});
  try{await f.controls.activate();const r=f.controls.snapshot();assert.equal(r.otherAccountPreparation.status,'BLOCKED');assert.equal(r.armed,false);assert.equal(r.running,false);assert.match(f.$('paper-user-power-detail').textContent,/נדרש חיבור Tradovate/);assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');assert.deepEqual(f.calls,[]);assert.deepEqual(f.data,{});}finally{f.close();}
});

test('Paper activation keeps its original execution path and never invokes the optional PA callback',async()=>{
  let calls=0;const f=fixture({powerBar:true,prepareSession:async()=>{},prepareOtherAccount:async()=>{calls++;throw Error('NOT_FOR_PAPER');}});
  try{await f.controls.activate();assert.equal(calls,0);assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().lifecycle.entryAllowed,true);assert.equal(f.controls.snapshot().otherAccountPreparation,null);assert.equal(f.$('paper-user-arm').textContent,'הפעלת הבוט');assert.equal(f.calls.filter(c=>c.action==='inspect').length,1);assert.equal(f.dispatches.length,0);}finally{f.close();}
});

test('the same explicit Start supports configured Tradovate environments with user-owned presets and no fill or SLTP prerequisite',async()=>{
  for(const environment of ['DEMO','PA','LIVE','EVALUATION'])for(const direction of ['LONG','SHORT']){
    let prepared=0;const f=fixture({provider:'TRADOVATE',environment,direction,powerBar:true,sharedNative:true,surface:'USER_MANAGED_CHART_MARKET',prepareBrokerSession:async()=>{prepared++;}});
    try{
      f.ctx.account.review.environmentVerified=false;
      assert.equal(f.$('paper-user-arm').textContent,'הפעלת הבוט');assert.equal(f.$('paper-user-arm').disabled,false);
      assert.equal(f.controls.snapshot().armed,false);assert.equal(f.controls.snapshot().realBrokerOrdersAuthorized,false);assert.equal(f.calls.length,0);
      await f.$('paper-user-arm').emit('click');let state=f.controls.snapshot();
      assert.equal(prepared,1);assert.equal(state.running,true);assert.equal(state.armed,true);assert.equal(state.lifecycle.entryAllowed,true);assert.equal(state.realBrokerOrdersAuthorized,true);
      assert.equal(state.connection.provider,'TRADOVATE');assert.equal(state.connection.environment,environment);assert.equal(state.connection.environmentVerified,false);assert.equal(state.connection.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');
      assert.equal(state.connection.executionSurface,'USER_MANAGED_CHART_MARKET');assert.equal(state.connection.nativePreset.stopTargetRead,false);assert.equal(state.connection.nativePreset.inputValuesSetByDriver,false);assert.equal(state.protectionVerified,false);assert.equal(state.lastVerifiedFill,null);
      assert.equal(f.$('paper-user-power-bar').dataset.state,'active');assert.match(f.$('paper-user-power-state').textContent,/פעיל/);assert.match(f.$('paper-user-power-detail').textContent,new RegExp('Tradovate '+environment));
      assert.equal(f.calls.find(c=>c.action==='inspect').expected.executionAuthorized,false);assert.equal(f.dispatches.length,0);
      const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);assert.equal(f.dispatches.length,1);
      const submit=f.dispatches[0];assert.equal(submit.expected.provider,'TRADOVATE');assert.equal(submit.expected.environment,environment);assert.equal(submit.expected.executionAuthorized,true);assert.equal(submit.permit.signal.direction,direction);assert.equal(submit.permit.binding.adapterId,'tradovate-market-ui');
      assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'UNKNOWN');assert.equal(f.calls.some(c=>/set|cancel|close/i.test(c.action)),false);
      await f.pulse();await f.controls.accept(a.item,a.analysis,a.state);await f.pulse();assert.equal(f.dispatches.length,1);
      f.controls.disarm('USER_STOP');state=f.controls.snapshot();assert.equal(state.running,false);assert.equal(state.armed,false);assert.equal(state.realBrokerOrdersAuthorized,false);
    }finally{f.close();}
  }
});

test('Paper DEMO can explicitly use the same chart Market command as Tradovate while retaining exact Paper identity',async()=>{
  const f=fixture({sharedNative:true,powerBar:true,surface:'USER_MANAGED_CHART_MARKET',prepareSession:async()=>{}});
  try{
    await f.controls.activate();assert.equal(f.controls.snapshot().armed,true);assert.equal(f.controls.snapshot().realBrokerOrdersAuthorized,false);
    const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);assert.equal(f.dispatches.length,1);const submit=f.dispatches[0];
    assert.equal(submit.expected.provider,'TRADINGVIEW_PAPER');assert.equal(submit.expected.environment,'DEMO');assert.equal(submit.expected.executionAuthorized,true);assert.equal(submit.permit.binding.adapterId,'tradingview-paper-market-ui');
    assert.equal(f.controls.snapshot().lastNativeResult.nativeStatus,'NATIVE_USER_SUBMITTED_UNCONFIRMED');
  }finally{f.close();}
});

test('configured broker Start rejects stale source, mismatched native provider and false environment attestations without consent or dispatch',async()=>{
  for(const patch of [{provider:'TRADINGVIEW_PAPER',environment:'DEMO',environmentVerified:true},{nativeAccountId:'ANOTHER-ACCOUNT'},{environment:'LIVE'},{environmentVerified:true},{environmentBasis:'UNVERIFIED_OTHER_BASIS'},{nativeIdentityVerified:false}]){
    const f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,sharedNative:true,prepareBrokerSession:async()=>{}});
    try{f.ctx.account.review.environmentVerified=false;f.setConnection(patch);await f.controls.activate();assert.equal(f.controls.snapshot().armed,false);assert.equal(f.controls.snapshot().running,false);assert.equal(f.$('paper-user-consent').checked,false);assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');assert.equal(f.dispatches.length,0);}finally{f.close();}
  }
  const stale=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,sharedNative:true,prepareBrokerSession:async()=>({ready:true})});
  try{stale.ctx.state.ready=false;await stale.controls.activate();assert.equal(stale.controls.snapshot().armed,false);assert.equal(stale.calls.length,0);assert.equal(stale.dispatches.length,0);}finally{stale.close();}
});

test('Stop and a changed broker selection cancel pending broker preparation and cannot arm on late success',async()=>{
  for(const change of ['stop','profile']){
    let args,release;const waiting=new Promise(resolve=>{release=resolve;});const f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,sharedNative:true,prepareBrokerSession:async a=>{args=a;await waiting;}});
    try{
      const start=f.controls.activate();await flush();assert.equal(f.controls.snapshot().startup.phase,'SOURCE_PREPARATION');
      if(change==='stop')f.controls.disarm('USER_STOP');else{f.ctx.account.selectionFingerprint='ANOTHER-PROFILE';f.ctx.account.brokerProfile={...f.ctx.account.brokerProfile,nativeAccountId:'ANOTHER-PA'};f.controls.refresh();}
      assert.equal(args.isCancelled(),true);release();await start;assert.equal(f.controls.snapshot().armed,false);assert.equal(f.controls.snapshot().running,false);assert.equal(f.controls.snapshot().realBrokerOrdersAuthorized,false);assert.equal(f.$('paper-user-consent').checked,false);assert.equal(f.calls.length,0);assert.equal(f.dispatches.length,0);assert.notEqual(f.$('paper-user-power-bar').dataset.state,'active');
    }finally{f.close();}
  }
});

test('broker attributed fill evidence remains user-declared environment evidence when persisted and recovered',async()=>{
  const f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,sharedNative:true,owned:'FILLED',prepareBrokerSession:async()=>{}});
  try{
    f.ctx.account.review.environmentVerified=false;await f.controls.activate();const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);await f.pulse();
    assert.equal(f.controls.snapshot().status,'FILLED');const row=f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0];assert.equal(row.status,'FILLED');const evidence=row.history.at(-1).proof.accountEvidence;assert.equal(evidence.environmentVerified,false);assert.equal(evidence.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');
    f.controls.disarm('USER_STOP');await f.controls.activate();assert.equal(f.controls.snapshot().running,true);assert.equal(f.controls.snapshot().status,'RECOVERY_REQUIRED');assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('a changed chart preset fingerprint after explicit Start cannot be used for a stale prepared entry',async()=>{
  const f=fixture({provider:'TRADOVATE',environment:'PA',powerBar:true,sharedNative:true,surface:'USER_MANAGED_CHART_MARKET',prepareBrokerSession:async()=>{}});
  try{
    await f.controls.activate();assert.equal(f.controls.snapshot().armed,true);
    f.setConnection({nativePreset:{kind:'NATIVE_CHART_USER_MANAGED_MARKET_PRESET_V1',fingerprint:'CHANGED-PRESET',sideNames:{LONG:'ANOTHER',SHORT:'ANOTHER'}}});
    const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);assert.equal(f.dispatches.length,0);assert.equal(f.calls.some(c=>c.action==='prepare'),false);assert.match(f.controls.snapshot().reason,/PINNED_PRESET_OR_SURFACE_CHANGED/);
  }finally{f.close();}
});

test('fresh native reconciliation-pending identity preserves an attributed fill without inventing inventory, fill samples or a next entry',async()=>{
  const f=fixture({powerBar:true,sharedNative:true,surface:'USER_MANAGED_CHART_MARKET',owned:'FILLED',prepareSession:async()=>{}});
  try{
    await f.controls.activate();const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);await f.pulse();assert.equal(f.controls.snapshot().status,'FILLED');
    const original=structuredClone(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0]),fill=structuredClone(f.controls.snapshot().lastVerifiedFill);f.setOwned('PENDING');
    for(let i=0;i<3;i++){
      await f.pulse();const state=f.controls.snapshot();assert.equal(state.status,'FILLED');assert.equal(state.lifecycle.entryAllowed,false);assert.equal(state.lifecycle.ownedAttempt.status,'FILLED');assert.deepEqual(state.lastVerifiedFill,fill);assert.equal(state.lifecycle.closureSamples.length,0);
      assert.deepEqual(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0],original);assert.equal(f.$('paper-user-power-state').textContent,'פעיל · עסקה פתוחה');assert.equal(f.dispatches.length,1);
    }
    await f.controls.accept(a.item,a.analysis,a.state);await f.pulse();assert.equal(f.dispatches.length,1);assert.equal(f.controls.snapshot().journal.filter(row=>row.phase==='NATIVE_FILLED_VERIFIED').length,1);
  }finally{f.close();}
});

test('native pending before an attributable fill stays unconfirmed and cannot turn cached inventory into a fresh closure sample',async()=>{
  const f=fixture({powerBar:true,sharedNative:true,owned:'PENDING',prepareSession:async()=>{}});
  try{
    await f.controls.activate();const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);await f.pulse();let state=f.controls.snapshot();
    assert.equal(state.status,'RECONCILIATION_REQUIRED');assert.equal(state.lifecycle.ownedAttempt.status,'UNKNOWN');assert.equal(state.lastVerifiedFill,null);assert.equal(state.lifecycle.entryAllowed,false);assert.equal(f.$('paper-user-power-bar').dataset.state,'review');assert.equal(f.dispatches.length,1);
    f.setOwned('FILLED');await f.pulse();assert.equal(f.controls.snapshot().status,'FILLED');f.setOwned('CLOSED');await f.pulse();assert.equal(f.controls.snapshot().lifecycle.closureSamples.length,1);
    f.setOwned('PENDING');await f.pulse();state=f.controls.snapshot();assert.equal(state.lifecycle.closureSamples.length,1);assert.ok(state.ownedRecord);assert.equal(state.lifecycle.entryAllowed,false);assert.notEqual(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'CLOSED');assert.equal(f.dispatches.length,1);
  }finally{f.close();}
});

test('pending receipts with mismatched identity, stale source, invented inventory or a different intent never project trusted pending state',async()=>{
  const patches=[{nativeAccountId:'OTHER'},{provider:'TRADOVATE',environment:'PA'},{nativeIdentityVerified:false},{attemptKey:'OTHER'},{intentKey:'OTHER'},{sourceBinding:{}},{latestClosedAt:0},{inventoryRead:true},{inventoryFresh:true},{ownedStateChanged:true},{positionsComplete:true},{workingOrders:[]},{flat:true},{synthetic:true}];
  for(const patch of patches){
    const f=fixture({powerBar:true,sharedNative:true,owned:'PENDING',prepareSession:async()=>{}});
    try{
      await f.controls.activate();const a=f.publish();await f.controls.accept(a.item,a.analysis,a.state);f.setProtection(patch);await f.pulse();const state=f.controls.snapshot();
      assert.equal(state.status,'RECOVERY_REQUIRED');assert.equal(state.lifecycle.entryAllowed,false);assert.equal(state.lastVerifiedFill,null);assert.equal(f.data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'UNKNOWN');assert.equal(f.dispatches.length,1);
    }finally{f.close();}
  }
});
