import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResearchCandles,RESEARCH_CANDLE_VERSION} from '../research-candle-patterns.mjs';

const config={tickSize:.25};
const bar=(i,open,high,low,close,extra={})=>({time:i*60000,closeTime:(i+1)*60000,closed:true,open,high,low,close,...extra});
const warmup=()=>Array.from({length:20},(_,i)=>bar(i,100,102,99,101));
const sequence=(rows,extra={})=>[...warmup(),...rows.map((row,i)=>bar(i+20,...row,extra))];
const inspect=bars=>analyzeResearchCandles(bars,config);
const matches=(r,id,variant)=>r.patterns.filter(p=>p.id===id&&(!variant||p.variant===variant));
const mirror=bars=>bars.map(b=>({...b,open:300-b.open,high:300-b.low,low:300-b.high,close:300-b.close}));

test('Marubozu and Belt Hold use one closed candle, historical long body and one evidence family',()=>{
  const bars=sequence([[100,110,100,110]]),result=inspect(bars);
  const patterns=matches(result,'BULLISH_MARUBOZU');
  assert.deepEqual(patterns.map(p=>p.variant),['FULL','OPEN','CLOSE']);
  const belt=matches(result,'BULLISH_BELT_HOLD')[0];assert.ok(belt);
  assert.equal(new Set([...patterns,belt].map(p=>p.evidenceFamily)).size,1);
  assert.equal(belt.knownAt,21*60000);assert.equal(belt.startIndex,belt.endIndex);
  for(const p of result.patterns){assert.equal(p.orderEligible,false);assert.equal(p.setupConfirmed,false);assert.equal(p.researchOnly,true);}
  const bearish=inspect(mirror(bars));assert.equal(matches(bearish,'BEARISH_MARUBOZU','FULL').length,1);
  const bearishBelt=matches(bearish,'BEARISH_BELT_HOLD')[0];assert.ok(bearishBelt);
  assert.equal(bearishBelt.evidenceFamily,matches(bearish,'BEARISH_MARUBOZU','FULL')[0].evidenceFamily);
  assert.equal(matches(inspect(sequence([[100,104,100,103]])),'BULLISH_MARUBOZU','FULL').length,0);
  assert.equal(matches(inspect(sequence([[100,101,100,101]])),'BULLISH_MARUBOZU').length,0,'normal historical body is not long');
  assert.ok(inspect([bar(0,100,110,100,110)]).reasonCodes.includes('LONG_BODY_WARMUP_REQUIRED'));
});

test('Advance Block records shrinking rising bodies and growing wicks only after the last close',()=>{
  const bars=sequence([[100,106,99,105],[104,109,103,107],[107,112,106,108.5]]);
  const found=matches(inspect(bars),'ADVANCE_BLOCK');
  assert.equal(found.length,1);
  assert.equal(found[0].knownAt,bars.at(-1).closeTime);
  assert.equal(found[0].contextValid,null);
  assert.equal(found[0].setupConfirmed,false);
  assert.equal(matches(inspect([...bars.slice(0,-1),{...bars.at(-1),closed:false}]),'ADVANCE_BLOCK').length,0);
  assert.equal(matches(inspect([...bars.slice(0,-1),{...bars.at(-1),high:109.75}]),'ADVANCE_BLOCK').length,0);
});

test('Piercing and Dark Cloud distinguish classic gaps from continuous recovery and body engulfing',()=>{
  const continuous=sequence([[110,111,99,100],[100,108,99,107]]);
  assert.equal(matches(inspect(continuous),'PIERCING_LINE','CONTINUOUS_RECOVERY').length,1);
  assert.equal(matches(inspect(continuous),'PIERCING_LINE','CLASSIC_GAP').length,0);
  const classic=sequence([[110,111,99,100],[98.75,108,98,107]]);
  const patterns=matches(inspect(classic),'PIERCING_LINE');
  assert.ok(patterns.some(p=>p.variant==='CLASSIC_GAP'));
  assert.equal(new Set(patterns.map(p=>p.evidenceFamily)).size,1);
  assert.ok(patterns.find(p=>p.variant==='CLASSIC_GAP').reasonCodes.includes('GAP_CAUSE_NOT_VERIFIED'));
  const mirrored=inspect(mirror(continuous));assert.equal(matches(mirrored,'DARK_CLOUD_COVER','CONTINUOUS_RECOVERY').length,1);
  const engulf=sequence([[110,111,99,100],[100,112,99,111]]);
  assert.equal(matches(inspect(engulf),'PIERCING_LINE').length,0);
});

