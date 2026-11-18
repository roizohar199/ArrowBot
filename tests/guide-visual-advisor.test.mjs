import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuideVisualAdvisor} from '../guide-visual-advisor.mjs';
const candle=(x,openY=100,closeY=101,highY=90,lowY=120)=>({x,openY,closeY,highY,lowY,bodyTop:Math.min(openY,closeY),bodyBottom:Math.max(openY,closeY),bodyWidth:5,direction:closeY<openY?'UP':'DOWN',clipped:false});
const meta=capturedAt=>({context:'chart',geometry:'fixed',capturedAt});
function frame(candles){return {status:'TRACKING',reason:'CONTINUOUS',candles,active:{...candles.at(-1),observedId:1}};}

test('visual rejection shapes are always provisional, never confirmed or order eligible',()=>{
  const reader=createGuideVisualAdvisor(),candles=[candle(10),candle(20),candle(30),candle(40,101,100,99,110)];
  const result=reader.inspect(frame(candles),meta(1000));
  assert.equal(result.status,'ADVISORY');assert.equal(result.direction,'LONG');assert.equal(result.final,false);assert.equal(result.orderEligible,false);assert.equal(result.eligibleForConfirmation,false);
  assert.ok(result.patterns.some(p=>p.id==='BULLISH_PIN_SHAPE'));assert.ok(result.patterns.every(p=>p.final===false));
});

test('a missing slot prevents a multi-bar shape between nonadjacent visible candles',()=>{
  const reader=createGuideVisualAdvisor();
  const candles=[candle(10),candle(20),candle(30),candle(50,102,99,98,103)];
  const result=reader.inspect(frame(candles),meta(1000));
  assert.equal(result.contiguousBars,1);assert.ok(!result.patterns.some(p=>p.id==='BULLISH_ENGULFING'));
  assert.ok(result.reasonCodes.includes('LIMITED_ADJACENT_BARS'));
});

test('a baseline, clipped latest or unknown identity cannot emit a directional advisory',()=>{
  const reader=createGuideVisualAdvisor(),candles=[candle(10),candle(20),candle(30,101,100,99,110)];
  assert.equal(reader.inspect({...frame(candles),status:'BASELINE'},meta(1000)).status,'UNAVAILABLE');
  candles.at(-1).clipped=true;
  assert.equal(reader.inspect(frame(candles),meta(1200)).status,'UNAVAILABLE');
  assert.equal(reader.inspect(frame(candles),{context:'chart',geometry:'fixed',capturedAt:NaN}).status,'UNAVAILABLE');
  candles.at(-1).clipped=false;
  const unknown=frame(candles);delete unknown.active.observedId;
  assert.equal(reader.inspect(unknown,meta(1400)).status,'UNAVAILABLE');
});

test('a new observed candle cannot inherit the prior candidate during the throttle interval',()=>{
  const reader=createGuideVisualAdvisor(),candles=[candle(10),candle(20),candle(30),candle(40,101,100,99,110)];
  assert.equal(reader.inspect(frame(candles),meta(1000)).direction,'LONG');
  const changed=frame([candle(10),candle(20),candle(30),candle(40,100,101,90,102)]);changed.active.observedId=2;
  const result=reader.inspect(changed,meta(1016));
  assert.equal(result.observedId,2);assert.notEqual(result.direction,'LONG');assert.equal(result.capturedAt,1016);
});
