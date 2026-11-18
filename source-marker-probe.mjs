// An opt-in visual propagation diagnostic. It measures a temporary source DOM
// marker through captured images and the result UI; it never dates market data.
const finite=Number.isFinite;
const WIDTH=224,HEIGHT=12,PADDING=12,CELL=5,SYNC=0xd2;
const copy=value=>structuredClone(value);
function crc8(bytes){let crc=0;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&128?(crc<<1)^7:crc<<1;crc&=255;}return crc;}
export function sourceMarkerBits(session,sequence){
  if(!Number.isSafeInteger(session)||session<0||session>65535||!Number.isSafeInteger(sequence)||sequence<1||sequence>255)throw TypeError('Invalid marker identity');
  const bytes=[SYNC,session>>>8,session&255,sequence,crc8([session>>>8,session&255,sequence])];
  return bytes.flatMap(byte=>Array.from({length:8},(_,bit)=>(byte>>(7-bit))&1));
}

// Self-contained for chrome.scripting.executeScript. It creates/updates only
// its owned, visible diagnostic canvas; no existing chart pixels are accessed.
export function sourceMarkerCommand({operation,markerId,session,sequence}={}){
  if(typeof markerId!=='string'||!/^arrow-source-marker-[a-zA-Z0-9_-]{1,70}$/.test(markerId)||!['put','remove'].includes(operation))throw Error('INVALID_MARKER_COMMAND');
  const existing=document.getElementById(markerId);
  if(existing&&existing.getAttribute('data-arrow-marker-owner')!==markerId)throw Error('MARKER_OWNERSHIP_CONFLICT');
  if(operation==='remove'){if(existing)existing.remove();return {operation,markerId,removed:!!existing,absent:!document.getElementById(markerId)};}
  if(location.protocol!=='https:'||!(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))||!location.pathname.startsWith('/chart/'))throw Error('TRADINGVIEW_CHART_REQUIRED');
  if(!Number.isSafeInteger(session)||session<0||session>65535||!Number.isSafeInteger(sequence)||sequence<1||sequence>255)throw Error('INVALID_MARKER_IDENTITY');
  const node=existing??document.createElement('canvas');
  if(!existing){
    node.id=markerId;node.width=224;node.height=12;node.setAttribute('data-arrow-marker-owner',markerId);node.setAttribute('aria-hidden','true');
    node.style.cssText='position:fixed!important;left:8px!important;top:8px!important;width:224px!important;height:12px!important;z-index:2147483647!important;pointer-events:none!important;opacity:1!important;visibility:visible!important;display:block!important;border:0!important;padding:0!important;margin:0!important;transform:none!important;';
    document.documentElement.append(node);
    // Source-side expiry survives an extension panel closing before its cleanup
    // message can be delivered. The identity check protects a replacement node.
    setTimeout(()=>{if(document.getElementById(markerId)===node&&node.getAttribute('data-arrow-marker-owner')===markerId)node.remove();},30000);
  }
  const canvas=node.getContext('2d');if(!canvas)throw Error('MARKER_CANVAS_UNAVAILABLE');
  let checksum=0;for(const byte of [session>>>8,session&255,sequence]){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=checksum&128?(checksum<<1)^7:checksum<<1;checksum&=255;}
  const bytes=[0xd2,session>>>8,session&255,sequence,checksum];
  canvas.fillStyle='#fff';canvas.fillRect(0,0,224,12);
  for(let index=0;index<40;index++)if(!((bytes[index>>>3]>>(7-(index&7)))&1)){canvas.fillStyle='#000';canvas.fillRect(12+index*5,0,5,12);}
  const mutationEpoch=performance.timeOrigin+performance.now(),rect=node.getBoundingClientRect();
  return {operation,markerId,session,sequence,mutationEpoch,sourceTimeOrigin:performance.timeOrigin,sourceUrl:location.origin+location.pathname,
    rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},viewport:{width:innerWidth,height:innerHeight},devicePixelRatio};
}

