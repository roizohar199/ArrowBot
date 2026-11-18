import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LIVE_RULE_SETTINGS_KEY} from '../live-ohlc-settings.mjs';
import {WINDOW_WAKE_KIND} from '../live-window-wake.mjs';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';

const html=await readFile(new URL('../live-ohlc.html',import.meta.url),'utf8');
const extensionVersion=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8')).version;
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Node{
  constructor(id='',doc){Object.assign(this,{id,ownerDocument:doc,doc,value:'',textContent:'',disabled:false,hidden:false,checked:false,open:false,dataset:{},children:[],listeners:new Map()});}
  addEventListener(name,callback){const list=this.listeners.get(name)??[];list.push(callback);this.listeners.set(name,list);}removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)??[]).filter(item=>item!==callback));}
  async emit(name,extra={}){const event={type:name,target:this,preventDefault(){this.defaultPrevented=true;},...extra};for(const callback of this.listeners.get(name)??[])await callback(event);}
  append(...nodes){this.children.push(...nodes);}after(node){this.doc.created.push(node);}replaceChildren(...nodes){this.children=nodes;}setAttribute(name,value){this[name]=String(value);}removeAttribute(name){delete this[name];}focus(){this.doc.activeElement=this;}scrollIntoView(){}remove(){}
  showModal(){this.open=true;}close(){this.open=false;void this.emit('close');}getBoundingClientRect(){return {top:0,left:0,right:300,bottom:300,width:300,height:300};}click(){if(!this.disabled)return this.emit('click');}
}
const instrument='CME_MINI:NQ1!',metadata={source:'ohlc',instrument,timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'regular',chartType:'standard'};
const chart={symbols:[instrument],interval:'1',replay:false,marketOpen:true,realtime:true,visibleCharts:1,documentVisible:true};
const runId='SYNTHETIC_INTEGRATION|NQ|1794657590000';
const noFresh=()=>({status:'OK',reasonCodes:['NO_FRESH_SOURCE_PACKET'],messages:[],chart});

function retainedWindowBatch({sourceAt,rawSequence=100}){
  const end=Math.floor(sourceAt/60000)*60000,rows=duration=>Array.from({length:20},(_,index)=>({time:end-(20-index)*duration,closeTime:end-(19-index)*duration,open:20000,high:20002,low:19999,close:20001,closed:true,sourceClosed:true}));
  const base=rows(60000),higher=['5','15'].map(timeframe=>({timeframe,timeframeMs:Number(timeframe)*60000,bars:rows(Number(timeframe)*60000)})),current={...base.at(-1),time:end,closeTime:end+60000,closed:false,sourceClosed:false};
  const envelope=(kind,slot,extra)=>({schemaVersion:1,kind,runId,sequence:rawSequence*8+slot,sourceEmittedAt:sourceAt,realtime:true,dataDelayUnverified:true,metadata,bars:[],reasonCodes:[],...extra});
  const packets=[envelope('snapshot',1,{bars:base}),...higher.map((entry,index)=>envelope('timeframe_snapshot',index+2,{higherTimeframes:[entry]})),envelope('update',4,{bars:[base.at(-1),current]})];
  return {packets,evidence:{status:'OK',reasonCodes:[],chart,messages:packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet)),bootstrapMetadata:{runId,metadata},windowFrame:{sequence:rawSequence,sourceEmittedAt:sourceAt,runEpoch:1794657590000,realtime:true,current,coherent:true,checksumsVerified:true}}};
}

