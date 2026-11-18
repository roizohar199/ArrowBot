// Wake notifications carry no prices or trading instructions. Every wake still
// requires the ordinary source read, coherence, freshness and account gates.
export const WINDOW_WAKE_KIND='ARROW_WINDOW_WAKE_V1';
const finite=Number.isFinite,integer=Number.isSafeInteger;
const bounded=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const summary=input=>{const values=input.filter(finite).sort((a,b)=>a-b),n=values.length;return {count:n,p50Ms:n?values[Math.ceil(n*.5)-1]:null,p95Ms:n?values[Math.ceil(n*.95)-1]:null,maxMs:n?values.at(-1):null};};

export function validateWindowWakeMessage(message,sender,{extensionId,tabId,sessionId}={}){
  const fail=reason=>({valid:false,reasonCodes:[reason]});
  if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).some(key=>!['kind','schemaVersion','sessionId','runEpoch','sourceSequence'].includes(key))||message.kind!==WINDOW_WAKE_KIND||message.schemaVersion!==1||!bounded(message.sessionId,200)||!integer(message.runEpoch)||message.runEpoch<1577836800000||!integer(message.sourceSequence)||message.sourceSequence<0)return fail('INVALID_WINDOW_WAKE_MESSAGE');
  if(!bounded(extensionId,200)||sender?.id!==extensionId||!integer(tabId)||sender?.tab?.id!==tabId||sender?.frameId!==0)return fail('WINDOW_WAKE_SENDER_MISMATCH');
  if(message.sessionId!==sessionId)return fail('WINDOW_WAKE_SESSION_MISMATCH');
  try{const url=new URL(sender.url??sender.tab.url);if(url.protocol!=='https:'||!(url.hostname==='tradingview.com'||url.hostname.endsWith('.tradingview.com'))||!url.pathname.startsWith('/chart/'))return fail('WINDOW_WAKE_SOURCE_URL_MISMATCH');}catch{return fail('WINDOW_WAKE_SOURCE_URL_MISMATCH');}
  return {valid:true,wake:{...message},reasonCodes:[]};
}

