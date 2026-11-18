import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveWindowClock,validateWindowClockGrant,LIVE_WINDOW_CLOCK_LIMITS} from '../live-window-clock.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';

const minute=60000,start=Date.UTC(2026,10,14,12);
function addResearchChartScope(f){
  const doc=f.document,Element=f.canvas.constructor,oldAll=doc.querySelectorAll.bind(doc),oldOne=doc.querySelector.bind(doc);
  const interval=oldOne('#header-toolbar-intervals [aria-checked="true"]'),legend=oldAll('[data-qa-id="legend-series-item"]')[0];
  const layout=new Element({'aria-label':'Active layout: Arrow OHLC Live Verification'}),wrapper=new Element();
  const other=[new Element({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),new Element({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];
  const otherLegends=[new Element(),new Element()];doc.canvases=[other[0],f.canvas,other[1]];doc.legends=[otherLegends[0],legend,otherLegends[1]];
  wrapper.parentElement=doc.body;f.canvas.parentElement=wrapper;legend.parentElement=wrapper;f.statuses.parentElement=legend;
  wrapper.querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?[f.canvas]:selector==='[data-qa-id="legend-series-item"]'?[legend]:[];
  legend.querySelectorAll=selector=>selector==='[data-qa-id="legend-statuses-wrapper"]'?[f.statuses]:[];
  doc.body.querySelectorAll=selector=>selector==='canvas[aria-label^="Chart for "]'?doc.canvases:selector==='[data-qa-id="legend-series-item"]'?doc.legends:[];
  doc.querySelectorAll=selector=>(selector==='button[aria-label*="Active layout: Arrow "]'||selector==='button[aria-label*="Active layout: "]')?[layout]:selector==='#header-toolbar-intervals [aria-checked="true"]'?[interval]:selector==='#header-toolbar-replay'?[f.replay]:selector==='[data-qa-id="legend-series-item"]'?doc.legends:oldAll(selector);
  doc.querySelector=selector=>(selector==='button[aria-label*="Active layout: Arrow "]'||selector==='button[aria-label*="Active layout: "]')?layout:oldOne(selector);
  f.context.location.pathname='/chart/ARROWRV1/';f.context.location.href='https://www.tradingview.com/chart/ARROWRV1/';
}
function sourceFixture({leadMs=3700,initialWallOffsetMs=1000,researchMultiChart=false,fullScreens=false}={}){
  const bootstrap={...makeBootstrap(),wireVersion:3};
  const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
  const base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)];
  const current={...base.at(-1),time:start,closeTime:start+minute,providerBarIndex:120,closed:false,sourceClosed:false};
  let wall=start+initialWallOffsetMs,sequence=1,sourceAt=wall+leadMs,offset=leadMs;
  function raw(){
    const values=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,counts:[20,20,20]});values.ARROW2_PROTOCOL=3;
    const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1),HISTORY_HIGHER1:higher[0].at(-1),HISTORY_HIGHER2:higher[1].at(-1)};
    for(const [name,bar]of Object.entries(groups))values['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4;
    return recalculateChecksums(values);
  }
  const f=makeWindowFixture({bootstrap,raw:raw()}),seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  if(researchMultiChart){addResearchChartScope(f);if(fullScreens){f.context.location.pathname='/chart/ARROWFR1/';f.context.location.href='https://www.tradingview.com/chart/ARROWFR1/';f.document.querySelectorAll('button[aria-label*="Active layout: "]')[0].attrs['aria-label']='Active layout: Full Screens Live';}}
  const readerOptions=researchMultiChart?{allowResearchLiveMultiChart:true}:{};
  // The actual root RPC binds its selected tab URL outside the serialized
  // reader; this component seam models that separate root-owned field.
  const rootEvidence=evidence=>researchMultiChart?{...evidence,sourceUrl:fullScreens?'https://www.tradingview.com/chart/ARROWFR1/':'https://www.tradingview.com/chart/ARROWRV1/'}:evidence;
  f.advance(initialWallOffsetMs-1000);const initial=rootEvidence(f.read({...readerOptions,bootstrapHistory:seed}));
  return {f,bootstrap,base,higher,initial,now:()=>wall,get sequence(){return sequence;},get sourceAt(){return sourceAt;},advance(ms){wall+=ms;f.advance(ms);},read(options={}){return rootEvidence(f.read({...readerOptions,...options}));},tick(ms=2500,{lead=offset,observer=true}={}){wall+=ms;f.advance(ms);offset=lead;sourceAt=wall+lead;sequence++;f.setRaw(raw());if(observer)f.mutate();return rootEvidence(f.read(readerOptions));}};
}
const clockFor=(s,options={})=>createLiveWindowClock({sessionId:'fixture',tabId:17,now:s.now,...options});
test('a partial visible DOM repaint defers without restamping or resetting a recent clock pair, then expires at the unchanged 2s age bound',()=>{
  const s=sourceFixture({leadMs:1253}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);
  const before=clock.snapshot(),good=s.read(),partial={transport:'PUBLIC_DATA_WINDOW_V2',status:'UNAVAILABLE',reasonCodes:['WINDOW_FRAME_CHECKSUM_MISMATCH'],chart:good.chart,messages:[]};
  s.advance(100);const pending=clock.observeEvidence(partial,{receivedAt:s.now()});assert.equal(pending.transientFramePending,true);assert.equal(pending.requiresRebaseline,false);assert.equal(pending.generation,before.generation);assert.deepEqual(pending.latestObserver,before.latestObserver);assert.equal(clock.grantFor(verifiedPackets(good,s.now())[0],s.now()),null);assert.equal(clock.permitsFrame(good.windowFrame,s.now()),false);
  const resumed=clock.observeEvidence(s.tick(250),{receivedAt:s.now()});assert.equal(resumed.transientFramePending,false);assert.equal(resumed.requiresRebaseline,false);assert.equal(resumed.generation,before.generation);assert.ok(resumed.ledger.some(e=>e.action==='COHERENT_FRAME_RESUMED_WITHOUT_REBASELINE'));
  const offscreen={...partial,reasonCodes:['WINDOW_STUDY_NOT_VISIBLE']};s.advance(100);const restoring=clock.observeEvidence(offscreen,{receivedAt:s.now()});assert.equal(restoring.transientFramePending,true);assert.equal(restoring.requiresRebaseline,false);assert.deepEqual(restoring.latestObserver,resumed.latestObserver);
  s.advance(2001);const stale=clock.observeEvidence(partial,{receivedAt:s.now()});assert.equal(stale.transientFramePending,false);assert.equal(stale.requiresRebaseline,true);assert.equal(stale.blockIntake,true);
});
test('owned observer pairs wall and performance stamps at the same point even when frame decoding takes 400ms',()=>{
  const s=sourceFixture({leadMs:1253}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);
  const before=clock.snapshot().latestObserver,original=s.f.context.performance.now;let calls=0;
  s.f.context.performance.now=()=>{if(++calls===2)s.advance(400);return original();};
  let output;try{output=s.tick(2500);}finally{s.f.context.performance.now=original;}
  const witness=output.clockWitnesses.at(-1),oldDelta=before.observedAtPerfEpoch-before.observedAtWall,newDelta=witness.observedAtPerfEpoch-witness.observedAtWall;
  assert.ok(Math.abs(newDelta-oldDelta)<10,JSON.stringify({calls,oldDelta,newDelta}));
  const state=clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(state.locked,false);assert.equal(state.requiresRebaseline,false);
});
test('monotonic delayed callbacks are recoverable source unavailability at any negative lead, never renewed freshness',()=>{
  for(const lead of [-251,-2159,-30000]){
    const s=sourceFixture({leadMs:1253}),clock=clockFor(s);correlate(s,clock);const delay=lead<-10000?40000:5000,fault=s.tick(delay,{lead}),state=clock.observeEvidence(fault,{receivedAt:s.now()});
    assert.equal(state.locked,false,String(lead));assert.equal(state.blockIntake,true);assert.equal(state.requiresRebaseline,true);assert.equal(state.rebaselineReady,false);assert.equal(state.latestObserver,null);assert.equal(clock.permitsFrame(fault.windowFrame,s.now()),false);
    for(const p of verifiedPackets(fault,s.now()))assert.equal(clock.grantFor(p,s.now()),null);
    const next=s.tick(2500,{lead:1250});clock.observeEvidence(next,{receivedAt:s.now()});assert.equal(clock.snapshot().rebaselineReady,false);
    clock.observeEvidence(s.tick(2500,{lead:1255}),{receivedAt:s.now()});assert.equal(clock.snapshot().rebaselineReady,true);assert.equal(clock.snapshot().requiresRebaseline,true);
  }
});
test('post-quarantine replay of older source sequence and time cannot poison recovery or become a fresh observation',()=>{
  const s=sourceFixture({leadMs:1253}),clock=clockFor(s);correlate(s,clock);const hidden={...s.read(),chart:{...s.read().chart,documentVisible:false}};clock.observeEvidence(hidden,{receivedAt:s.now()});const q=clock.snapshot().quarantine,verified=clock.snapshot().verifiedFrames;
  const stale=s.tick(),w=stale.clockWitnesses.at(-1);w.sequence=q.faultSequence-1;w.sourceEmittedAt=q.faultSourceEmittedAt-1000;
  let state=clock.observeEvidence(stale,{receivedAt:s.now()});assert.equal(state.locked,false);assert.equal(state.blockIntake,true);assert.equal(state.latestObserver,null);assert.equal(state.verifiedFrames,verified);assert.equal(state.ledger.at(-1).action,'POST_FAULT_STALE_SOURCE_OBSERVATION_IGNORED');
  for(let i=0;i<3;i++)clock.observeEvidence(stale,{receivedAt:s.now()});assert.equal(clock.snapshot().verifiedFrames,verified);assert.equal(clock.snapshot().rebaselineReady,false);
  s.read({needsSnapshot:true});const first=s.tick(2500,{lead:1250});first.clockWitnesses=first.clockWitnesses.slice(-1);clock.observeEvidence(first,{receivedAt:s.now()});assert.equal(clock.snapshot().rebaselineReady,false);
  s.read({needsSnapshot:true});const fresh=s.tick(2500,{lead:1255});state=clock.observeEvidence(fresh,{receivedAt:s.now()});assert.equal(state.rebaselineReady,true);assert.equal(state.requiresRebaseline,true);
  const packet=verifiedPackets(fresh,s.now()).find(p=>p.kind==='snapshot'&&Math.floor(p.sequence/8)===s.sequence),store=createLiveOhlcStore({now:s.now}),accepted=store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt});assert.equal(accepted.accepted,true);assert.deepEqual(accepted.eligibleCloseTimes,[]);assert.equal(clock.acknowledgeBaseline(packet,{receivedAt:s.now(),storeState:accepted}),true);assert.equal(clock.snapshot().requiresRebaseline,false);
});
test('foreground stale -2159ms observation is discarded after quarantine and recovers only after two fresh frames plus a baseline',()=>{
  const s=sourceFixture({leadMs:1253}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);
  const hidden={...s.read(),chart:{...s.read().chart,documentVisible:false}};clock.observeEvidence(hidden,{receivedAt:s.now()});const id=clock.snapshot().quarantineId;
  const delayed=s.tick(25000,{lead:-2159});let state=clock.observeEvidence(delayed,{receivedAt:s.now()});
  assert.equal(state.locked,false);assert.equal(state.blockIntake,true);assert.equal(state.rebaselineReady,false);assert.equal(state.verifiedFrames,2);assert.equal(state.latestObserver,null);assert.equal(state.quarantineId,id);assert.equal(state.ledger.at(-1).action,'POST_FAULT_DELAYED_OBSERVATION_IGNORED');
  for(let i=0;i<3;i++){clock.observeEvidence(s.read(),{receivedAt:s.now()});assert.equal(clock.snapshot().rebaselineReady,false);assert.equal(clock.snapshot().verifiedFrames,2);}
  s.read({needsSnapshot:true});const first=s.tick(3000,{lead:1250});clock.observeEvidence(first,{receivedAt:s.now()});assert.equal(clock.snapshot().blockIntake,true);assert.equal(clock.snapshot().rebaselineReady,false);
  s.read({needsSnapshot:true});const second=s.tick(2500,{lead:1255});state=clock.observeEvidence(second,{receivedAt:s.now()});assert.equal(state.status,'CORRELATED');assert.equal(state.requiresRebaseline,true);assert.equal(state.rebaselineReady,true);
  const packet=verifiedPackets(second,s.now()).find(p=>p.kind==='snapshot'&&Math.floor(p.sequence/8)===s.sequence),store=createLiveOhlcStore({now:s.now}),accepted=store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt});
  assert.equal(accepted.accepted,true);assert.deepEqual(accepted.eligibleCloseTimes,[]);assert.equal(clock.acknowledgeBaseline(packet,{receivedAt:s.now(),storeState:accepted}),true);assert.equal(clock.snapshot().requiresRebaseline,false);
});

