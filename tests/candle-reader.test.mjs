import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandleReader} from '../candle-reader.mjs';

function candle(x,openY,closeY,extra={}){
 return {x,bodyTop:Math.min(openY,closeY),bodyBottom:Math.max(openY,closeY),highY:Math.min(openY,closeY)-5,
  lowY:Math.max(openY,closeY)+6,openY,closeY,direction:closeY<=openY?'UP':'DOWN',bodyWidth:5,confidence:.9,clipped:false,...extra};
}
const initial=()=>[candle(15,90,70),candle(35,60,80),candle(55,75,64),candle(75,70,60)];
const shifted=(candles,x,y)=>candles.map(c=>({...c,x:c.x+x,...Object.fromEntries(['bodyTop','bodyBottom','highY','lowY','openY','closeY'].map(k=>[k,c[k]+y]))}));
const data=candles=>({candles,region:{x:0,y:0,width:120,height:180}});
const meta=(capturedAt,extra={})=>({context:'chart-1',geometry:'120x180',capturedAt,...extra});
function changed(candles,closeY){return [...candles.slice(0,-1),candle(candles.at(-1).x,candles.at(-1).openY,closeY)];}

test('tracks price direction, velocity, range and reversals without OCR',()=>{
 const reader=createCandleReader();
 assert.equal(reader.inspect(data(initial()),meta(100)).status,'BASELINE');
 const up=reader.inspect(data(changed(initial(),56)),meta(200));
 assert.equal(up.status,'TRACKING');assert.equal(up.motion.source,'HISTORICAL_CANDLES');
 assert.equal(up.metrics.deltaPx,4);assert.equal(up.metrics.velocityPxPerSecond,40);assert.equal(up.metrics.netPx,4);
 const down=reader.inspect(data(changed(initial(),62)),meta(300));
 assert.equal(down.metrics.deltaPx,-6);assert.equal(down.metrics.reversals,1);assert.equal(down.metrics.netPx,-2);
 assert.equal(down.metrics.rangePx,6);assert.equal(down.metrics.pathPx,10);assert.equal(down.samples.length,3);
});

test('historical translation cancels chart pan rather than inventing a price move',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const panned=shifted(initial(),-3,7),result=reader.inspect(data(panned),meta(200));
 assert.equal(result.status,'TRACKING');assert.equal(result.motion.y,7);assert.equal(result.motion.x,-3);
 assert.equal(result.metrics.deltaPx,0);assert.equal(result.metrics.rangePx,0);
 const moving=reader.inspect(data(changed(panned,panned.at(-1).closeY-2)),meta(250));
 assert.equal(moving.metrics.deltaPx,2);assert.equal(moving.metrics.velocityPxPerSecond,40);
});

test('requires historical anchors even when motion was independently supplied',()=>{
 const reader=createCandleReader();reader.inspect(data(initial().slice(-2)),meta(100));
 const r=reader.inspect(data(changed(initial().slice(-2),54)),meta(200,{motion:{x:0,y:0}}));
 assert.equal(r.status,'BASELINE');assert.equal(r.reason,'UNVERIFIED_MOTION');assert.equal(r.metrics.updates,0);
 const good=createCandleReader();good.inspect(data(initial().slice(-3)),meta(100));
 assert.equal(good.inspect(data(changed(initial().slice(-3),54)),meta(200,{motion:{x:0,y:0}})).status,'TRACKING');
});

test('rejects zoom, deformed historical candles and incorrect motion',()=>{
 for(const supplied of [null,{x:0,y:0},{x:100,y:0}]){
  const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
  const zoom=initial().map(c=>({...c,bodyWidth:c.bodyWidth*2}));
  assert.equal(reader.inspect(data(zoom),meta(200,{motion:supplied})).reason,'UNVERIFIED_MOTION');
 }
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 assert.equal(reader.inspect(data(shifted(initial(),2,3)),meta(200,{motion:{x:0,y:0}})).reason,'UNVERIFIED_MOTION');
});

test('ambiguous repeated candle geometry cannot infer bar identity',()=>{
 const repeated=Array.from({length:9},(_,i)=>candle(10+i*4,80,60,{bodyWidth:1}));
 const reader=createCandleReader();reader.inspect(data(repeated),meta(100));
 const r=reader.inspect(data(changed(repeated,56)),meta(200));
 assert.equal(r.reason,'UNVERIFIED_MOTION');assert.equal(r.metrics.netPx,0);
});

