import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sourceMarkerBits,sourceMarkerCommand,decodeSourceMarker,createSourceMarkerProbe} from '../source-marker-probe.mjs';

const geometry={rect:{left:8,top:8,width:224,height:12},viewport:{width:640,height:480}};
function imageFromBits(session,sequence,{scale=1,corrupt=false}={}){
  const width=640*scale,height=480*scale,data=new Uint8ClampedArray(width*height*4);data.fill(127);for(let i=3;i<data.length;i+=4)data[i]=255;
  const bits=sourceMarkerBits(session,sequence);if(corrupt)bits[39]^=1;
  for(let y=8*scale;y<20*scale;y++)for(let x=8*scale;x<232*scale;x++){
    const cell=Math.floor(((x/scale)-20)/5),value=cell<0||cell>=40?235:bits[cell]?235:20,index=(y*width+x)*4;data[index]=value;data[index+1]=value;data[index+2]=value;
  }
  return {width,height,data};
}
function sourceDocument(){
  const nodes=new Map(),draws=[];
  const doc={getElementById:id=>nodes.get(id)??null,documentElement:{append:node=>nodes.set(node.id,node)},createElement:tag=>{
    assert.equal(tag,'canvas');const attributes={},node={id:null,width:0,height:0,style:{},setAttribute:(key,value)=>{attributes[key]=value;},getAttribute:key=>attributes[key]??null,getBoundingClientRect:()=>geometry.rect,remove:()=>nodes.delete(node.id)};
    const context={fillStyle:'#fff',fillRect(x,y,w,h){draws.push({color:this.fillStyle,x,y,w,h});}};node.getContext=kind=>{assert.equal(kind,'2d');return context;};return node;
  }};
  const expiry=[];
  const sandbox={document:doc,location:{protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/example/',origin:'https://www.tradingview.com'},performance:{timeOrigin:1700000000000,now:()=>50},innerWidth:640,innerHeight:480,devicePixelRatio:1,setTimeout:(fn,ms)=>{expiry.push({fn,ms});return expiry.length;}};
  for(const name of ['TradingView','tvWidget','WebSocket','fetch'])Object.defineProperty(sandbox,name,{get(){throw Error('Hidden chart/network API accessed');}});
  const call=command=>vm.runInNewContext('('+sourceMarkerCommand.toString()+')('+JSON.stringify(command)+')',sandbox);
  return {nodes,draws,call,expiry};
}

test('serialized source command draws only an owned visible marker and removes only its own DOM node',()=>{
  const f=sourceDocument(),markerId='arrow-source-marker-test1',result=f.call({operation:'put',markerId,session:0xabcd,sequence:1});
  assert.equal(result.markerId,markerId);assert.equal(result.mutationEpoch,1700000000050);assert.equal(f.nodes.size,1);assert.match(f.nodes.get(markerId).style.cssText,/pointer-events:none/);assert.match(f.nodes.get(markerId).style.cssText,/position:fixed/);
  const image={width:640,height:480,data:new Uint8ClampedArray(640*480*4)};for(let i=3;i<image.data.length;i+=4)image.data[i]=255;
  for(const draw of f.draws)for(let y=draw.y+8;y<draw.y+draw.h+8;y++)for(let x=draw.x+8;x<draw.x+draw.w+8;x++){const offset=(y*640+x)*4,value=draw.color==='#fff'?255:0;image.data[offset]=value;image.data[offset+1]=value;image.data[offset+2]=value;}
  assert.deepEqual(decodeSourceMarker(image,result),{session:0xabcd,sequence:1});
  f.call({operation:'put',markerId,session:0xabcd,sequence:2});assert.equal(f.nodes.size,1);
  assert.equal(f.expiry.length,1);assert.equal(f.expiry[0].ms,30000);
  f.nodes.set('arrow-source-marker-unowned',{getAttribute:()=>null,remove:()=>{throw Error('must not remove');}});
  assert.throws(()=>f.call({operation:'remove',markerId:'arrow-source-marker-unowned'}),/OWNERSHIP_CONFLICT/);
  const removed=f.call({operation:'remove',markerId});assert.equal(removed.absent,true);assert.equal(f.nodes.has(markerId),false);assert.equal(f.nodes.has('arrow-source-marker-unowned'),true);
});

test('marker decoding supports capture scaling and compression-like levels, rejects checksum/session noise and wrong geometry',()=>{
  for(const scale of [1,2])assert.deepEqual(decodeSourceMarker(imageFromBits(0x7a31,150,{scale}),geometry),{session:0x7a31,sequence:150});
  assert.equal(decodeSourceMarker(imageFromBits(0x7a31,150,{corrupt:true}),geometry),null);
  const wrong=imageFromBits(1,1);wrong.width=639;assert.equal(decodeSourceMarker(wrong,geometry),null);
  assert.equal(decodeSourceMarker(imageFromBits(1,1),{...geometry,rect:{...geometry.rect,left:700}}),null);
  assert.throws(()=>sourceMarkerBits(1,256),TypeError);
});

async function flush(){for(let i=0;i<14;i++)await Promise.resolve();}
function harness(overrides={}){
  let at=100,sourceOffset=5000,rafSerial=0,timerSerial=0,visible=true,onscreen=true,off=true,monitoring=true;
  const rafs=new Map(),timers=new Map(),commands=[],completed=[];
  const sendSourceCommand=async command=>{
    commands.push(command);if(command.operation==='remove')return {markerId:command.markerId,absent:true,removed:true};
    const sourceMutationAt=at+2;at+=4;
    return {operation:'put',markerId:command.markerId,session:command.session,sequence:command.sequence,mutationEpoch:1700000000000+sourceMutationAt+sourceOffset,sourceTimeOrigin:1700000000000+sourceOffset,sourceUrl:'https://www.tradingview.com/chart/example/',...geometry};
  };
  const probe=createSourceMarkerProbe({sendSourceCommand,now:()=>at,epochNow:()=>1700000000000+at,wallNow:()=>1700000000000+at,
    requestAnimationFrame:callback=>{const id=++rafSerial;rafs.set(id,callback);return id;},cancelAnimationFrame:id=>rafs.delete(id),isVisible:()=>visible,isOnscreen:()=>onscreen,shortcutsOff:()=>off,isMonitoring:()=>monitoring,
    setTimer:(fn,ms)=>{const id=++timerSerial;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),onComplete:report=>completed.push(report),session:0xabcd,markerId:'arrow-source-marker-controller-test',...overrides});
  return {probe,commands,completed,rafs,timers,setTime:value=>{at=value;},now:()=>at,setVisible:value=>{visible=value;},setOnscreen:value=>{onscreen=value;},setOff:value=>{off=value;},setMonitoring:value=>{monitoring=value;},
    frame(time){at=time;const next=rafs.entries().next().value;assert.ok(next,'paint callback pending');rafs.delete(next[0]);next[1](time);},
    async tick(){const next=[...timers].find(([,item])=>item.ms===200);assert.ok(next,'source tick pending');timers.delete(next[0]);at+=200;next[1].fn();await flush();}};
}

test('per-command round-trip calibration bounds source DOM mutation through captured result and paint without clock synchronization',async()=>{
  const h=harness();h.probe.start();await flush();
  try{
    assert.equal(h.probe.snapshot().sourceCommands,1);h.setTime(120);
    assert.equal(h.probe.onFrame(imageFromBits(0xabcd,1),{frameId:77,receivedAt:118,resultRendered:true}),true);h.frame(128);h.frame(144);
    const report=h.probe.snapshot(),sample=report.samples[0];assert.equal(report.sampleCount,1);assert.equal(sample.source.sourceClockOffsetLowerMs,4998);assert.equal(sample.source.sourceClockOffsetUpperMs,5002);
    assert.equal(sample.sourceMutationToFrameLowerMs,14);assert.equal(sample.sourceMutationToFrameUpperMs,18);assert.equal(sample.sourceMutationToPaintLowerMs,24);assert.equal(sample.sourceMutationToPaintUpperMs,44);
    assert.equal(sample.frameReceiptToMutationMs,2);assert.equal(sample.frameReceiptToPaintUpperMs,26);
    assert.equal(report.clockSynchronizationAssumed,false);assert.equal(report.directCaptureInstantMeasured,false);assert.equal(report.marketToDisplayMeasured,false);assert.equal(report.physicalDisplayMeasured,false);
    report.samples[0].sourceMutationToPaintUpperMs=999;assert.equal(h.probe.snapshot().samples[0].sourceMutationToPaintUpperMs,44);
  }finally{const report=await h.probe.stop();assert.equal(report.cleanup,'REMOVED');assert.equal(h.rafs.size,0);assert.equal(h.timers.size,0);}
});

test('unrendered, hidden, offscreen, wrong-session and repeated marker frames never create new measured samples',async()=>{
  const h=harness();h.probe.start();await flush();
  try{
    const image=imageFromBits(0xabcd,1);h.setTime(120);
    assert.equal(h.probe.onFrame(image,{receivedAt:118,resultRendered:false}),false);
    h.setVisible(false);assert.equal(h.probe.onFrame(image,{receivedAt:118,resultRendered:true}),false);h.setVisible(true);
    h.setOnscreen(false);assert.equal(h.probe.onFrame(image,{receivedAt:118,resultRendered:true}),false);h.setOnscreen(true);
    assert.equal(h.probe.onFrame(imageFromBits(0xabce,1),{receivedAt:118,resultRendered:true}),false);
    assert.equal(h.probe.onFrame(image,{receivedAt:118,resultRendered:true}),true);assert.equal(h.probe.onFrame(image,{receivedAt:118,resultRendered:true}),false);h.frame(128);h.frame(144);
    const report=h.probe.snapshot();assert.equal(report.sampleCount,1);assert.equal(report.discarded.RESULT_NOT_RENDERED,1);assert.equal(report.discarded.HIDDEN,1);assert.equal(report.discarded.OFFSCREEN,1);assert.equal(report.discarded.DUPLICATE_OR_UNKNOWN_MARKER,1);
  }finally{await h.probe.stop();}
});

test('a newer rendered marker supersedes pending work rather than pairing old source with new result pixels',async()=>{
  const h=harness();h.probe.start();await flush();
  try{
    h.setTime(120);h.probe.onFrame(imageFromBits(0xabcd,1),{receivedAt:118,resultRendered:true});await h.tick();
    const at=h.now();h.setTime(at+16);h.probe.onFrame(imageFromBits(0xabcd,2),{receivedAt:at+14,resultRendered:true});h.frame(at+24);h.frame(at+40);
    const report=h.probe.snapshot();assert.equal(report.sampleCount,1);assert.equal(report.samples[0].sequence,2);assert.equal(report.discarded.SUPERSEDED_RENDER,1);
  }finally{await h.probe.stop();}
});

test('shortcut or monitoring gates prevent starting and abort a running diagnostic without changing either gate',async()=>{
  const stopped=harness();stopped.setOff(false);assert.throws(()=>stopped.probe.start(),/SHORTCUTS_NOT_OFF/);assert.equal(stopped.commands.length,0);
  const idle=harness();idle.setMonitoring(false);assert.throws(()=>idle.probe.start(),/MONITORING_STOPPED/);assert.equal(idle.commands.length,0);
  const h=harness();h.probe.start();await flush();h.setOff(false);assert.equal(h.probe.onFrame(imageFromBits(0xabcd,1),{resultRendered:true}),false);
  const report=await h.probe.stop();assert.equal(report.reason,'SHORTCUTS_NOT_OFF');assert.equal(report.cleanup,'REMOVED');assert.equal(h.completed.length,1);assert.ok(h.commands.filter(command=>command.operation==='remove').every(command=>command.markerId==='arrow-source-marker-controller-test'));
});

test('invalid source calibration fails closed and still requests owned marker cleanup',async()=>{
  const h=harness({sendSourceCommand:async command=>command.operation==='remove'?{absent:true}:{markerId:command.markerId,session:command.session,sequence:command.sequence,mutationEpoch:NaN}});
  h.probe.start();await flush();const report=await h.probe.stop();assert.equal(report.reason,'SOURCE_COMMAND_FAILED');assert.equal(report.sampleCount,0);assert.equal(report.cleanup,'REMOVED');assert.match(report.errors[0],/INVALID_SOURCE_CALIBRATION/);
});

test('stopping during a pending source command waits for it and cleans late insertion before completing',async()=>{
  let release;const commands=[];
  const h=harness({sendSourceCommand:command=>{commands.push(command);if(command.operation==='remove')return Promise.resolve({absent:true});return new Promise(resolve=>{release=()=>resolve({markerId:command.markerId,session:command.session,sequence:command.sequence,mutationEpoch:1700000000102,sourceTimeOrigin:1700000000000,sourceUrl:'https://www.tradingview.com/chart/example/',...geometry});});}});
  h.probe.start();await flush();const stopping=h.probe.stop();assert.equal(h.probe.snapshot().active,false);release();const report=await stopping;await flush();
  assert.equal(report.cleanup,'REMOVED');assert.equal(h.completed.length,1);assert.ok(commands.some(command=>command.operation==='remove'));assert.ok(commands.every(command=>command.markerId==='arrow-source-marker-controller-test'));assert.equal(h.rafs.size,0);
});