test('delayed post-fault frames cannot hide source or document clock regressions or an oversized future lead',()=>{
  for(const mode of ['source','sequence','document','performance','future']){
    const s=sourceFixture({leadMs:1253}),clock=clockFor(s);correlate(s,clock);const hidden={...s.read(),chart:{...s.read().chart,documentVisible:false}};clock.observeEvidence(hidden,{receivedAt:s.now()});const q=clock.snapshot().quarantine;
    const delayed=s.tick(25000,{lead:mode==='future'?5001:-2159}),w=delayed.clockWitnesses.at(-1);
    if(mode==='source')w.sourceEmittedAt=q.faultSourceEmittedAt-1;
    if(mode==='sequence')w.sequence=q.faultSequence-1;
    if(mode==='document')w.sourceDocumentTimeOrigin+=1;
    if(mode==='performance')w.observedAtPerfEpoch=q.faultObservedAtPerfEpoch-1;
    const state=clock.observeEvidence(delayed,{receivedAt:s.now()});assert.equal(state.locked,true,mode);assert.equal(state.blockIntake,true,mode);assert.equal(state.rebaselineReady,false,mode);
  }
});
test('ordinary bounded clock tolerates positive monotonic DOM jitter without resetting the entry baseline or granting shifted clocks',()=>{
  const s=sourceFixture({leadMs:1200}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);
  for(const lead of [900,1200,800,1100,1500,1200]){
    const output=s.tick(700,{lead}),state=clock.observeEvidence(output,{receivedAt:s.now()});
    assert.equal(state.status,'CORRELATED');assert.equal(state.requiresRebaseline,false);assert.equal(state.blockIntake,false);assert.equal(state.offsetMs,1200);
    if(Math.abs(lead-1200)>250)for(const p of verifiedPackets(output,s.now()))assert.equal(clock.grantFor(p,s.now()),null);
  }
  const outside=s.tick(2500,{lead:3100});clock.observeEvidence(outside,{receivedAt:s.now()});assert.equal(clock.snapshot().requiresRebaseline,true);assert.equal(clock.shouldBlockIntake(),true);
});