async function pageFixture(readers,{initialWall=Date.UTC(2026,10,14,12),deferOverlayMode=null,onPrepareUi=null}={}){
  let wall=initialWall,perf=1000,timerSerial=0,rafSerial=0,readCount=0,activeReads=0,peakReads=0,sessionId=null;
  const advance=ms=>{wall+=ms;perf+=ms;},timers=new Map(),frames=new Map(),windowEvents=new Map(),documentEvents=new Map(),runtimeListeners=[],overlayCommands=[],deferredOverlays=[],controls=[],blobs=[],sourceReads=[];
  const doc={nodes:new Map(),created:[],hidden:false,visibilityState:'visible',hasFocus:()=>true,getElementById(id){return this.nodes.get(id);},createElement(tag){const node=new Node('',this);node.tagName=tag.toUpperCase();return node;},createElementNS(_ns,tag){return this.createElement(tag);},addEventListener(name,callback){const list=documentEvents.get(name)??[];list.push(callback);documentEvents.set(name,list);},removeEventListener(name,callback){documentEvents.set(name,(documentEvents.get(name)??[]).filter(item=>item!==callback));}};
  for(const id of ids)doc.nodes.set(id,new Node(id,doc));doc.body=new Node('body',doc);const $=id=>doc.getElementById(id);
  for(const [id,value]of Object.entries({'risk-budget':'200','point-value':'20','max-contracts':'1','reward-risk':'2','account-mode':'PAPER','account-currency':'USD','account-instrument':instrument,'account-tick-size':'.25','live-transport':'window'}))$(id).value=value;
  $('require-risk').checked=true;$('require-location').checked=true;$('account-form-error').hidden=true;$('export-live').disabled=true;
  const data={[LIVE_RULE_SETTINGS_KEY]:{schemaVersion:1,fields:{'risk-budget':'200','point-value':'20',commission:'0',slippage:'0','max-contracts':'1','reward-risk':'2'},checks:{'require-risk':true,'require-location':true,'require-ema':false,'require-fib':false,'require-higher-timeframe':false,'require-trendline':false,'require-supply-demand':false},savedAt:1}};
  const win={innerWidth:400,innerHeight:900,scrollTo(){},requestAnimationFrame(callback){const id=++rafSerial;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(name,callback){const list=windowEvents.get(name)??[];list.push(callback);windowEvents.set(name,list);},removeEventListener(name,callback){windowEvents.set(name,(windowEvents.get(name)??[]).filter(item=>item!==callback));}};
  const chrome={runtime:{id:'test-arrow-extension',onMessage:{addListener(callback){runtimeListeners.push(callback);}}},storage:{local:{async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}}},tabs:{async query(){return [{id:17,title:'Synthetic NQ integration chart',url:'https://www.tradingview.com/chart/integration/'}];}},scripting:{async executeScript(command){
    const name=command.func.name,args=command.args?.[0]??{};
    if(name==='sourceDomTimingCommand'){controls.push(command);if(args.action==='install')sessionId=args.sessionId;return [{result:{status:'OK'}}];}
    if(name==='windowWakeSourceCommand'){controls.push(command);return [{result:{status:args.action==='install'?'INSTALLED':'STOPPED'}}];}
    if(name==='prepareTradingViewWindowUi'){controls.push(command);if(onPrepareUi)await onPrepareUi(command);return [{result:{status:'READY'}}];}
    if(name==='chartSignalOverlayCommand'){
      overlayCommands.push({...structuredClone(args),targetTabId:command.target.tabId});if(args.action!=='show')return [{result:{status:'CLEARED'}}];
      const complete=async()=>{await Promise.resolve();const received=performance.timeOrigin+performance.now();advance(40);return [{result:{status:'RENDERED',mode:args.mode,eventId:args.signal.eventId,documentTimeOrigin:performance.timeOrigin,renderReceiptEpoch:received,mutationEpoch:received+1,firstPaintEpoch:received+16,secondPaintEpoch:received+32,meaning:'renderopportunitynotphysical',physicalDisplayMeasured:false}}];};
      if(args.mode===deferOverlayMode)return await new Promise(resolve=>deferredOverlays.push(()=>{void complete().then(resolve);}));return await complete();
    }
    if(args.stop)return [{result:{status:'STOPPED'}}];
    assert.equal(name,'readTradingViewWindowEvidence','only the expected source adapter is used');sourceReads.push({tabId:command.target.tabId,args:structuredClone(args)});activeReads++;peakReads=Math.max(peakReads,activeReads);const read=readers[readCount++];
    try{return [{result:read?await read(command):noFresh()}];}finally{activeReads--;}
  }}};
  const before={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,dateNow:Date.now,performance:Object.getOwnPropertyDescriptor(globalThis,'performance'),createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  Object.assign(globalThis,{document:doc,window:win,chrome,setTimeout:(callback,delay)=>{const id=++timerSerial;timers.set(id,{callback,delay,due:perf+delay});return id;},clearTimeout:id=>timers.delete(id)});
  Date.now=()=>wall;Object.defineProperty(globalThis,'performance',{configurable:true,writable:true,value:{timeOrigin:initialWall-1000,now:()=>perf}});URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:integration';};URL.revokeObjectURL=()=>{};
  const settle=async()=>{await flush();await flush();await flush();};
  await import('../live-ohlc.mjs?delivery-integration='+Math.random());await settle();$('live-tab').value='17';
  const api={doc,$,chrome,overlayCommands,controls,sourceReads,advance,get deferredOverlayCount(){return deferredOverlays.length;},async resolveOverlay(){assert.ok(deferredOverlays.length);deferredOverlays.shift()();await settle();},get sessionId(){return sessionId;},get readCount(){return readCount;},get peakReads(){return peakReads;},get activeReads(){return activeReads;},now:()=>wall,
    setWall(value){advance(value-wall);},async settle(){await settle();},async fireNext(){const found=[...timers].filter(([,timer])=>timer.delay<=250).sort((a,b)=>a[1].due-b[1].due)[0];assert.ok(found,'scheduled root poll exists');timers.delete(found[0]);if(found[1].due>perf)advance(found[1].due-perf);found[1].callback();await settle();},
    async start({profile={}}={}){const beforeReads=readCount;await $('connect-live').emit('click');await settle();for(const [id,value]of Object.entries(profile)){$(id).value=value;await $(id).emit('input');}$('commission').value='0';await $('commission').emit('input');$('slippage').value='0';await $('slippage').emit('input');$('account-costs-reviewed').checked=true;await $('account-costs-reviewed').emit('change');await $('account-form').emit('submit');await settle();assert.ok(sessionId);if(readCount===beforeReads)await api.fireNext();assert.ok(readCount>beforeReads,'connect dispatches its source read');},
    async paint(){for(let pass=0;pass<2;pass++){advance(16);const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(perf);await settle();}},
    wake(sequence,extra={},senderEdit={}){const message={kind:WINDOW_WAKE_KIND,schemaVersion:1,sessionId,runEpoch:1794657590000,sourceSequence:sequence,...extra},sender={id:chrome.runtime.id,tab:{id:17,url:'https://www.tradingview.com/chart/integration/'},frameId:0,url:'https://www.tradingview.com/chart/integration/',...senderEdit};const replies=[];for(const listener of runtimeListeners)listener(message,sender,reply=>replies.push(reply));return replies;},
    async exported(){await $('export-live').emit('click');return JSON.parse(await blobs.at(-1).text());},async probe(){await $('test-signal-delivery').emit('click');await settle();},
    async cleanup(){for(const callback of windowEvents.get('pagehide')??[])callback();await settle();timers.clear();frames.clear();Date.now=before.dateNow;Object.defineProperty(globalThis,'performance',before.performance);URL.createObjectURL=before.createObjectURL;URL.revokeObjectURL=before.revokeObjectURL;for(const key of ['document','window','chrome','setTimeout','clearTimeout'])if(before[key]===undefined)delete globalThis[key];else globalThis[key]=before[key];await flush();},
  };return api;
}

test('root runtime listener validates extension/tab/top frame/session/schema before ACK and coalesces wakes during an active read',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});const f=await pageFixture([()=>held,noFresh]);
  try{
    await f.start();assert.equal(f.readCount,1);assert.equal(f.activeReads,1);
    for(const [extra,sender]of [[{}, {id:'other-extension'}],[{}, {tab:{id:18}}],[{}, {frameId:1}],[{}, {url:'https://example.com/chart/a/'}],[{sessionId:'old-session'},{}],[{schemaVersion:2},{}],[{prices:[1,2,3,4]},{}]])assert.deepEqual(f.wake(1,extra,sender),[],'untrusted notification receives no ACK and cannot schedule a read');
    for(let sequence=1;sequence<=20;sequence++)assert.deepEqual(f.wake(sequence),[{ok:true}]);assert.equal(f.readCount,1);assert.equal(f.peakReads,1);
    release(noFresh());await f.settle();assert.equal(f.readCount,2,'the coalesced wake starts directly without a zero-delay timer');assert.equal(f.peakReads,1);
    const out=await f.exported();assert.equal(out.pollScheduler.counts.wakes,20);assert.equal(out.pollScheduler.counts.coalesced,19);assert.equal(out.pollScheduler.counts.started,2);assert.equal(out.pollScheduler.inflight,false);assert.equal(out.pollScheduler.pending,null);assert.equal(out.pollScheduler.wakeHealthy,true);
    assert.deepEqual(f.wake(20),[{ok:false}],'duplicate wake is explicitly unacknowledged');await f.$('stop-live').emit('click');assert.deepEqual(f.wake(21),[],'stopped session cannot schedule or ACK');
  }finally{release?.(noFresh());await f.cleanup();}
});

