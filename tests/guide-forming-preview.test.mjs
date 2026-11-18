import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuideFormingPreview} from '../guide-forming-preview.mjs';
import {analyzeGuideSignals} from '../guide-signal-engine.mjs';
import {calculateIndicators} from '../market-context.mjs';

const minute=60000,start=Date.UTC(2026,0,1),metadata={source:'ohlc',instrument:'SYNTHETIC_PREVIEW',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,timezone:'UTC',session:'research',chartType:'standard'},config={requireRisk:false,requireLocation:false,minConditions:1};
const bar=(index,open,high,low,close,extra={})=>({time:start+index*minute,closeTime:start+(index+1)*minute,open,high,low,close,closed:true,...extra});
const values=[100,104,108,104,101,105,110,105,102,106,112,106,103,107,114,107,104,108,116,108,105,109,118,109,106];
function fixture({down=false,contextConfig={},patternConfig={},bars:provided}={}){
  const closedBars=provided??values.map((v,index)=>{v=down?220-v:v;return bar(index,v,v+1,v-1,v);}),time=closedBars.at(-1).closeTime,openBar={time,closeTime:time+minute,open:down?114:105.5,high:down?115:107,low:down?108:100,close:down?114.5:106,closed:false};
  const closedAnalysis=analyzeGuideSignals(closedBars,{metadata,config,contextConfig,patternConfig,asOfTime:time+2000});return {openBar,options:{closedBars,closedAnalysis,metadata,config,contextConfig,patternConfig,asOfTime:time+2000}};
}
const analyze=(f,preview=createGuideFormingPreview())=>preview.analyze(f.openBar,f.options);

test('forming shapes and contextual interpretations remain provisional and never become a final alert',()=>{
  const f=fixture(),result=analyze(f);assert.equal(result.status,'PREVIEW');assert.equal(result.candidateOnly,true);assert.equal(result.final,false);assert.equal(result.signalApproved,false);assert.equal(result.orderEligible,false);assert.equal(result.ordersCreated,false);assert.equal(result.fillInferred,false);assert.equal(result.execution,'OBSERVATION_ONLY');assert.ok(result.barsEvaluated<=3);assert.equal(result.atrSeedPolicy,'EXACT_CLOSED_ANALYSIS_PREFIX');
  assert.ok(result.matchedPatternIds.includes('HANGING_MAN_SHAPE'));const hanging=result.scenarios.find(item=>item.patternId==='HANGING_MAN_SHAPE');assert.equal(hanging.family,'HANGING_MAN_REVERSAL');assert.equal(hanging.contextApplicable,true);assert.equal(hanging.requiredPriorState,'TREND_UP');assert.equal(hanging.observedPriorState,'TREND_UP');assert.equal(hanging.final,false);assert.equal(result.patternChecks.HANGING_MAN_SHAPE.matched,true);assert.equal(result.patterns.find(item=>item.id==='HANGING_MAN_SHAPE').final,false);
  assert.ok(result.reasonCodes.includes('FORMING_BAR_PREVIEW_ONLY'));assert.ok(result.reasonCodes.includes('LATER_CLOSED_CONFIRMATION_REQUIRED'));assert.equal(result.limits.fullSignalEngineInvoked,false);
});

test('Hanging Man requires a prior rise and Inverted Hammer a prior decline without forcing direction from the shape',()=>{
  const down=fixture({down:true}),result=analyze(down),hanging=result.scenarios.find(item=>item.patternId==='HANGING_MAN_SHAPE');assert.equal(result.frozenContext.state,'TREND_DOWN');assert.equal(hanging.contextApplicable,false);assert.equal(hanging.state,'CONTEXT_NOT_APPLICABLE');assert.ok(hanging.reasonCodes.includes('REQUIRED_PRIOR_STATE_NOT_MET'));
  down.openBar={...down.openBar,open:114.5,high:121,low:114,close:114.25};const inverted=analyze(down).scenarios.find(item=>item.patternId==='INVERTED_HAMMER_SHAPE');assert.equal(inverted.direction,'LONG');assert.equal(inverted.contextApplicable,true);assert.equal(inverted.family,'INVERTED_HAMMER_REVERSAL');
  const up=fixture();up.openBar={...up.openBar,open:106,high:113,low:105.5,close:105.75};assert.equal(analyze(up).scenarios.find(item=>item.patternId==='INVERTED_HAMMER_SHAPE').contextApplicable,false);
});

