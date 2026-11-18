import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sourceDomTimingCommand,createSourceDomLatency} from '../live-source-timing.mjs';

// Execute the exact serialized function Chrome receives. This fake surface has
// only public DOM, visibility, timer and mutation APIs; no module closure leaks.
function surface(){
  let clock=0,observer=null,timerSerial=0;
  const timers=new Map(),listeners=new Map(),stats={walked:0,rects:0,styles:0};
  class Element{
    constructor({rect={},style={},tag='DIV',excluded=false}={}){
      this.nodeType=1;this.tagName=tag;this.parentElement=null;this.children=[];this.excluded=excluded;this.style=style;
      this.rect={left:30,top:30,width:300,height:20,...rect};
      this.clientLeft=0;this.clientTop=0;this.clientWidth=this.rect.width;this.clientHeight=this.rect.height;this.scrollHeight=this.rect.height;
    }
    get isConnected(){return this===body||!!this.parentElement?.isConnected;}
    append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
    get textContent(){return this.children.map(node=>node.nodeType===3?node.nodeValue:node.textContent).join('');}
    getBoundingClientRect(){stats.rects++;return {...this.rect,right:this.rect.left+this.rect.width,bottom:this.rect.top+this.rect.height};}
    closest(){for(let node=this;node;node=node.parentElement)if(node.excluded||['SCRIPT','STYLE','INPUT','TEXTAREA'].includes(node.tagName))return node;return null;}
    contains(other){for(let node=other;node;node=node.parentElement)if(node===this)return true;return false;}
  }
  const text=value=>({nodeType:3,nodeValue:value,parentElement:null});
  const body=new Element({rect:{left:0,top:0,width:1000,height:800},tag:'BODY'});
  const document={body,documentElement:body,visibilityState:'visible',createTreeWalker(root){
    const nodes=[];
    function collect(node){if(node.nodeType===3)nodes.push(node);for(const child of node.children??[])collect(child);}
    for(const child of root.children??[])collect(child);
    let cursor=0;
    return {nextNode(){const node=nodes[cursor++]??null;if(node)stats.walked++;return node;}};
  }};
  const sandbox=vm.createContext({document,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/abc/'},innerWidth:1000,innerHeight:800,NodeFilter:{SHOW_TEXT:4},
    performance:{timeOrigin:1000000,now:()=>clock},
    getComputedStyle(node){stats.styles++;return {display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',contentVisibility:'visible',...node.style};},
    MutationObserver:class{constructor(callback){this.callback=callback;this.disconnected=false;observer=this;}observe(){this.disconnected=false;}disconnect(){this.disconnected=true;}},
    setInterval(callback,interval){const id=++timerSerial;timers.set(id,{callback,interval});return id;},clearInterval:id=>timers.delete(id),
    addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener:(type,callback)=>{if(listeners.get(type)===callback)listeners.delete(type);},
  });
  const command=args=>JSON.parse(JSON.stringify(vm.runInContext(`(${sourceDomTimingCommand.toString()})(${JSON.stringify(args)})`,sandbox)));
  const log=(sequence,options={})=>{const parent=new Element(options),node=text('ARROW_OHLC_V1 '+JSON.stringify({runId:'run',sequence}));parent.append(node);return {parent,node};};
  const recordWindow=(id,options)=>vm.runInContext(`globalThis.__arrowSourceDomTimingV1?.recordWindowPacket?.(${JSON.stringify(id)},${JSON.stringify(options)})`,sandbox);
  return {body,document,sandbox,stats,timers,listeners,Element,text,log,command,recordWindow,
    advance(ms){clock+=ms;},emit(changes){if(observer&&!observer.disconnected)observer.callback(changes);},
    fireTimers(){for(const {callback} of [...timers.values()])callback();},get disconnected(){return observer?.disconnected??false;}};
}

test('serialized observer excludes visible rows present at install and records new rows at their observed DOM epoch',()=>{
  const s=surface(),old=s.log(1);s.body.append(old.parent);
  const initial=s.command({action:'install',sessionId:'one'});
  assert.equal(initial.records.length,1);assert.equal(initial.records[0].initial,true);assert.equal(initial.records[0].appearanceEpochMs,null);
  s.advance(42);const fresh=s.log(2);s.body.append(fresh.parent);s.emit([{type:'childList',addedNodes:[fresh.parent]}]);
  const read=s.command({action:'read'}),record=read.records.find(record=>record.id==='run:2');
  assert.equal(record.appearanceEpochMs,1000042);assert.equal(record.initial,false);assert.equal(record.documentVisible,true);
  s.advance(25);s.emit([{type:'characterData',target:fresh.node}]);
  assert.equal(s.command({action:'read'}).records.find(record=>record.id==='run:2').appearanceEpochMs,1000042,'duplicates preserve first observation');
});

test('hidden document, editor content and off-viewport rows never receive a visible origin',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});
  const outside=s.log(1,{rect:{top:900}}),editor=s.log(2,{excluded:true});s.body.append(outside.parent,editor.parent);
  s.emit([{type:'childList',addedNodes:[outside.parent,editor.parent]}]);
  s.document.visibilityState='hidden';const hidden=s.log(3);s.body.append(hidden.parent);s.emit([{type:'childList',addedNodes:[hidden.parent]}]);
  assert.deepEqual(s.command({action:'read'}).records,[]);
  s.document.visibilityState='visible';
  assert.deepEqual(s.command({action:'read'}).records,[],'reading later must not invent a catch-up timestamp');
});

