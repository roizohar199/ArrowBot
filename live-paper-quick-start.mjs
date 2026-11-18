import {prepareLivePaperStartUi} from './live-paper-start-ui.mjs';

export const PAPER_RESEARCH_URL='https://www.tradingview.com/chart/ARROWRV1/';
export const PAPER_FULL_SCREENS_URL='https://www.tradingview.com/chart/ARROWFR1/';
export const isPaperResearchUrl=value=>value===PAPER_RESEARCH_URL;
export const isPaperSourceUrl=value=>value===PAPER_RESEARCH_URL||value===PAPER_FULL_SCREENS_URL;

// Explicit Start only. Never navigates an existing tab, changes a layout,
// writes order amounts, or returns an execution/technical authorization.
export function createLivePaperQuickStart({chrome,getSession,selectSource,connectSource,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeoutMs=180000}={}){
  let lastAttempt=null;
  const snapshot=()=>lastAttempt?structuredClone(lastAttempt):null;
  async function prepare({isCancelled=()=>false,onProgress=()=>{}}={}){
    const startedAt=now(),check=()=>{if(isCancelled())throw Error('START_CANCELLED');if(now()-startedAt>timeoutMs)throw Error('RESEARCH_START_TIMEOUT');};
    const initial=getSession(),profile=initial.profile,preferenceSupported=Object.hasOwn(initial,'preferredSourceTabId');
    let preferredSourceTabId=initial.preferredSourceTabId??null;
    if(preferredSourceTabId!==null&&(!Number.isSafeInteger(preferredSourceTabId)||preferredSourceTabId<1))throw Error('PAPER_SOURCE_SELECTION_INVALID');
    if(!profile?.enabled||profile.provider!=='TRADINGVIEW_PAPER'||profile.environment!=='DEMO'||profile.userManagedRisk!==true)throw Error('PAPER_DEMO_PROFILE_REQUIRED');
    const expectedProfile=JSON.stringify(profile);
    const guard=()=>{check();const current=getSession();if(JSON.stringify(current.profile)!==expectedProfile)throw Error('ACCOUNT_PROFILE_CHANGED');if(preferenceSupported&&(current.preferredSourceTabId??null)!==preferredSourceTabId)throw Error('PAPER_SOURCE_SELECTION_CHANGED');};
    const attempt={startedAt,status:'PREPARING',sourceTabId:null,sourceUrl:null,layoutName:null,createdResearchWindow:false,readyAt:null,elapsedMs:null};lastAttempt=attempt;
    try{
      guard();onProgress('מאתר את הפריסה שנבחרה ואת חשבון הפייפר…');
      const all=await chrome.tabs.query({url:['https://*.tradingview.com/chart/*','https://tradingview.com/chart/*']});guard();
      let tabs;
      if(preferredSourceTabId!==null){
        tabs=all.filter(tab=>tab.id===preferredSourceTabId&&isPaperSourceUrl(tab.url));
        if(tabs.length!==1)throw Error('PAPER_SOURCE_SELECTION_UNSUPPORTED');
      }else{
        const full=all.filter(tab=>tab.url===PAPER_FULL_SCREENS_URL);
        if(full.length>1)throw Error('MULTIPLE_FULL_SCREENS_TABS');
        tabs=full.length?full:all.filter(tab=>isPaperResearchUrl(tab.url));
        if(tabs.length>1)throw Error('MULTIPLE_RESEARCH_TABS');
      }
      if(!tabs.length){
        onProgress('פותח חלון מחקר נפרד; הפריסה האישית נשמרת…');
        const created=await chrome.windows.create({url:PAPER_RESEARCH_URL,type:'normal',focused:true});guard();
        tabs=created.tabs?.filter(tab=>isPaperResearchUrl(tab.url)||isPaperResearchUrl(tab.pendingUrl))??[];
        if(tabs.length!==1)throw Error('RESEARCH_WINDOW_NOT_CREATED');
        attempt.createdResearchWindow=true;
      }
      const target=tabs[0];if(!Number.isSafeInteger(target.id)||!Number.isSafeInteger(target.windowId))throw Error('RESEARCH_TAB_UNAVAILABLE');
      const sourceUrl=target.url||target.pendingUrl;if(!isPaperSourceUrl(sourceUrl))throw Error('PAPER_SOURCE_SELECTION_UNSUPPORTED');
      attempt.sourceTabId=target.id;attempt.sourceUrl=sourceUrl;attempt.layoutName=sourceUrl===PAPER_FULL_SCREENS_URL?'Full Screens Live':'Arrow OHLC Live Verification';
      await chrome.tabs.update(target.id,{active:true});guard();
      await chrome.windows.update(target.windowId,{focused:true});guard();
      let prepared=false;
      while(!prepared){
        guard();const tab=await chrome.tabs.get(target.id);guard();
        if(tab.url!==sourceUrl&&tab.pendingUrl!==sourceUrl)throw Error('RESEARCH_SOURCE_CHANGED');
        if(tab.status==='loading'){onProgress('טוען את הגרף שנבחר…');await sleep(200);continue;}
        const rows=await chrome.scripting.executeScript({target:{tabId:target.id},func:prepareLivePaperStartUi,args:[{nativeAccountId:profile.nativeAccountId,sourceUrl}],world:'ISOLATED'});guard();
        const result=rows.length===1?rows[0].result:null;
        if(result?.status==='READY'){prepared=true;break;}
        if(!['ACTION_TAKEN','WAITING'].includes(result?.status))throw Error(result?.reasonCodes?.[0]??'RESEARCH_PAPER_UI_UNAVAILABLE');
        onProgress(result.message??'מכין את חשבון הפייפר ואת כרטיס הפריסט המקורי…');await sleep(200);
      }
      guard();await selectSource(target.id);if(preferenceSupported)preferredSourceTabId=target.id;guard();
      const existing=getSession();
      if(!existing.active||existing.sourceTabId!==target.id||!existing.reviewAccepted||existing.settingsDirty){
        if(existing.active)throw Error('STOP_OTHER_SOURCE_BEFORE_START');
        onProgress('מאמת את החשבון ומחבר את נתוני הנרות החיים…');
        await connectSource({isCancelled});guard();
      }
      while(true){
        guard();const state=getSession();
        if(!state.active||state.sourceTabId!==target.id||!state.reviewAccepted)throw Error('SOURCE_CONNECTION_NOT_STARTED');
        if(state.ready===true&&state.liveEligible===true&&!state.stale&&state.accountReady===true&&Number.isFinite(state.lastReceivedAt)&&now()-state.lastReceivedAt>=0&&now()-state.lastReceivedAt<=2000)break;
        onProgress(state.progress??'אוסף היסטוריה מאומתת ובודק עדכוני שוק חדשים…');await sleep(200);
      }
      guard();attempt.status='SOURCE_READY';attempt.readyAt=now();attempt.elapsedMs=attempt.readyAt-startedAt;
      onProgress('המקור החי מוכן; בודק את הפריסט והכמות המקוריים…');
      // The caller must independently inspect source/account/preset and recover
      // its order ledger before arming. No READY token is handed to it here.
    }catch(error){attempt.status=isCancelled()?'CANCELLED':'FAILED';attempt.elapsedMs=now()-startedAt;attempt.reason=String(error?.message??error);throw error;}
  }
  return Object.freeze({prepare,snapshot});
}
