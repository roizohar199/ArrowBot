// Bounded receiving-page evidence. These clocks describe local scheduling,
// visibility and main-thread work, never exchange or provider latency.
export function createLiveRuntimeDiagnostics({document,window,now=()=>performance.now(),wallNow=Date.now,Observer=globalThis.PerformanceObserver,maxEntries=400}={}){
  if(!Number.isSafeInteger(maxEntries)||maxEntries<10||maxEntries>5000)throw TypeError('INVALID_DIAGNOSTIC_LIMIT');
  let events=[],longTasks=[],observer=null;
  const listeners=[];
  const bounded=(list,item)=>{list.push(item);if(list.length>maxEntries)list.shift();};
  const state=()=>({visibility:document?.visibilityState??'unknown',hidden:document?.hidden===true,focused:typeof document?.hasFocus==='function'?document.hasFocus():null});
  const mark=(name,detail={})=>bounded(events,{name,at:now(),atWall:wallNow(),...state(),...detail});
  const listen=(target,name)=>{const listener=()=>mark(name);target?.addEventListener?.(name,listener);listeners.push([target,name,listener]);};
  listen(document,'visibilitychange');listen(window,'focus');listen(window,'blur');
  try{if(typeof Observer==='function'){observer=new Observer(list=>{for(const item of list.getEntries())bounded(longTasks,{startAt:item.startTime,durationMs:item.duration,endAt:item.startTime+item.duration,name:item.name});});observer.observe({type:'longtask',buffered:true});}}catch{observer=null;}
  mark('INITIAL');
  return {state,mark,reset(){events=[];longTasks=[];mark('SESSION_START');},snapshot(){return {scope:'Receiving page only; bounded visibility/focus events and browser long-task entries. No source/exchange clock substitution.',longTaskObserverAvailable:!!observer,maxEntries,state:state(),events:structuredClone(events),longTasks:structuredClone(longTasks)};},dispose(){observer?.disconnect();for(const [target,name,listener]of listeners)target?.removeEventListener?.(name,listener);}};
}
