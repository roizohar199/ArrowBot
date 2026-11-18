import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as realDelay} from 'node:timers/promises';
import {canProbeIdleReplaySourceRecovery} from '../replay-research.mjs';

const html=await readFile(new URL('../replay-research.html',import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const sourceText=await readFile(new URL('../verification/nq-replay/native-NQ-merged-replay.json',import.meta.url),'utf8'),raw=JSON.parse(sourceText);
const reachabilityModel=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
class Node{
  constructor(doc){this.ownerDocument=doc;this.value='';this.textContent='';this.disabled=false;this.dataset={};this.children=[];this.listeners=new Map();}
  addEventListener(name,fn){this.listeners.set(name,fn);}emit(name){return this.listeners.get(name)?.({target:this});}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}click(){return this.emit('click');}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function pageFixture({holdNative=false,allSevenModel=false}={}){
  // A local browser simulation uses the required NQ schema to exercise the
  // real engine's CONFIRMED page path. Its transport is explicitly TEST-only
  // and cannot supply an execution intent or touch an actual TradingView tab.
  const model=structuredClone(reachabilityModel),modelMetadata=meta=>({...meta,instrument:'CME_MINI:NQ1!',synthetic:false,testOnly:false});
  const pageRaw=allSevenModel?{testOnly:true,metadata:modelMetadata(model.options.metadata),bars:model.bars,higherTimeframes:Object.fromEntries(Object.entries(model.options.higherTimeframes).map(([tf,h])=>[tf,{...h,instrument:'CME_MINI:NQ1!',metadata:modelMetadata(h.metadata)}])),provenance:{scope:'SYNTHETIC_LOCAL_PAGE_SIMULATION_NEVER_TRADINGVIEW'}}:raw;
  const pageSourceText=allSevenModel?JSON.stringify(pageRaw):sourceText;
  const doc={nodes:new Map(),getElementById(id){return this.nodes.get(id);},createElement(){return new Node(this);}};for(const id of ids)doc.nodes.set(id,new Node(doc));const $=id=>doc.getElementById(id);$('replay-fee').value='3.10';$('replay-slippage').value='2';
  const end=allSevenModel?pageRaw.bars.at(-1).closeTime:Date.UTC(2026,10,13,18),index=pageRaw.bars.findIndex(bar=>bar.closeTime===end),current={...pageRaw.bars[index],closed:true,sourceClosed:true},previous={...pageRaw.bars[index-1],closed:true,sourceClosed:true},origin=1000000,source=1000100,runEpoch=1794696402010;
  const chart={symbols:['CME_MINI:NQ1!'],interval:'1',replay:true,visibleCharts:1,documentVisible:true},witness={kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,checksumsVerified:true,metadata:{...pageRaw.metadata,replay:true,realtime:false},current,previous,currentTime:current.time,currentCloseTime:current.closeTime,runEpoch,runId:'CME_MINI:NQ1!|1|'+runEpoch,sequence:17,fields:{ARROW2_RUN_EPOCH:String(runEpoch),ARROW2_CHECKSUM_A:'777'},sourceDocumentTimeOrigin:origin,sourceObservedEpochMs:source};
  const calls=[],exports=[],listeners=new Map(),timers=[],overlayFailures=[];let cards=0,releaseNative,nativeStarted=false,timerSerial=0,tabUrl='https://www.tradingview.com/chart/Research123/';
  const nativeGate=holdNative?new Promise(resolve=>{releaseNative=resolve;}):Promise.resolve();
  const nativeFields=p=>{const last=p.records.at(-1);return {ARROW_MARKER_SCHEMA:1,ARROW_MARKER_SIGNATURE:p.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:p.records.length,ARROW_MARKER_MATCHED_COUNT:p.records.length,ARROW_MARKER_DRAWN_COUNT:p.records.length,ARROW_MARKER_MODE:2,ARROW_MARKER_LAST_TIME:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:p.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};};
  function advanceSource(){
    const index=pageRaw.bars.findIndex(bar=>bar.time===witness.current.time),next=pageRaw.bars[index+1];assert.ok(next,'controlled source has another genuine closed row');
    witness.previous=structuredClone(witness.current);witness.current={...structuredClone(next),closed:true,sourceClosed:true};witness.currentTime=next.time;witness.currentCloseTime=next.closeTime;
    witness.sequence++;witness.fields.ARROW2_CHECKSUM_A=String(777+witness.sequence);witness.sourceObservedEpochMs+=600;
  }
  const chrome={tabs:{async query(){return [{id:42,title:'NQ · Arrow OHLC Live Verification',url:tabUrl}];},async get(){return {id:42,url:tabUrl};}},scripting:{async executeScript(command){
    const name=command.func.name,args=command.args??[];calls.push({name,args});let result;
    if(name==='readReplayTradingPublicControls')result={status:'OBSERVED'};
    else if(name==='replayTradingUiCommand'){
      if(args[0].action==='read')result={status:'REPLAY_TRADING_UI_VERIFIED',ticket:{quote:27707.75,tickValue:5}};
      else if(args[0].action==='prepare')result={status:'TICKET_PREPARED_TEST',testOnly:true,signalApproved:false,submitCapabilityCreated:false};
      else if(args[0].action==='read_inventory')result={status:'REPLAY_SYMBOL_FLAT_NO_PENDING_VERIFIED',submitCapabilityCreated:false};
      else if(args[0].action==='disarm')result={status:'DISARMED',submitCapabilityCreated:false};
      else if(args[0].action==='preflight'&&allSevenModel)result={status:'LOCAL_TEST_TRANSPORT',testOnly:true,synthetic:true,ordersCreated:false};
      else if(args[0].action==='inspect_protection')result={status:'LOCAL_READ_ONLY_TEST_PROTECTION',testOnly:true,signalApproved:false,protectionVerified:true,ordersCreated:false,submitCapabilityCreated:false};
      else assert.fail('unexpected trading action '+args[0].action);
    }
    else if(name==='readReplayChartGate')result={...chart,ok:true};
    else if(name==='readTradingViewWindowEvidence')result=args[0]?.stop?{status:'STOPPED'}:{contextOnly:true,liveEligible:false,messages:[],chart,replayWitness:{...structuredClone(witness),observedAt:Date.now()}};
    else if(name==='prepareTradingViewWindowUi')result={status:'READY'};
    else if(name==='replayChartOverlayCommand'){
      if(args[0].action==='clear')result={status:'CLEARED'};
      else if(overlayFailures.length){const failure=overlayFailures.shift();if(failure.advance!==false)advanceSource();failure.mutate?.(witness,chart);result={status:failure.code??'REPLAY_WITNESS_CHANGED'};}
      else{const captured=witness.sourceObservedEpochMs,at=captured+(++cards%2?10:130);result={status:'RENDERED',documentTimeOrigin:origin,sourceObservedEpochMs:captured,renderReceiptEpoch:at,mutationEpoch:at+1,firstPaintEpoch:at+10,secondPaintEpoch:at+26};}
    }else if(name==='nativeCandleMarkerUiCommand'){
      if(args[0].action==='deliver'){nativeStarted=true;await nativeGate;}
      const captured=witness.sourceObservedEpochMs;result={status:args[0].payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED',fields:nativeFields(args[0].payload),documentTimeOrigin:origin,renderReceiptEpoch:captured+50,nativeVerifiedEpoch:captured+80,firstPaintEpoch:captured+96,secondPaintEpoch:captured+112};
    }else assert.fail('unexpected callback '+name);
    return [{result}];
  }}};
  const before={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,Option:globalThis.Option,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  Object.assign(globalThis,{document:doc,window:{addEventListener:(name,fn)=>listeners.set(name,fn)},chrome,Option:class extends Node{constructor(text,value){super(doc);this.textContent=text;this.value=String(value);}},setTimeout:(fn,ms)=>{const id=++timerSerial;timers.push({id,fn,ms,cleared:false});return id;},clearTimeout:id=>{const item=timers.find(t=>t.id===id);if(item)item.cleared=true;}});
  URL.createObjectURL=blob=>{exports.push(blob);return 'blob:replay-page-test';};URL.revokeObjectURL=()=>{};
  await import('../replay-research.mjs?presentation-page='+Math.random());
  async function settle(until=()=>true){const deadline=performance.now()+5000;do{await flush();if(until())return;await realDelay(1);}while(performance.now()<deadline);assert.fail('page did not settle within 5s');}
  await settle(()=>$('replay-tab').value==='42');$('replay-file').files=[{name:'controlled-page-fixture.json',size:pageSourceText.length,text:async()=>pageSourceText}];$('replay-file').emit('change');await settle(()=>$('replay-data-status').textContent.startsWith('נטענו'));
  return {$,calls,witness,releaseNative:()=>releaseNative?.(),nativeStarted:()=>nativeStarted,settle,failNextCard:failure=>overlayFailures.push(failure??{}),setTabUrl:url=>{tabUrl=url;},runNextTimer:()=>{while(timers.length){const item=timers.shift();if(!item.cleared)return item.fn();}},runWatchTimer:()=>{const index=timers.findIndex(t=>!t.cleared&&t.ms===500);assert.ok(index>=0);return timers.splice(index,1)[0].fn();},
    async exported(){await $('export-replay').emit('click');return JSON.parse(await exports.at(-1).text());},
    async cleanup(){releaseNative?.();listeners.get('pagehide')?.();await flush();URL.createObjectURL=before.createObjectURL;URL.revokeObjectURL=before.revokeObjectURL;for(const key of ['document','window','chrome','Option','setTimeout','clearTimeout'])if(before[key]===undefined)delete globalThis[key];else globalThis[key]=before[key];}
  };
}
test('real Replay page automatically delivers EMPTY native markers on start and each analysis, without the manual marker button',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='ok');
    assert.equal(f.calls.filter(call=>call.name==='nativeCandleMarkerUiCommand'&&call.args[0].action==='deliver').length,1);assert.equal(f.calls.filter(call=>call.name==='replayChartOverlayCommand'&&call.args[0].action==='show').length,2);assert.match(f.$('replay-marker-status').textContent,/אוטומטית/);
    const first=await f.exported();assert.equal(first.latest.presentation.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(first.latest.presentation.deliveryMode,'AUTOMATIC_ANALYSIS');assert.equal(first.latest.nativeCandleMarkers.payload.status,'EMPTY');assert.equal(first.latest.timing.finalChartReceipt.status,'RENDERED');assert.equal(first.latest.timing.sourceToFinalCardUpperMs,156);assert.equal(first.latest.replayWitness.sourceObservedEpochMs,f.witness.sourceObservedEpochMs);
    f.$('replay-status').dataset.state='';f.$('analyze-replay').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='ok');assert.equal(f.calls.filter(call=>call.name==='nativeCandleMarkerUiCommand'&&call.args[0].action==='deliver').length,2);
  }finally{await f.cleanup();}
});
test('real Replay page Stop during native delivery cancels the serial and never restores a final card',async()=>{
  const f=await pageFixture({holdNative:true});try{
    f.$('start-replay').emit('click');await f.settle(()=>f.nativeStarted());assert.equal(f.$('analyze-replay').disabled,true);assert.equal(f.$('deliver-replay-markers').disabled,true);
    f.$('stop-replay').emit('click');await f.settle(()=>f.$('replay-status').textContent.includes('נעצר'));f.releaseNative();await f.settle(()=>!f.$('inspect-replay-ui').disabled);
    assert.equal(f.calls.filter(call=>call.name==='replayChartOverlayCommand'&&call.args[0].action==='show').length,1);assert.equal(f.calls.filter(call=>call.name==='prepareTradingViewWindowUi').length,0);assert.equal(f.calls.some(call=>call.name==='replayTradingUiCommand'),false);assert.equal(f.$('replay-status').dataset.state,'');
  }finally{await f.cleanup();}
});
test('mechanical TEST uses an explicitly passive entry and preserves the fixed one-contract risk budget without submitting',async()=>{
  const f=await pageFixture();try{
    f.$('prepare-replay-test').emit('click');await f.settle(()=>!f.$('prepare-replay-test').disabled);
    const request=f.calls.find(call=>call.name==='replayTradingUiCommand'&&call.args[0].action==='prepare').args[0];
    assert.equal(request.testOnly,true);assert.equal(request.testDraft.quantity,1);assert.equal(request.testDraft.entry,27707.50);
    assert.equal(request.testDraft.stop,27698.25);assert.equal(request.testDraft.target,27726.00);
    assert.equal((request.testDraft.entry-request.testDraft.stop)*20+request.testDraft.commissionPerContract+request.testDraft.slippageTicks*5,198.1);
    assert.equal(f.calls.some(call=>call.name==='replayTradingUiCommand'&&call.args[0].action==='submit'),false);
    const record=(await f.exported()).replayTestDraft;assert.equal(record.passiveOffsetTicks,1);assert.equal(record.nativeQuote,27707.75);assert.equal(record.result.signalApproved,false);
  }finally{await f.cleanup();}
});
test('inventory button only reads native current-symbol inventory and never creates a submission',async()=>{
  const f=await pageFixture();try{
    f.$('inspect-replay-inventory').emit('click');await f.settle(()=>!f.$('inspect-replay-inventory').disabled);
    const actions=f.calls.filter(call=>call.name==='replayTradingUiCommand').map(call=>call.args[0].action);
    assert.deepEqual(actions,['read_inventory']);assert.match(f.$('replay-ui-status').textContent,/אין פוזיציה ואין פקודות/);
  }finally{await f.cleanup();}
});
test('manual TEST position prices produce only a read-only protection inspection and an explicitly scoped export',async()=>{
  const f=await pageFixture();try{
    f.$('test-protection-direction').value='LONG';f.$('test-protection-entry').value='28000';f.$('test-protection-stop').value='27990.75';f.$('test-protection-target').value='28018.50';
    f.$('inspect-replay-test-protection').emit('click');await f.settle(()=>!f.$('inspect-replay-test-protection').disabled);
    const actions=f.calls.filter(c=>c.name==='replayTradingUiCommand');assert.equal(actions.length,1);
    const command=actions[0].args[0];assert.equal(command.action,'inspect_protection');assert.equal(command.testOnly,true);
    assert.deepEqual(command.expected,{researchUrl:'https://www.tradingview.com/chart/Research123/',sourceTabId:42,instrument:'CME_MINI:NQ1!',timeframe:'1'});
    assert.deepEqual(command.expectedPlan,{direction:'LONG',quantity:1,entry:28000,stop:27990.75,target:28018.5,commissionPerContract:3.1,slippageTicks:2});
    const record=await f.exported();assert.equal(record.replayTestProtection.scope,'READ_ONLY_TEST_POSITION_NO_SIGNAL_NO_SUBMISSION');
    assert.equal(record.replayTestProtection.result.signalApproved,false);assert.equal(record.replayTestProtection.result.ordersCreated,false);
    assert.equal(record.replayExecution.armed,false);assert.equal(record.replayExecution.submissionAttempted,false);assert.equal(record.latest,null);
    assert.match(f.$('test-protection-status').textContent,/ללא אישור שוק/);
    assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'&&['prepare','execute_approved','submit','cancel_own'].includes(c.args[0].action)),false);
  }finally{await f.cleanup();}
});
test('blank, nonfinite, negative, off-tick and unbounded manual TEST prices are rejected before any inspection command',async()=>{
  const f=await pageFixture();try{
    f.$('test-protection-direction').value='LONG';f.$('test-protection-stop').value='27990.75';f.$('test-protection-target').value='28018.50';
    for(const value of ['', 'Infinity', '-1', '0', '28000.1', '1e100']){
      f.$('test-protection-entry').value=value;f.$('inspect-replay-test-protection').emit('click');await f.settle(()=>!f.$('inspect-replay-test-protection').disabled);
      assert.match(f.$('test-protection-status').textContent,/EXPLICIT_TEST_PROTECTION_PRICES_REQUIRED/);
    }
    assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'),false);
  }finally{await f.cleanup();}
});
test('automatic Replay activation retains full-engine verification, blocks TEST and never submits an unapproved market bar',async()=>{
  const f=await pageFixture();try{
    assert.equal(f.$('arm-replay-execution').disabled,true);
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.$('arm-replay-execution').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    assert.match(f.$('replay-execution-status').textContent,/ממתין לאישור מלא/);assert.equal(f.$('prepare-replay-test').disabled,true);
    assert.equal(f.$('inspect-replay-test-protection').disabled,true);f.$('inspect-replay-test-protection').emit('click');
    const exported=await f.exported();assert.equal(exported.replayExecution.engineMode,'FULL_ENGINE_RECOMPUTED');assert.equal(exported.replayExecution.armed,true);
    assert.equal(exported.replayExecution.submissionAttempted,false);assert.equal(exported.replayExecution.realBrokerOrdersAuthorized,false);
    assert.equal(f.calls.some(call=>call.name==='replayTradingUiCommand'&&['preflight','execute_approved','submit'].includes(call.args[0].action)),false);
    assert.equal(f.calls.some(call=>call.name==='replayTradingUiCommand'&&call.args[0].action==='inspect_protection'),false);
    f.$('disarm-replay-execution').emit('click');await f.settle(()=>f.$('replay-execution-status').textContent.includes('כבויה'));
    assert.equal(f.calls.filter(call=>call.name==='replayTradingUiCommand'&&call.args[0].action==='disarm').length,1);
    assert.equal(f.$('prepare-replay-test').disabled,false);
  }finally{await f.cleanup();}
});
test('automatic polling of the same closed source does not repeat the marker pipeline or create a trade',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.$('arm-replay-execution').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    const markers=f.calls.filter(call=>call.name==='nativeCandleMarkerUiCommand'&&call.args[0].action==='deliver').length;
    const readers=f.calls.filter(call=>call.name==='readTradingViewWindowEvidence').length;
    f.runNextTimer();await f.settle(()=>!f.$('analyze-replay').disabled);
    assert.equal(f.calls.filter(call=>call.name==='readTradingViewWindowEvidence').length,readers+1);
    assert.equal(f.calls.filter(call=>call.name==='nativeCandleMarkerUiCommand'&&call.args[0].action==='deliver').length,markers);
    assert.equal(f.calls.some(call=>call.name==='replayTradingUiCommand'&&call.args[0].action==='execute_approved'),false);
  }finally{await f.cleanup();}
});