test('ancestor opacity and scroll clipping prevent false visible-origin measurements',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});
  const transparent=new s.Element({style:{opacity:'0'}}),hidden=s.log(1);transparent.append(hidden.parent);s.body.append(transparent);
  const pane=new s.Element({rect:{top:100,height:100},style:{overflowY:'auto'}}),clipped=s.log(2,{rect:{top:230,height:20}}),visible=s.log(3,{rect:{top:140,height:20}});
  pane.append(clipped.parent,visible.parent);s.body.append(pane);
  s.emit([{type:'childList',addedNodes:[transparent,pane]}]);
  assert.deepEqual(s.command({action:'read'}).records.map(record=>record.id),['run:3']);
});

test('ancestor visibility checks fail conservatively at their explicit bounded depth',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});let parent=s.body;
  for(let i=0;i<70;i++){const nested=new s.Element();parent.append(nested);parent=nested;}
  const row=s.log(1);parent.append(row.parent);s.emit([{type:'childList',addedNodes:[row.parent]}]);
  const result=s.command({action:'read'});
  assert.deepEqual(result.records,[]);assert.ok(result.limitReasons.VISIBILITY_ANCESTOR_LIMIT>0);assert.ok(s.stats.styles<=64);
});

test('actual TradingView log depth of 23 ancestors remains observable',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});let parent=s.body;
  for(let i=0;i<23;i++){const nested=new s.Element();parent.append(nested);parent=nested;}
  const fresh=s.log(7);parent.append(fresh.parent);s.advance(10);s.emit([{type:'childList',addedNodes:[fresh.parent]}]);
  const report=s.command({action:'read'});assert.equal(report.records[0].id,'run:7');assert.equal(report.records[0].initial,false);assert.equal(report.limited,0);
});

test('a single mutation with many added roots has a global added-node budget and explicit exclusions',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});
  const rows=Array.from({length:1500},(_,i)=>s.log(i+1).parent);s.body.append(...rows);
  s.emit([{type:'childList',addedNodes:rows}]);
  const result=s.command({action:'read'});
  assert.ok(s.stats.walked<=1000,'one callback never scans all 1500 candidate roots');
  assert.equal(result.limitReasons.ADDED_NODE_LIMIT,1);
  assert.equal(result.records.at(-1).id,'run:1000');
  s.advance(100);assert.equal(s.command({action:'read'}).records.at(-1).id,'run:1000','skipped work is not later backdated');
});

test('text traversal is bounded globally across many mutation subtrees, not once per subtree',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});const roots=[];
  for(let rootIndex=0;rootIndex<4;rootIndex++){
    const subtree=new s.Element();for(let i=0;i<2000;i++)subtree.append(s.text('ordinary unrelated page text'));roots.push(subtree);
  }
  s.body.append(...roots);s.emit([{type:'childList',addedNodes:roots}]);
  const result=s.command({action:'read'});
  assert.ok(s.stats.walked<=5001);assert.equal(result.limitReasons.TEXT_NODE_LIMIT,1);assert.deepEqual(result.records,[]);
});

