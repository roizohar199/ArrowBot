import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandleVision} from '../candle-vision.mjs';
import {createCandleReader} from '../candle-reader.mjs';

// Real raster frames keep the detector and temporal reader contracts honest.
// These are controlled visual fixtures, not evidence of live TradingView accuracy.
const up=[38,166,154,255],down=[239,83,80,255];
const historical=[
 {x:40,openY:120,closeY:92,highY:80,lowY:132},
 {x:80,openY:94,closeY:128,highY:85,lowY:140},
 {x:120,openY:140,closeY:110,highY:103,lowY:150},
 {x:160,openY:107,closeY:80,highY:72,lowY:118},
];
const active={x:200,openY:110,closeY:100,highY:95,lowY:120};
const region={x:10,y:10,width:290,height:210};
function rect(image,x,y,width,height,color){
 for(let yy=Math.max(0,y);yy<Math.min(image.height,y+height);yy++)for(let xx=Math.max(0,x);xx<Math.min(image.width,x+width);xx++)image.data.set(color,(yy*image.width+xx)*4);
}
function frame(candles=[...historical,active],{dx=0,dy=0,scaleY=1}={}){
 const image={width:320,height:240,data:new Uint8ClampedArray(320*240*4)};
 for(let p=0;p<image.data.length;p+=4)image.data.set([19,23,34,255],p);
 for(const candle of candles){
  const x=Math.round(candle.x+dx),top=Math.round(Math.min(candle.openY,candle.closeY)*scaleY+dy),bottom=Math.round(Math.max(candle.openY,candle.closeY)*scaleY+dy),high=Math.round(candle.highY*scaleY+dy),low=Math.round(candle.lowY*scaleY+dy),color=candle.closeY<=candle.openY?up:down;
  rect(image,x,high,1,low-high+1,color);rect(image,x-3,top,7,bottom-top+1,color);
 }
 return image;
}
function pipeline(){
 const vision=createCandleVision(),reader=createCandleReader();
 let at=1000;
 return {reader,read(candles,options={}){
  at+=options.elapsedMs??40;
  const detection=vision.inspect(frame(candles,options),options.region??region);
  return reader.inspect(detection,{context:'chart-A',geometry:'320x240',capturedAt:at,...(options.motion?{motion:options.motion}:{})});
 }};
}
function tracking(result){assert.equal(result.status,'TRACKING',result.reason);assert.ok(result.active);return result.metrics;}

test('raster growth and close crossing open preserve signed intrabar movement',()=>{
 const p=pipeline();assert.equal(p.read().status,'BASELINE');
 const grown={...active,closeY:90,highY:87};
 const first=p.read([...historical,grown]);
 assert.equal(tracking(first).deltaPx,10);assert.equal(first.metrics.netPx,10);assert.ok(first.metrics.velocityPxPerSecond>0);
 const flipped={...active,closeY:119,highY:87,lowY:125};
 const second=p.read([...historical,flipped]);
 assert.equal(tracking(second).deltaPx,-29);assert.equal(second.metrics.netPx,-19);assert.equal(second.active.direction,'DOWN');assert.ok(second.metrics.reversals>=1);
});

test('raster chart translation is removed using historical anchors',()=>{
 const p=pipeline();p.read();
 const result=p.read(undefined,{dx:5,dy:7});
 assert.equal(tracking(result).deltaPx,0);assert.equal(result.metrics.netPx,0);
 const changed={...active,closeY:91,highY:87};
 const next=p.read([...historical,changed],{dx:5,dy:7});
 assert.equal(tracking(next).deltaPx,9);assert.equal(next.metrics.netPx,9);
});

test('zoom cannot masquerade as an intrabar price change',()=>{
 const p=pipeline();p.read();p.read();
 const result=p.read(undefined,{scaleY:1.2,motion:{x:0,y:0}});
 assert.notEqual(result.status,'TRACKING',result.reason);
 assert.ok(!result.metrics||result.metrics.netPx===0);
 assert.equal(result.history.length,0);
});

test('capture gaps start fresh observed history without invented movement',()=>{
 const p=pipeline();p.read();p.read([...historical,{...active,closeY:90,highY:87}]);
 const result=p.read([...historical,{...active,closeY:80,highY:75}],{elapsedMs:3000});
 assert.equal(result.status,'BASELINE');assert.equal(result.metrics.netPx,0);assert.equal(result.history.length,0);
});

test('a new rightmost candle completes only observed history',()=>{
 const p=pipeline();p.read();p.read([...historical,{...active,closeY:90,highY:87}]);
 const finished={...active,closeY:90,highY:87},next={x:240,openY:90,closeY:97,highY:86,lowY:103},candles=[...historical,finished,next];
 let result=p.read(candles);result=p.read(candles);
 assert.equal(result.active.x,240);assert.equal(result.metrics.netPx,0);assert.equal(result.history.length,1);
 assert.equal(result.history[0].netPx??result.history[0].metrics?.netPx,10);
});

test('occlusion does not promote the previous candle or invent a completed bar',()=>{
 const p=pipeline();p.read();p.read();
 const absent=p.read(historical);
 assert.notEqual(absent.status,'TRACKING');assert.equal(absent.history.length,0);
 const recovered=p.read();
 assert.notEqual(recovered.status,'TRACKING');assert.equal(recovered.metrics?.netPx??0,0);
 const stable=p.read();
 assert.equal(stable.active?.x,200);assert.equal(stable.history.length,0,'restoring an occluded candle must not complete the preceding historical candle');
});

test('a clipped rightmost candle does not become a measured active candle',()=>{
 const p=pipeline();p.read();p.read();
 const result=p.read([...historical,{...active,highY:10}],{region});
 assert.notEqual(result.status,'TRACKING');assert.equal(result.history.length,0);
});

test('same-color histogram at the latest x is ambiguous, not extra candle range',()=>{
 const p=pipeline();p.read();p.read();
 const histogram={x:200,openY:200,closeY:170,highY:170,lowY:200};
 const result=p.read([...historical,active,histogram]);
 assert.notEqual(result.status,'TRACKING');assert.equal(result.history.length,0);
});
