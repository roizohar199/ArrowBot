// Extension-page integration with a fake public-UI transport. Artificial
// positive OHLC and simulated fills never authenticate a market trade or tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as realDelay} from 'node:timers/promises';
import {initializeUserMarketResearchPage} from '../user-market-research.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
const html=await readFile(new URL('../user-market-research.html',import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const native=JSON.parse(await readFile(new URL('../verification/nq-replay/native-NQ-merged-replay.json',import.meta.url),'utf8'));
const bundledBytes=await readFile(new URL('../verification/0.19.0/older-batch/native-NQ-session-2026-10-30.json',import.meta.url));
const bundledSource=JSON.parse(bundledBytes.toString('utf8'));
const artificial=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
class Node{
  constructor(doc){this.ownerDocument=doc;this.value='';this.textContent='';this.disabled=false;this.dataset={};this.children=[];this.listeners=new Map();}
  addEventListener(name,fn){this.listeners.set(name,fn);}emit(name){return this.listeners.get(name)?.({target:this});}
  append(...children){this.children.push(...children);if(!this.value&&children[0]?.value)this.value=children[0].value;}
  replaceChildren(...children){this.children=children;}click(){return this.emit('click');}
  set innerHTML(_){throw Error('Untrusted HTML mutation');}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function pageFixture({positive=false,submitBlocked=false,unknownSubmit=false,holdNative=false,multiChart=false,bundled=false,bundleResponse='ok',holdBundle=false}={}){
  const model=structuredClone(artificial),identity=meta=>({...meta,instrument:'CME_MINI:NQ1!',synthetic:false,testOnly:false});
  // Explicit component simulation only. No artificial source is sent to the
  // real native driver: chrome.scripting below records and simulates each call.
  const raw=positive?{testOnly:true,metadata:identity(model.options.metadata),bars:model.bars,higherTimeframes:Object.fromEntries(Object.entries(model.options.higherTimeframes).map(([tf,h])=>[tf,{...h,instrument:'CME_MINI:NQ1!',metadata:identity(h.metadata)}])),provenance:{scope:'LOCAL_PAGE_COMPONENT_SIMULATION_NEVER_TRADINGVIEW'}}:structuredClone(bundled?bundledSource:native);
  const encoded=JSON.stringify(raw),doc={nodes:new Map(),getElementById(id){return this.nodes.get(id);},createElement(){return new Node(this);}};
  for(const id of ids)doc.nodes.set(id,new Node(doc));const $=id=>doc.getElementById(id);
  const end=positive||bundled?raw.bars.at(-1).closeTime:Date.UTC(2026,10,13,18),index=raw.bars.findIndex(bar=>bar.closeTime===end),runEpoch=Date.now()-60000,origin=Date.now()-100000;
  let sourceEpoch=origin+100;
  const chart={symbols:['CME_MINI:NQ1!'],interval:'1',replay:true,visibleCharts:1,documentVisible:true};
  if(multiChart)Object.assign(chart,{visibleCharts:3,chartLabels:['Chart for CME_MINI:NQ1!, 5 minutes','Chart for CME_MINI:NQ1!, 1 minute','Chart for CME_MINI:NQ1!, 1 second'],researchSelection:{kind:'UNIQUE_ACTIVE_RESEARCH_NQ_1M',visibleCharts:3,targetCharts:1,selectedChartLabel:'Chart for CME_MINI:NQ1!, 1 minute',interval:'1',researchLayoutVerified:true}});
  const witness={kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,checksumsVerified:true,metadata:{...raw.metadata,replay:true,realtime:false},
    current:{...raw.bars[index],closed:true,sourceClosed:true,providerBarIndex:124,sessionFirst:false,sessionLast:false},previous:{...raw.bars[index-1],closed:true,sourceClosed:true,providerBarIndex:123,sessionFirst:false,sessionLast:false},runEpoch,runId:'CME_MINI:NQ1!|1|'+runEpoch,sequence:17,sourceDocumentTimeOrigin:origin,sourceObservedEpochMs:sourceEpoch};
  witness.currentTime=witness.current.time;witness.currentCloseTime=witness.current.closeTime;
  witness.fields={ARROW2_RUN_EPOCH:String(runEpoch),ARROW2_SEQ_BEGIN:'17',ARROW2_SEQ_END:'17',ARROW2_CURRENT_TIME:String(17e12+witness.current.time-1577836800000),ARROW2_CURRENT_CLOSE_TIME:String(17e12+124*4),ARROW2_CHECKSUM_A:'424242',ARROW2_CHECKSUM_B:'656565'};
  const calls=[],exports=[],timers=[],storage={},listeners=new Map(),cardFailures=[];let timerId=0,cards=0,releaseNative,releaseBundle,nativeStarted=false;
  let presetInspection={status:'USER_REPLAY_BRACKET_PRESET_MISSING',protectionPresetVerified:false,savedPresetCount:0,ordersCreated:false,submitCapabilityCreated:false,leaseMinted:false,reasonCodes:['NO_NATIVE_SAVED_BRACKET_PRESET']};
  let controlsTransform=reply=>reply;
  function advanceWitness({changeRun=false,sourceAdvanceMs=40}={}){
    sourceEpoch+=sourceAdvanceMs;witness.sourceObservedEpochMs=sourceEpoch;witness.sequence++;
    if(changeRun){witness.runEpoch++;witness.runId='CME_MINI:NQ1!|1|'+witness.runEpoch;}
    const tag=witness.sequence%4096;
    Object.assign(witness.fields,{ARROW2_RUN_EPOCH:String(witness.runEpoch),ARROW2_SEQ_BEGIN:String(witness.sequence),ARROW2_SEQ_END:String(witness.sequence),ARROW2_CURRENT_TIME:String(tag*1e12+witness.current.time-1577836800000),ARROW2_CURRENT_CLOSE_TIME:String(tag*1e12+witness.current.providerBarIndex*4),ARROW2_CHECKSUM_A:String(424242+witness.sequence)});
  }
  const nativeGate=holdNative?new Promise(resolve=>{releaseNative=resolve;}):Promise.resolve();
  const bundleGate=holdBundle?new Promise(resolve=>{releaseBundle=resolve;}):Promise.resolve();
  const target={researchUrl:'https://www.tradingview.com/chart/MarketFixture1/',sourceTabId:42,instrument:'CME_MINI:NQ1!',timeframe:'1',allowResearchMultiChart:true};
  const fields=p=>{const last=p.records.at(-1);return {ARROW_MARKER_SCHEMA:p.approvalKind==='TECHNICAL'?2:1,ARROW_MARKER_SIGNATURE:p.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:p.records.length,ARROW_MARKER_MATCHED_COUNT:p.records.length,ARROW_MARKER_DRAWN_COUNT:p.records.length,ARROW_MARKER_MODE:2,ARROW_MARKER_LAST_TIME:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:p.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};};
  const chrome={runtime:{getURL(path){calls.push({name:'runtime.getURL',path});return 'chrome-extension://local-page-component/'+path;}},tabs:{async query(){return [{id:42,title:'NQ · Arrow OHLC Live Verification',url:target.researchUrl},{id:43,title:'Original three-chart layout',url:'https://www.tradingview.com/chart/Original1/'}];},async get(id){assert.equal(id,42);return {id,url:target.researchUrl};}},storage:{local:{async get(key){calls.push({name:'storage.get'});return {[key]:structuredClone(storage[key])};},async set(data){calls.push({name:'storage.set'});Object.assign(storage,structuredClone(data));}}},scripting:{async executeScript(command){
    const name=command.func.name,args=command.args??[];calls.push({name,args:structuredClone(args)});let result;
    if(name==='readReplayChartGate'){assert.equal(args[0]?.allowResearchMultiChart,true);result={...chart,ok:true};}
    else if(name==='inspectReplayOrderPreset')result=structuredClone(presetInspection);
    else if(name==='readTradingViewWindowEvidence'){assert.equal(args[0]?.allowResearchMultiChart,true);result={contextOnly:true,liveEligible:false,messages:[],chart,replayWitness:{...structuredClone(witness),observedAt:Date.now()}};}
    else if(name==='prepareTradingViewWindowUi'){if(multiChart)assert.equal(args[0]?.allowResearchMultiChart,true);result={status:'READY'};}
    else if(name==='replayChartOverlayCommand'){
      if(multiChart&&args[0].action==='show'){assert.equal(args[0].allowResearchMultiChart,true);assert.equal(args[0].expectedResearchUrl,target.researchUrl);}
      if(args[0].action==='clear')result={status:'CLEARED'};
      else if(cardFailures.length){const failure=cardFailures.shift();advanceWitness(failure);result={status:failure.code??'REPLAY_WITNESS_CHANGED'};}
      else{const at=sourceEpoch+(++cards%2?10:130);result={status:'RENDERED',documentTimeOrigin:origin,sourceObservedEpochMs:sourceEpoch,renderReceiptEpoch:at,mutationEpoch:at+1,firstPaintEpoch:at+10,secondPaintEpoch:at+26};}
    }else if(name==='nativeCandleMarkerUiCommand'){
      if(multiChart)assert.equal(args[0].expected.allowResearchMultiChart,true);
      nativeStarted=true;await nativeGate;const payload=args[0].payload;
      result={status:payload.records.length?'NATIVE_MARKERS_VERIFIED':'NATIVE_EMPTY_MARKERS_VERIFIED',fields:fields(payload),documentTimeOrigin:origin,renderReceiptEpoch:sourceEpoch+50,nativeVerifiedEpoch:sourceEpoch+80,firstPaintEpoch:sourceEpoch+96,secondPaintEpoch:sourceEpoch+112};
    }else if(name==='userMarketTradingUiCommand'){
      const c=args[0],at=Date.now();
      if(c.action==='disarm')result={status:'DISARMED'};
      else if(c.action==='read_controls')result=controlsTransform({status:'USER_MARKET_CONTROLS_OBSERVED',provider:'REPLAY_TRADING',mode:'USER_MARKET',observedAt:at,...target,
        controls:{quantity:{quantityRaw:'3',quantity:3,sourceControl:'input#dom-quantity-input[data-qa-id~="qty-dom-input"]',disabled:false,readOnly:false},buy:{label:'Buy Mkt',disabled:false},sell:{label:'Sell Mkt',disabled:false}},submitCapabilityCreated:false,ordersCreated:false,leaseCreated:false});
      else if(c.action==='read_preset'){
        const quantity=3,quantityRaw='3',control='input#dom-quantity-input[data-qa-id~="qty-dom-input"]';
        result={status:'USER_MARKET_NATIVE_READY',provider:'REPLAY_TRADING',mode:'USER_MARKET',observedAt:at,documentTimeOrigin:origin,sourceBinding:structuredClone(c.sourceBinding),sourceFields:structuredClone(witness.fields),nativeSide:c.direction==='LONG'?'BUY':'SELL',
          preset:{kind:'NATIVE_REPLAY_DOM_MARKET_QUANTITY_V1',symbol:'NQ1!',quantity,quantityRaw,sourceControl:control,scope:'NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED',bracketPresetVerified:false,fingerprint:JSON.stringify(['native-replay-dom-market-quantity-1','NQ1!',quantity,quantityRaw,control])},lease:{id:'local-test-native-lease',observedAt:at,expiresAt:at+700,maximumAgeMs:750},
          inventory:{kind:'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1',status:'FLAT_NO_PENDING',provider:'REPLAY_TRADING',scope:'CURRENT_REPLAY_SYMBOL_ONLY',...target,observedAt:at,documentTimeOrigin:origin,flat:true,positionEmpty:true,pendingEmpty:true,positionsComplete:true,workingOrdersComplete:true,buyCancelDisabled:true,sellCancelDisabled:true,positionMarker:'—',pnlMarker:'—',positions:[],workingOrders:[],quote:witness.current.close,sourceFields:structuredClone(witness.fields)}};
      }else if(c.action==='submit')result=submitBlocked?{status:'BLOCKED',submitted:false}:unknownSubmit?{status:'UNKNOWN',submitted:null}:{status:'USER_MARKET_SUBMITTED_UNCONFIRMED',submitted:true,key:c.intent.key};
      else if(c.action==='verify')result={status:'USER_MARKET_FILLED',provider:'REPLAY_TRADING',mode:'USER_MARKET',submitted:true,ordersCreated:true,fillVerified:true,protectionVerified:false,userManaged:true,
        attribution:{kind:'OWN_USER_MARKET_SUBMISSION',key:c.intent.key,sourceTabId:42,runId:witness.runId,baselineFlatVerified:true,submissionRecorded:true},
        position:{kind:'NATIVE_REPLAY_DOM_USER_MARKET_POSITION_V1',symbol:'NQ1!',direction:c.intent.direction,quantity:c.intent.quantity,entry:witness.current.close,sourceFields:structuredClone(c.lifecycleSourceBinding.fields),observedAt:at,documentTimeOrigin:origin,verificationEpochMs:sourceEpoch+500}};
      else assert.fail('unexpected native market action '+c.action);
    }else assert.fail('unexpected script '+name);
    return [{result}];
  }}};
  const prior={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),createURL:URL.createObjectURL,revokeURL:URL.revokeObjectURL};
  Object.assign(globalThis,{document:doc,window:{addEventListener:(name,fn)=>listeners.set(name,fn)},chrome,fetch:async(url,options)=>{calls.push({name:'fetch',url,options});await bundleGate;const bytes=Uint8Array.from(bundledBytes);if(bundleResponse==='changed')bytes[0]^=1;return {ok:bundleResponse!=='http-error',arrayBuffer:async()=>bytes.buffer};},setTimeout:(fn,ms)=>{const id=++timerId;timers.push({id,fn,ms,cleared:false});return id;},clearTimeout:id=>{const timer=timers.find(t=>t.id===id);if(timer)timer.cleared=true;}});
  Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_name,_options,fn)=>fn()}},configurable:true});
  URL.createObjectURL=blob=>{exports.push(blob);return 'blob:user-market-component';};URL.revokeObjectURL=()=>{};
  const api=initializeUserMarketResearchPage();
  async function settle(predicate){const deadline=performance.now()+7000;do{await flush();if(predicate())return;if(!api.snapshot().busy&&api.snapshot().failure)assert.fail('page failed: '+api.snapshot().failure.code);await realDelay(1);}while(performance.now()<deadline);assert.fail('page did not settle: '+$('market-status').textContent+' '+api.snapshot().failure?.code);}
  await settle(()=>$('market-tab').value==='42');if(!bundled){$('market-file').files=[{name:'local-page-simulation.json',size:encoded.length,text:async()=>encoded}];$('market-file').emit('change');await settle(()=>$('market-file-status').textContent.startsWith('נטענו'));}
  return {$,api,calls,timers,storage,witness,settle,nativeStarted:()=>nativeStarted,releaseNative:()=>releaseNative?.(),releaseBundle:()=>releaseBundle?.(),failNextCard:failure=>cardFailures.push(failure??{}),setPresetInspection:reply=>{presetInspection=structuredClone(reply);},setControls:transform=>{controlsTransform=transform;},
    runWatchTimer(){const index=timers.findIndex(timer=>!timer.cleared&&timer.ms===500);assert.ok(index>=0,'one pending source watch is required');const timer=timers.splice(index,1)[0];sourceEpoch+=timer.ms;witness.sourceObservedEpochMs=sourceEpoch;timer.fn();return timer.ms;},
    async start(){ $('market-start').emit('click');await settle(()=>!api.snapshot().busy&&!!api.snapshot().latest); },
    async exported(){ $('market-export').emit('click');return JSON.parse(await exports.at(-1).text()); },
    async cleanup(){releaseNative?.();releaseBundle?.();await api.stop();URL.createObjectURL=prior.createURL;URL.revokeObjectURL=prior.revokeURL;for(const key of ['document','window','chrome','fetch','setTimeout','clearTimeout'])if(prior[key]===undefined)delete globalThis[key];else globalThis[key]=prior[key];if(prior.navigator)Object.defineProperty(globalThis,'navigator',prior.navigator);else delete globalThis.navigator;}
  };
}
const nativeCalls=(f,action)=>f.calls.filter(call=>call.name==='userMarketTradingUiCommand'&&(!action||call.args[0].action===action));