test('same-bar price updates reclassify only the short tail and reuse every frozen context',()=>{
  const f=fixture(),preview=createGuideFormingPreview(),first=analyze(f,preview),before=preview.getStats();
  for(let update=0;update<50;update++){const result=preview.analyze({...f.openBar,close:105.5+(update%3)*.25},{...f.options,asOfTime:f.openBar.time+2000+update});assert.equal(result.status,'PREVIEW');assert.equal(result.cache.contextWorkThisUpdate,0);assert.ok(result.barsEvaluated<=3);assert.deepEqual(result.frozenContext,first.frozenContext);}
  const after=preview.getStats();assert.equal(after.contextComputations,before.contextComputations);assert.equal(after.contextReuses,before.contextReuses);assert.equal(after.patternComputations,before.patternComputations+50);assert.ok(after.cachedContexts<=16);preview.clear();assert.deepEqual(preview.getStats(),{contextComputations:0,contextReuses:0,contextHits:0,patternComputations:0,cachedContexts:0});
});

test('mismatched identity, tick/period configuration or an old cached prefix is unavailable rather than a borrowed preview',()=>{
  const f=fixture();for(const change of [{metadata:{...metadata,instrument:'OTHER'}},{metadata:{...metadata,tickSize:.5}},{patternConfig:{starAtrPeriod:7}},{patternConfig:{tweezerAtrPeriod:7}},{contextConfig:null}])assert.equal(createGuideFormingPreview().analyze(f.openBar,{...f.options,...change}).status,'UNAVAILABLE');
  const corrected=f.options.closedBars.map(bar=>({...bar}));corrected[2].high+=.25;const unavailable=createGuideFormingPreview().analyze(f.openBar,{...f.options,closedBars:corrected});assert.equal(unavailable.status,'UNAVAILABLE');assert.ok(unavailable.reasonCodes.includes('CLOSED_PATTERN_CACHE_MISMATCH'));
  assert.equal(createGuideFormingPreview().analyze({...f.openBar,closed:true},f.options).status,'UNAVAILABLE');assert.equal(createGuideFormingPreview().analyze(f.openBar,{...f.options,asOfTime:f.openBar.time-1}).status,'UNAVAILABLE');
});

test('context uses only bars known by formation start even when the last closed bar arrives after that cutoff',()=>{
  const f=fixture(),late=f.options.closedBars.map(bar=>({...bar}));late.at(-1).knownAt=f.openBar.time+1000;
  const closedAnalysis=analyzeGuideSignals(late,{metadata,config,asOfTime:f.openBar.time+2000}),result=createGuideFormingPreview().analyze(f.openBar,{...f.options,closedBars:late,closedAnalysis});assert.equal(result.status,'PREVIEW');assert.equal(result.closedPrefixBars,late.length);assert.equal(result.frozenContext.barsUsed,late.length-1);assert.ok(result.frozenContext.lastAvailableKnownAt<=f.openBar.time);assert.ok(result.contexts.every(context=>context.lastAvailableKnownAt<=context.asOf));
});