test('ordinary jitter policy retains source visibility, stale-witness, document and clock regression checks',()=>{
  for(const mode of ['stale','hidden','regression']){
    const s=sourceFixture({leadMs:1200}),clock=clockFor(s,{allowOrdinaryClockJitter:true});const good=correlate(s,clock);
    if(mode==='stale'){s.advance(2001);clock.observeEvidence(good,{receivedAt:s.now()});assert.equal(clock.permitsFrame(good.windowFrame,s.now()),false);}
    else if(mode==='hidden'){clock.observeEvidence({...good,chart:{...good.chart,documentVisible:false}},{receivedAt:s.now()});assert.equal(clock.shouldBlockIntake(),true);}
    else{const bad=s.tick();bad.clockWitnesses.at(-1).observedAtPerfEpoch-=5000;clock.observeEvidence(bad,{receivedAt:s.now()});assert.equal(clock.snapshot().locked,true);assert.equal(clock.shouldBlockIntake(),true);}
  }
});
test('ordinary jitter recovery keeps the original store baseline and known history while admitting fresh verified updates',()=>{
  const s=sourceFixture({leadMs:1200}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);
  s.read({needsSnapshot:true});const initial=s.tick();clock.observeEvidence(initial,{receivedAt:s.now()});
  const store=createLiveOhlcStore({now:s.now}),snapshot=verifiedPackets(initial,s.now()).find(p=>p.kind==='snapshot');
  const seeded=store.ingest(snapshot,{sourceAsOfTime:snapshot.sourceEmittedAt});assert.equal(seeded.accepted,true);
  const baseline=seeded.bootstrapAsOfTime,generation=seeded.generation,knownAt=seeded.bars[0].knownAt;
  for(const lead of [900,1200,800,1100]){
    const output=s.tick(700,{lead});clock.observeEvidence(output,{receivedAt:s.now()});
    const packet=verifiedPackets(output,s.now()).find(p=>p.kind==='update'),state=store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt});
    assert.equal(state.accepted,true);assert.equal(state.requiresSnapshot,false);assert.equal(state.bootstrapAsOfTime,baseline);assert.equal(state.generation,generation);assert.equal(state.bars[0].knownAt,knownAt);assert.equal(clock.shouldBlockIntake(),false);
  }
});
function verifiedPackets(output,receivedAt,{allowResearchLiveMultiChart=false}={}){return output.messages.map(raw=>{const result=parsePineOhlcMessage(raw,{receivedAt,tabId:17});assert.equal(result.ok,true);return {...result.packet,metadata:verifyLiveChart(result.packet,output,17,{provider:'TradingView public Data Window v2',allowResearchLiveMultiChart}).metadata};});}
function correlate(s,clock){clock.observeEvidence(s.tick(),{receivedAt:s.now()});const output=s.tick();clock.observeEvidence(output,{receivedAt:s.now()});return output;}

test('only actual owned checksum-verified observer frames contribute clock samples; repeated RPCs and raw Pine/DOM timing records cannot form a pair',()=>{
  const s=sourceFixture(),clock=clockFor(s);assert.deepEqual(s.initial.clockWitnesses,[]);assert.equal(clock.observeEvidence(s.initial,{receivedAt:s.now()}).status,'WAITING_OBSERVER_PAIR');
  const one=s.tick();assert.equal(one.clockWitnesses.length,1);assert.equal(one.clockWitnesses[0].observedAtWall,s.now());assert.equal(one.clockWitnesses[0].sourceEmittedAt-s.now(),3700);
  clock.observeEvidence(one,{receivedAt:s.now()});for(let i=0;i<5;i++){const repeated=s.read();assert.equal(repeated.clockWitnesses.length,1);clock.observeEvidence(repeated,{receivedAt:s.now()});}
  assert.equal(clock.snapshot().status,'WAITING_OBSERVER_PAIR');assert.equal(clock.snapshot().verifiedFrames,1);assert.equal(clock.permitsFrame(one.windowFrame,s.now()),false);
  const noWitness={...s.tick(),clockWitnesses:[],sourceDomTiming:{sessionId:'fixture',records:[{appearanceEpochMs:s.now(),sourceSequence:s.sequence,transport:'PUBLIC_DATA_WINDOW_V2'}]}};clock.observeEvidence(noWitness,{receivedAt:s.now()});assert.equal(clock.snapshot().offsetMs,null);
  assert.equal(createLiveWindowClock({sessionId:'logs',tabId:17,now:s.now}).observeEvidence({transport:'PINE_LOGS',messages:one.messages},{receivedAt:s.now()}).status,'WAITING_OBSERVER_PAIR');
});

test('two actual2.5-second observer frames freeze a3.7-second lead and allow only same-frame opaque grants without altering any raw timestamps',()=>{
  const s=sourceFixture(),clock=clockFor(s),output=correlate(s,clock),status=clock.snapshot();assert.equal(status.status,'CORRELATED');assert.equal(status.offsetMs,3700);assert.equal(status.ledger.at(-1).pairSpanMs,2500);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),true);
  const packets=verifiedPackets(output,s.now()),latest=packets.filter(packet=>Math.floor(packet.sequence/8)===s.sequence);assert.ok(latest.length>=3);
  for(const packet of latest){const before=JSON.stringify(packet),grant=clock.grantFor(packet,s.now());assert.ok(grant);const check=validateWindowClockGrant(grant,{packet,receivedAt:s.now(),now:s.now()});assert.equal(check.ok,true);assert.equal(check.offsetMs,3700);assert.equal(check.rawLeadMs,3700);assert.equal(check.correlatedAgeMs,0);assert.equal(JSON.stringify(packet),before);assert.equal(validateWindowClockGrant(structuredClone(grant),{packet,receivedAt:s.now()}).ok,false);}
  assert.equal(clock.grantFor({...latest[0],runId:'other'},s.now()),null);assert.equal(clock.grantFor({...latest[0],sourceEmittedAt:latest[0].sourceEmittedAt+1},s.now()),null);assert.equal(clock.grantFor({...latest[0],sequence:latest[0].sequence-8},s.now()),null);
});

