import {createBrokerAccountRegistry,loadBrokerAccountRegistry,saveBrokerAccountRegistry} from './broker-account-registry.mjs';

const copy=x=>structuredClone(x),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x);
const reasons={USER_ACCOUNT_SELECTION_REQUIRED:'בחרו חשבון שמור או הוסיפו חשבון במסך החשבונות והחיבורים.',USER_ACCOUNT_STORAGE_UNAVAILABLE:'לא ניתן לקרוא את החשבון שנבחר מהשמירה המקומית.',USER_ACCOUNT_SELECTION_SAVE_FAILED:'בחירת החשבון לא אומתה בשמירה המקומית. נדרשת בחירה מחדש.',USER_ACCOUNT_SELECTION_CHANGED:'החשבון שנבחר השתנה. התחלה חדשה תבדוק את החשבון המחובר בפועל.',USER_ACCOUNT_NATIVE_IDENTITY_REQUIRED:'זהות החשבון המקורית אינה גלויה ומאומתת בלשונית שנבחרה.',USER_ACCOUNT_NATIVE_MISMATCH:'החשבון הגלוי אינו תואם בדיוק לחשבון שבחרתם.',USER_ACCOUNT_ENVIRONMENT_MISMATCH:'סביבת החשבון הגלויה אינה תואמת לפרופיל שנבחר.',USER_ACCOUNT_NATIVE_SOURCE_MISMATCH:'מקור קריאת החשבון אינו תואם ללשונית הגרף.',USER_ACCOUNT_NATIVE_OBSERVATION_STALE:'קריאת זהות החשבון אינה טרייה. התחילו שוב.',USER_ACCOUNT_CHANGED_DURING_REVIEW:'החשבון שנבחר השתנה בזמן הקריאה. התחילו שוב.',USER_ACCOUNT_REVIEW_REQUIRED:'נדרשת קריאה חדשה של זהות החשבון לפני תחילת הניתוח.'};

