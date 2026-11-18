// A track reader does not depend on the preview video being rendered. Clone
// the track so cancellation/restart never stops the user's selected capture.
export function createTrackFrameSource(track,{Processor=globalThis.MediaStreamTrackProcessor}={}){
 if(typeof Processor!=='function'||typeof track?.clone!=='function')return null;
 let clone=null,reader=null,closed=false;
 const close=()=>{
  if(closed)return;closed=true;
  try{const pending=reader?.cancel();void Promise.resolve(pending).then(()=>{try{reader?.releaseLock?.();}catch{}},()=>{});}catch{}
  try{clone?.stop();}catch{}
 };
 try{
  clone=track.clone();if(!clone||clone===track)throw Error('INVALID_CAPTURE_TRACK_CLONE');
  const processor=new Processor({track:clone,maxBufferSize:1});reader=processor.readable.getReader();
  if(typeof reader?.read!=='function')throw Error('INVALID_TRACK_FRAME_READER');
  return {reader,close,discarded:()=>Number.isFinite(processor.discardedFrames)?processor.discardedFrames:null};
 }catch(error){if(clone===track)clone=null;close();throw error;}
}
