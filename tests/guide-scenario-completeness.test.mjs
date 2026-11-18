import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCandlePatterns,analyzeCandlePatternTail} from '../candle-patterns.mjs';
import {analyzeMarketContext,analyzeInsideSequence,projectGuideTrendline} from '../market-context.mjs';
import {analyzeGuideSignals,createGuideAnalyzer} from '../guide-signal-engine.mjs';
import {describeGuideAnalysis} from '../guide-explanations.mjs';
import {deriveVerifiedSessionGaps} from '../session-gap-proof.mjs';

const minute=60000,start=Date.UTC(2026,0,1),meta={source:'ohlc',instrument:'SYNTHETIC_GUIDE',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'};
const bar=(i,o,h,l,c,extra={})=>({time:start+i*minute,closeTime:start+(i+1)*minute,open:o,high:h,low:l,close:c,closed:true,...extra});
const rows=values=>values.map((v,i)=>bar(i,v,v+1,v-1,v));
const range=()=>rows([105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105]);
const rise=()=>rows([100,105,110,105,101,106,110.5,106,102,107,111,107,103,108,111.5,108,104,109,112,109,105,110,112.5,110,106]);
const risingWide=()=>rows([100,104,108,104,101,105,110,105,102,106,112,106,103,107,114,107,104,108,116,108,105,109,118,109,106]);
const mirror=bars=>bars.map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close}));
const run=(bars,extra={})=>analyzeGuideSignals(bars,{metadata:meta,config:{requireRisk:false,requireLocation:false,minConditions:1},...extra});
const generic=(value,index,direction='LONG')=>value.events.find(event=>event.signalIndex===index&&event.direction===direction&&!['HANGING_MAN_REVERSAL','INVERTED_HAMMER_REVERSAL','ENGULFING_RANGE_RECLAIM'].includes(event.setupId));

test('Hanging Man SHORT and Inverted Hammer LONG have independent contextual events, later-close confirmation and wrong-context rejection',()=>{
  const data=[...rise(),bar(25,112,113,109,112.5),bar(26,112.5,113,108,108.5)],opts={contextConfig:{zoneToleranceTicks:4}};
  const hanging=run(data,opts).events.find(event=>event.setupId==='HANGING_MAN_REVERSAL'&&event.signalIndex===25);assert.ok(hanging);assert.equal(hanging.direction,'SHORT');assert.equal(hanging.status,'CONFIRMED');assert.equal(hanging.confirmedAt,data[26].closeTime);assert.equal(hanging.scenarioApplicability.requiredPriorState,'TREND_UP');assert.equal(hanging.scenarioApplicability.contextualName,'HANGING_MAN');
  const inverse=run(mirror(data),opts).events.find(event=>event.setupId==='INVERTED_HAMMER_REVERSAL'&&event.signalIndex===25);assert.ok(inverse);assert.equal(inverse.direction,'LONG');assert.equal(inverse.status,'CONFIRMED');assert.equal(inverse.scenarioApplicability.requiredPriorState,'TREND_DOWN');
  const wrong=[...mirror(rise()),bar(25,107.5,108.5,104.5,108)];const rejected=run(wrong,opts).events.find(event=>event.setupId==='HANGING_MAN_REVERSAL'&&event.signalIndex===25);assert.equal(rejected.status,'REJECTED');assert.ok(rejected.reasonCodes.includes('CONTEXTUAL_PATTERN_REQUIRES_TREND_UP'));assert.equal(rejected.contextSnapshot.checks.find(check=>check.id==='STRUCTURE').passed,false);
  const before=run(data,opts),after=run([...data,bar(27,108,9000,1,8000)],opts);assert.deepEqual(after.signals.filter(signal=>signal.confirmationBarCloseTime===data[26].closeTime),before.signals.filter(signal=>signal.confirmationBarCloseTime===data[26].closeTime));
});

test('a frozen trend pivot break invalidates continuation even when location is optional and the original stop was untouched',()=>{
  const data=[...risingWide(),bar(25,105.5,107,100,106),bar(26,106,106.5,102,103),bar(27,103,109,102,108)],event=generic(run(data),25);
  assert.equal(event.contextSnapshot.context.state,'TREND_UP');assert.equal(event.invalidation,99.75);assert.equal(event.status,'INVALIDATED');assert.deepEqual(event.reasonCodes,['FROZEN_STRUCTURE_BROKEN']);assert.equal(event.invalidatedAt,data[26].closeTime);assert.equal(event.confirmedAt,null);
});

