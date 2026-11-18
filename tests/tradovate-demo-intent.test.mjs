import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTradovateDemoIntent,TRADOVATE_DEMO_LIMITS} from '../tradovate-demo-intent.mjs';
import {makeTradovateDemoIntentFixture} from './fixtures/tradovate-demo-intent.mjs';
const fixture=makeTradovateDemoIntentFixture;
const setSignal=(f,edit)=>{edit(f.alert.signal);f.analysis.events=[structuredClone(f.alert.signal)];f.analysis.signals=[structuredClone(f.alert.signal)];};

test('synthetic LONG and SHORT stage unsigned one-NQ OSO reviews with unchanged37tick structural stop and198.10USD planned risk',()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture({direction}),before=structuredClone(f),r=prepareTradovateDemoIntent(f);assert.equal(r.status,'PREPARED',JSON.stringify(r));
    assert.equal(r.intent.risk.totalPlannedRisk,198.1);assert.equal(r.intent.risk.quantity,1);assert.equal(r.intent.protectiveStop.stopPrice,f.alert.signal.invalidation);assert.equal(r.intent.entry.price,20000);
    assert.equal(r.intent.osoRequest.action,direction==='LONG'?'Buy':'Sell');assert.equal(r.intent.osoRequest.orderQty,1);assert.equal(r.intent.osoRequest.orderType,'Limit');assert.equal(r.intent.osoRequest.bracket1.orderType,'Stop');assert.equal(r.intent.osoRequest.bracket1.action,direction==='LONG'?'Sell':'Buy');assert.equal(r.intent.osoRequest.bracket2.orderType,'Limit');assert.equal(r.intent.osoRequest.isAutomated,true);
    assert.equal(r.orderEligible,false);assert.equal(r.ordersCreated,false);assert.equal(r.remoteVerificationPerformed,false);assert.equal(r.readyForSubmission,false);assert.equal(r.intent.orderEligible,false);assert.equal(r.intent.ordersCreated,false);assert.equal(r.intent.readyForSubmission,false);assert.equal(r.intent.simulationOnly,true);assert.deepEqual(f,before);
  }
});
test('a38tick stop is rejected even when a caller labels the unaffordable risk plan PLANNED',()=>{
  for(const direction of ['LONG','SHORT']){const f=fixture({direction,stopTicks:38});setSignal(f,s=>{s.riskPlan.status='PLANNED';s.riskPlan.quantity=1;s.riskPlan.totalPlannedRisk=1;});const r=prepareTradovateDemoIntent(f);assert.equal(r.status,'BLOCKED');assert.deepEqual(r.reasonCodes,['TOTAL_PLANNED_RISK_EXCEEDS_200_USD']);assert.equal(r.intent,null);}
});
test('fractional performance-clock approval epochs are accepted while unknown event keys are blocked',()=>{
  const f=fixture();f.alert.approvedAtReceiverEpoch=f.now-40.25;assert.equal(prepareTradovateDemoIntent(f).status,'PREPARED');
  f.alert.signal.eventId='forged-new-idempotency-key';assert.deepEqual(prepareTradovateDemoIntent(f).reasonCodes,['KNOWN_CURRENT_ANALYSIS_SIGNAL_REQUIRED']);
  for(const value of [NaN,Infinity,f.now+1]){const bad=fixture();bad.alert.approvedAtReceiverEpoch=value;assert.deepEqual(prepareTradovateDemoIntent(bad).reasonCodes,['FRESH_CURRENT_CONNECTION_ALERT_REQUIRED']);}
});
test('Apex/provider labels are blocked before other readiness checks, including on aDEMO endpoint',()=>{
  for(const edit of [f=>{f.brokerBinding.provider='APEX';},f=>{f.brokerSnapshot.accountSpec='PA-APEX-123';},f=>{f.brokerBinding.accountProvider='Apex Trader Funding';},f=>{f.alert.accountReview.profile.brokerLabel='APEX TRADOVATE';}]){const f=fixture();edit(f);assert.deepEqual(prepareTradovateDemoIntent(f).reasonCodes,['READINESS_APEX_BLOCK']);}
});
test('DEMO label alone, unknown provider, LIVE binding or missing independent-account evidence cannot stage an intent',()=>{
  for(const edit of [f=>{f.brokerBinding.provider='TRADOVATE';},f=>{f.brokerBinding.environment='LIVE';},f=>{delete f.brokerBinding.accountOrigin;},f=>{delete f.brokerBinding.independentAccountEvidence;},f=>{f.brokerBinding.independentAccountEvidence.accountId=789;},f=>{f.brokerBinding.independentAccountEvidence.reference='';},f=>{f.brokerBinding.independentAccountEvidence.observedAt=f.now-2001;},f=>{f.brokerSnapshot.accountOrigin='PROP_SIM';}]){const f=fixture();edit(f);assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED');}
});
test('replay, intrabar, bootstrap, stale, disconnected, changed-source and pre-recovery signals cannot stage entries',()=>{
  for(const edit of [f=>{f.source.mode='REPLAY';},f=>{f.state.metadata.replay=true;},f=>{f.state.bootstrap=true;},f=>{f.state.contextOnly=true;},f=>{f.state.stale=true;},f=>{f.state.connected=false;},f=>{f.state.requiresSnapshot=true;},f=>{f.state.liveEligible=false;},f=>{f.source.generation++;},f=>{f.source.runId='changed-source';},f=>{f.source.sessionId='changed-session';},f=>{f.source.sourceTabId++;},f=>{f.state.bootstrapAsOfTime=f.alert.signal.formationStartTime+1;},f=>{f.state.eligibleCloseTimes=[];},f=>{f.state.newlyClosed=[];},f=>{f.state.bars[2].finalOhlcVerified=false;},f=>{f.state.current.closed=true;f.state.liveEligible=false;},f=>{f.source.settingsDirty=true;},f=>{f.alert.receivedAt=f.now-15001;},f=>{f.state.lastReceivedAt=f.now+1;}]){const f=fixture();edit(f);assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED',edit.toString());}
});
test('each mandatory disabled, unavailable or failing frozen filter blocks the review',()=>{
  for(const flag of ['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand']){const f=fixture();setSignal(f,s=>{s.parameterSnapshot.config[flag]=false;});assert.deepEqual(prepareTradovateDemoIntent(f).reasonCodes,['ALL_MANDATORY_FROZEN_FILTERS_REQUIRED']);}
  for(const check of ['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'])for(const property of ['required','passed','available','enabled']){const f=fixture();setSignal(f,s=>{s.contextSnapshot.checks.find(c=>c.id===check)[property]=false;});assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED');}
  for(const property of ['roleReversalEnabled','supplyDemandEnabled']){const f=fixture();setSignal(f,s=>{s.parameterSnapshot.contextConfig[property]=false;});assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED');}
});
test('quantity, cost review, frozen risk parameters and stop-price arithmetic cannot be silently overridden',()=>{
  for(const edit of [f=>{f.brokerBinding.automationConsent=false;},f=>{f.brokerBinding.costsReviewed=false;},f=>{f.brokerBinding.localReviewId='old-review';},f=>{f.source.accountReviewId='old-review';},f=>{f.alert.accountReview.profile.mode='LIVE';},f=>{f.alert.accountReview.profile.maxContracts=2;},f=>{f.alert.accountReview.profile.commissionPerContract='';},f=>{f.alert.accountReview.profile.slippageTicks='';},f=>{f.alert.accountReview.profile.riskBudget=201;},f=>{setSignal(f,s=>{s.riskPlan.quantity=2;});},f=>{setSignal(f,s=>{s.riskPlan.initialStop+=.25;});},f=>{setSignal(f,s=>{s.riskPlan.totalPlannedRisk=1;});},f=>{setSignal(f,s=>{s.riskPlan.ordersCreated=true;});},f=>{setSignal(f,s=>{s.parameterSnapshot.risk.commissionPerContract=0;});},f=>{setSignal(f,s=>{s.orderEligible=true;});}]){const f=fixture();edit(f);assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED',edit.toString());}
});
test('flat broker state, no working orders and fresh contract-specific quotes are mandatory',()=>{
  for(const edit of [f=>{f.brokerSnapshot.positions=[{netPos:1,contractId:456}];},f=>{f.brokerSnapshot.positions=[{netPos:NaN}];},f=>{f.brokerSnapshot.workingOrders=[{id:1}];},f=>{f.brokerSnapshot.tradingEnabled=false;},f=>{f.brokerSnapshot.accountId++;},f=>{f.brokerSnapshot.observedAt=f.now-2001;},f=>{f.quote.observedAt=f.now-2001;},f=>{f.quote.observedAt=f.now+1;},f=>{f.quote.contractId++;},f=>{f.quote.last+=.75;},f=>{f.quote.ask+=2;},f=>{f.quote.last+=.1;},f=>{f.quote.verified=false;}]){const f=fixture();edit(f);assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED',edit.toString());}
});
test('dated source identity and explicit continuous mapping refuse MNQ, mismatched expiry, wrong tick/point and ambiguousroll',()=>{
  const continuous=fixture({continuous:true});assert.equal(prepareTradovateDemoIntent(continuous).status,'PREPARED');
  for(const edit of [f=>{f.contract.product='MNQ';},f=>{f.contract.symbol='MNQZ6';},f=>{f.contract.symbol='NQH7';},f=>{f.contract.symbol='NQF6';f.contract.instrument='CME_MINI:NQF2026';},f=>{f.contract.instrument='CME_MINI:NQZ2027';},f=>{f.contract.expirationTime=Date.UTC(2026,10,30);},f=>{f.contract.expirationTime=f.now-1;},f=>{f.contract.tickSize=.1;},f=>{f.contract.pointValue=2;},f=>{f.contract.verified=false;},f=>{f.contract.observedAt=f.now-300001;}]){const f=fixture();edit(f);assert.equal(prepareTradovateDemoIntent(f).status,'BLOCKED',edit.toString());}
  for(const edit of [f=>{delete f.brokerBinding.continuousMapping;},f=>{f.brokerBinding.continuousMapping.verified=false;},f=>{f.brokerBinding.continuousMapping.priceBasisVerified=false;},f=>{f.brokerBinding.continuousMapping.contractId++;},f=>{f.brokerBinding.continuousMapping.observedAt=f.now-300001;}]){const f=fixture({continuous:true});edit(f);assert.deepEqual(prepareTradovateDemoIntent(f).reasonCodes,['CONTINUOUS_TO_DATED_CONTRACT_PROOF_REQUIRED']);}
});
test('idempotency key is stable within one account/source/event and changes across source session or account',()=>{
  const f=fixture(),one=prepareTradovateDemoIntent(f),two=prepareTradovateDemoIntent(structuredClone(f));assert.equal(one.intent.idempotencyKey,two.intent.idempotencyKey);
  const changed=structuredClone(f);changed.source.sessionId=changed.alert.sessionId='another-session';assert.notEqual(prepareTradovateDemoIntent(changed).intent.idempotencyKey,one.intent.idempotencyKey);
  changed.brokerBinding.accountId=changed.brokerBinding.independentAccountEvidence.accountId=changed.brokerSnapshot.accountId=124;assert.notEqual(prepareTradovateDemoIntent(changed).intent.idempotencyKey,one.intent.idempotencyKey);
  assert.equal(one.intent.expiresAt,f.now+TRADOVATE_DEMO_LIMITS.quoteAgeMs-100);assert.equal(one.intent.sourceBinding.generation,f.state.generation);
});
test('the adapter has no dispatch capability and does not call globalfetch',()=>{
  const before=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_PURE_ADAPTER');};
  try{const r=prepareTradovateDemoIntent(fixture());assert.equal(r.status,'PREPARED');assert.equal(r.readyForSubmission,false);assert.ok(r.intent.requiresBeforeAnySubmission.includes('USER_OWNED_EXECUTION_HANDOFF'));}finally{globalThis.fetch=before;}
});
