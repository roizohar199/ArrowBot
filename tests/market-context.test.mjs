import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMarketContext,analyzeMultiTimeframe,analyzeInsideSequence,calculateIndicators,confirmedPivots,normalizeContextBars,validateContextConfig,CONTEXT_DEFINITION_VERSION,DEFAULT_CONTEXT_CONFIG} from '../market-context.mjs';

const minute=60000,cfg={tickSize:.25};
function bar(index,open,high,low,close,extra={}){return {time:index*minute,closeTime:(index+1)*minute,knownAt:(index+1)*minute,open,high,low,close,closed:true,chartType:'standard',...extra};}
function values(closes){return closes.map((v,i)=>bar(i,v,v+1,v-1,v));}
const up=()=>values([10,11,14,11,10,12,16,13,12,14,18,16,15,17,20,18,17]);
const range=()=>values([105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105]);
const inside=()=>[bar(0,105,110,100,106),bar(1,105,108,102,103)];

test('requires explicit tick size and rejects malformed, open, nonstandard and unordered data',()=>{
 assert.deepEqual(analyzeMarketContext(up()).reasonCodes,['MISSING_TICK_SIZE']);
 assert.equal(validateContextConfig({tickSize:1,fibRatios:3}).valid,false);
 assert.equal(validateContextConfig({tickSize:1,insideReclaimMode:'close_then_reclaim'}).valid,false,'unknown aliases cannot silently leave the default behavior active');
 assert.equal(validateContextConfig({...cfg,pivotRight:0}).valid,false);
 for(const [extra,reason] of [[{high:0},'INVALID_OHLC'],[{closed:false},'OPEN_BAR'],[{chartType:'heikin_ashi'},'NONSTANDARD_CHART'],[{knownAt:-1},'INVALID_BAR_TIMING']]){
  const data=up();Object.assign(data.at(-1),extra);assert.equal(analyzeMarketContext(data,cfg).reasonCodes[0],reason);
 }
 const duplicate=up();duplicate[1]={...duplicate[0]};assert.equal(analyzeMarketContext(duplicate,cfg).reasonCodes[0],'INVALID_TIME_ORDER');
 const gap=[bar(0,10,11,9,10),bar(2,10,11,9,10)];
 assert.equal(analyzeMarketContext(gap,{...cfg,expectedIntervalMs:minute}).reasonCodes[0],'DATA_GAP');
 gap[0].session='A';gap[1].session='B';assert.equal(analyzeMarketContext(gap,{...cfg,expectedIntervalMs:minute,allowSessionGaps:true}).valid,true);
});

test('pivot only becomes known after both right-hand confirmation bars close',()=>{
 const data=up();assert.deepEqual(confirmedPivots(data.slice(0,4),cfg),[]);
 const pivots=confirmedPivots(data.slice(0,5),cfg);assert.equal(pivots.length,1);assert.equal(pivots[0].index,2);assert.equal(pivots[0].knownAt,data[4].closeTime);
 const equal=values([10,11,14,14,10,9]);assert.equal(confirmedPivots(equal,cfg).some(p=>p.type==='HIGH'),false,'equal highs cannot silently become strict pivots');
});

test('confirmed higher highs and higher lows define uptrend, symmetric lower structure defines downtrend',()=>{
 const rise=analyzeMarketContext(up(),cfg);assert.equal(rise.state,'TREND_UP');assert.equal(rise.definitionVersion,CONTEXT_DEFINITION_VERSION);
 const fall=analyzeMarketContext(values(up().map(b=>100-b.close)),cfg);assert.equal(fall.state,'TREND_DOWN');
 assert.equal(analyzeMarketContext(up().slice(0,5),cfg).state,'UNKNOWN');
 const broken=up();broken.push(bar(broken.length,17,18,8,9));const context=analyzeMarketContext(broken,cfg);assert.equal(context.state,'TRANSITION');assert.ok(context.reasonCodes.includes('STRUCTURE_BREAK_DOWN'));
});