test('a whole Window batch3100ms ahead is deferred without ACK or HTF intake and the identical retained frame is accepted101ms later',async()=>{
  const initialWall=Date.UTC(2026,10,14,12),sourceAt=initialWall+3100,batch=retainedWindowBatch({sourceAt}),appearance=initialWall-20;let f;
  const evidence=()=>({...structuredClone(batch.evidence),sourceDomTiming:{status:'OK',sessionId:f.sessionId,sourceEpoch:performance.timeOrigin+performance.now(),documentTimeOrigin:performance.timeOrigin,records:batch.packets.map(packet=>({id:runId+':'+packet.sequence,initial:packet.kind!=='update',documentVisible:true,appearanceEpochMs:appearance,meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:100}))}});
  f=await pageFixture([evidence,evidence,evidence],{initialWall});
  try{
    await f.start();let out=await f.exported();assert.equal(f.now(),initialWall);assert.equal(out.selectedRun,null,'deferral precedes chooseRun');assert.equal(out.store.ready,false);assert.equal(out.store.liveEligible,false);assert.equal(out.store.bars.length,0);assert.equal(out.store.generation,1,'only the explicit CONNECT reset occurred');const deferredGeneration=out.store.generation;assert.equal(out.timeframes.ready,false);assert.ok(out.timeframes.series.every(series=>series.retainedBars===0));assert.equal(out.rawEvidence.length,0);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.pollEvidence[0].deferredReason,'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED');assert.equal(out.pollEvidence[0].sourceClockOffsetMs,3100);assert.deepEqual(out.pollEvidence[0].sourcePacketIds,[]);assert.match(f.$('feed-status').textContent,/נתונים ממתינים.*איתותים חסומים/);assert.equal(f.sourceReads[0].args.afterSequence,0);
    f.advance(101);await f.fireNext();out=await f.exported();assert.equal(f.now(),initialWall+101);assert.equal(f.sourceReads[1].args.afterSequence,0,'retained source baseline was never ACKed while deferred');assert.equal(f.sourceReads[1].args.afterRunId,null);assert.equal(out.selectedRun,runId);assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);const acceptedGeneration=out.store.generation;assert.ok(acceptedGeneration>deferredGeneration);assert.equal(out.store.bars.length,20);assert.equal(out.store.sourceDecisionTime,sourceAt);assert.ok(out.timeframes.series.every(series=>series.closedBars===20&&series.ready));assert.equal(out.rawEvidence.length,4);assert.ok(out.rawEvidence.every(raw=>raw.receivedAt===initialWall+101&&raw.sourceEmittedAt===sourceAt));assert.deepEqual(out.rawEvidence.map(raw=>raw.raw),batch.evidence.messages,'original source packets and clock values are unchanged');assert.equal(out.pollEvidence[1].liveEligible,true);assert.equal(out.pollEvidence[1].sourcePacketIds.length,4);
    await f.paint();out=await f.exported();const sample=out.sourceDomLatency.samples.find(sample=>sample.packetId===runId+':804');assert.ok(sample,'same retained update is timed against its original first appearance');assert.equal(sample.sourceAppearanceEpochMs,appearance);assert.ok(sample.sourceToPaintLowerMs>=121,'the actual101ms deferral remains in measured latency');
    await f.fireNext();out=await f.exported();assert.equal(f.sourceReads[2].args.afterSequence,804);assert.equal(out.rawEvidence.length,4,'repeated retained frame is ingested exactly once');assert.equal(out.store.generation,acceptedGeneration);assert.equal(out.alerts.length,0);assert.equal(out.orderEligible,false);
  }finally{await f.cleanup();}
});

test('future-batch deferral preserves a healthy baseline and cursor until ordinary retry falls inside the unchanged clock bound',async()=>{
  const initialWall=Date.UTC(2026,10,14,12),baseline=retainedWindowBatch({sourceAt:initialWall}),future=retainedWindowBatch({sourceAt:initialWall+3100,rawSequence:101});
  const f=await pageFixture([()=>baseline.evidence,()=>future.evidence,()=>future.evidence],{initialWall});
  try{
    await f.start();const before=await f.exported();assert.equal(before.store.ready,true);assert.equal(before.rawEvidence.length,4);await f.fireNext();let out=await f.exported();assert.equal(out.store.liveEligible,false);assert.equal(out.store.ready,true);assert.equal(out.store.generation,before.store.generation);assert.equal(out.store.bootstrapAsOfTime,before.store.bootstrapAsOfTime);assert.equal(out.store.sourceDecisionTime,before.store.sourceDecisionTime);assert.deepEqual(out.store.bars,before.store.bars);assert.deepEqual(out.timeframes,before.timeframes,'HTF source clocks and readiness do not advance ahead of a deferred base');assert.equal(out.rawEvidence.length,4);assert.equal(out.selectedRun,runId);assert.equal(out.pollEvidence.at(-1).deferredReason,'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED');
    f.advance(101);await f.fireNext();out=await f.exported();assert.equal(f.sourceReads[2].args.afterSequence,804,'deferred future snapshot/update did not advance ACK');assert.equal(out.store.generation,before.store.generation);assert.equal(out.store.bootstrapAsOfTime,before.store.bootstrapAsOfTime,'healthy recovery cannot restart formation eligibility');assert.equal(out.store.liveEligible,true);assert.equal(out.store.sourceDecisionTime,initialWall+3100);assert.equal(out.rawEvidence.length,8);assert.equal(out.pollEvidence.at(-1).sourcePacketIds.length,4);
  }finally{await f.cleanup();}
});