test('provider-neutral store requires the private Window grant for a future clock, keeps the exact producer cutoff and rejects log/clone/other-tab reuse',()=>{
  const s=sourceFixture(),clock=clockFor(s);correlate(s,clock);s.read({needsSnapshot:true});const output=s.tick();clock.observeEvidence(output,{receivedAt:s.now()});const packet=verifiedPackets(output,s.now()).find(packet=>packet.kind==='snapshot'&&Math.floor(packet.sequence/8)===s.sequence);assert.ok(packet);
  const makeStore=()=>createLiveOhlcStore({now:s.now});assert.equal(makeStore().ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt}).accepted,false);
  const grant=clock.grantFor(packet,s.now()),accepted=makeStore().ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt,windowClockGrant:grant});assert.equal(accepted.accepted,true);assert.equal(accepted.bootstrapAsOfTime,packet.sourceEmittedAt);assert.equal(accepted.sourceDecisionTime,packet.sourceEmittedAt);assert.equal(accepted.lastReceivedAt,s.now());assert.deepEqual(accepted.eligibleCloseTimes,[]);assert.equal(accepted.sourceClockCorrelation.offsetMs,3700);
  for(const edited of [{...packet,metadata:{...packet.metadata,provider:'TradingView Pine Logs'}},{...packet,metadata:{...packet.metadata,tabId:18}},{...packet,metadata:{...packet.metadata,replay:true}},{...packet,metadata:{...packet.metadata,instrument:'CME_MINI:MNQ1!'}}])assert.equal(makeStore().ingest(edited,{sourceAsOfTime:packet.sourceEmittedAt,windowClockGrant:grant}).accepted,false);
  assert.equal(makeStore().ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt,windowClockGrant:structuredClone(grant)}).accepted,false);
  s.advance(2001);assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:packet.receivedAt,now:s.now()}).ok,false);
});

test('frozen lead cannot creep; advancing observer jitter requires quarantine and a fresh baseline',()=>{
  const s=sourceFixture(),clock=clockFor(s);correlate(s,clock);let output=s.tick(2500,{lead:3800});clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.snapshot().offsetMs,3700);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),true);
  output=s.tick(2500,{lead:4000});clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.snapshot().status,'QUARANTINED');assert.equal(clock.snapshot().requiresRebaseline,true);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);
  output=s.tick(2500,{lead:3700});clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.snapshot().requiresRebaseline,true);assert.equal(clock.snapshot().blockIntake,true);
  clock.reset('NEW_CONNECTION');clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.snapshot().offsetMs,null,'cached observations cannot reopen a reset connection');correlate(s,clock);assert.equal(clock.snapshot().status,'CORRELATED');
});

test('quiet source requires a fresh pair; Replay, checksum faults, unverified observer fields and changed identities never borrow the old correlation',()=>{
  for(const mode of ['QUIET','REPLAY','CHECKSUM','OWNER','OBSERVER','RUN','SYMBOL']){
    const s=sourceFixture(),clock=clockFor(s);correlate(s,clock);let output;
    if(mode==='QUIET'){output=s.tick(16001);clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);continue;}
    output=s.tick();
    if(mode==='REPLAY')output.chart.replay=true;
    if(mode==='CHECKSUM')output.windowFrame.checksumsVerified=false;
    if(mode==='OBSERVER'){output.clockWitnesses=output.clockWitnesses.map(w=>({...w,observedByMutationObserver:false}));clock.reset('NEW_CONNECTION');}
    if(mode==='RUN'){output.bootstrapMetadata.runId='COINBASE:BTCUSD|1|'+(output.windowFrame.runEpoch+1);output.bootstrapMetadata.runEpoch++;output.windowFrame.runEpoch++;}
    if(mode==='SYMBOL'){output.bootstrapMetadata.metadata.instrument='CME_MINI:MNQ1!';output.chart.symbols=['CME_MINI:MNQ1!'];}
    clock.observeEvidence(output,{receivedAt:s.now(),...(mode==='OWNER'?{sessionId:'foreign'}:{})});assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false,mode);assert.equal(clock.snapshot().offsetMs,null,mode);
  }
});

test('correlation hard cap is5000ms and diagnostics remain bounded',()=>{
  const allowed=sourceFixture({leadMs:5000}),ok=clockFor(allowed);const output=correlate(allowed,ok);assert.equal(ok.permitsFrame(output.windowFrame,allowed.now()),true);
  const denied=sourceFixture({leadMs:5001}),bad=clockFor(denied);correlate(denied,bad);assert.equal(bad.snapshot().status,'BLOCKED');assert.equal(bad.snapshot().offsetMs,null);
  for(let i=0;i<40;i++)bad.reset('RESET_'+i);assert.equal(bad.snapshot().ledger.length,LIVE_WINDOW_CLOCK_LIMITS.maxLedger);
});

test('a downward jump into the ordinary3-second bound still blocks all root intake after a frozen correlation',()=>{
  const s=sourceFixture(),clock=clockFor(s);correlate(s,clock);assert.equal(clock.shouldBlockIntake(),false);
  const output=s.tick(2500,{lead:2700});const state=clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(output.windowFrame.sourceEmittedAt-s.now(),2700,'ordinary offset guard alone would permit this discontinuity');
  assert.equal(state.status,'QUARANTINED');assert.equal(state.requiresRebaseline,true);assert.equal(state.everCorrelated,true);assert.equal(state.blockIntake,true);assert.equal(clock.shouldBlockIntake(),true);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);
  const later=s.tick(2500,{lead:2700});clock.observeEvidence(later,{receivedAt:s.now()});assert.equal(clock.shouldBlockIntake(),true,'normal-range later packets cannot unlock the connection');
  clock.reset('STOP');assert.equal(clock.shouldBlockIntake(),false);assert.equal(clock.snapshot().offsetMs,null);
  const never=sourceFixture({leadMs:0}),uncorrelated=clockFor(never);correlate(never,uncorrelated);assert.equal(uncorrelated.snapshot().everCorrelated,false);assert.equal(uncorrelated.shouldBlockIntake(),false,'ordinary clocks without correlation retain the original guard');
});

test('actual reader same-millisecond executions do not count as clock freshness or permanently lock a healthy correlation',()=>{
  const s=sourceFixture(),clock=clockFor(s),before=correlate(s,clock),baseline=clock.snapshot(),same=s.tick(0);
  assert.equal(same.status,'OK');assert.equal(same.windowFrame.sequence,before.windowFrame.sequence+1);assert.equal(same.windowFrame.sourceEmittedAt,before.windowFrame.sourceEmittedAt);
  const state=clock.observeEvidence(same,{receivedAt:s.now()});assert.equal(state.status,'CORRELATED');assert.equal(state.blockIntake,false);assert.equal(state.offsetMs,3700);assert.equal(state.verifiedFrames,baseline.verifiedFrames);assert.deepEqual(state.latestObserver,baseline.latestObserver,'same-ms execution cannot move the last strict observation');assert.equal(clock.permitsFrame(same.windowFrame,s.now()),false);
  for(const packet of verifiedPackets(same,s.now()).filter(packet=>Math.floor(packet.sequence/8)===s.sequence))assert.equal(clock.grantFor(packet,s.now()),null,'new sequence cannot borrow the previous frame grant');
  for(let poll=0;poll<3;poll++)clock.observeEvidence(s.read(),{receivedAt:s.now()});assert.equal(clock.snapshot().verifiedFrames,baseline.verifiedFrames);
  s.advance(2001);assert.equal(clock.permitsFrame(before.windowFrame,s.now()),false,'ignored executions and repeated polls do not renew the original witness lease');
  const fresh=s.tick(2500);clock.observeEvidence(fresh,{receivedAt:s.now()});assert.equal(clock.snapshot().status,'CORRELATED');assert.equal(clock.snapshot().blockIntake,false);assert.equal(clock.snapshot().offsetMs,3700);assert.equal(clock.permitsFrame(fresh.windowFrame,s.now()),true);assert.equal(clock.snapshot().latestObserver.sequence,fresh.windowFrame.sequence);
});