async function readControls(f){const before=nativeCalls(f,'read_controls').length;f.$('market-inspect').emit('click');await f.settle(()=>!f.api.snapshot().busy&&nativeCalls(f,'read_controls').length===before+1);}
async function arm(f){const before=nativeCalls(f,'read_controls').length;f.$('market-arm').emit('click');await f.settle(()=>!f.api.snapshot().busy&&nativeCalls(f,'read_controls').length===before+1);}

test('bundled history loads only the exact local authenticated bytes and records provenance without starting or arming',async()=>{
  const f=await pageFixture({bundled:true,multiChart:true});try{
    assert.equal(f.$('market-start').disabled,true);f.$('market-load-verified').emit('click');
    await f.settle(()=>!f.api.snapshot().busy&&f.$('market-start').disabled===false);
    const requests=f.calls.filter(c=>c.name==='fetch');assert.equal(requests.length,1);
    assert.equal(requests[0].url,'chrome-extension://local-page-component/verification/0.19.0/older-batch/native-NQ-session-2026-10-30.json');
    assert.deepEqual(requests[0].options,{cache:'no-store',redirect:'error'});
    assert.match(f.$('market-file-status').textContent,/SHA-256 אומת/);
    assert.equal(f.api.snapshot().active,false);assert.equal(f.api.snapshot().execution.armed,false);assert.equal(f.calls.filter(c=>c.name==='readReplayChartGate').length,0);assert.equal(nativeCalls(f).length,0);
    await f.start();const record=f.api.snapshot().latest;
    assert.deepEqual(record.inputFile,{name:'native-NQ-session-2026-10-30.json',size:bundledBytes.byteLength,source:'BUNDLED_VERIFIED_NATIVE_RESEARCH_HISTORY',bundledPath:'verification/0.19.0/older-batch/native-NQ-session-2026-10-30.json',sha256:'a2e64a858078f1e75c72a481a977f7d09d0f65500b01e606fbabc31428ea7baa',verification:'SHA256_MATCH'});
    assert.equal(record.analysisInputs.options.risk,null);assert.equal(record.analysisInputs.options.config.strategyPolicy,'guide_scenarios_v1');
    assert.equal(f.$('market-load-verified').disabled,true);f.$('market-load-verified').emit('click');await flush();assert.equal(f.calls.filter(c=>c.name==='fetch').length,1);
    assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.api.snapshot().execution.armed,false);
    const exported=await f.exported();assert.deepEqual(exported.latest.inputFile,record.inputFile);
  }finally{await f.cleanup();}
});

