import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCandlePatterns,candleAnatomy,normalizeCandleBars,validatePatternConfig,PATTERN_DEFINITION_VERSION} from '../candle-patterns.mjs';

const config={tickSize:.25};
function bar(index,open,high,low,close,extra={}){return {time:index*60000,closeTime:(index+1)*60000,closed:true,open,high,low,close,...extra};}
const ids=(result,index=result.byBar.length-1)=>result.patterns.filter(p=>p.endIndex===index).map(p=>p.id);
const inspect=bars=>analyzeCandlePatterns(bars,config);
const guideEngulfing=()=>[bar(0,105,109,99,101),bar(1,100.5,108,100,106)];
function starBars(){
  return [...Array.from({length:14},(_,i)=>bar(i,100,101,99,100.25)),
    bar(14,104,105,99,100),bar(15,99.5,100.5,98.5,99.75),bar(16,99.75,104,99,103)];
}
function mirror(bars){return bars.map(b=>({...b,open:200-b.open,high:200-b.low,low:200-b.high,close:200-b.close}));}

test('guide anatomy uses actual OHLC and zero range does not create ratio patterns',()=>{
  const a=candleAnatomy(bar(0,100,108,98,106));
  assert.deepEqual([a.body,a.range,a.upper,a.lower,a.closePosition],[6,10,2,2,.8]);
  assert.equal(candleAnatomy({open:100,high:99,low:98,close:101}),null);
  const zero=inspect([bar(0,100,100,100,100)]);
  assert.deepEqual(zero.patterns,[]);assert.ok(zero.byBar[0].reasonCodes.includes('ZERO_RANGE'));
});

test('guide engulfing body may be inside prior wicks and is not an outside bar',()=>{
  const result=inspect(guideEngulfing());
  assert.ok(ids(result).includes('BULLISH_ENGULFING'));
  assert.ok(!ids(result).includes('OUTSIDE_BAR'));
  const engulf=result.patterns.find(p=>p.id==='BULLISH_ENGULFING');
  assert.equal(engulf.definitionVersion,PATTERN_DEFINITION_VERSION);assert.equal(engulf.knownAt,120000);
  assert.equal(engulf.startIndex,0);assert.equal(engulf.endIndex,1);assert.equal(engulf.eligibleForConfirmation,true);
  assert.equal(engulf.signalHigh,109);assert.equal(engulf.signalLow,99);
});

test('equal engulfing bodies and sub-tick enlargement do not pass real extension',()=>{
  const equal=[bar(0,105,106,100,101),bar(1,101,106,100,105)];
  assert.ok(!ids(inspect(equal)).includes('BULLISH_ENGULFING'));
  equal[1]=bar(1,100.9,106,100,105);
  assert.ok(!ids(inspect(equal)).includes('BULLISH_ENGULFING'));
  equal[1]=bar(1,100.75,106,100,105);
  assert.ok(ids(inspect(equal)).includes('BULLISH_ENGULFING'));
  const decimal=[bar(0,10.3,10.4,10,10.1),bar(1,10,10.4,9.9,10.3)];
  assert.ok(ids(analyzeCandlePatterns(decimal,{tickSize:.1})).includes('BULLISH_ENGULFING'));
});

test('Harami body containment does not imply full-range inside bar',()=>{
  const bars=[bar(0,108,109,99,100),bar(1,102,110,101,104)],result=inspect(bars);
  assert.ok(ids(result).includes('BULLISH_HARAMI'));assert.ok(!ids(result).includes('INSIDE_BAR'));
  bars[1]=bar(1,104,108,101,104);
  const cross=inspect(bars);assert.ok(ids(cross).includes('HARAMI_CROSS'));assert.ok(!ids(cross).includes('BULLISH_HARAMI'));
});

test('overlapping Doji, Dragonfly and Pin labels remain independent shape observations',()=>{
  const result=inspect([bar(0,104,104.25,100,104)]);
  assert.ok(ids(result).includes('DOJI'));assert.ok(ids(result).includes('DRAGONFLY_DOJI'));assert.ok(ids(result).includes('BULLISH_PIN_SHAPE'));
  assert.ok(!ids(result).includes('HAMMER_SHAPE'),'a zero-body doji is not the nonzero hammer definition');
  const inverse=inspect([bar(0,100,104,99.75,100)]);
  assert.ok(ids(inverse).includes('GRAVESTONE_DOJI'));assert.ok(ids(inverse).includes('BEARISH_PIN_SHAPE'));
});

