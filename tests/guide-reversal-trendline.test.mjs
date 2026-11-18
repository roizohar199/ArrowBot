// Synthetic causal policy fixtures, not a market signal or all-filter market
// approval. Other filters remain independently enforced in the strict test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMarketContext,prepareGuideReversalTrendline,evaluateGuideReversalTrendlineBreak,projectGuideTrendline} from '../market-context.mjs';
import {analyzeGuideSignals,createGuideAnalyzer} from '../guide-signal-engine.mjs';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';
const minute=60000,start=Date.UTC(2026,0,1),bar=(i,open,high,low,close,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open,high,low,close,closed:true,...extra});
const prior=()=>[100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106].map((v,i)=>bar(i,v,v+1,v-1,v));
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const metadata={source:'ohlc',instrument:'SYNTHETIC_NAMED_REVERSAL_POLICY',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'};
const risk={riskBudget:200,pointValue:20,maxContracts:1,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2};
const config={requireTrendline:true,requireRisk:true,requireLocation:true,minConditions:2},options={metadata,config,risk};
const event=(analysis,family='HANGING_MAN_REVERSAL')=>analysis.events.find(e=>e.setupId===family&&e.signalIndex===25);
const formation=()=>[...prior(),bar(25,112,113,109,112.5)];
const complete=()=>[...formation(),bar(26,112.5,113,104.5,105)];

test('namedSHORTandLONGreversalsretainthreeconfirmedPRIORtrendtouchesandrequirealaterclosedbreak',()=>{
  for(const inverse of [false,true]){
    const family=inverse?'INVERTED_HAMMER_REVERSAL':'HANGING_MAN_REVERSAL',bars=inverse?mirror(complete()):complete(),before=analyzeGuideSignals(bars.slice(0,26),options),pending=event(before,family),analysis=analyzeGuideSignals(bars,options),confirmed=event(analysis,family);
    assert.equal(pending.status,'ARMED');assert.equal(pending.contextSnapshot.passed,false);assert.deepEqual(pending.contextSnapshot.pendingRequiredChecks,['TRENDLINE']);assert.equal(pending.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').state,'PENDING');
    assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.direction,inverse?'LONG':'SHORT');assert.equal(confirmed.confirmedAt,bars[26].closeTime);assert.equal(confirmed.riskPlan.quantity,1);assert.equal(confirmed.riskPlan.totalPlannedRisk,178.1);assert.equal(confirmed.riskPlan.initialStop,confirmed.invalidation);
    const check=confirmed.contextSnapshot.checks.find(c=>c.id==='TRENDLINE'),gate=confirmed.contextSnapshot.reversalTrendlineGate;
    assert.equal(check.state,'PASS');assert.equal(check.passed,true);assert.equal(check.evidence.minimumTouches,3);assert.equal(check.evidence.priorLineType,inverse?'RESISTANCE':'SUPPORT');assert.equal(check.evidence.confirmation.confirmedAt,bars[26].closeTime);assert.equal(gate.lines[0].touches,3);assert.ok(gate.lines[0].thirdTouchKnownAt<=bars[25].time);assert.ok(gate.lines[0].anchorIds.every(id=>confirmed.contextSnapshot.context.pivots.find(p=>p.id===id).knownAt<=bars[25].time));
    const explained=describeGuideAnalysis(analysis).scenarios.find(s=>s.eventId===confirmed.eventId);assert.match(explained.conditions.find(c=>c.id==='TRENDLINE').rule,/המגמה הקודמת/);assert.equal(confirmed.orderEligible,false);
  }
});
test('patterntriggerwithoutthefrozenlinebreakremainsPENDINGuntilbothholdonthesamelaterclosedbar',()=>{
  const bars=[...formation(),bar(26,112.5,113,108,108.5)],waiting=event(analyzeGuideSignals(bars,options));assert.ok(bars[26].close<waiting.trigger);assert.equal(waiting.status,'ARMED');assert.equal(waiting.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').passed,false);
  bars.push(bar(27,108.5,109,104,104.75));const done=event(analyzeGuideSignals(bars,options));assert.equal(done.status,'CONFIRMED');assert.equal(done.confirmedAt,bars[27].closeTime);
  const wide=[...prior(),bar(25,112,113,102,112.5),bar(26,112.5,113,104,104.5)],a=event(analyzeGuideSignals(wide,{...options,risk:null,config:{...config,requireRisk:false}}));assert.equal(a.status,'ARMED');assert.ok(a.contextSnapshot.reversalTrendlineGate.lines.length);assert.ok(wide[26].close>a.trigger);
});
test('missing/broken/two-touch/futureanchorsorwrongpriortrendcannotmanufactureanavailablegate',()=>{
  const context=analyzeMarketContext(prior(),{tickSize:.25}),args={family:'HANGING_MAN_REVERSAL',direction:'SHORT',freezeTime:start+25*minute,formationCloseTime:start+26*minute,minTouches:3,tickSize:.25,breakBufferTicks:1};assert.equal(prepareGuideReversalTrendline(context,args).available,true);
  for(const edit of [c=>{c.trendlines=[];},c=>{c.trendlines.find(l=>l.type==='SUPPORT').active=false;},c=>{c.trendlines.find(l=>l.type==='SUPPORT').touches=2;},c=>{const l=c.trendlines.find(l=>l.type==='SUPPORT');c.pivots.find(p=>p.id===l.anchorIds[0]).knownAt=args.freezeTime+1;},c=>{const l=c.trendlines.find(l=>l.type==='SUPPORT');c.pivots.find(p=>p.id===l.thirdTouchId).knownAt=args.freezeTime+1;},c=>{c.state='TREND_DOWN';}]){const changed=structuredClone(context);edit(changed);assert.equal(prepareGuideReversalTrendline(changed,args).available,false,edit.toString());}
  assert.equal(prepareGuideReversalTrendline(context,{...args,direction:'LONG'}).available,false);
});
test('strictbuffer,closedtimingandfrozenlineprojectionexcludewicksopensfutureanchorsandlinefitting',()=>{
  const context=analyzeMarketContext(prior(),{tickSize:.25}),args={family:'HANGING_MAN_REVERSAL',direction:'SHORT',freezeTime:start+25*minute,formationCloseTime:start+26*minute,minTouches:3,tickSize:.25,breakBufferTicks:1},gate=prepareGuideReversalTrendline(context,args),price=projectGuideTrendline(gate.lines[0],{index:26,time:start+26*minute}),atThreshold=bar(26,106,107,104,price-.25);
  assert.equal(evaluateGuideReversalTrendlineBreak(gate,atThreshold,{index:26}).passed,false);const below={...atThreshold,close:price-.5};assert.equal(evaluateGuideReversalTrendlineBreak(gate,below,{index:26}).passed,true);
  assert.equal(evaluateGuideReversalTrendlineBreak(gate,{...below,closed:false},{index:26}).passed,false);const provisional=evaluateGuideReversalTrendlineBreak(gate,{...below,closed:false},{index:26,provisional:true});assert.equal(provisional.observedBreak,true);assert.equal(provisional.passed,false);assert.equal(evaluateGuideReversalTrendlineBreak(gate,{...below,time:start+25*minute},{index:25}).passed,false);
  const frozen=structuredClone(gate);context.trendlines[0].slope=900;assert.deepEqual(gate,frozen);
});
test('allsevenmandatoryflagsandothercontextfailuresremaininforceunderthefamily-specificpolicy',()=>{
  const flags=['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'],strict={...options,config:{...config,...Object.fromEntries(flags.map(k=>[k,true]))},contextConfig:{roleReversalEnabled:true,supplyDemandEnabled:true}},analysis=analyzeGuideSignals(complete(),strict),named=event(analysis);
  assert.ok(flags.every(k=>named.parameterSnapshot.config[k]===true));assert.equal(named.parameterSnapshot.contextConfig.trendlineMinTouches,3);assert.equal(named.status,'REJECTED');assert.ok(named.reasonCodes.includes('MISSING_HIGHER_TIMEFRAME'));assert.ok(named.reasonCodes.includes('MISSING_EMA'));assert.equal(named.contextSnapshot.checks.find(c=>c.id==='TRENDLINE').passed,false);assert.equal(analysis.signals.some(s=>s.setupId==='HANGING_MAN_REVERSAL'),false);
});
test('formingpricecanpreviewthefrozenlinebreakwithoutapprovingorsilentlyrewritingtheclosedsetup',()=>{
  const bars=formation(),closedAnalysis=analyzeGuideSignals(bars,options),before=structuredClone(event(closedAnalysis)),preview=createGuideFormingPreview(),open={...bar(26,112.5,113,104.5,108.5),closed:false};
  const one=preview.analyze(open,{closedBars:bars,closedAnalysis,...options,asOfTime:open.time+10000}),waiting=one.pendingConfirmations.find(e=>e.family==='HANGING_MAN_REVERSAL');assert.ok(waiting);assert.equal(waiting.checks.find(c=>c.id==='TRENDLINE').state,'PENDING');
  const two=preview.analyze({...open,close:105},{closedBars:bars,closedAnalysis,...options,asOfTime:open.time+20000}),moving=two.pendingConfirmations.find(e=>e.family==='HANGING_MAN_REVERSAL'),check=moving.checks.find(c=>c.id==='TRENDLINE');assert.equal(check.passed,true);assert.equal(check.provisional,true);assert.equal(check.evidence.provisionalBreak.passed,false);assert.equal(moving.signalApproved,false);assert.equal(two.signalApproved,false);assert.deepEqual(event(closedAnalysis),before);
});
test('futurebarsandappendcachecannotrewriteaconfirmednamedreversalorfrozenanchors',()=>{
  const bars=complete(),analyzer=createGuideAnalyzer(),one=analyzer.analyze(bars,options),future=[...bars,bar(27,105,900,1,850)],two=analyzer.analyze(future,options),uncached=analyzeGuideSignals(future,options),e=event(one);assert.deepEqual(event(two),e);assert.deepEqual(event(uncached),e);assert.equal(two.cache.appendOnly,true);
});
