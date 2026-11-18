import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCandlePatterns} from '../candle-patterns.mjs';
import {analyzeGuideSignals,createGuideAnalyzer} from '../guide-signal-engine.mjs';
import {describeGuideAnalysis,describeGuideEntryModels,GUIDE_PATTERN_DESCRIPTIONS} from '../guide-explanations.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true,...extra});
const metadata={source:'ohlc',instrument:'SYNTHETIC_DEMO',timeframe:'1m',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'Asia/Jerusalem',session:'synthetic',chartType:'standard'};
const risk={riskBudget:200,pointValue:20,commissionPerContract:4,slippageTicks:2,maxContracts:1,rewardRisk:2};
function fixture(){
  const closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105];
  return [...closes.map((v,i)=>bar(i,v,v+1,v-1,v)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
}
const options={metadata,risk,asOfTime:start+30*minute};
const pin=value=>value.events.find(event=>event.signalIndex===25&&event.direction==='LONG');
const withoutCache=({cache,...rest})=>rest;

test('all 20 shape explanations retain exact rule booleans and numerical operands for passes and failures',()=>{
  const value=analyzeGuideSignals(fixture(),options),view=describeGuideAnalysis(value),row=value.patterns.byBar.at(-1);
  assert.equal(GUIDE_PATTERN_DESCRIPTIONS.length,20);assert.equal(view.patternChecks.length,20);
  assert.deepEqual(new Set(view.patternChecks.map(item=>item.id)),new Set(Object.keys(row.checks)));
  for(const item of view.patternChecks){
    assert.equal(item.matched,row.checks[item.id].matched,item.id);assert.ok(item.label);assert.ok(item.provenance.guideLink.includes('#topic='));
    assert.deepEqual(item.measurements.current,value.patterns.features.at(-1));
    for(const condition of item.conditions){
      assert.equal(condition.passed,row.checks[item.id].conditions[condition.id],item.id+':'+condition.id);
      assert.ok(condition.label);assert.ok(condition.operator,item.id+':'+condition.id);
      assert.notEqual(condition.actual,undefined,item.id+':'+condition.id);
      assert.notEqual(condition.expected,undefined,item.id+':'+condition.id);
    }
  }
  const atPin=describeGuideAnalysis(value,{barIndex:25}).patternChecks;
  const hammer=atPin.find(item=>item.id==='HAMMER_SHAPE'),bullishPin=atPin.find(item=>item.id==='BULLISH_PIN_SHAPE');
  assert.equal(hammer.state,'MATCH');assert.equal(bullishPin.state,'MATCH');
  const wick=hammer.conditions.find(condition=>condition.id==='longLowerWick');assert.equal(wick.actual,1.75);assert.equal(wick.expected,1);assert.equal(wick.unit,'price');
  const ratio=bullishPin.conditions.find(condition=>condition.id==='longLowerWick');assert.equal(ratio.actual,.7);assert.equal(ratio.expected,.6);assert.equal(ratio.unit,'ratio');
  const bearish=atPin.find(item=>item.id==='BEARISH_PIN_SHAPE');assert.equal(bearish.state,'NO_MATCH');assert.ok(bearish.failedConditions.includes('longUpperWick'));
});

test('missing previous candles, zero range and ATR warmup remain unavailable rather than counted as ordinary failed evidence',()=>{
  const one=[bar(0,100,101,99,100)],result=analyzeGuideSignals(one,options),view=describeGuideAnalysis(result);
  assert.equal(view.patternChecks.find(item=>item.id==='DOJI').state,'MATCH');
  assert.equal(view.patternChecks.find(item=>item.id==='BULLISH_ENGULFING').state,'UNAVAILABLE');
  assert.equal(view.patternChecks.find(item=>item.id==='MORNING_STAR').state,'UNAVAILABLE');
  assert.equal(view.patternChecks.find(item=>item.id==='DOJI').reasonDetails.some(reason=>reason.code==='STAR_ATR_WARMUP_REQUIRED'),false);
  const zero=describeGuideAnalysis(analyzeGuideSignals([bar(0,100,100,100,100)],options));
  assert.ok(zero.patternChecks.every(item=>item.state==='UNAVAILABLE'));assert.equal(zero.coverage.shapesMatchedAtBar,0);
  const noAnalysis=describeGuideAnalysis();assert.equal(noAnalysis.coverage.allCandidatesEvaluated,false);assert.equal(noAnalysis.patternChecks.length,20);
});

test('every context filter distinguishes optional disabled, missing observations and calculated rejection',()=>{
  const result=analyzeGuideSignals(fixture(),options),view=describeGuideAnalysis(result),long=view.directions.LONG;
  assert.equal(long.checks.length,7);
  const supply=long.checks.find(check=>check.id==='SUPPLY_DEMAND');assert.equal(supply.state,'DISABLED');assert.equal(supply.required,false);assert.equal(supply.evidence.institutionalActivityInferred,false);
  const higher=long.checks.find(check=>check.id==='HIGHER_TIMEFRAME');assert.equal(higher.state,'UNAVAILABLE');assert.equal(higher.required,false);assert.ok(higher.reasonDetails.some(reason=>reason.code==='HIGHER_TIMEFRAME_NOT_SUPPLIED'));
  const ema=long.checks.find(check=>check.id==='EMA');assert.equal(ema.available,true);assert.ok(['PASS','FAIL'].includes(ema.state));assert.ok(Number.isFinite(ema.evidence.ema));
  assert.ok(view.coverage.optionalDisabled.includes('SUPPLY_DEMAND'));assert.ok(view.coverage.missingData.includes('HIGHER_TIMEFRAME'));
  assert.equal(view.scenarioFamilies.length,9);assert.ok(view.scenarioFamilies.every(family=>family.directions.length===2));
  const mandatory=pin(analyzeGuideSignals(fixture(),{...options,config:{requireHigherTimeframe:true}}));
  assert.equal(mandatory.status,'REJECTED');assert.ok(mandatory.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));
});

