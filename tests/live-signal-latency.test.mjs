import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSignalLatency} from '../live-signal-latency.mjs';

function fixture(options={}){
  let at=100,wallOffset=1700000000000,serial=0,visible=true,onscreen=true;
  const callbacks=new Map(),emitted=[];
  const tracker=createLiveSignalLatency({now:()=>at,wallNow:()=>wallOffset+at,requestAnimationFrame:fn=>{const id=++serial;callbacks.set(id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id),isVisible:()=>visible,isOnscreen:()=>onscreen,onSample:sample=>emitted.push(sample),...options});
  const setTime=value=>{at=value;};
  const frame=value=>{at=value;const next=callbacks.entries().next().value;assert.ok(next,'a paint opportunity is pending');callbacks.delete(next[0]);next[1](value);};
  const stages=(token,start=102,finish=107,mutation=110)=>{setTime(start);assert.equal(tracker.analysisStarted(token),true);setTime(finish);assert.equal(tracker.analysisFinished(token),true);setTime(mutation);return tracker.rendered(token);};
  return {tracker,emitted,setTime,frame,stages,callbacks,setVisible:value=>{visible=value;},setOnscreen:value=>{onscreen=value;},shiftWall:delta=>{wallOffset+=delta;}};
}
const input=(eventId='tick-1',extra={})=>({context:'tab:7:EXAMPLE:1m:regular',eventId,...extra});

test('live local timings span receipt, queue, analysis, result mutation and two paint opportunities',()=>{
  const f=fixture(),token=f.tracker.receive(input());
  assert.equal(f.stages(token),true);f.frame(116);f.frame(132);
  const report=f.tracker.snapshot(),sample=report.samples[0];
  assert.equal(report.completed,1);assert.equal(report.pending,0);assert.equal(sample.queueMs,2);assert.equal(sample.analysisMs,5);assert.equal(sample.analysisToMutationMs,3);assert.equal(sample.receiptToMutationMs,10);
  assert.equal(sample.receiptToPaintOpportunityLowerMs,16);assert.equal(sample.receiptToPaintOpportunityUpperMs,32);
  assert.equal(sample.providerToReceiptAgeMs,null);assert.equal(sample.sourceUnavailableReason,'SOURCE_TIMESTAMP_ABSENT');
  assert.equal(report.metrics.receiptToPaintOpportunityUpperMs.p95Ms,32);assert.equal(report.captureToDisplayMeasured,false);assert.equal(report.marketToDisplayMeasured,false);assert.equal(report.physicalDisplayMeasured,false);
  f.emitted[0].analysisMs=999;assert.equal(f.tracker.snapshot().samples[0].analysisMs,5);
});

test('only explicitly comparable synchronized emission timestamps produce conditional source age',()=>{
  const f=fixture(),token=f.tracker.receive(input('trusted',{sourceTimestamp:{epochMs:1700000000090,clock:'unix_ms',synchronized:true,meaning:'provider_emission'}}));
  f.stages(token);f.frame(116);f.frame(132);
  const sample=f.tracker.snapshot().samples[0];
  assert.equal(sample.providerToReceiptAgeMs,10);assert.equal(sample.sourceToPaintOpportunityLowerMs,26);assert.equal(sample.sourceToPaintOpportunityUpperMs,42);assert.equal(sample.sourceUnavailableReason,null);
  const cases=[
    [{epochMs:90,clock:'performance_ms',synchronized:true,meaning:'provider_emission'},'SOURCE_CLOCK_NOT_COMPARABLE'],
    [{epochMs:1700000000090,clock:'unix_ms',meaning:'provider_emission'},'SOURCE_CLOCK_NOT_VERIFIED_SYNCHRONIZED'],
    [{epochMs:1700000000090,clock:'unix_ms',synchronized:true,meaning:'bar_close'},'SOURCE_TIME_IS_NOT_EMISSION_OR_EXCHANGE_EVENT'],
    [{epochMs:1700000000200,clock:'unix_ms',synchronized:true,meaning:'exchange_event'},'SOURCE_TIMESTAMP_IN_FUTURE'],
  ];
  for(const [sourceTimestamp,reason] of cases){
    const current=fixture(),handle=current.tracker.receive(input('unknown',{sourceTimestamp}));current.stages(handle);current.frame(116);current.frame(132);
    const result=current.tracker.snapshot().samples[0];assert.equal(result.providerToReceiptAgeMs,null);assert.equal(result.sourceToPaintOpportunityUpperMs,null);assert.equal(result.sourceUnavailableReason,reason);
    assert.equal(result.receiptToPaintOpportunityUpperMs,32,'unusable source clocks do not erase valid local timing');
  }
});

test('wall clock shifts invalidate conditional provider age while preserving monotonic local stages',()=>{
  const f=fixture(),token=f.tracker.receive(input('clock-shift',{sourceTimestamp:{epochMs:1700000000090,clock:'unix_ms',synchronized:true,meaning:'exchange_event'}}));
  f.stages(token);f.frame(116);f.shiftWall(10000);f.frame(132);
  const report=f.tracker.snapshot(),sample=report.samples[0];
  assert.equal(sample.providerToReceiptAgeMs,null);assert.equal(sample.sourceUnavailableReason,'RECEIVER_WALL_CLOCK_SHIFT');assert.equal(sample.receiptToPaintOpportunityUpperMs,32);
  assert.equal(report.sourceUnavailable.RECEIVER_WALL_CLOCK_SHIFT,1);
});

test('hidden and offscreen results are excluded both at DOM update and between paint callbacks',()=>{
  for(const kind of ['hidden','offscreen']){
    const f=fixture(),token=f.tracker.receive(input());
    if(kind==='hidden')f.setVisible(false);else f.setOnscreen(false);
    assert.equal(f.stages(token),false);assert.equal(f.tracker.snapshot().completed,0);assert.equal(f.tracker.snapshot().discarded[kind.toUpperCase()],1);assert.equal(f.callbacks.size,0);
    const second=fixture(),handle=second.tracker.receive(input());second.stages(handle);second.frame(116);
    if(kind==='hidden')second.setVisible(false);else second.setOnscreen(false);
    second.frame(132);assert.equal(second.tracker.snapshot().completed,0);assert.equal(second.tracker.snapshot().discarded[kind.toUpperCase()],1);
  }
});

test('new result mutations supersede pending measurements and old async results cannot replace a newer render',()=>{
  const f=fixture(),first=f.tracker.receive(input('first'));f.stages(first);
  f.setTime(111);const second=f.tracker.receive(input('second'));f.stages(second,112,114,115);
  f.frame(116);f.frame(132);
  const report=f.tracker.snapshot();assert.equal(report.completed,1);assert.equal(report.discarded.SUPERSEDED_RENDER,1);assert.equal(report.samples[0].eventId,'second');
  f.setTime(140);const old=f.tracker.receive(input('slow-old'));f.setTime(141);const recent=f.tracker.receive(input('newer'));
  f.stages(recent,142,144,145);f.setTime(146);f.tracker.analysisStarted(old);f.setTime(147);f.tracker.analysisFinished(old);f.setTime(148);
  assert.equal(f.tracker.rendered(old),false);assert.equal(f.tracker.snapshot().discarded.OUTDATED_RENDER,1);
  f.frame(150);f.frame(166);assert.equal(f.tracker.snapshot().samples.at(-1).eventId,'newer');
});

test('source context changes cancel pending callbacks and start a fresh unmixed report',()=>{
  const f=fixture(),first=f.tracker.receive(input());f.stages(first);const generation=f.tracker.snapshot().generation;
  f.setTime(111);const second=f.tracker.receive(input('new-source',{context:'tab:8:OTHER:5m:regular'}));
  assert.equal(f.callbacks.size,0);assert.equal(f.tracker.analysisFinished(first),false);assert.equal(f.tracker.rendered(first),false);
  const report=f.tracker.snapshot();assert.equal(report.context,'tab:8:OTHER:5m:regular');assert.equal(report.generation,generation+1);assert.equal(report.lastResetReason,'CONTEXT_CHANGED');assert.equal(report.received,1);assert.equal(report.completed,0);
  f.stages(second,112,114,115);f.frame(116);f.frame(132);assert.equal(f.tracker.snapshot().samples[0].eventId,'new-source');
  f.tracker.reset();assert.equal(f.callbacks.size,0);assert.equal(f.tracker.snapshot().received,0);assert.equal(f.tracker.snapshot().context,null);
});

test('out-of-order stages, clock rollback, expired render work and forged tokens cannot create a sample',()=>{
  const f=fixture(),token=f.tracker.receive(input());f.setTime(102);assert.equal(f.tracker.analysisFinished(token),false);assert.equal(f.tracker.snapshot().discarded.INVALID_STAGE_CLOCK,1);
  const rollback=f.tracker.receive(input('rollback'));f.setTime(99);assert.equal(f.tracker.analysisStarted(rollback),false);
  assert.equal(f.tracker.rendered({...rollback}),false);
  const expired=fixture({maxDurationMs:20}),handle=expired.tracker.receive(input());expired.stages(handle);expired.frame(116);expired.frame(132);
  assert.equal(expired.tracker.snapshot().completed,0);assert.equal(expired.tracker.snapshot().discarded.INVALID_PAINT_CLOCK,1);
});

test('retained samples and pending input are bounded, and snapshots do not expose mutable state',()=>{
  const f=fixture({maxSamples:2,maxPending:2});
  for(let i=0;i<3;i++){f.setTime(100+i*40);const token=f.tracker.receive(input('item-'+i));f.stages(token,102+i*40,107+i*40,110+i*40);f.frame(116+i*40);f.frame(132+i*40);}
  const report=f.tracker.snapshot();assert.equal(report.completed,3);assert.equal(report.retainedSamples,2);assert.deepEqual(report.samples.map(s=>s.eventId),['item-1','item-2']);
  report.samples[0].analysisMs=999;report.discarded.fake=1;assert.equal(f.tracker.snapshot().samples[0].analysisMs,5);assert.equal(f.tracker.snapshot().discarded.fake,undefined);
  for(let i=0;i<3;i++){f.setTime(250+i);f.tracker.receive(input('pending-'+i));}
  assert.equal(f.tracker.snapshot().pending,2);assert.equal(f.tracker.snapshot().discarded.PENDING_LIMIT,1);
});

test('instrumentation callbacks cannot break rendering and invalid limits fail before measurement',()=>{
  const f=fixture({onSample:()=>{throw Error('display callback');}}),token=f.tracker.receive(input());f.stages(token);f.frame(116);assert.doesNotThrow(()=>f.frame(132));assert.equal(f.tracker.snapshot().completed,1);
  for(const options of [{maxSamples:0},{maxPending:Infinity},{maxDurationMs:-1},{isVisible:null}])assert.throws(()=>fixture(options),TypeError);
  assert.throws(()=>f.tracker.receive({context:'',eventId:'bad'}),TypeError);assert.throws(()=>f.tracker.reset(42),TypeError);
});

test('paired local read-start stamps include transport and a 900ms deferred queue before analysis',()=>{
  const f=fixture();
  // The host recorded this pair before executeScript; token registration occurs
  // only after a 60ms round trip. A subsequent clock-boundary deferral is 900ms.
  const readStartedAt=100,readStartedAtWall=1700000000100;f.setTime(160);
  const token=f.tracker.receive(input('queued-packet',{receivedAt:readStartedAt,receivedAtWall:readStartedAtWall}));
  assert.equal(f.stages(token,1060,1067,1070),true);f.frame(1076);f.frame(1092);
  const report=f.tracker.snapshot(),sample=report.samples[0];
  assert.equal(report.completed,1);assert.equal(sample.receivedAt,100);assert.equal(sample.registrationAt,160);assert.equal(sample.receiptTimestampOrigin,'EXPLICIT_PAIRED_LOCAL_BOUNDARY');
  assert.equal(sample.queueMs,60+900);assert.equal(sample.analysisMs,7);assert.equal(sample.receiptToMutationMs,970);
  assert.equal(sample.receiptToPaintOpportunityLowerMs,976);assert.equal(sample.receiptToPaintOpportunityUpperMs,992);
  assert.equal(sample.providerToReceiptAgeMs,null);assert.equal(report.captureToDisplayMeasured,false);assert.equal(report.marketToDisplayMeasured,false);
});

test('partial, future, expired and mismatched local receipt pairs are rejected without changing an active measurement',()=>{
  const f=fixture(),existing=f.tracker.receive(input('valid-before-rejection'));f.setTime(160);
  const before=f.tracker.snapshot();
  const invalid=[
    {receivedAt:100},
    {receivedAtWall:1700000000100},
    {receivedAt:undefined,receivedAtWall:undefined},
    {receivedAt:NaN,receivedAtWall:1700000000100},
    {receivedAt:161,receivedAtWall:1700000000160},
    {receivedAt:100,receivedAtWall:1700000000161},
    {receivedAt:100,receivedAtWall:1700000000000-1},
    {receivedAt:100,receivedAtWall:1700000000100-1312},
  ];
  for(const pair of invalid){
    assert.throws(()=>f.tracker.receive(input('invalid',{context:'other-context',...pair})),TypeError);
    const after=f.tracker.snapshot();assert.equal(after.generation,before.generation);assert.equal(after.received,1);assert.equal(after.pending,1);assert.equal(after.completed,0);assert.equal(after.context,before.context);
  }
  f.stages(existing,162,167,170);f.frame(176);f.frame(192);assert.equal(f.tracker.snapshot().completed,1);
  const expired=fixture({maxDurationMs:20});expired.setTime(160);
  assert.throws(()=>expired.tracker.receive(input('expired',{receivedAt:100,receivedAtWall:1700000000100})),/INVALID_EXPLICIT_RECEIPT_CLOCK_PAIR/);
  assert.equal(expired.tracker.snapshot().received,0);assert.equal(expired.tracker.snapshot().context,null);
});

test('paired local clock tolerance is inclusive, while default receive timestamps remain registration timestamps',()=>{
  const f=fixture();f.setTime(160);
  const token=f.tracker.receive(input('tolerance',{receivedAt:100,receivedAtWall:1700000000000}));
  f.stages(token,162,167,170);f.frame(176);f.frame(192);
  assert.equal(f.tracker.snapshot().samples[0].queueMs,62);
  f.setTime(200);const plain=f.tracker.receive(input('normal'));f.stages(plain,202,207,210);f.frame(216);f.frame(232);
  const sample=f.tracker.snapshot().samples.at(-1);assert.equal(sample.receivedAt,200);assert.equal(sample.registrationAt,200);assert.equal(sample.receiptTimestampOrigin,'LOCAL_REGISTRATION');assert.equal(sample.queueMs,2);
});