test('EMA distance is an explicit variant and signal-close evaluation is separate from the frozen previous reference',()=>{
  const data=[...rise(),bar(25,120,121,115,120.5)],base={emaProximityMode:'ticks',emaProximityTicks:2};
  const event=generic(run(data,{config:{requireRisk:false,requireLocation:false,minConditions:1,requireEma:true},contextConfig:base}),25),check=event.contextSnapshot.checks.find(check=>check.id==='EMA');
  assert.equal(check.evidence.directionPassed,true);assert.equal(check.evidence.proximityPassed,false);assert.equal(check.state,'FAIL');assert.ok(check.evidence.distance>check.evidence.tolerance);assert.equal(event.status,'REJECTED');
  const signal=generic(run(data,{contextConfig:{...base,emaProximityTicks:100,emaEvaluation:'signal_close'}}),25).contextSnapshot.checks.find(check=>check.id==='EMA');assert.equal(signal.evidence.evaluation,'signal_close');assert.equal(signal.evidence.knownAt,data[25].closeTime);assert.notEqual(signal.evidence.ema,check.evidence.ema);assert.equal(signal.evidence.proximityPassed,true);assert.ok(check.evidence.knownAt<=data[25].time);
});

test('Harami equality and prior-ATR Tweezer tolerances are explicit and future volatility cannot rewrite a pair',()=>{
  const harami=[bar(0,108,109,99,100),bar(1,100,104,99,103)];assert.equal(analyzeCandlePatterns(harami,{tickSize:.25}).byBar[1].checks.BULLISH_HARAMI.matched,true);assert.equal(analyzeCandlePatterns(harami,{tickSize:.25,allowEqualHaramiEdges:false}).byBar[1].checks.BULLISH_HARAMI.matched,false);
  const data=[...rows([100,100,100]),bar(3,105,106,100,102),bar(4,102,105,100.5,104)],config={tickSize:.25,tweezerAtrPeriod:3,tweezerToleranceMode:'atr',tweezerToleranceAtr:.5};
  assert.equal(analyzeCandlePatterns(data,{tickSize:.25}).byBar[4].checks.TWEEZER_BOTTOM.matched,false);const before=analyzeCandlePatterns(data,config),pattern=before.patterns.find(pattern=>pattern.id==='TWEEZER_BOTTOM'&&pattern.endIndex===4);assert.ok(pattern);assert.equal(pattern.evidence.priorAtr,2);assert.equal(pattern.evidence.tolerance,1);assert.equal(pattern.evidence.distanceTicks,2);
  const after=analyzeCandlePatterns([...data,bar(5,104,10000,1,9000)],config);assert.deepEqual(after.patterns.filter(pattern=>pattern.endIndex===4),before.patterns.filter(pattern=>pattern.endIndex===4));data[2].knownAt=data[3].time+1;assert.equal(analyzeCandlePatterns(data,config).byBar[4].checks.TWEEZER_BOTTOM.matched,false);
});

test('Inside-reference breakout can be confirmed while still inside its mother; touch research is never eligible for final approval',()=>{
  const data=[...rise(),bar(25,105,114,104,110),bar(26,110,112,106,111),bar(27,111,113.5,110,113.25),bar(28,113.25,113.75,112.75,113.5)],contextConfig={insideBreakoutReference:'inside'};
  const studies=run(data,{contextConfig}),event=studies.events.find(event=>event.patternIds.includes('INSIDE_BREAKOUT')&&event.signalIndex===27);assert.ok(event);assert.equal(event.status,'CONFIRMED');assert.equal(event.breakoutReference.mode,'inside');assert.equal(event.breakoutReference.high,112);assert.equal(event.trigger,112.25);assert.ok(event.confirmationClose<114);
  const mother=run(data).insideStudies.breakout.events;assert.ok(!mother.some(event=>event.barIndex===27));
  const touch=run(data,{contextConfig:{...contextConfig,insideConfirmationMode:'touch_research'}});const observed=touch.insideStudies.breakout.events.find(event=>event.barIndex===27);assert.ok(observed);assert.equal(observed.researchOnly,true);assert.equal(observed.eligibleForConfirmation,false);assert.equal(observed.fillInferred,false);assert.ok(!touch.events.some(event=>event.patternIds.includes('INSIDE_BREAKOUT')&&event.signalIndex===27));
});