test('confirmed higher-timeframe contexts are cached; future HTF finals cannot alter an earlier preview',()=>{
  const f=fixture(),makeHigher=duration=>({timeframeMs:duration,instrument:metadata.instrument,bars:values.map((v,index)=>({time:f.openBar.time-(values.length-index)*duration,closeTime:f.openBar.time-(values.length-index-1)*duration,open:v,high:v+1,low:v-1,close:v,closed:true}))}),higherTimeframes={m5:makeHigher(5*minute),m15:makeHigher(15*minute)},preview=createGuideFormingPreview();
  const first=preview.analyze(f.openBar,{...f.options,higherTimeframes,config:{...config,requireHigherTimeframe:true}}),check=first.directions.LONG.checks.find(check=>check.id==='HIGHER_TIMEFRAME');assert.equal(check.state,'PASS');assert.ok(check.evidence.series.every(entry=>entry.lastKnownAt<=f.openBar.time));
  const appended=structuredClone(higherTimeframes);for(const entry of Object.values(appended))entry.bars.push({time:f.openBar.time,closeTime:f.openBar.time+entry.timeframeMs,knownAt:f.openBar.time+entry.timeframeMs+1000,open:100,high:1000,low:1,close:1,closed:true});
  const second=preview.analyze(f.openBar,{...f.options,higherTimeframes:appended,config:{...config,requireHigherTimeframe:true}});assert.equal(second.cache.contextWorkThisUpdate,0);assert.deepEqual(second.directions,first.directions);assert.deepEqual(second.frozenContext,first.frozenContext);
});

test('a forming three-candle Star uses the exact prior ATR seed and freezes context before its first candle',()=>{
  const warm=Array.from({length:14},(_,index)=>bar(index,100,101,99,100)),closed=[...warm,bar(14,100,101,96,97),bar(15,97,98,96.5,97.25)],f=fixture({bars:closed});f.openBar={...f.openBar,open:97.5,high:101,low:97,close:100};
  const result=analyze(f),star=result.patterns.find(item=>item.id==='MORNING_STAR');assert.ok(star);assert.equal(star.final,false);assert.equal(star.evidence.priorAtr,2);assert.equal(result.barsEvaluated,3);const scenario=result.scenarios.find(item=>item.patternId==='MORNING_STAR');assert.equal(scenario.freezeTime,closed[14].time);assert.ok(result.contexts.some(context=>context.asOf===closed[14].time&&context.lastAvailableKnownAt<=closed[14].time));
});

test('provisional signal-close EMA continues the confirmed prefix exactly through multi-candle formations',()=>{
  const f=fixture({contextConfig:{emaEvaluation:'signal_close',emaPeriod:5,emaSlopeBars:2,emaProximityMode:'ticks',emaProximityTicks:100}}),last=f.options.closedBars.at(-1);f.openBar={...f.openBar,open:last.close-2,high:last.high+2,low:last.low-2,close:last.close+2};
  const result=analyze(f),engulf=result.scenarios.find(item=>item.patternId==='BULLISH_ENGULFING');
  // The zero-body prior candle cannot engulf directionally, so verify the
  // current-bar EMA first; then use an explicit bearish precursor below.
  const expected=calculateIndicators([...f.options.closedBars,f.openBar],{emaPeriod:5}),ema=result.directions.LONG.checks.find(check=>check.id==='EMA');assert.equal(ema.evidence.value,expected.ema.at(-1));assert.equal(engulf,undefined);
  const closed=f.options.closedBars.map(bar=>({...bar}));closed.at(-1).open=last.close+.5;closed.at(-1).close=last.close-.5;const closedAnalysis=analyzeGuideSignals(closed,{metadata,config,contextConfig:f.options.contextConfig,asOfTime:f.openBar.time});
  const multi=createGuideFormingPreview().analyze(f.openBar,{...f.options,closedBars:closed,closedAnalysis}),scenario=multi.scenarios.find(item=>item.patternId==='BULLISH_ENGULFING');assert.ok(scenario);assert.equal(scenario.checks.find(check=>check.id==='EMA').evidence.value,calculateIndicators([...closed,f.openBar],{emaPeriod:5}).ema.at(-1));
});