test('changed bundled bytes and a failed local response leave analysis disabled and create no native activity',async()=>{
  for(const [bundleResponse,code] of [['changed','VERIFIED_RESEARCH_HISTORY_HASH_MISMATCH'],['http-error','VERIFIED_RESEARCH_HISTORY_FETCH_FAILED']]){
    const f=await pageFixture({bundled:true,bundleResponse});try{
      f.$('market-load-verified').emit('click');await f.settle(()=>!f.api.snapshot().busy&&f.$('market-status').textContent.includes(code));
      assert.equal(f.$('market-start').disabled,true);assert.equal(f.api.snapshot().active,false);assert.equal(f.api.snapshot().latest,null);assert.equal(f.api.snapshot().execution.armed,false);
      assert.equal(nativeCalls(f).length,0);assert.equal(f.calls.filter(c=>c.name==='readReplayChartGate').length,0);
    }finally{await f.cleanup();}
  }
});

test('bundled loading is serialized and keeps manual file loading available after completion',async()=>{
  const f=await pageFixture({bundled:true,holdBundle:true});try{
    f.$('market-load-verified').emit('click');await f.settle(()=>f.calls.some(c=>c.name==='fetch'));
    assert.equal(f.api.snapshot().busy,true);assert.equal(f.$('market-load-verified').disabled,true);assert.equal(f.$('market-file').disabled,true);
    f.$('market-load-verified').emit('click');assert.equal(f.calls.filter(c=>c.name==='fetch').length,1);
    f.releaseBundle();await f.settle(()=>!f.api.snapshot().busy&&f.$('market-start').disabled===false);
    assert.equal(f.$('market-file').disabled,false);assert.equal(f.$('market-load-verified').disabled,false);assert.equal(f.api.snapshot().active,false);assert.equal(nativeCalls(f).length,0);
  }finally{await f.cleanup();}
});

