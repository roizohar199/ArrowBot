import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelLatencyProbe,inspectCaptureFrame} from '../latency-probe.mjs';

function fixture(){
 let at=20,nextRaf=0,drawCalls=0,observer;
 const rafs=new Map(),timers=new Map(),preview={},other={},nodes={
  'stop':{disabled:false},'shortcut-toggle':{getAttribute:()=> 'false'},'candle-state':{dataset:{state:'TRACKING'}},
 };
 class Frame{constructor(metadata={captureTime:10},timestamp=1000000){this.value=metadata;this.timestamp=timestamp;this.reads=0;}metadata(){this.reads++;return this.value;}}
 class Context{constructor(canvas){this.canvas=canvas;}drawImage(){drawCalls++;return 'drawn';}}
 class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observer=this;}observe(){}disconnect(){this.disconnected=true;}}
 const detail={getBoundingClientRect:()=>({left:10,top:10,right:110,bottom:40,width:100,height:30}),closest:()=>({scrollIntoView:()=>{}})};
 const panel={CanvasRenderingContext2D:Context,VideoFrame:Frame,MutationObserver:Observer,
  performance:{now:()=>at,timeOrigin:1700000000000},navigator:{userAgent:'Test Chrome/151.0.0.0'},
  document:{visibilityState:'visible',hidden:false,getElementById:id=>nodes[id],querySelector:()=>({textContent:'0.7.1'})},
  innerWidth:800,innerHeight:600,scrollX:0,scrollY:0,scrollTo(){},
  requestAnimationFrame:callback=>{const id=++nextRaf;rafs.set(id,callback);return id;},cancelAnimationFrame:id=>rafs.delete(id),
  setTimeout:callback=>{const id=timers.size+1;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){},
 };
 const context=new Context(preview),original=Context.prototype.drawImage;
 return {panel,preview,detail,Frame,context,original,other,nodes,setTime:value=>{at=value;},drawCalls:()=>drawCalls,observer:()=>observer,
  mutate:()=>observer.callback(),raf(time){at=time;const item=rafs.entries().next().value;assert.ok(item,'pending rAF');rafs.delete(item[0]);item[1](time);},pendingRafs:()=>rafs.size};
}

test('feature probe taps only the preview, calls original once and restores after three real frames',async()=>{
 const f=fixture();let result;
 const probe=createPanelLatencyProbe({...f,onComplete:r=>{result=r;}}).start();
 const unrelated=new f.panel.CanvasRenderingContext2D(f.other),ignored=new f.Frame();
 assert.equal(unrelated.drawImage(ignored),'drawn');assert.equal(ignored.reads,0);
 for(let i=0;i<3;i++){const frame=new f.Frame();assert.equal(f.context.drawImage(frame),'drawn');assert.equal(frame.reads,1);}
 await Promise.resolve();
 assert.equal(f.drawCalls(),4);assert.equal(result.totalDraws,3);assert.equal(result.validCaptureFrames,3);
 assert.equal(result.featureFrames[0].mediaTimestampUs,1000000);assert.equal(result.featureFrames[0].metadata.captureTime,10);
 assert.equal(result.browser.chromeVersion,'151.0.0.0');assert.equal(result.restoration,'RESTORED');
 assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);assert.equal(f.observer().disconnected,true);
 assert.equal(probe.stop(),null,'completion is idempotent');
});

test('media timestamps never substitute for absent or future capture metadata',async()=>{
 const f=fixture();let result;
 const absent=inspectCaptureFrame(new f.Frame({}),f.panel,19,20);assert.equal(absent.captureTimeValid,false);assert.equal(absent.captureToDrawMs,null);
 const future=inspectCaptureFrame(new f.Frame({captureTime:100}),f.panel,19,20);assert.equal(future.captureTimeValid,false);
 const probe=createPanelLatencyProbe({...f,mode:'latency',onComplete:r=>{result=r;}}).start();
 for(let i=0;i<3;i++)f.context.drawImage(new f.Frame({},1000000+i*33333));
 await Promise.resolve();
 assert.equal(result.reason,'CAPTURE_TIME_UNAVAILABLE');assert.equal(result.latencyAvailable,false);assert.equal(result.paintSamples,0);
 assert.equal(result.latencyMs.lowerPaintOpportunity.p50Ms,null);assert.equal(result.restoration,'RESTORED');probe.stop();
});

test('capture-to-paint opportunity bounds use the panel performance clock and actual result mutation',()=>{
 const f=fixture();const probe=createPanelLatencyProbe({...f,mode:'latency'}).start();
 f.context.drawImage(new f.Frame({captureTime:10}));f.setTime(25);f.mutate();f.raf(32);f.raf(48);
 const result=probe.stop();
 assert.equal(result.paintSamples,1);assert.equal(result.samples[0].lowerMs,22);assert.equal(result.samples[0].upperMs,38);
 assert.equal(result.samples[0].captureToMutationMs,15);assert.equal(result.samples[0].captureToDrawMs,10);
 assert.equal(result.latencyMs.lowerPaintOpportunity.p50Ms,22);assert.equal(result.latencyMs.upperPaintOpportunity.p95Ms,38);
 assert.equal(result.restoration,'RESTORED');
});

test('hidden or offscreen results are excluded and superseded renders cannot be mispaired',()=>{
 const f=fixture();const probe=createPanelLatencyProbe({...f,mode:'latency'}).start();
 f.context.drawImage(new f.Frame());f.mutate();f.panel.document.hidden=true;f.raf(32);
 assert.equal(probe.snapshot().discarded.hidden,1);assert.equal(probe.snapshot().paintSamples,0);
 f.panel.document.hidden=false;
 const originalRect=f.detail.getBoundingClientRect;
 f.detail.getBoundingClientRect=()=>({left:10,top:-20,right:110,bottom:10,width:100,height:30});
 f.context.drawImage(new f.Frame());f.mutate();assert.equal(probe.snapshot().discarded.offscreen,1);
 f.detail.getBoundingClientRect=originalRect;f.setTime(40);f.context.drawImage(new f.Frame({captureTime:30},2));f.mutate();
 f.setTime(45);f.context.drawImage(new f.Frame({captureTime:35},3));f.mutate();
 f.raf(48);f.raf(64);
 const result=probe.stop();assert.equal(result.discarded.superseded,1);assert.equal(result.samples.length,1);
 assert.equal(result.samples[0].mediaTimestampUs,3);assert.equal(f.pendingRafs(),0);
});

test('stopping never overwrites another replacement and metadata errors never break the draw',()=>{
 const f=fixture();const probe=createPanelLatencyProbe({...f}).start();
 const bad=new f.Frame();bad.metadata=()=>{throw Error('unsupported metadata');};
 assert.equal(f.context.drawImage(bad),'drawn');assert.match(probe.snapshot().featureFrames[0].metadataError,/unsupported/);
 const replacement=()=> 'another owner';f.panel.CanvasRenderingContext2D.prototype.drawImage=replacement;
 const result=probe.stop();assert.equal(result.restoration,'NOT_OVERWRITTEN_CHANGED_ELSEWHERE');
 assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,replacement);
});

test('a changed shortcut state aborts instrumentation without trading actions',async()=>{
 const f=fixture();let result;createPanelLatencyProbe({...f,onComplete:r=>{result=r;}}).start();
 f.nodes['shortcut-toggle'].getAttribute=()=> 'true';
 assert.equal(f.context.drawImage(new f.Frame()),'drawn');await Promise.resolve();
 assert.equal(result.reason,'SHORTCUTS_NOT_OFF');assert.equal(result.totalDraws,0);
 assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);
});