test('same-ms samples cannot form a pair, and half-inconsistent advancement or negative clock regressions still lock',()=>{
  const s=sourceFixture(),clock=clockFor(s),one=s.tick();clock.observeEvidence(one,{receivedAt:s.now()});clock.observeEvidence(s.tick(0),{receivedAt:s.now()});assert.equal(clock.snapshot().status,'WAITING_OBSERVER_PAIR');assert.equal(clock.snapshot().verifiedFrames,1);assert.equal(clock.snapshot().offsetMs,null);
  for(const mode of ['WALL_FROZEN','PERF_REGRESSION','SOURCE_REGRESSION','SEQUENCE_REGRESSION']){
    const f=sourceFixture(),c=clockFor(f);correlate(f,c);const output=f.tick(100),witness=output.clockWitnesses.at(-1),previous=output.clockWitnesses.at(-2);
    if(mode==='SOURCE_FROZEN')witness.sourceEmittedAt=previous.sourceEmittedAt;
    if(mode==='WALL_FROZEN')witness.observedAtWall=previous.observedAtWall;
    if(mode==='PERF_REGRESSION')witness.observedAtPerfEpoch=previous.observedAtPerfEpoch-1;
    if(mode==='SOURCE_REGRESSION')witness.sourceEmittedAt=previous.sourceEmittedAt-1;
    if(mode==='SEQUENCE_REGRESSION')witness.sequence=previous.sequence-1;
    c.observeEvidence(output,{receivedAt:f.now()});assert.equal(c.snapshot().status,'BLOCKED',mode);assert.equal(c.snapshot().blockIntake,true,mode);
  }
});

test('a repeated source timestamp observed65ms later cannot lock the feed, create grants or renew freshness',()=>{
  const s=sourceFixture(),clock=clockFor(s),before=correlate(s,clock),baseline=clock.snapshot();
  s.advance(65);const repeated=s.tick(0,{lead:3635});assert.equal(repeated.windowFrame.sourceEmittedAt,before.windowFrame.sourceEmittedAt);
  clock.observeEvidence(repeated,{receivedAt:s.now()});let state=clock.snapshot();assert.equal(state.locked,false);assert.equal(state.verifiedFrames,baseline.verifiedFrames);assert.deepEqual(state.latestObserver,baseline.latestObserver);assert.equal(clock.permitsFrame(repeated.windowFrame,s.now()),false);assert.equal(state.ledger.at(-1).action,'REPEATED_SOURCE_TIMESTAMP_IGNORED');
  for(const packet of verifiedPackets(repeated,s.now()).filter(packet=>Math.floor(packet.sequence/8)===s.sequence))assert.equal(clock.grantFor(packet,s.now()),null);
  const fresh=s.tick(100,{lead:3700});clock.observeEvidence(fresh,{receivedAt:s.now()});assert.equal(clock.snapshot().locked,false);assert.equal(clock.permitsFrame(fresh.windowFrame,s.now()),true);
});

test('actual reader delayed first callback after source eligibility returns re-primes its unfrozen candidate and resumes automatically after a new stable pair',()=>{
  const s=sourceFixture(),clock=clockFor(s);correlate(s,clock);const previousGeneration=clock.snapshot().generation;
  const unavailable={...s.read(),status:'UNAVAILABLE',reasonCodes:['WINDOW_LAST_BAR_REQUIRED'],windowFrame:undefined};clock.observeEvidence(unavailable,{receivedAt:s.now()});assert.equal(clock.snapshot().offsetMs,null);assert.equal(clock.snapshot().blockIntake,true);
  const delayed=s.tick(2500,{lead:2600});clock.observeEvidence(delayed,{receivedAt:s.now()});assert.equal(clock.snapshot().status,'QUARANTINED');assert.equal(clock.permitsFrame(delayed.windowFrame,s.now()),false);
  const next=s.tick(1353,{lead:3737});assert.equal(next.clockWitnesses.at(-1).sourceEmittedAt-next.clockWitnesses.at(-2).sourceEmittedAt,2490);
  clock.observeEvidence(next,{receivedAt:s.now()});let state=clock.snapshot();assert.equal(state.status,'WAITING_OBSERVER_PAIR');assert.equal(state.blockIntake,true);assert.equal(state.offsetMs,null);assert.equal(state.ledger.at(-1).action,'PAIR_REPRIMED_AFTER_OBSERVER_DELAY');assert.equal(state.ledger.at(-1).sourceDelta,2490);assert.equal(state.ledger.at(-1).wallDelta,1353);assert.equal(clock.permitsFrame(next.windowFrame,s.now()),false);
  for(const packet of verifiedPackets(next,s.now()).filter(packet=>Math.floor(packet.sequence/8)===s.sequence))assert.equal(clock.grantFor(packet,s.now()),null);
  const fresh=s.tick(2500,{lead:3740});clock.observeEvidence(fresh,{receivedAt:s.now()});state=clock.snapshot();assert.equal(state.status,'CORRELATED');assert.equal(state.offsetMs,3738.5);assert.equal(state.blockIntake,false);assert.equal(clock.permitsFrame(fresh.windowFrame,s.now()),true);assert.ok(state.generation>previousGeneration);
  const packet=verifiedPackets(fresh,s.now()).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),grant=clock.grantFor(packet,s.now());assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:s.now(),now:s.now()}).ok,true);
});

