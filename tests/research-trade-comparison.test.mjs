import test from 'node:test';
import assert from 'node:assert/strict';
import {planStructuralExit,createTradeComparison,advanceTradeComparison,summarizeTradeComparisons} from '../research-trade-comparison.mjs';

const minute=60000;
const bar=(i,open,high,low,close,extra={})=>({time:i*minute,closeTime:(i+1)*minute,knownAt:(i+1)*minute,closed:true,open,high,low,close,...extra});
const history=()=>[
  bar(0,99,100,98,99),bar(1,100,102,99,101),bar(2,102,106,101,103),
  bar(3,102,104,100,101),bar(4,101,103,99,100),bar(5,100,102,99,100)
];
const metadata={tickSize:.25,pointValue:20,sourceId:'paper-source',instrument:'CME_MINI:NQ1!',timeframe:'1'};
const signal=()=>({eventId:'confirmed-long',direction:'LONG',confirmedAt:6*minute,confirmationBarCloseTime:6*minute,invalidation:94.75});
function filled({stop=98,target=102,entryTime=6*minute+1000,...extra}={}){
  return {fillVerified:true,latestClosedAt:6*minute,
    nativeFill:{kind:'NATIVE_EXECUTED_FILL_V1',provider:'TRADINGVIEW_PAPER',environment:'DEMO',synthetic:false,testOnly:false,nativeAccountId:'paper-account',nativeOrderId:'entry-1',price:100,filledAt:entryTime,direction:'LONG',timestampPrecisionMs:1000,
      orderRow:{symbol:'CME_MINI:NQZ2026',qty:'1'}},
    nativePositionRow:{symbol:'CME_MINI:NQZ2026',qty:'1',avgPrice:'100',side:'Long',stopLoss:String(stop),takeProfit:String(target)},...extra};
}
const comparison=(options={})=>createTradeComparison({fill:filled(options),signal:signal(),bars:history(),metadata,costs:options.costs??{}});
const entryBar=()=>bar(6,100,101,99,100.25);

test('structural plan freezes signal invalidation without a second buffer and selects one tick before known unbroken pivot',()=>{
  const plan=planStructuralExit({signal:signal(),bars:history(),entry:100,entryTime:6*minute+1000,tickSize:.25,pointValue:20});
  assert.equal(plan.status,'PLANNED');assert.equal(plan.stop,94.75);assert.equal(plan.target,105.75);
  assert.equal(plan.targetEvidence.time,2*minute);assert.equal(plan.targetEvidence.knownAt,5*minute);
  assert.equal(plan.entryVeto,false);assert.equal(plan.orderEligible,false);assert.equal(plan.riskPerContract,105);
  const future=[...history(),bar(6,100,120,99,119),bar(7,119,121,118,120)];
  assert.deepEqual(planStructuralExit({signal:signal(),bars:future,entry:100,entryTime:6*minute+1000,tickSize:.25,pointValue:20}),plan);
});

test('future pivot, already broken obstacle, invalid stop and signal learned after entry never manufacture a plan',()=>{
  const input={signal:signal(),bars:history(),entry:100,entryTime:6*minute+1000,tickSize:.25};
  assert.equal(planStructuralExit({...input,signal:{...signal(),confirmedAt:7*minute}}).reasonCodes[0],'SIGNAL_NOT_KNOWN_AT_ENTRY');
  assert.equal(planStructuralExit({...input,signal:{...signal(),invalidation:101}}).reasonCodes[0],'STRUCTURAL_STOP_NOT_PROTECTIVE');
  const broken=[...history(),bar(6,100,107,99,100)];
  assert.equal(planStructuralExit({...input,bars:broken,entryTime:7*minute+1000}).reasonCodes[0],'NO_KNOWN_UNBROKEN_TARGET');
  assert.equal(planStructuralExit({...input,bars:history().slice(0,4)}).status,'UNAVAILABLE');
  assert.equal(planStructuralExit({...input,signal:{...signal(),invalidation:-1e30}}).reasonCodes[0],'UNSAFE_STRUCTURAL_PRICE_COORDINATES');
});

