import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real frame callback with a delivered image whose chart layout
// remains unavailable. Browser services are stubbed; no UI or capture is opened.
const source=await readFile(new URL('../experiment.js',import.meta.url),'utf8');
const start=source.indexOf('function sample(frame={}) {');
const end=source.indexOf("\n$('chart').addEventListener",start);
assert.ok(start>=0&&end>start,'frame callback source must be available');
const frameCallback=source.slice(start,end);

test('received frames keep throttled telemetry live while automatic layout is unavailable',()=>{
 let elapsed=0;
 const samples=[],receipts=[],timingPaints=[],capturePaints=[],statuses=[];
 const scope={
  running:true,performance:{now:()=>elapsed},Date,
  lastNewFrameAt:0,lastVideoTime:-1,video:{currentTime:1},videoStalled:false,
  paint:()=>true,canvas:{width:2,height:2},ctx:{getImageData:()=>({width:2,height:2,data:new Uint8ClampedArray(16)})},
  timing:{add:(kind,ms)=>samples.push({kind,ms})},captureRate:{observe:receipt=>receipts.push(receipt)},
  autoMode:true,activeLayout:null,pendingLayout:null,pendingCount:0,lastLayoutProbeAt:0,layoutSearchStartedAt:null,layoutWaitLogged:false,
  detectAutoLayout:()=>null,setStatus:text=>statuses.push(text),lastTelemetryAt:0,
  updateTimingDisplay:()=>{timingPaints.push(scope.lastTelemetryAt);elapsed+=4;},
  updateCaptureDisplay:()=>{capturePaints.push(scope.lastTelemetryAt);elapsed+=5;},
  replayRecorder:{snapshot:()=>({active:false,busy:false})},
  resetCandles:()=>{},log:message=>{throw Error(message);},
 };
 vm.createContext(scope);vm.runInContext(frameCallback,scope);
 for(const receivedAt of [1000,1100,1500])scope.sample({receivedAt,metadata:{presentedFrames:receivedAt/100}});
 assert.equal(statuses.length,3,'each delivered frame still attempts layout discovery');
 assert.ok(statuses.every(status=>status==='מאתר את אזור הגרף.'));
 assert.equal(receipts.length,3,'all attempts contribute to capture-rate metrics');
 assert.equal(samples.filter(sample=>sample.kind==='total').length,3);
 assert.deepEqual(timingPaints,[1000,1500]);
 assert.deepEqual(capturePaints,[1000,1500],'UI refresh stays bounded to twice per second');
 assert.equal(receipts[0].processingMs,9,'full processing duration includes telemetry rendering');
});

test('a prolonged ambiguous-layout search explains recovery and logs once per search period',()=>{
 const statuses=[],logs=[];
 const scope={
  running:true,performance:{now:()=>0},Date,
  lastNewFrameAt:0,lastVideoTime:-1,video:{currentTime:1},videoStalled:false,
  paint:()=>true,canvas:{width:2,height:2},ctx:{getImageData:()=>({width:2,height:2,data:new Uint8ClampedArray(16)})},
  timing:{add:()=>{}},captureRate:{observe:()=>{}},
  autoMode:true,activeLayout:null,pendingLayout:null,pendingCount:0,lastLayoutProbeAt:0,layoutSearchStartedAt:null,layoutWaitLogged:false,
  detectAutoLayout:()=>null,setStatus:text=>statuses.push(text),lastTelemetryAt:0,
  updateTimingDisplay:()=>{},updateCaptureDisplay:()=>{},replayRecorder:{snapshot:()=>({active:false,busy:false})},
  resetCandles:()=>{},log:message=>logs.push(message),
  cachedLayoutStillVisible:()=>false,blockShortcuts:()=>{},clearLatestArrow:()=>{},resetDigitContext:()=>{},
 };
 vm.createContext(scope);vm.runInContext(frameCallback,scope);
 for(const receivedAt of [1000,3999,4000,4500,5000])scope.sample({receivedAt});
 assert.equal(statuses[0],'מאתר את אזור הגרף.');
 assert.equal(statuses[1],'מאתר את אזור הגרף.','initial three-second discovery window stays brief');
 assert.ok(statuses.slice(2).every(status=>status.includes('גרף יחיד')&&status.includes('ידנית')));
 assert.equal(logs.filter(message=>message.includes(' | LAYOUT_WAIT | ')).length,1);
 assert.ok(logs[0].includes('NO_UNAMBIGUOUS_CHART'));
 // A formerly located chart disappearing starts a separate search period.
 scope.activeLayout={chart:{}};
 scope.sample({receivedAt:6000});
 assert.equal(statuses.at(-1),'מאתר את אזור הגרף.');
 scope.sample({receivedAt:9000});scope.sample({receivedAt:9500});
 assert.equal(logs.filter(message=>message.includes(' | LAYOUT_WAIT | ')).length,2,'new loss can log exactly once again');
});