test('Hammer and shooting-star labels describe shape without pretending to establish context',()=>{
  const hammer=inspect([bar(0,103,104.25,99,104)]);
  assert.ok(ids(hammer).includes('HAMMER_SHAPE'));assert.ok(ids(hammer).includes('BULLISH_PIN_SHAPE'));
  assert.ok(!Object.hasOwn(hammer.patterns.find(p=>p.id==='HAMMER_SHAPE'),'trend'));
  const shooting=inspect([bar(0,104,108,102.75,103)]);
  assert.ok(ids(shooting).includes('SHOOTING_STAR_SHAPE'));assert.ok(ids(shooting).includes('BEARISH_PIN_SHAPE'));
});

test('ratio thresholds distinguish equality from a real change beyond the threshold',()=>{
  assert.ok(ids(inspect([bar(0,100,108,98,101)])).includes('DOJI'));
  assert.ok(!ids(inspect([bar(0,100,108,98,101.00000001)])).includes('DOJI'));
  const small=inspect([bar(0,100,100.5,100,100)]);
  assert.deepEqual(small.patterns,[]);assert.ok(small.reasonCodes.includes('BELOW_MIN_RANGE'));
});

test('strict and inclusive Inside Bar equality are distinct parameterized definitions',()=>{
  const bars=[bar(0,104,110,100,106),bar(1,104,110,102,106)];
  assert.ok(!ids(inspect(bars)).includes('INSIDE_BAR'));
  const inclusive=analyzeCandlePatterns(bars,{...config,allowEqualInsideEdges:true});
  const inside=inclusive.patterns.find(p=>p.id==='INSIDE_BAR');assert.ok(inside);assert.equal(inside.variant,'inclusive');assert.equal(inside.evidence.motherIndex,0);
  bars[1]=bar(1,106,111,99,104);
  assert.ok(ids(inspect(bars)).includes('OUTSIDE_BAR'),'outside geometry is not conditional on candle color');
});

test('Tweezers use explicit tick tolerance and opposite-color policy',()=>{
  const bars=[bar(0,108,110,100,103),bar(1,102,109,100.25,107)];
  assert.ok(ids(inspect(bars)).includes('TWEEZER_BOTTOM'));
  bars[1].low=100.2501;assert.ok(!ids(inspect(bars)).includes('TWEEZER_BOTTOM'));
  bars[1]=bar(1,107,109,100,102);
  assert.ok(!ids(inspect(bars)).includes('TWEEZER_BOTTOM'));
  assert.ok(ids(analyzeCandlePatterns(bars,{...config,requireOppositeTweezer:false})).includes('TWEEZER_BOTTOM'));
});

test('Star patterns require prior ATR warmup and explicitly separate continuous from strict gaps',()=>{
  const bars=starBars(),continuous=inspect(bars);
  const morning=continuous.patterns.find(p=>p.id==='MORNING_STAR');assert.ok(morning);assert.equal(morning.endIndex,16);assert.equal(morning.evidence.atrIndex,13);assert.equal(morning.evidence.priorAtr,2);
  assert.ok(!ids(analyzeCandlePatterns(bars,{...config,starMode:'strict_gap'})).includes('MORNING_STAR'));
  bars[16]=bar(16,100,104,99.8,103);
  assert.ok(ids(analyzeCandlePatterns(bars,{...config,starMode:'strict_gap'})).includes('MORNING_STAR'));
  assert.ok(ids(inspect(mirror(starBars()))).includes('EVENING_STAR'));
  const short=starBars().slice(1).map((b,i)=>({...b,time:i*60000,closeTime:(i+1)*60000}));
  assert.ok(!ids(inspect(short)).includes('MORNING_STAR'));
});

test('ATR not known before the first star candle cannot be borrowed from later availability',()=>{
  const bars=starBars();bars[13].knownAt=bars[14].time+10;
  const result=inspect(bars);assert.ok(!ids(result).includes('MORNING_STAR'));
  assert.equal(result.byBar[16].checks.MORNING_STAR.conditions.atrKnownBeforePattern,false);
});

test('closed mode excludes open final bars and rejects silent holes or open historical bars',()=>{
  const bars=guideEngulfing();bars[1].closed=false;
  const open=inspect(bars);assert.ok(!ids(open).includes('BULLISH_ENGULFING'));assert.ok(open.reasonCodes.includes('OPEN_BAR_EXCLUDED'));
  assert.equal(inspect([bars[0],null,bars[1]]).status,'INVALID_INPUT');
  assert.equal(inspect([bar(0,100,103,99,102,{closed:false}),bar(1,102,104,101,103)]).status,'INVALID_INPUT');
  const missing=bar(0,100,103,99,102);delete missing.closed;
  assert.ok(inspect([missing]).reasonCodes.includes('BAR_CLOSE_UNKNOWN'));
});