test('a changed forming quote retries the same confirmed cutoff with its fresh witness, without repeating Pine or authorizing the TEST model',async()=>{
  const f=await pageFixture({allSevenModel:true});try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.$('arm-replay-execution').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    const first=await f.exported();assert.ok(first.latest,JSON.stringify(first.failure));assert.equal(first.latest.decision.status,'CONFIRMED');assert.equal(first.replayExecution.reason,'REPLAY_NONTEST_PROOFS_REQUIRED');
    const markers=f.calls.filter(c=>c.name==='nativeCandleMarkerUiCommand'&&c.args[0].action==='deliver').length;
    const prior=structuredClone(f.witness.current),cutoff=prior.closeTime;
    f.witness.previous={...prior,closed:true,sourceClosed:true};
    f.witness.current={...prior,time:cutoff,closeTime:cutoff+60000,open:prior.close,high:prior.close+.25,low:prior.close,close:prior.close+.25,closed:false,sourceClosed:false};
    f.witness.currentTime=cutoff;f.witness.currentCloseTime=cutoff+60000;f.witness.sequence++;f.witness.sourceObservedEpochMs+=50;
    f.witness.fields.ARROW2_CHECKSUM_A='778';
    f.runWatchTimer();await f.settle(()=>!f.$('analyze-replay').disabled);
    const next=await f.exported();assert.equal(next.replayExecution.journal.length,first.replayExecution.journal.length+2);
    assert.equal(next.latest.executionReread.cutoff.asOfTime,cutoff);assert.equal(next.latest.executionReread.cutoff.openCurrentExcluded,true);
    assert.equal(next.latest.executionReread.replayWitness.current.close,prior.close+.25);
    assert.equal(next.latest.replayWitness.current.closed,true);assert.equal(next.latest.replayWitness.sourceObservedEpochMs,first.latest.replayWitness.sourceObservedEpochMs);
    assert.equal(next.latest.decision.signal.eventId,first.latest.decision.signal.eventId);assert.equal(next.latest.decision.signal.riskPlan.initialStop,first.latest.decision.signal.riskPlan.initialStop);
    assert.equal(next.replayExecution.submissionAttempted,false);assert.equal(next.replayExecution.reason,'REPLAY_NONTEST_PROOFS_REQUIRED');
    assert.equal(f.calls.filter(c=>c.name==='nativeCandleMarkerUiCommand'&&c.args[0].action==='deliver').length,markers);
    assert.equal(f.calls.filter(c=>c.name==='replayTradingUiCommand'&&c.args[0].action==='preflight').length,2);
    assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'&&c.args[0].action==='execute_approved'),false);
    f.runWatchTimer();await f.settle(()=>!f.$('analyze-replay').disabled);
    assert.equal((await f.exported()).replayExecution.journal.length,next.replayExecution.journal.length,'identical source does not retry again');
  }finally{await f.cleanup();}
});

