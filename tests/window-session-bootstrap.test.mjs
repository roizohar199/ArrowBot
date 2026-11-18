import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWindowBootstrapEvidence} from '../window-bootstrap.mjs';
import {deriveVerifiedSessionGaps,verifiedSessionGap} from '../session-gap-proof.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
import {createLiveTimeframes} from '../live-timeframes.mjs';
import {createPreopenContext} from '../live-preopen-context.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE,TIME_ORIGIN} from './window-reader-fixture.mjs';

const indexed=(bars,start=100)=>bars.map((bar,i)=>({...bar,providerBarIndex:start+i,sessionFirst:false,sessionLast:false}));
function bundle(){
  const bootstrap={...makeBootstrap(),wireVersion:3};bootstrap.encoding.historyHoldMs=200;
  const sourceAt=Date.UTC(2026,10,14,12),end=Date.UTC(2026,10,13,22);
  const base=indexed(rows(20,60000,end)),higher=[indexed(rows(20,300000,end),200),indexed(rows(20,900000,end),300)];
  base.at(-1).sessionLast=true;higher.forEach(bars=>{bars.at(-1).sessionLast=true;});
  const meta=bootstrap.metadata,header={schemaVersion:1,runId:bootstrap.runId,sourceEmittedAt:sourceAt,realtime:false,dataDelayUnverified:true,bootstrapOnly:true,reasonCodes:[]};
  const packets=[{...header,sequence:1,kind:'snapshot',metadata:{...meta,sessionGaps:[]},bars:base},...higher.map((bars,i)=>({...header,sequence:i+2,kind:'timeframe_snapshot',metadata:meta,bars:[],higherTimeframes:[{...bootstrap.higherTimeframes[i],bars,sessionGaps:[],reasonCodes:[]}]}))];
  return {bootstrap,base,higher,sourceAt,packets,messages:packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet))};
}
function frame3({bootstrap,base,higher,current,sequence,sourceAt,slot=0,flags=3}){
  const raw=encodeFrame({bootstrap,base,higher,current,sequence,sourceAt,slot,counts:[base.length,...higher.map(bars=>bars.length)],flags});raw.ARROW2_PROTOCOL=3;
  const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1-slot),HISTORY_HIGHER1:higher[0].at(-1-slot),HISTORY_HIGHER2:higher[1].at(-1-slot)};
  for(const [name,bar] of Object.entries(groups))if(bar)raw['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4+(bar.sessionFirst?1:0)+(bar.sessionLast?2:0);
  return recalculateChecksums(raw);
}
const openAfter=(bar,time)=>({...bar,time,closeTime:time+60000,providerBarIndex:bar.providerBarIndex+1,sessionFirst:true,sessionLast:false,closed:false,sourceClosed:false});

test('overnight, weekend and holiday-sized closures require both provider flags and consecutive provider indices',()=>{
  for(const duration of [3600000,49*3600000,97*3600000]){
    const before=indexed(rows(1,60000))[0],after={...before,time:before.closeTime+duration,closeTime:before.closeTime+duration+60000,providerBarIndex:before.providerBarIndex+1,sessionFirst:true};before.sessionLast=true;
    assert.equal(deriveVerifiedSessionGaps([before,after]).valid,true);assert.equal(verifiedSessionGap(before,after).basis,'PINE_SESSION_FLAGS_AND_PROVIDER_INDEX');
    for(const change of [{sessionFirst:false},{providerBarIndex:after.providerBarIndex+1}])assert.equal(deriveVerifiedSessionGaps([before,{...after,...change}]).valid,false);
    assert.equal(verifiedSessionGap({...before,sessionLast:false},after),null);
  }
});