test('user-managed page runs the actual full technical engine with risk:null and no inherited-preset requirement',async()=>{
  const f=await pageFixture();try{
    await f.start();const record=f.api.snapshot().latest;
    assert.equal(record.extensionVersion,'0.30.5');assert.equal(record.executionPolicy,'USER_PRESET_MARKET');assert.equal(record.analysisInputs.options.risk,null);assert.equal(record.analysisInputs.options.config.requireRisk,false);
    for(const flag of ['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'])assert.equal(record.analysisInputs.options.config[flag],true);
    assert.deepEqual(record.analysis,analyzeGuideSignals(record.analysisInputs.bars,record.analysisInputs.options));
    assert.deepEqual(record.decision,{...selectGuideTechnicalDecision({analysis:record.analysis,bars:record.analysisInputs.bars}),currentChecks:record.analysis.currentChecks});
    assert.equal(record.decision.status,'NO_APPROVAL');assert.ok(['EMPTY','READY'].includes(record.presentation.nativeCandleMarkers.payload.status),'historical confirmed markers are separate from current approval');assert.equal(record.presentation.nativeCandleMarkers.payload.schemaVersion,2);assert.ok(record.presentation.nativeCandleMarkers.payload.records.every(marker=>marker.closeTime<record.cutoff.asOfTime));
    assert.equal(f.api.snapshot().execution.presetProtectionRequired,false);assert.equal(f.api.snapshot().execution.protectionVerified,false);assert.equal(f.$('market-arm').disabled,true,'read actual quantity before arming');
    await readControls(f);assert.equal(f.$('market-arm').disabled,false);assert.equal(f.$('market-tab').children.length,1);assert.equal(nativeCalls(f,'submit').length,0);
  }finally{await f.cleanup();}
});

