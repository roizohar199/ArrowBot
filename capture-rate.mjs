export const CAPTURE_RATE_KEY='arrowCaptureRate';
export const validCaptureRate=rate=>rate===30||rate===60;
export function createCaptureRateController({now=Date.now,constraintTimeoutMs=3000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let track=null,rate=30,applied=null,revision=0,waiter=null,reason='NO_TRACK',samples=[],lastFrame=null,windowStarted=null;
 const slots=new WeakMap();
 const settings=()=>{try{return track?.getSettings?.()??{};}catch{return {};}};
 function resetMetrics(){samples=[];lastFrame=null;windowStarted=null;}
 function snapshot(){
  const sorted=samples.map(s=>s.processingMs).filter(Number.isFinite).sort((a,b)=>a-b),first=samples[0],last=samples.at(-1),elapsed=first&&last?last.at-first.at:0;
  return {requested:rate,applied,reported:settings().frameRate??null,reason,frames:samples.length,deliveredFps:elapsed>0?(samples.length-1)*1000/elapsed:null,
   processingP95:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,missed:samples.reduce((sum,s)=>sum+s.missed,0),missedKnown:samples.length>0&&samples.every(s=>s.missedKnown),windowStarted};
 }
 function settle(){
  if(!waiter)return;const current=waiter;waiter=null;clearTimer(current.timer);current.resolve(snapshot());
 }
 const isCurrent=(slot,token)=>slot.track===track&&token===revision;
 function pump(slot){
  if(slot.busy||slot.track!==track||slot.finishedRevision===revision)return;
  const token=revision,desired=rate;slot.busy=true;
  // Keep native operations ordered on this physical track. A public timeout
  // does not release it; only its settlement can reconcile the latest intent.
  const operation=async()=>{
   if(typeof slot.track.applyConstraints!=='function')return 'CONSTRAINT_UNAVAILABLE';
   try{await slot.track.applyConstraints({frameRate:{ideal:desired,max:desired}});slot.applied=desired;return 'APPLIED';}
   catch{
    if(desired===60&&isCurrent(slot,token)){
     try{await slot.track.applyConstraints({frameRate:{ideal:30,max:30}});slot.applied=30;return 'FALLBACK_30';}catch{/* Preserve reported settings; do not claim a successful constraint. */}
    }
    return 'CONSTRAINT_FAILED';
   }
  };
  void operation().then(result=>{
   slot.busy=false;slot.finishedRevision=token;
   if(slot.track!==track)return;
   applied=slot.applied;
   if(token!==revision){reason='PENDING';pump(slot);return;}
   const actual=settings().frameRate;
   reason=result==='APPLIED'&&desired===60&&Number.isFinite(actual)&&actual<45?'SOURCE_BELOW_60':result;
   if(result==='APPLIED'||result==='FALLBACK_30')resetMetrics();
   settle();
  },()=>{
   // Defensive cleanup for a hostile track object/getter. Normal native
   // constraint rejections are handled inside operation(), including fallback.
   slot.busy=false;slot.finishedRevision=token;
   if(slot.track!==track)return;
   if(token!==revision){reason='PENDING';pump(slot);return;}
   reason='CONSTRAINT_FAILED';settle();
  });
 }
 function apply(){
  // Supersede the previous public request immediately instead of retaining a
  // promise/callback queue when users change their preferred rate repeatedly.
  reason=track?'PENDING':'NO_TRACK';settle();
  if(!track){applied=null;reason='NO_TRACK';return Promise.resolve(snapshot());}
  let slot=slots.get(track);if(!slot){slot={track,busy:false,applied:null,finishedRevision:-1};slots.set(track,slot);}
  applied=slot.applied;reason='PENDING';
  const result=new Promise(resolve=>{
   const current={resolve,timer:null};waiter=current;
   current.timer=setTimer(()=>{if(waiter!==current)return;reason='CONSTRAINT_TIMEOUT';settle();},constraintTimeoutMs);
  });
  pump(slot);return result;
 }
 return {
  request:()=>({ideal:rate,max:rate}),snapshot,resetMetrics,
  setRate(next){if(!validCaptureRate(next))return Promise.reject(Error('INVALID_CAPTURE_RATE'));rate=next;revision++;return apply();},
  attach(next){track=next??null;applied=null;revision++;resetMetrics();return apply();},
  observe({at=now(),processingMs,presentedFrames}={}){
   if(!Number.isFinite(at)||lastFrame&&at<=lastFrame.at)return;
   // Frame identities can be media seconds or VideoFrame microsecond timestamps.
   // Only the explicitly supplied presentation counter can establish skipped
   // frames; elapsed timestamps do not tell us how many source frames existed.
   const count=Number.isSafeInteger(presentedFrames)&&presentedFrames>=0?presentedFrames:null;
   const prior=lastFrame?.presentedFrames??null;
   const missedKnown=count!==null&&(!lastFrame||prior!==null&&count>=prior);
   const missed=missedKnown&&prior!==null?Math.max(0,count-prior-1):0;
   if(!windowStarted)windowStarted=at;
   samples.push({at,processingMs:Number.isFinite(processingMs)&&processingMs>=0?processingMs:null,missed,missedKnown});if(samples.length>600)samples.shift();lastFrame={at,presentedFrames:count};
  },
 };
}
// Recommending a mode requires enough delivered samples, not a requested FPS.
export function compareCaptureRates(a,b){
 const usable=s=>s&&s.frames>=30&&Number.isFinite(s.deliveredFps)&&Number.isFinite(s.processingP95);
 if(!usable(a)||!usable(b))return {recommended:null,reason:'INSUFFICIENT_FRAMES'};
 if(b.deliveredFps>=45&&b.deliveredFps>=a.deliveredFps*1.3&&b.processingP95<1000/60*.75&&Number.isFinite(b.missed)&&b.missedKnown!==false&&b.missed<=b.frames*.05)return {recommended:60,reason:'FASTER_STABLE_DELIVERY'};
 return {recommended:30,reason:'NO_STABLE_60_GAIN'};
}
