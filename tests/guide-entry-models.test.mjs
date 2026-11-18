import test from 'node:test';
import assert from 'node:assert/strict';
import {describeGuideEntryModels,GUIDE_ENTRY_DEFINITION_VERSION} from '../guide-entry-models.mjs';

const start=Date.UTC(2026,0,1),minute=60000;
const event=(extra={})=>({eventId:'research',direction:'LONG',status:'ARMED',knownAt:start,detectedAt:start,barCloseTime:start,signalLow:95,signalHigh:105,signalClose:102,trigger:105.25,invalidation:94.75,expiresAfterBars:3,parameterSnapshot:{config:{}},...extra});
const bar=(index,open,high,low,close,extra={})=>({time:start+index*minute,closeTime:start+(index+1)*minute,knownAt:start+(index+1)*minute,open,high,low,close,closed:true,...extra});
const metadata={tickSize:.25,pointValue:20,timeframeMs:minute},risk={riskBudget:220,pointValue:20,commissionPerContract:0,slippageTicks:0,maxContracts:1,rewardRisk:2};
const run=(rows=[],e=event(),extra={})=>describeGuideEntryModels(e,{bars:rows,metadata,risk,asOfTime:start+100*minute,...extra});
const model=(models,id)=>models.find(item=>item.id===id);

test('entry models are explicit research candidates with four distinct policies and no order, fill or live approval',()=>{
  const models=run();assert.equal(models.length,4);assert.equal(new Set(models.map(item=>item.id)).size,4);
  for(const item of models){assert.equal(item.definitionVersion,GUIDE_ENTRY_DEFINITION_VERSION);assert.equal(item.createdAt,start);assert.equal(item.orderCreatedAt,null);assert.equal(item.ordersCreated,false);assert.equal(item.fillInferred,false);assert.equal(item.executionApproved,false);assert.equal(item.orderEligible,false);assert.equal(item.execution,'OBSERVATION_ONLY');assert.equal(item.planningOnly,true);assert.equal(item.intrabarSequenceInferred,false);assert.equal(item.stopPrice,94.75);assert.equal(item.expiresAfterBars,3);assert.ok(item.provenance.sourceLines.length===2);}
  assert.equal(model(models,'MARKET_AFTER_SIGNAL_CLOSE').referencePrice,102);assert.equal(model(models,'BREAKOUT_STOP').plannedEntry,105.25);assert.equal(model(models,'RETEST_LIMIT').limitPrice,100);
  const alreadyBuffered=model(run([],event(),{risk:{...risk,stopBufferTicks:4}}),'BREAKOUT_STOP');assert.equal(alreadyBuffered.plannedRisk.initialStop,94.75);assert.equal(alreadyBuffered.plannedRisk.parameterSnapshot.stopBufferTicks,0);assert.equal(alreadyBuffered.provenance.parameterSnapshot.additionalStopBufferTicks,0);
});

test('future, open and creation-straddling bars never prove later-created price reachability',()=>{
  const e=event({knownAt:start+minute,barCloseTime:start+minute}),prior=bar(0,102,110,90,100),open=bar(1,102,110,90,100,{closed:false}),future=bar(2,102,110,90,100,{knownAt:start+20*minute});
  const empty=describeGuideEntryModels(e,{metadata,asOfTime:start+3*minute}),unavailable=describeGuideEntryModels(e,{metadata,bars:[prior,open,future],asOfTime:start+3*minute});assert.deepEqual(unavailable,empty);
  const delayed=bar(1,102,106,101,104,{knownAt:start+4*minute}),before=describeGuideEntryModels(e,{metadata,bars:[delayed],asOfTime:start+3*minute});assert.deepEqual(before,empty);
  const after=describeGuideEntryModels(e,{metadata,bars:[delayed],asOfTime:start+4*minute});assert.equal(model(after,'BREAKOUT_STOP').state,'BREAKOUT_LEVEL_REACHED_NO_FILL_PROOF');assert.equal(model(after,'BREAKOUT_STOP').observedAt,start+4*minute);
});

test('a touched Stop and a later closing confirmation remain distinct causal observations',()=>{
  const data=[bar(0,102,106,101,104),bar(1,104,107,103,106)];const models=run(data),stop=model(models,'BREAKOUT_STOP'),close=model(models,'LATER_CLOSE_CONFIRMATION');
  assert.equal(stop.state,'BREAKOUT_LEVEL_REACHED_NO_FILL_PROOF');assert.equal(stop.observedAt,data[0].knownAt);assert.equal(stop.observedLaterClosedBars,1);assert.equal(close.state,'CLOSED_CONFIRMATION_OBSERVED');assert.equal(close.observedAt,data[1].knownAt);assert.equal(close.referencePrice,106);assert.equal(close.observedLaterClosedBars,2);assert.equal(stop.fillInferred,false);
  const next=model(models,'MARKET_AFTER_SIGNAL_CLOSE');assert.equal(next.state,'NEXT_OPEN_REFERENCE_OBSERVED');assert.equal(next.referencePrice,102);assert.equal(next.observedOpenReference,102);assert.equal(next.observedReferenceRisk.basis,'OBSERVED_OPEN_REFERENCE_NOT_A_FILL');
  const terminal=run([...data,bar(2,106,110,100,108)]);assert.deepEqual(model(terminal,'BREAKOUT_STOP'),stop,'later bars cannot rewrite the already-observed first trigger');
});