test('short prices mirror the long plan and stop rounding always remains on the protective side',()=>{
  const mirrored=history().map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));
  const plan=planStructuralExit({signal:{...signal(),direction:'SHORT',invalidation:105.25},bars:mirrored,entry:100,entryTime:6*minute+1000,tickSize:.25});
  assert.equal(plan.status,'PLANNED');assert.equal(plan.stop,105.25);assert.equal(plan.target,94.25);
  const rounded=planStructuralExit({signal:{...signal(),invalidation:94.8},bars:history(),entry:100,entryTime:6*minute+1000,tickSize:.25});
  assert.equal(rounded.stop,94.75);
});

test('comparison requires verified paper native fills bound to this signal and labels baseline bracket provenance',()=>{
  const r=comparison();assert.ok(r);assert.equal(r.baseline.plan.stop,98);assert.equal(r.structural.plan.stop,94.75);
  assert.equal(r.baseline.plan.basis,'NATIVE_POSITION_LEVELS_OBSERVED_AFTER_FILL');assert.equal(r.priceBasisAlignmentVerified,false);
  assert.equal(r.costs,null,'unknown costs cannot be silently assigned zero');
  for(const patch of [{fillVerified:false},{latestClosedAt:5*minute}])assert.equal(createTradeComparison({fill:filled(patch),signal:signal(),bars:history(),metadata}),null);
  const invalid=filled();invalid.nativeFill.provider='TRADOVATE';assert.equal(createTradeComparison({fill:invalid,signal:signal(),bars:history(),metadata}),null);
  const fraction=filled();fraction.nativeFill.orderRow.qty='1.5';assert.equal(createTradeComparison({fill:fraction,signal:signal(),bars:history(),metadata}),null);
  const mismatch=filled();mismatch.nativePositionRow.symbol='CME_MINI:MNQZ2026';
  const unobserved=createTradeComparison({fill:mismatch,signal:signal(),bars:history(),metadata});assert.equal(unobserved.baseline.plan.status,'UNAVAILABLE');
});

test('both frozen exits share the actual same entry; repeated closed history is idempotent and never changes the input record',()=>{
  const initial=comparison(),bars=[entryBar(),bar(7,100.25,103,99.5,102.5),bar(8,102.5,106,100,105)];
  const done=advanceTradeComparison(initial,bars,{metadata,asOfTime:9*minute});
  assert.equal(initial.baseline.outcome.status,'OPEN');assert.equal(done.baseline.outcome.status,'TARGET_REACHED');assert.equal(done.structural.outcome.status,'TARGET_REACHED');
  assert.equal(done.baseline.outcome.exitPrice,102);assert.equal(done.structural.outcome.exitPrice,105.75);
  assert.equal(done.baseline.outcome.grossPnl,40);assert.equal(done.structural.outcome.grossPnl,115);
  assert.equal(done.baseline.outcome.netPnl,null);assert.equal(done.baseline.outcome.fillVerified,false);
  assert.deepEqual(advanceTradeComparison(done,bars,{metadata,asOfTime:9*minute}),done);
  assert.equal(done.structural.mfePoints,3,'exit bar extrema are excluded because their ordering after exit is unknown');
  assert.equal(done.baseline.mfePoints,0);
});

test('partial entry-bar touches and co-touched levels remain uncertain rather than fabricated fills',()=>{
  const entryHit=advanceTradeComparison(comparison(),[bar(6,100,103,97,100)],{asOfTime:7*minute});
  assert.equal(entryHit.baseline.outcome.status,'ENTRY_BAR_UNCERTAIN');assert.equal(entryHit.baseline.outcome.netPnl,null);
  const both=advanceTradeComparison(comparison(),[entryBar(),bar(7,100,103,97,100)],{asOfTime:8*minute});
  assert.equal(both.baseline.outcome.status,'AMBIGUOUS');assert.equal(both.baseline.outcome.exitPrice,null);
  assert.equal(summarizeTradeComparisons([both]).pairedResolved,0);
  const exact=advanceTradeComparison(comparison({entryTime:6*minute}),[bar(6,100,103,99,102)],{asOfTime:7*minute});
  assert.equal(exact.baseline.outcome.status,'ENTRY_BAR_UNCERTAIN','one-second native timestamp precision still allows subsecond entry uncertainty at minute open');
});