test('trendline projection has explicit linear/log and time/index coordinates without changing anchor availability',()=>{
  const data=rise(),a=analyzeMarketContext(data,{tickSize:.25,zoneToleranceTicks:8}),b=analyzeMarketContext(data,{tickSize:.25,zoneToleranceTicks:8,trendlineScale:'logarithmic',trendlineTimeBasis:'time'}),line=b.trendlines.find(line=>line.type==='SUPPORT');assert.ok(line);assert.equal(line.scale,'logarithmic');assert.equal(line.timeBasis,'time');assert.equal(line.knownAt,a.trendlines.find(line=>line.type==='SUPPORT').knownAt);
  for(const id of line.anchorIds){const pivot=b.pivots.find(pivot=>pivot.id===id);assert.ok(Math.abs(projectGuideTrendline(line,{time:pivot.time,index:pivot.index})-pivot.price)<1e-10);}assert.equal(projectGuideTrendline({...line,originValue:Infinity},{time:data.at(-1).time}),null);
  const log={scale:'logarithmic',timeBasis:'bar_index',originCoordinate:0,originValue:Math.log(100),slope:Math.log(1.1)/10};assert.ok(Math.abs(projectGuideTrendline(log,{index:20})-121)<1e-10);
});

test('engulfing stops and range target policies preserve their selected structural reference',()=>{
  const data=[...rise(),bar(25,111,112,100,105),bar(26,104.75,113,104,112.5),bar(27,112.5,114,112,113.5)],risk={riskBudget:1000,pointValue:20,commissionPerContract:0,slippageTicks:0,maxContracts:1,rewardRisk:2};
  const full=run(data,{risk}).events.find(event=>event.signalIndex===26&&event.patternIds.includes('BULLISH_ENGULFING')&&event.setupId!=='ENGULFING_RANGE_RECLAIM'),second=run(data,{risk,config:{requireRisk:true,requireLocation:false,minConditions:1,engulfingStopReference:'signal_bar'}}).events.find(event=>event.signalIndex===26&&event.patternIds.includes('BULLISH_ENGULFING')&&event.setupId!=='ENGULFING_RANGE_RECLAIM');assert.equal(full.invalidation,99.75);assert.equal(second.invalidation,103.75);assert.equal(second.stopReference.mode,'signal_bar');assert.equal(second.riskPlan.initialStop,103.75);
  const rangeData=[...range(),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)],rangeRisk={...risk,minRewardRisk:.5};
  const mid=generic(run(rangeData,{risk:rangeRisk,config:{requireRisk:true,rangeTargetPolicy:'range_midpoint'}}),25),opposite=generic(run(rangeData,{risk:rangeRisk,config:{requireRisk:true,rangeTargetPolicy:'opposite_boundary'}}),25);assert.equal(mid.riskPlan.target,105);assert.equal(mid.riskPlan.researchTargetPolicy,'range_midpoint');assert.equal(opposite.riskPlan.target,110.75);assert.equal(opposite.riskPlan.status,'PLANNED');assert.equal(mid.invalidation,opposite.invalidation);
});

test('engulfing return-to-range is independent of edge rejection and keeps future broken-range invalidation',()=>{
  const data=[...range(),bar(25,100,101,96,97),bar(26,96.75,103,96.5,102),bar(27,102,104,101,103.5)],value=run(data),event=value.events.find(event=>event.setupId==='ENGULFING_RANGE_RECLAIM'&&event.signalIndex===26);
  assert.ok(event);assert.equal(event.status,'CONFIRMED');assert.equal(event.contextSnapshot.context.state,'RANGE');assert.equal(event.contextSnapshot.checks.find(check=>check.id==='STRUCTURE').evidence.rangeReclaim,true);assert.equal(event.formationStartTime,data[25].time);
  const broken=[...data.slice(0,27),bar(27,102,102,96,97),bar(28,97,105,97,104)];const invalid=run(broken).events.find(item=>item.eventId===event.eventId);assert.equal(invalid.status,'INVALIDATED');assert.deepEqual(invalid.reasonCodes,['FROZEN_RANGE_BROKEN']);
});