test('ordinary post-bootstrap pattern and later close produce one approved LIVE delivery; TEST probe stays outside live journals',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12)-27*minute,closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  const bar=(index,open,high,low,close)=>({time:start+index*minute,closeTime:start+(index+1)*minute,open,high,low,close,closed:true,sourceClosed:true});
  const bars=[...closes.map((close,index)=>bar(index,close,close+1,close-1,close)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
  let sequence=100,f,expectedAppearance;const evidence=(kind,rows,at)=>{
    f.setWall(at);const rawSequence=++sequence,packet={schemaVersion:1,kind,runId,sequence:rawSequence*8+(kind==='snapshot'?1:4),sourceEmittedAt:at,realtime:true,dataDelayUnverified:true,metadata,bars:rows,reasonCodes:[]},sourceEpoch=performance.timeOrigin+performance.now();expectedAppearance=sourceEpoch-20;
    const origin={initial:kind==='snapshot',documentVisible:true,meaning:'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME',transport:'PUBLIC_DATA_WINDOW_V2'};
    return {status:'OK',reasonCodes:[],chart,messages:['ARROW_OHLC_V1 '+JSON.stringify(packet)],windowFrame:{sequence:rawSequence,sourceEmittedAt:at,runEpoch:1794657590000,realtime:true,current:rows.at(-1),coherent:true,checksumsVerified:true},
      sourceDomTiming:{status:'OK',sessionId:f.sessionId,sourceEpoch,documentTimeOrigin:performance.timeOrigin,records:[{...origin,id:runId+':'+(packet.sequence-8),appearanceEpochMs:sourceEpoch-2000},{...origin,id:runId+':'+packet.sequence,appearanceEpochMs:expectedAppearance}]}};
  };
  const reads=[()=>evidence('snapshot',bars.slice(0,24),bars[23].closeTime)];
  for(let index=24;index<=26;index++){
    for(let elapsed=10000;elapsed<minute;elapsed+=10000)reads.push(()=>{const complete=bars[index],close=Math.round((complete.open+(complete.close-complete.open)*elapsed/minute)/.25)*.25;return evidence('update',[{...complete,high:Math.max(complete.open,close),low:Math.min(complete.open,close),close,closed:false,sourceClosed:false}],complete.time+elapsed);});
    reads.push(()=>evidence('update',[bars[index]],bars[index].closeTime));
  }
  f=await pageFixture(reads,{initialWall:bars[23].closeTime});
  try{
    await f.start();let out=await f.exported();assert.equal(out.alerts.length,0);
    for(let index=1;index<reads.length;index++)await f.fireNext();out=await f.exported();
    assert.equal(out.latestAnalysis.signals.length,1,'real production engine confirms the positive fixture');assert.equal(out.alerts.length,1,'ordinary live journal records exactly one post-bootstrap approval');assert.equal(out.alerts[0].signal.status,'CONFIRMED');assert.equal(out.alerts[0].signal.riskPlan.status,'PLANNED');assert.equal(out.alerts[0].signal.riskPlan.quantity,1);assert.equal(out.alerts[0].signal.orderEligible,false);assert.equal(out.alerts[0].signal.execution,'OBSERVATION_ONLY');
    const live=f.overlayCommands.filter(command=>command.action==='show'&&command.mode==='LIVE');assert.equal(live.length,1);assert.equal(live[0].signal.eventId,out.alerts[0].signal.eventId);assert.equal(live[0].expectedInstrument,instrument);assert.equal(out.alertDelivery.length,1);assert.equal(out.alertDelivery[0].mode,'LIVE');assert.equal(out.alertDelivery[0].testOnly,false);assert.equal(out.alertDelivery[0].chartOverlay.status,'RENDERED');
    assert.equal(out.alertDelivery[0].sourceObservation.packetId,out.alerts[0].sourcePacketId);assert.equal(out.alertDelivery[0].sourceObservation.sourceAppearanceEpochMs,expectedAppearance,'the earlier nonmatching packet timestamp is never borrowed');assert.equal(out.alertDelivery[0].sourceObservation.sourceDocumentTimeOrigin,out.alertDelivery[0].chartOverlay.documentTimeOrigin);assert.equal(out.alertDelivery[0].correlationStatus,'SAME_SOURCE_DOCUMENT_CLOCK');assert.ok(out.alertDelivery[0].sourceToChartPaintLowerMs>=0);assert.ok(out.alertDelivery[0].sourceToChartPaintUpperMs>=out.alertDelivery[0].sourceToChartPaintLowerMs);assert.equal(out.latency.samples.length,0,'direct source-to-chart correlation does not require a completed receiving-panel rAF sample');
    const beforeAlerts=JSON.stringify(out.alerts),beforeDeliveries=JSON.stringify(out.alertDelivery),beforeAnalysis=JSON.stringify(out.latestAnalysis);const readsBeforeProbe=f.readCount;
    await f.probe();out=await f.exported();assert.equal(f.readCount,readsBeforeProbe);assert.equal(JSON.stringify(out.alerts),beforeAlerts);assert.equal(JSON.stringify(out.alertDelivery),beforeDeliveries);assert.equal(JSON.stringify(out.latestAnalysis),beforeAnalysis);assert.equal(out.deliveryProbes.length,1);assert.equal(out.deliveryProbes[0].mode,'TEST');assert.equal(out.deliveryProbes[0].testOnly,true);assert.equal(out.deliveryProbes[0].marketData,false);assert.equal(out.deliveryProbes[0].probe.approvalProof.actualLiveAlert,false);
    const probe=f.overlayCommands.filter(command=>command.action==='show'&&command.mode==='TEST');assert.equal(probe.length,1);assert.equal(probe[0].signal.instrument,'SYNTHETIC_TEST:NQ');assert.equal(probe[0].expectedInstrument,instrument);assert.equal(out.orderEligible,false);
  }finally{await f.cleanup();}
});

test('late chart response after stop and reconnect cleans the original tab instead of the newly selected tab',async()=>{
  const now=Date.UTC(2026,10,14,12),bars=Array.from({length:3},(_,index)=>({time:now-(3-index)*60000,closeTime:now-(2-index)*60000,open:100,high:102,low:99,close:101,closed:true,sourceClosed:true}));
  const initial=()=>({status:'OK',reasonCodes:[],chart,messages:['ARROW_OHLC_V1 '+JSON.stringify({schemaVersion:1,kind:'snapshot',runId,sequence:801,sourceEmittedAt:now,realtime:true,dataDelayUnverified:true,metadata,bars,reasonCodes:[]})],windowFrame:{sequence:100,sourceEmittedAt:now,runEpoch:1794657590000,realtime:true}});
  const f=await pageFixture([initial,noFresh],{initialWall:now,deferOverlayMode:'TEST'});
  try{
    await f.start();assert.equal(f.$('test-signal-delivery').disabled,false);await f.probe();assert.equal(f.deferredOverlayCount,1);
    const original=f.overlayCommands.find(command=>command.action==='show'&&command.mode==='TEST');assert.equal(original.targetTabId,17);
    await f.$('stop-live').emit('click');f.$('live-tab').value='18';await f.$('live-tab').emit('change');await f.start();
    let out=await f.exported();assert.equal(out.selectedTabId,18);assert.equal(out.active,true);
    await f.resolveOverlay();const cancellations=f.overlayCommands.filter(command=>command.action==='clear'&&command.mode==='TEST'&&command.sessionId===original.sessionId);
    assert.ok(cancellations.length>=2,'stop clear is followed by a stale-response cleanup');assert.ok(cancellations.every(command=>command.targetTabId===17),'every old TEST cancellation stays in its original source tab');
    out=await f.exported();assert.equal(out.selectedTabId,18);assert.equal(out.alerts.length,0);assert.equal(out.deliveryProbes.length,0,'stale previous-session probe does not enter the replacement session journal');
  }finally{while(f.deferredOverlayCount)await f.resolveOverlay();await f.cleanup();}
});

