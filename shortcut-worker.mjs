import {validShortcutDelay} from './shortcut-delay.mjs';
import {createFastPositionGuard} from './fast-position-guard.mjs';
import {isShortcutTargetUrl,listShortcutTargets,resolveShortcutTarget} from './shortcut-target.mjs';
import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';
import {normalizeChartIdentity,sameChartIdentity} from './chart-identity.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY='arrowDirectShortcut',DELAY_KEY='arrowShortcutDelayMs';
function waitForShortcutDelay(ms,signal){
 return new Promise((resolve,reject)=>{
  const finish=()=>{signal.removeEventListener('abort',cancel);resolve();};
  const timer=setTimeout(finish,ms);
  const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(Error(String(signal.reason||'CANCELLED')));};
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
 });
}

// Reads focus and the displayed symbol/interval/Replay toolbar. No market
// Depth of Market, orders, account data or chart internals are accessed.
export function readShortcutEvidence(){
 const active=document.activeElement;
 const selector='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
 const editing=!!active&&(active.matches(selector)||!!active.closest(selector));
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&!['hidden','collapse'].includes(s.visibility)&&s.opacity!=='0';};
 const dialog=[...document.querySelectorAll('[role="dialog"],dialog[open]')].some(visible);
 const documentFocused=document.hasFocus(),visibility=document.visibilityState;
 const symbol=document.querySelector?.('#header-toolbar-symbol-search');
 const interval=document.querySelector?.('#header-toolbar-intervals [role="radio"][aria-checked="true"]');
 const replay=document.querySelector?.('#header-toolbar-replay');
 const checked=replay?.getAttribute('aria-checked')??replay?.getAttribute('aria-pressed');
 const chartIdentity=symbol&&interval&&['true','false'].includes(checked)?{symbol:symbol.textContent?.trim(),interval:interval.getAttribute('data-value'),replay:checked==='true'}:null;
 return {url:location.href,focused:documentFocused&&visibility==='visible',documentFocused,visibility,editing,dialog,chartIdentity};
}