test('optional signal/mother ATR width filters expose unavailability and reject oversized candidates without shrinking their stops',()=>{
  const data=[...range(),bar(25,100.5,101.25,98.75,101)],event=generic(run(data,{config:{requireRisk:false,maxSignalRangeAtr:.01}}),25);assert.equal(event.status,'REJECTED');assert.ok(event.reasonCodes.includes('SIGNAL_RANGE_EXCEEDS_PRIOR_ATR'));assert.equal(event.invalidation,98.5);
  const mother=[...rows(Array(15).fill(100)),bar(15,100,120,90,110),bar(16,110,115,95,112)],study=analyzeInsideSequence(mother,{tickSize:.25,insideMaxMotherRangeAtr:2});assert.equal(study.sequences.at(-1).phase,'MOTHER_RANGE_FILTER');assert.equal(study.active,null);
});

test('role reversal is an opt-in original research rule, known after a break and independently invalidated after retest',()=>{
  const data=[...range(),bar(25,100,101,95,96),bar(26,98.5,102,97.25,97.5),bar(27,97.5,98,95.5,96.5)],options={contextConfig:{roleReversalEnabled:true}},value=run(data,options),event=value.events.find(event=>event.setupId==='ROLE_REVERSAL_RETEST'&&event.signalIndex===26&&event.direction==='SHORT');assert.ok(event);assert.equal(event.status,'CONFIRMED');const zone=event.contextSnapshot.location.zones.find(zone=>zone.roleReversal);assert.ok(zone);assert.equal(zone.type,'RESISTANCE');assert.equal(zone.knownAt,data[25].closeTime);assert.ok(zone.knownAt<=data[26].time);assert.equal(zone.sourceKind,'original_research_definition');assert.equal(run(data).events.some(event=>event.setupId==='ROLE_REVERSAL_RETEST'),false);
  const broken=[...data.slice(0,27),bar(27,97.5,101,97,100.5),bar(28,100.5,101,94,95)];const after=run(broken,options).events.find(item=>item.eventId===event.eventId);assert.equal(after.status,'INVALIDATED');assert.ok(after.reasonCodes.includes('FROZEN_ROLE_REVERSAL_BROKEN'));assert.equal(after.confirmedAt,null);
  const expired=[...data];for(let index=28;index<130;index++)expired.push(bar(index,96,97,95,96));const context=analyzeMarketContext(expired,{tickSize:.25,roleReversalEnabled:true}),old=context.zones.find(item=>item.id===zone.id);assert.ok(old);assert.equal(old.expired,true);assert.equal(old.active,false);
});

test('top-down structure15/location5 policy differs from all-HTFs-aligned and cannot borrow a future zone',()=>{
  const data=[...range(),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)],higherRows=(bars,duration)=>bars.map((bar,index)=>({...bar,time:start-(bars.length-index)*duration,closeTime:start-(bars.length-index-1)*duration})),higherTimeframes={m15:{bars:higherRows(rise(),15*minute),timeframeMs:15*minute,instrument:meta.instrument},m5:{bars:higherRows(range(),5*minute),timeframeMs:5*minute,instrument:meta.instrument}};
  const all=generic(run(data,{higherTimeframes,config:{requireRisk:false,requireHigherTimeframe:true}}),25),top=generic(run(data,{higherTimeframes,config:{requireRisk:false,requireHigherTimeframe:true,higherTimeframePolicy:'structure_and_location'}}),25);assert.equal(all.contextSnapshot.checks.find(check=>check.id==='HIGHER_TIMEFRAME').passed,false);assert.equal(top.contextSnapshot.checks.find(check=>check.id==='HIGHER_TIMEFRAME').passed,true);assert.equal(top.contextSnapshot.higherTimeframe.policyEvaluation.structureTimeframe,'m15');assert.equal(top.contextSnapshot.higherTimeframe.policyEvaluation.locationTimeframe,'m5');assert.equal(top.status,'CONFIRMED');
  const future=structuredClone(higherTimeframes);future.m5.bars.at(-1).knownAt=data[25].time+1;const delayed=generic(run(data,{higherTimeframes:future,config:{requireRisk:false,requireHigherTimeframe:true,higherTimeframePolicy:'structure_and_location'}}),25);assert.ok(delayed.contextSnapshot.higherTimeframe.availability.m5.lastAvailableKnownAt<=data[25].time);
});

