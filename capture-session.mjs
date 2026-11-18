// Own capture selection separately from observation. A late picker/play result
// must never replace a newer source, and cancelled captures must be stopped.
export function createCaptureSession({request,connect=async()=>{},onPreparing=()=>{},onReady=()=>{},onEnded=()=>{},onError=()=>{},onSettled=()=>{}}={}){
 if(typeof request!=='function'||typeof connect!=='function')throw TypeError('Capture request and connect functions are required');
 let generation=0,selecting=false,disposed=false,entry=null,pending=null;
 const stopped=new WeakSet();
 const currentToken=token=>!disposed&&token===generation;
 const videoTracks=stream=>{try{return stream?.getVideoTracks?.()??[];}catch{return [];}};
 const live=stream=>{const tracks=videoTracks(stream);return tracks.length>0&&stream.active!==false&&tracks.every(track=>track?.readyState!=='ended');};
 function stopStream(stream){
  if(!stream||stream===entry?.stream)return;
  let tracks;try{tracks=stream.getTracks?.()??videoTracks(stream);}catch{tracks=[];}
  for(const track of tracks)if(track&&typeof track==='object'&&!stopped.has(track)){
   stopped.add(track);try{track.stop?.();}catch{/* Cleanup cannot activate another source. */}
  }
 }
 function release(value){
  if(!value)return;
  if(entry===value)entry=null;
  for(const [track,listener] of value.listeners)try{track.removeEventListener?.('ended',listener);}catch{}
  stopStream(value.stream);
 }
 function notify(callback,value){try{const result=callback(value);if(result&&typeof result.catch==='function')void result.catch(()=>{});}catch{/* A notification cannot resurrect a cancelled source. */}}
 function invalidate(reason){
  const oldPending=pending;pending=null;generation++;selecting=false;
  oldPending?.cancel(reason);const old=entry;entry=null;release(old);
 }
 function ended(value){
  if(entry!==value||!currentToken(value.generation))return;
  invalidate('CAPTURE_ENDED');const token=generation;
  const event={stream:value.stream,generation:token,reason:'CAPTURE_ENDED'};
  notify(onEnded,event);if(currentToken(token))notify(onSettled,event);
 }
 async function select(){
  if(disposed)return {ok:false,code:'CAPTURE_DISPOSED'};
  invalidate('CAPTURE_REPLACED');const token=generation;selecting=true;
  let cancel;const cancelled=new Promise(resolve=>{cancel=resolve;});
  const task={generation:token,cancel};pending=task;
  const interrupted=cancelled.then(code=>{throw Object.assign(Error(code),{captureCancelled:true,code});});
  const wait=operation=>Promise.race([operation,interrupted]);
  let acquired=null,value=null;
  try{
   await wait(onPreparing({stream:null,generation:token,reason:'CAPTURE_SELECTING'}));
   if(!currentToken(token))throw Object.assign(Error('CAPTURE_CANCELLED'),{captureCancelled:true,code:'CAPTURE_CANCELLED'});
   const requested=Promise.resolve().then(()=>{
    if(!currentToken(token))throw Object.assign(Error('CAPTURE_CANCELLED'),{captureCancelled:true,code:'CAPTURE_CANCELLED'});
    return request();
   });
   // This continuation remains even when cancellation wins the race. A late
   // stream is disposed, without disturbing the current stream of a new task.
   void requested.then(stream=>{if(!currentToken(token))stopStream(stream);},()=>{});
   acquired=await wait(requested);
   if(!currentToken(token)){stopStream(acquired);return {ok:false,code:'CAPTURE_CANCELLED'};}
   if(!live(acquired))throw Error('CAPTURE_ENDED');
   value={stream:acquired,generation:token,listeners:[]};entry=value;
   for(const track of videoTracks(acquired)){
    if(typeof track.addEventListener!=='function')throw Error('INVALID_CAPTURE_STREAM');
    const listener=()=>ended(value);value.listeners.push([track,listener]);track.addEventListener('ended',listener,{once:true});
   }
   if(!live(acquired)){ended(value);throw Object.assign(Error('CAPTURE_ENDED'),{captureCancelled:true,code:'CAPTURE_ENDED'});}
   await wait(connect(acquired,{generation:token}));
   if(!currentToken(token)||entry!==value)return {ok:false,code:'CAPTURE_CANCELLED'};
   if(!live(acquired)){ended(value);return {ok:false,code:'CAPTURE_ENDED'};}
   selecting=false;
   await wait(onReady({stream:acquired,generation:token,reason:'CAPTURE_READY'}));
   if(!currentToken(token)||entry!==value)return {ok:false,code:'CAPTURE_CANCELLED'};
   if(!live(acquired)){ended(value);return {ok:false,code:'CAPTURE_ENDED'};}
   return {ok:true,code:'CAPTURE_READY',stream:acquired};
  }catch(error){
   if(value)release(value);else if(acquired)stopStream(acquired);
   if(error?.captureCancelled||!currentToken(token))return {ok:false,code:error?.code??'CAPTURE_CANCELLED'};
   selecting=false;notify(onError,{stream:acquired,generation:token,reason:'CAPTURE_FAILED',error});
   return {ok:false,code:'CAPTURE_FAILED',error};
  }finally{
   if(pending===task)pending=null;
   if(currentToken(token)){selecting=false;notify(onSettled,{stream:entry?.stream??null,generation:token,reason:entry?'CAPTURE_READY':'CAPTURE_FAILED'});}
  }
 }
 function cancel(reason='CAPTURE_CANCELLED'){
  if(disposed)return;
  invalidate(reason);notify(onSettled,{stream:null,generation,reason});
 }
 function dispose(){
  if(disposed)return;
  invalidate('CAPTURE_DISPOSED');disposed=true;notify(onSettled,{stream:null,generation,reason:'CAPTURE_DISPOSED'});
 }
 return {select,cancel,dispose,current:()=>entry?.stream??null,get selecting(){return selecting;},snapshot:()=>({generation,selecting,disposed,hasStream:!!entry})};
}