test('Three Inside body-only confirmation is separate from full-range confirmation and Harami contains bodies',()=>{
  const rows=[[110,112,98,100],[101,114,99,103],[103,112,102,111]];
  const result=inspect(sequence(rows));
  assert.equal(matches(result,'THREE_INSIDE_UP','BODY_CONFIRM').length,1);
  assert.equal(matches(result,'THREE_INSIDE_UP','RANGE_CONFIRM').length,0);
  assert.equal(matches(result,'THREE_INSIDE_UP')[0].evidence.middleRangeContained,false,'wicks need not be inside');
  const full=inspect(sequence([...rows.slice(0,2),[103,114,102,113]]));
  assert.equal(matches(full,'THREE_INSIDE_UP','RANGE_CONFIRM').length,1);
  assert.equal(new Set(matches(full,'THREE_INSIDE_UP').map(p=>p.evidenceFamily)).size,1);
  assert.equal(matches(inspect(mirror(sequence(rows))),'THREE_INSIDE_DOWN','BODY_CONFIRM').length,1);
  const failed=sequence([[110,112,98,100],[99.75,114,99,103],[103,114,102,113]]);
  assert.equal(matches(inspect(failed),'THREE_INSIDE_UP').length,0,'middle body leaving first body is not Harami');
});

test('Kicker body gaps and full-range gaps are distinct; two opposite candles without gap do not qualify',()=>{
  const first=[110,111,99,100];
  const bodyOnly=inspect(sequence([first,[111,121,110.5,120.5]]));
  assert.equal(matches(bodyOnly,'BULLISH_KICKER','BODY_GAP').length,1);
  assert.equal(matches(bodyOnly,'BULLISH_KICKER','FULL_GAP').length,0);
  const full=inspect(sequence([first,[112,122,111.5,121.5]]));
  assert.equal(matches(full,'BULLISH_KICKER','FULL_GAP').length,1);
  assert.equal(new Set(matches(full,'BULLISH_KICKER').map(p=>p.evidenceFamily)).size,1);
  const noGap=inspect(sequence([first,[100,111,99,110]]));assert.equal(matches(noGap,'BULLISH_KICKER').length,0);
  assert.equal(matches(inspect(mirror(sequence([first,[112,122,111.5,121.5]]))),'BEARISH_KICKER','FULL_GAP').length,1);
});

test('Abandoned Baby requires two actual range gaps, accepts a tiny middle Doji and remains a shape',()=>{
  const rows=[[110,111,99,100],[98,98.25,97.75,98],[99.5,108,99,107]];
  const result=inspect(sequence(rows)),baby=matches(result,'BULLISH_ABANDONED_BABY')[0];
  assert.ok(baby);assert.equal(baby.knownAt,23*60000);assert.equal(baby.signalLow,97.75);
  assert.equal(baby.contextValid,null);assert.equal(baby.setupConfirmed,false);
  assert.equal(matches(inspect(mirror(sequence(rows))),'BEARISH_ABANDONED_BABY').length,1);
  assert.equal(matches(inspect(sequence([rows[0],[98,99.25,97.75,98],rows[2]])),'BULLISH_ABANDONED_BABY').length,0,'a body gap with overlapping wicks is insufficient');
});

test('Falling Window records the gap boundaries without requiring red candles',()=>{
  const bars=sequence([[110,112,108,111],[106,107,104,106.5]]);
  const window=matches(inspect(bars),'FALLING_WINDOW')[0];assert.ok(window);
  assert.deepEqual(window.evidence.zone,{lower:107,upper:108,knownAt:22*60000});
  assert.equal(window.orderEligible,false);
  bars[21]={...bars[21],time:bars[21].time+60000,closeTime:bars[21].closeTime+60000};
  assert.equal(matches(inspect(bars),'FALLING_WINDOW').length,0,'missing timestamps cannot manufacture a gap pattern');
});

test('Three Soldiers and Crows require direction, body strength, progress and openings inside prior bodies',()=>{
  const rows=[[100,110.5,99.5,110],[105,116.5,104.5,116],[112,124.5,111.5,124]];
  assert.equal(matches(inspect(sequence(rows)),'THREE_WHITE_SOLDIERS').length,1);
  assert.equal(matches(inspect(mirror(sequence(rows))),'THREE_BLACK_CROWS').length,1);
  const outside=[...rows.slice(0,2),[116.25,128,116,127.5]];
  assert.equal(matches(inspect(sequence(outside)),'THREE_WHITE_SOLDIERS').length,0,'opening beyond prior body fails strict profile');
});

test('Three Methods is a five-candle range-contained structure, not five arbitrary directions',()=>{
  const rows=[[100,111,99,110],[109,110,108,108.5],[108.5,109,107,108],[108,108.5,106.5,107.5],[107.5,119,107,118.5]];
  const patterns=matches(inspect(sequence(rows)),'RISING_THREE_METHODS');
  assert.equal(patterns.length,2);assert.equal(patterns[0].endIndex-patterns[0].startIndex,4);
  assert.equal(new Set(patterns.map(p=>p.evidenceFamily)).size,1);
  assert.equal(matches(inspect(mirror(sequence(rows))),'FALLING_THREE_METHODS').length,2);
  const bad=rows.map(r=>[...r]);bad[2][1]=111.25;
  assert.equal(matches(inspect(sequence(bad)),'RISING_THREE_METHODS').length,0,'wick leaving first range fails even when body is inside');
  assert.equal(matches(inspect(sequence(rows.slice(0,4))),'RISING_THREE_METHODS').length,0);
});