export function createShortcutWorker(api,{now=Date.now,wait=waitForShortcutDelay}={}){
 const guard=createFastPositionGuard({now});
 let state={enabled:false,sourceActive:false,delayMs:0,session:null,last:null,target:null,barrierAt:0,clientIntent:0,sourceIntent:0,chartIdentity:null,chartRevision:0,chartIdentityAvailable:false};
 let seen=new Set(),inFlight=null,busy=false,epoch=0,writes=Promise.resolve(),waiting=null,signalCompletion=null,activeSignalId=null,activeAttempted=false;
 let connection=null,recoverableInput=null,inputEpoch=0,inputQueue=Promise.resolve(),ownerTabId=null,sourceRevision=0,modeRevision=0,latestSignal=null;
 let input={connected:false,tabId:null,reason:'INPUT_NOT_CONNECTED'};
 let positionSavedKey='',positionSavedAt=-Infinity,positionDurableKey='',contextReadSerial=0,lastContextReadSerial=0;
 const snapshot=()=>({...state,target:state.target?{...state.target}:null,last:state.last?{...state.last}:null,position:guard.check(),input:{...input}});
 const save=()=>{
  const value={state:snapshot(),positionGuard:guard.snapshot(),seen:[...seen].slice(-2048),inFlight:inFlight?{...inFlight}:null,ownerTabId,inputOwner:connection?{...connection}:recoverableInput?{...recoverableInput}:null};
  const operation=writes.then(()=>api.storage.session.set({[KEY]:value})).then(()=>{positionDurableKey=JSON.stringify(value.positionGuard);});writes=operation.catch(()=>{});return operation;
 };
 const ready=(async()=>{
  const [savedValues,settings]=await Promise.all([api.storage.session.get(KEY),api.storage.local.get(DELAY_KEY)]);
  const saved=savedValues[KEY];
  ownerTabId=Number.isSafeInteger(saved?.ownerTabId)?saved.ownerTabId:null;
  if(Number.isSafeInteger(saved?.inputOwner?.tabId)&&isShortcutTargetUrl(saved.inputOwner.url)&&UUID.test(saved.inputOwner.session??''))recoverableInput={...saved.inputOwner};
  if(saved?.state&&UUID.test(saved.state.session??'')){
   const old=saved.state;
   state={enabled:old.enabled===true,sourceActive:false,delayMs:0,session:old.session,last:old.last??null,target:old.target&&Number.isSafeInteger(old.target.id)&&old.target.id>0&&isShortcutTargetUrl(old.target.url)?{...old.target}:null,barrierAt:Number.isFinite(old.barrierAt)?old.barrierAt:0,clientIntent:Number.isSafeInteger(old.clientIntent)&&old.clientIntent>=0?old.clientIntent:0,sourceIntent:Number.isSafeInteger(old.sourceIntent)&&old.sourceIntent>=0?old.sourceIntent:0};
   state.chartIdentity=normalizeChartIdentity(old.chartIdentity);state.chartRevision=Number.isSafeInteger(old.chartRevision)?old.chartRevision:0;state.chartIdentityAvailable=false;
  }
  if(validShortcutDelay(settings[DELAY_KEY]))state.delayMs=settings[DELAY_KEY];
  if(Array.isArray(saved?.seen))seen=new Set(saved.seen.filter(id=>typeof id==='string'&&UUID.test(id)).slice(-2048));
  guard.restore(saved?.positionGuard);
  if(saved?.inFlight){
   const old=saved.inFlight;
   if(UUID.test(old.id??''))seen.add(old.id);
   if(UUID.test(old.id??'')&&!guard.check().pendingId)guard.submitted({id:old.id,at:now(),tabId:old.tabId??null});
   guard.suspend('POSITION_RESTARTED');
   state.last={id:old.id??null,side:old.side??null,key:old.side==='LONG'?'Shift+B':old.side==='SHORT'?'Shift+S':null,at:now(),code:'UNCERTAIN'};
   inFlight=null;
   await save();
  }
 })();
 const response=(ok,code,extra={})=>({ok,...(code?ok?{code}:{error:code,code}:{}),state:snapshot(),...extra});
 const unchanged=token=>state.enabled&&state.sourceActive&&state.session===token.session&&epoch===token.epoch;
 const last=(m,code,delayMs=validShortcutDelay(m.capturedDelayMs)?m.capturedDelayMs:state.delayMs,timing={})=>{if(state.session===m.session)state.last={id:m.id,side:m.side,key:m.side==='LONG'?'Shift+B':'Shift+S',at:now(),code,delayMs,elapsedMs:Math.max(0,now()-m.detectedAt),keyDownAt:timing.keyDownAt??null,keyUpAt:timing.keyUpAt??null,keyDownElapsedMs:Number.isFinite(timing.keyDownAt)?Math.max(0,timing.keyDownAt-m.detectedAt):null};};
 const positionCode=position=>position.state==='PENDING'?'IGNORED_ENTRY_PENDING':position.held||['LONG','SHORT'].includes(position.state)?'IGNORED_POSITION_OPEN':position.reason==='POSITION_STALE'?'POSITION_STALE':position.reason==='POSITION_STABILIZING'?'POSITION_STABILIZING':'POSITION_UNKNOWN';
 const assertPosition=()=>{const position=guard.check();if(!position.canEnter)throw Error(positionCode(position));};
 function cancelWork(reason='CANCELLED') {const completion=waiting||activeAttempted?signalCompletion:null;epoch++;waiting?.abort(reason);return completion;}
 function suspend(reason){sourceRevision++;state.sourceActive=false;latestSignal=null;guard.suspend(reason);return cancelWork('CANCELLED');}
 const serializeInput=operation=>{const result=inputQueue.then(operation);inputQueue=result.catch(()=>{});return result;};
 async function probeOwnedInput(hint){
  if(!hint)return null;
  // getTargets().attached does not identify its owner. sendCommand is routed
  // by Chrome to THIS extension's client, so this harmless constant probe can
  // authenticate an orphaned connection without detaching another debugger.
  try{await api.debugger.sendCommand({tabId:hint.tabId},'Runtime.evaluate',{expression:'0',silent:true,returnByValue:true});return {...hint};}catch{return null;}
 }
 function disconnectInput(reason='INPUT_STOPPED',completion=null){
  inputEpoch++;input={connected:false,tabId:connection?.tabId??input.tabId,reason};
  return serializeInput(async()=>{
   if(completion)await completion;
   const attached=connection??await probeOwnedInput(recoverableInput);connection=null;recoverableInput=null;
   if(attached)try{await api.debugger.detach({tabId:attached.tabId});}catch{/* A detached input is never replayed. */}
  });
 }
 function ensureInput(){
  const selected=state.target?{...state.target}:null,session=state.session,token=inputEpoch;
  const desired=()=>state.enabled&&session===state.session&&token===inputEpoch&&selected?.id===state.target?.id&&selected?.url===state.target?.url;
  return serializeInput(async()=>{
   if(!selected)throw Error('TARGET_SELECTION_REQUIRED');
   if(!desired())throw Error('CANCELLED');
   if(connection?.tabId===selected.id&&connection.url===selected.url){input={connected:true,tabId:selected.id,reason:'INPUT_READY'};return;}
   if(connection){const old=connection;connection=null;await api.debugger.detach({tabId:old.tabId});}
   // Activation happens on the experiment page, so only validate the selected
   // chart here. Focus is checked again immediately before every actual key.
   let tab;try{tab=await api.tabs.get(selected.id);}catch{throw Error('TARGET_UNAVAILABLE');}
   if(!tab?.id)throw Error('TARGET_UNAVAILABLE');
   if(!isShortcutTargetUrl(tab.url))throw Error('NOT_TRADINGVIEW');
   if(tab.id!==selected.id||tab.url!==selected.url)throw Error('TARGET_CHANGED');
   if(!desired())throw Error('CANCELLED');
   input={connected:false,tabId:selected.id,reason:'INPUT_CONNECTING'};
   const canRecover=recoverableInput?.tabId===selected.id&&recoverableInput.url===selected.url&&recoverableInput.session===session;
   const recovered=canRecover?await probeOwnedInput(recoverableInput):null;
   recoverableInput=null;
   if(!recovered){
    try{await api.debugger.attach({tabId:selected.id},'1.3');}
    catch(error){if(!await probeOwnedInput({tabId:selected.id,url:selected.url,session}))throw error;}
   }
   if(!desired()){
    try{await api.debugger.detach({tabId:selected.id});}catch{}
    throw Error('CANCELLED');
   }
   connection={tabId:selected.id,url:selected.url,session};
   input={connected:true,tabId:selected.id,reason:'INPUT_READY'};
  }).catch(error=>{if(token===inputEpoch&&!connection)input={connected:false,tabId:selected?.id??null,reason:String(error?.message||'INPUT_UNAVAILABLE')};throw error;});
 }
 const assertInput=target=>{if(!input.connected||!connection||connection.tabId!==target.id||connection.url!==target.url)throw Error('INPUT_DISCONNECTED');};
 async function targets(){return await listShortcutTargets(api);}
 async function initializeTargets(){
  const available=await targets();
  if(!state.target){const resolved=resolveShortcutTarget(available,null);if(resolved.ok)state.target=resolved.tab;}
  else{
   const current=available.find(tab=>tab.id===state.target.id);
   if(current&&current.url!==state.target.url){const cancelled=suspend('POSITION_TARGET_CHANGED'),closed=disconnectInput('TARGET_CHANGED',cancelled);guard.clearContext('POSITION_TARGET_CHANGED');state.target=current;state.barrierAt=now();await save();await closed;}
  }
  return available;
 }
 async function applyChartIdentity(evidence){
   const identity=normalizeChartIdentity(evidence.chartIdentity),previous=state.chartIdentity;
   if(!identity){
    if(state.chartIdentityAvailable){state.chartIdentityAvailable=false;state.chartRevision++;state.sourceActive=false;state.barrierAt=now();guard.requireSync('CHART_IDENTITY_UNAVAILABLE');sourceRevision++;cancelWork('CHART_IDENTITY_UNAVAILABLE');await save();}
    return 'CHART_IDENTITY_UNAVAILABLE';
   }
   const changed=!!previous&&!sameChartIdentity(previous,identity);
   if(changed){state.chartIdentity=identity;state.chartIdentityAvailable=true;state.chartRevision++;state.sourceActive=false;state.barrierAt=now();latestSignal=null;guard.requireSync('CHART_CONTEXT_CHANGED');sourceRevision++;cancelWork('CHART_CONTEXT_CHANGED');await save();return 'CHART_CONTEXT_CHANGED';}
   if(previous&&!state.chartIdentityAvailable){state.chartIdentity=identity;state.chartIdentityAvailable=true;state.chartRevision++;state.sourceActive=false;state.barrierAt=now();latestSignal=null;guard.suspend();sourceRevision++;cancelWork('CHART_CONTEXT_CHANGED');await save();return 'CHART_CONTEXT_CHANGED';}
   if(!previous){state.chartIdentity=identity;state.chartIdentityAvailable=true;await save();}
   if(identity.replay)return 'CHART_REPLAY_ACTIVE';
   return null;
 }
 async function inspectChartContextOnly(){
  const selected=state.target?{...state.target}:null;if(!selected)return 'TARGET_SELECTION_REQUIRED';
  try{
   const tab=await api.tabs.get(selected.id);if(!tab||tab.url!==selected.url||!isShortcutTargetUrl(tab.url))return 'TARGET_CHANGED';
   const token=++contextReadSerial,results=await api.scripting.executeScript({target:{tabId:selected.id,allFrames:false},func:readShortcutEvidence});
   if(token<lastContextReadSerial)return 'STALE_FOCUS_CHECK';lastContextReadSerial=token;
   if(state.target?.id!==selected.id||state.target?.url!==selected.url)return 'TARGET_CHANGED';
   const evidence=Array.isArray(results)&&results.length===1&&results[0].frameId===0?results[0].result:null;
   if(evidence?.url!==selected.url)return 'TARGET_CHANGED';
   return await applyChartIdentity(evidence);
  }catch{return 'CHART_IDENTITY_UNAVAILABLE';}
 }
 async function inspectTargetFocus(expected){
  const selected=state.target?{...state.target}:null;
  const result={ok:false,code:'TARGET_SELECTION_REQUIRED',checkedAt:now(),stage:'TARGET',targetId:selected?.id??null,targetUrl:selected?.url??null,targetActive:null,windowFocused:null,documentFocused:null,visibility:null};
  let tab=null;
  const fail=(code,stage)=>({readiness:{...result,code,stage},tab});
  if(!selected)return fail('TARGET_SELECTION_REQUIRED','TARGET');
  try{tab=await api.tabs.get(selected.id);}catch{return fail('TARGET_UNAVAILABLE','TAB');}
  if(!tab?.id)return fail('TARGET_UNAVAILABLE','TAB');
  if(tab.id!==selected.id)return fail('TARGET_CHANGED','TAB');
  result.targetActive=tab.active===true;
  if(!isShortcutTargetUrl(tab.url))return fail('NOT_TRADINGVIEW','TAB');
  if(tab.url!==selected.url)return fail('TARGET_CHANGED','TAB');
  if(expected&&(tab.id!==expected.id||tab.windowId!==expected.windowId||tab.url!==expected.url))return fail('TARGET_CHANGED','TAB');
  if(!tab.active)return fail('TARGET_NOT_ACTIVE','TAB');
  try{
   const window=await api.windows.get(tab.windowId);
   result.windowFocused=window?.focused===true;
   if(!result.windowFocused)return fail('WINDOW_NOT_FOCUSED','WINDOW');
   const contextReadToken=++contextReadSerial;
   const results=await api.scripting.executeScript({target:{tabId:tab.id,allFrames:false},func:readShortcutEvidence});
   if(contextReadToken<lastContextReadSerial)return fail('STALE_FOCUS_CHECK','CHART');
   lastContextReadSerial=contextReadToken;
   const evidence=Array.isArray(results)&&results.length===1&&results[0].frameId===0?results[0].result:null;
   if(!evidence||evidence.url!==tab.url||!isShortcutTargetUrl(evidence.url))return fail('TARGET_CHANGED','DOCUMENT');
   result.documentFocused=evidence.documentFocused??evidence.focused===true;
   result.visibility=evidence.visibility??(evidence.focused?'visible':null);
   if(result.visibility!==null&&result.visibility!=='visible')return fail('DOCUMENT_HIDDEN','DOCUMENT');
   if(!evidence.focused||!result.documentFocused)return fail('DOCUMENT_NOT_FOCUSED','DOCUMENT');
   if(evidence.editing||evidence.dialog)return fail('EDITING','DOCUMENT');
   const chartCode=await applyChartIdentity(evidence);if(chartCode)return fail(chartCode,'CHART');
   return {readiness:{...result,ok:true,code:'FOCUS_READY',stage:'READY'},tab};
  }catch(error){return {readiness:{...result,code:'FOCUS_CHECK_FAILED',stage:'DOCUMENT',detail:String(error?.message??error).slice(0,180)},tab};}
 }
 async function focusedTarget(expected){
  const {readiness,tab}=await inspectTargetFocus(expected);
  if(!readiness.ok){
   if(readiness.code==='TARGET_CHANGED'&&tab?.id===state.target?.id&&isShortcutTargetUrl(tab.url)&&tab.url!==state.target.url){const cancelled=suspend('POSITION_TARGET_CHANGED');void disconnectInput('TARGET_CHANGED',cancelled);guard.clearContext('POSITION_TARGET_CHANGED');state.target={id:tab.id,url:tab.url,title:tab.title||'TradingView',windowId:tab.windowId};state.barrierAt=now();await save();}
   throw Error(['TARGET_NOT_ACTIVE','WINDOW_NOT_FOCUSED','DOCUMENT_NOT_FOCUSED','DOCUMENT_HIDDEN'].includes(readiness.code)?'NOT_FOCUSED':readiness.code);
  }
  return {id:tab.id,windowId:tab.windowId,url:tab.url};
 }
 async function signal(m){
  if(!UUID.test(m.id??'')||!['LONG','SHORT'].includes(m.side)||!Number.isFinite(m.detectedAt)||!Number.isFinite(m.firstSeenAt)||m.firstSeenAt>m.detectedAt||m.detectedAt>now())return response(false,'INVALID_SIGNAL');
  if(m.capturedDelayMs!==undefined&&!validShortcutDelay(m.capturedDelayMs))return response(false,'INVALID_DELAY');
  if(m.sourceIntent!==undefined&&(!Number.isSafeInteger(m.sourceIntent)||m.sourceIntent<0))return response(false,'INVALID_SIGNAL');
  if(seen.has(m.id))return response(true,'IGNORED_DUPLICATE');
  if(!state.enabled)return response(false,'DISABLED');
  seen.add(m.id);if(seen.size>2048)seen.delete(seen.values().next().value);
  const skip=async code=>{last(m,code);await save();return response(false,code);};
  if(!state.sourceActive)return await skip('SOURCE_STOPPED');
  if(m.sourceIntent!==undefined&&m.sourceIntent!==state.sourceIntent)return await skip('STALE_SOURCE_INTENT');
  if(!state.target)return await skip('TARGET_SELECTION_REQUIRED');
  const barrier=Math.max(state.barrierAt,guard.check().barrierAt??0);
  if(m.firstSeenAt<=barrier)return await skip('IGNORED_BEFORE_SOURCE_CHANGE');
  if(latestSignal&&latestSignal.id!==m.id&&latestSignal.firstSeenAt>=m.firstSeenAt)return await skip('SIGNAL_SUPERSEDED');
  if(busy){last(m,'IGNORED_BUSY');await save();return response(true,'IGNORED_BUSY');}
  if(!guard.check().canEnter)return await skip(positionCode(guard.check()));
  const delayMs=validShortcutDelay(m.capturedDelayMs)?m.capturedDelayMs:state.delayMs,dueAt=m.detectedAt+delayMs;
  let finishSignal;
  const completion=new Promise(resolve=>{finishSignal=resolve;});signalCompletion=completion;
  busy=true;activeSignalId=m.id;activeAttempted=false;
  const token={session:state.session,epoch};let target=null,attempted=false,key='',released=false,code='CANCELLED',ok=false,keyDownAt=null,keyUpAt=null;
  try{
   await save();
   if(!unchanged(token))throw Error('CANCELLED');
   assertPosition();
   if(now()<dueAt){
    const controller=new AbortController();waiting=controller;
    let cancel;
    const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Error(String(controller.signal.reason||'CANCELLED')));controller.signal.addEventListener('abort',cancel,{once:true});});
    try{while(now()<dueAt){await Promise.race([wait(dueAt-now(),controller.signal),cancelled]);if(!unchanged(token))throw Error('CANCELLED');}}
    finally{controller.signal.removeEventListener('abort',cancel);if(waiting===controller)waiting=null;}
   }
   assertPosition();target=await focusedTarget();
   if(!unchanged(token))throw Error('CANCELLED');
   assertPosition();
   assertInput(target);
   if(!unchanged(token))throw Error('CANCELLED');
   assertPosition();await focusedTarget(target);
   if(!unchanged(token))throw Error('CANCELLED');
   assertPosition();assertInput(target);key=m.side==='LONG'?'B':'S';
   guard.submitted({id:m.id,at:now(),tabId:target.id,attempted:false});
   inFlight={session:m.session,id:m.id,side:m.side,at:now(),tabId:target.id,attempted:false};await save();
   await focusedTarget(target);
   if(!unchanged(token))throw Error('CANCELLED');
   assertInput(target);
   const proof=guard.check();
   if(proof.held)throw Error('IGNORED_POSITION_OPEN');
   if(proof.pendingId!==m.id)throw Error('ENTRY_RESERVATION_CHANGED');
   if(proof.observedState!=='FLAT'||!Number.isFinite(proof.capturedAt)||now()-proof.capturedAt>MAX_CAPTURE_GAP_MS)throw Error('POSITION_UNKNOWN');
   keyDownAt=now();guard.markAttempted(m.id,keyDownAt);attempted=true;activeAttempted=true;
   inFlight.at=keyDownAt;inFlight.attempted=true;
   await api.debugger.sendCommand({tabId:target.id},'Input.dispatchKeyEvent',{type:'rawKeyDown',key,code:'Key'+key,windowsVirtualKeyCode:key.charCodeAt(0),nativeVirtualKeyCode:key.charCodeAt(0),modifiers:8});
   keyUpAt=now();
   await api.debugger.sendCommand({tabId:target.id},'Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key,windowsVirtualKeyCode:key.charCodeAt(0),nativeVirtualKeyCode:key.charCodeAt(0),modifiers:8});released=true;
   if(!unchanged(token))throw Error('CANCELLED_DURING_INPUT');
   code='SENT_UNCONFIRMED';ok=true;
  }catch(error){code=attempted?'UNCERTAIN':String(error?.message||'SHORTCUT_UNAVAILABLE');}
  finally{
   if(attempted&&!released)try{keyUpAt=now();await api.debugger.sendCommand({tabId:target.id},'Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key,windowsVirtualKeyCode:key.charCodeAt(0),nativeVirtualKeyCode:key.charCodeAt(0),modifiers:8});released=true;}catch{code='UNCERTAIN';ok=false;}
   if(attempted)guard.settleAttempt(m.id,now());
   if(!attempted)guard.releaseUnattempted(m.id);
   if(attempted&&(!ok||!unchanged(token))){code='UNCERTAIN';ok=false;}
   if(inFlight?.id===m.id)inFlight=null;
   last(m,code,delayMs,{keyDownAt,keyUpAt});
   try{await save();}catch{state.sourceActive=false;guard.suspend('POSITION_PERSISTENCE_UNAVAILABLE');code=attempted?'UNCERTAIN':'STATE_SAVE_FAILED';ok=false;last(m,code,delayMs,{keyDownAt,keyUpAt});}
   busy=false;activeSignalId=null;activeAttempted=false;
   if(signalCompletion===completion)signalCompletion=null;
   finishSignal();
  }
  return response(ok,code);
 }
 async function handle(m,sender){
  if(sender?.id!==api.runtime.id||sender.url!==api.runtime.getURL('experiment.html'))return response(false,'UNAUTHORIZED');
  try{
   await ready;
   if(!m||!UUID.test(m.session??''))return response(false,'INVALID_SESSION');
   if(m.type==='SHORTCUT_INIT'){
    const available=await initializeTargets();
    if(state.session!==m.session){modeRevision++;const cancelled=suspend('POSITION_NEW_SESSION'),closed=disconnectInput('PAGE_SESSION_CHANGED',cancelled);state={...state,enabled:false,sourceActive:false,session:m.session,last:state.last,clientIntent:0,sourceIntent:0};ownerTabId=Number.isSafeInteger(sender.tab?.id)?sender.tab.id:null;await save();await closed;}
    else if(Number.isSafeInteger(sender.tab?.id))ownerTabId=sender.tab.id;
    return response(true,null,{targets:available});
   }
   if(m.session!==state.session)return response(false,'SESSION_CHANGED');
   if(m.type==='SHORTCUT_STATUS'){const {readiness}=await inspectTargetFocus();return response(true,null,{readiness});}
   if(m.type==='SHORTCUT_LATEST'){
    if(!UUID.test(m.id??'')||!Number.isFinite(m.firstSeenAt)||!Number.isFinite(m.detectedAt)||m.firstSeenAt>m.detectedAt||m.detectedAt>now())return response(false,'INVALID_SIGNAL');
    if(!state.enabled)return response(false,'DISABLED');
    if(m.sourceIntent!==undefined&&m.sourceIntent<state.sourceIntent)return response(false,'STALE_SOURCE_INTENT');
    if(!latestSignal||m.firstSeenAt>latestSignal.firstSeenAt||m.firstSeenAt===latestSignal.firstSeenAt&&m.detectedAt>=latestSignal.detectedAt){
      const newer=latestSignal?.id!==m.id;latestSignal={id:m.id,firstSeenAt:m.firstSeenAt,detectedAt:m.detectedAt};
      if(newer&&busy&&!activeAttempted&&activeSignalId!==m.id){const ended=cancelWork('SIGNAL_SUPERSEDED');if(ended)await ended;}
    }
    return response(true,'LATEST_SIGNAL_RECORDED');
   }
   if(m.type==='SHORTCUT_TARGETS')return response(true,null,{targets:await initializeTargets()});
   if(m.type==='SHORTCUT_TARGET'){
    const available=await targets(),selected=resolveShortcutTarget(available,m.tabId);
    if(!selected.ok)return response(false,selected.code,{targets:available});
    const changed=state.target?.id!==selected.tab.id||state.target?.url!==selected.tab.url;
    if(changed){const cancelled=suspend('POSITION_TARGET_CHANGED'),closed=disconnectInput('TARGET_CHANGED',cancelled);guard.clearContext('POSITION_TARGET_CHANGED');state.target=selected.tab;state.chartIdentity=null;state.chartIdentityAvailable=false;state.chartRevision++;state.barrierAt=now();await save();await closed;}
    return response(true,null,{targets:available});
   }
   if(m.type==='SHORTCUT_SOURCE'){
    if(typeof m.active!=='boolean')return response(false,'INVALID_CONFIGURATION');
    if(m.sourceIntent!==undefined&&(!Number.isSafeInteger(m.sourceIntent)||m.sourceIntent<0))return response(false,'INVALID_CONFIGURATION');
    if(m.sourceIntent!==undefined&&m.sourceIntent<state.sourceIntent)return response(false,'STALE_SOURCE_INTENT');
    if(m.active&&!state.target)return response(false,'TARGET_SELECTION_REQUIRED');
    if(m.active&&!state.enabled)return response(false,'DISABLED');
    const sourceIntentChanged=m.sourceIntent!==undefined&&m.sourceIntent!==state.sourceIntent;
    if(m.sourceIntent!==undefined)state.sourceIntent=m.sourceIntent;
    if(m.active&&state.sourceActive&&input.connected){if(sourceIntentChanged)await save();return response(true);}
    if(m.active){
     const chartCode=await inspectChartContextOnly();if(chartCode)return response(false,chartCode);
     const revision=++sourceRevision,session=state.session,enabled=state.enabled,target={...state.target};
     if(state.enabled)await ensureInput();
     if(revision!==sourceRevision||session!==state.session||enabled!==state.enabled||target.id!==state.target?.id||target.url!==state.target?.url)return response(false,'CANCELLED');
     state.sourceActive=true;await save();
    }
    else{const cancelled=suspend(m.ended?'POSITION_SOURCE_ENDED':'POSITION_SOURCE_PAUSED');const closed=m.ended?disconnectInput('SOURCE_ENDED',cancelled):null;await save();if(cancelled)await cancelled;if(closed)await closed;}
    return response(true);
   }
   if(m.type==='SHORTCUT_DISPOSE'){
    if(m.intent!==undefined&&(!Number.isSafeInteger(m.intent)||m.intent<0))return response(false,'INVALID_CONFIGURATION');
    if(m.intent!==undefined&&m.intent<state.clientIntent)return response(false,'STALE_CONTROL_INTENT');
    if(Number.isSafeInteger(m.intent)&&m.intent>=state.clientIntent)state.clientIntent=m.intent;
    modeRevision++;const cancelled=suspend('POSITION_SOURCE_ENDED'),closed=disconnectInput('PAGE_CLOSED',cancelled);state.enabled=false;await save();await closed;return response(true);
   }
   if(m.type==='SHORTCUT_POSITION'){
    if(!state.target||m.targetId!==state.target.id||m.targetUrl!==state.target.url)return response(false,'POSITION_TARGET_MISMATCH');
    const valid=['LONG','SHORT','FLAT','UNKNOWN'].includes(m.state)&&Number.isFinite(m.capturedAt)&&m.capturedAt<=now()&&typeof m.context==='string'&&m.context&&['string','number'].includes(typeof m.frameId);
    if(valid&&m.state==='FLAT'&&(guard.check().held||guard.check().pendingId||guard.check().syncRequired)){
     if(!state.chartIdentity)guard.requireSync('POSITION_CONTEXT_UNVERIFIED');
     const chartCode=await inspectChartContextOnly();if(chartCode){guard.suspend();await save();return response(false,chartCode);}
    }
    if(valid)guard.observe({state:m.state,capturedAt:m.capturedAt,frameId:m.frameId,context:m.context,reason:m.reason,flatProof:m.flatProof===true,autoFlatProof:m.autoFlatProof===true&&state.chartIdentityAvailable&&!state.chartIdentity?.replay&&!busy,quantity:m.quantity,quantityVerified:m.quantityVerified===true,viewChanged:m.viewChanged===true});else guard.suspend('POSITION_INVALID_FRAME');
    const position=guard.check();
    if(busy&&!activeAttempted&&position.held)cancelWork('IGNORED_POSITION_OPEN');
    const fingerprint=JSON.stringify({state:position.state,reason:position.reason,pendingId:position.pendingId,observedState:position.observedState,held:position.held,barrierAt:position.barrierAt});
    const criticalChange=JSON.stringify(guard.snapshot())!==positionDurableKey;
    if(criticalChange||fingerprint!==positionSavedKey&&now()-positionSavedAt>=50){await save();positionSavedKey=fingerprint;positionSavedAt=now();}
    return response(valid,valid?null:'INVALID_POSITION');
   }
   if(m.type==='SHORTCUT_POSITION_RESET'){
    // Old panels must not bypass the new automatic evidence path.
    return response(false,'AUTOMATIC_POSITION_CHECK');
   }
   if(m.type==='SHORTCUT_DELAY'){
    if(!validShortcutDelay(m.delayMs))return response(false,'INVALID_DELAY');
    const delayMs=m.delayMs;
    const operation=writes.then(async()=>{await api.storage.local.set({[DELAY_KEY]:delayMs});state.delayMs=delayMs;});writes=operation.catch(()=>{});
    try{await operation;await save();}catch{throw Error('DELAY_SAVE_FAILED');}
    return response(true);
   }
   if(m.type==='SHORTCUT_SET'){
    if(typeof m.enabled!=='boolean')return response(false,'INVALID_CONFIGURATION');
    if(m.intent!==undefined&&(!Number.isSafeInteger(m.intent)||m.intent<0))return response(false,'INVALID_CONFIGURATION');
    if(m.intent!==undefined&&m.intent<state.clientIntent)return response(false,'STALE_CONTROL_INTENT');
    if(m.sourceIntent!==undefined&&(!Number.isSafeInteger(m.sourceIntent)||m.sourceIntent<0))return response(false,'INVALID_CONFIGURATION');
    if(m.sourceIntent!==undefined&&m.sourceIntent<state.sourceIntent)return response(false,'STALE_SOURCE_INTENT');
    if(m.enabled&&busy)return response(false,'BUSY');
    if(m.intent!==undefined)state.clientIntent=m.intent;
    if(m.sourceIntent!==undefined)state.sourceIntent=m.sourceIntent;
    const revision=++modeRevision,session=state.session;sourceRevision++;
    const cancelled=cancelWork();state.enabled=m.enabled;
    if(!m.enabled){state.sourceActive=false;const closed=disconnectInput('USER_STOPPED',cancelled);await save();await closed;}
    else{
     try{await save();await ensureInput();if(revision!==modeRevision||session!==state.session)return response(false,'CANCELLED');await save();}
     catch(error){if(revision===modeRevision&&session===state.session&&state.enabled){state.enabled=false;state.sourceActive=false;const closed=disconnectInput('ACTIVATION_FAILED');try{await save();}catch{}await closed;}return response(false,String(error?.message||'INPUT_UNAVAILABLE'));}
    }
    return response(true);
   }
   if(m.type==='SHORTCUT_SIGNAL')return await signal(m);
   return response(false,'INVALID_MESSAGE');
  }catch(error){return response(false,String(error?.message||'SHORTCUT_UNAVAILABLE'));}
 }
 async function unexpectedDetach(source,reason){
  await ready;
  if(source?.tabId!==connection?.tabId&&!(input.reason==='INPUT_CONNECTING'&&source?.tabId===input.tabId))return;
  connection=null;recoverableInput=null;inputEpoch++;input={connected:false,tabId:source.tabId,reason:reason==='canceled_by_user'?'INPUT_STOPPED_BY_USER':'DEBUGGER_DETACHED:'+String(reason||'UNKNOWN')};
  if(reason==='canceled_by_user'){modeRevision++;state.enabled=false;}
  suspend('POSITION_INPUT_DETACHED');await save();
 }
 async function removedTab(tabId){
  await ready;
  if(tabId!==state.target?.id&&tabId!==ownerTabId)return;
  const ownerClosed=tabId===ownerTabId,cancelled=suspend(ownerClosed?'POSITION_SOURCE_ENDED':'POSITION_TARGET_CLOSED');
  if(ownerClosed){modeRevision++;state.enabled=false;}
  else{guard.clearContext('POSITION_TARGET_CLOSED');state.target=null;state.barrierAt=now();}
  const closed=disconnectInput(ownerClosed?'PAGE_CLOSED':'TARGET_CLOSED',cancelled);await save();await closed;
 }
 async function updatedTab(tabId,changeInfo,tab){
  await ready;
  if(tabId!==state.target?.id||!(changeInfo?.status==='loading'||changeInfo?.url&&changeInfo.url!==state.target.url))return;
  const cancelled=suspend('POSITION_TARGET_CHANGED'),closed=disconnectInput('TARGET_NAVIGATED',cancelled);
  guard.clearContext('POSITION_TARGET_CHANGED');state.barrierAt=now();
  const url=changeInfo.url??tab?.url;
  if(url&&isShortcutTargetUrl(url))state.target={...state.target,url,title:tab?.title??state.target.title};
  await save();await closed;
 }
 function listen(){api.runtime.onMessage.addListener((m,s,reply)=>{
  if(!String(m?.type??'').startsWith('SHORTCUT_'))return false;
  handle(m,s).then(reply).catch(()=>reply(response(false,'SHORTCUT_UNAVAILABLE')));return true;
 });
  api.debugger?.onDetach?.addListener((source,reason)=>{void unexpectedDetach(source,reason).catch(()=>{});});
  api.tabs?.onRemoved?.addListener(tabId=>{void removedTab(tabId).catch(()=>{});});
  api.tabs?.onUpdated?.addListener((tabId,changeInfo,tab)=>{void updatedTab(tabId,changeInfo,tab).catch(()=>{});});
 }
 return {handle,listen};
}