test('actual2490-source2936-wall observer delay revokes a frozen clock and requires two post-fault frames plus an accepted fresh store baseline',()=>{
  const s=sourceFixture({leadMs:3855}),clock=clockFor(s),before=correlate(s,clock),oldPacket=verifiedPackets(before,s.now()).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),oldGrant=clock.grantFor(oldPacket,s.now());
  const fault=s.tick(2936,{lead:3409}),witnesses=fault.clockWitnesses;assert.equal(witnesses.at(-1).sourceEmittedAt-witnesses.at(-2).sourceEmittedAt,2490);assert.equal(witnesses.at(-1).observedAtWall-witnesses.at(-2).observedAtWall,2936);
  let state=clock.observeEvidence(fault,{receivedAt:s.now()});assert.equal(state.status,'QUARANTINED');assert.equal(state.requiresRebaseline,true);assert.equal(state.rebaselineReady,false);assert.equal(state.blockIntake,true);assert.equal(state.locked,false);assert.equal(state.offsetMs,null);assert.equal(validateWindowClockGrant(oldGrant,{packet:oldPacket,receivedAt:oldPacket.receivedAt,now:s.now()}).ok,false);
  const id=state.quarantineId;assert.equal(state.quarantine.faultSequence,fault.windowFrame.sequence);assert.equal(state.quarantine.requiredFreshFrames,2);assert.equal(clock.permitsFrame(fault.windowFrame,s.now()),false);
  s.advance(1);const sameSourceTime=s.tick(0,{lead:3408});clock.observeEvidence(sameSourceTime,{receivedAt:s.now()});assert.equal(clock.snapshot().locked,false);assert.equal(clock.snapshot().rebaselineReady,false);assert.equal(clock.snapshot().latestObserver,null,'a post-fault sequence with the same source millisecond is not a fresh frame');
  s.read({needsSnapshot:true});const first=s.tick(2500,{lead:3850});clock.observeEvidence(first,{receivedAt:s.now()});assert.equal(clock.snapshot().blockIntake,true);assert.equal(clock.snapshot().rebaselineReady,false);assert.equal(clock.snapshot().quarantineId,id);
  s.read({needsSnapshot:true});const second=s.tick(2500,{lead:3855});clock.observeEvidence(second,{receivedAt:s.now()});state=clock.snapshot();assert.equal(state.status,'CORRELATED');assert.equal(state.blockIntake,false);assert.equal(state.requiresRebaseline,true);assert.equal(state.rebaselineReady,true);assert.equal(state.offsetMs,3852.5);
  const packet=verifiedPackets(second,s.now()).find(packet=>packet.kind==='snapshot'&&Math.floor(packet.sequence/8)===s.sequence);assert.ok(packet);const grant=clock.grantFor(packet,s.now()),store=createLiveOhlcStore({now:s.now}),ingested=store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt,windowClockGrant:grant});assert.equal(ingested.accepted,true);assert.equal(ingested.bootstrap,true);assert.deepEqual(ingested.eligibleCloseTimes,[]);assert.ok(ingested.bootstrapAsOfTime>fault.windowFrame.sourceEmittedAt);
  assert.equal(clock.acknowledgeBaseline({...packet,kind:'update'},{receivedAt:s.now(),storeState:ingested}),false);assert.equal(clock.acknowledgeBaseline(packet,{receivedAt:s.now(),storeState:{...ingested,accepted:false}}),false);assert.equal(clock.snapshot().requiresRebaseline,true);
  assert.equal(clock.acknowledgeBaseline(packet,{receivedAt:s.now(),storeState:ingested}),true);assert.equal(clock.snapshot().requiresRebaseline,false);assert.equal(clock.snapshot().quarantineId,null);assert.equal(clock.snapshot().ledger.at(-1).action,'QUARANTINE_BASELINE_ACCEPTED');
});

test('actual -34ms delayed DOM observation quarantines without locking and needs a fresh pair and post-fault baseline before any eligible close',()=>{
  const s=sourceFixture({leadMs:345}),clock=clockFor(s),before=correlate(s,clock),oldPacket=verifiedPackets(before,s.now()).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),oldGrant=clock.grantFor(oldPacket,s.now());
  const fault=s.tick(650,{lead:-34});assert.equal(fault.windowFrame.sourceEmittedAt-s.now(),-34);
  let state=clock.observeEvidence(fault,{receivedAt:s.now()});assert.equal(state.status,'QUARANTINED');assert.equal(state.locked,false);assert.equal(state.blockIntake,true);assert.equal(state.requiresRebaseline,true);assert.equal(state.rebaselineReady,false);assert.equal(state.offsetMs,null);assert.equal(state.ledger.at(-1).observedLeadMs,-34);assert.equal(state.ledger.at(-1).sourceDelta,271);assert.equal(state.ledger.at(-1).wallDelta,650);
  assert.equal(validateWindowClockGrant(oldGrant,{packet:oldPacket,receivedAt:oldPacket.receivedAt,now:s.now()}).ok,false,'the pre-fault proof is revoked immediately');
  assert.equal(clock.permitsFrame(fault.windowFrame,s.now()),false);for(const packet of verifiedPackets(fault,s.now()).filter(packet=>Math.floor(packet.sequence/8)===s.sequence))assert.equal(clock.grantFor(packet,s.now()),null,'the delayed fault frame cannot obtain a grant');
  const quarantineId=state.quarantineId;s.read({needsSnapshot:true});const first=s.tick(650,{lead:530});clock.observeEvidence(first,{receivedAt:s.now()});state=clock.snapshot();assert.equal(state.blockIntake,true);assert.equal(state.rebaselineReady,false);assert.equal(state.quarantineId,quarantineId);assert.equal(clock.permitsFrame(first.windowFrame,s.now()),false);
  s.read({needsSnapshot:true});const second=s.tick(300,{lead:535});clock.observeEvidence(second,{receivedAt:s.now()});state=clock.snapshot();assert.equal(state.status,'CORRELATED');assert.equal(state.locked,false);assert.equal(state.blockIntake,false);assert.equal(state.requiresRebaseline,true,'a pair alone cannot restore the entry baseline');assert.equal(state.rebaselineReady,true);assert.equal(state.offsetMs,532.5);
  const snapshot=verifiedPackets(second,s.now()).find(packet=>packet.kind==='snapshot'&&Math.floor(packet.sequence/8)===s.sequence),store=createLiveOhlcStore({now:s.now});assert.ok(snapshot);assert.ok(snapshot.sourceEmittedAt>fault.windowFrame.sourceEmittedAt);
  assert.equal(clock.acknowledgeBaseline(oldPacket,{receivedAt:s.now(),storeState:{accepted:true,bootstrap:true}}),false,'old frames cannot acknowledge recovery');
  const base=store.ingest(snapshot,{sourceAsOfTime:snapshot.sourceEmittedAt,windowClockGrant:clock.grantFor(snapshot,s.now())});assert.equal(base.accepted,true);assert.equal(base.bootstrap,true);assert.deepEqual(base.eligibleCloseTimes,[],'recovery history is never a new entry');assert.equal(clock.acknowledgeBaseline(snapshot,{receivedAt:s.now(),storeState:base}),true);assert.equal(clock.snapshot().requiresRebaseline,false);
  const update=verifiedPackets(second,s.now()).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),current=store.ingest(update,{sourceAsOfTime:update.sourceEmittedAt,windowClockGrant:clock.grantFor(update,s.now())});assert.equal(current.accepted,true);assert.equal(current.liveEligible,true);assert.deepEqual(current.eligibleCloseTimes,[],'a retained pre-fault or recovery close cannot trigger an entry');
  s.advance(2001);assert.equal(clock.permitsFrame(second.windowFrame,s.now()),false,'repeated post-fault frames do not refresh the witness lease');assert.equal(clock.grantFor(update,s.now()),null);
});