test('an asOf decision is unaffected by later closed bars or delayed availability',()=>{
 const data=up(),asOf=data[10].closeTime;
 const then=analyzeMarketContext(data,{...cfg,asOf}),prefix=analyzeMarketContext(data.slice(0,11),cfg);
 assert.deepEqual(then.pivots,prefix.pivots);assert.equal(then.state,prefix.state);assert.equal(then.barsUsed,11);assert.equal(then.excludedFutureBars,6);
 const delayed=data.slice(0,11);delayed.at(-1).knownAt=asOf+minute;
 assert.equal(analyzeMarketContext(delayed,{...cfg,asOf}).barsUsed,10);
 delayed.push(bar(11,14,15,13,14,{knownAt:asOf,closeTime:asOf}));assert.equal(normalizeContextBars(delayed,{asOf}).valid,false);
});

test('range needs separately confirmed repeated support and resistance, and locates edge versus center',()=>{
 const data=range(),r=analyzeMarketContext(data,cfg);assert.equal(r.state,'RANGE');assert.equal(r.range.lower,99);assert.equal(r.range.upper,111);assert.equal(r.location.rangeEdge,'CENTER');assert.equal(r.nearestSupport.touches,3);assert.equal(r.nearestResistance.touches,3);
 const edge=[...data,bar(data.length,100,101,99,99.25)],e=analyzeMarketContext(edge,cfg);assert.equal(e.location.rangeEdge,'LOWER');assert.equal(e.location.atSupport,true);
 const separated=analyzeMarketContext(data.slice(0,20),{...cfg,minTouchSeparationBars:10});assert.notEqual(separated.state,'RANGE');
 const confirmed=analyzeMarketContext(data,{...cfg,minTouchSeparationBars:10});assert.equal(confirmed.nearestSupport.touches,2);assert.equal(confirmed.state,'RANGE');
});

test('a broken support does not silently revive when later pivots revisit its price',()=>{
 const data=range(),prior=analyzeMarketContext(data,cfg),id=prior.nearestSupport.id;
 data.push(bar(data.length,105,106,89,90));const broken=analyzeMarketContext(data,cfg).zones.find(z=>z.id===id);assert.equal(broken.active,false);assert.equal(broken.invalidatedAt,data.at(-1).knownAt);
 for(const close of [97,100,103,100,99,102,106,102,100,103,106])data.push(bar(data.length,close,close+1,close-1,close));
 const later=analyzeMarketContext(data,cfg).zones.find(z=>z.id===id);assert.equal(later.active,false);assert.equal(later.invalidatedAt,broken.invalidatedAt);
});

test('SMA, seeded EMA and Wilder ATR use full warm-up and include genuine price gaps',()=>{
 const data=values([10,11,15,20]),i=calculateIndicators(data,{atrPeriod:3,smaPeriod:3,emaPeriod:3});
 assert.deepEqual(i.atr.slice(0,2),[null,null]);assert.equal(i.atr[2],3);assert.equal(i.atr[3],4);
 assert.equal(i.sma[2],12);assert.equal(i.sma[3],46/3);assert.equal(i.ema[2],12);assert.equal(i.ema[3],16);
 assert.throws(()=>calculateIndicators([{open:1,high:0,low:2,close:1}]),/OHLC/);
});

test('Fibonacci and trend lines use only confirmed anchors with explicit linear index basis',()=>{
 const data=up(),context=analyzeMarketContext(data,{...cfg,zoneToleranceTicks:4});
 assert.equal(context.fib.direction,'UP');assert.equal(context.fib.levels.find(v=>v.ratio===.5).price,17.5);assert.ok(context.fib.knownAt<=data.at(-1).knownAt);
 const line=context.trendlines.find(l=>l.type==='SUPPORT');assert.ok(line);assert.equal(line.scale,'linear');assert.equal(line.timeBasis,'bar_index');assert.equal(line.touches,3);
 assert.equal(analyzeMarketContext(data.slice(0,10),cfg).trendlines.length,0,'second low pivot has not yet been confirmed');
});