export function decodeSourceMarker(image,geometry){
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||!image.data||image.data.length<image.width*image.height*4)return null;
  const {rect,viewport}=geometry??{};
  if(!rect||!viewport||!['left','top','width','height'].every(key=>finite(rect[key]))||!finite(viewport.width)||!finite(viewport.height)||viewport.width<1||viewport.height<1||Math.abs(rect.width-WIDTH)>.5||Math.abs(rect.height-HEIGHT)>.5)return null;
  if(Math.abs((image.width/image.height)/(viewport.width/viewport.height)-1)>.01)return null;
  const sx=image.width/viewport.width,sy=image.height/viewport.height;
  function color(x,y){
    let black=0,white=0;
    for(const dy of [-1.5,0,1.5])for(const dx of [-.8,0,.8]){
      const ix=Math.floor((x+dx)*sx),iy=Math.floor((y+dy)*sy);if(ix<0||iy<0||ix>=image.width||iy>=image.height)return null;
      const offset=(iy*image.width+ix)*4,r=image.data[offset],g=image.data[offset+1],b=image.data[offset+2];
      if(image.data[offset+3]<240||Math.max(r,g,b)-Math.min(r,g,b)>30)continue;
      if(Math.max(r,g,b)<65)black++;if(Math.min(r,g,b)>190)white++;
    }
    return white>=7?1:black>=7?0:null;
  }
  const y=rect.top+HEIGHT/2;
  if(color(rect.left+PADDING/2,y)!==1||color(rect.left+WIDTH-PADDING/2,y)!==1)return null;
  const bits=[];for(let index=0;index<40;index++){const bit=color(rect.left+PADDING+(index+.5)*CELL,y);if(bit===null)return null;bits.push(bit);}
  const bytes=Array.from({length:5},(_,i)=>bits.slice(i*8,i*8+8).reduce((value,bit)=>(value<<1)|bit,0));
  if(bytes[0]!==SYNC||bytes[4]!==crc8(bytes.slice(1,4))||bytes[3]===0)return null;
  return {session:(bytes[1]<<8)|bytes[2],sequence:bytes[3]};
}