test('negative DOM-delay exception preserves terminal bounds and genuine clock or sequence regressions',()=>{
  for(const mode of ['SOURCE_REGRESSION','WALL_PERF_DISCONTINUITY','PERF_REGRESSION','SEQUENCE_REGRESSION','DOCUMENT_CHANGED','OVERSIZED_LEAD']){
    const s=sourceFixture({leadMs:100}),clock=clockFor(s);correlate(s,clock);const fault=s.tick(mode==='NEGATIVE_OUTSIDE_JITTER'?1000:200,{lead:mode==='NEGATIVE_OUTSIDE_JITTER'?-251:mode==='OVERSIZED_LEAD'?5001:-34}),witness=fault.clockWitnesses.at(-1),previous=fault.clockWitnesses.at(-2);
    if(mode==='NEGATIVE_OUTSIDE_JITTER')assert.ok(witness.sourceEmittedAt>previous.sourceEmittedAt,'only the negative lead bound fails while source time still advances');
    if(mode==='SOURCE_REGRESSION')witness.sourceEmittedAt=previous.sourceEmittedAt-1;
    if(mode==='WALL_PERF_DISCONTINUITY')witness.observedAtPerfEpoch+=251;
    if(mode==='PERF_REGRESSION')witness.observedAtPerfEpoch=previous.observedAtPerfEpoch-1;
    if(mode==='SEQUENCE_REGRESSION')witness.sequence=previous.sequence-1;
    if(mode==='DOCUMENT_CHANGED')witness.sourceDocumentTimeOrigin-=1;
    clock.observeEvidence(fault,{receivedAt:s.now()});const state=clock.snapshot();assert.equal(state.status,'BLOCKED',mode);assert.equal(state.locked,true,mode);assert.equal(state.blockIntake,true,mode);assert.equal(state.offsetMs,null,mode);
    clock.observeEvidence(s.tick(1000,{lead:100}),{receivedAt:s.now()});assert.equal(clock.snapshot().locked,true,mode+' cannot unlock on an ordinary later frame');
  }
});

test('mid-minute historical snapshot keeps realtime=false and becomes live only after a separately verified CURRENT update',()=>{
  const s=sourceFixture({initialWallOffsetMs:41000}),clock=clockFor(s);clock.observeEvidence(s.tick(),{receivedAt:s.now()});s.read({needsSnapshot:true});const output=s.tick();clock.observeEvidence(output,{receivedAt:s.now()});
  output.chart.realtime=null;const packets=verifiedPackets(output,s.now()),snapshot=packets.find(packet=>packet.kind==='snapshot'&&Math.floor(packet.sequence/8)===s.sequence),update=packets.find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence);
  assert.ok(snapshot.sourceEmittedAt-snapshot.bars.at(-1).closeTime>45000);assert.equal(snapshot.metadata.realtime,false);assert.equal(update.metadata.realtime,true);assert.equal(snapshot.metadata.chartIdentityVerified,true);
  const store=createLiveOhlcStore({now:s.now}),snapshotGrant=clock.grantFor(snapshot,s.now()),base=store.ingest(snapshot,{sourceAsOfTime:snapshot.sourceEmittedAt,windowClockGrant:snapshotGrant});assert.equal(base.accepted,true);assert.equal(base.bootstrap,true);assert.equal(base.metadata.realtime,false);assert.equal(base.liveEligible,false);assert.equal(base.sourceClockCorrelation.nonLiveHistoricalBaseline,true);assert.deepEqual(base.eligibleCloseTimes,[]);
  const badUpdate={...update,metadata:{...update.metadata,realtime:false}};assert.equal(validateWindowClockGrant(clock.grantFor(badUpdate,s.now()),{packet:badUpdate,receivedAt:s.now(),now:s.now()}).ok,false,'historical-baseline allowance never authorizes an unverified CURRENT update');
  const current=store.ingest(update,{sourceAsOfTime:update.sourceEmittedAt,windowClockGrant:clock.grantFor(update,s.now())});assert.equal(current.accepted,true);assert.equal(current.liveEligible,true);assert.equal(current.metadata.realtime,true);assert.deepEqual(current.eligibleCloseTimes,[]);assert.equal(current.bootstrapAsOfTime,snapshot.sourceEmittedAt);
  const noWitnessClock=clockFor(s);noWitnessClock.observeEvidence({...output,clockWitnesses:[]},{receivedAt:s.now()});assert.equal(noWitnessClock.grantFor(snapshot,s.now()),null);
  for(const metadata of [{...snapshot.metadata,chartIdentityVerified:false},{...snapshot.metadata,replay:true},{...snapshot.metadata,tabId:18}])assert.equal(validateWindowClockGrant(snapshotGrant,{packet:{...snapshot,metadata},receivedAt:s.now(),now:s.now()}).ok,false);
});

test('the per-session LIVE research opt-in admits actual serialized-reader observer pairs from three NQ charts and preserves opaque grants',()=>{
  const s=sourceFixture({researchMultiChart:true}),clock=clockFor(s,{allowResearchLiveMultiChart:true}),output=correlate(s,clock);
  assert.equal(output.chart.visibleCharts,3);assert.equal(output.chart.researchSelection.statusLegendScoped,true);assert.equal(output.chart.researchSelection.sourceMode,'LIVE');
  assert.equal(output.clockWitnesses.length,2);assert.equal(clock.snapshot().allowResearchLiveMultiChart,true);assert.equal(clock.snapshot().status,'CORRELATED');assert.equal(clock.snapshot().offsetMs,3700);
  assert.equal(clock.permitsFrame(output.windowFrame,s.now()),true);
  const packet=verifiedPackets(output,s.now(),{allowResearchLiveMultiChart:true}).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),before=JSON.stringify(packet);
  assert.ok(packet);const grant=clock.grantFor(packet,s.now());assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:s.now(),now:s.now()}).ok,true);
  assert.equal(validateWindowClockGrant(structuredClone(grant),{packet,receivedAt:s.now(),now:s.now()}).ok,false);assert.equal(JSON.stringify(packet),before);
  s.advance(2001);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false,'the same existing witness-age bound still applies');
});

test('two-chart LIVE research uses the same explicit scope while default single-chart clock policy remains strict',()=>{
  const s=sourceFixture({researchMultiChart:true});s.f.document.canvases.pop();s.f.document.legends.pop();
  const opted=clockFor(s,{allowResearchLiveMultiChart:true}),legacy=clockFor(s);let output;
  for(let index=0;index<2;index++){output=s.tick();opted.observeEvidence(output,{receivedAt:s.now()});legacy.observeEvidence(output,{receivedAt:s.now(),allowResearchLiveMultiChart:true});}
  assert.equal(output.chart.visibleCharts,2);assert.equal(opted.snapshot().status,'CORRELATED');assert.equal(legacy.snapshot().allowResearchLiveMultiChart,false);assert.equal(legacy.snapshot().verifiedFrames,0);
  assert.equal(legacy.permitsFrame(output.windowFrame,s.now()),false,'an evidence marker or observeEvidence argument cannot enable the private session option');
  assert.throws(()=>clockFor(s,{allowResearchLiveMultiChart:'true'}),/WINDOW_CLOCK_OWNER_REQUIRED/);
});

