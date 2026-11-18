import test from 'node:test';
import assert from 'node:assert/strict';
import {installCaptureProbeControls} from '../capture-probe-controls.mjs';

function fixture(){
  let at=20,observer,nextRaf=0,drawCalls=0;const rafs=new Map(),timers=new Map(),blobs=[],downloads=[];
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.textContent='';this.style={};this.attributes={};this.events=new Map();this.disabled=false;}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    remove(){if(this.parent){this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}}
    setAttribute(name,value){this.attributes[name]=value;}
    getAttribute(name){return this.attributes[name]??null;}
    addEventListener(name,fn){this.events.set(name,fn);}
    removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}
    click(){if(this.disabled)return;if(this.tag==='a')downloads.push({href:this.href,name:this.download});this.events.get('click')?.();}
  }
  const container=new Node('div'),body=new Node('body'),preview={},detail=new Node('p'),shortcut=new Node('button'),monitorStop=new Node('button');
  shortcut.setAttribute('aria-pressed','false');monitorStop.disabled=false;
  detail.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});detail.closest=()=>({scrollIntoView(){}});
  class Frame{constructor(metadata={captureTime:10}){this.value=metadata;this.timestamp=1000000;}metadata(){return this.value;}}
  class Context{constructor(canvas){this.canvas=canvas;}drawImage(){drawCalls++;return 'drawn';}}
  class Observer{constructor(fn){this.callback=fn;observer=this;}observe(){}disconnect(){this.disconnected=true;}}
  const document={body,createElement:tag=>new Node(tag),visibilityState:'visible',hidden:false,getElementById:id=>({'shortcut-toggle':shortcut,'stop':monitorStop,'candle-state':{dataset:{state:'TRACKING'}}}[id]),querySelector:()=>({textContent:'test'})};
  const panel={document,CanvasRenderingContext2D:Context,VideoFrame:Frame,MutationObserver:Observer,performance:{now:()=>at,timeOrigin:1700000000000},navigator:{userAgent:'Test Chrome/151.0.0.0'},innerWidth:800,innerHeight:600,scrollX:0,scrollY:0,scrollTo(){},
    requestAnimationFrame:fn=>{const id=++nextRaf;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){},
    URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:local-'+blobs.length;},revokeObjectURL(){}},Blob,
  };
  const context=new Context(preview),original=Context.prototype.drawImage;
  const all=()=>{const nodes=[];function walk(node){nodes.push(node);for(const child of node.children)walk(child);}walk(container);return nodes;};
  const button=text=>all().find(node=>node.tag==='button'&&node.textContent===text);
  const status=()=>all().find(node=>node.attributes.role==='status').textContent;
  return {panel,container,preview,detail,Frame,context,original,shortcut,monitorStop,blobs,downloads,button,status,
    install:()=>installCaptureProbeControls({panel,container,preview,detail}),draw:metadata=>context.drawImage(new Frame(metadata)),drawCalls:()=>drawCalls,
    mutate:time=>{at=time;observer.callback();},raf(time){at=time;const next=rafs.entries().next().value;assert.ok(next);rafs.delete(next[0]);next[1](time);}};
}

test('capture diagnostic installation stays off, is idempotent and never changes shortcut or monitor state',()=>{
  const f=fixture(),controls=f.install();
  assert.equal(f.install(),controls);assert.equal(f.container.children.length,1);assert.equal(controls.snapshot().active,false);
  assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);
  assert.equal(f.button('עצירת המדידה').disabled,true);assert.equal(f.button('הורדת דוח צילום JSON').disabled,true);
  f.shortcut.setAttribute('aria-pressed','true');f.button('בדיקת חותמת צילום').click();assert.match(f.status(),/לכבות את קיצורי/);assert.equal(controls.snapshot().active,false);assert.equal(f.shortcut.getAttribute('aria-pressed'),'true');
  f.shortcut.setAttribute('aria-pressed','false');f.monitorStop.disabled=true;f.button('מדידה במשך 30 שניות').click();assert.match(f.status(),/להפעיל מעקב/);assert.equal(f.monitorStop.disabled,true);assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);
  controls.dispose();assert.equal(f.container.children.length,0);
});

test('feature controls observe three real delivered frames, restore the tap and export the full local report',async()=>{
  const f=fixture(),controls=f.install();
  try{
    f.button('בדיקת חותמת צילום').click();assert.equal(controls.snapshot().active,true);assert.equal(f.button('עצירת המדידה').disabled,false);
    for(let i=0;i<3;i++)assert.equal(f.draw({captureTime:10}),'drawn');await Promise.resolve();
    const report=controls.snapshot().report;assert.equal(report.reason,'FEATURE_PROBE_COMPLETE');assert.equal(report.totalDraws,3);assert.equal(report.validCaptureFrames,3);assert.equal(report.restoration,'RESTORED');assert.equal(f.drawCalls(),3);
    assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);assert.equal(controls.snapshot().active,false);assert.equal(f.button('הורדת דוח צילום JSON').disabled,false);
    f.button('הורדת דוח צילום JSON').click();assert.equal(f.downloads.length,1);assert.match(f.downloads[0].name,/^arrow-capture-latency-.*\.json$/);
    const exported=JSON.parse(await f.blobs[0].text());assert.deepEqual(exported,report);assert.match(f.status(),/הורד מקומית/);
    exported.totalDraws=100;assert.equal(controls.snapshot().report.totalDraws,3);
  }finally{controls.dispose();}
});

test('missing capture metadata remains unavailable and never borrows the media timestamp',async()=>{
  const f=fixture(),controls=f.install();
  try{
    f.button('מדידה במשך 30 שניות').click();for(let i=0;i<3;i++)f.draw({});await Promise.resolve();
    const report=controls.snapshot().report;assert.equal(report.reason,'CAPTURE_TIME_UNAVAILABLE');assert.equal(report.latencyAvailable,false);assert.equal(report.paintSamples,0);assert.equal(report.latencyMs.lowerPaintOpportunity.p50Ms,null);
    assert.match(f.status(),/אינה זמינה/);assert.match(f.status(),/לא הוסקה/);assert.equal(f.shortcut.getAttribute('aria-pressed'),'false');
  }finally{controls.dispose();}
});

test('latency mode reports the actual capture-to-paint opportunity bracket and stop restores safely',()=>{
  const f=fixture(),controls=f.install();
  try{
    f.button('מדידה במשך 30 שניות').click();f.draw({captureTime:10});f.mutate(25);f.raf(32);f.raf(48);f.button('עצירת המדידה').click();
    const report=controls.snapshot().report;assert.equal(report.reason,'STOPPED');assert.equal(report.paintSamples,1);assert.equal(report.samples[0].lowerMs,22);assert.equal(report.samples[0].upperMs,38);assert.match(f.status(),/הזדמנויות ציור/);
    assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);assert.equal(f.button('עצירת המדידה').disabled,true);
  }finally{controls.dispose();}
});

test('disposing active controls restores instrumentation and removes listeners and UI',()=>{
  const f=fixture(),controls=f.install();f.button('בדיקת חותמת צילום').click();assert.notEqual(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);
  controls.dispose();assert.equal(f.panel.CanvasRenderingContext2D.prototype.drawImage,f.original);assert.equal(f.container.children.length,0);assert.equal(controls.snapshot().active,false);assert.doesNotThrow(()=>controls.dispose());
});
