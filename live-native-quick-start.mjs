import {readTradingViewExecutionAccount} from './tradingview-account-inspector.mjs';

const layouts=new Map([
  ['https://www.tradingview.com/chart/ARROWFR1/','Full Screens Live'],
  ['https://www.tradingview.com/chart/ARROWRV1/','Arrow OHLC Live Verification'],
]);
const WARMUP_PROGRESS_GRACE_MS=60_000;

export function readNativeStartupWarmup(evidence){
  const frame=evidence?.windowFrame,base=evidence?.history?.[0],target=frame?.historyCounts?.[0];
  if(frame?.coherent!==true||frame.checksumsVerified!==true||frame.realtime!==true||evidence?.chart?.documentVisible!==true||evidence.chart.replay!==false||
    typeof evidence.bootstrapMetadata?.runId!=='string'||base?.timeframe!=='1'||!Number.isSafeInteger(target)||target<20||target>100||
    !Number.isSafeInteger(base.retainedBars)||!Number.isSafeInteger(base.contiguousBars)||base.contiguousBars<0||base.retainedBars<base.contiguousBars)return null;
  return {runId:evidence.bootstrapMetadata.runId,target,collected:Math.min(base.retainedBars,target),contiguous:Math.min(base.contiguousBars,target)};
}

// Opens only the already-connected account panel. No broker selection, chart
// changes, preset application, numeric writes, or order action occurs here.
export function prepareNativeUserAccountPanel({provider,nativeAccountId,sourceUrl}={}){
  const base={kind:'NATIVE_USER_START_PANEL_V1',ordersCreated:false,submitted:false,layoutChanged:false,timeframeChanged:false,accountChanged:false,presetApplied:false,numericInputsSet:false};
  const result=(status,reason)=>({...base,status,reasonCodes:reason?[reason]:[]});
  const name=provider==='TRADINGVIEW_PAPER'?'Paper Trading':provider==='TRADOVATE'?'Tradovate':null;
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
  const visible=n=>{
    if(!n?.isConnected||![...n.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
    for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||['hidden','collapse'].includes(s.visibility))return false;}return true;
  };
  const all=(s,r=document)=>[...r.querySelectorAll(s)].filter(visible);
  if(!name||typeof nativeAccountId!=='string'||!nativeAccountId||nativeAccountId.length>240)return result('BLOCKED','NATIVE_ACCOUNT_PROFILE_REQUIRED');
  if(!['https://www.tradingview.com/chart/ARROWFR1/','https://www.tradingview.com/chart/ARROWRV1/'].includes(sourceUrl)||location.href!==sourceUrl||document.hidden||document.visibilityState!=='visible')return result('BLOCKED','EXACT_VISIBLE_SOURCE_REQUIRED');
  if(all('[role="dialog"],[aria-modal="true"]').length)return result('BLOCKED','NATIVE_EXISTING_DIALOG_REQUIRES_REVIEW');
  const toggles=all('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]');
  if(!toggles.length)return result('WAITING','NATIVE_ACCOUNT_PANEL_MOUNTING');
  if(toggles.length>3||toggles.some(n=>norm(n.textContent)!==name))return result('BLOCKED','SELECTED_AND_CONNECTED_PROVIDER_DIFFER');
  const managers=all('[aria-label="Account manager"]');
  if(managers.length>1)return result('BLOCKED','NATIVE_ACCOUNT_PANEL_AMBIGUOUS');
  if(!managers.length){
    const open=toggles.filter(n=>n.getAttribute('aria-label')==='Open account manager');
    if(open.length!==1)return result('WAITING','NATIVE_ACCOUNT_PANEL_MOUNTING');
    open[0].click();return result('ACTION_TAKEN','OPENED_EXISTING_ACCOUNT_PANEL');
  }
  const selectors=all('[data-qa-id="account-selector"]',managers[0]);
  const names=selectors.length===1?all('[class*="accountName-"]',selectors[0]):[];
  if(names.length!==1||!norm(names[0].textContent))return result('WAITING','NATIVE_ACCOUNT_IDENTITY_MOUNTING');
  if(norm(names[0].textContent)!==nativeAccountId)return result('BLOCKED','SELECTED_AND_VISIBLE_ACCOUNT_DIFFER');
  return result('READY');
}