test('Inside breakout/reclaim previews remain forming-only and crossing both edges remains ambiguous',()=>{
  const closed=[...fixture().options.closedBars,bar(25,109,112,100,108),bar(26,108,111,102,107)],f=fixture({bars:closed}),preview=createGuideFormingPreview();f.openBar={...f.openBar,open:107,high:114,low:106,close:113.5};
  const breakout=analyze(f,preview).scenarios.find(item=>item.patternId==='INSIDE_BREAKOUT'&&item.direction==='LONG');assert.equal(breakout.state,'FORMING_CANDIDATE');assert.equal(breakout.reference.high,112);assert.equal(breakout.final,false);assert.equal(breakout.signalApproved,false);
  f.openBar={...f.openBar,high:109,low:99,close:106};const reclaim=analyze(f,preview).scenarios.find(item=>item.patternId==='INSIDE_FALSE_BREAK'&&item.direction==='LONG');assert.equal(reclaim.state,'FORMING_CANDIDATE');assert.equal(reclaim.fillInferred,false);
  f.openBar={...f.openBar,high:114};const both=analyze(f,preview).scenarios.filter(item=>item.patternId.startsWith('INSIDE_'));assert.ok(both.length);assert.ok(both.every(item=>item.state==='AMBIGUOUS_FORMING_REACHABILITY'&&item.orderEligible===false));
  const touch=fixture({bars:closed,contextConfig:{insideConfirmationMode:'touch_research',insideBreakoutReference:'inside'}});touch.openBar={...touch.openBar,open:107,high:112,low:106,close:108};const candidate=analyze(touch).scenarios.find(item=>item.patternId==='INSIDE_BREAKOUT'&&item.direction==='LONG');assert.equal(candidate.reference.mode,'inside');assert.equal(candidate.reference.high,111);assert.equal(candidate.state,'FORMING_CANDIDATE');assert.equal(candidate.final,false);
});

test('a600-bar closed cache supports repeated cheap previews and a newly closed prefix invalidates the context cache',()=>{
  const closed=Array.from({length:599},(_,index)=>{const value=100+index*.25;return bar(index,value,value+1,value-1,value+.5);}),f=fixture({bars:closed}),preview=createGuideFormingPreview(),first=analyze(f,preview);assert.equal(first.status,'PREVIEW');const work=preview.getStats().contextComputations+preview.getStats().contextReuses;
  for(let tick=0;tick<100;tick++){const update=preview.analyze({...f.openBar,close:f.openBar.close+(tick%2)*.25},f.options);assert.equal(update.status,'PREVIEW');assert.equal(update.cache.contextWorkThisUpdate,0);assert.equal(update.barsEvaluated,3);}
  assert.equal(preview.getStats().contextComputations+preview.getStats().contextReuses,work);
  const finalized={...f.openBar,closed:true,knownAt:f.openBar.closeTime},nextClosed=[...closed,finalized],nextAnalysis=analyzeGuideSignals(nextClosed,{metadata,config,asOfTime:finalized.closeTime}),next={...f.openBar,time:finalized.closeTime,closeTime:finalized.closeTime+minute},result=preview.analyze(next,{...f.options,closedBars:nextClosed,closedAnalysis:nextAnalysis,asOfTime:next.time+1000});assert.equal(result.status,'PREVIEW');assert.equal(result.closedPrefixBars,600);assert.ok(result.cache.contextWorkThisUpdate>0);assert.ok(result.barsEvaluated<=3);
});