test('observer session replacement, matching stop, pagehide and TTL all disconnect correctly',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});
  assert.equal(s.timers.size,1);s.command({action:'install',sessionId:'two'});assert.equal(s.timers.size,1);
  s.command({action:'stop',sessionId:'one'});assert.equal(s.command({action:'read'}).sessionId,'two','old connection cannot stop a replacement');
  s.advance(59000);s.command({action:'read'});s.advance(59000);s.fireTimers();assert.equal(s.disconnected,false,'reads refresh TTL');
  s.advance(1001);s.fireTimers();assert.equal(s.disconnected,true);assert.equal(s.command({action:'read'}).status,'UNAVAILABLE');assert.equal(s.timers.size,0);
  s.command({action:'install',sessionId:'three'});s.listeners.get('pagehide')();assert.equal(s.disconnected,true);assert.equal(s.timers.size,0);assert.equal(s.command({action:'read'}).status,'STOPPED');
  s.command({action:'install',sessionId:'four'});s.command({action:'stop',sessionId:'four'});assert.equal(s.disconnected,true);assert.equal(s.command({action:'read'}).status,'UNAVAILABLE');
});

test('observer output correlates only new visible origins and preserves unavailable market/capture timing',()=>{
  const s=surface(),old=s.log(1);s.body.append(old.parent);s.command({action:'install',sessionId:'session'});
  s.advance(25);const fresh=s.log(2);s.body.append(fresh.parent);s.emit([{type:'childList',addedNodes:[fresh.parent]}]);s.advance(75);
  const evidence=s.command({action:'read'}),timing=createSourceDomLatency();timing.reset('session');
  assert.equal(timing.observe(evidence,{beforeEpoch:2000100,afterEpoch:2000110,receiverTimeOrigin:2000000}),true);
  assert.equal(timing.associate('old','run:1'),false);assert.equal(timing.associate('new','run:2'),true);
  const sample=timing.complete({eventId:'new',mutationAt:120,firstPaintOpportunityAt:130,secondPaintOpportunityAt:150});
  assert.equal(sample.sourceToPaintLowerMs,95);assert.equal(sample.sourceToPaintUpperMs,125);
  const report=timing.snapshot();assert.equal(report.marketToDisplayMeasured,false);assert.equal(report.captureToDisplayMeasured,false);assert.equal(report.physicalDisplayMeasured,false);assert.equal(report.excluded.ALREADY_PRESENT_AT_OBSERVER_START,1);
});

test('correlation never produces latency from causally impossible mutation and paint ordering',()=>{
  const timing=createSourceDomLatency();timing.reset('session');
  timing.observe({status:'OK',sessionId:'session',sourceEpoch:100,records:[{id:'run:1',appearanceEpochMs:25,initial:false,documentVisible:true}]},{beforeEpoch:1100,afterEpoch:1110,receiverTimeOrigin:1000});
  timing.associate('mutation-before-origin','run:1');
  assert.equal(timing.complete({eventId:'mutation-before-origin',mutationAt:20,firstPaintOpportunityAt:50,secondPaintOpportunityAt:60}),false);
  timing.associate('paint-before-mutation','run:1');
  assert.equal(timing.complete({eventId:'paint-before-mutation',mutationAt:50,firstPaintOpportunityAt:40,secondPaintOpportunityAt:60}),false);
  assert.equal(timing.snapshot().samples.length,0);assert.equal(timing.snapshot().excluded.INVALID_CORRELATED_RENDER,2);
});