export function createLiveNativeQuickStart({chrome,getSession,selectSource,connectSource,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeoutMs=180000}={}){
  let lastAttempt=null;
  const snapshot=()=>lastAttempt?structuredClone(lastAttempt):null;
  async function prepare({isCancelled=()=>false,onProgress=()=>{}}={}){
    const startedAt=now(),initial=getSession(),profile=initial.profile;
    if(profile?.enabled!==true||profile.userManagedRisk!==true||!(profile.provider==='TRADINGVIEW_PAPER'&&profile.environment==='DEMO'||profile.provider==='TRADOVATE'&&['DEMO','EVALUATION','PA','LIVE'].includes(profile.environment)))throw Error('SUPPORTED_NATIVE_ACCOUNT_PROFILE_REQUIRED');
    const profileKey=JSON.stringify(profile);let preferred=initial.preferredSourceTabId??null;
    let deadline=startedAt+timeoutMs;
    const warmupHardDeadline=startedAt+2*timeoutMs;
    const guard=()=>{
      if(isCancelled())throw Error('START_CANCELLED');
      if(now()>deadline)throw Error('NATIVE_START_TIMEOUT');
      const current=getSession();
      if(JSON.stringify(current.profile)!==profileKey)throw Error('ACCOUNT_PROFILE_CHANGED');
      if((current.preferredSourceTabId??null)!==preferred)throw Error('NATIVE_SOURCE_SELECTION_CHANGED');
    };
    if(preferred!==null&&(!Number.isSafeInteger(preferred)||preferred<1))throw Error('NATIVE_SOURCE_SELECTION_INVALID');
    const attempt={startedAt,status:'PREPARING',provider:profile.provider,environment:profile.environment,sourceTabId:null,sourceUrl:null,layoutName:null,readyAt:null,elapsedMs:null};lastAttempt=attempt;
    try{
      guard();onProgress('מאתר את הגרף שנבחר ואת החשבון המחובר…');
      const tabs=await chrome.tabs.query({url:['https://*.tradingview.com/chart/*','https://tradingview.com/chart/*']});guard();
      let choices;
      if(preferred!==null)choices=tabs.filter(t=>t.id===preferred&&layouts.has(t.url));
      else {const full=tabs.filter(t=>t.url==='https://www.tradingview.com/chart/ARROWFR1/');choices=full.length?full:tabs.filter(t=>t.url==='https://www.tradingview.com/chart/ARROWRV1/');}
      if(choices.length!==1)throw Error(choices.length?'NATIVE_SOURCE_SELECTION_AMBIGUOUS':'OPEN_SUPPORTED_TRADINGVIEW_SOURCE_REQUIRED');
      const target=choices[0],url=target.url;
      if(!Number.isSafeInteger(target.id)||!Number.isSafeInteger(target.windowId))throw Error('NATIVE_SOURCE_TAB_UNAVAILABLE');
      Object.assign(attempt,{sourceTabId:target.id,sourceUrl:url,layoutName:layouts.get(url)});
      await chrome.tabs.update(target.id,{active:true});guard();
      await chrome.windows.update(target.windowId,{focused:true});guard();
      for(;;){
        guard();const tab=await chrome.tabs.get(target.id);guard();
        if(tab.url!==url)throw Error('NATIVE_SOURCE_CHANGED');
        if(tab.status==='loading'){await sleep(200);continue;}
        const rows=await chrome.scripting.executeScript({target:{tabId:target.id},func:prepareNativeUserAccountPanel,args:[{provider:profile.provider,nativeAccountId:profile.nativeAccountId,sourceUrl:url}],world:'ISOLATED'});guard();
        const result=rows.length===1?rows[0].result:null;
        if(result?.status==='READY')break;
        if(!['WAITING','ACTION_TAKEN'].includes(result?.status))throw Error(result?.reasonCodes?.[0]??'NATIVE_ACCOUNT_PANEL_UNAVAILABLE');
        onProgress('מציג את החשבון המקורי לקריאת זהות…');await sleep(200);
      }
      const rows=await chrome.scripting.executeScript({target:{tabId:target.id},func:readTradingViewExecutionAccount,args:[{tabId:target.id,url}],world:'ISOLATED'});guard();
      const observation=rows.length===1?rows[0].result:null;
      if(observation?.status!=='OBSERVED'||observation.nativeIdentityVerified!==true||observation.provider!==profile.provider||observation.nativeAccountId!==profile.nativeAccountId||observation.environmentVerified===true&&observation.environment!==profile.environment)throw Error('SELECTED_AND_VISIBLE_ACCOUNT_DIFFER');
      await selectSource(target.id);preferred=target.id;guard();
      const existing=getSession();
      if(!existing.active||existing.sourceTabId!==target.id||!existing.reviewAccepted||existing.settingsDirty){
        if(existing.active)throw Error('STOP_OTHER_SOURCE_BEFORE_START');
        onProgress('מאמת את החשבון ומחבר את נתוני הנרות…');await connectSource({isCancelled});guard();
      }
      let furthestWarmup=null,lastProgress=null;
      for(;;){
        guard();const state=getSession();
        if(!state.active||state.sourceTabId!==target.id||!state.reviewAccepted)throw Error('SOURCE_CONNECTION_NOT_STARTED');
        const age=now()-state.lastReceivedAt;
        if(state.ready===true&&state.liveEligible===true&&!state.stale&&state.accountReady===true&&Number.isFinite(age)&&age>=0&&age<=2000)break;
        const warmup=state.warmup;
        if(warmup&&(!furthestWarmup||furthestWarmup.runId===warmup.runId&&furthestWarmup.target===warmup.target)){
          const previous=furthestWarmup??{collected:0,contiguous:0};
          if(warmup.collected>previous.collected||warmup.contiguous>previous.contiguous){
            furthestWarmup={...warmup,collected:Math.max(previous.collected,warmup.collected),contiguous:Math.max(previous.contiguous,warmup.contiguous)};
            deadline=Math.min(warmupHardDeadline,Math.max(deadline,now()+WARMUP_PROGRESS_GRACE_MS));
          }
        }
        const progress=warmup&&state.ready!==true?`חימום מקור TradingView: נאספו ${warmup.collected} מתוך ${warmup.target} נרות דקה, ${warmup.contiguous} ברצף. ההפעלה תמשיך לאחר אימות המקור החי.`:state.progress??'ממתין למקור נרות חי וטרי…';
        if(progress!==lastProgress){lastProgress=progress;onProgress(progress);}
        await sleep(200);
      }
      guard();attempt.status='SOURCE_READY';attempt.readyAt=now();attempt.elapsedMs=attempt.readyAt-startedAt;
      onProgress('המקור מוכן; בודק את בקרי ה־Market המקוריים…');
    }catch(error){attempt.status=isCancelled()?'CANCELLED':'FAILED';attempt.elapsedMs=now()-startedAt;attempt.reason=String(error?.message??error);throw error;}
  }
  return Object.freeze({prepare,snapshot});
}