test('role-reversal previews require an opt-in known flipped zone and a matching causal shape',()=>{
  const rangeValues=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105],closed=[...rangeValues.map((value,index)=>bar(index,value,value+1,value-1,value)),bar(25,100,101,95,96)],f=fixture({bars:closed,contextConfig:{roleReversalEnabled:true}});f.openBar={...f.openBar,open:98.5,high:102,low:97.25,close:97.5};
  const result=analyze(f),role=result.scenarios.find(item=>item.family==='ROLE_REVERSAL_RETEST'&&item.direction==='SHORT');assert.equal(role.state,'FORMING_CANDIDATE');assert.equal(role.contextApplicable,true);assert.ok(role.patternIds.includes('BEARISH_PIN_SHAPE'));assert.ok(role.matchingRoleZoneIds.length>0);assert.equal(role.final,false);assert.equal(role.signalApproved,false);assert.ok(result.frozenContext.zones.some(zone=>zone.roleReversal&&zone.knownAt<=role.freezeTime));
  const off=fixture({bars:closed});off.openBar=f.openBar;assert.ok(analyze(off).scenarios.filter(item=>item.family==='ROLE_REVERSAL_RETEST').every(item=>item.state==='NOT_APPLICABLE'&&item.contextApplicable===false));
  const notYetKnown={...f.options,closedBars:closed.map(bar=>({...bar}))};notYetKnown.closedBars.at(-1).knownAt=f.openBar.time+1000;notYetKnown.closedAnalysis=analyzeGuideSignals(notYetKnown.closedBars,{metadata,config,contextConfig:f.options.contextConfig,asOfTime:f.openBar.time+2000});const late=createGuideFormingPreview().analyze(f.openBar,notYetKnown).scenarios.find(item=>item.family==='ROLE_REVERSAL_RETEST'&&item.direction==='SHORT');assert.equal(late.contextApplicable,false,'a flip learned after forming start is not backdated');
});

test('same-length corrections, rolling shifts and an asOf rollback cannot reuse a different known price prefix',()=>{
  const f=fixture(),preview=createGuideFormingPreview(),before=analyze(f,preview);assert.equal(before.frozenContext.state,'TREND_UP');
  const corrected=fixture({down:true}),after=preview.analyze(f.openBar,corrected.options);assert.equal(after.frozenContext.state,'TREND_DOWN');assert.ok(after.cache.contextWorkThisUpdate>0);assert.equal(after.scenarios.find(item=>item.patternId==='HANGING_MAN_SHAPE').contextApplicable,false);
  const shifted=f.options.closedBars.map(bar=>({...bar,time:bar.time-minute,closeTime:bar.closeTime-minute})),shiftAnalysis=analyzeGuideSignals(shifted,{metadata,config,asOfTime:f.openBar.time}),shiftedResult=preview.analyze(f.openBar,{...f.options,closedBars:shifted,closedAnalysis:shiftAnalysis});assert.equal(shiftedResult.status,'PREVIEW');assert.ok(shiftedResult.cache.contextWorkThisUpdate>0);assert.equal(shiftedResult.frozenContext.lastAvailableCloseTime,f.openBar.time-minute);
  const late=f.options.closedBars.map(bar=>({...bar}));late.at(-1).knownAt=f.openBar.time+1000;const lateAnalysis=analyzeGuideSignals(late,{metadata,config,asOfTime:f.openBar.time+2000});assert.equal(preview.analyze(f.openBar,{...f.options,closedBars:late,closedAnalysis:lateAnalysis}).status,'PREVIEW');
  const rolledBack=preview.analyze(f.openBar,{...f.options,closedBars:late,closedAnalysis:lateAnalysis,asOfTime:f.openBar.time+500});assert.equal(rolledBack.status,'UNAVAILABLE');assert.ok(rolledBack.reasonCodes.includes('CLOSED_PATTERN_CACHE_MISMATCH'));
  const causalAnalysis=analyzeGuideSignals(late,{metadata,config,asOfTime:f.openBar.time+500}),causal=preview.analyze(f.openBar,{...f.options,closedBars:late,closedAnalysis:causalAnalysis,asOfTime:f.openBar.time+500});assert.equal(causal.status,'PREVIEW');assert.equal(causal.closedPrefixBars,late.length-1);assert.ok(causal.frozenContext.lastAvailableKnownAt<=f.openBar.time);
});

