// FULL unchanged engine reachability, with explicitly artificial OHLC.
// This is never a native market source or a fixture to load into TradingView.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {normalizeReplayDataset} from '../replay-research.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
const checkIds=['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME'];
const current=a=>a.signals.filter(s=>s.confirmationBarCloseTime===a.asOfTime);

test('unchanged complete engine can jointly CONFIRM all seven mandatory contexts and one-contract cost-inclusive risk',()=>{
  const a=analyzeGuideSignals(fixture.bars,fixture.options),signals=current(a);assert.equal(signals.length,1);const s=signals[0];
  assert.equal(s.status,'CONFIRMED');assert.equal(s.direction,'LONG');assert.equal(s.signalIndex,427);assert.equal(s.confirmationIndex,428);
  assert.equal(s.contextSnapshot.passed,true);assert.equal(s.contextSnapshot.conditionsMet,7);
  for(const id of checkIds){const c=s.contextSnapshot.checks.find(c=>c.id===id);assert.ok(c);assert.ok(c.required&&c.enabled&&c.available&&c.passed);assert.equal(c.state,'PASS');}
  assert.equal(s.parameterSnapshot.contextConfig.trendlineMinTouches,3);assert.equal(s.parameterSnapshot.contextConfig.roleReversalEnabled,true);assert.equal(s.parameterSnapshot.contextConfig.supplyDemandEnabled,true);
  assert.equal(s.riskPlan.quantity,1);assert.equal(s.riskPlan.totalPlannedRisk,98.1);assert.equal(s.riskPlan.initialStop,28333.75);assert.equal(s.riskPlan.riskTicks,17);assert.equal(s.riskPlan.commissionAllowance,3.1);assert.equal(s.riskPlan.slippageAllowance,10);
  assert.equal(s.orderEligible,false);assert.equal(s.metadata,undefined);assert.equal(a.metadata.synthetic,true);assert.equal(a.metadata.testOnly,true);
  const line=s.contextSnapshot.context.trendlines.find(l=>l.active&&l.type==='SUPPORT'&&l.touches===3);assert.ok(line);assert.ok(line.thirdTouchKnownAt<=s.formationStartTime);
});

test('symmetric artificial SHORT prices also pass all actual engine computations without injected PASS rows',()=>{
  const f=structuredClone(fixture),mirror=b=>({...b,open:56676-b.open,high:56676-b.low,low:56676-b.high,close:56676-b.close});f.bars=f.bars.map(mirror);for(const h of Object.values(f.options.higherTimeframes))h.bars=h.bars.map(mirror);
  const a=analyzeGuideSignals(f.bars,f.options),signals=current(a);assert.equal(signals.length,1);assert.equal(signals[0].direction,'SHORT');assert.equal(signals[0].riskPlan.quantity,1);assert.equal(signals[0].riskPlan.totalPlannedRisk,98.1);assert.ok(signals[0].contextSnapshot.checks.every(c=>c.required&&c.passed&&c.state==='PASS'));
});

test('real later-close, third-touch and original stop-budget gates independently reject altered artificial cases',()=>{
  const f=structuredClone(fixture),before=analyzeGuideSignals(f.bars.slice(0,-1),{...f.options,asOfTime:f.bars.at(-2).closeTime});assert.equal(current(before).length,0);assert.equal(before.events.find(e=>e.signalIndex===427&&e.setupId==='TREND_CONTINUATION').status,'ARMED');
  const open=structuredClone(f);open.bars.at(-1).closed=false;assert.equal(current(analyzeGuideSignals(open.bars,open.options)).length,0);
  const noTouch=structuredClone(f);noTouch.bars[381].low=28286;const rejected=analyzeGuideSignals(noTouch.bars,noTouch.options),event=rejected.events.find(e=>e.signalIndex===427&&e.setupId==='TREND_CONTINUATION');assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('MISSING_TRENDLINE'));assert.equal(current(rejected).length,0);
  const wide=structuredClone(f);Object.assign(wide.bars.at(-1),{high:28345,close:28344});const blocked=analyzeGuideSignals(wide.bars,wide.options).events.find(e=>e.signalIndex===427&&e.setupId==='TREND_CONTINUATION');assert.equal(blocked.status,'REJECTED');assert.ok(blocked.reasonCodes.includes('RISK_REJECTED'));assert.equal(blocked.riskPlan.initialStop,28333.75);assert.equal(blocked.riskPlan.perContractRisk,218.1);assert.equal(blocked.riskPlan.quantity,0);
});

test('full-engine synthetic reachability fixture is explicitly rejected by the actual native Replay dataset loader',()=>{
  assert.equal(fixture.synthetic,true);assert.equal(fixture.testOnly,true);assert.equal(fixture.neverUseInTradingView,true);assert.throws(()=>normalizeReplayDataset({metadata:fixture.options.metadata,bars:fixture.bars,higherTimeframes:fixture.options.higherTimeframes,provenance:fixture.provenance}),/NQ_STANDARD_TIMEFRAME_METADATA_REQUIRED/);
});