test('preview preserves open indices and always reports provisional geometry even with timestamps',()=>{
  const bars=guideEngulfing().map(b=>({...b,closed:false}));
  const preview=analyzeCandlePatterns(bars,{...config,mode:'preview'});
  const engulf=preview.patterns.find(p=>p.id==='BULLISH_ENGULFING');assert.ok(engulf);
  assert.equal(engulf.endIndex,1);assert.equal(engulf.startIndex,0);assert.equal(engulf.status,'PROVISIONAL');assert.equal(engulf.final,false);assert.equal(engulf.eligibleForConfirmation,false);
  assert.equal(preview.status,'PROVISIONAL');assert.equal(preview.byBar[0].closed,false);
  const pixels=analyzeCandlePatterns(bars.map(({time,closeTime,...b})=>b),{mode:'preview',unit:'pixels',requireTimestamps:false,tickSize:1});
  assert.ok(pixels.patterns.some(p=>p.id==='BULLISH_ENGULFING'));assert.ok(pixels.patterns.every(p=>!p.final&&!p.eligibleForConfirmation));
  assert.equal(pixels.patterns.find(p=>p.id==='BULLISH_ENGULFING').knownAt,null);
});

test('no later bar, arbitrary future scale, or future availability changes earlier decisions',()=>{
  const bars=[bar(0,100,108,98,101.000000001)],before=inspect(bars);
  const after=inspect([...bars,bar(1,1e14,1e14+4,1e14-4,1e14+1)]);
  assert.deepEqual(after.patterns.filter(p=>p.endIndex===0),before.patterns);
  const star=starBars(),asOf=analyzeCandlePatterns(star,{...config,asOfTime:star[16].closeTime-1});
  assert.ok(!asOf.patterns.some(p=>p.endIndex===16));assert.ok(asOf.byBar[16].reasonCodes.includes('BAR_NOT_YET_KNOWN'));
  const initial=inspect(star.slice(0,16));assert.ok(!initial.patterns.some(p=>p.id==='MORNING_STAR'));
});

test('timestamps, known-at ordering, synthetic chart types and malformed OHLC fail explicitly',()=>{
  const bars=guideEngulfing();bars[1].time=bars[0].time;
  assert.ok(inspect(bars).reasonCodes.includes('BAR_TIME_NOT_INCREASING'));
  assert.ok(inspect([{...bar(0,100,103,99,102),time:undefined}]).reasonCodes.includes('BAR_TIME_REQUIRED'));
  assert.ok(inspect([bar(0,100,103,99,102,{knownAt:1})]).reasonCodes.includes('INVALID_KNOWN_AT'));
  assert.ok(inspect([bar(0,100,103,99,102,{chartType:'heikin_ashi'})]).reasonCodes.includes('UNSUPPORTED_CHART_TYPE'));
  assert.ok(inspect([bar(0,100,99,99,102)]).reasonCodes.includes('INCONSISTENT_OHLC'));
  assert.ok(inspect([bar(0,100,103,99,Infinity)]).reasonCodes.includes('INVALID_OHLC'));
});

test('config and history are bounded without inferring a contract tick or mutating inputs',()=>{
  assert.equal(analyzeCandlePatterns(guideEngulfing()).patterns.length,0);
  assert.ok(analyzeCandlePatterns(guideEngulfing()).reasonCodes.includes('TICK_SIZE_OR_MIN_RANGE_REQUIRED'));
  const noTick=analyzeCandlePatterns(guideEngulfing(),{minRange:1});
  assert.ok(!ids(noTick).includes('BULLISH_ENGULFING'));
  assert.ok(noTick.reasonCodes.includes('TICK_SIZE_REQUIRED_FOR_ENGULFING_AND_TWEEZERS'));
  assert.throws(()=>validatePatternConfig({dojiBodyMaxRatio:-1}));
  assert.equal(analyzeCandlePatterns([],{unknownParameter:true}).status,'INVALID_CONFIG');
  assert.equal(analyzeCandlePatterns(new Array(4097).fill(null),config).reasonCodes[0],'BAR_LIMIT_EXCEEDED');
  const bars=guideEngulfing(),snapshot=structuredClone(bars),result=inspect(bars);
  result.features[0].body=999;result.patterns[0].evidence.body=999;
  assert.deepEqual(bars,snapshot);assert.equal(inspect(bars).features[0].body,4);
  assert.ok(normalizeCandleBars(bars,config).ok);
});
