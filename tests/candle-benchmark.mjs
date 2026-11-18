import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createCandleVision} from '../candle-vision.mjs';
import {createCandleReader} from '../candle-reader.mjs';

// Run explicitly: node tests/candle-benchmark.mjs. No timing pass/fail threshold:
// hardware and process load vary; this measures controlled raster fixtures only.
const width=1920,height=1080,region={x:1050,y:80,width:800,height:850};
const image={width,height,data:new Uint8ClampedArray(width*height*4)},background=[19,23,34,255],up=[38,166,154,255],down=[239,83,80,255];
for(let p=0;p<image.data.length;p+=4)image.data.set(background,p);
function rect(x,y,w,h,color){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)image.data.set(color,(yy*width+xx)*4);}
function candle(x,open,close,high,low){const color=close<=open?up:down;rect(x,high,1,low-high+1,color);rect(x-4,Math.min(open,close),9,Math.abs(open-close)+1,color);}
for(let i=0;i<24;i++){const x=1075+i*29,base=270+(i*37)%340,close=base+(i%2?35:-45);candle(x,base,close,Math.min(base,close)-15,Math.max(base,close)+19);}
const activeX=1790,openY=450;
const vision=createCandleVision(),reader=createCandleReader(),samples=[];
let allocationsAfterWarmup=null,last=null;
for(let i=0;i<360;i++){
 rect(activeX-5,360,11,180,background);
 const closeY=430+Math.round(Math.sin(i/12)*30);candle(activeX,openY,closeY,Math.min(openY,closeY)-12,Math.max(openY,closeY)+13);
 const start=performance.now(),detection=vision.inspect(image,region),result=reader.inspect(detection,{context:'benchmark',geometry:'1920x1080:800x850',capturedAt:1000+i*33});
 const elapsed=performance.now()-start;
 if(i===59)allocationsAfterWarmup=vision.snapshot().allocations;
 if(i>=60)samples.push(elapsed);
 last={detection,result};
}
assert.equal(samples.length,300);assert.ok(last.detection.candles.length>=20);assert.equal(last.result.status,'TRACKING',last.result.reason);
assert.equal(vision.snapshot().allocations,allocationsAfterWarmup,'same-size frames must reuse scratch buffers');
samples.sort((a,b)=>a-b);
const percentile=p=>Number(samples[Math.ceil(samples.length*p)-1].toFixed(3));
console.log(JSON.stringify({scenario:'synthetic-filled-candles',image:{width,height},region,warmupFrames:60,measuredFrames:samples.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:Number(samples.at(-1).toFixed(3)),candles:last.detection.candles.length,probes:last.detection.diagnostics.probes,scratchBufferPixels:vision.snapshot().bufferPixels,bufferAllocations:vision.snapshot().allocations,reusedAfterWarmup:vision.snapshot().allocations===allocationsAfterWarmup},null,2));
