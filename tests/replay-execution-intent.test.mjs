import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReplayExecutionIntent,REPLAY_EXECUTION_PUBLIC_FIELDS,REPLAY_EXECUTION_INTENT_VERSION} from '../replay-execution-intent.mjs';

import {fixture,bindPublicProof,synchronizeSignal,clone,minute,scalar,flagIds,checks} from './fixtures/replay-execution-fixture.mjs';

const blocked=(f,reason)=>{const result=prepareReplayExecutionIntent(f);assert.equal(result.status,'BLOCKED');
  assert.equal(result.intent,null);assert.equal(result.ordersCreated,false);assert.equal(result.submissionAuthorized,false);
  assert.equal(result.orderEligible,false);assert.equal(result.realBrokerOrdersAuthorized,false);
  if(reason)assert.ok(result.reasonCodes.includes(reason),result.reasonCodes.join(','));return result;};

test('synthetic strict Replay component contract prepares a deeply immutable unsigned one-contract LIMIT plan without orders',()=>{
  const f=fixture(),before=clone(f),result=prepareReplayExecutionIntent(f);
  assert.equal(result.status,'PREPARED');assert.deepEqual(f,before);
  const intent=result.intent;assert.equal(intent.provider,'REPLAY_TRADING');assert.equal(intent.quantity,1);
  assert.equal(intent.entry,28000);assert.equal(intent.stop,27990.75);assert.equal(intent.target,28018.5);
  assert.equal(intent.stopTicks,37);assert.equal(intent.targetTicks,74);assert.equal(intent.riskPlan.totalPlannedRisk,198.1);
  assert.equal(intent.unsigned,true);assert.equal(intent.submissionAuthorized,false);assert.equal(intent.ordersCreated,false);
  assert.equal(intent.requiresReplayUiRevalidation,true);assert.equal(intent.expiresAt,f.now+1920);
  assert.equal(intent.definitionVersion,'replay-execution-intent-2');assert.equal(REPLAY_EXECUTION_INTENT_VERSION,intent.definitionVersion);
  assert.equal(intent.quoteProof.quote,28000.25);assert.equal(intent.quoteProof.distanceTicks,1);assert.equal(intent.quoteProof.pricesAdjusted,false);
  assert.equal(intent.approvalProof.requiredChecks.length,7);assert.equal(intent.approvalProof.testOnly,false);
  assert.equal(intent.pendingPolicy.expiresAtReplayCloseTime,f.decision.asOfTime+3*minute);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(intent)&&Object.isFrozen(intent.riskPlan.parameterSnapshot));
  assert.throws(()=>{intent.sourceBinding.fields.ARROW2_SEQ_BEGIN='999';},TypeError);
  assert.throws(()=>{intent.riskPlan.initialStop=27999;},TypeError);
  f.decision.signal.invalidation=1;assert.equal(intent.stop,27990.75);
});

test('short protective-side arithmetic, explicit zero costs and exactly 200 USD are valid component plans',()=>{
  const short=prepareReplayExecutionIntent(fixture({direction:'SHORT'}));assert.equal(short.status,'PREPARED');
  assert.equal(short.intent.action,'Sell');assert.equal(short.intent.stop,28009.25);assert.equal(short.intent.target,27981.5);
  assert.equal(short.intent.riskPlan.totalPlannedRisk,198.1);
  assert.equal(prepareReplayExecutionIntent(fixture({commission:0,slippage:0})).intent.riskPlan.totalPlannedRisk,185);
  assert.equal(prepareReplayExecutionIntent(fixture({commission:5})).intent.riskPlan.totalPlannedRisk,200);
  blocked(fixture({stopTicks:38}));
});

test('same run/cursor/event gives the same reservation key across rereads; changed event cursor changes key',()=>{
  const a=fixture(),first=prepareReplayExecutionIntent(a).intent.key,b=clone(a);
  b.now++;b.replayWitness.sequence++;bindPublicProof(b);
  assert.equal(prepareReplayExecutionIntent(b).intent.key,first,'a new read sequence must not permit duplicate entry');
  b.uiEvidence.sourceTabId=18;b.uiEvidence.inventory.sourceTabId=18;assert.notEqual(prepareReplayExecutionIntent(b).intent.key,first);
});

test('LIVE, ordinary Paper, broker, TEST and non-Replay UI proof never become a historical execution intent',()=>{
  for(const change of [f=>{f.decision.mode='LIVE';},f=>{f.replayWitness.replay=false;},f=>{f.replayWitness.pineRealtimeExecution='true';},
    f=>{f.analysisInput.mode='LIVE';},f=>{f.uiEvidence.provider='TRADINGVIEW_PAPER';},f=>{f.uiEvidence.mode='PAPER';},
    f=>{f.uiEvidence.provider='TRADOVATE';},f=>{f.uiEvidence.replay=false;},f=>{f.decision.testOnly=true;},
    f=>{f.decision.signal.testOnly=true;},f=>{f.replayWitness.metadata.synthetic=true;},f=>{f.analysis.dataQuality.valid=false;}]){
    const f=fixture();change(f);blocked(f);
  }
});