test('an entry and protective invalidation reached in one OHLC bar stay ambiguous for Stop and Limit',()=>{
  const models=run([bar(0,102,107,94,103)]);
  for(const id of ['BREAKOUT_STOP','RETEST_LIMIT']){const item=model(models,id);assert.equal(item.state,'AMBIGUOUS');assert.equal(item.entryLevelReached,true);assert.equal(item.invalidationLevelReached,true);assert.equal(item.intrabarSequenceInferred,false);assert.equal(item.fillInferred,false);assert.deepEqual(item.reasonCodes,['BOTH_ENTRY_AND_INVALIDATION_REACHED_ORDER_UNKNOWN']);}
});

test('a gap beyond the Stop records the observed open and recomputes hypothetical risk without an ideal fill',()=>{
  const gap=bar(0,110,112,109,111),stop=model(run([gap]),'BREAKOUT_STOP');assert.equal(stop.state,'GAP_OPEN_PRICE_OBSERVED');assert.equal(stop.plannedEntry,105.25);assert.equal(stop.observedOpenReference,110);assert.equal(stop.riskRecalculationRequired,true);assert.equal(stop.plannedRisk.status,'PLANNED');assert.equal(stop.observedReferenceRisk.plan.status,'BLOCKED');assert.equal(stop.observedReferenceRisk.plan.quantity,0);assert.ok(stop.observedReferenceRisk.plan.reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'));assert.equal(stop.observedReferenceRisk.plan.target,stop.plannedRisk.target);assert.equal(stop.observedReferenceRisk.plan.actualEntry,null);assert.equal(stop.fillInferred,false);
});

test('Limit retracement is configurable, rounded conservatively and a touch is never a fill',()=>{
  const e=event({signalHigh:110,signalLow:90,trigger:110.25,invalidation:89.75,parameterSnapshot:{config:{entryLimitRetracement:.25}}}),item=model(run([bar(0,108,109,104,108)],e),'RETEST_LIMIT');assert.equal(item.limitPrice,105);assert.equal(item.state,'LIMIT_LEVEL_REACHED_NO_FILL_PROOF');assert.equal(item.fillInferred,false);assert.equal(item.provenance.parameterSnapshot.limitRetracementSource,'research_choice');
  const short=event({direction:'SHORT',signalHigh:110,signalLow:90,trigger:89.75,invalidation:110.25,parameterSnapshot:{config:{entryLimitRetracement:.251}}}),mirrored=model(run([bar(0,94,96,93,94)],short),'RETEST_LIMIT');assert.equal(mirrored.limitPrice,95.25);assert.equal(mirrored.state,'LIMIT_LEVEL_REACHED_NO_FILL_PROOF');
});

test('SHORT gap, closing confirmation and ambiguous boundary policies mirror LONG without an inferred fill',()=>{
  const e=event({direction:'SHORT',signalLow:95,signalHigh:105,signalClose:98,trigger:94.75,invalidation:105.25}),gap=bar(0,90,91,88,89),models=run([gap],e),stop=model(models,'BREAKOUT_STOP');
  assert.equal(stop.state,'GAP_OPEN_PRICE_OBSERVED');assert.equal(stop.observedOpenReference,90);assert.equal(stop.observedReferenceRisk.plan.status,'BLOCKED');assert.equal(stop.observedReferenceRisk.plan.actualEntry,null);assert.equal(stop.fillInferred,false);
  assert.equal(model(models,'LATER_CLOSE_CONFIRMATION').state,'CLOSED_CONFIRMATION_OBSERVED');
  const both=run([bar(0,99,106,94,98)],e);assert.equal(model(both,'BREAKOUT_STOP').state,'AMBIGUOUS');assert.equal(model(both,'RETEST_LIMIT').state,'AMBIGUOUS');
});

test('explicit later-bar expiry cannot revive after a late touch; an invalidation close is terminal',()=>{
  const quiet=[0,1,2].map(index=>bar(index,102,104,101,103)),e=event({parameterSnapshot:{config:{entryExpiryBars:2}}}),before=run(quiet.slice(0,1),e),after=run(quiet,e);
  assert.equal(model(before,'BREAKOUT_STOP').state,'WAITING_FOR_PRICE_CONDITION');assert.equal(model(after,'BREAKOUT_STOP').state,'EXPIRED');assert.equal(model(after,'BREAKOUT_STOP').expiresAt,quiet[1].knownAt);assert.equal(model(after,'BREAKOUT_STOP').observedLaterClosedBars,2);
  const late=run([...quiet,bar(3,103,108,102,107)],e);assert.deepEqual(model(late,'BREAKOUT_STOP'),model(after,'BREAKOUT_STOP'));
  const invalid=run([bar(0,102,104,94,94.5),bar(1,95,108,94,107)]);assert.equal(model(invalid,'LATER_CLOSE_CONFIRMATION').state,'INVALIDATED_BY_LATER_CLOSE');
});

test('future appended data does not change models at an earlier asOf, and bad policy/source inputs block explicitly',()=>{
  const first=bar(0,102,104,101,103),cutoff=first.knownAt,before=run([first],event(),{asOfTime:cutoff}),future=run([first,bar(1,103,120,90,110)],event(),{asOfTime:cutoff});assert.deepEqual(future,before);
  for(const e of [event({parameterSnapshot:{config:{entryLimitRetracement:1.1}}}),event({parameterSnapshot:{config:{entryExpiryBars:0}}}),event({knownAt:start-minute}),event({signalHigh:95})])assert.ok(run([],e).every(item=>item.state==='BLOCKED'));
  const mismatch=model(run([bar(0,102,106,101,104)],event(),{risk:{...risk,pointValue:2}}),'BREAKOUT_STOP');assert.equal(mismatch.plannedRisk.status,'BLOCKED');assert.deepEqual(mismatch.plannedRisk.reasonCodes,['INSTRUMENT_POINT_VALUE_MISMATCH']);
});