// Self-contained isolated-world install/read/stop command. notify() may only be
// called by the owned reader's active MutationObserver, after its evidence cache
// and source appearance records have been committed. There is no DOM listener
// listeners for chart data. A single trailing timer retains only the last
// observer-validated hint; the reader supplies its 60-second real-RPC lease.
export function windowWakeSourceCommand({action='install',sessionId='',minIntervalMs=40}={}){
  const key='__arrowWindowWakeV1',existing=globalThis[key];
  if(action==='stop'){if(existing?.sessionId===sessionId){existing.stop();delete globalThis[key];}return {status:'STOPPED'};}
  if(action==='read')return existing?.sessionId===sessionId?existing.read():{status:'UNAVAILABLE',reasonCodes:['WINDOW_WAKE_NOT_INSTALLED']};
  if(action!=='install'||typeof sessionId!=='string'||!sessionId||sessionId.length>200||!Number.isFinite(minIntervalMs)||minIntervalMs<0||minIntervalMs>1000)return {status:'INVALID',reasonCodes:['INVALID_WINDOW_WAKE_INSTALL']};
  if(location.protocol!=='https:'||!(location.hostname==='tradingview.com'||location.hostname.endsWith('.tradingview.com'))||!location.pathname.startsWith('/chart/'))return {status:'UNAVAILABLE',reasonCodes:['TRADINGVIEW_CHART_REQUIRED']};
  existing?.stop();
  const api=typeof chrome!=='undefined'&&chrome.runtime?.sendMessage?chrome.runtime:null,samples=[],maxPendingAgeMs=1000,counts={attempted:0,sent:0,acknowledged:0,unacknowledged:0,failed:0,throttled:0,busy:0,rejected:0,trailingSent:0,pendingDropped:0};
  let stopped=false,inFlight=false,lastSentAt=null,lastSequence=null,lastEpoch=null,lastClosedTime=null,lastProducerAt=null,lastProducerIntervalMs=null,lastFailure=null,pending=null,trailingTimer=null,trailingDueAt=null;
  const record=(outcome,frame,at)=>{samples.push({outcome,at,runEpoch:frame?.runEpoch??null,sourceSequence:frame?.sequence??null});if(samples.length>64)samples.shift();};
  const cancelTimer=()=>{if(trailingTimer!==null)clearTimeout(trailingTimer);trailingTimer=null;trailingDueAt=null;};
  const dropPending=(reason,at=performance.now())=>{cancelTimer();if(pending){counts.pendingDropped++;record(reason,pending,at);pending=null;}};
  const validContext=(owned,evidence,frame,at)=>!stopped&&globalThis[key]===state&&!!api&&owned?.sessionId===sessionId&&owned.active===true&&Number.isFinite(owned.lastRealPollPerf)&&at>=owned.lastRealPollPerf&&at-owned.lastRealPollPerf<60000&&document.visibilityState==='visible'&&document.hidden!==true&&evidence?.status==='OK'&&!evidence?.resetRequired&&Array.isArray(evidence.messages)&&evidence.messages.length>0&&frame?.coherent===true&&frame?.checksumsVerified===true&&Number.isSafeInteger(frame.sequence)&&frame.sequence>=0&&Number.isSafeInteger(frame.runEpoch)&&frame.runEpoch>=1577836800000;
  const priority=candidate=>lastEpoch===candidate.runEpoch&&Number.isSafeInteger(candidate.closedTime)&&lastClosedTime!==null&&candidate.closedTime>lastClosedTime;
  const waitFor=candidate=>lastEpoch!==candidate.runEpoch||priority(candidate)||lastSentAt===null?0:Math.max(0,lastSentAt+minIntervalMs-performance.now());
  function queueTimer(wait){cancelTimer();trailingDueAt=performance.now()+wait;trailingTimer=setTimeout(()=>{trailingTimer=null;trailingDueAt=null;flushPending();},wait);}
  function flushPending(){
    if(!pending)return false;
    const at=performance.now(),owned=globalThis.__arrowWindowFeedV2,evidence=owned?.latestEvidence,frame=evidence?.windowFrame,candidate=pending;
    // Only a candidate accepted inside the real observer can reach this path.
    // Timers/ACKs must still match the current owned source, coherent cache,
    // visibility and lease; they cannot manufacture a new observation.
    if(owned!==candidate.owned||!validContext(owned,evidence,frame,at)||frame.runEpoch!==candidate.runEpoch||frame.sequence!==candidate.sequence||at-candidate.observedAt>=maxPendingAgeMs){dropPending('PENDING_CONTEXT_EXPIRED',at);return false;}
    if(lastEpoch===candidate.runEpoch&&lastSequence!==null&&candidate.sequence<=lastSequence){dropPending('PENDING_DUPLICATE_OR_OLD',at);return false;}
    if(inFlight){queueTimer(Math.max(0,maxPendingAgeMs-(at-candidate.observedAt)));return false;}
    const wait=waitFor(candidate);if(wait>0){queueTimer(wait);return false;}
    cancelTimer();pending=null;return send(candidate,at,true);
  }
  function send(candidate,at,trailing=false){
    const urgent=priority(candidate);dropPending('PENDING_SUPERSEDED',at);
    if(lastEpoch===candidate.runEpoch&&Number.isFinite(lastProducerAt)&&Number.isFinite(candidate.sourceEmittedAt)&&candidate.sourceEmittedAt>=lastProducerAt)lastProducerIntervalMs=candidate.sourceEmittedAt-lastProducerAt;
    else lastProducerIntervalMs=null;
    lastEpoch=candidate.runEpoch;lastSequence=candidate.sequence;lastClosedTime=Number.isSafeInteger(candidate.closedTime)?candidate.closedTime:null;lastProducerAt=candidate.sourceEmittedAt;lastSentAt=at;inFlight=true;
    const message={kind:'ARROW_WINDOW_WAKE_V1',schemaVersion:1,sessionId,runEpoch:candidate.runEpoch,sourceSequence:candidate.sequence};counts.sent++;if(trailing)counts.trailingSent++;record(urgent?'SENT_CLOSED_BAR_PRIORITY':trailing?'SENT_TRAILING':'SENT',candidate,at);
    try{api.sendMessage(message,response=>{inFlight=false;const error=api.lastError;if(error){counts.failed++;lastFailure=String(error.message??error).slice(0,200);}else if(response?.ok===true)counts.acknowledged++;else counts.unacknowledged++;flushPending();});return true;}catch(error){inFlight=false;counts.failed++;lastFailure=String(error?.message??error).slice(0,200);flushPending();return false;}
  }
  const onVisibility=()=>{if(document.visibilityState!=='visible'||document.hidden===true)dropPending('PENDING_DOCUMENT_HIDDEN');};
  const state={sessionId,stop(){stopped=true;dropPending('PENDING_STOPPED');document.removeEventListener?.('visibilitychange',onVisibility);},read(){return {status:stopped?'STOPPED':api?'INSTALLED':'UNAVAILABLE',sessionId,apiAvailable:!!api,minIntervalMs,inFlight,counts:{...counts},pending:pending?{runEpoch:pending.runEpoch,sourceSequence:pending.sequence,observedAt:pending.observedAt}:null,trailingDueAt,maxPendingAgeMs,lastSequence,lastEpoch,lastClosedTime,lastProducerIntervalMs,lastFailure,retainedSamples:samples.length,maxSamples:64,samples:samples.map(sample=>({...sample})),scope:'Small wake hints only. One observer-validated trailing hint expires after1000ms and is cancelled when hidden/stopped or when source ownership, cache or RPC lease changes. Producer intervals use the producer clock; notification times use this source performance clock and are not cross-clock network latency.'};},notify(){
    const owned=globalThis.__arrowWindowFeedV2,evidence=owned?.latestEvidence,frame=evidence?.windowFrame,at=performance.now();counts.attempted++;
    if(owned?.inObserverCallback!==true||!validContext(owned,evidence,frame,at)){counts.rejected++;record('REJECTED_CONTEXT',frame,at);if(owned?.inObserverCallback===true)dropPending('PENDING_CONTEXT_INVALID',at);return false;}
    if(lastEpoch===frame.runEpoch&&lastSequence!==null&&frame.sequence<=lastSequence){counts.rejected++;record('DUPLICATE_OR_OLD_SEQUENCE',frame,at);return false;}
    const candidate={owned,sequence:frame.sequence,runEpoch:frame.runEpoch,sourceEmittedAt:frame.sourceEmittedAt,closedTime:frame.current?.closed===true?frame.current.closeTime:frame.previous?.closeTime??null,observedAt:at};
    if(pending?.runEpoch===candidate.runEpoch&&pending.sequence>=candidate.sequence)return false;
    if(inFlight){pending=candidate;counts.busy++;record('COALESCED_INFLIGHT_MESSAGE',frame,at);queueTimer(maxPendingAgeMs);return false;}
    const wait=waitFor(candidate);if(wait>0){pending=candidate;counts.throttled++;record('THROTTLED',frame,at);queueTimer(wait);return false;}
    return send(candidate,at);
  }};
  globalThis[key]=state;document.addEventListener?.('visibilitychange',onVisibility);return state.read();
}