test('bounded bootstrap is historical context, rejects incomplete/future/malformed and unproven missing bars',()=>{
  const b=bundle(),result=parseWindowBootstrapEvidence(b.messages,{tabId:7,receivedAt:b.sourceAt});assert.equal(result.ok,true);assert.equal(result.ready,true);assert.equal(result.liveEligible,false);assert.equal(result.contextOnly,true);assert.equal(result.bootstrap.wireVersion,3);
  assert.equal(parseWindowBootstrapEvidence(b.messages.slice(0,2),{tabId:7,receivedAt:b.sourceAt}).ok,false);
  for(const change of [packets=>{packets[0].bars.at(-1).closeTime=b.sourceAt+1;},packets=>{packets[0].bars.splice(10,1);},packets=>{packets[0].bars[0].sessionFirst='true';},packets=>{packets[1].sourceEmittedAt++;}]){
    const packets=structuredClone(b.packets);change(packets);assert.equal(parseWindowBootstrapEvidence(packets.map(p=>'ARROW_OHLC_V1 '+JSON.stringify(p)),{tabId:7,receivedAt:b.sourceAt}).ok,false);
  }
});

test('pre-session seed needs two actual fresh frames, then all required histories are ready at open without a five-hour wait',()=>{
  const b=bundle(),parsed=parseWindowBootstrapEvidence(b.messages,{tabId:7,receivedAt:b.sourceAt}),opened=Date.UTC(2026,10,15,23),current=openAfter(b.base.at(-1),opened);
  const options={...b,base:b.base.slice(0,-1),current,sequence:0,sourceAt:b.sourceAt,flags:1},historical={...b.base.at(-1),closed:true,sourceClosed:true};
  const f=makeWindowFixture({bootstrap:parsed.bootstrap,raw:frame3({...options,current:historical})});
  const pre=f.read({bootstrapHistory:parsed.bootstrapHistory});assert.equal(pre.contextReady,true);assert.equal(pre.contextOnly,true);assert.equal(pre.messages.length,0);
  f.setRaw(frame3({...b,current,sequence:1,sourceAt:opened+1000}));assert.equal(f.read().reasonCodes[0],'WINDOW_COHERENCE_PRIMING');
  f.advance(200);f.setRaw(frame3({...b,current,sequence:2,sourceAt:opened+1200}));const output=f.read();
  const packets=output.messages.map(text=>{const parsed=parsePineOhlcMessage(text,{tabId:7,receivedAt:opened+1200});assert.equal(parsed.ok,true,JSON.stringify(parsed));return parsed.packet;});
  assert.equal(packets.filter(packet=>packet.kind==='snapshot').length,1);assert.equal(packets.filter(packet=>packet.kind==='timeframe_snapshot').length,2);
  const manager=createLiveTimeframes(),store=createLiveOhlcStore({now:()=>opened+1200});
  for(const packet of packets){packet.metadata={...packet.metadata,realtime:true,replay:false};if(packet.kind.startsWith('timeframe'))manager.ingest(packet,{observedAsOfTime:opened+1200});else{const result=store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt,intakeAt:opened+1200});assert.equal(result.accepted,true);assert.equal(result.eligibleCloseTimes.length,0);}}
  assert.equal(manager.snapshot({asOfTime:opened+1200}).ready,true);assert.equal(store.snapshot(opened+1200).liveEligible,true);assert.equal(store.snapshot(opened+1200).current.sessionFirst,true);
  assert.equal(store.snapshot(opened+1200).metadata.sessionGaps.length,1);
});

