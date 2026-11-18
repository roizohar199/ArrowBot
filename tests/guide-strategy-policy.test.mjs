// Synthetic OHLC and adversarial component contracts only. None of these
// fixtures may be used as a native market witness or an order authorization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeGuideSignals,createGuideAnalyzer,validateGuideSignalConfig} from '../guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from '../guide-technical-decision.mjs';
import {GUIDE_STRATEGY_POLICY,GUIDE_STRATEGY_PROFILES,getGuideStrategyProfile} from '../guide-strategy-policy.mjs';
const minute=60000,start=Date.UTC(2026,0,1),bar=(i,open,high,low,close)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true});
const rows=values=>values.map((v,i)=>bar(i,v,v+1,v-1,v));
const rise=()=>rows([100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106]);
const range=()=>rows([105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105]);
const emaFixture=()=>[...rise(),bar(25,108,108.25,107.25,107.5),bar(26,107.25,108.5,107,108.25),bar(27,108.25,109.5,108,109)];
const rangeFixture=()=>[...range(),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const flags=['requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const metadata={source:'ohlc',instrument:'SYNTHETIC_STRATEGY_POLICY',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard',synthetic:true,testOnly:true};
const options={metadata,risk:null,config:{strategyPolicy:GUIDE_STRATEGY_POLICY,requireRisk:false,...Object.fromEntries(flags.map(k=>[k,true]))},contextConfig:{roleReversalEnabled:true,fibRatios:[.382]}};
const run=(bars,extra={})=>analyzeGuideSignals(bars,{...options,...extra,asOfTime:extra.asOfTime??bars.at(-1).closeTime});
const current=(a,id)=>a.events.find(e=>e.strategyId===id&&e.confirmationBarCloseTime===a.asOfTime);

test('explicit source-specific policy is opt-in and its eighteen profiles are bounded immutable research definitions',()=>{
  assert.equal(validateGuideSignalConfig().strategyPolicy,'configured');assert.throws(()=>validateGuideSignalConfig({strategyPolicy:'future'}));
  assert.equal(GUIDE_STRATEGY_PROFILES.length,18);assert.equal(new Set(GUIDE_STRATEGY_PROFILES.map(p=>p.id)).size,18);
  for(const p of GUIDE_STRATEGY_PROFILES){assert.ok(Object.isFrozen(p));assert.ok(p.requiredCheckIds.includes('STRUCTURE'));assert.equal(new Set(p.requiredCheckIds).size,p.requiredCheckIds.length);assert.equal(p.sourceKind,'original_research_definition');assert.equal(p.sourceLines.length,2);assert.ok(p.sourceLines[0]<p.sourceLines[1]);}
  assert.equal(getGuideStrategyProfile('unknown'),null);
  const old=run(rangeFixture(),{config:{...options.config,strategyPolicy:'configured'}});assert.equal(old.strategyProfiles,undefined);assert.ok(old.events.every(e=>e.strategyId===undefined&&e.contextSnapshot.checks.every(c=>c.required)));
});

test('full engine LONG and SHORT EMA variants confirm while optional FIB, supply-demand and higher-timeframe diagnostics do not pass',()=>{
  for(const inverse of [false,true]){
    const bars=inverse?mirror(emaFixture()):emaFixture(),a=run(bars),e=current(a,'ENGULFING_EMA');assert.ok(e);assert.equal(e.status,'CONFIRMED');assert.equal(e.direction,inverse?'SHORT':'LONG');
    assert.deepEqual(e.strategyProof.requiredCheckIds,['STRUCTURE','EMA']);
    for(const id of ['STRUCTURE','EMA'])assert.equal(e.contextSnapshot.checks.find(c=>c.id===id).state,'PASS');
    for(const id of ['FIB','SUPPLY_DEMAND','HIGHER_TIMEFRAME']){const c=e.contextSnapshot.checks.find(c=>c.id===id);assert.equal(c.required,false);assert.notEqual(c.state,'PASS');}
    assert.equal(e.contextSnapshot.checks.find(c=>c.id==='EMA').evidence.proximityMode,'ticks');assert.equal(e.parameterSnapshot.contextConfig.emaProximityMode,'ticks');
    const d=selectGuideTechnicalDecision({analysis:a});assert.equal(d.status,'CONFIRMED');assert.equal(d.approvalPolicy,GUIDE_STRATEGY_POLICY);assert.equal(d.signal.approvalPolicy,GUIDE_STRATEGY_POLICY);assert.ok(d.signal.strategyProofs.some(p=>p.profileId==='ENGULFING_EMA'&&p.sourceEventIds.includes(e.eventId)));
    for(const proof of d.signal.strategyProofs)assert.deepEqual(Object.keys(proof).sort(),['profileId','requiredCheckIds','requiredChecks','sourceEventIds'].sort());
    assert.equal(d.signal.orderEligible,false);assert.equal(d.signal.synthetic,true);assert.equal(d.signal.testOnly,true);assert.equal(e.riskPlan,null);
    const strict=run(bars,{config:{...options.config,strategyPolicy:'configured'}});assert.equal(selectGuideTechnicalDecision({analysis:strict}).status,'NO_APPROVAL');
  }
});

test('range rejection uses its own known-boundary requirements without requiring an unavailable three-touch trendline',()=>{
  for(const inverse of [false,true]){
    const a=run(inverse?mirror(rangeFixture()):rangeFixture()),e=current(a,'PIN_RANGE_EDGE');assert.ok(e);assert.equal(e.status,'CONFIRMED');
    const line=e.contextSnapshot.checks.find(c=>c.id==='TRENDLINE');assert.equal(line.required,false);assert.equal(line.state,'UNAVAILABLE');
    assert.equal(a.strategyProfiles.length,18);assert.equal(a.currentChecks.diagnosticOnly,true);
    const d=selectGuideTechnicalDecision({analysis:a});assert.equal(d.status,'CONFIRMED');assert.equal(d.signal.direction,inverse?'SHORT':'LONG');
    assert.ok(d.signal.strategyProofs.some(p=>p.profileId==='PIN_RANGE_EDGE'));assert.equal(new Set(d.signal.sourceEventIds).size,d.signal.sourceEventIds.length);
    assert.equal(d.signal.selectionPolicy,'COMPATIBLE_SETUPS_MERGED_NO_BEST_SETUP_RANKING');
  }
});

test('a required EMA failure or unavailable warmup cannot be waived by optional passing diagnostics',()=>{
  const far=[...rise(),bar(25,111,111.25,110.25,110.5),bar(26,110.25,111.5,110,111.25),bar(27,111.25,112.5,111,112)];
  for(const [bars,contextConfig] of [[far,options.contextConfig],[emaFixture(),{...options.contextConfig,emaPeriod:100}]]){
    const a=run(bars,{contextConfig}),e=a.events.find(e=>e.strategyId==='ENGULFING_EMA'&&e.signalIndex===26);assert.ok(e);assert.equal(e.status,'REJECTED');assert.ok(e.reasonCodes.includes('MISSING_EMA'));assert.equal(e.confirmedAt,null);assert.equal(e.strategyProof.requiredChecks.find(c=>c.id==='EMA').passed,false);
  }
});

test('a guide strategy cannot be approved with unknown, incomplete, mismatched or weakened required-check proof',()=>{
  const base=run(emaFixture());assert.equal(selectGuideTechnicalDecision({analysis:base}).status,'CONFIRMED');
  const mutations=[e=>{e.strategyId='FUTURE_STRATEGY';},e=>{e.strategyProof.requiredCheckIds=['STRUCTURE'];},e=>{e.strategyProof.requiredChecks.pop();},e=>{e.strategyProof.sourceEventIds=['foreign'];},e=>{e.strategyProof.applicable=false;},e=>{e.strategyProof.sourceLines=[1,2];},e=>{e.contextSnapshot.checks.find(c=>c.id==='EMA').required=false;},e=>{e.parameterSnapshot.config.requireEma=false;},e=>{e.parameterSnapshot.config.strategyPolicy='configured';}];
  for(const mutate of mutations){const a=structuredClone(base),e=current(a,'ENGULFING_EMA');mutate(e);assert.equal(selectGuideTechnicalDecision({analysis:a}).status,'BLOCKED',mutate.toString());}
});

test('profile context applicability, a later closed confirmation and current-cutoff freshness remain mandatory',()=>{
  const bars=rangeFixture(),a=run(bars),wrong=a.events.find(e=>e.strategyId==='PIN_TREND_AT_ZONE'&&e.signalIndex===25);assert.equal(wrong.status,'REJECTED');assert.ok(wrong.reasonCodes.includes('STRATEGY_CONTEXT_NOT_APPLICABLE'));assert.equal(wrong.strategyProof.applicable,false);
  const before=run(bars.slice(0,-1));assert.equal(selectGuideTechnicalDecision({analysis:before}).status,'NO_APPROVAL');
  const open=structuredClone(bars);open.at(-1).closed=false;assert.equal(selectGuideTechnicalDecision({analysis:run(open)}).status,'NO_APPROVAL');
  const later=run([...bars,bar(27,102,103,101.5,102.5)]),decision=selectGuideTechnicalDecision({analysis:later});assert.equal(decision.status,'NO_APPROVAL');assert.ok(decision.historicalSignals.some(s=>s.strategyProofs.some(p=>p.profileId==='PIN_RANGE_EDGE')));
});

test('per-strategy role aliases preserve the repaired Hanging Man and Inverted Hammer prior-state rule',()=>{
  const original=[...range(),bar(25,100,101,95,96),bar(26,99,100,96,99.5),bar(27,97,98,94,95)];
  for(const inverse of [false,true]){const a=run(inverse?mirror(original):original),pattern=inverse?'INVERTED_HAMMER_SHAPE':'HANGING_MAN_SHAPE',e=a.events.find(e=>e.strategyId==='ROLE_REVERSAL_RETEST'&&e.signalIndex===26&&e.patternIds.includes(pattern));assert.ok(e);assert.equal(e.status,'REJECTED');assert.equal(e.scenarioApplicability.applicable,false);assert.ok(e.reasonCodes.includes('CONTEXTUAL_PATTERN_REQUIRES_'+(inverse?'TREND_DOWN':'TREND_UP')));}
});

test('opposite technical contracts still veto the whole current cutoff across strategy profiles',()=>{
  // Adversarial analysis-ledger contract: this is deliberately not a claimed
  // naturally generated opposing market pattern or an execution fixture.
  const a=run(emaFixture()),source=current(a,'ENGULFING_EMA'),opposite=structuredClone(source);
  opposite.eventId+=':OPPOSITE_CONTRACT';opposite.direction='SHORT';opposite.trigger=source.confirmationClose+.25;opposite.invalidation=source.confirmationClose+1;opposite.strategyProof.sourceEventIds=[opposite.eventId];a.events.push(opposite);
  const d=selectGuideTechnicalDecision({analysis:a});assert.equal(d.status,'AMBIGUOUS');assert.equal(d.direction,null);assert.equal(d.signal,null);assert.ok(d.conflicts.some(c=>c.sourceEventIds.includes(opposite.eventId)));
});

test('strategy identities and frozen proofs remain stable through append-only caching and historical cutoffs',()=>{
  const bars=emaFixture(),analyzer=createGuideAnalyzer(),one=analyzer.analyze(bars,{...options,asOfTime:bars.at(-1).closeTime}),e=current(one,'ENGULFING_EMA');assert.ok(e);
  const future=[...bars,bar(28,109,110,108.75,109.5)],two=analyzer.analyze(future,{...options,asOfTime:future.at(-1).closeTime});assert.equal(two.cache.appendOnly,true);assert.deepEqual(two.events.find(x=>x.eventId===e.eventId),e);
  const sameCutoff=run(future,{asOfTime:one.asOfTime});assert.deepEqual(selectGuideTechnicalDecision({analysis:sameCutoff}),selectGuideTechnicalDecision({analysis:one}));
});

test('full429-bar profile analysis keeps every historical confirmed required check available, including known role structure before pivot classification',async()=>{
  const f=JSON.parse(await readFile(new URL('./fixtures/guide-all-seven-reachability.json',import.meta.url),'utf8'));
  const a=analyzeGuideSignals(f.bars,{...f.options,risk:null,config:{...f.options.config,requireRisk:false,strategyPolicy:GUIDE_STRATEGY_POLICY}});
  const role=a.events.find(e=>e.strategyId==='ROLE_REVERSAL_RETEST'&&e.contextSnapshot.context.state==='UNKNOWN'&&e.contextSnapshot.checks.find(c=>c.id==='STRUCTURE').evidence.roleReversal===true);
  assert.ok(role,'the existing artificial full-engine archive reaches a causal role zone before generic pivot-trend classification');
  const structure=role.contextSnapshot.checks.find(c=>c.id==='STRUCTURE');assert.equal(structure.available,true);assert.equal(structure.state,'PASS');assert.ok(role.contextSnapshot.location.zones.some(z=>z.roleReversal&&z.knownAt<=role.formationStartTime));
  for(const e of a.events.filter(e=>e.status==='CONFIRMED'))for(const c of e.contextSnapshot.checks.filter(c=>c.required)){assert.equal(c.available,true,e.eventId+':'+c.id);assert.equal(c.enabled,true);assert.equal(c.passed,true);assert.equal(c.state,'PASS');}
  const d=selectGuideTechnicalDecision({analysis:a});assert.equal(d.status,'CONFIRMED');assert.equal(d.direction,'LONG');assert.ok(d.signal.strategyProofs.length>0);assert.equal(d.signal.synthetic,true);
});
