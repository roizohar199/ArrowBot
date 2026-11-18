import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveRuntimeDiagnostics} from '../live-runtime-diagnostics.mjs';

class Surface{
  constructor(){this.listeners=new Map();}
  addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(listener);}
  removeEventListener(name,listener){this.listeners.get(name)?.delete(listener);}
  dispatch(name){for(const listener of this.listeners.get(name)??[])listener();}
  listenerCount(){return [...this.listeners.values()].reduce((count,list)=>count+list.size,0);}
}
function fixture(){
  const document=new Surface(),window=new Surface();let focused=true,clock=10,wall=10000,observer;
  Object.assign(document,{visibilityState:'visible',hidden:false,hasFocus:()=>focused});
  class Observer{
    constructor(callback){this.callback=callback;this.connected=false;observer=this;}
    observe(options){this.options=options;this.connected=true;}
    emit(entries){if(this.connected)this.callback({getEntries:()=>entries});}
    disconnect(){this.connected=false;}
  }
  const diagnostics=createLiveRuntimeDiagnostics({document,window,Observer,now:()=>clock++,wallNow:()=>wall++,maxEntries:10});
  return {document,window,diagnostics,observer,setFocused:value=>{focused=value;}};
}

test('event and long-task retention stays bounded, snapshots are isolated, and session reset starts cleanly',()=>{
  const f=fixture();assert.deepEqual(f.observer.options,{type:'longtask',buffered:true});
  for(let index=0;index<25;index++)f.diagnostics.mark('event-'+index,{detail:{index}});
  f.observer.emit(Array.from({length:25},(_,index)=>({startTime:index*100,duration:50+index,name:'task-'+index})));
  const snapshot=f.diagnostics.snapshot();assert.equal(snapshot.maxEntries,10);assert.equal(snapshot.events.length,10);assert.equal(snapshot.longTasks.length,10);
  assert.deepEqual(snapshot.events.map(event=>event.name),Array.from({length:10},(_,index)=>'event-'+(index+15)));assert.equal(snapshot.longTasks[0].name,'task-15');assert.equal(snapshot.longTasks.at(-1).endAt,2474);
  snapshot.events[0].detail.index=999;snapshot.longTasks[0].durationMs=999;assert.equal(f.diagnostics.snapshot().events[0].detail.index,15);assert.equal(f.diagnostics.snapshot().longTasks[0].durationMs,65);
  f.diagnostics.reset();const reset=f.diagnostics.snapshot();assert.deepEqual(reset.events.map(event=>event.name),['SESSION_START']);assert.deepEqual(reset.longTasks,[]);assert.equal(reset.longTaskObserverAvailable,true);
  f.observer.emit([{startTime:5000,duration:60,name:'new-session-task'}]);assert.equal(f.diagnostics.snapshot().longTasks.length,1);f.diagnostics.dispose();
});

test('visibility and focus events capture their current state and cleanup removes every owned listener and observer',()=>{
  const f=fixture();assert.equal(f.document.listenerCount(),1);assert.equal(f.window.listenerCount(),2);assert.deepEqual(f.diagnostics.state(),{visibility:'visible',hidden:false,focused:true});
  f.setFocused(false);f.window.dispatch('blur');f.document.visibilityState='hidden';f.document.hidden=true;f.document.dispatch('visibilitychange');f.document.visibilityState='visible';f.document.hidden=false;f.setFocused(true);f.window.dispatch('focus');
  const events=f.diagnostics.snapshot().events;assert.deepEqual(events.map(event=>event.name),['INITIAL','blur','visibilitychange','focus']);assert.equal(events[1].focused,false);assert.equal(events[2].visibility,'hidden');assert.equal(events[2].hidden,true);assert.equal(events[2].focused,false);assert.equal(events[3].focused,true);assert.ok(events.every((event,index)=>index===0||event.at>events[index-1].at&&event.atWall>events[index-1].atWall));
  f.diagnostics.dispose();assert.equal(f.document.listenerCount(),0);assert.equal(f.window.listenerCount(),0);assert.equal(f.observer.connected,false);
  const before=f.diagnostics.snapshot();f.window.dispatch('blur');f.document.dispatch('visibilitychange');f.observer.emit([{startTime:1,duration:100,name:'after-disposal'}]);assert.deepEqual(f.diagnostics.snapshot(),before);assert.doesNotThrow(()=>f.diagnostics.dispose());
});

test('unavailable or unsupported long-task observers degrade softly while local diagnostics and cleanup still work',()=>{
  const implementations=[null,class{constructor(){throw Error('unsupported');}},class{observe(){throw Error('longtask entry type unsupported');}}];
  for(const Observer of implementations){
    const document=new Surface(),window=new Surface();Object.assign(document,{visibilityState:'visible',hidden:false});
    const diagnostics=createLiveRuntimeDiagnostics({document,window,Observer,now:()=>1,wallNow:()=>2,maxEntries:10});
    assert.equal(diagnostics.snapshot().longTaskObserverAvailable,false);diagnostics.mark('MANUAL');window.dispatch('focus');assert.deepEqual(diagnostics.snapshot().events.map(event=>event.name),['INITIAL','MANUAL','focus']);assert.equal(diagnostics.state().focused,null);assert.deepEqual(diagnostics.snapshot().longTasks,[]);
    assert.doesNotThrow(()=>diagnostics.dispose());assert.equal(document.listenerCount()+window.listenerCount(),0);
  }
  const missing=createLiveRuntimeDiagnostics({Observer:null,now:()=>1,wallNow:()=>2,maxEntries:10});assert.deepEqual(missing.state(),{visibility:'unknown',hidden:false,focused:null});assert.doesNotThrow(()=>missing.dispose());
});
