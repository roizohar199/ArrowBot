import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePacketScheduler} from '../live-packet-scheduler.mjs';
import {createLiveOhlcStore} from '../live-ohlc-store.mjs';
const receipt=1794636153099,close=1794636154000,second=1000;
const meta={source:'ohlc',provider:'TradingView Pine Logs',sourceId:'clock-repro',tabId:41,instrument:'BINANCE:BTCUSDT',timeframe:'1S',timeframeMs:second,chartType:'standard',tickSize:.01,pointValue:1,timezone:'UTC',session:'24x7',realtime:true,replay:false};
const bar=(time,closed=true)=>({time,closeTime:time+second,open:100,high:102,low:99,close:101,closed});
const packet=(sequence,kind,bars,receivedAt=receipt)=>({runId:'clock-repro',sequence,kind,sourceEmittedAt:1794636154411,metadata:meta,bars,receivedAt});
const seed=()=>packet(1,'snapshot',[bar(close-4000),bar(close-3000),bar(close-2000)]);
function setup(options={}){let clock=receipt;const queue=createLivePacketScheduler({now:()=>clock,...options});return {queue,setClock:value=>{clock=value;},now:()=>clock};}

test('the measured 901 ms future closed boundary is held without changing receipt or advancing any clock',()=>{
  const f=setup(),store=createLiveOhlcStore({now:f.now});
  assert.equal(f.queue.enqueue(seed()).accepted,true);const baseline=f.queue.drain().ready[0];
  assert.equal(store.ingest(baseline.packet,{intakeAt:baseline.intakeAt}).ready,true);
  const incoming=packet(2,'update',[bar(close-second,true),bar(close,false)]),queued=f.queue.enqueue(incoming);
  assert.equal(queued.deferred,true);assert.equal(queued.futureMs,901);assert.equal(queued.notBefore,close);
  assert.deepEqual(f.queue.drain().ready,[]);assert.equal(store.snapshot().bars.length,3);
  f.setClock(close-1);assert.deepEqual(f.queue.drain().ready,[]);assert.equal(store.snapshot().bars.length,3);
  f.setClock(close);const release=f.queue.drain().ready[0];
  assert.equal(release.packet.receivedAt,receipt);assert.equal(release.intakeAt,close);assert.equal(release.heldMs,901);assert.equal(release.clockAdjusted,false);
  const state=store.ingest(release.packet,{intakeAt:release.intakeAt});
  assert.equal(state.accepted,true);assert.equal(state.ready,true);assert.equal(state.eligibleNewlyClosed.length,1);
  assert.equal(state.bars.at(-1).receivedAt,receipt);assert.equal(state.bars.at(-1).availableAt,close);assert.equal(state.bars.at(-1).knownAt,close);assert.equal(state.lastReceivedAt,receipt);assert.equal(state.lastIntakeAt,close);
});

test('the store remains strict by default and rejects a future intake supplied before the actual receiver clock',()=>{
  const f=setup(),incoming=packet(2,'update',[bar(close-second)]);
  const direct=createLiveOhlcStore({now:f.now});direct.ingest(seed());
  assert.ok(direct.ingest(incoming).reasonCodes.includes('FUTURE_BAR_DATA'));
  const forged=createLiveOhlcStore({now:f.now});forged.ingest(seed());
  assert.ok(forged.ingest(incoming,{intakeAt:close}).reasonCodes.includes('INVALID_INTAKE_TIME'));
  const backward=createLiveOhlcStore({now:f.now});backward.ingest(seed());
  assert.ok(backward.ingest(incoming,{intakeAt:receipt-1}).reasonCodes.includes('INVALID_INTAKE_TIME'));
});

test('an ordinary immediate packet preserves the optional-receipt API even when the clock advances between reads',()=>{
  let clock=receipt;const store=createLiveOhlcStore({now:()=>clock++}),incoming=seed();delete incoming.receivedAt;
  assert.equal(store.ingest(incoming).accepted,true);
});