test('validated partial seed enables ordinary base updates while an18-bar required higher timeframe remains blocked',()=>{
  const b=bundle();b.higher[1]=b.higher[1].slice(2);b.packets[2].higherTimeframes[0].bars=b.higher[1];
  const messages=b.packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet));
  const context=createPreopenContext(),chart={symbols:[b.bootstrap.metadata.instrument],interval:'1',visibleCharts:1,documentVisible:true,replay:false};
  assert.equal(context.capture(messages,{sourceTabId:7,chart,receivedAt:b.sourceAt}).status,'CONTEXT_INCOMPLETE');
  context.begin({sourceTabId:7,instrument:b.bootstrap.metadata.instrument,connectionSessionId:'partial'});
  const seed=context.readerArgs();assert.equal(seed.bootstrapHistory.higherTimeframes[1].bars.length,18);assert.deepEqual(context.readerArgs(),{});
  const opened=Date.UTC(2026,10,15,23),current=openAfter(b.base.at(-1),opened),f=makeWindowFixture({bootstrap:seed.bootstrap,raw:frame3({...b,current,sequence:1,sourceAt:opened+1000})});
  const prime=f.read(seed);assert.equal(prime.reasonCodes[0],'WINDOW_COHERENCE_PRIMING');assert.equal(prime.messages.length,0);
  f.advance(200);f.setRaw(frame3({...b,current,sequence:2,sourceAt:opened+1200}));const output=f.read();
  const packets=output.messages.map(raw=>{const result=parsePineOhlcMessage(raw,{tabId:7,receivedAt:opened+1200});assert.equal(result.ok,true,JSON.stringify(result));return result.packet;});
  assert.equal(packets.filter(packet=>packet.kind==='snapshot').length,1);assert.equal(packets.filter(packet=>packet.kind==='update').length,1);
  assert.deepEqual(packets.filter(packet=>packet.kind==='timeframe_snapshot').map(packet=>packet.higherTimeframes[0].timeframe),['5']);
  const incomplete=output.history[2];assert.equal(incomplete.retainedBars,18);assert.equal(incomplete.contiguousBars,18);assert.equal(incomplete.snapshotSent,false);
  const manager=createLiveTimeframes(),store=createLiveOhlcStore({now:()=>opened+1200});
  for(const packet of packets){packet.metadata={...packet.metadata,realtime:true,replay:false};manager.ingest(packet,{observedAsOfTime:opened+1200,includeBars:false});if(!packet.kind.startsWith('timeframe'))assert.equal(store.ingest(packet,{sourceAsOfTime:packet.sourceEmittedAt,intakeAt:opened+1200}).accepted,true);}
  const higher=manager.snapshot({asOfTime:opened+1200});assert.equal(store.snapshot(opened+1200).ready,true);assert.equal(higher.ready,false);
  assert.equal(higher.series.find(series=>series.timeframe==='5').ready,true);assert.equal(higher.series.find(series=>series.timeframe==='15').ready,false);assert.deepEqual(higher.higherTimeframes['15'].bars,[]);
  const state=store.snapshot(opened+1200),analysis=analyzeGuideSignals(state.bars,{metadata:state.metadata,higherTimeframes:higher.higherTimeframes,config:{requireHigherTimeframe:true,requireRisk:true},risk:{riskBudget:200,pointValue:20,maxContracts:1,commissionPerContract:5,slippageTicks:2,rewardRisk:2},asOfTime:opened+1200});
  assert.equal(analysis.signals.length,0);for(const direction of ['LONG','SHORT']){const check=analysis.currentChecks.directions[direction].checks.find(check=>check.id==='HIGHER_TIMEFRAME');assert.equal(check.required,true);assert.equal(check.passed,false);assert.equal(check.available,false);}
});

test('seed identity, missing provider rows and final corrections cannot restore a false-ready baseline',()=>{
  const b=bundle(),parsed=parseWindowBootstrapEvidence(b.messages,{tabId:7,receivedAt:b.sourceAt}),opened=Date.UTC(2026,10,15,23),current=openAfter(b.base.at(-1),opened);
  for(const change of [seed=>seed.runEpoch++,seed=>seed.baseBars.splice(5,1),seed=>seed.baseBars[0].high=NaN,seed=>seed.sourceEmittedAt=opened+2000]){
    const seed=structuredClone(parsed.bootstrapHistory);change(seed);const f=makeWindowFixture({bootstrap:parsed.bootstrap,raw:frame3({...b,current,sequence:1,sourceAt:opened+1000})});assert.match(f.read({bootstrapHistory:seed}).reasonCodes[0],/BOOTSTRAP_HISTORY/);
  }
  const f=makeWindowFixture({bootstrap:parsed.bootstrap,raw:frame3({...b,current,sequence:1,sourceAt:opened+1000})});f.read({bootstrapHistory:parsed.bootstrapHistory});
  const corrected=structuredClone(b.base);corrected.at(-1).high+=.25;f.setRaw(frame3({...b,base:corrected,current,sequence:2,sourceAt:opened+1200}));const output=f.read();assert.equal(output.resetRequired,true);assert.ok(output.reasonCodes.includes('WINDOW_CLOSED_BAR_CORRECTION'));assert.equal(output.messages.length,0);
});

