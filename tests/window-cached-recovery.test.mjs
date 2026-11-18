import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBootstrap,rows,encodeFrame,makeWindowFixture,recalculateChecksums,SCALAR_BASE} from './window-reader-fixture.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';
import {verifyLiveChart} from '../live-ohlc.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
import {createLiveTimeframes} from '../live-timeframes.mjs';

const minute=60000,start=Date.UTC(2026,10,14,12);
const indexed=(bars,index)=>bars.map((bar,i)=>({...bar,providerBarIndex:index+i,sessionFirst:false,sessionLast:false}));
const openAfter=bar=>({...bar,time:bar.closeTime,closeTime:bar.closeTime+minute,providerBarIndex:bar.providerBarIndex+1,closed:false,sourceClosed:false});
function frame({bootstrap,base,higher,sequence,sourceAt,slot=0,current=openAfter(base.at(-1))}){
  const raw=encodeFrame({bootstrap,base,higher,sequence,sourceAt,slot,current,counts:[base.length,...higher.map(bars=>bars.length)]});raw.ARROW2_PROTOCOL=3;
  const groups={CURRENT:current,PREVIOUS:base.at(-1),HIGHER1:higher[0].at(-1),HIGHER2:higher[1].at(-1),HISTORY_BASE:base.at(-1-slot),HISTORY_HIGHER1:higher[0].at(-1-slot),HISTORY_HIGHER2:higher[1].at(-1-slot)};
  for(const [name,bar]of Object.entries(groups))if(bar)raw['ARROW2_'+name+'_CLOSE_TIME']=sequence%4096*SCALAR_BASE+bar.providerBarIndex*4+(bar.sessionFirst?1:0)+(bar.sessionLast?2:0);
  return recalculateChecksums(raw);
}
function sourceFixture(){
  const bootstrap={...makeBootstrap(),wireVersion:3},base=indexed(rows(20,minute),100),higher=[indexed(rows(20,5*minute),200),indexed(rows(20,15*minute),300)];
  let sequence=1,sourceAt=start+1000;
  const seed={runEpoch:bootstrap.runEpoch,runId:bootstrap.runId,sourceEmittedAt:start,metadata:bootstrap.metadata,baseBars:base,higherTimeframes:higher.map((bars,index)=>({...bootstrap.higherTimeframes[index],bars,sessionGaps:[],reasonCodes:[]}))};
  const f=makeWindowFixture({bootstrap,raw:frame({bootstrap,base,higher,sequence,sourceAt})});f.read({bootstrapHistory:seed});
  const advance=(ms=200,{observer=false,patch={}}={})=>{f.advance(ms);sourceAt+=ms;f.setRaw(frame({bootstrap,base,higher,sequence:++sequence,sourceAt,...patch}));if(observer){f.mutate();return f.context.__arrowWindowFeedV2.latestEvidence;}return f.read();};
  advance();
  const lateAck=()=>{advance(16001,{observer:true});advance(200,{observer:true});advance(200,{observer:true});const report=f.read();assert.equal(report.resetRequired,true);assert.deepEqual(report.messages,[]);return f.read({needsSnapshot:true});};
  return {f,bootstrap,base,higher,advance,lateAck,get sourceAt(){return sourceAt;},get sequence(){return sequence;}};
}
const decoded=output=>output.messages.map(raw=>{const parsed=parsePineOhlcMessage(raw,{tabId:17,receivedAt:output.observedAtWall});assert.equal(parsed.ok,true,parsed.reasonCodes?.join(','));return parsed.packet;});