test('engulfing reclaim previews use a frozen pre-formation range, observed excursion and current return inside',()=>{
  const rangeValues=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105],range=rangeValues.map((value,index)=>bar(index,value,value+1,value-1,value)),long=fixture({bars:[...range,bar(25,100,101,96,97)]});long.openBar={...long.openBar,open:96.75,high:103,low:96.5,close:102};
  const preview=createGuideFormingPreview(),result=analyze(long,preview),reclaim=result.scenarios.find(item=>item.family==='ENGULFING_RANGE_RECLAIM'&&item.direction==='LONG');assert.equal(reclaim.state,'FORMING_CANDIDATE');assert.equal(reclaim.contextApplicable,true);assert.equal(reclaim.freezeTime,long.options.closedBars[25].time);assert.ok(reclaim.range.knownAt<=reclaim.freezeTime);assert.equal(reclaim.checks.find(check=>check.id==='STRUCTURE').evidence.rangeReclaim,true);assert.equal(reclaim.checks.find(check=>check.id==='KNOWN_LOCATION').passed,true);assert.equal(reclaim.final,false);assert.equal(reclaim.signalApproved,false);assert.equal(result.signalApproved,false);
  const short=fixture({bars:[...range,bar(25,110,114,109,113)]});short.openBar={...short.openBar,open:113.25,high:113.5,low:107,close:108};assert.equal(analyze(short).scenarios.find(item=>item.family==='ENGULFING_RANGE_RECLAIM'&&item.direction==='SHORT').state,'FORMING_CANDIDATE');
  const noReturn=fixture({bars:[...range,bar(25,98,101,96,97)]});noReturn.openBar={...noReturn.openBar,open:96.75,high:99,low:96.5,close:98.5};const outside=analyze(noReturn).scenarios.find(item=>item.family==='ENGULFING_RANGE_RECLAIM'&&item.direction==='LONG');assert.equal(outside.state,'WAITING_FOR_FORMING_RANGE_RECLAIM');assert.ok(outside.reasonCodes.includes('FORMING_CLOSE_NOT_INSIDE_RANGE'));
});

test('touch-research Inside previews include exact trigger touches and both-edge ambiguity while close mode stays strict',()=>{
  const closed=[...fixture().options.closedBars,bar(25,109,112,100,108),bar(26,108,111,102,107)],touch=fixture({bars:closed,contextConfig:{insideConfirmationMode:'touch_research',insideBreakoutReference:'inside'}});touch.openBar={...touch.openBar,open:108,high:111.25,low:106,close:108};
  let result=analyze(touch);assert.equal(result.scenarios.find(item=>item.patternId==='INSIDE_BREAKOUT'&&item.direction==='LONG').state,'FORMING_CANDIDATE');assert.equal(result.signalApproved,false);
  touch.openBar={...touch.openBar,high:109,low:101.75};assert.equal(analyze(touch).scenarios.find(item=>item.patternId==='INSIDE_BREAKOUT'&&item.direction==='SHORT').state,'FORMING_CANDIDATE');
  touch.openBar={...touch.openBar,high:111.25};assert.ok(analyze(touch).scenarios.filter(item=>item.patternId==='INSIDE_BREAKOUT').every(item=>item.state==='AMBIGUOUS_FORMING_REACHABILITY'));
  const zero=fixture({bars:closed,contextConfig:{insideConfirmationMode:'touch_research',insideBreakoutReference:'inside',penetrationTicks:0}});zero.openBar={...zero.openBar,open:108,high:111,low:102,close:108};assert.ok(analyze(zero).scenarios.filter(item=>item.patternId==='INSIDE_BREAKOUT').every(item=>item.state==='AMBIGUOUS_FORMING_REACHABILITY'));
  const strict=fixture({bars:closed,contextConfig:{insideBreakoutReference:'inside'}});strict.openBar={...strict.openBar,open:108,high:111.25,low:106,close:111.25};assert.equal(analyze(strict).scenarios.find(item=>item.patternId==='INSIDE_BREAKOUT'&&item.direction==='LONG').state,'WAITING_FOR_FORMING_PRICE_CONDITION');
});