test('missing saved SLTP is a nonblocking diagnostic while NO_APPROVAL arms only a watcher and never submits',async()=>{
  const f=await pageFixture();try{
    await f.start();f.$('market-inspect-brackets').emit('click');await f.settle(()=>!f.api.snapshot().busy&&f.calls.some(c=>c.name==='inspectReplayOrderPreset'));
    assert.match(f.$('market-bracket-preset').textContent,/אינה חוסמת/);await readControls(f);await arm(f);
    assert.equal(f.api.snapshot().execution.state,'ARMED');assert.equal(f.api.snapshot().execution.armed,true);assert.equal(f.api.snapshot().execution.presetProtectionRequired,false);
    assert.equal(nativeCalls(f,'read_controls').length,2,'arm performs a fresh read');assert.equal(nativeCalls(f,'read_preset').length,0);assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.calls.filter(c=>c.name==='storage.set').length,0);
    assert.ok(f.timers.some(timer=>timer.ms===500&&!timer.cleared));const exported=await f.exported();
    assert.equal(exported.bracketPresetInspection.status,'USER_REPLAY_BRACKET_PRESET_MISSING');assert.equal(exported.latest.decision.status,'NO_APPROVAL');assert.equal(exported.userMarketExecution.armed,true);assert.equal(exported.executionRecord,null);
  }finally{await f.cleanup();}
});