test('idle source recovery eligibility never covers a reserved event, unsafe order lifecycle, other error or exhausted budget',()=>{
  const base={code:'REPLAY_WITNESS_CHANGED',stage:'CHART_OVERLAY',automaticEnabled:true,sourceRun:'CME_MINI:NQ1!|1|1794696402010',consecutive:0,executionState:{state:'ARMED',armed:true,locked:false,busy:false,submissionAttempted:false,intent:null}};
  assert.equal(canProbeIdleReplaySourceRecovery(base),true);
  for(const change of [b=>{b.code='MARKER_SOURCE_WITNESS_CHANGED';},b=>{b.stage='SOURCE_READER';},b=>{b.automaticEnabled=false;},b=>{b.sourceRun=null;},b=>{b.consecutive=3;},b=>{b.executionState.intent={key:'consumed'};},b=>{b.executionState.submissionAttempted=true;},b=>{b.executionState.locked=true;},b=>{b.executionState.busy=true;},b=>{b.executionState.armed=false;}]){const b=structuredClone(base);change(b);assert.equal(canProbeIdleReplaySourceRecovery(b),false);}
  for(const state of ['PREFLIGHT','SUBMITTING','WORKING','FILLED_PROTECTED','UNKNOWNLOCK','CANCELLING','CANCELLED','DISARMED'])assert.equal(canProbeIdleReplaySourceRecovery({...base,executionState:{...base.executionState,state}}),false);
});