test('verified prior-session higher history keeps all causal bars; unknown gaps and forged indices cannot grant context',()=>{
  const b=bundle();
  for(const packet of b.packets.slice(1)){
    const entry=packet.higherTimeframes[0];for(const bar of entry.bars.slice(0,10)){bar.time-=48*3600000;bar.closeTime-=48*3600000;}entry.bars[9].sessionLast=true;entry.bars[10].sessionFirst=true;entry.sessionGaps=deriveVerifiedSessionGaps(entry.bars).gaps;
  }
  const parsed=parseWindowBootstrapEvidence(b.packets.map(packet=>'ARROW_OHLC_V1 '+JSON.stringify(packet)),{tabId:7,receivedAt:b.sourceAt});assert.equal(parsed.ok,true);
  const manager=createLiveTimeframes();for(const packet of parsed.higherPackets)manager.ingest(packet,{observedAsOfTime:b.sourceAt});
  assert.equal(manager.snapshot({asOfTime:b.sourceAt-1}).ready,false);
  const at=manager.snapshot({asOfTime:b.sourceAt});assert.equal(at.ready,true);for(const entry of Object.values(at.higherTimeframes)){assert.equal(entry.bars.length,20);assert.equal(entry.metadata.sessionGaps.length,1);assert.ok(entry.bars.every(bar=>bar.knownAt===b.sourceAt));}
  const missing=structuredClone(parsed.higherPackets[0]);missing.sequence=5;missing.higherTimeframes[0].bars[10].providerBarIndex++;const result=manager.ingest(missing,{observedAsOfTime:b.sourceAt});assert.ok(result.ingestReasonCodes.includes('INVALID_HIGHER_TIMEFRAME_PROVIDER_PROOF'));assert.equal(result.ready,false);
});

test('a shorter incoming transport window cannot erase session proof still needed by the longer retained base history',()=>{
  const b=bundle(),base=b.base;for(const bar of base.slice(0,10)){bar.time-=48*3600000;bar.closeTime-=48*3600000;}base[9].sessionLast=true;base[10].sessionFirst=true;base.at(-1).sessionLast=false;
  const gaps=deriveVerifiedSessionGaps(base).gaps;let now=base.at(-1).closeTime+1000;
  const metadata={...b.bootstrap.metadata,provider:'TradingView Public Data Window',sourceId:b.bootstrap.runId,tabId:7,realtime:true,replay:false,sessionGaps:gaps};
  const store=createLiveOhlcStore({now:()=>now}),snapshot={kind:'snapshot',metadata,bars:base,sourceEmittedAt:now,receivedAt:now};assert.equal(store.ingest(snapshot,{sourceAsOfTime:now}).accepted,true);
  const current={...base.at(-1),time:base.at(-1).closeTime,closeTime:base.at(-1).closeTime+60000,providerBarIndex:base.at(-1).providerBarIndex+1,sessionFirst:false,sessionLast:false,closed:false,sourceClosed:false};now+=1000;
  const result=store.ingest({kind:'update',metadata:{...metadata,sessionGaps:[]},bars:[base.at(-1),current],sourceEmittedAt:now,receivedAt:now},{sourceAsOfTime:now});assert.equal(result.accepted,true);assert.deepEqual(result.metadata.sessionGaps,gaps);assert.equal(result.bars.length,20);
});