test('all mandatory frozen filters, unique PASS check rows and role/SD context are required at every proof layer',()=>{
  for(const flag of flagIds){const f=fixture();f.decision.signal.parameterSnapshot.config[flag]=false;synchronizeSignal(f);blocked(f,'REPLAY_FROZEN_CURRENT_CONFIRMATION_REQUIRED');}
  for(const id of checks){const f=fixture();f.decision.signal.contextSnapshot.checks.find(row=>row.id===id).available=false;
    synchronizeSignal(f);blocked(f,'REPLAY_FROZEN_CURRENT_CONFIRMATION_REQUIRED');}
  for(const change of [f=>{f.analysisInput.options.contextConfig.roleReversalEnabled=false;},
    f=>{f.analysis.parameterSnapshot.contextConfig.supplyDemandEnabled=false;},
    f=>{f.decision.signal.contextSnapshot.checks.push(clone(f.decision.signal.contextSnapshot.checks[0]));synchronizeSignal(f);},
    f=>{f.decision.signal.parameterSnapshot.contextConfig.roleReversalEnabled=false;synchronizeSignal(f);},
    f=>{f.decision.signal.contextSnapshot.passed=false;synchronizeSignal(f);}]){const f=fixture();change(f);blocked(f);}
});

test('decision must match the current engine ledger and its actual later closed representative setup',()=>{
  for(const change of [f=>{f.analysis.signals=[];},f=>{f.analysis.signals.push(clone(f.analysis.signals[0]));},
    f=>{f.analysis.signals[0].riskPlan.totalPlannedRisk=1;},f=>{f.analysis.events=[];},
    f=>{f.analysis.events.push(clone(f.analysis.events[0]));},f=>{f.analysis.events[0].status='ARMED';},
    f=>{f.analysis.events[0].invalidation+=.25;},f=>{f.decision.signal.confirmationIndex=22;synchronizeSignal(f);},
    f=>{f.decision.signal.detectedAt=f.decision.asOfTime;synchronizeSignal(f);},
    f=>{f.decision.signal.trigger=f.decision.signal.confirmationClose;synchronizeSignal(f);},
    f=>{f.decision.status='PENDING';},f=>{f.decision.signal.confirmedAt-=minute;synchronizeSignal(f);}]){
    const f=fixture();change(f);blocked(f);
  }
});

test('pre-fix engine semantic versions cannot be presented as a current Replay approval',()=>{
  const f=fixture();f.analysis.definitionVersion='guide-signals-3';f.decision.signal.definitionVersion='guide-signals-3';
  synchronizeSignal(f);blocked(f,'REPLAY_STRICT_ANALYSIS_CONFIGURATION_REQUIRED');
  const oldSetup=fixture();oldSetup.analysis.events[0].definitionVersion='guide-signals-3';
  blocked(oldSetup,'REPLAY_SETUP_EVENT_LEDGER_REQUIRED');
});

test('future bars, changed cutoff OHLC, forged closed status and nonnative higher-timeframe identity fail closed',()=>{
  for(const change of [f=>{f.analysisInput.bars.push({...clone(f.analysisInput.bars.at(-1)),time:f.decision.asOfTime,
      closeTime:f.decision.asOfTime+minute,knownAt:f.decision.asOfTime+minute});},
    f=>{f.analysisInput.bars.at(-1).close-=.25;},f=>{f.analysisInput.bars.at(-1).knownAt--;},
    f=>{f.analysisInput.bars[5].time+=minute;},f=>{f.analysisInput.cutoff.exactTimeAndOhlcMatch=false;},
    f=>{f.replayWitness.previous.sourceClosed=false;},f=>{f.analysisInput.options.higherTimeframes['5'].metadata.instrument='CME_MINI:MNQ1!';},
    f=>{f.analysisInput.options.higherTimeframes['15'].bars.at(-1).knownAt++;},
    f=>{f.analysisInput.options.higherTimeframes['15'].metadata.synthetic=true;},
    f=>{f.analysisInput.options.metadata.timezone='Etc/UTC';}]){const f=fixture();change(f);blocked(f);}
});