test('an idle same-run overlay race clears stale approval, polls fresh full analysis and records first-capture episode latency',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.failNextCard();f.$('arm-replay-execution').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='waiting'&&!f.$('analyze-replay').disabled);
    const waiting=await f.exported(),episode=waiting.sourceRecovery.episodes[0];
    assert.equal(waiting.latest,null);assert.equal(waiting.replayExecution.armed,true);assert.equal(waiting.replayExecution.submissionAttempted,false);assert.equal(waiting.replayExecution.intent,null);
    assert.equal(episode.attempts.length,1);assert.equal(episode.attempts[0].failureCode,'REPLAY_WITNESS_CHANGED');assert.equal(episode.attempts[0].freshProbe.coherentSameRun,true);
    assert.equal(episode.firstWitness.sourceObservedEpochMs,1000100);assert.equal(episode.attempts[0].failedWitness.sourceObservedEpochMs,1000100);assert.equal(episode.attempts[0].freshProbe.witness.sourceObservedEpochMs,1000700);
    assert.match(f.$('replay-decision').textContent,/ממתין לניתוח חדש/);assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'&&c.args[0].action==='disarm'),false);
    f.runWatchTimer();await f.settle(()=>f.$('replay-status').dataset.state==='ok'&&!f.$('analyze-replay').disabled);
    const recovered=await f.exported(),done=recovered.sourceRecovery.episodes[0];
    assert.equal(done.status,'RECOVERED_FULL_ANALYSIS_AND_FINAL_CARD');assert.equal(done.ordersAttempted,false);assert.equal(done.timing.sameSourceDocumentClockVerified,true);
    assert.equal(done.timing.sourceToFinalCardUpperMs,recovered.latest.timing.sourceToFinalCardUpperMs+600,'episode includes failed capture through the simulated wait, not just final attempt');
    assert.equal(recovered.latest.sourceRecoveryEpisode.firstWitness.sourceObservedEpochMs,1000100);assert.equal(recovered.latest.replayWitness.sourceObservedEpochMs,1000700);
    assert.match(f.$('replay-timing').textContent,/מהצילום הראשון/);assert.match(f.$('replay-timing').textContent,/הניסיון האחרון/);
    assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'&&['preflight','execute_approved','submit'].includes(c.args[0].action)),false);
    // A successful full presentation resets the consecutive-recovery budget.
    f.failNextCard();f.$('analyze-replay').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='waiting'&&!f.$('analyze-replay').disabled);
    assert.equal((await f.exported()).failure.recovery.retryNumber,1);
  }finally{await f.cleanup();}
});