test('scenario explanation states observed confirmation, frozen context, separate costs and non-executing entry alternatives',()=>{
  const result=analyzeGuideSignals(fixture(),options),event=pin(result),view=describeGuideAnalysis(result),scenario=view.scenarios.find(item=>item.eventId===event.eventId);
  assert.equal(scenario.status,'CONFIRMED');assert.equal(scenario.confirmation.requiresLaterClosedBar,true);
  assert.equal(scenario.timing.contextFrozenAt,fixture()[25].time);assert.equal(scenario.timing.confirmedAt,fixture()[26].closeTime);
  assert.equal(scenario.levels.signalClose,101);assert.equal(scenario.risk.commissionAllowance,4);assert.equal(scenario.risk.slippageAllowance,10);assert.equal(scenario.risk.quantity,1);
  assert.equal(scenario.risk.perContractRisk,84);assert.equal(scenario.risk.totalPlannedRisk,84);
  assert.equal(scenario.entryModels.length,4);assert.equal(scenario.entryModels.filter(model=>model.activeDefault).length,1);
  for(const model of scenario.entryModels){assert.equal(model.planningOnly,true);assert.equal(model.fillInferred,false);assert.equal(model.ordersCreated,false);assert.equal(model.intrabarSequenceInferred,false);}
  assert.equal(scenario.entryModels.find(model=>model.id==='RETEST_LIMIT').limitPrice,100);
  assert.equal(describeGuideEntryModels().find(model=>model.id==='BREAKOUT_STOP').trigger,null);
});

test('expired, invalidated, risk rejected and conflicting outcomes stay explicit in the scenario ledger',()=>{
  const data=fixture().slice(0,26);for(let i=26;i<=28;i++)data.push(bar(i,101,101.25,100.75,101));
  const expired=describeGuideAnalysis(analyzeGuideSignals(data,options)).scenarios.find(item=>item.patternIds.includes('BULLISH_PIN_SHAPE')&&item.timing.detectedAt===data[25].closeTime);
  assert.equal(expired.status,'EXPIRED');assert.ok(expired.reasonDetails.some(item=>item.code==='CONFIRMATION_EXPIRED'));
  const broken=fixture();broken[26]=bar(26,101,101.25,97,98);
  assert.ok(describeGuideAnalysis(analyzeGuideSignals(broken,options)).scenarios.some(item=>item.status==='INVALIDATED'));
  const rejected=pin(analyzeGuideSignals(fixture(),{...options,risk:{...risk,riskBudget:10}}));
  assert.equal(rejected.status,'REJECTED');assert.equal(describeGuideAnalysis({...analyzeGuideSignals(fixture(),options),events:[rejected]}).scenarios[0].risk.quantity,0);
  // The engine's conflict resolver is represented without promoting either
  // direction. A ledger entry with this outcome must never imply an order.
  const conflict={...pin(analyzeGuideSignals(fixture(),options)),status:'AMBIGUOUS',reasonCodes:['CONFLICTING_CONFIRMED_DIRECTIONS']};
  const explained=describeGuideAnalysis({...analyzeGuideSignals(fixture(),options),events:[conflict]}).scenarios[0];
  assert.equal(explained.status,'AMBIGUOUS');assert.ok(explained.reasonDetails[0].text.includes('אין איתות'));assert.equal(explained.orderEligible,false);
});

