import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResearchStructure,RESEARCH_STRUCTURE_PROFILE} from '../research-market-structure.mjs';

const minute=60000,options={tickSize:.25,pivotLeft:1,pivotRight:1,atrPeriod:3};
const bar=(i,open,high,low,close,extra={})=>({time:i*minute,closeTime:(i+1)*minute,knownAt:(i+1)*minute,closed:true,open,high,low,close,...extra});
const fixture=()=>[
  bar(0,100,101,99,100),bar(1,100,100.5,98,99),bar(2,99,102,99,101),
  bar(3,101,101.5,99,100),bar(4,100,101,99.5,100),bar(5,100,100.5,97,99.5),
  bar(6,99.5,105,99,104.5),bar(7,104.5,106,103,105),bar(8,104,104.5,102.5,104.25)
];
const mirror=bars=>bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
const setup=r=>r.setups.find(s=>s.direction==='LONG'&&s.sweepTime===5*minute);

test('closed sweep freezes already known pivots; MSS and later FVG reclaim are distinct causal stages',()=>{
  const bars=fixture(),r=analyzeResearchStructure(bars,options),s=setup(r);
  assert.equal(r.profileId,RESEARCH_STRUCTURE_PROFILE);assert.equal(r.status,'READY');assert.equal(s.state,'RESEARCH_CONFIRMED');
  assert.equal(s.liquidityPivot.price,98);assert.equal(s.structurePivot.price,102);assert.ok(s.structurePivot.knownAt<=bars[5].time);
  assert.equal(s.mssTrigger,102.25);assert.equal(s.structuralInvalidation,96.75);
  assert.deepEqual({lower:s.fvg.lower,upper:s.fvg.upper},{lower:100.5,upper:103});
  assert.equal(s.fvg.knownAt,bars[7].knownAt);assert.equal(s.confirmedAt,bars[8].knownAt);
  assert.deepEqual(r.events.filter(e=>e.setupId===s.setupId).map(e=>e.state),['WAIT_MSS','WAIT_FVG','WAIT_RETEST','RESEARCH_CONFIRMED']);
  assert.equal(r.orderEligible,false);assert.equal(r.signalApproved,false);assert.equal(r.ordersCreated,false);
});

test('short is the exact price reflection with protective stop and reclaim in the other direction',()=>{
  const r=analyzeResearchStructure(mirror(fixture()),options),s=r.setups.find(s=>s.direction==='SHORT'&&s.sweepTime===5*minute);
  assert.equal(s.state,'RESEARCH_CONFIRMED');assert.equal(s.mssTrigger,97.75);assert.equal(s.structuralInvalidation,103.25);
  assert.equal(s.fvg.lower,97);assert.equal(s.fvg.upper,99.5);
});

test('the FVG creation candle cannot be counted as its own later retest',()=>{
  const bars=fixture().slice(0,8),r=analyzeResearchStructure(bars,options),s=setup(r);
  assert.equal(s.state,'WAIT_RETEST');assert.equal(r.stats.retests,0);assert.equal(s.confirmedAt,undefined);
});

test('knowledge cutoffs and future extension do not rewrite previously emitted transition records',()=>{
  const bars=fixture(),prefix=analyzeResearchStructure(bars.slice(0,7),options),at=analyzeResearchStructure(bars,{...options,asOfTime:bars[6].knownAt});
  assert.deepEqual(at.events,prefix.events);assert.deepEqual(at.setups,prefix.setups);assert.equal(at.excludedFutureBars,2);
  const full=analyzeResearchStructure(bars,options);assert.deepEqual(full.events.filter(e=>e.knownAt<=bars[6].knownAt),prefix.events);
});

test('sweep extreme invalidation takes priority over an otherwise valid retest in the same OHLC candle',()=>{
  const bars=fixture();bars[8]=bar(8,104,105,96.75,104.5);
  const s=setup(analyzeResearchStructure(bars,options));assert.equal(s.state,'INVALIDATED');assert.equal(s.confirmedAt,undefined);
  assert.equal(s.lastReasonCode,'SWEEP_EXTREME_INVALIDATED_BEFORE_CONFIRMATION');
});

