import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResearchStochastic} from '../research-stochastic.mjs';

const minute=60_000;
const bar=(i,extra={})=>({time:i*minute,closeTime:(i+1)*minute,closed:true,open:101,high:110,low:100,close:101,...extra});
const inspect=(bars,asOfTime=bars.at(-1).closeTime,sessionGaps=[])=>analyzeResearchStochastic(bars,{asOfTime,sessionGaps,timeframeMs:minute});
const history=Array.from({length:16},(_,index)=>bar(index));

test('12/3/3 needs 16 closed bars and reports a cross only on the bar that crossed',()=>{
  assert.equal(inspect(history.slice(0,-1)).reason,'WARMUP_REQUIRED');
  assert.deepEqual(inspect(history).latest,{k:10,d:10,zone:'LOW',cross:null,barCloseTime:16*minute,knownAt:16*minute});
  const crossed=[...history,bar(16,{close:104})];
  const result=inspect(crossed);
  assert.equal(result.latest.k,20);
  assert.ok(Math.abs(result.latest.d-40/3)<1e-10);
  assert.equal(result.latest.zone,'LOW');
  assert.equal(result.latest.cross,'UP');
  assert.equal(inspect([...crossed,bar(17,{close:104})]).latest.cross,null);
  assert.equal(result.orderEligible,false);
});

test('open and late candles cannot change the current reading before they are available',()=>{
  const next=bar(16,{close:109,knownAt:18*minute});
  const reference=inspect(history);
  assert.deepEqual(inspect([...history,next],next.closeTime),reference);
  assert.deepEqual(inspect([...history,{...next,closed:false}],16*minute+1000),reference);
  assert.equal(inspect([...history,next],18*minute).latest.knownAt,18*minute);
});

test('flat ranges are unavailable and a session gap restarts smoothing',()=>{
  const flat=history.map(row=>({...row,open:100,high:100,low:100,close:100}));
  assert.equal(inspect(flat).reason,'FLAT_RANGE');
  const separated=[...history,bar(18)];
  assert.equal(inspect(separated).reason,'DATA_GAP');
  assert.equal(inspect(separated,19*minute,[{from:16*minute,to:18*minute,kind:'market_closed'}]).reason,'WARMUP_REQUIRED');
});
