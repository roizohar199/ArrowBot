// Temporary observation of an already-running extension panel. This never
// consumes, clones or closes a frame, and never sends a trading message.
const finite=Number.isFinite;
const percentile=(values,p)=>{const sorted=values.filter(finite).sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;};
const stats=values=>({count:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:percentile(values,1)});

export function inspectCaptureFrame(source,panel,drawStartedAt,drawFinishedAt){
  let isVideoFrame=false,metadata=null,metadataError=null,timestamp=null;
  try{isVideoFrame=typeof panel.VideoFrame==='function'&&source instanceof panel.VideoFrame;}catch{}
  if(isVideoFrame){
    try{timestamp=finite(source.timestamp)?source.timestamp:null;}catch{}
    try{if(typeof source.metadata==='function')metadata=source.metadata();}catch(error){metadataError=String(error?.message??error).slice(0,160);}
  }
  const captureTime=finite(metadata?.captureTime)?metadata.captureTime:null;
  const captureAgeMs=captureTime===null?null:drawFinishedAt-captureTime;
  const captureTimeValid=captureTime!==null&&captureTime>=0&&captureAgeMs>=0&&captureAgeMs<=10000;
  const metadataValues={};
  if(metadata&&typeof metadata==='object')for(const key of Object.keys(metadata).slice(0,20)){
    const value=metadata[key];if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number')metadataValues[key]=typeof value==='string'?value.slice(0,160):value;
  }
  return {sourceType:isVideoFrame?'VideoFrame':String(source?.constructor?.name??'unknown'),isVideoFrame,
    metadataMethodAvailable:isVideoFrame&&typeof source.metadata==='function',metadataKeys:Object.keys(metadataValues),metadata:metadataValues,metadataError,
    mediaTimestampUs:timestamp,captureTime,captureTimeValid,captureTimeReason:captureTime===null?'CAPTURE_TIME_ABSENT':captureTimeValid?'VALID_PERFORMANCE_CLOCK':'CAPTURE_TIME_INVALID_OR_STALE',
    drawStartedAt,drawFinishedAt,drawDurationMs:drawFinishedAt-drawStartedAt,captureToDrawMs:captureTimeValid?captureAgeMs:null};
}