for(const [name,change]of [
  ['missing root-bound source URL',e=>{delete e.sourceUrl;}],
  ['personal source URL',e=>{e.sourceUrl='https://www.tradingview.com/chart/Personal/';}],
  ['missing selection',e=>{delete e.chart.researchSelection;}],
  ['Replay marker',e=>{e.chart.researchSelection.sourceMode='REPLAY';}],
  ['Replay state',e=>{e.chart.replay=true;}],
  ['missing explicit LIVE marker',e=>{delete e.chart.researchSelection.liveMultiChartExplicit;}],
  ['unscoped status legend',e=>{e.chart.researchSelection.statusLegendScoped=false;}],
  ['forged multiple targets',e=>{e.chart.researchSelection.targetCharts=2;}],
  ['duplicate minute labels',e=>{e.chart.chartLabels[0]='Chart for CME_MINI:NQ1!, 1 minute';}],
  ['mixed-symbol chart label',e=>{e.chart.chartLabels[0]='Chart for CME_MINI:MNQ1!, 5 minutes';}],
  ['missing actual chart labels',e=>{delete e.chart.chartLabels;}],
  ['label count mismatch',e=>{e.chart.chartLabels.pop();}],
  ['selection count mismatch',e=>{e.chart.researchSelection.visibleCharts=2;}],
  ['unverified research layout',e=>{e.chart.researchSelection.researchLayoutVerified=false;}],
  ['active interval mismatch',e=>{e.chart.interval='5';}],
  ['closed market',e=>{e.chart.marketOpen=false;}],
  ['unknown market and realtime',e=>{e.chart.marketOpen=null;e.chart.realtime=null;}],
  ['delayed source',e=>{e.chart.realtime=false;}],
  ['four charts',e=>{e.chart.visibleCharts=4;e.chart.researchSelection.visibleCharts=4;e.chart.chartLabels.push('Chart for CME_MINI:NQ1!, 15 minutes');}]
])test('LIVE research '+name+' cannot create a clock correlation or grant',()=>{
  const s=sourceFixture({researchMultiChart:true}),clock=clockFor(s,{allowResearchLiveMultiChart:true});let output;
  for(let index=0;index<2;index++){output=s.tick();change(output);clock.observeEvidence(output,{receivedAt:s.now()});}
  assert.equal(clock.snapshot().verifiedFrames,0);assert.equal(clock.snapshot().offsetMs,null);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);
});

test('a lost LIVE research scope revokes a frozen pair and the prior private grant',()=>{
  const s=sourceFixture({researchMultiChart:true}),clock=clockFor(s,{allowResearchLiveMultiChart:true}),before=correlate(s,clock);
  const packet=verifiedPackets(before,s.now(),{allowResearchLiveMultiChart:true}).find(packet=>packet.kind==='update'&&Math.floor(packet.sequence/8)===s.sequence),grant=clock.grantFor(packet,s.now());
  assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:s.now(),now:s.now()}).ok,true);
  const lost=s.tick();lost.chart.chartLabels[0]='Chart for CME_MINI:NQ1!, 1 minute';clock.observeEvidence(lost,{receivedAt:s.now()});
  assert.equal(clock.snapshot().status,'QUARANTINED');assert.equal(clock.snapshot().blockIntake,true);assert.equal(clock.permitsFrame(lost.windowFrame,s.now()),false);
  assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:packet.receivedAt,now:s.now()}).ok,false);
});

test('FULL SCREENS clock correlation requires actual scoped reader witnesses and the matching URL/name pair',()=>{
  const s=sourceFixture({researchMultiChart:true,fullScreens:true}),clock=clockFor(s,{allowResearchLiveMultiChart:true}),output=correlate(s,clock);assert.equal(output.chart.researchSelection.layoutName,'Full Screens Live');assert.equal(clock.snapshot().status,'CORRELATED');assert.equal(clock.permitsFrame(output.windowFrame,s.now()),true);
  for(const edit of [e=>{e.sourceUrl='https://www.tradingview.com/chart/ARROWRV1/';},e=>{e.chart.researchSelection.layoutName='Arrow OHLC Live Verification';},e=>{delete e.chart.researchSelection.layoutName;},e=>{e.sourceUrl+='?x=1';},e=>{e.chart.replay=true;},e=>{e.windowFrame.checksumsVerified=false;},e=>{e.chart.researchSelection.statusLegendScoped=false;}]){const source=sourceFixture({researchMultiChart:true,fullScreens:true}),bad=clockFor(source,{allowResearchLiveMultiChart:true});let e;for(let i=0;i<2;i++){e=source.tick();edit(e);bad.observeEvidence(e,{receivedAt:source.now()});}assert.equal(bad.snapshot().verifiedFrames,0,edit.toString());assert.equal(bad.permitsFrame(e.windowFrame,source.now()),false);}
});

test('a clock session cannot move between approved URL/name pairs while retaining the same run or its private grants',()=>{
  const s=sourceFixture({researchMultiChart:true}),clock=clockFor(s,{allowResearchLiveMultiChart:true}),before=correlate(s,clock),packet=verifiedPackets(before,s.now(),{allowResearchLiveMultiChart:true}).find(p=>p.kind==='update'&&Math.floor(p.sequence/8)===s.sequence),grant=clock.grantFor(packet,s.now());assert.ok(grant);
  const swapped=s.tick();swapped.sourceUrl='https://www.tradingview.com/chart/ARROWFR1/';swapped.chart.researchSelection.layoutName='Full Screens Live';
  clock.observeEvidence(swapped,{receivedAt:s.now()});assert.equal(clock.snapshot().reasonCode,'WINDOW_CLOCK_OWNER_MISMATCH');assert.equal(clock.snapshot().locked,true);assert.equal(clock.permitsFrame(swapped.windowFrame,s.now()),false);assert.equal(validateWindowClockGrant(grant,{packet,receivedAt:packet.receivedAt,now:s.now()}).ok,false);
});



test('ordinary near-zero DOM callback jitter does not reset live history or renew clock grants',()=>{
 const s=sourceFixture({leadMs:16}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);const offset=clock.snapshot().offsetMs;
 for(const lead of [-18,-11,0,25,-16,14]){const before=clock.snapshot(),output=s.tick(100,{lead});clock.observeEvidence(output,{receivedAt:s.now()});const after=clock.snapshot();assert.equal(after.locked,false);assert.equal(after.requiresRebaseline,false);assert.equal(after.offsetMs,offset);if(lead<=0){assert.equal(after.latestObserver.sequence,before.latestObserver.sequence);assert.equal(after.verifiedFrames,before.verifiedFrames);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);for(const p of verifiedPackets(output,s.now()))assert.equal(clock.grantFor(p,s.now()),null);assert.equal(after.ledger.at(-1).action,'ORDINARY_ZERO_CROSSING_OBSERVATION_IGNORED');}}
});
test('ordinary zero-crossing exception retains original jitter bound and does not apply to extended clock offsets',()=>{
 for(const [initial,lead]of [[16,-251],[1253,-18],[3700,-18]]){const s=sourceFixture({leadMs:initial}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);const output=s.tick(2500,{lead});clock.observeEvidence(output,{receivedAt:s.now()});assert.equal(clock.shouldBlockIntake(),true);assert.equal(clock.permitsFrame(output.windowFrame,s.now()),false);}
});
test('ordinary zero-crossing still rejects sequence, source, document and monotonic clock regressions',()=>{
 for(const mode of ['source','sequence','document','perf']){const s=sourceFixture({leadMs:16}),clock=clockFor(s,{allowOrdinaryClockJitter:true});correlate(s,clock);const e=s.tick(200,{lead:-18}),w=e.clockWitnesses.at(-1),prior=e.clockWitnesses.at(-2);if(mode==='source')w.sourceEmittedAt=prior.sourceEmittedAt-1;if(mode==='sequence')w.sequence=prior.sequence-1;if(mode==='document')w.sourceDocumentTimeOrigin-=1;if(mode==='perf')w.observedAtPerfEpoch=prior.observedAtPerfEpoch-1;clock.observeEvidence(e,{receivedAt:s.now()});assert.equal(clock.snapshot().locked,true,mode);}
});