test('a cleared latest record cannot hide a changed source run, while an explicit auto-off analysis may bind the reset Replay',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.failNextCard();f.$('arm-replay-execution').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='waiting'&&!f.$('analyze-replay').disabled);
    f.witness.runEpoch++;f.witness.runId='CME_MINI:NQ1!|1|'+f.witness.runEpoch;f.witness.fields.ARROW2_RUN_EPOCH=String(f.witness.runEpoch);
    f.runWatchTimer();await f.settle(()=>f.$('replay-status').dataset.state==='error'&&!f.$('analyze-replay').disabled);
    const blocked=await f.exported();assert.equal(blocked.latest,null);assert.equal(blocked.failure.diagnostics.errorCode,'REPLAY_SOURCE_RUN_CHANGED');assert.equal(blocked.replayExecution.armed,false);
    assert.equal(f.calls.filter(c=>c.name==='replayTradingUiCommand'&&c.args[0].action==='disarm').length,1);
    f.$('analyze-replay').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='ok'&&!f.$('analyze-replay').disabled);
    const rebound=await f.exported();assert.equal(rebound.latest.replayWitness.runId,f.witness.runId);assert.equal(rebound.replayExecution.armed,false);assert.equal(rebound.replayExecution.submissionAttempted,false);
    assert.equal(rebound.sourceRecovery.episodes[0].status,'STOPPED_RECOVERY_LIMIT_OR_UNSAFE_CONTEXT');assert.equal(rebound.latest.sourceRecoveryEpisode,undefined,'explicit manual rebinding is not an automatic same-run recovery');
  }finally{await f.cleanup();}
});

