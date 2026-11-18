import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeResearchUpgrade,importPaperResearchComparison} from '../research-upgrades-worker.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {createTradeComparison} from '../research-trade-comparison.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true,...extra});
const metadata={sourceId:'SYNTHETIC_WORKER_COMPONENT_TEST',source:'ohlc',instrument:'SYNTHETIC_DEMO',timeframe:'1m',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'Asia/Jerusalem',session:'synthetic',chartType:'standard'};
const risk={riskBudget:100,pointValue:20,commissionPerContract:0,slippageTicks:0,maxContracts:2,rewardRisk:2};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function fixture(){
  const closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  return [...closes.map((v,i)=>bar(i,v,v+1,v-1,v)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
}
const run=bars=>analyzeGuideSignals(bars,{metadata,risk,asOfTime:bars.at(-1).closeTime});

test('research worker accepts frozen data, emits observation-only results and leaves current signal decisions exactly unchanged',()=>{
  const bars=freeze(fixture()),options=freeze({...metadata}),baseline=run(bars);
  assert.ok(baseline.signals.length>0,'fixture exercises an actual confirmed entry decision');
  const before=JSON.stringify({bars,options});
  const r=analyzeResearchUpgrade({bars,metadata:options,asOfTime:bars.at(-1).closeTime,comparisons:freeze([])});
  assert.equal(r.researchOnly,true);assert.equal(r.orderEligible,false);
  assert.equal(r.candles.status,'OK');assert.equal(r.structure.status,'READY');
  assert.equal(r.sourceId,metadata.sourceId);assert.deepEqual(r.comparisons,[]);
  assert.equal(JSON.stringify({bars,options}),before);
  assert.deepEqual(run(bars),baseline,'research diagnostics cannot mutate or become a new condition of the existing engine');
});

test('worker advances both frozen exit simulations from the same paper fill without claiming real PnL',()=>{
  const bars=fixture(),signal=run(bars).signals[0],entryTime=bars.at(-1).closeTime+1000;
  const fill={fillVerified:true,latestClosedAt:signal.confirmationBarCloseTime,nativeFill:{kind:'NATIVE_EXECUTED_FILL_V1',synthetic:false,testOnly:false,
    provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'COMPONENT_TEST_ONLY',nativeOrderId:'fixture-order',direction:'LONG',price:102,filledAt:entryTime,
    timestampPrecisionMs:1000,orderRow:{symbol:'COMPONENT_TEST_ONLY',qty:'1'}},nativePositionRow:{symbol:'COMPONENT_TEST_ONLY',qty:'1',avgPrice:'102',side:'Long',stopLoss:'101',takeProfit:'103'}};
  const comparison=createTradeComparison({fill,signal,bars,metadata,costs:{commissionPerContract:3.1,slippageTicks:2}});
  assert.ok(comparison);assert.equal(comparison.structural.plan.status,'PLANNED');
  const input=freeze({...{bars:[...bars,bar(27,102,102.5,101.5,102),bar(28,102,103.5,101.5,103),bar(29,103,112,102,111)],metadata},
    asOfTime:start+30*minute,comparisons:[comparison]});
  const r=analyzeResearchUpgrade(input),updated=r.comparisons[0];
  assert.equal(updated.baseline.outcome.status,'TARGET_REACHED');assert.equal(updated.structural.outcome.status,'TARGET_REACHED');
  assert.equal(updated.baseline.outcome.simulated,true);assert.equal(updated.baseline.outcome.fillVerified,false);
  assert.equal(comparison.baseline.outcome.status,'OPEN','input comparison stays frozen');
  assert.equal(r.comparisonSummary.pairedResolved,1);assert.equal(r.comparisonSummary.actualUserPnlComputed,false);
  assert.equal(r.comparisonSummary.sampleStatus,'INSUFFICIENT_SAMPLE');
  const imported=importPaperResearchComparison(freeze({fill,signal,bars:input.bars,metadata,asOfTime:input.asOfTime,
    costs:{commissionPerContract:3.1,slippageTicks:2},provenance:{kind:'IMPORTED_ARROW_PAPER_EXPORT',filename:'controlled-export.json',exportedAt:'2026-01-01T00:30:00Z'}}));
  assert.equal(imported.createdFrom,'IMPORTED_PAPER_EXPORT');
  assert.equal(r.stochastic.status,'READY');
  assert.equal(imported.stochasticAtConfirmation.latest.barCloseTime,signal.confirmationBarCloseTime);
  assert.notEqual(imported.stochasticAtConfirmation.latest.barCloseTime,r.stochastic.latest.barCloseTime);
  assert.equal(imported.importProvenance.filename,'controlled-export.json');
  assert.equal(imported.baseline.outcome.status,'TARGET_REACHED');
  assert.equal(imported.structural.outcome.status,'TARGET_REACHED');
  assert.equal(imported.ordersCreated,false);assert.equal(imported.entryVeto,false);
  assert.equal(imported.entry,comparison.entry);assert.equal(imported.entryTime,comparison.entryTime);
});

test('worker knowledge cutoff excludes future appendix and declared gaps remain visible to both detectors',()=>{
  const bars=fixture(),asOfTime=bars.at(-1).closeTime;
  const base=analyzeResearchUpgrade({bars,metadata,asOfTime});
  const appended=analyzeResearchUpgrade({bars:[...bars,bar(27,102,300,0,200)],metadata,asOfTime});
  assert.deepEqual(appended.candles.patterns,base.candles.patterns);
  assert.deepEqual(appended.structure.events,base.structure.events);
  assert.deepEqual(appended.structure.setups,base.structure.setups);
  const gapBars=fixture();gapBars.splice(8,1);
  const declared={...metadata,sessionGaps:[{from:gapBars[7].time,to:gapBars[8].time,kind:'market_closed'}]};
  const result=analyzeResearchUpgrade({bars:gapBars,metadata:declared,asOfTime});
  assert.deepEqual(result.candles.config.sessionGaps,declared.sessionGaps);
  for(const p of result.candles.patterns)assert.ok(!(p.formationStartTime<=gapBars[7].time&&p.barOpenTime>=gapBars[8].time));
});

test('real historical NQ fixture runs through the worker and leaves legacy analysis byte-equivalent',()=>{
  // Existing native TradingView CSV-derived input; closure times are historical
  // assumptions, not measured live feed receipts or executed trade results.
  const file=new URL('../verification/0.18.0/closest-real-setup-input-part-v5-0.json',import.meta.url);
  const fixture=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(fixture.provenance.kind,'native_tradingview_historical_csv');
  const fixedOptions={...fixture.options,asOfTime:fixture.bars.at(-1).closeTime};
  const before=analyzeGuideSignals(fixture.bars,fixedOptions);
  const payload=freeze({bars:fixture.bars,metadata:{...fixture.options.metadata,sourceId:'HISTORICAL_NATIVE_CSV_FIXTURE'},asOfTime:fixture.bars.at(-1).closeTime,comparisons:[]});
  const result=analyzeResearchUpgrade(payload);
  assert.equal(result.candles.status,'OK');assert.equal(result.structure.status,'READY');
  assert.ok(result.candles.totalDetected>0);assert.equal(result.comparisonSummary.totalRecords,0);
  const after=analyzeGuideSignals(fixture.bars,fixedOptions);
  assert.deepEqual(after,before);
});