test('supply/demand bases are opt-in research definitions, known after displacement and retested later',()=>{
 const data=[bar(0,10,12,8,10),bar(1,10,12,8,10),bar(2,10,12,8,10),bar(3,10,10.5,9.5,10),bar(4,10,10.5,9.5,10.25),bar(5,10.25,16,10,15)];
 assert.equal(analyzeMarketContext(data,cfg).supplyDemand.enabled,false);
 const options={...cfg,atrPeriod:3,supplyDemandEnabled:true};assert.equal(analyzeMarketContext(data.slice(0,5),options).supplyDemand.zones.length,0);
 const found=analyzeMarketContext(data,options).supplyDemand.zones.find(z=>z.type==='DEMAND');assert.ok(found);assert.equal(found.knownAt,data[5].knownAt);assert.equal(found.retestCount,0);assert.equal(found.fresh,true);
 data.push(bar(6,15,15,10,11));let zone=analyzeMarketContext(data,options).supplyDemand.zones.find(z=>z.id===found.id);assert.equal(zone.retestCount,1);assert.equal(zone.fresh,false);
 data.push(bar(7,11,11,7,8));zone=analyzeMarketContext(data,options).supplyDemand.zones.find(z=>z.id===found.id);assert.equal(zone.active,false);assert.equal(zone.invalidatedAt,data[7].knownAt);
});

test('higher-timeframe finals and availability cannot leak into an earlier decision',()=>{
 const higher=[bar(0,10,12,9,11,{closeTime:5*minute,knownAt:5*minute}),bar(5,11,20,10,19,{closeTime:10*minute,knownAt:10*minute,closed:false})];
 const result=analyzeMultiTimeframe({higher:{bars:higher,timeframe:'5m'},trigger:values([10,11,12,13,14,15,16])},{...cfg,asOf:7*minute});
 assert.equal(result.valid,true);assert.equal(result.states.higher.barsUsed,1);assert.equal(result.states.higher.excludedFutureBars,1);assert.equal(result.alignment,'UNKNOWN');
 assert.equal(analyzeMultiTimeframe({higher},cfg).valid,false);
 const bad=[...higher];bad[0]={...bad[0],closed:false};assert.equal(analyzeMultiTimeframe({higher:bad},{...cfg,asOf:7*minute}).valid,false,'an unavailable interior bar is not skipped');
});

test('inside wick rejection is emitted only on the later closing reclaim and exact one-tick penetration counts',()=>{
 const data=inside(),options={tickSize:1};assert.equal(analyzeInsideSequence(data,options).events.length,0);
 data.push(bar(2,103,109,99,103));const r=analyzeInsideSequence(data,options);assert.equal(r.events.length,1);assert.equal(r.events[0].type,'INSIDE_FALSE_BREAK');assert.equal(r.events[0].direction,'LONG');assert.equal(r.events[0].knownAt,data[2].closeTime);assert.equal(r.sequences[0].state,'TRIGGERED');
 data.push(bar(3,103,109,99,103));assert.equal(analyzeInsideSequence(data,options).events.length,1,'one sequence cannot trigger repeatedly');
});

test('close-then-reclaim waits for a later closing bar, and two-sided crossings remain ambiguous',()=>{
 const data=[...inside(),bar(2,103,109,98,98.5)],options={tickSize:1,falseBreakMode:'close_then_reclaim'};
 assert.equal(analyzeInsideSequence(data,options).events.length,0);assert.equal(analyzeInsideSequence(data,options).active.phase,'EXCURSION');
 data.push(bar(3,103,107,101,104));const r=analyzeInsideSequence(data,options);assert.equal(r.events[0].barIndex,3);assert.equal(r.events[0].direction,'LONG');
 const ambiguous=analyzeInsideSequence([...inside(),bar(2,103,111,99,103)],{tickSize:1});assert.equal(ambiguous.events.length,0);assert.equal(ambiguous.sequences[0].phase,'AMBIGUOUS');
});