test('actual complete-engine artificial technical approval reaches the observed-quantity callback pipeline once without a preset or bot risk plan',async()=>{
  const f=await pageFixture({positive:true});try{
    await f.start();assert.equal(f.api.snapshot().latest.decision.status,'CONFIRMED');assert.equal(nativeCalls(f,'submit').length,0,'analysis alone cannot submit');
    const manualCutoff=f.api.snapshot().latest.cutoff.asOfTime,readsBefore=f.calls.filter(c=>c.name==='readTradingViewWindowEvidence').length;
    await readControls(f);await arm(f);const state=f.api.snapshot().execution;
    assert.equal(state.state,'FILLED_USER_MANAGED');assert.equal(state.engineMode,'FULL_ENGINE_RECOMPUTED');assert.equal(state.intent.quantity,3);assert.equal(state.intent.presetProtectionRequired,false);assert.equal(state.intent.bracketPresetVerified,false);assert.equal(state.armed,false);
    assert.equal(state.intent.firstSourceCaptureStatus,'VERIFIED');assert.ok(state.timing.firstCaptureToFillVerificationMs>=0);assert.equal(state.timing.protectedFillMeasured,false);assert.equal(state.timing.firstCaptureToProtectedFillVerificationMs,null);
    assert.equal(f.api.snapshot().latest.cutoff.asOfTime,manualCutoff);assert.ok(f.calls.filter(c=>c.name==='readTradingViewWindowEvidence').length>readsBefore,'arming rereads and fully evaluates the same already-confirmed cutoff without Replay advancement');
    for(const property of ['riskPlan','riskBudget','stop','target','stopTicks','targetTicks'])assert.equal(Object.hasOwn(state.intent,property),false);
    assert.equal(nativeCalls(f,'read_preset')[0].args[0].requireInheritedPreset,false);assert.equal(nativeCalls(f,'submit')[0].args[0].requireInheritedPreset,false);
    assert.equal(f.calls.some(c=>c.name==='inspectReplayOrderPreset'),false,'no mandatory SLTP inspection');assert.equal(f.calls.filter(c=>c.name==='storage.set').length,1);
    f.$('market-analyze').emit('click');await f.settle(()=>!f.api.snapshot().busy);assert.equal(nativeCalls(f,'submit').length,1);assert.equal(f.$('market-arm').disabled,true);
    const exported=await f.exported();assert.equal(exported.userMarketExecution.state,'FILLED_USER_MANAGED');assert.match(f.$('market-execution-detail').textContent,/ירושת סטופ ויעד אינה מאומתת/);
  }finally{await f.cleanup();}
});

