import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureRateController,compareCaptureRates} from '../capture-rate.mjs';

test('microsecond frame identities do not invent hundreds of thousands of missed frames',()=>{
 const controller=createCaptureRateController();
 for(let i=0;i<10;i++)controller.observe({at:1000+i*1000/30,processingMs:2,frameId:1000000+i*33333});
 const metrics=controller.snapshot();
 assert.equal(metrics.frames,10);assert.ok(Math.abs(metrics.deliveredFps-30)<.001);
 assert.equal(metrics.processingP95,2);assert.equal(metrics.missed,0);assert.equal(metrics.missedKnown,false);
});

test('actual presentation-counter gaps are counted independently of timestamp identities',()=>{
 const controller=createCaptureRateController();
 [10,11,15,16].forEach((presentedFrames,i)=>controller.observe({at:1000+i*40,processingMs:3,presentedFrames,frameId:1000000+i*40000}));
 const metrics=controller.snapshot();
 assert.equal(metrics.missed,3);assert.equal(metrics.missedKnown,true);
 assert.equal(metrics.deliveredFps,25);assert.equal(metrics.processingP95,3);
});

test('missing, malformed or reset presentation counters cannot bridge an unknown interval',()=>{
 for(const unavailable of [undefined,null,NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  const controller=createCaptureRateController();
  controller.observe({at:1000,presentedFrames:10});
  controller.observe({at:1040,presentedFrames:unavailable});
  controller.observe({at:1080,presentedFrames:20});
  controller.observe({at:1120,presentedFrames:23});
  assert.equal(controller.snapshot().missed,2);
  assert.equal(controller.snapshot().missedKnown,false);
 }
 const reset=createCaptureRateController();
 [100,1,4].forEach((presentedFrames,i)=>reset.observe({at:1000+i*40,presentedFrames}));
 assert.equal(reset.snapshot().missed,2);assert.equal(reset.snapshot().missedKnown,false);
});

test('metric reset starts a new presentation-counter baseline and stale receipts are ignored',()=>{
 const controller=createCaptureRateController();
 controller.observe({at:1000,presentedFrames:1});controller.observe({at:1040,presentedFrames:6});
 assert.equal(controller.snapshot().missed,4);
 controller.resetMetrics();
 assert.equal(controller.snapshot().missedKnown,false);assert.equal(controller.snapshot().frames,0);
 controller.observe({at:2000,presentedFrames:200});
 controller.observe({at:2000,presentedFrames:999});
 controller.observe({at:1990,presentedFrames:999});
 controller.observe({at:2040,presentedFrames:201});
 assert.equal(controller.snapshot().frames,2);assert.equal(controller.snapshot().missed,0);assert.equal(controller.snapshot().missedKnown,true);
});

test('60 FPS recommendation requires known frame-gap evidence when marked unavailable',()=>{
 const base={frames:300,deliveredFps:30,processingP95:4,missed:0,missedKnown:true};
 const fast={...base,deliveredFps:60,processingP95:5};
 assert.equal(compareCaptureRates(base,fast).recommended,60);
 assert.equal(compareCaptureRates(base,{...fast,missedKnown:false}).recommended,30);
 assert.equal(compareCaptureRates(base,{...fast,missed:null}).recommended,30);
 assert.equal(compareCaptureRates(base,{...fast,missed:30}).recommended,30);
});