test('inside equality, anchor mode, explicit expiry and breakout confirmation are different definitions',()=>{
 const equal=[inside()[0],bar(1,104,110,102,105)];assert.equal(analyzeInsideSequence(equal,{tickSize:1}).sequences.length,0);assert.equal(analyzeInsideSequence(equal,{tickSize:1,insideAllowEqualEdges:true}).sequences.length,1);
 const data=[...inside(),bar(2,103,109.5,103,109.5)],original=analyzeInsideSequence(data,{tickSize:1,insideSetup:'breakout'}),previous=analyzeInsideSequence(data,{tickSize:1,insideSetup:'breakout',insideAnchorMode:'previous_bar'});assert.equal(original.events.length,0);assert.equal(previous.events[0].type,'INSIDE_BREAKOUT');
 const expired=analyzeInsideSequence([...inside(),bar(2,104,107,103,105),bar(3,103,109,99,103)],{tickSize:1,insideExpiryBars:1});assert.equal(expired.events.length,0);assert.equal(expired.sequences[0].state,'EXPIRED');
 const open=[...inside(),bar(2,103,113,102,112,{closed:false})];assert.equal(analyzeInsideSequence(open,{tickSize:1,insideSetup:'breakout'}).reasonCodes[0],'OPEN_BAR');
});

test('inside minimum range is an explicit nonnegative safe integer and zero range is never eligible',()=>{
 assert.equal(DEFAULT_CONTEXT_CONFIG.insideMinRangeTicks,4);
 for(const value of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'4',null])assert.equal(validateContextConfig({...cfg,insideMinRangeTicks:value}).valid,false,`invalid minimum ${value}`);
 assert.equal(validateContextConfig({...cfg,insideMinRangeTicks:0}).valid,true);
 const flat=[bar(0,100,100,100,100),bar(1,100,100,100,100),bar(2,100,102,100,102)];
 for(const minimum of [0,4]){
  const r=analyzeInsideSequence(flat,{tickSize:1,insideMinRangeTicks:minimum,insideAllowEqualEdges:true,insideSetup:'breakout'});
  assert.equal(r.sequences.length,0);assert.equal(r.events.length,0,'equal edges cannot turn a flat range into a breakout setup');
  const flatInside=analyzeInsideSequence([inside()[0],bar(1,105,105,105,105),bar(2,105,112,104,112)],{tickSize:1,insideMinRangeTicks:minimum,insideSetup:'breakout'});
  assert.equal(flatInside.sequences.length,0);assert.equal(flatInside.events.length,0,'a positive mother cannot make a flat Inside bar eligible');
 }
});

test('inside sequence rejects subminimum mother or inside ranges and includes the exact tick threshold',()=>{
 const options={tickSize:1,insideSetup:'breakout',insideAllowEqualEdges:true};
 const tinyMother=[bar(0,101,103,100,102),bar(1,101,102,100.5,101.5),bar(2,102,105,101,105)];
 const tinyInside=[inside()[0],bar(1,104,105,102,104),bar(2,104,112,103,112)];
 for(const data of [tinyMother,tinyInside]){
  const r=analyzeInsideSequence(data,options);assert.equal(r.sequences.length,0);assert.equal(r.events.length,0);
 }
 const exact=[bar(0,102,104,100,102),bar(1,102,104,100,103),bar(2,103,106,101,106)];
 const r=analyzeInsideSequence(exact,options);assert.equal(r.sequences.length,1);assert.equal(r.events[0].type,'INSIDE_BREAKOUT');
 const decimal=[bar(0,1.3,1.6,1,1.3),bar(1,1.3,1.5,1.1,1.3),bar(2,1.3,1.8,1.2,1.8)];
 assert.equal(analyzeInsideSequence(decimal,{tickSize:.1,insideSetup:'breakout'}).events.length,1,'four decimal ticks count at the inclusive threshold');
});

test('counted inside bars and re-anchored mothers must retain the minimum range',()=>{
 const data=[...inside(),bar(2,104,105,103,104),bar(3,104,108,104,108)];
 const original=analyzeInsideSequence(data,{tickSize:1,insideSetup:'breakout'});
 assert.deepEqual(original.sequences[0].insideIndices,[1,3],'a small contained observation is not an eligible Inside member');
 const previous=analyzeInsideSequence(data,{tickSize:1,insideSetup:'breakout',insideAnchorMode:'previous_bar'});
 assert.equal(previous.events.length,0,'breakout cannot re-anchor onto the small preceding bar');
 assert.equal(previous.sequences[0].phase,'INELIGIBLE_MOTHER');
});