// One in-flight read and one coalesced pending request. The result of EVERY
// attempt is retained (including no-fresh-data, warmup and failures). The
// fallback is independent of producer timestamps and never changes clocks.
export function createLiveWindowPollScheduler({run,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,fallbackMs=50,healthyFallbackMs=250,wakeHealthyMs=10000,maxSamples=3000,onError=()=>{}}={}){
  if(typeof run!=='function'||[now,setTimer,clearTimer,onError].some(value=>typeof value!=='function')||!finite(fallbackMs)||fallbackMs<1||fallbackMs>1000||!finite(healthyFallbackMs)||healthyFallbackMs<fallbackMs||healthyFallbackMs>2000||!finite(wakeHealthyMs)||wakeHealthyMs<healthyFallbackMs||wakeHealthyMs>60000||!integer(maxSamples)||maxSamples<1||maxSamples>10000)throw TypeError('INVALID_WINDOW_POLL_SCHEDULER');
  let active=false,sessionId=null,generation=0,serial=0,timer=null,running=null,pending=null,lastWakeAt=null,lastWakeEpoch=null,lastWakeSequence=null,lastSource=null;
  const samples=[],events=[],sourceIntervals=[],counts={started:0,completed:0,errors:0,wakes:0,coalesced:0,oldWakes:0,invalidWakes:0,transportFailures:0};
  const push=(list,item,max=maxSamples)=>{list.push(item);if(list.length>max)list.splice(0,list.length-max);};
  const event=(type,extra={})=>push(events,{type,at:now(),generation,...extra});
  const cancelTimer=reason=>{if(timer){clearTimer(timer.handle);event('TIMER_CANCELLED',{reason,cause:timer.cause,scheduledAt:timer.scheduledAt,dueAt:timer.dueAt});timer=null;}};
  const delay=at=>lastWakeAt!==null&&at-lastWakeAt<=wakeHealthyMs?Math.min(healthyFallbackMs,Math.max(fallbackMs,wakeHealthyMs-(at-lastWakeAt))):fallbackMs;
  const boundedResult=result=>{
    if(typeof result==='string')return {outcome:result.slice(0,160)};
    if(!result||typeof result!=='object')return {outcome:'RETURNED'};
    const value={};
    for(const key of ['outcome','status','readStartedAtWall','readFinishedAt','sourceFrameSequence','readMs','processingMs','analysisMs','acceptedPackets','processedPackets','newlyClosedBars','onscreen'])if(typeof result[key]==='boolean'||finite(result[key])||typeof result[key]==='string')value[key]=typeof result[key]==='string'?result[key].slice(0,160):result[key];
    for(const key of ['reasonCodes','sourcePacketIds'])if(Array.isArray(result[key]))value[key]=result[key].slice(0,8).map(item=>String(item).slice(0,240));
    if(result.visibility&&typeof result.visibility==='object')value.visibility=Object.fromEntries(Object.entries(result.visibility).slice(0,16).filter(([,item])=>typeof item==='boolean'||finite(item)||typeof item==='string').map(([key,item])=>[key.slice(0,80),typeof item==='string'?item.slice(0,160):item]));
    value.outcome??=value.status??'RETURNED';return value;
  };
  function schedule(request,wait=0){
    if(!active)return false;
    if(running){if(pending)counts.coalesced++;pending={...request,firstQueuedAt:pending?.firstQueuedAt??pending?.wakeReceivedAt??request.wakeReceivedAt??now()};event('REQUEST_COALESCED',{cause:request.cause});return true;}
    cancelTimer('REPLACED');const scheduledAt=now(),dueAt=scheduledAt+Math.max(0,wait),token={...request,generation,scheduledAt,dueAt};
    // A real source/focus event is already executing on the receiving thread.
    // Sending it through setTimeout(0) would reintroduce hidden-page timer
    // clamping. execute() reserves running before awaiting the source RPC.
    if(wait===0){event('IMMEDIATE_DISPATCH',{cause:token.cause,scheduledAt,dueAt});void execute(token,scheduledAt);return true;}
    token.handle=setTimer(()=>{if(timer!==token)return;timer=null;const firedAt=now();if(!active||token.generation!==generation){event('TIMER_IGNORED',{cause:token.cause});return;}void execute(token,firedAt);},Math.max(0,wait));timer=token;event('TIMER_SCHEDULED',{cause:token.cause,scheduledAt,dueAt});return true;
  }
  async function execute(request,firedAt){
    if(running){schedule(request);return;}
    const attempt={attemptId:++serial,generation,sessionId,cause:request.cause,scheduledAt:request.scheduledAt,dueAt:request.dueAt,timerFiredAt:firedAt,startedAt:now(),wakeReceivedAt:request.wakeReceivedAt??null,firstQueuedAt:request.firstQueuedAt??request.wakeReceivedAt??null,wakeRunEpoch:request.runEpoch??null,wakeSourceSequence:request.sourceSequence??null};
    running=attempt;counts.started++;event('ATTEMPT_STARTED',{attemptId:attempt.attemptId,cause:attempt.cause});let result,error=null;
    try{result=await run(Object.freeze({...attempt}));}catch(thrown){error=String(thrown?.message??thrown).slice(0,240);counts.errors++;try{onError(thrown);}catch{}}
    const finishedAt=now(),stale=attempt.generation!==generation||!active;
    const sample={...attempt,finishedAt,timerLatenessMs:Math.max(0,attempt.timerFiredAt-attempt.dueAt),dispatchWaitMs:Math.max(0,attempt.startedAt-attempt.timerFiredAt),wakeQueueMs:attempt.wakeReceivedAt===null?null:Math.max(0,attempt.startedAt-attempt.wakeReceivedAt),coalescedQueueMs:attempt.firstQueuedAt===null?null:Math.max(0,attempt.startedAt-attempt.firstQueuedAt),runtimeMs:Math.max(0,finishedAt-attempt.startedAt),staleCompletion:stale,result:error?{outcome:'ERROR',error}:boundedResult(result)};
    counts.completed++;push(samples,sample);event('ATTEMPT_FINISHED',{attemptId:attempt.attemptId,cause:attempt.cause,outcome:sample.result.outcome,stale});
    if(running===attempt)running=null;
    if(active){if(pending){const request=pending;pending=null;schedule(request,0);}else schedule({cause:'fallback'},delay(finishedAt));}
  }
  function request(reason='manual'){
    if(!active||!bounded(reason,80))return false;const at=now();event('INTERNAL_REQUEST',{reason});return schedule({cause:reason,wakeReceivedAt:at},0);
  }
  return {
    start(nextSession){if(!bounded(nextSession,200))throw TypeError('INVALID_WINDOW_POLL_SESSION');cancelTimer('START');generation++;active=true;sessionId=nextSession;pending=null;lastWakeAt=null;lastWakeEpoch=null;lastWakeSequence=null;lastSource=null;event('START');return schedule({cause:'connect'},0);},
    stop(reason='STOPPED'){active=false;generation++;cancelTimer(reason);pending=null;event('STOP',{reason:String(reason).slice(0,160)});},
    request,
    wake(message){
      if(!active||message?.kind!==WINDOW_WAKE_KIND||message.schemaVersion!==1||message.sessionId!==sessionId||!integer(message.runEpoch)||message.runEpoch<1577836800000||!integer(message.sourceSequence)||message.sourceSequence<0){counts.invalidWakes++;return false;}
      if(lastWakeEpoch===message.runEpoch&&lastWakeSequence!==null&&message.sourceSequence<=lastWakeSequence){counts.oldWakes++;event('OLD_WAKE_IGNORED');return false;}
      const at=now();lastWakeAt=at;lastWakeEpoch=message.runEpoch;lastWakeSequence=message.sourceSequence;counts.wakes++;event('SOURCE_WAKE',{runEpoch:message.runEpoch,sourceSequence:message.sourceSequence});return schedule({cause:'source-wake',wakeReceivedAt:at,runEpoch:message.runEpoch,sourceSequence:message.sourceSequence},0);
    },
    transportFailed(reason='WINDOW_WAKE_TRANSPORT_FAILED'){lastWakeAt=null;counts.transportFailures++;event('TRANSPORT_FAILURE',{reason:String(reason).slice(0,160)});if(active&&!running&&!pending)schedule({cause:'fallback'},fallbackMs);},
    recordSourceFrame(frame){
      const sequence=frame?.sequence??frame?.sourceSequence,sourceAt=frame?.sourceEmittedAt,epoch=frame?.runEpoch;
      if(!integer(sequence)||sequence<0||!integer(sourceAt)||!integer(epoch))return false;
      if(lastSource?.runEpoch===epoch&&sequence===lastSource.sequence)return false;
      if(lastSource?.runEpoch===epoch&&sequence>lastSource.sequence&&sourceAt>=lastSource.sourceAt)push(sourceIntervals,{runEpoch:epoch,sourceSequence:sequence,sourceSequenceDelta:sequence-lastSource.sequence,producerInterframeMs:sourceAt-lastSource.sourceAt});
      lastSource={runEpoch:epoch,sequence,sourceAt};return true;
    },
    snapshot(){const at=now();return {kind:'WINDOW_POLL_SCHEDULER_DIAGNOSTICS',active,sessionId,generation,inflight:!!running,pending:pending?{cause:pending.cause,wakeReceivedAt:pending.wakeReceivedAt??null}:null,nextDueAt:timer?.dueAt??null,nextCause:timer?.cause??null,wakeHealthy:lastWakeAt!==null&&at-lastWakeAt<=wakeHealthyMs,lastWakeAt,fallbackMs,healthyFallbackMs,wakeHealthyMs,maxSamples,retainedAttempts:samples.length,retainedEvents:events.length,counts:{...counts},metrics:{timerLatenessMs:summary(samples.map(sample=>sample.timerLatenessMs)),wakeQueueMs:summary(samples.map(sample=>sample.wakeQueueMs)),coalescedQueueMs:summary(samples.map(sample=>sample.coalescedQueueMs)),runtimeMs:summary(samples.map(sample=>sample.runtimeMs)),producerInterframeMs:summary(sourceIntervals.map(sample=>sample.producerInterframeMs))},attempts:structuredClone(samples),events:structuredClone(events),sourceIntervals:structuredClone(sourceIntervals),scope:'All attempted reads, including no-fresh/warmup/errors, on the receiving performance clock. wakeQueueMs follows the latest coalesced wake; coalescedQueueMs retains the oldest pending request. Producer interframe intervals use the separate producer clock and are not transport or network latency.'};},
  };
}