test('fresh arm read rejects changed, stale, disabled or wrong-target native quantity controls before any entry preflight',async()=>{
  const f=await pageFixture({positive:true});try{
    await f.start();
    for(const edit of [r=>{r.controls.quantity.quantity=0;r.controls.quantity.quantityRaw='0';},r=>{r.controls.quantity.quantity=3.5;r.controls.quantity.quantityRaw='3.5';},r=>{r.controls.quantity.quantityRaw='2';},r=>{r.controls.quantity.disabled=true;},r=>{r.controls.quantity.readOnly=true;},r=>{r.controls.buy.disabled=true;},r=>{r.controls.sell.disabled=true;},r=>{r.controls.buy.label='Buy';},r=>{r.provider='REAL_BROKER';},r=>{r.mode='PAPER';},r=>{r.researchUrl='https://www.tradingview.com/chart/Original1/';},r=>{r.sourceTabId=43;},r=>{r.observedAt-=2001;}]){
      f.setControls(r=>r);await readControls(f);assert.equal(f.$('market-arm').disabled,false);
      f.setControls(r=>{edit(r);return r;});await arm(f);assert.equal(f.api.snapshot().execution.armed,false);assert.equal(f.api.snapshot().execution.intent,null);assert.equal(f.$('market-arm').disabled,true);
    }
    assert.equal(nativeCalls(f,'read_preset').length,0);assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.calls.some(c=>c.name==='storage.set'),false);
  }finally{await f.cleanup();}
});

test('native preset inspector remains a separate read-only export and never mints a capability or writes trade configuration',async()=>{
  const f=await pageFixture();try{
    f.$('market-inspect-brackets').emit('click');await f.settle(()=>!f.api.snapshot().busy&&f.calls.some(c=>c.name==='inspectReplayOrderPreset'));await readControls(f);
    const exported=await f.exported();assert.equal(exported.bracketPresetInspection.protectionPresetVerified,false);assert.equal(exported.bracketPresetInspection.leaseMinted,false);assert.equal(exported.bracketPresetInspection.submitCapabilityCreated,false);assert.equal(exported.controlsInspection.controls.quantity.quantityRaw,'3');assert.equal(exported.latest,null);
    assert.equal(nativeCalls(f,'read_preset').length,0);assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.calls.some(c=>c.name==='storage.set'),false);
  }finally{await f.cleanup();}
});

test('a consumed rejected attempt cannot silently rearm or repeat from the user-managed page',async()=>{
  const f=await pageFixture({positive:true,submitBlocked:true});try{
    await f.start();await readControls(f);await arm(f);assert.equal(f.api.snapshot().execution.state,'DISARMED');assert.equal(f.api.snapshot().execution.submissionAttempted,false);assert.ok(f.api.snapshot().execution.intent);assert.equal(f.$('market-arm').disabled,true);
    await arm(f);f.$('market-analyze').emit('click');await f.settle(()=>!f.api.snapshot().busy);assert.equal(nativeCalls(f,'submit').length,1);assert.equal(f.calls.filter(c=>c.name==='storage.set').length,1);
  }finally{await f.cleanup();}
});

test('idle same-run NO_APPROVAL recovery preserves the first source capture and includes the scheduled500ms wait without orders',async()=>{
  const f=await pageFixture();try{
    await f.start();await readControls(f);const first=f.witness.sourceObservedEpochMs,run=f.witness.runId;f.failNextCard({sourceAdvanceMs:40});await arm(f);
    assert.equal(f.api.snapshot().latest,null);assert.equal(f.api.snapshot().execution.armed,true);f.runWatchTimer();await f.settle(()=>!f.api.snapshot().busy&&!!f.api.snapshot().latest);
    const record=f.api.snapshot().latest,episode=record.sourceRecoveryEpisode;assert.equal(record.decision.status,'NO_APPROVAL');assert.equal(episode.status,'RECOVERED_WITH_FRESH_FULL_ANALYSIS');assert.equal(episode.firstSourceObservedEpochMs,first);assert.equal(record.replayWitness.runId,run);
    assert.equal(episode.sourceToFinalCardLowerMs-record.timing.sourceToFinalCardLowerMs,540);assert.equal(episode.sourceToFinalCardUpperMs-record.timing.sourceToFinalCardUpperMs,540);assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.calls.some(c=>c.name==='storage.set'),false);
  }finally{await f.cleanup();}
});