test('higher-timeframe evidence uses only the confirmed prefix and cannot be rewritten by appended future data',()=>{
  const higher=fixture().slice(0,25).map((item,i)=>({...item,time:start-(25-i)*5*minute,closeTime:start-(24-i)*5*minute}));
  const extra={...options,higherTimeframes:{m5:{bars:higher,timeframeMs:5*minute,instrument:metadata.instrument}}};
  const before=pin(analyzeGuideSignals(fixture(),extra));
  higher.push({...higher.at(-1),time:start,closeTime:start+5*minute,knownAt:start+30*minute,high:10000,low:-1000});
  const after=pin(analyzeGuideSignals(fixture(),extra));
  assert.deepEqual(after,before);
  const available=after.contextSnapshot.higherTimeframe.availability.m5;
  assert.equal(available.availableClosedBars,25);assert.equal(available.lastAvailableKnownAt,start);assert.ok(available.lastAvailableKnownAt<=after.formationStartTime);
  assert.equal(available.policy,'CONFIRMED_AVAILABLE_PREFIX_ONLY');
});

test('risk point value must agree with explicit source instrument metadata',()=>{
  const result=analyzeGuideSignals(fixture(),{...options,risk:{...risk,pointValue:2}});
  assert.equal(result.status,'BLOCKED');assert.ok(result.reasonCodes.includes('INSTRUMENT_POINT_VALUE_MISMATCH'));assert.equal(result.signals.length,0);
  assert.equal(analyzeGuideSignals(fixture(),options).status,'SIGNALS');
});

test('reusable analyzer skips unchanged forming updates, retimes public metadata and recomputes corrections/config/available closed bars',()=>{
  const analyzer=createGuideAnalyzer(),data=fixture(),initial=analyzer.analyze(data,options);assert.equal(initial.cache.hit,false);
  const open=bar(27,102,103,101,102,{closed:false});data.push(open);
  const later={...options,asOfTime:options.asOfTime+minute};
  const cached=analyzer.analyze(data,later);assert.equal(cached.cache.hit,true);
  assert.deepEqual(withoutCache(cached),analyzeGuideSignals(data,later));
  data[27]={...data[27],high:104,close:103};assert.equal(analyzer.analyze(data,later).cache.hit,true);
  data[27]={...data[27],closed:true};assert.equal(analyzer.analyze(data,later).cache.hit,false);
  data[25]={...data[25],low:98.5};assert.equal(analyzer.analyze(data,later).cache.hit,false);
  assert.equal(analyzer.analyze(data,{...later,risk:{...risk,commissionPerContract:5}}).cache.hit,false);
  const malformed=[...data,bar(28,103,102,101,103,{closed:false})];assert.equal(analyzer.analyze(malformed,later).status,'BLOCKED');
  analyzer.clear();assert.deepEqual(analyzer.getStats(),{computations:0,hits:0,cached:false});
});

test('a later close delayed by knownAt forces a new decision only when it becomes available',()=>{
  const analyzer=createGuideAnalyzer(),data=fixture();data[26].knownAt=data[26].closeTime+2*minute;
  const before=analyzer.analyze(data,{...options,asOfTime:data[26].closeTime});assert.equal(pin(before).status,'ARMED');
  const still=analyzer.analyze(data,{...options,asOfTime:data[26].closeTime+minute});assert.equal(still.cache.hit,true);assert.equal(pin(still).status,'ARMED');
  const available=analyzer.analyze(data,{...options,asOfTime:data[26].knownAt});assert.equal(available.cache.hit,false);assert.equal(pin(available).status,'CONFIRMED');
});

test('append-only memo retains exact causal parity with cold evaluation through corrections, window shifts and source changes',()=>{
  const analyzer=createGuideAnalyzer(),data=fixture(),config={requireRisk:false};
  for(let i=27;i<55;i++){const center=105+Math.sin(i*.7)*5;data.push(bar(i,center-.25,center+1,center-1,center+.25));}
  let reused=0;
  for(let length=24;length<=data.length;length++){
    const input=data.slice(0,length),settings={...options,risk:null,config,asOfTime:input.at(-1).closeTime};
    const cached=analyzer.analyze(input,settings);reused+=cached.cache.reusedTerminalEvents??0;
    assert.deepEqual(withoutCache(cached),analyzeGuideSignals(input,settings),'prefix '+length);
  }
  assert.ok(reused>0);
  const corrected=data.map(item=>({...item}));corrected[25].low=98.5;
  const changed=analyzer.analyze(corrected,{...options,risk:null,config,asOfTime:corrected.at(-1).closeTime});assert.equal(changed.cache.appendOnly,false);assert.deepEqual(withoutCache(changed),analyzeGuideSignals(corrected,{...options,risk:null,config,asOfTime:corrected.at(-1).closeTime}));
  const shifted=corrected.slice(1),shiftOptions={...options,risk:null,config,asOfTime:shifted.at(-1).closeTime};
  const shiftedResult=analyzer.analyze(shifted,shiftOptions);assert.equal(shiftedResult.cache.appendOnly,false);assert.deepEqual(withoutCache(shiftedResult),analyzeGuideSignals(shifted,shiftOptions));
  const sourceChanged={...shiftOptions,contextConfig:{emaPeriod:10}};assert.equal(analyzer.analyze(shifted,sourceChanged).cache.appendOnly,false);
});