test('Mat Hold requires a body gap and held midpoint; no-gap Three Methods does not receive the label',()=>{
  const rows=[[100,111,99,110],[114,116,112,113.5],[113.5,114,111,113],[113,113.5,110.5,112.5],[112.5,124,112,123.5]];
  const p=matches(inspect(sequence(rows)),'BULLISH_MAT_HOLD')[0];assert.ok(p);
  const noGap=rows.map(r=>[...r]);noGap[1]=[110,112,108,109.5];
  assert.equal(matches(inspect(sequence(noGap)),'BULLISH_MAT_HOLD').length,0);
  const lost=rows.map(r=>[...r]);lost[2]=[113.5,114,104.75,113];
  assert.equal(matches(inspect(sequence(lost)),'BULLISH_MAT_HOLD').length,0);
});

test('closed state, receive time, reference availability and future appends cannot retroactively invent an observation',()=>{
  const bars=sequence([[100,110,100,110]]),original=inspect(bars);
  const open=bars.map(b=>({...b}));open.at(-1).closed=false;
  assert.equal(matches(inspect(open),'BULLISH_MARUBOZU').length,0);
  const delayed=bars.map(b=>({...b}));delayed.at(-1).receivedAt=30*60000;
  assert.equal(matches(analyzeResearchCandles(delayed,{...config,asOfTime:29*60000}),'BULLISH_MARUBOZU').length,0);
  assert.equal(matches(analyzeResearchCandles(delayed,{...config,asOfTime:30*60000}),'BULLISH_MARUBOZU')[0].knownAt,30*60000);
  delayed[5].receivedAt=31*60000;
  assert.equal(matches(analyzeResearchCandles(delayed,{...config,asOfTime:30*60000}),'BULLISH_MARUBOZU').length,0,'long-body reference cannot use an unavailable candle');
  const after=inspect([...bars,bar(21,110,200,100,180)]);
  assert.deepEqual(after.patterns.filter(p=>p.endIndex<21),original.patterns);
  for(let n=1;n<=bars.length;n++){
    const prefix=inspect(bars.slice(0,n));
    assert.deepEqual(prefix.patterns,original.patterns.filter(p=>p.endIndex<n));
  }
});

test('invalid OHLC, off-grid prices, zero range, synthetic rows and source changes never create research patterns',()=>{
  assert.equal(inspect(sequence([[100,99,98,101]])).status,'INVALID_INPUT');
  assert.equal(inspect(sequence([[100,110,100,109.9]])).status,'INVALID_INPUT');
  assert.equal(inspect(sequence([[100,100,100,100]])).patterns.length,0);
  assert.equal(inspect(sequence([[100,110,100,110]],{synthetic:true})).patterns.length,0);
  const source=sequence([[110,111,99,100],[112,122,111.5,121.5]]);source.at(-1).sourceId='different';
  assert.equal(matches(inspect(source),'BULLISH_KICKER').length,0);
  assert.equal(matches(inspect(source),'BULLISH_MARUBOZU').length,0,'historical long body references must belong to the same source');
  assert.equal(analyzeResearchCandles([],{tickSize:0}).status,'INVALID_CONFIG');
});

test('Three Outside completion is known only after the third close beyond the engulfing pair',()=>{
  const rows=[[110,112,99,100],[99.75,113,99,111],[111,115,110,114]];
  assert.equal(matches(inspect(sequence(rows)),'THREE_OUTSIDE_UP').length,1);
  assert.equal(matches(inspect(mirror(sequence(rows))),'THREE_OUTSIDE_DOWN').length,1);
  assert.equal(matches(inspect(sequence(rows.slice(0,2))),'THREE_OUTSIDE_UP').length,0);
  const weak=rows.map(r=>[...r]);weak[2]=[111,113,110,113];
  assert.equal(matches(inspect(sequence(weak)),'THREE_OUTSIDE_UP').length,0);
});

test('bounded records retain current latest observations and a versioned configuration',()=>{
  const bars=sequence([[100,110,100,110]]),r=analyzeResearchCandles(bars,{...config,maxPatterns:1});
  assert.equal(r.patterns.length,1);assert.ok(r.totalDetected>r.patterns.length);assert.ok(r.latest.length>1);
  assert.equal(r.version,RESEARCH_CANDLE_VERSION);assert.equal(r.config.longBodyPeriod,20);
});

test('declared session gaps are accepted as context but never join a multi-candle shape',()=>{
  const bars=sequence([[110,111,99,100],[112,122,111.5,121.5]]);
  const sessionGaps=[{from:bars[20].time,to:bars[21].time,kind:'market_closed'}];
  const r=analyzeResearchCandles(bars,{...config,sessionGaps});
  assert.equal(r.status,'OK');assert.equal(matches(r,'BULLISH_KICKER').length,0);
  assert.ok(matches(r,'BULLISH_MARUBOZU').length>0,'a later single-candle shape does not span the gap');
  assert.deepEqual(sessionGaps,[{from:bars[20].time,to:bars[21].time,kind:'market_closed'}]);
  assert.equal(analyzeResearchCandles(bars,{...config,sessionGaps:[{from:4,to:3}]}).status,'INVALID_CONFIG');
});