test('a presentation race after an uncertain attempt retains full execution evidence and cannot recover or submit twice',async()=>{
  const f=await pageFixture({positive:true,unknownSubmit:true});try{
    await f.start();await readControls(f);f.failNextCard();await arm(f);assert.equal(f.api.snapshot().execution.state,'UNKNOWNLOCK');assert.equal(f.api.snapshot().execution.submissionAttempted,true);assert.equal(f.api.snapshot().latest,null);
    const exported=await f.exported();assert.ok(exported.executionRecord);assert.equal(exported.executionRecord.decision.status,'CONFIRMED');assert.equal(exported.executionRecord.userMarketExecution.intent.firstSourceCaptureStatus,'VERIFIED');assert.equal(nativeCalls(f,'submit').length,1);assert.equal(f.timers.some(t=>t.ms===500&&!t.cleared),false);
  }finally{await f.cleanup();}
});

test('source-run changes and a fourth consecutive race disarm the watcher without reaching native order controls',async()=>{
  for(const changeRun of [true,false]){
    const f=await pageFixture();try{
      await f.start();await readControls(f);f.failNextCard({changeRun});await arm(f);
      if(!changeRun)for(let n=2;n<=4;n++){f.failNextCard();f.runWatchTimer();await f.settle(()=>!f.api.snapshot().busy&&f.api.snapshot().latest===null);assert.equal(f.api.snapshot().execution.armed,n<4);}
      assert.equal(f.api.snapshot().execution.armed,false);assert.equal(f.api.snapshot().failure.code,changeRun?'USER_MARKET_SOURCE_RUN_CHANGED':'REPLAY_WITNESS_CHANGED');assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.timers.some(t=>t.ms===500&&!t.cleared),false);
    }finally{await f.cleanup();}
  }
});

test('Stop cancels an in-flight native presentation before final-card restoration and does not change trade quantities or exits',async()=>{
  const f=await pageFixture({holdNative:true});try{
    f.$('market-start').emit('click');await f.settle(()=>f.nativeStarted());f.$('market-stop').emit('click');await f.settle(()=>!f.api.snapshot().active);f.releaseNative();await f.settle(()=>!f.api.snapshot().busy);
    assert.equal(f.calls.filter(c=>c.name==='replayChartOverlayCommand'&&c.args[0].action==='show').length,1);assert.equal(nativeCalls(f,'submit').length,0);assert.equal(f.api.snapshot().execution.armed,false);
    assert.equal(nativeCalls(f).some(c=>!['read_controls','disarm'].includes(c.args[0].action)),false);
  }finally{await f.cleanup();}
});

test('three-chart research keeps truthful chart counts and carries explicit unique-one-minute scope through reading, markers and execution target',async()=>{
  const f=await pageFixture({multiChart:true});try{
    await f.start();const record=f.api.snapshot().latest;assert.equal(record.chart.visibleCharts,3);assert.equal(record.chart.researchSelection.targetCharts,1);assert.equal(record.chart.researchSelection.selectedChartLabel,'Chart for CME_MINI:NQ1!, 1 minute');
    assert.equal(record.decision.status,'NO_APPROVAL');assert.equal(record.presentation.status,'REPLAY_PRESENTATION_RENDERED');assert.equal(record.analysisInputs.options.metadata.timeframe,'1');
    await readControls(f);await arm(f);assert.equal(f.api.snapshot().execution.armed,true);assert.equal(f.api.snapshot().execution.target.allowResearchMultiChart,true);assert.equal(nativeCalls(f,'submit').length,0);
    assert.ok(f.calls.filter(c=>c.name==='nativeCandleMarkerUiCommand').every(c=>c.args[0].expected.allowResearchMultiChart===true));
    assert.ok(f.calls.filter(c=>c.name==='userMarketTradingUiCommand').every(c=>c.args[0].expected.allowResearchMultiChart===true));
  }finally{await f.cleanup();}
});