export function createSourceMarkerProbe({sendSourceCommand,now=()=>performance.now(),epochNow=()=>performance.timeOrigin+performance.now(),wallNow=Date.now,
  requestAnimationFrame,cancelAnimationFrame,isVisible,isOnscreen,shortcutsOff,isMonitoring,setTimer=setTimeout,clearTimer=clearTimeout,
  onProgress=()=>{},onComplete=()=>{},intervalMs=200,durationMs=30000,maxRttMs=2000,maxSamples=200,session,markerId}={}){
  if([sendSourceCommand,now,epochNow,wallNow,requestAnimationFrame,cancelAnimationFrame,isVisible,isOnscreen,shortcutsOff,isMonitoring,setTimer,clearTimer,onProgress,onComplete].some(fn=>typeof fn!=='function'))throw TypeError('Source, clocks, timers, visibility and safety callbacks are required');
  if(!finite(intervalMs)||intervalMs<100||!finite(durationMs)||durationMs<1||durationMs>30000||!finite(maxRttMs)||maxRttMs<1||!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>600)throw TypeError('Invalid marker probe limits');
  const code=session??Math.floor(Math.random()*65536),id=markerId??'arrow-source-marker-'+wallNow().toString(36)+'-'+code.toString(16)+'-'+Math.random().toString(36).slice(2,9);
  sourceMarkerBits(code,1);if(!/^arrow-source-marker-[a-zA-Z0-9_-]{1,70}$/.test(id))throw TypeError('Invalid marker id');
  let active=false,used=false,sequence=0,startedAt=null,endedAt=null,reason='NOT_STARTED',tickTimer=null,deadlineTimer=null,pendingRender=null,inflight=null,stopping=null,sourceContext=null,geometry=null,cleanup='NOT_INSTALLED';
  const records=new Map(),samples=[],discarded={},errors=[],geometryHistory=[];let sourceCommands=0,decodedFrames=0;
  const count=key=>{discarded[key]=(discarded[key]??0)+1;};
  const notify=()=>{try{onProgress(snapshot());}catch{}};
  function cancelRender(){const work=pendingRender;pendingRender=null;if(work)for(const handle of work.handles)try{cancelAnimationFrame(handle);}catch{}}
  function gates(){try{return !shortcutsOff()?'SHORTCUTS_NOT_OFF':!isMonitoring()?'MONITORING_STOPPED':null;}catch{return 'SAFETY_CHECK_FAILED';}}
  function observable(){try{return !isVisible()?'HIDDEN':!isOnscreen()?'OFFSCREEN':null;}catch{return 'VISIBILITY_CHECK_FAILED';}}
  function bounded(promise){
    let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimer(()=>reject(Error('SOURCE_COMMAND_TIMEOUT')),maxRttMs);})]).finally(()=>clearTimer(timer));
  }
  async function removeOwn(){
    try{const result=await bounded(Promise.resolve().then(()=>sendSourceCommand({operation:'remove',markerId:id})));cleanup=result?.absent===true?'REMOVED':'REMOVAL_UNVERIFIED';}
    catch(error){cleanup='REMOVAL_FAILED';errors.push(String(error?.message??error).slice(0,160));}
  }
  function finalize(record){
    const work=record.work;if(!record.calibration||work?.secondPaintOpportunityAt==null||record.finalized)return;
    record.finalized=true;
    const {beforeAt,afterAt}=record.calibration;
    if(![work.receivedAt,work.mutationAt,work.firstPaintOpportunityAt,work.secondPaintOpportunityAt].every(finite)||work.receivedAt<beforeAt||work.firstPaintOpportunityAt<work.mutationAt||work.secondPaintOpportunityAt<work.firstPaintOpportunityAt){count('INVALID_SAMPLE_CLOCK');return;}
    const sample={session:code,sequence:record.sequence,frameId:work.frameId??null,source:copy(record.calibration),frameReceivedAt:work.receivedAt,markerDecodedAt:work.decodedAt,resultMutationObservedAt:work.mutationAt,firstPaintOpportunityAt:work.firstPaintOpportunityAt,secondPaintOpportunityAt:work.secondPaintOpportunityAt,
      sourceMutationToFrameLowerMs:Math.max(0,work.receivedAt-afterAt),sourceMutationToFrameUpperMs:work.receivedAt-beforeAt,
      sourceMutationToPaintLowerMs:Math.max(0,work.firstPaintOpportunityAt-afterAt),sourceMutationToPaintUpperMs:work.secondPaintOpportunityAt-beforeAt,
      frameReceiptToMutationMs:work.mutationAt-work.receivedAt,frameReceiptToPaintLowerMs:work.firstPaintOpportunityAt-work.receivedAt,frameReceiptToPaintUpperMs:work.secondPaintOpportunityAt-work.receivedAt};
    samples.push(sample);if(samples.length>maxSamples)samples.shift();notify();
  }
  async function tick(){
    if(!active)return;const blocked=gates();if(blocked){void stop(blocked);return;}
    if(sequence>=255){void stop('SEQUENCE_LIMIT');return;}
    const seq=++sequence,beforeAt=now(),beforeEpoch=epochNow(),record={sequence:seq,calibration:null,geometry,work:null,finalized:false};records.set(seq,record);
    const operation=Promise.resolve().then(()=>sendSourceCommand({operation:'put',markerId:id,session:code,sequence:seq}));inflight=operation;
    try{
      const result=await bounded(operation),afterAt=now(),afterEpoch=epochNow();
      if(!active)return;
      if(result?.markerId!==id||result?.session!==code||result?.sequence!==seq||!finite(result?.mutationEpoch)||!finite(result?.sourceTimeOrigin)||!finite(beforeAt)||!finite(afterAt)||afterAt<beforeAt||afterAt-beforeAt>maxRttMs||!finite(beforeEpoch)||!finite(afterEpoch)||afterEpoch<beforeEpoch||Math.abs((afterEpoch-beforeEpoch)-(afterAt-beforeAt))>100)throw Error('INVALID_SOURCE_CALIBRATION');
      if(!result.rect||!result.viewport||!['left','top','width','height'].every(key=>finite(result.rect[key]))||result.rect.left<0||result.rect.top<0||Math.abs(result.rect.width-WIDTH)>.5||Math.abs(result.rect.height-HEIGHT)>.5||!finite(result.viewport.width)||!finite(result.viewport.height)||result.viewport.width<1||result.viewport.height<1||result.rect.left+WIDTH>result.viewport.width||result.rect.top+HEIGHT>result.viewport.height)throw Error('INVALID_SOURCE_MARKER_GEOMETRY');
      const context=result.sourceUrl+'|'+result.sourceTimeOrigin;if(sourceContext!==null&&sourceContext!==context)throw Error('SOURCE_CONTEXT_CHANGED');sourceContext=context;
      geometry={rect:copy(result.rect),viewport:copy(result.viewport)};record.geometry=geometry;
      const geometryKey=JSON.stringify(geometry),knownGeometry=geometryHistory.findIndex(item=>item.key===geometryKey);if(knownGeometry>=0)geometryHistory.splice(knownGeometry,1);geometryHistory.unshift({key:geometryKey,value:geometry});if(geometryHistory.length>2)geometryHistory.pop();
      record.calibration={beforeAt,afterAt,beforeEpoch,afterEpoch,sourceMutationEpoch:result.mutationEpoch,sourceTimeOrigin:result.sourceTimeOrigin,sourceUrl:result.sourceUrl,
        sourceClockOffsetLowerMs:result.mutationEpoch-afterEpoch,sourceClockOffsetUpperMs:result.mutationEpoch-beforeEpoch,calibrationWidthMs:afterAt-beforeAt};
      cleanup='INSTALLED';sourceCommands++;finalize(record);notify();
    }catch(error){if(active){errors.push(String(error?.message??error).slice(0,160));void stop('SOURCE_COMMAND_FAILED');}}
    finally{
      if(inflight===operation)inflight=null;
      if(!active)void operation.then(()=>removeOwn(),()=>{});
      else tickTimer=setTimer(()=>{void tick();},intervalMs);
    }
  }
  function onFrame(image,{frameId,receivedAt=now(),resultRendered=false}={}){
    if(!active)return false;const blocked=gates();if(blocked){void stop(blocked);return false;}
    if(resultRendered!==true){count('RESULT_NOT_RENDERED');return false;}
    const hidden=observable();if(hidden){count(hidden);return false;}
    const mutationAt=now();if(!finite(receivedAt)||receivedAt>mutationAt||mutationAt-receivedAt>10000){count('INVALID_FRAME_CLOCK');return false;}
    let decoded=null;for(const candidate of geometryHistory){decoded=decodeSourceMarker(image,candidate.value);if(decoded)break;}
    if(!decoded||decoded.session!==code){count('MARKER_NOT_DECODED');return false;}
    const record=records.get(decoded.sequence);if(!record||record.work||record.finalized){count('DUPLICATE_OR_UNKNOWN_MARKER');return false;}
    decodedFrames++;if(pendingRender){count('SUPERSEDED_RENDER');pendingRender.record.finalized=true;cancelRender();}
    const work={record,frameId,receivedAt,decodedAt:now(),mutationAt,handles:[],firstPaintOpportunityAt:null,secondPaintOpportunityAt:null};record.work=work;pendingRender=work;
    function validate(){if(!active||pendingRender!==work)return false;const blocked=gates();if(blocked){void stop(blocked);return false;}const hidden=observable();if(hidden){count(hidden);record.finalized=true;cancelRender();return false;}return true;}
    const schedulingFailed=()=>{count('ANIMATION_CALLBACK_FAILED');record.finalized=true;cancelRender();};
    try{work.handles.push(requestAnimationFrame(()=>{
      if(!validate())return;work.firstPaintOpportunityAt=now();
      try{work.handles.push(requestAnimationFrame(()=>{if(!validate())return;work.secondPaintOpportunityAt=now();pendingRender=null;finalize(record);}));}catch{schedulingFailed();}
    }));}catch{schedulingFailed();return false;}return true;
  }
  function snapshot(){
    const summary=key=>{const values=samples.map(sample=>sample[key]).filter(finite).sort((a,b)=>a-b);return {count:values.length,p50Ms:values.length?values[Math.ceil(values.length*.5)-1]:null,p95Ms:values.length?values[Math.ceil(values.length*.95)-1]:null,maxMs:values.at(-1)??null};};
    return {schemaVersion:1,kind:'SOURCE_DOM_MARKER_TO_CAPTURED_RESULT_PAINT',active,reason,session:code,markerId:id,startedAt,endedAt,intervalRequestedMs:intervalMs,durationLimitMs:durationMs,sourceCommands,decodedFrames,sampleCount:samples.length,cleanup,
      scope:'Temporary source DOM marker mutation, decoded from captured images, to the actual result DOM update and two browser paint opportunities. Source mutation is bracketed by a per-command receiver-clock round trip.',
      directCaptureInstantMeasured:false,marketToDisplayMeasured:false,physicalDisplayMeasured:false,clockSynchronizationAssumed:false,
      calibrationMethod:'For each command, source epoch s and local performance-epoch before/after b/a bound source-minus-receiver clock offset to [s-a,s-b]. No Pine clock or NTP assumption is used.',
      metrics:{sourceMutationToFrameLowerMs:summary('sourceMutationToFrameLowerMs'),sourceMutationToFrameUpperMs:summary('sourceMutationToFrameUpperMs'),sourceMutationToPaintLowerMs:summary('sourceMutationToPaintLowerMs'),sourceMutationToPaintUpperMs:summary('sourceMutationToPaintUpperMs'),frameReceiptToPaintUpperMs:summary('frameReceiptToPaintUpperMs')},discarded:{...discarded},errors:[...errors],samples:copy(samples),
      limitations:['The marker measures source-DOM visual propagation, not the timestamp of the screen-capture operation or a market event.','Per-command round-trip uncertainty widens the bounds; no cross-context clock offset is treated as exact.','Only frames whose candle-result DOM was actually updated and fully visible are sampled.','Frames before the first successful geometry response cannot be decoded; a decoded frame is not asserted to be the first possible capture.','Two animation-frame callbacks bracket browser rendering opportunities, not physical display photons.','An owned source-side expiry removes the marker after30seconds if panel cleanup cannot arrive.']};
  }
  function start(){
    if(used)throw Error('MARKER_PROBE_ALREADY_USED');const blocked=gates();if(blocked)throw Error(blocked);
    used=true;active=true;startedAt=now();reason='RUNNING';deadlineTimer=setTimer(()=>{void stop('COMPLETE');},durationMs);void tick();return {session:code,markerId:id};
  }
  function stop(why='STOPPED'){
    if(stopping)return stopping;if(!used)return Promise.resolve(snapshot());
    active=false;reason=why;endedAt=now();clearTimer(tickTimer);clearTimer(deadlineTimer);cancelRender();
    stopping=(async()=>{const operation=inflight;if(operation)try{await bounded(operation);}catch{count('PENDING_SOURCE_COMMAND_AT_STOP');}await removeOwn();const report=snapshot();try{onComplete(copy(report));}catch{}return report;})();return stopping;
  }
  return {start,onFrame,stop,snapshot};
}