test('future closed candles and delayed availability cannot resolve outcomes before their knowledge time',()=>{
  const b=bar(7,100,103,99,102,{knownAt:9*minute}),bars=[entryBar(),b];
  const before=advanceTradeComparison(comparison(),bars,{asOfTime:8*minute});assert.equal(before.baseline.outcome.status,'OPEN');assert.equal(before.observedBars.length,1);
  const after=advanceTradeComparison(before,bars,{asOfTime:9*minute});assert.equal(after.baseline.outcome.status,'TARGET_REACHED');
  const prefix=advanceTradeComparison(comparison(),[entryBar()],{asOfTime:8*minute});assert.deepEqual(before,prefix);
});

test('stop gaps use worse opening price and explicit round-trip costs; a favorable target gap assumes only limit target',()=>{
  const costs={commissionPerContract:3.1,slippageTicks:1};
  const stopped=advanceTradeComparison(comparison({costs}),[entryBar(),bar(7,97,99,96,98)],{asOfTime:8*minute});
  assert.equal(stopped.baseline.outcome.exitPrice,97);assert.equal(stopped.baseline.outcome.grossPnl,-60);assert.equal(stopped.baseline.outcome.netPnl,-68.1);
  const target=advanceTradeComparison(comparison(),[entryBar(),bar(7,103,104,102,103)],{asOfTime:8*minute});
  assert.equal(target.baseline.outcome.exitPrice,102,'do not inflate a limit-target simulation using a favorable opening gap');
});

test('missing intervals, overlapping bars, invalid availability and nonstandard chart bars cannot become simulated results',()=>{
  const missing=advanceTradeComparison(comparison(),[bar(7,100,103,99,102)],{asOfTime:8*minute});assert.equal(missing.baseline.outcome.status,'DATA_GAP');
  const active=advanceTradeComparison(comparison(),[entryBar()],{asOfTime:7*minute});
  for(const bad of [bar(7,100,103,99,102,{time:6.5*minute}),bar(7,100,103,99,102,{knownAt:7*minute}),bar(7,100,103,99,102,{chartType:'heikin_ashi'})]){
    const r=advanceTradeComparison(active,[bad],{asOfTime:9*minute});assert.equal(r.baseline.outcome.status,'INVALID_DATA');
  }
  assert.deepEqual(advanceTradeComparison(active,[bar(7,100,103,99,102)],{metadata:{...metadata,sourceId:'other'}}),active);
});

test('paired summary uses the same resolved sample and net wins/losses when explicit costs turn a gross winner into a loser',()=>{
  const costs={commissionPerContract:3.1,slippageTicks:1},initial=comparison({target:100.25,costs});
  const r=advanceTradeComparison(initial,[bar(6,100,100,99.5,99.75),bar(7,99.75,100.25,99.5,100),bar(8,100,106,99,105)],{asOfTime:9*minute});
  const summary=summarizeTradeComparisons([r,comparison({target:110})]);
  assert.equal(summary.totalRecords,2);assert.equal(summary.pairedResolved,1);assert.equal(summary.excluded,1);
  assert.equal(summary.baseline.grossPnl,5);assert.ok(Math.abs(summary.baseline.netPnl+3.1)<1e-10);
  assert.equal(summary.baseline.wins,0);assert.equal(summary.baseline.winLossBasis,'NET');assert.ok(summary.baseline.meanLoss<0);
  assert.equal(summary.structural.wins,1);assert.equal(summary.actualUserPnlComputed,false);assert.equal(summary.sampleStatus,'INSUFFICIENT_SAMPLE');
});