test('verified session history can inform context but candles, Inside sequences and pending confirmation do not span a boundary by default',()=>{
  const data=[...range(),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)].map((bar,index)=>({...bar,providerBarIndex:500+index,sessionFirst:index===0,sessionLast:index===13}));for(let index=14;index<data.length;index++){data[index].time+=24*60*minute;data[index].closeTime+=24*60*minute;}data[14].sessionFirst=true;const proof=deriveVerifiedSessionGaps(data);assert.equal(proof.valid,true);const metadata={...meta,sessionGaps:proof.gaps},value=run(data,{metadata});assert.notEqual(value.status,'BLOCKED');assert.equal(value.context.barsUsed,27);assert.equal(generic(value,25).status,'CONFIRMED');assert.ok(value.patterns.patterns.every(pattern=>pattern.startIndex===pattern.endIndex||!(pattern.startIndex<=13&&pattern.endIndex>=14)));
  const missing=structuredClone(data);missing[14].providerBarIndex++;assert.equal(run(missing,{metadata}).status,'BLOCKED');
  const sequence=[bar(0,105,110,100,106,{providerBarIndex:1,sessionFirst:true,sessionLast:false}),bar(1,105,108,102,103,{providerBarIndex:2,sessionFirst:false,sessionLast:true}),bar(10,103,109,99,103,{providerBarIndex:3,sessionFirst:true,sessionLast:false})],gap=deriveVerifiedSessionGaps(sequence);const inside=analyzeInsideSequence(sequence,{tickSize:1,sessionGaps:gap.gaps});assert.equal(inside.events.length,0);assert.equal(inside.sequences[0].phase,'SESSION_BOUNDARY');
  const cache=createGuideAnalyzer();cache.analyze(data,{metadata,config:{requireRisk:false}});assert.equal(cache.analyze(data,{metadata,config:{requireRisk:false}}).cache.hit,true);assert.equal(cache.analyze(missing,{metadata,config:{requireRisk:false}}).status,'BLOCKED');
});

test('bounded forming tail uses exact cached Wilder ATR and remains provisional, including a Doji-middle Star',()=>{
  const data=[...rows(Array(14).fill(100)),bar(14,104,105,99,100),bar(15,99.5,100.5,98.5,99.5)],closedPatterns=analyzeCandlePatterns(data,{tickSize:.25}),open=bar(16,99.75,104,99,103,{closed:false}),asOfTime=open.time+10000;
  const tail=analyzeCandlePatternTail(open,{closedBars:data,closedPatterns,asOfTime}),full=analyzeCandlePatterns([...data,{...open,knownAt:asOfTime}],{tickSize:.25,mode:'preview',asOfTime}),star=tail.patterns.find(pattern=>pattern.id==='MORNING_STAR');assert.ok(star);assert.equal(star.evidence.priorAtr,closedPatterns.atr[13]);assert.equal(star.evidence.subtype,'MORNING_DOJI_STAR');assert.equal(tail.barsEvaluated,3);assert.equal(tail.atrSeedPolicy,'EXACT_CLOSED_ANALYSIS_PREFIX');assert.deepEqual(tail.patterns.map(pattern=>pattern.id),full.patterns.filter(pattern=>pattern.endIndex===16).map(pattern=>pattern.id));assert.ok(tail.patterns.every(pattern=>pattern.final===false&&pattern.eligibleForConfirmation===false&&pattern.knownAt===asOfTime));
  const changed=structuredClone(data);changed[15].close+=.25;assert.equal(analyzeCandlePatternTail(open,{closedBars:changed,closedPatterns,asOfTime}).status,'UNAVAILABLE');assert.equal(analyzeCandlePatternTail({...open,closed:true},{closedBars:data,closedPatterns,asOfTime}).status,'UNAVAILABLE');
});