test('serialized observer exposes locally clocked first-coherent Data Window observations and never upgrades initial warmup',()=>{
  const s=surface();assert.equal(s.recordWindow('run:1',{sourceSequence:1}),undefined);
  s.command({action:'install',sessionId:'session'});
  assert.equal(s.recordWindow('run:1',{initial:true,transport:'PUBLIC_DATA_WINDOW_V2',sourceSequence:0}),true);
  s.advance(50);assert.equal(s.recordWindow('run:2',{sourceSequence:1}),true);
  s.advance(75);assert.equal(s.recordWindow('run:2',{sourceSequence:1}),false);assert.equal(s.recordWindow('run:1',{sourceSequence:0}),false);
  const report=s.command({action:'read'}),initial=report.records.find(record=>record.id==='run:1'),fresh=report.records.find(record=>record.id==='run:2');
  assert.equal(initial.initial,true);assert.equal(initial.appearanceEpochMs,null);
  assert.equal(fresh.appearanceEpochMs,1000050);assert.equal(fresh.transport,'PUBLIC_DATA_WINDOW_V2');assert.equal(fresh.sourceSequence,1);assert.equal(fresh.meaning,'FIRST_EXTENSION_OBSERVED_COHERENT_VISIBLE_DATA_WINDOW_FRAME');
  assert.equal(report.windowCallbacks,4);assert.match(report.scope,/scoped DOM MutationObserver callback/);assert.match(report.scope,/polling wait is included/);
  const timing=createSourceDomLatency();timing.reset('session');timing.observe(report,{beforeEpoch:2000125,afterEpoch:2000135,receiverTimeOrigin:2000000});
  assert.equal(timing.associate('warmup','run:1'),false);assert.equal(timing.associate('fresh','run:2'),true);
  const sample=timing.complete({eventId:'fresh',mutationAt:150,firstPaintOpportunityAt:160,secondPaintOpportunityAt:180});
  assert.equal(sample.sourceObservationMeaning,fresh.meaning);assert.equal(sample.sourceTransport,'PUBLIC_DATA_WINDOW_V2');assert.equal(sample.sourceSequence,1);assert.equal(timing.snapshot().marketToDisplayMeasured,false);
});

test('Data Window callbacks reject hidden, malformed or externally timestamped observations',()=>{
  const s=surface();s.command({action:'install',sessionId:'session'});
  for(const [id,options] of [
    ['', {sourceSequence:1}],['a'.repeat(1025),{sourceSequence:1}],['run:\n1',{sourceSequence:1}],
    ['run:1',{sourceSequence:1.5}],['run:1',{sourceSequence:-1}],['run:1',{sourceSequence:9007199254740992}],
    ['run:1',{sourceSequence:1,transport:'exchange'}],['run:1',{sourceSequence:1,initial:'false'}],
    ['run:1',{sourceSequence:1,appearanceEpochMs:123}],['run:1',{sourceSequence:1,sourceEmittedAt:123}],
  ])assert.equal(s.recordWindow(id,options),false);
  s.document.visibilityState='hidden';assert.equal(s.recordWindow('hidden',{sourceSequence:1}),false);
  s.document.visibilityState='visible';s.document.hidden=true;assert.equal(s.recordWindow('hidden-property',{sourceSequence:2}),false);
  assert.deepEqual(s.command({action:'read'}).records,[]);
  s.document.hidden=false;s.advance(10);assert.equal(s.recordWindow('later-visible',{sourceSequence:3}),true);
  assert.equal(s.command({action:'read'}).records[0].appearanceEpochMs,1000010);
});

test('stopped or replaced session callbacks cannot write into the active observer, including same-name replacement',()=>{
  const s=surface();s.command({action:'install',sessionId:'one'});
  const first=vm.runInContext('globalThis.__arrowSourceDomTimingV1.recordWindowPacket',s.sandbox);
  s.command({action:'stop',sessionId:'other'});assert.equal(first('one:1',{sourceSequence:1}),true);
  s.command({action:'install',sessionId:'one'});assert.equal(first('one:2',{sourceSequence:2}),false,'reinstalling same session still invalidates old callback');
  const second=vm.runInContext('globalThis.__arrowSourceDomTimingV1.recordWindowPacket',s.sandbox);
  assert.equal(second('one:3',{sourceSequence:3}),true);s.command({action:'stop',sessionId:'one'});assert.equal(second('one:4',{sourceSequence:4}),false);assert.equal(s.command({action:'read'}).status,'UNAVAILABLE');
});

test('Data Window records share the same bounded retention as logs while old log mutations remain observable',()=>{
  const s=surface();s.command({action:'install',sessionId:'session'});
  for(let index=1;index<=1300;index++)assert.equal(s.recordWindow('window:'+index,{sourceSequence:index}),true);
  const report=s.command({action:'read'});assert.equal(report.records.length,160);assert.equal(report.records[0].id,'window:1141');assert.equal(report.records.at(-1).id,'window:1300');
  const row=s.log(1400);s.body.append(row.parent);s.advance(10);s.emit([{type:'childList',addedNodes:[row.parent]}]);
  const last=s.command({action:'read'}).records.at(-1);assert.equal(last.id,'run:1400');assert.equal(last.meaning,'FIRST_OBSERVED_VISIBLE_LOG_DOM_APPEARANCE');assert.equal(last.appearanceEpochMs,1000010);
});