test('a future pivot cannot qualify a historical sweep and frozen references stay fixed',()=>{
  const bars=fixture(),r=analyzeResearchStructure(bars,options),s=setup(r);
  assert.equal(s.liquidityPivot.time,minute);assert.ok(r.pivots.some(p=>p.type==='LOW'&&p.time===5*minute));
  assert.notEqual(s.liquidityPivot.time,5*minute,'the sweep low only becomes a pivot after the MSS candle closes');
  const early=analyzeResearchStructure(bars.slice(0,3),options);assert.equal(early.setups.length,0);
});

test('a later gap cannot be substituted for the strict MSS-middle FVG profile',()=>{
  const bars=fixture();bars[7]=bar(7,104.5,106,100.5,105);
  assert.equal(setup(analyzeResearchStructure(bars,options)).state,'EXPIRED');
  assert.equal(setup(analyzeResearchStructure(bars,options)).lastReasonCode,'MSS_MIDDLE_FVG_NOT_COMPLETED');
});

test('MSS and retest windows expire instead of waiting forever, and repeat sweeps reuse no consumed pivot',()=>{
  const bars=fixture().slice(0,6);
  for(let i=6;i<12;i++)bars.push(bar(i,99,101,98.25,99));
  const r=analyzeResearchStructure(bars,options),s=setup(r);assert.equal(s.state,'EXPIRED');assert.equal(s.lastReasonCode,'MSS_WINDOW_EXPIRED');
  const retest=fixture().slice(0,8);for(let i=8;i<19;i++)retest.push(bar(i,105,106,104,105));
  const expired=setup(analyzeResearchStructure(retest,options));assert.equal(expired.state,'EXPIRED');assert.equal(expired.lastReasonCode,'RETEST_WINDOW_EXPIRED');
  const repeat=fixture().slice(0,6);repeat.push(bar(6,100,101,97.25,99.5));
  assert.equal(analyzeResearchStructure(repeat,options).setups.filter(x=>x.direction==='LONG'&&x.liquidityPivot.time===minute).length,1);
});

test('open, missing, off-tick and nonstandard data fail closed; declared sessions cannot form cross-session FVG',()=>{
  const bars=fixture();
  assert.ok(analyzeResearchStructure(bars,{...options,unexpected:true}).reasonCodes.includes('INVALID_RESEARCH_STRUCTURE_CONFIGURATION'));
  assert.ok(analyzeResearchStructure(bars.map((b,i)=>i===8?{...b,closed:false}:b),options).reasonCodes.includes('OPEN_BAR'));
  assert.ok(analyzeResearchStructure(bars.filter((_,i)=>i!==7),options).reasonCodes.includes('DATA_GAP'));
  assert.ok(analyzeResearchStructure(bars.map((b,i)=>i===8?{...b,close:104.26}:b),options).reasonCodes.includes('RESEARCH_PRICE_OFF_TICK'));
  assert.ok(analyzeResearchStructure(bars.map((b,i)=>i===8?{...b,chartType:'heikin_ashi'}:b),options).reasonCodes.includes('NONSTANDARD_CHART'));
  const gap=bars.map((b,i)=>i>=7?{...b,time:b.time+minute,closeTime:b.closeTime+minute,knownAt:b.knownAt+minute}:b);
  const r=analyzeResearchStructure(gap,{...options,sessionGaps:[{from:7*minute,to:8*minute,kind:'market_closed'}]});
  assert.equal(setup(r).state,'EXPIRED');assert.equal(setup(r).lastReasonCode,'SESSION_BOUNDARY_RESETS_RESEARCH_SETUP');assert.equal(r.stats.fvg,0);
});

test('zero range cannot be displacement and ATR requires the documented prior-close warmup',()=>{
  const bars=fixture();bars[6]=bar(6,104,104,104,104);
  assert.equal(setup(analyzeResearchStructure(bars,options)).state,'WAIT_MSS');
  assert.equal(setup(analyzeResearchStructure(fixture(),{...options,atrPeriod:14})).state,'WAIT_MSS');
});