test('only three consecutive coherent source races recover; a fourth stops automatic entries without any order attempt',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);for(let i=0;i<4;i++)f.failNextCard();
    f.$('arm-replay-execution').emit('click');await f.settle(()=>f.$('replay-status').dataset.state==='waiting'&&!f.$('analyze-replay').disabled);
    for(let i=0;i<2;i++){f.runWatchTimer();await f.settle(()=>!f.$('analyze-replay').disabled);}
    const third=await f.exported();assert.equal(third.failure.recovery.retryNumber,3);assert.equal(third.replayExecution.armed,true);
    f.runWatchTimer();await f.settle(()=>f.$('replay-status').dataset.state==='error'&&!f.$('analyze-replay').disabled);
    const stopped=await f.exported();assert.equal(stopped.replayExecution.armed,false);assert.equal(stopped.replayExecution.submissionAttempted,false);assert.equal(stopped.latest,null);
    assert.equal(stopped.sourceRecovery.episodes[0].attempts.length,3);assert.equal(stopped.sourceRecovery.episodes[0].terminalFailure.consecutive,3);
    assert.equal(f.calls.filter(c=>c.name==='replayTradingUiCommand'&&c.args[0].action==='disarm').length,1);
    assert.equal(f.calls.some(c=>c.name==='replayTradingUiCommand'&&['preflight','execute_approved','submit'].includes(c.args[0].action)),false);
  }finally{await f.cleanup();}
});

test('a recovery probe rejects a changed research URL instead of keeping automation armed',async()=>{
  const f=await pageFixture();try{
    f.$('start-replay').emit('click');await f.settle(()=>!f.$('analyze-replay').disabled);
    f.failNextCard({mutate:()=>f.setTabUrl('https://www.tradingview.com/chart/DifferentResearch/')});f.$('arm-replay-execution').emit('click');
    await f.settle(()=>f.$('replay-status').dataset.state==='error'&&!f.$('analyze-replay').disabled);
    const stopped=await f.exported();assert.equal(stopped.replayExecution.armed,false);assert.equal(stopped.failure.recovery.reason,'REPLAY_RECOVERY_RESEARCH_URL_CHANGED');assert.equal(stopped.latest,null);
    assert.equal(stopped.sourceRecovery.episodes[0].status,'STOPPED_UNVERIFIED');assert.equal(stopped.replayExecution.submissionAttempted,false);
  }finally{await f.cleanup();}
});