export function createPanelLatencyProbe({panel,preview,detail,mode='feature',durationMs=30000,onComplete=()=>{},onProgress=()=>{},now=()=>panel.performance.now(),wallNow=Date.now}={}){
  if(!panel||!preview||!detail||!['feature','latency'].includes(mode))throw TypeError('A live panel, preview, candle detail and valid mode are required.');
  const proto=panel.CanvasRenderingContext2D?.prototype,descriptor=proto&&Object.getOwnPropertyDescriptor(proto,'drawImage');
  if(typeof descriptor?.value!=='function')throw Error('DRAW_TAP_UNAVAILABLE');
  const original=descriptor.value,startedAt=now(),startedAtUtc=new Date(wallNow()).toISOString();
  let active=false,finished=false,finishing=false,latestFrame=null,sequence=0,renderSequence=0,observer=null,timer=null,watchdog=null,pending=null;
  const featureFrames=[],samples=[],errors=[],discarded={hidden:0,offscreen:0,superseded:0,noCaptureTime:0,notTracking:0,clock:0};
  let validCaptureFrames=0,totalDraws=0,restoration='NOT_INSTALLED',initialScroll=null,probeScroll=null;
  const statusNode=panel.document.getElementById('candle-state');
  const frameClock=panel.performance.timeOrigin;
  const report=(reason)=>({schemaVersion:1,kind:'actual-running-panel-capture-metadata-probe',mode,reason,startedAtUtc,endedAtUtc:new Date(wallNow()).toISOString(),durationMs:Math.max(0,now()-startedAt),
    browser:{userAgent:String(panel.navigator?.userAgent??''),chromeVersion:/\b(?:Chrome|Chromium)\/([\d.]+)/.exec(String(panel.navigator?.userAgent??''))?.[1]??null},
    panel:{timeOrigin:frameClock,build:panel.document.querySelector('.version bdi')?.textContent??null,visible:panel.document.visibilityState==='visible'},
    scope:'Capture metadata to two browser paint opportunities around the candle result. This is not a physical display/photon measurement.',
    captureTimeSource:'VideoFrame.metadata().captureTime; never inferred from VideoFrame.timestamp or receipt time',
    captureTimeClock:'DOMHighResTimeStamp relative to the receiving panel performance.timeOrigin; absent/invalid metadata is unavailable',
    paintMethod:'Candle-detail MutationObserver followed by two requestAnimationFrame callbacks in the visible, onscreen panel. Brackets are browser paint opportunities, not guaranteed physical presentation times.',
    totalDraws,validCaptureFrames,paintSamples:samples.length,featureFrames:featureFrames.map(f=>({...f,metadata:{...f.metadata},metadataKeys:[...f.metadataKeys]})),
    latencyAvailable:samples.length>0,latencyMs:{lowerPaintOpportunity:stats(samples.map(s=>s.lowerMs)),upperPaintOpportunity:stats(samples.map(s=>s.upperMs)),captureToDraw:stats(samples.map(s=>s.captureToDrawMs)),captureToMutation:stats(samples.map(s=>s.captureToMutationMs))},
    discarded:{...discarded},restoration,errors:[...errors],samples:samples.map(s=>({...s})),
    limitations:['The browser capture timestamp is an estimate supplied by the implementation.','requestAnimationFrame brackets a rendering opportunity and cannot confirm that physical screen pixels changed.','Only the visible, onscreen candle result is sampled; hidden, offscreen or superseded results are excluded.','The probe adds a small synchronous metadata read and layout visibility check; no image pixels are copied.']});
  function visible(){return panel.document.visibilityState==='visible'&&!panel.document.hidden;}
  function onscreen(){
    const rect=detail.getBoundingClientRect();
    return rect.width>0&&rect.height>0&&rect.top>=0&&rect.left>=0&&rect.bottom<=panel.innerHeight&&rect.right<=panel.innerWidth;
  }
  function cancelPending(){
    if(!pending)return;
    for(const handle of pending.handles)try{panel.cancelAnimationFrame(handle);}catch{}
    pending=null;
  }
  function finish(reason='COMPLETE'){
    if(finished)return null;
    finished=true;active=false;finishing=true;
    cancelPending();observer?.disconnect();observer=null;
    try{panel.clearTimeout(timer);}catch{}clearTimeout(watchdog);
    try{panel.removeEventListener('pagehide',panelEnded);}catch{}
    try{if(proto.drawImage===wrapped){Object.defineProperty(proto,'drawImage',descriptor);restoration='RESTORED';}else restoration='NOT_OVERWRITTEN_CHANGED_ELSEWHERE';}catch(error){restoration='RESTORE_FAILED';errors.push(String(error?.message??error));}
    try{if(initialScroll&&probeScroll&&panel.scrollX===probeScroll.x&&panel.scrollY===probeScroll.y)panel.scrollTo(initialScroll.x,initialScroll.y);}catch{}
    const result=report(reason);
    try{onComplete(result);}catch{}
    return result;
  }
  function completeSoon(reason){if(finishing)return;finishing=true;queueMicrotask(()=>finish(reason));}
  function panelEnded(){finish('PANEL_CLOSED');}
  function checkPanel(){
    if(panel.document.getElementById('shortcut-toggle')?.getAttribute('aria-pressed')!=='false'){completeSoon('SHORTCUTS_NOT_OFF');return false;}
    if(panel.document.getElementById('stop')?.disabled!==false){completeSoon('MONITORING_STOPPED');return false;}
    return true;
  }
  function observeDraw(source,drawStartedAt,drawFinishedAt){
    if(!active||finishing||!checkPanel())return;
    totalDraws++;const frame={sequence:++sequence,...inspectCaptureFrame(source,panel,drawStartedAt,drawFinishedAt)};
    latestFrame=frame;if(frame.captureTimeValid)validCaptureFrames++;
    if(featureFrames.length<3)featureFrames.push(frame);
    try{onProgress({totalDraws,validCaptureFrames,paintSamples:samples.length});}catch{}
    if(mode==='feature'&&totalDraws>=3)completeSoon('FEATURE_PROBE_COMPLETE');
    else if(mode==='latency'&&totalDraws>=3&&validCaptureFrames===0)completeSoon('CAPTURE_TIME_UNAVAILABLE');
  }
  function wrapped(...args){
    if(this?.canvas!==preview||!active)return Reflect.apply(original,this,args);
    const before=now();
    const returned=Reflect.apply(original,this,args);
    try{observeDraw(args[0],before,now());}catch(error){errors.push(String(error?.message??error).slice(0,160));completeSoon('PROBE_ERROR');}
    return returned;
  }
  function renderObserved(){
    if(!active||finishing||mode!=='latency'||!checkPanel())return;
    if(pending){discarded.superseded++;cancelPending();}
    if(statusNode?.dataset.state!=='TRACKING'){discarded.notTracking++;return;}
    const frame=latestFrame,mutationAt=now(),renderId=++renderSequence;
    if(!frame?.captureTimeValid){discarded.noCaptureTime++;return;}
    if(!visible()){discarded.hidden++;return;}
    if(!onscreen()){discarded.offscreen++;return;}
    if(mutationAt<frame.drawFinishedAt||mutationAt-frame.drawFinishedAt>2500){discarded.clock++;return;}
    const work={renderId,handles:[],frame,mutationAt};pending=work;
    work.handles.push(panel.requestAnimationFrame(()=>{
      if(!active||pending!==work)return;
      if(!visible()){discarded.hidden++;cancelPending();return;}
      if(!onscreen()){discarded.offscreen++;cancelPending();return;}
      work.firstPaintOpportunityAt=now();
      work.handles.push(panel.requestAnimationFrame(()=>{
        if(!active||pending!==work)return;
        if(!visible()){discarded.hidden++;cancelPending();return;}
        if(!onscreen()){discarded.offscreen++;cancelPending();return;}
        const second=now(),first=work.firstPaintOpportunityAt;
        if(first<mutationAt||second<first||second-frame.captureTime>10000){discarded.clock++;cancelPending();return;}
        samples.push({frameSequence:frame.sequence,mediaTimestampUs:frame.mediaTimestampUs,captureTime:frame.captureTime,drawStartedAt:frame.drawStartedAt,drawFinishedAt:frame.drawFinishedAt,mutationAt,firstPaintOpportunityAt:first,secondPaintOpportunityAt:second,
          lowerMs:first-frame.captureTime,upperMs:second-frame.captureTime,captureToDrawMs:frame.captureToDrawMs,captureToMutationMs:mutationAt-frame.captureTime});
        if(samples.length>600)samples.shift();pending=null;
        try{onProgress({totalDraws,validCaptureFrames,paintSamples:samples.length});}catch{}
      }));
    }));
  }
  return {
    start(){
      if(active||finished)throw Error('PROBE_ALREADY_USED');
      active=true;
      try{
        Object.defineProperty(proto,'drawImage',{...descriptor,value:wrapped});restoration='INSTALLED';
        observer=new panel.MutationObserver(renderObserved);observer.observe(detail,{childList:true,subtree:true,characterData:true});
        panel.addEventListener('pagehide',panelEnded,{once:true});
        if(mode==='latency'){
          initialScroll={x:panel.scrollX,y:panel.scrollY};
          detail.closest('.candle-readout')?.scrollIntoView({block:'center',behavior:'instant'});
          probeScroll={x:panel.scrollX,y:panel.scrollY};
        }
        timer=panel.setTimeout(()=>finish(mode==='feature'?'FEATURE_TIMEOUT':'COMPLETE'),mode==='feature'?10000:durationMs);
        watchdog=setTimeout(()=>finish('WATCHDOG_TIMEOUT'),(mode==='feature'?10000:durationMs)+10000);
      }catch(error){errors.push(String(error?.message??error));finish('PROBE_SETUP_FAILED');throw error;}
      return this;
    },stop:finish,snapshot:()=>report(active?'RUNNING':'IDLE'),
  };
}