test('observer burst before ACK restores only cached context, and only a new coherent source pair establishes the LIVE baseline',()=>{
  const s=sourceFixture(),context=s.lateAck(),packets=decoded(context);
  assert.equal(context.contextOnly,true);assert.equal(context.liveEligible,false);assert.equal(context.resetRequired,false);
  assert.deepEqual(packets.map(packet=>packet.kind),['snapshot','timeframe_snapshot','timeframe_snapshot']);
  assert.ok(packets.every(packet=>packet.bootstrapOnly===true&&packet.realtime===false));
  assert.equal(context.recovery.freshFrames,0);
  const retainedSequence=context.windowFrame.sequence;
  for(let i=0;i<4;i++){const same=s.f.read({needsSnapshot:false,afterRunId:s.bootstrap.runId,afterSequence:Math.max(...packets.map(p=>p.sequence))});assert.equal(same.windowFrame.sequence,retainedSequence);assert.deepEqual(same.messages,[]);assert.equal(same.recovery.freshFrames,0,'receiver polls cannot count as new source observations');}
  const first=s.advance();assert.equal(first.status,'WAITING');assert.equal(first.resetRequired,false);assert.equal(first.recovery.freshFrames,1);assert.deepEqual(first.messages,[]);
  const fresh=s.advance(),freshPackets=decoded(fresh);
  assert.equal(fresh.status,'OK');assert.equal(fresh.contextOnly,undefined);assert.ok(freshPackets.some(packet=>packet.kind==='snapshot'));assert.ok(freshPackets.some(packet=>packet.kind==='update'));
  assert.ok(freshPackets.every(packet=>packet.sourceEmittedAt===s.sourceAt&&packet.sequence>retainedSequence*8+7&&!packet.bootstrapOnly));
  assert.equal(fresh.continuityDecisions.at(-1).action,'RECOVERY_FRESH_PAIR_VERIFIED');
});

test('cached recovery packets traverse parser/proof/store/HTF without live eligibility or historical closes, then fresh snapshot advances the cutoff',()=>{
  const s=sourceFixture(),context=s.lateAck();let now=context.observedAtWall;
  const store=createLiveOhlcStore({now:()=>now}),timeframes=createLiveTimeframes();
  let selectedRun=null,afterSequence=0;
  function ingest(output){
    now=output.observedAtWall;const packets=decoded(output);
    if(packets.length)selectedRun=packets.at(-1).runId;
    const fresh=packets.filter(packet=>packet.runId===selectedRun&&packet.sequence>afterSequence);
    const results=[];
    for(const packet of fresh){
      afterSequence=packet.sequence;const proof=verifyLiveChart(packet,output,17);assert.equal(proof.identityValid,true);
      const verified={...packet,metadata:proof.metadata};timeframes.ingest(verified,{observedAsOfTime:Math.max(...packets.map(packet=>packet.sourceEmittedAt))});
      if(packet.kind==='snapshot'||packet.kind==='update')results.push(store.ingest(verified,{sourceAsOfTime:packet.sourceEmittedAt}));
    }
    return results;
  }
  const baseline=ingest(context)[0];assert.equal(baseline.status,'CONTEXT_READY');assert.equal(baseline.accepted,true);assert.equal(baseline.ready,false);assert.equal(baseline.liveEligible,false);assert.equal(baseline.contextOnly,true);assert.deepEqual(baseline.eligibleCloseTimes,[]);assert.equal(timeframes.snapshot({asOfTime:s.sourceAt}).ready,true);
  const contextCutoff=baseline.bootstrapAsOfTime;
  assert.equal(s.f.read({afterRunId:selectedRun,afterSequence}).messages.length,0);
  assert.deepEqual(ingest(s.advance()),[]);assert.equal(store.snapshot(now).liveEligible,false);
  const result=ingest(s.advance());assert.equal(result[0].bootstrap,true);assert.equal(result.at(-1).liveEligible,true);assert.equal(result[0].contextOnly,false);assert.ok(result[0].bootstrapAsOfTime>contextCutoff);assert.ok(result.every(state=>state.accepted&&state.eligibleCloseTimes.length===0));
  assert.equal(store.snapshot(now).bootstrapAsOfTime,s.sourceAt);assert.equal(store.snapshot(now).bars.length,20);
});

test('quiet intervals after context do not restart ACK deadlock or discard verified history',()=>{
  const s=sourceFixture();s.lateAck();const original=JSON.parse(JSON.stringify(s.f.context.__arrowWindowFeedV2.series.map(series=>series.bars)));
  for(let repeat=0;repeat<3;repeat++){
    const quiet=s.advance(16001);assert.equal(quiet.resetRequired,false);assert.equal(quiet.contextOnly,true);assert.equal(quiet.recovery.freshFrames,1);assert.deepEqual(quiet.messages,[]);
    assert.deepEqual(JSON.parse(JSON.stringify(s.f.context.__arrowWindowFeedV2.series.map(series=>series.bars))),original);
    assert.equal(s.f.read().messages.length,0);
  }
  const resumed=s.advance();assert.ok(decoded(resumed).some(packet=>packet.kind==='snapshot'&&!packet.bootstrapOnly));assert.equal(resumed.resetRequired,false);
});