test('an approved BTC session cannot supply NQ closed-market warmup with old alerts, delivery success, timing samples or wake totals',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12)-27*minute,closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  const bar=(index,open,high,low,close)=>({time:start+index*minute,closeTime:start+(index+1)*minute,open,high,low,close,closed:true,sourceClosed:true});
  const bars=[...closes.map((close,index)=>bar(index,close,close+1,close-1,close)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)],btcMeta={...metadata,instrument:'COINBASE:BTCUSD',pointValue:1,tickSize:.01},btcChart={...chart,symbols:[btcMeta.instrument]},btcRun='BTC_APPROVED_SESSION';
  let f,sequence=100;const evidence=(kind,rows,at)=>{const packet={schemaVersion:1,kind,runId:btcRun,sequence:++sequence*8+(kind==='snapshot'?1:4),sourceEmittedAt:at,realtime:true,dataDelayUnverified:true,metadata:btcMeta,bars:rows,reasonCodes:[]};return {status:'OK',reasonCodes:[],chart:btcChart,messages:['ARROW_OHLC_V1 '+JSON.stringify(packet)],windowFrame:{sequence,sourceEmittedAt:at,runEpoch:1794657590000,realtime:true,current:rows.at(-1),coherent:true,checksumsVerified:true}};};
  const reads=[()=>evidence('snapshot',bars.slice(0,24),bars[23].closeTime)],readTimes=[bars[23].closeTime];
  for(let index=24;index<=26;index++){for(let elapsed=10000;elapsed<minute;elapsed+=10000){readTimes.push(bars[index].time+elapsed);reads.push(()=>{const complete=bars[index],close=Math.round((complete.open+(complete.close-complete.open)*elapsed/minute)/.25)*.25;return evidence('update',[{...complete,high:Math.max(complete.open,close),low:Math.min(complete.open,close),close,closed:false,sourceClosed:false}],complete.time+elapsed);});}readTimes.push(bars[index].closeTime);reads.push(()=>evidence('update',[bars[index]],bars[index].closeTime));}
  f=await pageFixture(reads,{initialWall:bars[23].closeTime});
  try{
    assert.equal(f.$('export-live').disabled,true,'no observation connection has started yet');
    await f.start({profile:{'account-instrument':btcMeta.instrument,'account-tick-size':'.01','point-value':'1'}});const btcSession=f.sessionId;
    // Provider time advances before invoking the RPC. Advancing inside the
    // reader would fabricate a10second RPC and expire a legitimate paint.
    for(let index=1;index<reads.length;index++){f.setWall(readTimes[index]);await f.fireNext();}
    await f.paint();reads.push(()=>({status:'OK',reasonCodes:['NO_FRESH_SOURCE_PACKET'],messages:[],chart:btcChart}));f.wake(10000);await f.settle();
    let out=await f.exported();assert.equal(out.alerts.length,1);assert.equal(out.alertDelivery.length,1);assert.ok(out.latency.samples.length>0,JSON.stringify(out.latency));assert.equal(out.pollScheduler.counts.wakes,1);assert.match(f.$('signal-delivery-status').textContent,/הוצג גם/);assert.match(f.$('timing-status').textContent,/דגימות/);
    await f.$('stop-live').emit('click');await f.$('apply-live-rules').emit('click');await f.settle();
    reads.push(()=>({status:'OK',reasonCodes:['WINDOW_COHERENCE_PRIMING'],messages:[],chart:{...chart,realtime:false,marketOpen:false},bootstrapMetadata:{runId:'NQ_CLOSED_SESSION',metadata},windowFrame:{sequence:0,sourceEmittedAt:f.now(),runEpoch:f.now(),realtime:false,current:bars.at(-1),coherent:true,checksumsVerified:true}}));
    await f.start({profile:{'account-instrument':instrument,'account-tick-size':'.25','point-value':'20'}});out=await f.exported();
    assert.equal(f.$('export-live').disabled,false,'closed-market priming with zero bars remains exportable as negative diagnostics');
    assert.notEqual(f.sessionId,btcSession);assert.equal(out.extensionVersion,extensionVersion);assert.equal(out.observationSession.sessionId,f.sessionId);assert.equal(out.selectedRun,null);assert.equal(out.store.ready,false);assert.equal(out.store.bars.length,0);
    for(const key of ['alerts','alertDelivery','deliveryProbes','rawEvidence','pollEvidence','closeBoundarySamples'])assert.equal(out[key].length,0,key+' is current-session only');assert.equal(out.latestAnalysis,null);assert.equal(out.analysisInputs,null);
    assert.equal(out.latency.samples.length,0);assert.equal(out.sourceDomLatency.samples.length,0);assert.equal(out.pollScheduler.counts.wakes,0);assert.equal(out.pollScheduler.counts.started,1);assert.equal(out.pollScheduler.retainedAttempts,1);assert.equal(out.latencyArchives.length,1);
    assert.doesNotMatch(f.$('signal-delivery-status').textContent,/הוצג גם/);assert.match(f.$('timing-status').textContent,/טרם נמדד/);assert.doesNotMatch(f.$('timing-status').textContent,/דגימות/);assert.match(f.$('source-timing-status').textContent,/ממתין לעדכון/);assert.match(f.$('wake-status').textContent,/0 הודעות/);assert.match(f.$('alert-count').textContent,/טרם נרשמה.*בהפעלה הנוכחית/);
    assert.equal(out.sessionHistory.length,1);const history=out.sessionHistory[0];assert.equal(history.scope,'HISTORICAL_SESSION_ONLY');assert.equal(history.sessionId,btcSession);assert.equal(history.runId,btcRun);assert.equal(history.alerts.length,1);assert.equal(history.alertDelivery.length,1);assert.equal(history.metadata.instrument,btcMeta.instrument);assert.ok(f.$('live-alerts').children.some(row=>row.children.some(cell=>/היסטוריה · הפעלה קודמת/.test(cell.textContent))));
  }finally{await f.cleanup();}
});