// The module can be imported into isolated tests without a browser document.
if(typeof document!=='undefined'&&typeof chrome!=='undefined'&&document.getElementById('feature')){
  const $=id=>document.getElementById(id);
  let current=null,lastReport=null,returnTabId=null;
  const messages={FEATURE_PROBE_COMPLETE:'בדיקת הזמינות הסתיימה.',CAPTURE_TIME_UNAVAILABLE:'הדפדפן לא מספק חותמת צילום תקינה. ההשהיה הכוללת אינה זמינה למדידה במסלול הזה.',FEATURE_TIMEOUT:'לא התקבלו שלוש תמונות בזמן הבדיקה.',COMPLETE:'המדידה הסתיימה.',STOPPED:'הבדיקה נעצרה.',PANEL_CLOSED:'לוח המעקב נסגר; החיבור הזמני הוסר.',SHORTCUTS_NOT_OFF:'הבדיקה נעצרה משום שקיצורי המסחר אינם כבויים.',MONITORING_STOPPED:'המעקב נעצר; הבדיקה הסתיימה.'};
  const fmt=value=>finite(value)?value.toFixed(1):'—';
  function buttons(busy){$('feature').disabled=busy;$('measure').disabled=busy;$('stop').disabled=!busy;$('download').disabled=busy||!lastReport;}
  function show(result){
    $('frames').textContent=String(result.totalDraws);$('metadata').textContent=String(result.validCaptureFrames)+' / '+String(result.totalDraws);$('paints').textContent=String(result.paintSamples);
    const lower=result.latencyMs.lowerPaintOpportunity,upper=result.latencyMs.upperPaintOpportunity;
    $('median').textContent=result.latencyAvailable?fmt(lower.p50Ms)+'–'+fmt(upper.p50Ms)+' ms':'לא זמין';
    $('p95').textContent=result.latencyAvailable?fmt(lower.p95Ms)+'–'+fmt(upper.p95Ms)+' ms':'לא זמין';
    const first=result.featureFrames[0];
    $('detail').textContent=result.validCaptureFrames?`נמצאה חותמת צילום תקינה ב־${result.validCaptureFrames} תמונות. ${result.latencyAvailable?'מוצג חלון הזדמנויות ציור בדפדפן.':'למדידת התצוגה הפעילו מדידה של 30 שניות.'}`:first?`מקור: ${first.sourceType}. שדות מידע זמינים: ${first.metadataKeys.join(', ')||'אין'}. לא הוסקה חותמת צילום מזמן המדיה.`:'לא נקראו פריימים.';
    $('technical').textContent=JSON.stringify({...result,samples:result.samples.length?'('+result.samples.length+' samples in downloaded JSON)':[]},null,2);
  }
  async function findPanel(){
    const views=chrome.extension.getViews({type:'tab'}).filter(view=>{
      try{return view!==window&&view.location.pathname.endsWith('/experiment.html')&&view.document.getElementById('preview')&&view.document.getElementById('stop')?.disabled===false;}catch{return false;}
    });
    if(views.length!==1)throw Error(views.length?'פתוחים כמה לוחות מעקב פעילים. השאירו לוח פעיל אחד.':'לא נמצא לוח Arrow עם מעקב פעיל.');
    const panel=views[0];
    if(panel.document.getElementById('shortcut-toggle')?.getAttribute('aria-pressed')!=='false')throw Error('יש לכבות קיצורי מסחר לפני הבדיקה.');
    const tabs=await chrome.tabs.query({});
    const matches=tabs.filter(tab=>{try{return tab.url===panel.location.href&&chrome.extension.getViews({type:'tab',tabId:tab.id}).includes(panel);}catch{return false;}});
    if(matches.length!==1)throw Error('לא ניתן לזהות לשונית מעקב יחידה.');
    return {panel,tabId:matches[0].id};
  }
  async function run(mode){
    if(current)return;
    buttons(true);$('status').textContent='מאתר את לוח המעקב הפעיל…';
    try{
      returnTabId=(await chrome.tabs.getCurrent())?.id;
      const {panel,tabId}=await findPanel();
      current=createPanelLatencyProbe({panel,preview:panel.document.getElementById('preview'),detail:panel.document.getElementById('candle-detail'),mode,onComplete:result=>{
        lastReport=result;current=null;show(result);buttons(false);$('status').textContent=messages[result.reason]??'הבדיקה הסתיימה: '+result.reason;
        if(returnTabId!=null)void chrome.tabs.update(returnTabId,{active:true}).catch(()=>{});
      }});
      $('status').textContent=mode==='feature'?'בודק שלוש תמונות שכבר מגיעות ללוח…':'מודד במשך 30 שניות. השאירו את לשונית הלוח גלויה ונתוני הנרות בתוך המסך.';
      await chrome.tabs.update(tabId,{active:true});
      current.start();
    }catch(error){current?.stop('START_FAILED');current=null;buttons(false);$('status').textContent=String(error?.message??error);}
  }
  $('feature').addEventListener('click',()=>{void run('feature');});
  $('measure').addEventListener('click',()=>{void run('latency');});
  $('stop').addEventListener('click',()=>current?.stop('STOPPED'));
  $('download').addEventListener('click',()=>{
    if(!lastReport)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='arrow-latency-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('pagehide',()=>{current?.stop('DIAGNOSTIC_PAGE_CLOSED');current=null;});
}