test('public raw run/sequence/cursor fields are internally checked and must be unchanged in the Replay UI witness',()=>{
  for(const field of REPLAY_EXECUTION_PUBLIC_FIELDS){const f=fixture();f.uiEvidence.sourceBinding.fields[field]+='0';
    blocked(f,'REPLAY_UI_CURSOR_EVENT_OR_PUBLIC_FIELDS_CHANGED');}
  for(const change of [f=>{f.replayWitness.fields.ARROW2_RUN_EPOCH='0';},
    f=>{f.replayWitness.fields.ARROW2_SEQ_END='18';},f=>{f.replayWitness.fields.ARROW2_CURRENT_TIME='17';},
    f=>{f.replayWitness.fields.ARROW2_CURRENT_CLOSE_TIME=String(17*scalar+493);},
    f=>{f.replayWitness.checksumsVerified=false;},f=>{f.uiEvidence.sourceBinding.eventId='different-event';},
    f=>{f.uiEvidence.sourceBinding.asOfTime-=minute;},f=>{f.uiEvidence.sourceBinding.runId+='different';}]){
    const f=fixture();change(f);blocked(f);
  }
});

test('source/ticket observations need fresh receiver time, not a historical bar timestamp or stale preview',()=>{
  for(const change of [f=>{f.now=NaN;},f=>{f.uiEvidence.observedAt=f.now+1;},
    f=>{f.uiEvidence.observedAt=f.now-2001;},f=>{f.replayWitness.observedAt=f.now-2001;},
    f=>{f.replayWitness.sourceObservedEpochMs=NaN;},f=>{f.replayWitness.sourceObservedEpochMs=f.decision.asOfTime;},
    f=>{f.replayWitness.sourceDocumentTimeOrigin=f.now+1;}]){const f=fixture();change(f);blocked(f);}
});

test('Replay ticket needs complete native zero inventory and a source-matching passive quote with PRICE units',()=>{
  for(const change of [f=>{f.uiEvidence.chartCount=3;},f=>{f.uiEvidence.timeframe='5';},
    f=>{f.uiEvidence.instrument='CME_MINI:MNQ1!';},f=>{f.uiEvidence.flat=false;},
    f=>{f.uiEvidence.positions=[{quantity:1}];},f=>{f.uiEvidence.workingOrders=[{id:'pending'}];},
    f=>{f.uiEvidence.researchUrl='https://evil.example/chart/research/';},
    f=>{f.uiEvidence.ticket.symbol='NQZ2026';},f=>{f.uiEvidence.ticket.type='MARKET';},
    f=>{f.uiEvidence.ticket.quantity=2;},f=>{f.uiEvidence.ticket.tickValue=.5;},
    f=>{f.uiEvidence.ticket.entry=NaN;},f=>{f.uiEvidence.ticket.quote+=.25;},
    f=>{f.uiEvidence.ticket.ask+=.25;},f=>{f.uiEvidence.ticket.stopMode='TICKS';},
    f=>{f.uiEvidence.ticket.targetMode='USD';}]){const f=fixture();change(f);blocked(f);}
});

test('tightened structural stop, forged risk arithmetic and missing/negative costs cannot fit a rejected trade into budget',()=>{
  for(const change of [f=>{f.decision.signal.riskPlan.initialStop+=.25;synchronizeSignal(f);},
    f=>{f.decision.signal.invalidation+=.25;f.decision.signal.riskPlan.initialStop+=.25;synchronizeSignal(f);},
    f=>{f.decision.signal.stopReference.low+=.25;synchronizeSignal(f);},
    f=>{f.decision.signal.riskPlan.totalPlannedRisk=1;synchronizeSignal(f);},
    f=>{f.decision.signal.riskPlan.slippageAllowance=0;synchronizeSignal(f);},
    f=>{f.analysisInput.options.risk.commissionPerContract=-1;},
    f=>{delete f.analysisInput.options.risk.slippageTicks;},
    f=>{f.analysisInput.options.risk.maxContracts=2;},
    f=>{f.decision.signal.parameterSnapshot.risk.dailyRiskRemaining=0;synchronizeSignal(f);},
    f=>{f.decision.signal.riskPlan.actualEntry=28000;synchronizeSignal(f);},
    f=>{f.decision.signal.riskPlan.target=27999;synchronizeSignal(f);}]){const f=fixture();change(f);blocked(f);}
});

test('forming Replay current quote and final previous cutoff stay distinct without changing confirmation entry',()=>{
  const f=fixture(),w=f.replayWitness;
  assert.equal(prepareReplayExecutionIntent(f).status,'PREPARED');
  assert.notEqual(w.current.close,w.previous.close);assert.equal(prepareReplayExecutionIntent(f).intent.entry,w.previous.close);
  w.previous.sourceClosed=false;blocked(f,'REPLAY_PROVIDER_CLOSED_CUTOFF_REQUIRED');
});