test('real serialized Window reader and root page recover an observer burst before ACK through context then two fresh frames, without historical alerts',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12),bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)];
  const current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:120,closed:false,sourceClosed:false};
  let sequence=1,sourceAt=start+1000,initialized=false;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,counts:[20,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
    for(const [name,bar]of Object.entries(groups))values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const source=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  function tick(ms){source.advance(ms);sourceAt+=ms;sequence++;source.setRaw(raw());source.mutate();}
  const read=command=>{const args=command.args[0];if(!initialized){initialized=true;source.read({...args,bootstrapHistory:seed});tick(200);}return source.read(args);};
  const f=await pageFixture(Array.from({length:12},()=>read),{initialWall:start+1200});
  try{
    await f.start();let out=await f.exported();assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.store.bars.length,20);const initialCutoff=out.store.bootstrapAsOfTime;
    for(const ms of [16001,200,200]){f.advance(ms);tick(ms);}
    await f.fireNext();out=await f.exported();assert.equal(out.store.requiresSnapshot,true);assert.equal(out.store.ready,false);assert.equal(out.selectedRun,null,'real reset clears run and cursor before its acknowledgement');
    await f.fireNext();out=await f.exported();assert.equal(out.store.status,'CONTEXT_READY');assert.equal(out.store.contextOnly,true);assert.equal(out.store.ready,false);assert.equal(out.store.liveEligible,false);assert.equal(out.store.requiresSnapshot,false);assert.equal(out.store.bars.length,20);assert.ok(out.rawEvidence.slice(-3).every(row=>JSON.parse(row.raw.slice('ARROW_OHLC_V1 '.length)).bootstrapOnly===true));
    const contextSequence=sequence,contextCutoff=out.store.bootstrapAsOfTime,contextGeneration=out.store.generation;
    for(let poll=0;poll<3;poll++){await f.fireNext();out=await f.exported();assert.equal(out.store.generation,contextGeneration);assert.equal(out.store.liveEligible,false);assert.equal(out.windowEvidence.recovery.freshFrames,0);}
    f.advance(200);tick(200);await f.fireNext();out=await f.exported();assert.equal(out.store.liveEligible,false);assert.equal(out.store.contextOnly,true);assert.equal(out.windowEvidence.recovery.freshFrames,1);
    f.advance(200);tick(200);await f.fireNext();out=await f.exported();assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.store.contextOnly,false);assert.ok(out.store.bootstrapAsOfTime>contextCutoff&&contextCutoff>initialCutoff);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.intrabar.latest.sequence,sequence);assert.equal(sequence,contextSequence+2);assert.equal(out.timeframes.ready,true);assert.ok(out.timeframes.series.every(series=>series.closedBars===20));
    assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.orderEligible,false);assert.equal(f.overlayCommands.filter(command=>command.action==='show').length,0);
    assert.equal(out.windowEvidence.continuityDecisions.at(-1).action,'RECOVERY_FRESH_PAIR_VERIFIED');assert.equal(f.peakReads,1);
  }finally{await f.cleanup();}
});