test('new bar requires stable overlap and repeat confirmation, preserves bounded history',()=>{
 const reader=createCandleReader({maxHistory:1});let candles=initial();reader.inspect(data(candles),meta(100));
 const tracked=reader.inspect(data(changed(candles,55)),meta(200));candles=changed(candles,55);
 const next=[...candles,candle(95,56,53)];
 const pending=reader.inspect(data(next),meta(300));
 assert.equal(pending.reason,'NEW_CANDLE_PENDING');assert.equal(pending.history.length,0);
 const confirmed=reader.inspect(data(changed(next,51)),meta(400));
 assert.equal(confirmed.reason,'NEW_CANDLE_CONFIRMED');assert.equal(confirmed.history.length,1);
 assert.equal(confirmed.history[0].netPx,tracked.metrics.netPx);assert.equal(confirmed.stats.completed,1);
 assert.notEqual(confirmed.active.observedId,tracked.active.observedId);
});

test('disappearing latest is not a completed bar',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const gone=reader.inspect(data(initial().slice(0,-1)),meta(200,{motion:{x:0,y:0}}));
 assert.equal(gone.reason,'LATEST_DISAPPEARED');assert.equal(gone.history.length,0);assert.equal(gone.metrics.netPx,0);
});

test('several occlusion frames cannot promote an older bar or complete it on recovery',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 reader.inspect(data(changed(initial(),56)),meta(200));
 const missing=initial().slice(0,-1);
 for(const at of [300,400,500,600]){
  const hidden=reader.inspect(data(missing),meta(at));
  assert.equal(hidden.status,'UNAVAILABLE');assert.equal(hidden.active,null);assert.equal(hidden.history.length,0);
 }
 const restored=reader.inspect(data(initial()),meta(700));
 assert.equal(restored.reason,'CANDLE_RECOVERED');assert.equal(restored.status,'BASELINE');
 const tracked=reader.inspect(data(changed(initial(),57)),meta(800));
 assert.equal(tracked.active.x,75);assert.equal(tracked.history.length,0);assert.equal(tracked.metrics.netPx,3);
});

test('loss barrier follows corroborated pan and recovers without completing old bars',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const hidden=initial().slice(0,-1);
 assert.equal(reader.inspect(data(hidden),meta(200)).status,'UNAVAILABLE');
 assert.equal(reader.inspect(data(shifted(hidden,-3,5)),meta(300)).status,'UNAVAILABLE');
 const recovered=reader.inspect(data(shifted(initial(),-3,5)),meta(400));
 assert.equal(recovered.reason,'CANDLE_RECOVERED');assert.equal(recovered.history.length,0);assert.equal(recovered.active.x,72);
});

test('blank or failed detector cannot erase a loss barrier and promote closed bars',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 assert.equal(reader.inspect(data([]),meta(200)).reason,'NO_CANDLES');
 for(const at of [300,400,500])assert.equal(reader.inspect(data(initial().slice(0,-1)),meta(at)).status,'UNAVAILABLE');
 assert.equal(reader.inspect(data(initial()),meta(600)).reason,'CANDLE_RECOVERED');
 assert.equal(reader.inspect(data(initial()),meta(700)).history.length,0);
});

test('geometry changes clear historical pixel summaries and detector budget is preserved',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const next=[...initial(),candle(95,56,53)];reader.inspect(data(next),meta(200));
 const complete=reader.inspect(data(next),meta(300));assert.equal(complete.history.length,1);
 const resized=reader.inspect(data(next),meta(400,{geometry:'new-scale'}));
 assert.equal(resized.history.length,0);assert.equal(resized.stats.completed,0);
 const failed=reader.inspect({candles:[],diagnostics:{reason:'PIXEL_BUDGET'}},meta(500));
 assert.equal(failed.reason,'PIXEL_BUDGET');assert.equal(failed.status,'UNAVAILABLE');
});

test('clipped rightmost, missing data, malformed data and out-of-order reset observations',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const clip=initial();clip.at(-1).clipped=true;
 assert.equal(reader.inspect(data(clip),meta(200)).reason,'LATEST_CLIPPED');
 assert.equal(reader.inspect(data(initial()),meta(300)).reason,'CANDLE_RECOVERED');
 assert.equal(reader.inspect(data(initial()),meta(300)).reason,'OUT_OF_ORDER_FRAME');
 assert.equal(reader.inspect(data([]),meta(400)).reason,'NO_CANDLES');
 const bad=initial();bad[0].closeY=NaN;
 assert.equal(reader.inspect(data(bad),meta(500)).reason,'INVALID_DETECTION');
 assert.equal(reader.inspect(data(initial()),meta(600,{context:''})).reason,'INVALID_CONTEXT');
});