test('malformed and unbounded proof inputs fail without throwing or returning a submission capability',()=>{
  assert.equal(prepareReplayExecutionIntent().status,'BLOCKED');
  assert.equal(prepareReplayExecutionIntent(null).status,'BLOCKED');
  for(const change of [f=>{f.analysis.signals[0].parameterSnapshot.self=f.analysis.signals[0];},
    f=>{f.analysis.events=Array(5001).fill({});},f=>{f.decision.signal.eventId='x'.repeat(513);},
    f=>{f.uiEvidence.sourceTabId=0;},f=>{f.replayWitness.fields.ARROW2_RUN_EPOCH='∅';}]){
    const f=fixture();change(f);const result=blocked(f);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.reasonCodes));
  }
});

test('marketable/equal quotes are rejected rather than repricing a frozen LONG or SHORT plan',()=>{
  for(const direction of ['LONG','SHORT'])for(const delta of [0,direction==='LONG'?-.25:.25]){
    const f=fixture({direction}),quote=f.decision.signal.confirmationClose+delta;
    Object.assign(f.uiEvidence.ticket,{quote,bid:quote,ask:quote});f.uiEvidence.inventory.quote=quote;
    Object.assign(f.replayWitness.current,{close:quote,high:Math.max(28000,quote),low:Math.min(28000,quote)});
    blocked(f,'REPLAY_MARKETABLE_LIMIT_BRACKET_UNSAFE');
  }
  const f=fixture(),quote=28002;Object.assign(f.uiEvidence.ticket,{entry:quote,quote,bid:quote,ask:quote});f.uiEvidence.inventory.quote=quote;Object.assign(f.replayWitness.current,{close:quote,high:quote});
  const p=prepareReplayExecutionIntent(f);assert.equal(p.status,'PREPARED');assert.equal(p.intent.entry,28000);assert.equal(p.intent.stop,27990.75);assert.equal(p.intent.target,28018.5);assert.equal(p.intent.riskPlan.totalPlannedRisk,198.1);
});

test('complete private-source inventory coherence cannot be replaced by visible empty arrays or stale counters',()=>{
  for(const change of [f=>{delete f.uiEvidence.inventory;},f=>{f.uiEvidence.positionsComplete=false;},f=>{f.uiEvidence.workingOrdersComplete=false;},
    f=>{f.uiEvidence.inventory.kind='MOCK_FLAT';},f=>{f.uiEvidence.inventory.buyCancelDisabled=false;},f=>{f.uiEvidence.inventory.positionMarker='0';},
    f=>{f.uiEvidence.inventory.observedAt=f.now-751;},f=>{f.uiEvidence.inventory.documentTimeOrigin++;},f=>{f.uiEvidence.inventory.sourceFields.ARROW2_SEQ_BEGIN='0';},
    f=>{f.uiEvidence.inventory.sourceBinding.eventId='other';},f=>{f.uiEvidence.inventory.quote+=.25;}]){const f=fixture();change(f);blocked(f);}
});

test('explicit Replay may have Pine realtime execution flags without being accepted as LIVE',()=>{
  const f=fixture();f.replayWitness.pineRealtimeExecution=true;assert.equal(prepareReplayExecutionIntent(f).status,'PREPARED');
  f.replayWitness.replay=false;blocked(f,'REPLAY_COHERENT_PUBLIC_WITNESS_REQUIRED');
});

test('actual multi-second wall versus source-performance offset does not reject a fresh native observation',()=>{
  for(const offset of [-4654.9,5000]){const f=fixture();f.replayWitness.sourceObservedEpochMs=f.now+offset;assert.equal(prepareReplayExecutionIntent(f).status,'PREPARED');f.replayWitness.observedAt=f.now-2001;blocked(f,'REPLAY_FRESH_PUBLIC_OBSERVATION_REQUIRED');}
});

test('same confirmed event retains its reservation key across fresh passive quote rereads and entry expiry is frozen',()=>{
  const f=fixture(),first=prepareReplayExecutionIntent(f).intent;
  f.now++;f.replayWitness.sequence++;f.replayWitness.current.close+=.25;f.replayWitness.current.high+=.25;
  f.uiEvidence.ticket.quote+=.25;f.uiEvidence.ticket.bid+=.25;f.uiEvidence.ticket.ask+=.25;f.uiEvidence.inventory.quote+=.25;bindPublicProof(f);
  const second=prepareReplayExecutionIntent(f).intent;assert.equal(second.key,first.key);assert.notEqual(second.quoteProof.quote,first.quoteProof.quote);assert.equal(second.entry,first.entry);
  f.decision.signal.parameterSnapshot.config.entryExpiryBars=5;synchronizeSignal(f);const custom=prepareReplayExecutionIntent(f).intent;
  assert.equal(custom.pendingPolicy.expiresAfterClosedBars,5);assert.equal(custom.pendingPolicy.expiresAtReplayCloseTime,f.decision.asOfTime+5*minute);
});