test('root accepts only an owned stable3700ms clock pair, rejects a forged snapshot grant, and blocks a downward jump even inside3seconds',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12),bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)],current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:120,closed:false,sourceClosed:false};
  let sequence=1,wall=start+1000,lead=3700,sourceAt=wall+lead,initialized=false,forgeSnapshot=false;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,counts:[20,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
    for(const [name,bar]of Object.entries(groups))values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const source=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  function tick(ms,newLead=lead){wall+=ms;source.advance(ms);lead=newLead;sourceAt=wall+lead;sequence++;source.setRaw(raw());source.mutate();}
  const read=command=>{
    const args=command.args[0];if(!initialized){initialized=true;source.read({...args,bootstrapHistory:seed});tick(200);}
    const evidence=source.read(args);
    if(forgeSnapshot){evidence.messages.push('ARROW_OHLC_V1 '+JSON.stringify({schemaVersion:1,kind:'snapshot',runId:bootstrap.runId,sequence:sequence*8+7,sourceEmittedAt:sourceAt,realtime:true,dataDelayUnverified:true,metadata:{...bootstrap.metadata,sessionGaps:[]},bars:base,reasonCodes:[]}));}
    return evidence;
  };
  const f=await pageFixture(Array.from({length:24},()=>read),{initialWall:start+1200});
  try{
    await f.start();let out=await f.exported();assert.equal(out.windowClockCorrelation.status,'WAITING_OBSERVER_PAIR');assert.equal(out.windowEvidence.clockWitnesses.length,1);assert.equal(out.rawEvidence.length,0);assert.equal(out.selectedRun,null);assert.equal(out.pollEvidence.at(-1).deferredReason,'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED');assert.equal(out.store.ready,false);
    f.advance(2500);tick(2500);await f.fireNext();out=await f.exported();
    assert.equal(out.windowClockCorrelation.status,'CORRELATED');assert.equal(out.windowClockCorrelation.offsetMs,3700);assert.equal(out.windowClockCorrelation.blockIntake,false);assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.store.sourceClockCorrelation.offsetMs,3700);assert.equal(out.store.sourceClockCorrelation.rawLeadMs,3700);assert.equal(out.store.sourceDecisionTime,sourceAt);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.store.lastReceivedAt,f.now());assert.equal(out.pollEvidence.at(-1).deferredReason,undefined);assert.equal(out.rawEvidence.length,6);assert.equal(out.timeframes.ready,true);
    const acceptedCursor=Math.max(...out.rawEvidence.map(row=>JSON.parse(row.raw.slice('ARROW_OHLC_V1 '.length)).sequence)),acceptedStore=structuredClone(out.retainedStoreClockState),acceptedFrames=structuredClone(out.timeframes),acceptedRawCount=out.rawEvidence.length;
    forgeSnapshot=true;await f.fireNext();forgeSnapshot=false;out=await f.exported();
    assert.equal(out.windowClockCorrelation.status,'CORRELATED');assert.equal(out.pollEvidence.at(-1).deferredReason,'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED');assert.equal(out.rawEvidence.length,acceptedRawCount);assert.equal(out.retainedStoreClockState.generation,acceptedStore.generation);assert.equal(out.retainedStoreClockState.sourceDecisionTime,acceptedStore.sourceDecisionTime);assert.equal(f.sourceReads.at(-1).args.afterSequence,acceptedCursor);assert.equal(out.store.liveEligible,false,'forged snapshot has no process-local clock grant');
    f.advance(2500);tick(2500,2700);await f.fireNext();out=await f.exported();
    assert.ok(sourceAt-f.now()<3000,'ordinary3-second guard alone would pass this jump');assert.equal(out.windowClockCorrelation.status,'QUARANTINED');assert.equal(out.windowClockCorrelation.blockIntake,true);assert.equal(out.windowClockCorrelation.requiresRebaseline,true);assert.equal(out.pollEvidence.at(-1).deferredReason,'WINDOW_CLOCK_OBSERVER_DELAY');assert.equal(out.rawEvidence.length,acceptedRawCount);assert.ok(out.retainedStoreClockState.generation>acceptedStore.generation);assert.equal(out.retainedStoreClockState.sourceDecisionTime,acceptedStore.sourceDecisionTime);assert.deepEqual(out.retainedStoreClockState.bars,acceptedStore.bars,'verified closed context keeps its first availability');assert.equal(out.retainedStoreClockState.current,null);assert.equal(out.retainedStoreClockState.bootstrapAsOfTime,null);assert.equal(out.retainedStoreClockState.requiresSnapshot,true);assert.equal(out.retainedStoreClockState.connected,false);assert.equal(out.store.ready,false);assert.equal(out.store.liveEligible,false);assert.deepEqual(out.timeframes.series.map(series=>series.closedBars),acceptedFrames.series.map(series=>series.closedBars),'prior HTF knowledge is retained while base currentness is revoked');
    const quarantineId=out.windowClockCorrelation.quarantineId,resetGeneration=out.retainedStoreClockState.generation;
    await f.fireNext();out=await f.exported();assert.equal(f.sourceReads.at(-1).args.afterSequence,0,'quarantine clears the old ACK before requesting a fresh baseline');assert.equal(f.sourceReads.at(-1).args.needsSnapshot,true);assert.equal(out.retainedStoreClockState.generation,resetGeneration,'the same quarantine resets the store only once');assert.equal(out.windowClockCorrelation.blockIntake,true);assert.equal(out.rawEvidence.length,acceptedRawCount);
    f.advance(2500);tick(2500,2700);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.quarantineId,quarantineId);assert.equal(out.windowClockCorrelation.rebaselineReady,false);assert.equal(out.store.liveEligible,false);assert.equal(out.rawEvidence.length,acceptedRawCount);
    f.advance(2500);tick(2500,2700);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.status,'CORRELATED');assert.equal(out.windowClockCorrelation.requiresRebaseline,false);assert.equal(out.windowClockCorrelation.ledger.at(-1).action,'QUARANTINE_BASELINE_ACCEPTED');assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.ok(out.store.bootstrapAsOfTime>acceptedStore.bootstrapAsOfTime);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.timeframes.ready,true);assert.equal(out.retainedStoreClockState.bars.find(bar=>bar.time===acceptedStore.bars[0].time)?.knownAt,acceptedStore.bars[0].knownAt,'same-run selection must not reset preserved first availability again');assert.equal(out.timeframes.higherTimeframes['5'].bars[0].knownAt,acceptedFrames.higherTimeframes['5'].bars[0].knownAt);assert.equal(out.observationSession.sessionId,f.sessionId,'automatic recovery keeps the same observation connection');
    // Reproduce the exact source2490/wall2936ms interval from the real failure.
    f.advance(2936);tick(2936,2254);await f.fireNext();out=await f.exported();const actualFault=out.windowClockCorrelation.ledger.findLast(row=>row.action==='CLOCK_QUARANTINED');assert.equal(actualFault.sourceDelta,2490);assert.equal(actualFault.wallDelta,2936);assert.equal(out.windowClockCorrelation.requiresRebaseline,true);assert.equal(out.store.liveEligible,false);assert.equal(out.retainedStoreClockState.requiresSnapshot,true);
    f.advance(2500);tick(2500,2700);await f.fireNext();out=await f.exported();assert.equal(out.store.liveEligible,false);assert.equal(out.windowClockCorrelation.rebaselineReady,false);
    f.advance(2500);tick(2500,2700);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.requiresRebaseline,false);assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.orderEligible,false);assert.equal(f.overlayCommands.filter(command=>command.action==='show').length,0);assert.equal(f.peakReads,1);
    // Real foreground failure: an ordinary returning source stamp is 2159ms
    // behind the callback. It is unusable, but must not terminally lock the
    // entire session before subsequent fresh observer frames can recover it.
    source.document.visibilityState='hidden';f.advance(500);tick(500);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.requiresRebaseline,true);assert.equal(out.store.liveEligible,false);
    source.document.visibilityState='visible';f.advance(25000);tick(25000,-2159);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.locked,false);assert.equal(out.store.liveEligible,false);
    for(let i=0;i<3;i++){f.advance(2500);tick(2500,1250);await f.fireNext();}
    out=await f.exported();assert.equal(out.windowClockCorrelation.locked,false);assert.equal(out.windowClockCorrelation.requiresRebaseline,false,JSON.stringify({clock:out.windowClockCorrelation,evidence:out.windowEvidence.reasonCodes,history:out.windowEvidence.history?.map(h=>({n:h.contiguousBars,sent:h.snapshotSent})),store:out.store.reasonCodes}));assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,true);assert.equal(out.alerts.length,0);assert.equal(out.observationSession.sessionId,f.sessionId);
  }finally{await f.cleanup();}
});

