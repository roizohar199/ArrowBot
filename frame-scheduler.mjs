import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';
import {createTrackFrameSource} from './track-frame-source.mjs';

// Schedule analysis from delivered video frames. receivedAt is our receipt
// time, not a claim about when TradingView rendered or captured the frame.
export function createFrameScheduler({video,onFrame,onStall=()=>{},onError=()=>{},getTrack=()=>video.srcObject?.getVideoTracks?.()[0],createTrackSource=createTrackFrameSource,now=Date.now,maxGapMs=MAX_CAPTURE_GAP_MS,pollMs=16,watchdogMs=Math.min(250,maxGapMs),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!video||typeof onFrame!=='function')throw TypeError('A video and onFrame callback are required');
 let running=false,generation=0,frameHandle=null,pollTimer=null,watchdogTimer=null,lastKey=null,lastDeliveredAt=0,stalled=false,processing=false,delivered=0,duplicates=0,missed=0,lastPresented=null;
 const native=typeof video.requestVideoFrameCallback==='function'&&typeof video.cancelVideoFrameCallback==='function';
 let trackSource=null,mode=native?'VIDEO_FRAME_CALLBACK':'POLL',lastTrackTimestamp=null;
 const report=error=>{try{onError(error);}catch{/* Diagnostics must not break frame scheduling. */}};
 const valid=token=>running&&token===generation;
 function reportStall(reason){if(stalled)return;stalled=true;try{onStall({receivedAt:now(),lastFrameAt:lastDeliveredAt,gapMs:now()-lastDeliveredAt,reason});}catch(error){report(error);}}
 async function pumpTrack(token,source){
  try{
   while(valid(token)&&trackSource===source){
    const {value:frame,done}=await source.reader.read();
    if(done){if(valid(token)&&trackSource===source)reportStall('TRACK_STREAM_ENDED');break;}
    if(!frame)throw Error('INVALID_CAPTURE_FRAME');
    try{
     if(!valid(token)||trackSource!==source)break;
     const timestamp=frame.timestamp;
     if(!Number.isFinite(timestamp)||lastTrackTimestamp!==null&&timestamp<=lastTrackTimestamp){duplicates++;continue;}
     lastTrackTimestamp=timestamp;lastDeliveredAt=now();stalled=false;delivered++;processing=true;
     try{await onFrame({receivedAt:lastDeliveredAt,frameId:timestamp,frameNow:null,metadata:{mediaTime:timestamp/1000000},videoFrame:frame});}
     catch(error){if(valid(token))report(error);}
     finally{if(valid(token))processing=false;}
    }finally{try{frame.close();}catch{}}
   }
  }catch(error){
   if(valid(token)&&trackSource===source){report(error);reportStall('TRACK_PROCESSOR_FAILED');source.close();trackSource=null;mode=native?'VIDEO_FRAME_CALLBACK':'POLL';schedule(token);}
  }
 }
 function schedule(token){
  if(!valid(token))return;
  if(native){
   frameHandle=video.requestVideoFrameCallback((frameNow,metadata)=>{
    frameHandle=null;void deliver(token,frameNow,metadata??{});
   });
  }else pollTimer=setTimer(()=>{pollTimer=null;void deliver(token,null,{});},pollMs);
 }
 async function deliver(token,frameNow,metadata){
  if(!valid(token))return;
  const frameId=Number.isFinite(metadata.presentedFrames)?metadata.presentedFrames:Number.isFinite(metadata.mediaTime)?metadata.mediaTime:video.currentTime;
  const key=Number.isFinite(metadata.presentedFrames)?'presented:'+metadata.presentedFrames:'media:'+frameId;
  if(!Number.isFinite(frameId)||key===lastKey||Number.isFinite(metadata.presentedFrames)&&lastPresented!==null&&metadata.presentedFrames<=lastPresented||video.readyState!==undefined&&video.readyState<2){duplicates++;schedule(token);return;}
  if(processing){schedule(token);return;}
  lastKey=key;lastDeliveredAt=now();stalled=false;delivered++;
  if(Number.isFinite(metadata.presentedFrames)){
   if(lastPresented!==null&&metadata.presentedFrames>lastPresented+1)missed+=metadata.presentedFrames-lastPresented-1;
   lastPresented=metadata.presentedFrames;
  }
  processing=true;
  try{await onFrame({receivedAt:lastDeliveredAt,frameId,frameNow,metadata:{...metadata}});}
  catch(error){if(valid(token))report(error);}
  finally{if(valid(token)){processing=false;schedule(token);}}
 }
 function watchdog(token){
  if(!valid(token))return;
  if(!stalled&&now()-lastDeliveredAt>maxGapMs)reportStall('CAPTURE_GAP');
  watchdogTimer=setTimer(()=>watchdog(token),watchdogMs);
 }
 function stop(){
  running=false;generation++;
  const old=trackSource;trackSource=null;old?.close();processing=false;
  if(frameHandle!==null){video.cancelVideoFrameCallback(frameHandle);frameHandle=null;}
  if(pollTimer!==null){clearTimer(pollTimer);pollTimer=null;}
  if(watchdogTimer!==null){clearTimer(watchdogTimer);watchdogTimer=null;}
 }
 return {
  start(){
   stop();running=true;const token=generation;lastKey=null;lastPresented=null;lastTrackTimestamp=null;lastDeliveredAt=now();stalled=false;delivered=0;duplicates=0;missed=0;
   try{trackSource=createTrackSource(getTrack());}catch(error){report(error);trackSource=null;}
   mode=trackSource?'TRACK_PROCESSOR':native?'VIDEO_FRAME_CALLBACK':'POLL';
   if(trackSource)void pumpTrack(token,trackSource);else schedule(token);
   watchdogTimer=setTimer(()=>watchdog(token),watchdogMs);
  },
  stop,
  snapshot(){return {running,processing,mode,delivered,duplicates,missed,lastFrameAt:lastDeliveredAt,stalled,...(trackSource?{trackDiscarded:trackSource.discarded?.()??null}:{})};},
 };
}
