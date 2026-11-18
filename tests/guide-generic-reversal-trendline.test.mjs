// Synthetic causal component contracts. These fixtures are not market data,
// natural all-filter approval, broker fills or an execution benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeGuideSignals,createGuideAnalyzer,GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
import {analyzeMarketContext,prepareGuideReversalTrendline,evaluateGuideReversalTrendlineBreak} from '../market-context.mjs';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';

const minute=60000,start=Date.UTC(2026,0,1);
const bar=(i,open,high,low,close)=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true});
const prior=()=>[100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106].map((v,i)=>bar(i,v,v+1,v-1,v));
const formation=()=>[...prior(),bar(25,110,113,109.25,109.5)];
const complete=()=>[...formation(),bar(26,109.5,110,108,108.5),bar(27,108.5,109,104.5,105)];
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const metadata={source:'ohlc',instrument:'SYNTHETIC_GENERIC_REVERSAL_POLICY',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'};
const risk={riskBudget:200,pointValue:20,maxContracts:1,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2};
const options={metadata,risk,config:{requireTrendline:true,requireRisk:true,requireLocation:true,minConditions:2}};
const generic=analysis=>analysis.events.find(e=>e.signalIndex===25&&e.setupId==='REVERSAL_AT_ZONE');

test('generic LONG and SHORT reversal require a frozen prior-trend three-touch line and the same later closed pattern break',()=>{
  assert.equal(GUIDE_SIGNAL_VERSION,'guide-signals-5');
  for(const inverse of [false,true]){
    const bars=inverse?mirror(complete()):complete(),armed=generic(analyzeGuideSignals(bars.slice(0,26),options)),waiting=generic(analyzeGuideSignals(bars.slice(0,27),options)),analysis=analyzeGuideSignals(bars,options),done=generic(analysis);
    assert.ok(armed);assert.equal(armed.status,'ARMED');assert.equal(armed.contextSnapshot.passed,false);
    assert.equal(armed.contextSnapshot.reversalTrendlineGate.family,'REVERSAL_AT_ZONE');assert.equal(armed.contextSnapshot.reversalTrendlineGate.lineType,inverse?'RESISTANCE':'SUPPORT');
    assert.equal(waiting.status,'ARMED');assert.equal(waiting.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').passed,false);
    assert.ok(inverse?bars[26].close>waiting.trigger:bars[26].close<waiting.trigger,'the ordinary pattern trigger alone is insufficient');
    assert.equal(done.status,'CONFIRMED');assert.equal(done.confirmedAt,bars[27].closeTime);assert.equal(done.direction,inverse?'LONG':'SHORT');
    const check=done.contextSnapshot.checks.find(c=>c.id==='TRENDLINE'),gate=done.contextSnapshot.reversalTrendlineGate;
    assert.equal(check.state,'PASS');assert.equal(check.evidence.reversalFamily,'REVERSAL_AT_ZONE');assert.equal(check.evidence.confirmation.confirmedAt,done.confirmedAt);
    assert.equal(gate.lines[0].touches,3);assert.ok(gate.lines[0].thirdTouchKnownAt<=bars[25].time);assert.deepEqual(gate,armed.contextSnapshot.reversalTrendlineGate);
    assert.equal(done.riskPlan.initialStop,done.invalidation);assert.equal(done.riskPlan.quantity,1);assert.equal(done.riskPlan.totalPlannedRisk,178.1);assert.equal(done.orderEligible,false);
    const explained=describeGuideAnalysis(analysis).scenarios.find(e=>e.eventId===done.eventId);assert.match(explained.conditions.find(c=>c.id==='TRENDLINE').rule,/המגמה הקודמת/);
  }
});

test('unavailable, two-touch, broken or future prior lines cannot be promoted by a generic reversal',()=>{
  const context=analyzeMarketContext(prior(),{tickSize:.25}),args={family:'REVERSAL_AT_ZONE',direction:'SHORT',freezeTime:start+25*minute,formationCloseTime:start+26*minute,tickSize:.25,minTouches:3};
  assert.equal(prepareGuideReversalTrendline(context,args).available,true);
  for(const mutate of [c=>{c.trendlines=[];},c=>{c.trendlines.find(l=>l.type==='SUPPORT').touches=2;},c=>{c.trendlines.find(l=>l.type==='SUPPORT').invalidatedAt=args.freezeTime;},c=>{c.pivots.find(p=>p.id===c.trendlines.find(l=>l.type==='SUPPORT').thirdTouchId).knownAt=args.freezeTime+1;}]){
    const altered=structuredClone(context);mutate(altered);assert.equal(prepareGuideReversalTrendline(altered,args).available,false);
  }
  assert.equal(prepareGuideReversalTrendline(context,{...args,direction:'LONG'}).available,false);
  const unavailable=prepareGuideReversalTrendline({...context,trendlines:[]},args);assert.equal(evaluateGuideReversalTrendlineBreak(unavailable,complete().at(-1),{index:27}).passed,false);
});

test('all seven mandatory flags and risk remain unchanged; unrelated missing context still rejects generic reversal',()=>{
  const flags=['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'],strict={...options,config:{...options.config,...Object.fromEntries(flags.map(k=>[k,true]))},contextConfig:{roleReversalEnabled:true,supplyDemandEnabled:true}},analysis=analyzeGuideSignals(complete(),strict),event=generic(analysis);
  assert.ok(event);assert.ok(flags.every(k=>event.parameterSnapshot.config[k]===true));assert.equal(event.parameterSnapshot.contextConfig.trendlineMinTouches,3);
  assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('MISSING_EMA'));assert.ok(event.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));assert.equal(event.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').state,'PENDING');
  assert.equal(analysis.signals.some(s=>s.eventId===event.eventId),false);assert.equal(event.riskPlan,null);
});

test('generic forming observations show the frozen line pending or provisionally crossed without approving the event',()=>{
  const bars=formation(),closedAnalysis=analyzeGuideSignals(bars,options),event=generic(closedAnalysis),original=structuredClone(event),preview=createGuideFormingPreview(),open={...bar(26,109.5,110,104.5,108.5),closed:false};
  const waiting=preview.analyze(open,{closedBars:bars,closedAnalysis,...options,asOfTime:open.time+10000}).pendingConfirmations.find(s=>s.eventId===event.eventId);
  assert.ok(waiting);assert.equal(waiting.checks.find(c=>c.id==='TRENDLINE').state,'PENDING');
  const crossed=preview.analyze({...open,close:105},{closedBars:bars,closedAnalysis,...options,asOfTime:open.time+20000}).pendingConfirmations.find(s=>s.eventId===event.eventId),check=crossed.checks.find(c=>c.id==='TRENDLINE');
  assert.equal(check.passed,true);assert.equal(check.provisional,true);assert.equal(check.evidence.provisionalBreak.passed,false);assert.equal(crossed.signalApproved,false);assert.deepEqual(generic(closedAnalysis),original);
});

test('continuation, role-reversal and range-specific candidates do not acquire the generic prior-line policy',()=>{
  const bars=[...prior(),bar(25,106.5,107,104.25,106.75)],analysis=analyzeGuideSignals(bars,{...options,config:{...options.config,requireLocation:false,requireRisk:false},contextConfig:{roleReversalEnabled:true}}),continuation=analysis.events.find(e=>e.signalIndex===25&&e.direction==='LONG'&&e.setupId==='TREND_CONTINUATION');
  assert.ok(continuation);assert.equal(continuation.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').passed,true);assert.equal(continuation.contextSnapshot.reversalTrendlineGate,undefined);
  for(const event of analysis.events.filter(e=>['ROLE_REVERSAL_RETEST','ENGULFING_RANGE_RECLAIM'].includes(e.setupId)))assert.equal(event.contextSnapshot.reversalTrendlineGate,undefined);
  const role=analyzeGuideSignals(complete(),{...options,contextConfig:{roleReversalEnabled:true}}).events.filter(e=>e.signalIndex===25&&e.setupId==='ROLE_REVERSAL_RETEST');assert.ok(role.length);assert.ok(role.every(e=>e.contextSnapshot.reversalTrendlineGate===undefined));
});

test('generic confirmation, structural stop and anchor identity survive future appends and the append-only cache',()=>{
  const bars=complete(),analyzer=createGuideAnalyzer(),first=analyzer.analyze(bars,options),original=generic(first),future=[...bars,bar(28,105,900,1,850)],cached=analyzer.analyze(future,options),uncached=analyzeGuideSignals(future,options);
  assert.equal(original.status,'CONFIRMED');assert.deepEqual(generic(cached),original);assert.deepEqual(generic(uncached),original);assert.equal(cached.cache.appendOnly,true);
  const noLine=generic(analyzeGuideSignals(bars,{...options,config:{...options.config,requireTrendline:false}}));assert.equal(noLine.confirmedAt,bars[26].closeTime,'an explicitly optional line retains the old price-only confirmation model');
});