test('root admits a mid-minute historical baseline without LIVE approval, then requires a verified CURRENT update after cold start and quarantine',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12),bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)],current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:120,closed:false,sourceClosed:false};
  let sequence=1,wall=start+41000,lead=3700,sourceAt=wall+lead,initialized=false,holdCurrent=true;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,counts:[20,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
    for(const [name,bar]of Object.entries(groups))values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const source=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  source.advance(40000);source.statuses.outerHTML='<span class="marketStatusOpen-x"></span>';source.statuses.textContent='';
  function tick(ms,newLead=lead){wall+=ms;source.advance(ms);lead=newLead;sourceAt=wall+lead;sequence++;source.setRaw(raw());source.mutate();}
  const read=command=>{const args=command.args[0];if(!initialized){initialized=true;source.read({...args,bootstrapHistory:seed});tick(200);}const evidence=source.read(args);if(holdCurrent)evidence.messages=evidence.messages.filter(raw=>JSON.parse(raw.slice('ARROW_OHLC_V1 '.length)).kind!=='update');return evidence;};
  const f=await pageFixture(Array.from({length:14},()=>read),{initialWall:start+41200});
  try{
    await f.start();let out=await f.exported();assert.equal(out.store.ready,false);assert.equal(out.windowClockCorrelation.offsetMs,null);
    f.advance(2500);tick(2500);await f.fireNext();out=await f.exported();assert.equal(out.windowEvidence.chart.realtime,null);assert.ok(sourceAt-start>45000);assert.equal(out.windowClockCorrelation.status,'CORRELATED');assert.equal(out.store.ready,true);assert.equal(out.store.metadata.realtime,false);assert.equal(out.store.liveEligible,false);assert.equal(out.store.sourceClockCorrelation.nonLiveHistoricalBaseline,true);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.rawEvidence.filter(row=>JSON.parse(row.raw.slice('ARROW_OHLC_V1 '.length)).kind==='update').length,0);assert.equal(out.alerts.length,0);
    holdCurrent=false;f.advance(100);tick(100);await f.fireNext();out=await f.exported();assert.equal(out.store.liveEligible,true);assert.equal(out.store.metadata.realtime,true);assert.equal(out.store.current.time,start);
    f.advance(2936);tick(2936,3254);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.requiresRebaseline,true);assert.equal(out.store.liveEligible,false);const faultCutoff=sourceAt;
    f.advance(2500);tick(2500,3700);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.rebaselineReady,false);assert.equal(out.store.liveEligible,false);
    holdCurrent=true;f.advance(2500);tick(2500,3700);await f.fireNext();out=await f.exported();assert.ok(sourceAt-start>45000&&sourceAt-start<60000,'quarantine baseline is still mid-minute, before the next candle');assert.equal(out.windowClockCorrelation.requiresRebaseline,false);assert.equal(out.windowClockCorrelation.ledger.at(-1).action,'QUARANTINE_BASELINE_ACCEPTED');assert.equal(out.store.ready,true);assert.equal(out.store.liveEligible,false);assert.equal(out.store.metadata.realtime,false);assert.equal(out.store.sourceClockCorrelation.nonLiveHistoricalBaseline,true);assert.ok(out.store.bootstrapAsOfTime>faultCutoff);assert.equal(out.store.bootstrapAsOfTime,sourceAt);assert.equal(out.alerts.length,0);
    holdCurrent=false;f.advance(100);tick(100);await f.fireNext();out=await f.exported();assert.equal(out.store.liveEligible,true);assert.equal(out.store.metadata.realtime,true);assert.equal(out.store.current.time,start);assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.orderEligible,false);assert.equal(f.overlayCommands.filter(command=>command.action==='show').length,0);assert.equal(f.peakReads,1);
  }finally{await f.cleanup();}
});

test('root repairs an offscreen owned Data Window header before its quarantine gate and waits for a fresh pair plus baseline before restoring LIVE',async()=>{
  const minute=60000,start=Date.UTC(2026,10,14,12),bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)],current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:120,closed:false,sourceClosed:false};
  let sequence=1,sourceAt=start+4700,initialized=false,preparations=0;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,counts:[20,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
    for(const [name,bar]of Object.entries(groups))values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const source=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  function tick(ms){source.advance(ms);sourceAt+=ms;sequence++;source.setRaw(raw());source.mutate();}
  const read=command=>{const args=command.args[0];if(!initialized){initialized=true;source.read({...args,bootstrapHistory:seed});tick(200);}return source.read(args);};
  const f=await pageFixture(Array.from({length:12},()=>read),{initialWall:start+1200,onPrepareUi:command=>{preparations++;assert.equal(command.target.tabId,17);assert.equal(command.args[0].phase,'window');if(preparations>1)delete source.header.rect;}});
  try{
    await f.start();f.advance(2500);tick(2500);await f.fireNext();let out=await f.exported();assert.equal(out.store.liveEligible,true);assert.equal(preparations,1);const beforeCutoff=out.store.bootstrapAsOfTime;
    source.header.rect={top:-100,bottom:-80,left:0,right:100,width:100,height:20};await f.fireNext();out=await f.exported();assert.ok(out.windowEvidence.reasonCodes.includes('WINDOW_STUDY_NOT_VISIBLE'));assert.equal(out.windowClockCorrelation.requiresRebaseline,true);assert.equal(out.store.liveEligible,false);assert.equal(out.formingDisplay.status,'UNAVAILABLE');assert.equal(out.retainedStoreClockState.requiresSnapshot,true);
    await f.fireNext();out=await f.exported();assert.equal(preparations,2,'offscreen header schedules owned UI preparation even while quarantine blocks data intake');assert.equal(out.store.liveEligible,false);assert.equal(out.formingDisplay.status,'UNAVAILABLE');assert.equal(out.windowClockCorrelation.rebaselineReady,false);assert.equal(out.observationSession.sessionId,f.sessionId);
    f.advance(2500);tick(2500);await f.fireNext();out=await f.exported();assert.equal(out.store.liveEligible,false);assert.equal(out.formingDisplay.status,'UNAVAILABLE');assert.equal(out.windowClockCorrelation.rebaselineReady,false);
    f.advance(2500);tick(2500);await f.fireNext();out=await f.exported();assert.equal(out.windowClockCorrelation.requiresRebaseline,false);assert.equal(out.store.liveEligible,true);assert.equal(out.store.ready,true);assert.ok(out.store.bootstrapAsOfTime>beforeCutoff);assert.equal(out.windowClockCorrelation.ledger.at(-1).action,'QUARANTINE_BASELINE_ACCEPTED');assert.equal(out.alerts.length,0);assert.equal(out.alertDelivery.length,0);assert.equal(out.orderEligible,false);assert.equal(f.overlayCommands.filter(command=>command.action==='show').length,0);assert.equal(preparations,2);assert.equal(f.peakReads,1);
  }finally{await f.cleanup();}
});