test('run, symbol and corrected-price changes cannot borrow cached context to recover LIVE',()=>{
  for(const mode of ['RUN','SYMBOL','CORRECTION']){
    const s=sourceFixture();s.lateAck();let bootstrap=structuredClone(s.bootstrap),base=s.base;
    if(mode==='RUN'){bootstrap.runEpoch++;bootstrap.runId=bootstrap.metadata.instrument+'|1|'+bootstrap.runEpoch;}
    if(mode==='SYMBOL'){bootstrap.metadata.instrument='CME_MINI:MNQ1!';bootstrap.runId=bootstrap.metadata.instrument+'|1|'+bootstrap.runEpoch;s.f.canvas.attrs['aria-label']='Chart for '+bootstrap.metadata.instrument+', 1 minute';}
    if(mode==='CORRECTION'){base=structuredClone(base);base.at(-1).high+=.25;}
    s.f.advance(200);s.f.setRaw(frame({bootstrap,base,higher:s.higher,sequence:s.sequence+1,sourceAt:s.sourceAt+200}));const result=s.f.read({bootstrap});
    assert.deepEqual(result.messages,[],mode);assert.equal(result.resetRequired,true,mode);assert.notEqual(result.liveEligible,true,mode);
    assert.equal(s.f.context.__arrowWindowFeedV2.contextRecovery,null,mode+' invalidates context recovery');
  }
});

test('store context-only scope permits old history but blocks future clocks, forged live scope and updates without a fresh snapshot',()=>{
  const s=sourceFixture(),context=s.lateAck(),packet=decoded(context).find(packet=>packet.kind==='snapshot');let now=context.observedAtWall+60000;
  const makeStore=()=>createLiveOhlcStore({now:()=>now}),withMeta={...packet,receivedAt:now,metadata:{...packet.metadata,realtime:true,replay:false}};
  const store=makeStore(),historical=store.ingest(withMeta,{sourceAsOfTime:packet.sourceEmittedAt});assert.equal(historical.accepted,true);assert.equal(historical.liveEligible,false);assert.equal(historical.ready,false);
  const future=makeStore().ingest({...withMeta,sourceEmittedAt:now+3001},{sourceAsOfTime:now+3001});assert.equal(future.accepted,false);assert.ok(future.reasonCodes.includes('SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED'));
  const forged=makeStore().ingest({...withMeta,realtime:true},{sourceAsOfTime:packet.sourceEmittedAt});assert.equal(forged.accepted,false);assert.ok(forged.reasonCodes.includes('INVALID_CONTEXT_BASELINE_SCOPE'));
  const update=store.ingest({...withMeta,kind:'update',bootstrapOnly:undefined,realtime:true,receivedAt:now,sourceEmittedAt:now},{sourceAsOfTime:now});assert.equal(update.accepted,false);assert.ok(update.reasonCodes.includes('CONTEXT_BASELINE_REQUIRES_FRESH_SNAPSHOT'));assert.deepEqual(update.eligibleCloseTimes,[]);
});

test('Replay, a corrupt checksum and sequence changes without source-clock advance cannot satisfy recovery freshness',()=>{
  for(const mode of ['REPLAY','CHECKSUM','FROZEN_SOURCE_CLOCK']){
    const s=sourceFixture();s.lateAck();s.f.advance(200);
    const values=frame({bootstrap:s.bootstrap,base:s.base,higher:s.higher,sequence:s.sequence+1,sourceAt:mode==='FROZEN_SOURCE_CLOCK'?s.sourceAt:s.sourceAt+200});
    if(mode==='REPLAY')s.f.replay.attrs['aria-pressed']='true';
    if(mode==='CHECKSUM')values.ARROW2_CHECKSUM_A++;
    s.f.setRaw(values);const output=s.f.read();assert.deepEqual(output.messages,[],mode);assert.notEqual(output.liveEligible,true,mode);
    assert.equal(s.f.context.__arrowWindowFeedV2.contextRecovery.freshFrames,0,mode+' is not a genuinely new live source observation');
    if(mode==='FROZEN_SOURCE_CLOCK')assert.equal(output.recovery.freshFrames,0);
    if(mode==='REPLAY')assert.equal(output.contextOnly,true);
    if(mode==='CHECKSUM')assert.ok(output.reasonCodes.includes('WINDOW_FRAME_CHECKSUM_MISMATCH'));
  }
});
