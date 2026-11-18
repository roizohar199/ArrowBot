import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovedDeliveryProbe} from '../live-delivery-probe.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {selectFreshLiveSignal} from '../live-signal-eligibility.mjs';

const at=Date.UTC(2026,10,14,12),run=()=>createApprovedDeliveryProbe({now:()=>at});
const setup=analysis=>analysis.events.find(event=>event.signalIndex===25&&event.direction==='LONG');
const replay=(probe,edit)=>{const inputs=structuredClone(probe.replayInputs);edit(inputs);return {inputs,analysis:analyzeGuideSignals(inputs.bars,inputs.options)};};

test('isolated probe passes real intake, required structure/location/HTF, later close, risk and fresh selection',()=>{
  const probe=run(),signal=probe.signal;
  assert.equal(probe.kind,'CONTROLLED_DELIVERY_PROBE');assert.equal(probe.testOnly,true);assert.equal(probe.live,false);assert.equal(probe.marketData,false);assert.equal(probe.source.instrument,'SYNTHETIC_TEST:NQ');assert.equal(probe.source.connectedToTradingView,false);
  assert.equal(signal.status,'CONFIRMED');assert.equal(signal.direction,'LONG');assert.ok(signal.patternIds.includes('HAMMER_SHAPE'));assert.ok(signal.patternIds.includes('BULLISH_PIN_SHAPE'));
  assert.equal(signal.confirmationClose,102);assert.equal(signal.riskPlan.initialStop,98.5);assert.equal(signal.riskPlan.target,109);assert.equal(signal.riskPlan.quantity,1);assert.equal(signal.riskPlan.totalPlannedRisk,84);assert.equal(signal.riskPlan.commissionAllowance,4);assert.equal(signal.riskPlan.slippageAllowance,10);
  assert.deepEqual(probe.analysisSummary.requiredChecks.map(check=>check.id),['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME']);assert.ok(probe.analysisSummary.requiredChecks.every(check=>check.passed));assert.equal(probe.config.signal.minConditions,2);assert.equal(probe.config.signal.requireRisk,true);assert.equal(probe.config.risk.riskBudget,200);assert.equal(probe.config.risk.maxContracts,1);
  assert.equal(probe.approvalProof.actualLiveAlert,false);assert.equal(probe.approvalProof.ordersCreated,false);assert.equal(signal.orderEligible,false);assert.equal(signal.execution,'OBSERVATION_ONLY');assert.equal(probe.approvalProof.postBootstrapFormation,true);assert.equal(probe.approvalProof.eligibleConfirmation,true);
  assert.equal(probe.analysisSummary.beforeConfirmation.setupStatus,'ARMED');assert.equal(probe.analysisSummary.beforeConfirmation.signalCount,0);
  const fresh=selectFreshLiveSignal(signal,analyzeGuideSignals(probe.replayInputs.bars,probe.replayInputs.options),probe.replayInputs);assert.deepEqual(fresh,signal);
});

test('missing later close, open confirmation and equality at the trigger cannot approve the fixture',()=>{
  const probe=run();
  for(const edit of [input=>{input.bars.pop();input.options.asOfTime=input.bars.at(-1).knownAt;},input=>{input.bars.at(-1).closed=false;},input=>{input.bars.at(-1).close=probe.signal.trigger;}]){
    const {analysis}=replay(probe,edit);assert.equal(analysis.signals.length,0);assert.equal(setup(analysis).status,'ARMED');
  }
});

test('a risk budget below the84dollar all-in cost rejects rather than resizing the stop or granting a signal',()=>{
  const probe=run(),{analysis}=replay(probe,input=>{input.options.risk.riskBudget=83;});
  assert.equal(analysis.signals.length,0);assert.equal(setup(analysis).status,'REJECTED');assert.ok(setup(analysis).reasonCodes.includes('RISK_REJECTED'));assert.ok(setup(analysis).reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'));assert.equal(setup(analysis).riskPlan.quantity,0);assert.equal(setup(analysis).riskPlan.initialStop,98.5);
});

test('missing required higher data or a post-formation bootstrap prevents approval and delivery',()=>{
  const probe=run(),{analysis}=replay(probe,input=>{input.options.higherTimeframes['15'].bars=[];});assert.equal(analysis.signals.length,0);assert.ok(setup(analysis).reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));
  const original=analyzeGuideSignals(probe.replayInputs.bars,probe.replayInputs.options);
  assert.equal(selectFreshLiveSignal(probe.signal,original,{...probe.replayInputs,bootstrapAsOfTime:probe.signal.formationStartTime+1}),null);
  assert.equal(selectFreshLiveSignal(probe.signal,original,{...probe.replayInputs,eligibleCloseTimes:[]}),null);
});

test('all synthetic timestamps stay at or before capturednow and10s open observations retain default feed freshness',()=>{
  const probe=run();assert.equal(probe.createdAt,at);assert.equal(probe.signal.confirmedAt,at);assert.ok(probe.sourcePackets.every(packet=>packet.sourceEmittedAt<=at&&packet.receivedAt<=at&&packet.testOnly));assert.equal(probe.sourcePackets.filter(packet=>packet.openBars>0).length,15);
  const base=probe.sourcePackets.filter(packet=>['snapshot','update'].includes(packet.kind));assert.ok(base.every((packet,index)=>index===0||packet.receivedAt-base[index-1].receivedAt<=10000));
  assert.ok(probe.replayInputs.bars.every(bar=>bar.closeTime<=at&&bar.knownAt<=at));for(const entry of Object.values(probe.replayInputs.options.higherTimeframes))assert.ok(entry.bars.every(bar=>bar.closeTime<=at&&bar.knownAt<=probe.approvalProof.formationStartTime));
  assert.deepEqual(run(),probe);probe.signal.riskPlan.initialStop=0;assert.equal(run().signal.riskPlan.initialStop,98.5);
});

test('invalid clocks fail explicitly without accessing browser, DOM, network or orders',()=>{
  assert.throws(()=>createApprovedDeliveryProbe({now:123}),/INVALID_DELIVERY_PROBE_CLOCK/);
  for(const value of [NaN,Infinity,0,-1,at+.5])assert.throws(()=>createApprovedDeliveryProbe({now:()=>value}),/INVALID_DELIVERY_PROBE_TIME/);
});
