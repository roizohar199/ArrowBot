import test from 'node:test';
import assert from 'node:assert/strict';
import {installSourceMarkerControls} from '../source-marker-controls.mjs';
import {sourceMarkerCommand,sourceMarkerBits} from '../source-marker-probe.mjs';

async function flush(){for(let i=0;i<18;i++)await Promise.resolve();}
function fixture(){
  let at=100,serial=0,timerSerial=0,target={id:7,url:'https://www.tradingview.com/chart/example/'},context='capture:1',monitoring=true;
  const commands=[],timers=new Map(),rafs=new Map(),blobs=[];
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.events=new Map();this.attributes={};this.disabled=false;this.textContent='';}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
    setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key]??null;}
    addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}
    click(){if(!this.disabled)this.events.get('click')?.();}
  }
  const body=new Element('body'),container=new Element('div'),detail=new Element('p'),shortcut=new Element('button'),stop=new Element('button'),selector=new Element('select');shortcut.setAttribute('aria-pressed','false');
  const doc={body,hidden:false,visibilityState:'visible',createElement:tag=>new Element(tag),getElementById:id=>({'shortcut-toggle':shortcut,'stop':stop,'shortcut-target':selector}[id])};
  const panel={document:doc,performance:{timeOrigin:1700000000000,now:()=>at},innerWidth:800,innerHeight:600,scrollX:0,scrollY:5,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},
    requestAnimationFrame:fn=>{const id=++serial;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:(fn,ms)=>{const id=++timerSerial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:local';},revokeObjectURL(){}},Blob};
  detail.getBoundingClientRect=()=>({left:10,top:10,right:300,bottom:100,width:290,height:90});detail.closest=()=>({scrollIntoView:()=>{panel.scrollY=300;}});
  const api=installSourceMarkerControls({panel,container,detail,getTarget:()=>target,getContext:()=>context,isMonitoring:()=>monitoring,executeSource:async(tabId,fn,command)=>{
    assert.equal(fn,sourceMarkerCommand);commands.push({tabId,...command});if(command.operation==='remove')return {absent:true};
    const sourceAt=at+2;at+=4;return {markerId:command.markerId,session:command.session,sequence:command.sequence,mutationEpoch:1700000000000+sourceAt+800,sourceTimeOrigin:1700000000800,sourceUrl:'https://www.tradingview.com/chart/example/',rect:{left:8,top:8,width:224,height:12},viewport:{width:640,height:480}};
  }});
  const nodes=()=>{const found=[];function walk(node){found.push(node);for(const child of node.children)walk(child);}walk(container);return found;};
  return {api,commands,container,panel,shortcut,stop,selector,blobs,rafs,setTarget:value=>{target=value;},setContext:value=>{context=value;},setMonitoring:value=>{monitoring=value;},setTime:value=>{at=value;},
    button:text=>nodes().find(node=>node.tag==='button'&&node.textContent===text),status:()=>nodes().find(node=>node.attributes.role==='status').textContent,
    frame(value){at=value;const next=rafs.entries().next().value;assert.ok(next);rafs.delete(next[0]);next[1](value);}};
}
function imageFor(command){
  const width=640,height=480,data=new Uint8ClampedArray(width*height*4),bits=sourceMarkerBits(command.session,command.sequence);data.fill(127);for(let i=3;i<data.length;i+=4)data[i]=255;
  for(let y=8;y<20;y++)for(let x=8;x<232;x++){const bit=Math.floor((x-20)/5),color=bit<0||bit>=40?255:bits[bit]?255:0,offset=(y*width+x)*4;data[offset]=color;data[offset+1]=color;data[offset+2]=color;}
  return {width,height,data};
}

test('marker UI is inert by default and refuses source mutations without monitoring and disabled shortcuts',async()=>{
  const f=fixture();assert.equal(f.api.snapshot().active,false);assert.equal(f.commands.length,0);
  f.shortcut.setAttribute('aria-pressed','true');f.button('מדידת סמן מקור · 30 שניות').click();assert.match(f.status(),/לכבות קיצורי/);assert.equal(f.commands.length,0);assert.equal(f.shortcut.getAttribute('aria-pressed'),'true');
  f.shortcut.setAttribute('aria-pressed','false');f.setMonitoring(false);f.button('מדידת סמן מקור · 30 שניות').click();assert.match(f.status(),/להפעיל שיתוף/);assert.equal(f.commands.length,0);
  await f.api.dispose();assert.equal(f.container.children.length,0);
});

test('marker UI measures actual rendered frames, exports the full local report and removes the marker on the fixed source tab',async()=>{
  const f=fixture();f.button('מדידת סמן מקור · 30 שניות').click();await flush();
  try{
    const source=f.commands.find(command=>command.operation==='put');assert.equal(source.tabId,7);assert.equal(f.api.snapshot().active,true);
    f.setTime(120);assert.equal(f.api.onFrame(imageFor(source),{frameId:12,receivedAt:118,resultRendered:true,tracking:true}),true);f.frame(128);f.frame(144);
    await f.api.stop();assert.equal(f.api.snapshot().active,false);assert.equal(f.api.snapshot().report.sampleCount,1);assert.equal(f.api.snapshot().report.cleanup,'REMOVED');assert.equal(f.panel.scrollY,5);
    f.button('הורדת דוח סמן JSON').click();const exported=JSON.parse(await f.blobs[0].text());assert.equal(exported.samples.length,1);assert.equal(exported.selectedSource.id,7);assert.equal(exported.directCaptureInstantMeasured,false);
    assert.ok(f.commands.filter(command=>command.operation==='remove').every(command=>command.tabId===7));
  }finally{await f.api.dispose();}
});

test('source selection or capture context changes stop the probe and cleanup always targets the original tab',async()=>{
  for(const change of ['source','context']){
    const f=fixture();f.button('מדידת סמן מקור · 30 שניות').click();await flush();
    if(change==='source')f.setTarget({id:9,url:'https://www.tradingview.com/chart/other/'});else f.setContext('capture:2');
    assert.equal(f.api.onFrame({},{}),false);await flush();
    const report=f.api.snapshot().report;assert.equal(report.reason,'SOURCE_CONTEXT_CHANGED');assert.equal(report.selectedSource.id,7);assert.equal(report.observationContext,'capture:1');
    assert.ok(f.commands.filter(command=>command.operation==='remove').every(command=>command.tabId===7));await f.api.dispose();
  }
});
