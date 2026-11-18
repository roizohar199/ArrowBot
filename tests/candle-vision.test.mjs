import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createCandleVision,findCandles} from '../candle-vision.mjs';

const up=[38,166,154,255],down=[239,83,80,255];
function image(width=180,height=140,background=[19,23,34,255]){
 const data=new Uint8ClampedArray(width*height*4);for(let p=0;p<data.length;p+=4)data.set(background,p);return {width,height,data};
}
function rect(im,x,y,w,h,color){for(let yy=Math.max(0,y);yy<Math.min(im.height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(im.width,x+w);xx++)im.data.set(color,(yy*im.width+xx)*4);}
function candle(im,{x=30,bodyTop=40,bodyBottom=70,highY=20,lowY=90,width=7,color=up}={}){
 rect(im,x,highY,1,lowY-highY+1,color);rect(im,x-Math.floor(width/2),bodyTop,width,bodyBottom-bodyTop+1,color);
}
const full=im=>({x:0,y:0,width:im.width,height:im.height});

test('reads sorted filled candles and visual OHLC on dark and light backgrounds',()=>{
 for(const bg of [[19,23,34,255],[255,255,255,255]]){
  const im=image(180,140,bg);candle(im,{x:110,color:down,bodyTop:55,bodyBottom:85});candle(im);
  const r=findCandles(im,full(im));assert.equal(r.candles.length,2);
  assert.deepEqual(r.candles.map(c=>[c.x,c.direction,c.openY,c.closeY,c.highY,c.lowY,c.bodyWidth,c.clipped]),[[30,'UP',70,40,20,90,7,false],[110,'DOWN',55,85,20,90,7,false]]);
 }
});
test('reads short doji bodies with independent centered wicks',()=>{
 const im=image();candle(im,{bodyTop:50,bodyBottom:50,width:5});
 const [c]=findCandles(im,full(im)).candles;assert.ok(c);assert.equal(c.openY,50);assert.equal(c.closeY,50);assert.equal(c.highY,20);assert.equal(c.lowY,90);
});
test('does not merge adjacent same-color candles',()=>{
 const im=image();candle(im,{x:30});candle(im,{x:39});assert.deepEqual(findCandles(im,full(im)).candles.map(c=>c.x),[30,39]);
});
test('rejects grid, horizontal order strokes, text-like and triangle components',()=>{
 const im=image();rect(im,0,30,180,1,[100,100,100,255]);rect(im,0,50,180,3,up);rect(im,70,80,50,2,down);
 // H-shaped label glyph has two off-center vertical strokes.
 rect(im,20,70,2,20,up);rect(im,29,70,2,20,up);rect(im,20,79,11,2,up);
 for(let y=0;y<12;y++)rect(im,140-y,100+y,y*2+1,1,down);
 assert.deepEqual(findCandles(im,full(im)).candles,[]);
});
test('removes crossing price guides while retaining candle body and wick',()=>{
 const im=image();candle(im);candle(im,{x:80});rect(im,0,55,180,1,up);
 const r=findCandles(im,full(im));assert.equal(r.candles.length,2);assert.deepEqual(r.candles.map(c=>[c.x,c.closeY,c.openY]),[[30,40,70],[80,40,70]]);
});
test('recognizable clipped latest candle is marked, and ROI stays in image bounds',()=>{
 const im=image();candle(im,{x:30});candle(im,{x:110,highY:0});
 const r=findCandles(im,{x:-5,y:-8,width:190,height:160});assert.equal(r.candles.length,2);assert.equal(r.candles[1].clipped,true);assert.deepEqual(r.region,full(im));
 const crop=findCandles(im,{x:29,y:0,width:151,height:140});assert.equal(crop.candles[0].clipped,true);
});
test('blank, invalid input and budget failures do not return partial candles',()=>{
 const im=image();assert.equal(findCandles(im,full(im)).diagnostics.reason,'NO_CANDLES');
 assert.equal(findCandles({...im,data:im.data.subarray(4)},full(im)).diagnostics.reason,'INVALID_IMAGE');
 assert.equal(findCandles(im,{...full(im),x:NaN}).diagnostics.reason,'INVALID_IMAGE');
 assert.equal(createCandleVision({maxPixels:10}).inspect(im,full(im)).diagnostics.reason,'PIXEL_BUDGET');
 candle(im);candle(im,{x:80});assert.equal(createCandleVision({maxCandles:1}).inspect(im,full(im)).diagnostics.reason,'CANDLE_BUDGET');
});
test('reuses buffers and reads explicit custom colors without confusing direction',()=>{
 const im=image();candle(im,{color:[30,90,225,255]});const reader=createCandleVision(),palette={up:[30,90,225],down:[225,160,30]};
 const first=reader.inspect(im,full(im),{palette});assert.equal(first.candles[0].direction,'UP');reader.inspect(im,full(im),{palette});assert.equal(reader.snapshot().allocations,1);
 assert.equal(reader.inspect(im,full(im),{palette:{up:[1,2],down:[1,2,3]}}).diagnostics.reason,'INVALID_PALETTE');
});
test('splits sparse dim bleed between packed candles, but keeps solid broad bodies intact',()=>{
 const packed=image();candle(packed,{x:30,bodyTop:40,bodyBottom:50,width:5,color:down});candle(packed,{x:36,bodyTop:45,bodyBottom:55,width:5,color:down});
 rect(packed,33,46,1,1,[110,10,12,255]);
 const repaired=findCandles(packed,full(packed));assert.deepEqual(repaired.candles.map(c=>c.x),[30,36]);assert.equal(repaired.diagnostics.bridgeColumns,1);
 const broad=image();candle(broad,{x:60,bodyTop:40,bodyBottom:75,width:21,color:down});rect(broad,57,40,1,36,[110,10,12,255]);
 const intact=findCandles(broad,full(broad));assert.equal(intact.candles.length,1);assert.equal(intact.candles[0].x,60);assert.equal(intact.diagnostics.bridgeColumns,0);
 // A solid bridge lacks evidence of a capture artifact: do not invent a split.
 rect(packed,33,46,1,1,down);assert.deepEqual(findCandles(packed,full(packed)).candles,[]);
});
test('does not turn a broad label with a dim sparse separator into two candles',()=>{
 const im=image();rect(im,35,45,30,5,down);rect(im,49,45,1,5,[19,23,34,255]);rect(im,49,47,1,1,[110,10,12,255]);
 assert.deepEqual(findCandles(im,full(im)).candles,[]);
});
test('rejects near-square patches with tiny wicks but keeps tall wickless bodies',()=>{
 const im=image();candle(im,{x:30,bodyTop:42,bodyBottom:45,highY:41,lowY:46,width:6,color:down});
 candle(im,{x:80,bodyTop:30,bodyBottom:60,highY:30,lowY:60,width:7,color:down});
 const result=findCandles(im,full(im));assert.deepEqual(result.candles.map(c=>c.x),[80]);assert.equal(result.candles[0].bodyTop,30);assert.equal(result.candles[0].bodyBottom,60);
});
test('rejects unchanged real indicator icon that resembles a tiny candle',()=>{
 const meta=JSON.parse(readFileSync(new URL('./fixtures/tradingview-indicator-icon.json',import.meta.url),'utf8'));
 const data=gunzipSync(readFileSync(new URL('./fixtures/tradingview-indicator-icon.rgba.gz',import.meta.url)));
 assert.equal(createHash('sha256').update(data).digest('hex'),meta.rgbaSha256);
 const im={width:meta.crop.width,height:meta.crop.height,data};assert.deepEqual(findCandles(im,full(im)).candles,[]);
});
test('recovers 16 of 17 independently counted bodies in unchanged real compressed pixels',()=>{
 const base=new URL('./fixtures/tradingview-packed-candles.json',import.meta.url),meta=JSON.parse(readFileSync(base,'utf8'));
 const data=gunzipSync(readFileSync(new URL('./fixtures/tradingview-packed-candles.rgba.gz',import.meta.url)));
 assert.equal(createHash('sha256').update(data).digest('hex'),meta.rgbaSha256);
 const im={width:meta.crop.width,height:meta.crop.height,data},result=findCandles(im,full(im));
 const centers=result.candles.map(c=>c.x+meta.crop.x),expected=meta.independentBodyCenters.filter(x=>x!==meta.knownMissingCenter);
 assert.deepEqual(centers,expected);assert.equal(centers.length,16);assert.equal(meta.independentBodyCenters.length,17);
 assert.ok(result.candles.every(c=>c.bodyWidth===5&&!c.clipped));
 assert.equal(result.candles.find(c=>c.x+meta.crop.x===837).direction,'UP');
});