test('sequence order is preserved when a later ready packet sits behind an earlier future packet',()=>{
  const f=setup();f.queue.enqueue(seed());f.queue.drain();
  f.queue.enqueue(packet(2,'update',[bar(close-second)]));
  f.queue.enqueue(packet(3,'update',[bar(close-2*second)]));
  assert.deepEqual(f.queue.drain().ready,[]);
  f.setClock(close);assert.deepEqual(f.queue.drain().ready.map(item=>item.packet.sequence),[2,3]);
});

test('duplicates never change first receipt and reused sequences with changed OHLC force a fresh baseline',()=>{
  const f=setup();f.queue.enqueue(seed());f.queue.drain();const incoming=packet(2,'update',[bar(close-second)]);
  f.queue.enqueue(incoming);f.setClock(receipt+20);
  const duplicate=f.queue.enqueue({...incoming,receivedAt:receipt+20});assert.equal(duplicate.accepted,false);assert.ok(duplicate.reasonCodes.includes('DUPLICATE_SOURCE_SEQUENCE'));
  f.setClock(close);assert.equal(f.queue.drain().ready[0].receivedAt,receipt);
  const conflict=f.queue.enqueue({...incoming,bars:[{...incoming.bars[0],high:103}],receivedAt:close});
  assert.equal(conflict.requiresSnapshot,true);assert.ok(conflict.reasonCodes.includes('CONFLICTING_SOURCE_SEQUENCE'));
});

test('deferral beyond the 3000 ms bound empties pending work and requires a snapshot',()=>{
  const f=setup();f.queue.enqueue(seed());f.queue.drain();f.queue.enqueue(packet(2,'update',[bar(close-second)]));
  const tooFar=f.queue.enqueue(packet(3,'update',[bar(receipt+3001,false)]));
  assert.equal(tooFar.accepted,false);assert.equal(tooFar.requiresSnapshot,true);assert.equal(tooFar.pending,0);assert.ok(tooFar.reasonCodes.includes('SOURCE_FUTURE_BOUND_EXCEEDED'));
  assert.ok(f.queue.enqueue(packet(4,'update',[bar(close-second)])).reasonCodes.includes('SCHEDULER_SNAPSHOT_REQUIRED'));
});

test('a source switch clears queued closes and cannot release old-run data under a new baseline',()=>{
  const f=setup();f.queue.enqueue(seed());f.queue.drain();f.queue.enqueue(packet(2,'update',[bar(close-second)]));
  const switched=f.queue.enqueue({...seed(),runId:'new-run'});assert.equal(switched.accepted,true);assert.equal(switched.pending,1);
  f.setClock(close);const released=f.queue.drain().ready;assert.equal(released.length,1);assert.equal(released[0].packet.runId,'new-run');
  f.queue.reset('USER_STOPPED');assert.equal(f.queue.snapshot().pending,0);assert.equal(f.queue.snapshot().requiresSnapshot,true);
});

test('queue size, queue age, clock rollback and invalid configuration are bounded explicitly',()=>{
  const f=setup({maxPending:1});f.queue.enqueue(seed());const overflow=f.queue.enqueue(packet(2,'update',[bar(close-second)]));
  assert.ok(overflow.reasonCodes.includes('DEFERRAL_QUEUE_LIMIT'));assert.equal(overflow.pending,0);
  const aged=setup({maxQueuedAgeMs:3000});aged.queue.enqueue(seed());aged.setClock(receipt+3001);
  assert.ok(aged.queue.drain().reasonCodes.includes('DEFERRAL_QUEUE_EXPIRED'));
  const rollback=setup();rollback.queue.enqueue(seed());rollback.setClock(receipt-1);
  assert.ok(rollback.queue.drain().reasonCodes.includes('RECEIVER_CLOCK_WENT_BACKWARD'));
  assert.throws(()=>createLivePacketScheduler({maxDeferralMs:5001}));assert.throws(()=>createLivePacketScheduler({maxPending:0}));
});

test('source emission time does not determine eligibility and queue results cannot mutate retained packets',()=>{
  const f=setup();const input={...seed(),sourceEmittedAt:receipt+1000000000};
  assert.equal(f.queue.enqueue(input).accepted,true);input.bars[0].close=999;
  const release=f.queue.drain().ready[0];assert.equal(release.packet.bars[0].close,101);assert.equal(release.intakeAt,receipt);
});