test('different source confirmation closes sharing one delayed delivery time remain distinct alerts',()=>{
  const data=fixture();data.push(bar(27,107,109,106,108),bar(28,109.5,111.5,108.75,109),bar(29,109,109.5,107.5,108));
  const receivedAt=start+31*minute;for(let i=26;i<data.length;i++)data[i].knownAt=receivedAt;
  const settings={...options,asOfTime:receivedAt},cold=analyzeGuideSignals(data,settings);
  const long=cold.signals.find(signal=>signal.direction==='LONG'),short=cold.signals.find(signal=>signal.direction==='SHORT');
  assert.ok(long);assert.ok(short);assert.equal(long.confirmedAt,short.confirmedAt);assert.notEqual(long.confirmationBarCloseTime,short.confirmationBarCloseTime);assert.notEqual(long.eventId,short.eventId);
  assert.ok(cold.events.every(event=>event.status!=='AMBIGUOUS'));
  const analyzer=createGuideAnalyzer();analyzer.analyze(data.slice(0,27),settings);const incremental=analyzer.analyze(data,settings);
  assert.deepEqual(withoutCache(incremental),cold);
});

test('every merged alert retains every constituent formation for causal live-session eligibility',()=>{
  const result=analyzeGuideSignals(fixture(),options);
  for(const signal of result.signals){
    assert.equal(signal.setupFormations.length,signal.setupEventIds.length);
    for(const formation of signal.setupFormations){const event=result.events.find(item=>item.eventId===formation.eventId);assert.equal(formation.formationStartTime,fixture()[event.signalStartIndex].time);assert.equal(formation.signalIndex,event.signalIndex);assert.equal(formation.confirmedAt,signal.confirmedAt);}
  }
});

test('explanation output is bounded explicitly and never mutates the underlying analysis',()=>{
  const result=analyzeGuideSignals(fixture(),options),snapshot=structuredClone(result),view=describeGuideAnalysis(result,{maxScenarios:1});
  assert.equal(view.scenarios.length,1);assert.equal(view.coverage.omittedHistoricalScenarios,result.events.length-1);
  view.market.pivots.push({fake:true});view.patternChecks[0].measurements.current.body=999;assert.deepEqual(result,snapshot);
  assert.throws(()=>describeGuideAnalysis(result,{maxScenarios:0}),/INVALID_EXPLANATION/);assert.throws(()=>describeGuideAnalysis(result,{barIndex:999}),/INVALID_EXPLANATION/);
});


test('per-strategy scan reports only each profile mandatory checks and separates context candidates from post-baseline formations',()=>{
  const result=analyzeGuideSignals(fixture(),{...options,risk:null,config:{strategyPolicy:'guide_scenarios_v1',requireRisk:false},contextConfig:{roleReversalEnabled:true,supplyDemandEnabled:true}}),before=structuredClone(result);
  const baseline=fixture().at(-1).closeTime,scan=describeGuideAnalysis(result,{liveSourceBaseline:baseline}).strategyScan;
  assert.equal(scan.profiles.length,18);assert.equal(scan.candidateEvaluations,result.events.length);assert.equal(scan.shapeDetections,result.stats.patterns);assert.equal(scan.confirmedCandles,result.signals.length);assert.equal(scan.afterBaselineCandidates,0);
  for(const p of scan.profiles){assert.deepEqual(p.requiredCheckIds,result.strategyProfiles.find(x=>x.id===p.id).requiredCheckIds);if(!p.latest)continue;assert.equal(p.latest.afterBaseline,false);assert.equal(p.latest.requiredTotal,p.requiredCheckIds.length);assert.deepEqual(p.latest.checks.map(c=>c.id).sort(),[...p.requiredCheckIds].sort());assert.equal(p.latest.requiredPassed,p.latest.checks.filter(c=>c.passed&&c.available&&c.enabled).length);}
  assert.deepEqual(result,before);assert.equal(describeGuideAnalysis(result,{barIndex:25}).strategyScan,null);assert.equal(describeGuideAnalysis(analyzeGuideSignals(fixture(),options)).strategyScan,null);
  assert.throws(()=>describeGuideAnalysis(result,{liveSourceBaseline:NaN}),/SOURCE_BASELINE/);
});
