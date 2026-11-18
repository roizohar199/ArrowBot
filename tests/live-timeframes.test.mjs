import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTimeframes,DEFAULT_LIVE_HIGHER_TIMEFRAMES} from '../live-timeframes.mjs';
import {parsePineOhlcMessage} from '../pine-ohlc-protocol.mjs';

const at=Date.UTC(2026,0,1),sourceAt=at+40*900000;
const meta={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
const rows=(tf,count=20,start=0)=>Array.from({length:count},(_,index)=>{const n=index+start,duration=Number(tf)*60000;return {time:at+n*duration,closeTime:at+(n+1)*duration,open:20000+n,high:20002+n,low:19999+n,close:20001+n,volume:100+n,closed:true,sourceClosed:true};});
const packet=(tf='5',{kind='timeframe_snapshot',sequence=1,bars=rows(tf),sourceEmittedAt=sourceAt,metadata=meta,runId='run',...rest}={})=>({schemaVersion:1,kind,runId,sequence,sourceEmittedAt,realtime:true,dataDelayUnverified:true,metadata:structuredClone(metadata),bars:[],higherTimeframes:[{timeframe:tf,timeframeMs:Number(tf)*60000,bars,reasonCodes:[]}],reasonCodes:[],receivedAt:sourceEmittedAt+100,...rest});
const readyManager=()=>{const manager=createLiveTimeframes();manager.ingest(packet('5'));manager.ingest(packet('15',{sequence:2}));return manager;};

test('legacy base-only sources cannot silently substitute for any required higher timeframe',()=>{
  const manager=createLiveTimeframes(),base=packet();delete base.higherTimeframes;base.kind='snapshot';
  const state=manager.ingest(base);assert.equal(state.ok,true);assert.equal(state.ready,false);assert.deepEqual(Object.keys(state.higherTimeframes),[...DEFAULT_LIVE_HIGHER_TIMEFRAMES]);
  assert.ok(Object.values(state.higherTimeframes).every(entry=>entry.bars.length===0));
  const one=manager.ingest(packet('5',{sequence:2}));assert.equal(one.ready,false);assert.equal(one.series[0].ready,true);assert.equal(one.series[1].ready,false);
});

test('provider bars, currency and volume remain exact, and availability starts at first receiver observation',()=>{
  const manager=createLiveTimeframes(),observed=sourceAt+5000;
  const raw=packet('5'),parsed=parsePineOhlcMessage('ARROW_OHLC_V1 '+JSON.stringify(raw),{receivedAt:observed+100,tabId:7});assert.equal(parsed.ok,false,'receipt-only extra top-level key is not a source field');
  delete raw.receivedAt;const normalized=parsePineOhlcMessage('ARROW_OHLC_V1 '+JSON.stringify(raw),{receivedAt:observed+100,tabId:7});assert.equal(normalized.ok,true);
  const state=manager.ingest(normalized.packet,{observedAsOfTime:observed});
  const higher=state.higherTimeframes['5'];assert.equal(higher.metadata.currency,'USD');assert.equal(higher.metadata.timeframe,'5');assert.equal(higher.metadata.instrument,meta.instrument);assert.equal(higher.bars.length,20);
  for(let i=0;i<higher.bars.length;i++){for(const key of ['time','closeTime','open','high','low','close','volume'])assert.equal(higher.bars[i][key],raw.higherTimeframes[0].bars[i][key]);assert.equal(higher.bars[i].knownAt,observed);}
  assert.equal(manager.snapshot({asOfTime:observed-1}).higherTimeframes['5'].bars.length,0,'old source logs first seen now cannot alter earlier decisions');
});

test('all required series become ready only with their own complete warmup, without copying base prices',()=>{
  const manager=readyManager(),state=manager.snapshot({asOfTime:sourceAt});assert.equal(state.ready,true);
  assert.equal(state.higherTimeframes['5'].timeframeMs,300000);assert.equal(state.higherTimeframes['15'].timeframeMs,900000);
  assert.ok(state.series.every(entry=>entry.closedBars===20&&entry.volumeAvailable));
  const small=createLiveTimeframes();small.ingest(packet('5',{bars:rows('5',19)}));small.ingest(packet('15',{sequence:2}));assert.equal(small.snapshot().ready,false);assert.equal(small.snapshot().higherTimeframes['5'].bars.length,0);
});

test('healthy periodic snapshots and repeated finals preserve original causal availability',()=>{
  const manager=readyManager(),first=manager.snapshot({asOfTime:sourceAt}).higherTimeframes['5'].bars;
  manager.ingest(packet('5',{sequence:3,sourceEmittedAt:sourceAt+10000}),{observedAsOfTime:sourceAt+10050});
  assert.deepEqual(manager.snapshot().higherTimeframes['5'].bars,first);
  manager.ingest(packet('5',{kind:'timeframe_update',sequence:4,bars:rows('5',1,19),sourceEmittedAt:sourceAt+11000}));
  assert.deepEqual(manager.snapshot().higherTimeframes['5'].bars,first);
  const duplicate=manager.ingest(packet('5',{sequence:3,sourceEmittedAt:sourceAt+10000}));assert.equal(duplicate.accepted,false);
});

test('closed correction invalidates a series until an explicit recovery snapshot supplies a new baseline',()=>{
  const manager=readyManager(),changed=rows('5',1,19);changed[0].close+=.25;
  const result=manager.ingest(packet('5',{kind:'timeframe_update',sequence:3,bars:changed,sourceEmittedAt:sourceAt+1000}));
  assert.equal(result.ready,false);assert.equal(result.higherTimeframes['5'].bars.length,0);assert.ok(result.ingestReasonCodes.includes('HIGHER_TIMEFRAME_CLOSED_BAR_CORRECTION'));
  assert.equal(manager.ingest(packet('5',{kind:'timeframe_update',sequence:4,bars:rows('5',1,20),sourceEmittedAt:sourceAt+2000})).ready,false);
  const recovery=rows('5');recovery[19].close+=.25;
  const recovered=manager.ingest(packet('5',{sequence:5,bars:recovery,sourceEmittedAt:sourceAt+3000}));assert.equal(recovered.ready,true);
  assert.ok(recovered.higherTimeframes['5'].bars.every(bar=>bar.knownAt===sourceAt+3000));
});

test('missing provider buckets block updates, and recovery keeps only the contiguous suffix after an unexplained gap',()=>{
  const manager=readyManager(),missed=manager.ingest(packet('5',{kind:'timeframe_update',sequence:3,bars:rows('5',1,21),sourceEmittedAt:sourceAt+1000}));
  assert.equal(missed.ready,false);assert.ok(missed.ingestReasonCodes.includes('HIGHER_TIMEFRAME_DATA_GAP'));
  const recovery=[...rows('5',20),...rows('5',20,21)];
  const recovered=manager.ingest(packet('5',{sequence:4,bars:recovery,sourceEmittedAt:sourceAt+2000}));assert.equal(recovered.ready,true);
  assert.equal(recovered.higherTimeframes['5'].bars.length,20);assert.equal(recovered.higherTimeframes['5'].bars[0].time,at+21*300000);
  assert.deepEqual(recovered.higherTimeframes['5'].metadata.sessionGaps,[]);assert.ok(recovered.series[0].reasonCodes.includes('HIGHER_TIMEFRAME_WARMUP_TRIMMED_AT_GAP'));
});

test('open, future, invalid volume and clock-regressed HTF packets never supply signal context',()=>{
  for(const mutate of [bar=>bar.closed=false,bar=>bar.sourceClosed=false,bar=>bar.volume=-1,bar=>bar.closeTime+=1,bar=>bar.high=0]){
    const manager=readyManager(),invalid=rows('5',1,20);mutate(invalid[0]);
    const result=manager.ingest(packet('5',{kind:'timeframe_update',sequence:3,bars:invalid,sourceEmittedAt:sourceAt+1000}));assert.equal(result.ready,false);assert.equal(result.higherTimeframes['5'].bars.length,0);
  }
  const future=createLiveTimeframes();assert.equal(future.ingest(packet('5',{sourceEmittedAt:at+1000})).ok,false);
  const manager=readyManager(),regressed=manager.ingest(packet('5',{sequence:3,sourceEmittedAt:sourceAt-1000}));assert.equal(regressed.ready,false);assert.ok(regressed.ingestReasonCodes.includes('HIGHER_TIMEFRAME_CLOCK_REGRESSION'));
});

test('source changes and reset clear both series; base intervals equal to a configured HTF remain explicitly blocked',()=>{
  const manager=readyManager(),changed=manager.ingest(packet('5',{sequence:3,runId:'new-run'}));assert.equal(changed.ready,false);assert.equal(changed.higherTimeframes['15'].bars.length,0);
  manager.reset('RECONNECT_SNAPSHOT_REQUIRED');assert.equal(manager.snapshot().ready,false);assert.ok(manager.snapshot().series.every(entry=>entry.closedBars===0));
  const large=createLiveTimeframes(),state=large.ingest(packet('5',{metadata:{...meta,timeframe:'5',timeframeMs:300000}}));assert.equal(state.ready,false);assert.ok(state.reasonCodes.includes('HIGHER_TIMEFRAME_MUST_EXCEED_BASE:5'));
});

test('late older warmup never backdates knownAt and every exposed series has nondecreasing availability',()=>{
  const manager=createLiveTimeframes({timeframes:['5'],minBars:1});
  manager.ingest(packet('5',{bars:rows('5',2,18)}));
  const state=manager.ingest(packet('5',{sequence:2,sourceEmittedAt:sourceAt+1000,bars:rows('5')}));
  const bars=state.higherTimeframes['5'].bars;assert.equal(bars.length,20);assert.ok(bars.every((bar,index)=>bar.knownAt>=sourceAt+1000&&(index===0||bar.knownAt>=bars[index-1].knownAt)));
  assert.equal(manager.snapshot({asOfTime:sourceAt}).higherTimeframes['5'].bars.length,0);
});

test('missing volume stays missing and a retained bar limit remains bounded',()=>{
  const manager=createLiveTimeframes({timeframes:['5'],maxBars:20,minBars:1}),first=rows('5');delete first[0].volume;first[1].volume=null;
  const state=manager.ingest(packet('5',{bars:first}));assert.equal(state.series[0].volumeAvailable,false);assert.equal(state.higherTimeframes['5'].bars[0].volume,undefined);assert.equal(state.higherTimeframes['5'].bars[1].volume,null);
  const next=manager.ingest(packet('5',{kind:'timeframe_update',sequence:2,bars:rows('5',1,20),sourceEmittedAt:sourceAt+1000}));assert.equal(next.higherTimeframes['5'].bars.length,20);assert.equal(next.higherTimeframes['5'].bars[0].time,at+300000);
});

test('summary and includeBars:false omit engine inputs while retaining statuses without cloning bar histories',()=>{
  const manager=readyManager(),full=manager.snapshot(),summary=manager.summary();assert.equal(summary.ready,true);assert.deepEqual(summary.series,full.series);assert.equal(Object.hasOwn(summary,'higherTimeframes'),false);
  assert.deepEqual(manager.snapshot({includeBars:false}),summary);
  const ingested=manager.ingest(packet('5',{sequence:3}),{includeBars:false});assert.equal(ingested.ready,true);assert.equal(Object.hasOwn(ingested,'higherTimeframes'),false);
  summary.series[0].reasonCodes.push('MUTATED');assert.ok(!manager.summary().series[0].reasonCodes.includes('MUTATED'));
  assert.equal(manager.summary({asOfTime:sourceAt-1}).ready,false);
  for(const includeBars of [0,null,'false']){assert.throws(()=>manager.snapshot({includeBars}),/INVALID_LIVE_TIMEFRAME_INCLUDE_BARS/);assert.throws(()=>manager.ingest(packet(),{includeBars}),/INVALID_LIVE_TIMEFRAME_INCLUDE_BARS/);}
});