// Analysis-only bindings for the selected provider-neutral account profile.
// No budget, costs, quantity, SL/TP form, execution capability or broker login.
export function createLiveUserAccountControls({document:doc,storage,readNativeAccount,onInvalidate=()=>{},onProfileApplied=()=>{},now=Date.now}={}){
  if(!doc||typeof doc.getElementById!=='function'||typeof readNativeAccount!=='function'||typeof onInvalidate!=='function'||typeof onProfileApplied!=='function'||typeof now!=='function')throw TypeError('USER_ACCOUNT_CONTROLS_DEPENDENCIES_REQUIRED');
  const $=id=>doc.getElementById(id),selector=$('account-profile'),summary=$('account-summary'),badge=$('account-review-badge');
  if(!selector||!summary||!badge)throw TypeError('USER_ACCOUNT_CONTROLS_MARKUP_REQUIRED');
  let initialized=false,disposed=false,busy=false,generation=0,reviewCounter=0,review=null,brokerProfile=null,savedProfiles=[],selectionFingerprint=null,lastMetadata=null,reason='USER_ACCOUNT_REVIEW_REQUIRED',selectionCommit=null;
  const bindings=[];
  const listen=(node,type,fn)=>{if(node?.addEventListener){node.addEventListener(type,fn);bindings.push([node,type,fn]);}};
  function profile(){
    if(!brokerProfile)return null;
    return {id:brokerProfile.id,label:brokerProfile.label,brokerLabel:brokerProfile.provider,mode:'USER_MANAGED',instrument:'CME_MINI:NQ1!',
      currency:lastMetadata?.currency??null,tickSize:lastMetadata?.tickSize??null,pointValue:lastMetadata?.pointValue??null,risk:null,userManagedRisk:true};
  }
  function render(){
    const options=savedProfiles.map(p=>{const option=doc.createElement('option');option.value=p.id;option.textContent=p.label+(p.enabled?'':' · לא פעיל');option.disabled=!p.enabled;return option;});
    if(!brokerProfile){const option=doc.createElement('option');option.value='';option.textContent='בחרו חשבון שמור';option.disabled=true;options.unshift(option);}
    selector.replaceChildren(...options);selector.value=selectionCommit?.id??brokerProfile?.id??'';selector.disabled=disposed||busy||!initialized||!savedProfiles.some(p=>p.enabled);
    badge.textContent=review?'זהות החשבון נקראה':'נדרשת קריאת חשבון לפני הפעלה';badge.dataset.state=review?'reviewed':'pending';
    summary.textContent=brokerProfile?`${brokerProfile.label} · ${brokerProfile.provider} · ${brokerProfile.environment} (הגדרת המשתמש) · ${brokerProfile.nativeAccountId}. ניהול הסיכון בידיך; אין תקציב, עלויות או גודל פוזיציה של הבוט. ${review?'זהות החשבון הותאמה בקריאה מקורית; כניסות מופעלות רק מכפתור הבוט.':reasons[reason]??reason}`:reasons[reason]??reason;
    for(const id of ['edit-account','new-account']){const node=$(id);if(node){node.hidden=false;node.disabled=disposed||busy||id==='edit-account'&&!brokerProfile;}}
    const dialog=$('account-dialog');if(dialog){if(dialog.open)dialog.close?.();dialog.hidden=true;}
    const note=$('account-storage-note');if(note){const link=doc.createElement('a');link.href='execution-accounts.html';link.target='_blank';link.rel='noopener noreferrer';link.textContent='עריכה והוספה של חשבונות · חשבונות וחיבורים';const help=doc.createElement('span');help.textContent=' · שינוי הפרופיל אינו מחליף את החשבון ב־TradingView. בתחילת ההפעלה נבדקת זהות החשבון המחובר; שמירת PA או LIVE אינה הרשאת מסחר.';note.replaceChildren(link,help);}
  }
  function invalidate(why='USER_ACCOUNT_REVIEW_REQUIRED',{notify=true}={}){
    generation++;review=null;lastMetadata=null;reason=text(why,160)?why:'USER_ACCOUNT_REVIEW_REQUIRED';render();if(notify&&!disposed)onInvalidate(reason);
  }
  function handleRegistryChange(why='BROKER_ACCOUNT_SELECTION_CHANGED'){
    if(disposed)return;
    if(selectionCommit?.serial===generation&&busy){
      // chrome.storage.onChanged may fire synchronously during our own save.
      // Revoke every former review immediately, but let this one local write
      // finish its exact readback. The caller still disarms execution; this
      // branch neither grants native identity nor accepts a competing write.
      review=null;lastMetadata=null;reason=text(why,160)?why:'USER_ACCOUNT_REVIEW_REQUIRED';render();onInvalidate(reason);return;
    }
    invalidate(why);
  }
  async function storedRegistry(){
    const loaded=await loadBrokerAccountRegistry(storage);
    if(loaded.status!=='RESTORED')throw Error(loaded.status==='UNAVAILABLE'?'USER_ACCOUNT_STORAGE_UNAVAILABLE':'USER_ACCOUNT_SELECTION_REQUIRED');
    return loaded.registry;
  }
  function selectionOf(registry){
    const p=registry.profiles.find(item=>item.id===registry.selectedProfileId&&item.enabled);
    if(!p||p.userManagedRisk!==true)throw Error('USER_ACCOUNT_SELECTION_REQUIRED');
    return {profile:copy(p),profiles:copy(registry.profiles),fingerprint:stable({registryRevision:registry.revision,selectedProfileId:registry.selectedProfileId,profile:p})};
  }
  async function selected(){return selectionOf(await storedRegistry());}
  async function selectProfile(id){
    if(disposed||busy){render();return false;}invalidate('USER_ACCOUNT_SELECTION_CHANGED');
    const serial=++generation;busy=true;render();
    try{
      const registry=await storedRegistry();if(disposed||serial!==generation)return false;
      const model=createBrokerAccountRegistry({initialState:registry,now,makeLeaseId:()=>`live-user-account-selection:${serial}:${now()}`}),changed=model.select(id,{expectedRevision:registry.revision});
      if(!changed.ok)throw Error('USER_ACCOUNT_SELECTION_REQUIRED');
      const expected=selectionOf(changed.registry);selectionCommit={serial,id,fingerprint:expected.fingerprint};
      const result=await saveBrokerAccountRegistry(storage,changed.registry);if(disposed||serial!==generation)return false;if(result.status!=='SAVED')throw Error('USER_ACCOUNT_SELECTION_SAVE_FAILED');
      const current=await selected();if(disposed||serial!==generation)return false;if(current.profile.id!==id||current.fingerprint!==expected.fingerprint)throw Error('USER_ACCOUNT_CHANGED_DURING_REVIEW');
      if(selectionCommit?.serial===serial)selectionCommit=null;
      brokerProfile=current.profile;savedProfiles=current.profiles;selectionFingerprint=current.fingerprint;reason='USER_ACCOUNT_REVIEW_REQUIRED';render();onProfileApplied(copy(profile()));return true;
    }catch(error){if(!disposed&&serial===generation){brokerProfile=null;selectionFingerprint=null;reason=String(error.message??error).slice(0,160);render();}return false;}
    finally{if(selectionCommit?.serial===serial)selectionCommit=null;busy=false;if(!disposed)render();}
  }
  function openManager(){if(disposed||busy)return;invalidate('USER_ACCOUNT_SETTINGS_OPENED');if(typeof doc.defaultView?.open==='function')doc.defaultView.open('execution-accounts.html','_blank','noopener,noreferrer');}
  async function refreshStoredProfiles(){
    if(disposed||busy||!initialized)return;const serial=generation;
    try{
      const registry=await storedRegistry();if(disposed||busy||serial!==generation)return;let current=null;try{current=selectionOf(registry);}catch{}
      savedProfiles=copy(registry.profiles);
      if((current?.fingerprint??null)!==selectionFingerprint){invalidate('USER_ACCOUNT_SELECTION_CHANGED');brokerProfile=current?.profile??null;selectionFingerprint=current?.fingerprint??null;reason=current?'USER_ACCOUNT_REVIEW_REQUIRED':'USER_ACCOUNT_SELECTION_REQUIRED';render();if(current)onProfileApplied(copy(profile()));}
      else render();
    }catch{if(!disposed&&!busy&&serial===generation){brokerProfile=null;selectionFingerprint=null;savedProfiles=[];invalidate('USER_ACCOUNT_STORAGE_UNAVAILABLE');}}
  }
  function nativeMatch(observation,selectedProfile,tabId){
    if(!plain(observation)||observation.kind!=='TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1'||observation.status!=='OBSERVED'||observation.nativeIdentityVerified!==true||observation.readOnly!==true||observation.ordersCreated!==false||observation.submitted!==false||observation.synthetic!==false||observation.testOnly!==false||typeof observation.environmentVerified!=='boolean')throw Error('USER_ACCOUNT_NATIVE_IDENTITY_REQUIRED');
    if(observation.provider!==selectedProfile.provider||observation.nativeAccountId!==selectedProfile.nativeAccountId)throw Error('USER_ACCOUNT_NATIVE_MISMATCH');
    if(observation.environmentVerified&&observation.environment!==selectedProfile.environment)throw Error('USER_ACCOUNT_ENVIRONMENT_MISMATCH');
    if(observation.source?.tabId!==tabId||!text(observation.source?.url,4096))throw Error('USER_ACCOUNT_NATIVE_SOURCE_MISMATCH');
    try{const url=new URL(observation.source.url);if(url.protocol!=='https:'||!['www.tradingview.com','tradingview.com'].includes(url.hostname)||!/^\/chart\/[A-Za-z0-9_-]+\/$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error();}catch{throw Error('USER_ACCOUNT_NATIVE_SOURCE_MISMATCH');}
    const t=now();if(!Number.isSafeInteger(t)||t<0||!Number.isSafeInteger(observation.observedAt)||observation.observedAt<0||observation.observedAt>t||t-observation.observedAt>2000)throw Error('USER_ACCOUNT_NATIVE_OBSERVATION_STALE');
  }
  async function initialize(){
    if(disposed||busy)return;const serial=++generation;busy=true;
    try{const registry=await storedRegistry();if(disposed||serial!==generation)return;savedProfiles=copy(registry.profiles);const current=selectionOf(registry);brokerProfile=current.profile;selectionFingerprint=current.fingerprint;reason='USER_ACCOUNT_REVIEW_REQUIRED';}
    catch(error){if(!disposed&&serial===generation){brokerProfile=null;selectionFingerprint=null;reason=String(error.message??error);}}
    finally{busy=false;if(!disposed){initialized=true;render();}}
  }
  async function requestReview(tabId){
    if(disposed||busy||!initialized||!Number.isSafeInteger(tabId)||tabId<1)return null;
    const serial=++generation;busy=true;review=null;lastMetadata=null;reason='USER_ACCOUNT_REVIEW_REQUIRED';render();
    try{
      const first=await selected();if(disposed||serial!==generation)return null;
      const observation=await readNativeAccount({tabId});if(disposed||serial!==generation)return null;
      const latest=await selected();if(disposed||serial!==generation)return null;
      if(first.fingerprint!==latest.fingerprint){brokerProfile=latest.profile;savedProfiles=latest.profiles;selectionFingerprint=latest.fingerprint;throw Error('USER_ACCOUNT_CHANGED_DURING_REVIEW');}nativeMatch(observation,latest.profile,tabId);
      brokerProfile=latest.profile;savedProfiles=latest.profiles;selectionFingerprint=latest.fingerprint;const reviewedAt=now();
      review={schemaVersion:1,reviewId:'user-managed-review:'+reviewedAt+':'+(++reviewCounter),reviewedAt,sourceTabId:tabId,sourceUrl:observation.source.url,
        source:'FRESH_NATIVE_ACCOUNT_IDENTITY_FOR_ANALYSIS_ONLY',profile:profile(),brokerProfile:copy(brokerProfile),nativeObservation:copy(observation),
        nativeIdentityVerified:true,environmentVerified:observation.environmentVerified,environmentBasis:observation.environmentVerified?'NATIVE_OBSERVED':'USER_DECLARED',
        brokerAccountVerified:false,brokerPermissionsVerified:false,commissionVerified:false,slippageVerified:false,risk:null,userManagedRisk:true,ordersAuthorized:false,orderEligible:false,executionCapabilities:{submitMarket:false}};
      reason='USER_ACCOUNT_IDENTITY_ACCEPTED_FOR_ANALYSIS';render();onProfileApplied(copy(review.profile));
      return {ok:true,reasonCodes:[],profile:copy(review.profile),review:copy(review),risk:null,ordersAuthorized:false,orderEligible:false};
    }catch(error){if(!disposed&&serial===generation){review=null;lastMetadata=null;reason=String(error.message??error).slice(0,160);render();}return null;}
    finally{busy=false;if(!disposed)render();}
  }
  function evaluateMetadata(metadata,tabId){
    const blocked=code=>({ok:false,reasonCodes:[code],profile:profile(),risk:null,ordersAuthorized:false,orderEligible:false});
    if(disposed||!review)return blocked(reason||'USER_ACCOUNT_REVIEW_REQUIRED');
    const codes=[];
    if(tabId!==review.sourceTabId)codes.push('USER_ACCOUNT_REVIEW_SOURCE_CHANGED');
    if(!plain(metadata)||metadata.source!=='ohlc'||metadata.instrument!=='CME_MINI:NQ1!'||metadata.timeframe!=='1'||metadata.timeframeMs!==60000||metadata.chartType!=='standard'||metadata.synthetic===true||metadata.testOnly===true)codes.push('USER_ACCOUNT_NQ_1M_METADATA_REQUIRED');
    if(metadata?.currency!=='USD')codes.push('USER_ACCOUNT_CONTRACT_CURRENCY_MISMATCH');
    if(metadata?.tickSize!==.25)codes.push('USER_ACCOUNT_CONTRACT_TICK_MISMATCH');
    if(metadata?.pointValue!==20)codes.push('USER_ACCOUNT_CONTRACT_POINT_VALUE_MISMATCH');
    if(metadata?.sourceUrl!==undefined&&metadata.sourceUrl!==review.sourceUrl)codes.push('USER_ACCOUNT_REVIEW_SOURCE_CHANGED');
    if(codes.length){invalidate(codes[0],{notify:false});return {...blocked(codes[0]),reasonCodes:codes};}
    lastMetadata={source:metadata.source,instrument:metadata.instrument,timeframe:metadata.timeframe,timeframeMs:metadata.timeframeMs,currency:metadata.currency,tickSize:metadata.tickSize,pointValue:metadata.pointValue,chartType:metadata.chartType};
    review.profile=profile();reason='USER_ACCOUNT_METADATA_ACCEPTED_FOR_ANALYSIS';
    return {ok:true,reasonCodes:[],profile:copy(review.profile),risk:null,ordersAuthorized:false,orderEligible:false};
  }
  listen(selector,'change',()=>selectProfile(selector.value));
  for(const id of ['edit-account','new-account'])listen($(id),'click',openManager);
  listen(doc.defaultView,'focus',refreshStoredProfiles);
  return {initialize,requestReview,evaluateMetadata,invalidate,handleRegistryChange,
    profile:()=>({ok:!!brokerProfile,profile:profile(),risk:null,ordersAuthorized:false}),
    snapshot:()=>({review:review?copy(review):null,reviewAccepted:!!review,reason,selectedProfileId:brokerProfile?.id??null,draftProfile:profile(),brokerProfile:brokerProfile?copy(brokerProfile):null,selectionFingerprint,currentMetadata:lastMetadata?copy(lastMetadata):null,risk:null,userManagedRisk:true,busy,ordersAuthorized:false,orderEligible:false,executionCapabilities:{submitMarket:false}}),
    dispose(){if(disposed)return;disposed=true;generation++;busy=false;review=null;lastMetadata=null;reason='PAGE_CLOSED';for(const [node,event,handler] of bindings)node.removeEventListener?.(event,handler);render();}
  };
}
export {createLiveUserAccountControls as createLiveAccountControls};