test('context, ROI geometry and capture gaps establish a fresh baseline',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 assert.equal(reader.inspect(data(initial()),meta(200,{context:'chart-2'})).reason,'CONTEXT_CHANGED');
 assert.equal(reader.inspect(data(initial()),meta(300,{context:'chart-2',geometry:'240x360'})).reason,'GEOMETRY_CHANGED');
 const movedROI=data(initial());movedROI.region.width=119;
 assert.equal(reader.inspect(movedROI,meta(400,{context:'chart-2',geometry:'240x360'})).reason,'GEOMETRY_CHANGED');
 assert.equal(reader.inspect(movedROI,meta(3001,{context:'chart-2',geometry:'240x360'})).reason,'CAPTURE_GAP');
});

test('samples and returned snapshots are bounded and cannot mutate reader state',()=>{
 const reader=createCandleReader({maxSamples:4});reader.inspect(data(initial()),meta(100));
 let r;for(let i=1;i<20;i++)r=reader.inspect(data(changed(initial(),60-i)),meta(100+i*10));
 assert.equal(r.samples.length,4);assert.equal(r.metrics.updates,19);
 r.metrics.netPx=999;r.samples[0].valuePx=999;r.active.closeY=999;
 const after=reader.inspect(data(changed(initial(),40)),meta(310));assert.equal(after.metrics.netPx,20);
 reader.reset();const reset=reader.inspect(data(initial()),meta(400));assert.equal(reset.stats.completed,0);assert.equal(reset.metrics.updates,0);
});

test('ambiguous historical x groups are excluded while independent anchors track the latest candle',()=>{
 const reader=createCandleReader();
 const clean=[candle(5,100,92),...initial()];
 const fragments=[...clean,candle(15,130,124),candle(15.5,150,142)];
 const first=reader.inspect(data(fragments),meta(100));
 assert.equal(first.status,'BASELINE');assert.equal(first.ignoredHistorical,3);assert.equal(first.ignoredHistoricalGroups,1);
 assert.equal(first.candles.some(c=>c.x>=15&&c.x<=15.5),false);
 const tracked=reader.inspect(data([...changed(clean,55),candle(15,130,124),candle(15.5,150,142)]),meta(200));
 assert.equal(tracked.status,'TRACKING');assert.equal(tracked.active.x,75);assert.equal(tracked.metrics.deltaPx,5);
 assert.equal(tracked.ignoredHistorical,3);assert.equal(tracked.motion.anchors,3);
 assert.equal(tracked.active.lowY,76);assert.equal(tracked.candles.some(c=>c.lowY>110),false);
 tracked.candles[0].closeY=999;tracked.active.closeY=999;
 const after=reader.inspect(data([...changed(clean,52),candle(15,130,124),candle(15.5,150,142)]),meta(300));
 assert.equal(after.metrics.netPx,8);assert.equal(after.candles[0].closeY,92);
});

test('excluding ambiguous historical groups cannot waive the minimum stable anchors',()=>{
 const reader=createCandleReader();const fragment=candle(15,130,124);
 reader.inspect(data([...initial(),fragment]),meta(100));
 const r=reader.inspect(data([...changed(initial(),55),fragment]),meta(200));
 assert.equal(r.reason,'UNVERIFIED_MOTION');assert.notEqual(r.status,'TRACKING');assert.equal(r.metrics.updates,0);
 assert.equal(r.ignoredHistorical,2);assert.equal(r.candles.length,3);
});

test('a duplicate latest group remains unavailable and cannot promote an older candle',()=>{
 const reader=createCandleReader();reader.inspect(data(initial()),meta(100));
 const ambiguous=[...initial(),candle(95,70,60),candle(95.5,140,130)];
 const r=reader.inspect(data(ambiguous),meta(200));
 assert.equal(r.status,'UNAVAILABLE');assert.equal(r.reason,'AMBIGUOUS_CANDLES');assert.equal(r.active,null);
 for(const at of [300,400,500])assert.equal(reader.inspect(data(initial()),meta(at)).status,'UNAVAILABLE');
 assert.equal(reader.inspect(data([...initial(),candle(95,70,58)]),meta(600)).reason,'CANDLE_RECOVERED');
});

test('historical ambiguity grouping chains adjacent positions and never hides malformed geometry',()=>{
 const reader=createCandleReader();const clean=[candle(5,100,92),...initial()];
 const r=reader.inspect(data([...clean,candle(15.5,130,124),candle(16,150,142)]),meta(100));
 assert.equal(r.ignoredHistorical,3);assert.equal(r.candles.some(c=>c.x>=15&&c.x<=16),false);
 const bad=[...clean,candle(15,130,124)];bad.at(-1).openY=NaN;
 assert.equal(reader.inspect(data(bad),meta(200)).reason,'INVALID_DETECTION');
});
