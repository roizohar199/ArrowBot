import {createBrokerAccountRegistry,loadBrokerAccountRegistry,saveBrokerAccountRegistry,makeEmptyBrokerAccountRegistry,BROKER_ACCOUNT_REGISTRY_STORAGE_KEY} from './broker-account-registry.mjs';
import {createExecutionAdapterRegistry} from './execution-adapter-registry.mjs';
import {readTradingViewExecutionAccount,createTradingViewAccountInspectionAdapter} from './tradingview-account-inspector.mjs';
import {createTradovateAccountInspectionAdapter} from './tradovate-account-connector.mjs';
import {createExecutionAttemptLedger,EXECUTION_ATTEMPT_STORAGE_KEY} from './execution-attempt-ledger.mjs';

const environmentNames={REPLAY:'Replay',DEMO:'דמו',EVALUATION:'מבחן',PA:'PA',LIVE:'ברוקראז׳ חי'};
const adapterNames={'tradingview-account-ui':'TradingView · זהות חשבון גלויה','tradovate-api':'Tradovate · חיבור API מורשה'};
const fields={label:'execution-label',provider:'execution-provider',environment:'execution-environment',nativeAccountId:'execution-native-id',adapterId:'execution-adapter',currency:'execution-currency'};
const copy=value=>structuredClone(value);
const terminalAttemptStates=new Set(['CLOSED','CANCELLED','NOT_SUBMITTED']);
const attemptStatusNames={UNKNOWN:'תוצאת הניסיון אינה ידועה',WORKING:'פקודה נרשמה כממתינה בעבר',FILLED:'מילוי נרשם בעבר',CLOSED:'סגירה תועדה בעבר',CANCELLED:'ביטול תועד בעבר',NOT_SUBMITTED:'תועד שהפקודה לא נשלחה'};
const accountIdentity=profile=>({provider:profile.provider,environment:profile.environment,nativeAccountId:profile.nativeAccountId});
const sameAccount=(a,b)=>['provider','environment','nativeAccountId'].every(key=>a?.[key]===b?.[key]);

export function createExecutionAccountsPage({document:doc,chrome:extension,locks=globalThis.navigator?.locks,now=Date.now,makeId=()=> 'account-'+crypto.randomUUID()}={}){
  if(!doc?.getElementById)throw TypeError('EXECUTION_ACCOUNT_PAGE_DOM_REQUIRED');
  const $=id=>doc.getElementById(id),model=createBrokerAccountRegistry({now});
  let tabs=[],editingId=null,editRegistryRevision=0,busy=false,disposed=false,observation=null,lastInspection=null,savedAttempts=null,serial=0,ready=false,storageReload=false;
  // This page uses recover() only. It never acquires an account session lease,
  // reserves an event, marks a result, or exposes raw stored intent/history.
  const ledger=createExecutionAttemptLedger({storage:extension?.storage?.local,locks,now,ownerId:'execution-accounts-read-only'});
  const listeners=[];
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push([node,event,fn]);};
  const message=(text,state='')=>{$('execution-account-message').textContent=text;$('execution-account-message').dataset.state=state;};
  const source=()=>{const tab=tabs.find(item=>String(item.id)===$('execution-source-tab').value);return tab?{tabId:tab.id,url:tab.url}:null;};
  const context=()=>({selection:model.getSelection(),symbol:'CME_MINI:NQ1!',source:source()});
  async function nativeRead(expected){
    if(!extension?.scripting?.executeScript||!expected)throw Error('EXTENSION_ACCOUNT_READER_REQUIRED');
    const tab=await extension.tabs.get(expected.tabId);
    if(tab.url!==expected.url)throw Error('ACCOUNT_SOURCE_TAB_CHANGED');
    const results=await extension.scripting.executeScript({target:{tabId:expected.tabId},world:'ISOLATED',func:readTradingViewExecutionAccount,args:[expected]});
    const after=await extension.tabs.get(expected.tabId);
    if(after.url!==expected.url)throw Error('ACCOUNT_SOURCE_TAB_CHANGED');
    if(results.length!==1||!results[0]?.result)throw Error('ONE_ACCOUNT_OBSERVATION_REQUIRED');
    return results[0].result;
  }
  const adapters=createExecutionAdapterRegistry({getContext:context,now});
  adapters.register(createTradingViewAccountInspectionAdapter({readAccount:nativeRead,now}));
  // No token, permission prompt or API request is made by opening this page.
  adapters.register(createTradovateAccountInspectionAdapter({getClient:async()=>null,now}));

  function setConnection(state='NOT_CONNECTED',text='אין חיבור מאומת'){
    $('execution-connection-status').dataset.state=state;$('execution-connection-status').textContent=text;
  }
  function invalidate(reason){serial++;observation=null;lastInspection=null;savedAttempts=null;model.invalidate(reason);adapters.invalidate?.(reason);setConnection();$('execution-add-visible').disabled=true;$('execution-observed-account').textContent='נדרשת קריאה חדשה של החשבון הגלוי.';renderSavedAttempts();}
  function evidence(){ $('execution-account-evidence').textContent=JSON.stringify({version:'0.30.5',registry:model.snapshot().registry,selection:model.getSelection(),connection:lastInspection,observation,savedAttempts,ordersCreated:false,riskManagement:'USER_MANAGED',credentialsStored:false},null,2); }
  function renderSavedAttempts(){
    const selected=model.getSelection()?.profile,button=$('execution-read-saved-attempts'),output=$('execution-saved-attempt-status'),list=$('execution-saved-attempt-list');
    button.disabled=busy||!ready||!selected;list.replaceChildren();output.dataset.state=savedAttempts?.status??'NOT_CHECKED';
    if(!savedAttempts){output.textContent=selected?'טרם נבדקו ניסיונות הכניסה השמורים עבור החשבון הנבחר.':'בחרו חשבון כדי לקרוא את רשומות הניסיונות שלו.';return;}
    if(savedAttempts.status==='UNAVAILABLE'){output.textContent='לא ניתן לאמת את רשומות הניסיונות השמורות. אין להסיק שאין ניסיון פתוח; לא שונה דבר באחסון או בחשבון.';return;}
    output.textContent=(savedAttempts.entryBlocked?`נמצאו ${savedAttempts.unresolvedCount} ניסיונות ללא סיום מאומת באחסון. נדרש בירור מול החשבון לפני כניסה נוספת.`:'לא נמצאו ניסיונות ללא סיום מאומת באחסון עבור החשבון הנבחר. זו אינה בדיקה של מצב החשבון כעת.')+` מוצגות ${savedAttempts.records.length} מתוך ${savedAttempts.totalRecords} רשומות. מצב שמור אינו אישור לפוזיציה או לפקודה נוכחית.`;
    for(const record of savedAttempts.records){
      const card=doc.createElement('article'),title=doc.createElement('h3'),identity=doc.createElement('p'),event=doc.createElement('p'),source=doc.createElement('p'),updated=doc.createElement('p');card.className='scenario-card';
      title.textContent=record.status+' · '+attemptStatusNames[record.status];
      identity.textContent=record.accountIdentity.provider+' · '+record.accountIdentity.environment+' · '+record.accountIdentity.nativeAccountId;
      event.textContent=record.eventIdentity.direction+' · '+record.eventIdentity.symbol+' · אירוע: '+record.eventIdentity.eventId;
      source.textContent='מקור: '+(record.sourceIdentity.identityKey??'לא נרשם')+' · הפעלה: '+(record.sourceIdentity.runId??'לא נרשמה');
      updated.textContent='זמן העדכון השמור: '+new Date(record.updatedAt).toLocaleString('he-IL')+(record.nativeOrderId?' · מזהה פקודה שנרשם: '+record.nativeOrderId:'');
      card.append(title,identity,event,source,updated);list.append(card);
    }
  }
  function render(){
    const snapshot=model.snapshot(),registry=snapshot.registry,selected=model.getSelection()?.profile;
    $('execution-account-select').replaceChildren();
    const empty=doc.createElement('option');empty.value='';empty.textContent='בחר חשבון';$('execution-account-select').append(empty);
    for(const profile of registry.profiles){const item=doc.createElement('option');item.value=profile.id;item.textContent=profile.label+' · '+environmentNames[profile.environment]+(profile.enabled?'':' · מושבת');$('execution-account-select').append(item);}
    $('execution-account-select').value=registry.selectedProfileId??'';
    $('execution-selected-summary').textContent=selected?`${selected.label} · ${selected.provider} · ${environmentNames[selected.environment]} · ${selected.nativeAccountId} · ${selected.currency}. ניהול הסיכון בידיך.`:'טרם נבחר חשבון.';
    $('execution-account-edit').disabled=busy||!selected;
    $('execution-inspect-selected').disabled=busy||!selected||!source();
    for(const id of ['execution-account-select','execution-account-new','execution-account-save','execution-account-cancel','execution-refresh-tabs'])$(id).disabled=busy||!ready;
    $('execution-read-visible').disabled=busy||!source()||!extension?.scripting;
    $('execution-add-visible').disabled=busy||observation?.status!=='OBSERVED'||!observation.provider;
    $('execution-adapter-list').replaceChildren();
    for(const id of ['tradingview-account-ui','tradovate-api']){const card=doc.createElement('article');card.className='scenario-card';const title=doc.createElement('h3');title.textContent=adapterNames[id];const text=doc.createElement('p');text.textContent=id==='tradingview-account-ui'?'קריאת זהות בחשבון המוצג בלשונית שבחרת. ללא החלפת חשבון וללא פקודות.':'תשתית קריאה לסביבות Demo ו־Live של חשבון זכאי. אין חיבור מזוהה בהפעלה הזו; נדרש חיבור API מורשה.';card.append(title,text);$('execution-adapter-list').append(card);}
    renderSavedAttempts();evidence();
  }
  function writeForm(profile){editingId=profile?.id??null;editRegistryRevision=model.snapshot().registry.revision;const defaults={label:'',provider:'TRADOVATE',environment:'PA',nativeAccountId:'',adapterId:'tradingview-account-ui',currency:'USD'};for(const [key,id]of Object.entries(fields))$(id).value=profile?.[key]??defaults[key];$('execution-enabled').checked=profile?.enabled??true;$('execution-editor-heading').textContent=profile?'עריכת חשבון':'הוספת חשבון';$('execution-account-editor').hidden=false;}
  async function persist(){const saved=await saveBrokerAccountRegistry(extension?.storage?.local,model.snapshot().registry);$('execution-storage-status').textContent=saved.status==='SAVED'?'פרטי החשבונות נשמרו במחשב. חיבור והרשאות לא נשמרים כמאומתים.':'השמירה לא אושרה; החשבון זמין בהפעלה הזו בלבד.';return saved;}
  const reason=result=>(result?.reasonCodes??[result?.status??'UNKNOWN']).join(' · ');
  async function run(operation){if(busy||disposed||!ready)return;busy=true;render();try{await operation();}catch(error){message('הפעולה לא הושלמה: '+String(error?.message??error).slice(0,180),'error');}finally{while(storageReload&&!disposed){storageReload=false;await restore();}busy=false;if(!disposed)render();}}
  async function refreshTabs(){
    const prior=$('execution-source-tab').value;
    tabs=extension?.tabs?.query?await extension.tabs.query({url:['https://*.tradingview.com/chart/*','https://tradingview.com/chart/*']}):[];
    tabs=tabs.filter(tab=>{try{const u=new URL(tab.url);return Number.isSafeInteger(tab.id)&&u.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(u.hostname)&&/^\/chart\/[A-Za-z0-9_-]+\/$/.test(u.pathname)&&!u.search&&!u.hash;}catch{return false;}});
    $('execution-source-tab').replaceChildren();const blank=doc.createElement('option');blank.value='';blank.textContent='בחר לשונית לבדיקה';$('execution-source-tab').append(blank);
    for(const tab of tabs){const item=doc.createElement('option');item.value=String(tab.id);item.textContent=(tab.title??'TradingView')+' · '+tab.id;$('execution-source-tab').append(item);}
    // Never implicitly inspect the user's personal tab.
    $('execution-source-tab').value=tabs.some(tab=>String(tab.id)===prior)?prior:'';
  }
  async function inspectVisible(){
    const active=source();if(!active)return;const generation=++serial;
    observation=null;lastInspection=null;setConnection();
    const result=await nativeRead(active);if(generation!==serial||JSON.stringify(active)!==JSON.stringify(source()))return;
    observation=result;
    $('execution-observed-account').textContent=result.status==='OBSERVED'?`נקראו: ${result.providerLabel} · ${result.nativeAccountId} · ${result.environmentVerified?environmentNames[result.environment]:'סוג החשבון אינו מאומת מהתווית'}. קריאת זהות בלבד.`:'זהות החשבון לא נקראה: '+reason(result);
    message(result.status==='OBSERVED'?'נקראה זהות גלויה. אפשר למלא ממנה טופס, או לבדוק התאמה לחשבון שמור.':'הציגו את לוח החשבון בלשונית שנבחרה ובדקו שוב.');
  }
  async function inspectSelected(){
    const generation=++serial;lastInspection=null;setConnection();
    const result=await adapters.inspectAccount();if(generation!==serial)return;
    lastInspection=result;
    const status=result?.reasonCodes?.some(code=>/SELECTED_AND_VISIBLE_(ACCOUNT|ENVIRONMENT)_DIFFER/.test(code))?'ACCOUNT_MISMATCH':result?.status;
    setConnection(status,status==='READ_ONLY'?'זהות החשבון נקראה · קריאה בלבד':status==='READY'?'חיבור אומת לפי יכולות המתאם':status==='ACCOUNT_MISMATCH'?'החשבון הגלוי שונה מהחשבון שנבחר':status==='UNSUPPORTED'?'למסלול הזה עדיין אין מתאם מחובר':'החיבור לא אומת');
    message(status==='READ_ONLY'?'לא נשלחה פקודה. מסלול הקריאה אינו הרשאת ביצוע.':'תוצאת הבדיקה: '+reason(result),status==='READ_ONLY'?'':'error');
  }
  async function inspectSavedAttempts(){
    const selected=model.getSelection();if(!selected)return;
    const generation=++serial,identity=accountIdentity(selected.profile),selectionKey=selected.selectionKey;savedAttempts=null;renderSavedAttempts();
    const result=await ledger.recover({accountIdentity:identity});
    const current=model.getSelection();if(disposed||generation!==serial||current?.selectionKey!==selectionKey||!sameAccount(identity,current?.profile))return;
    const base={kind:'READ_ONLY_SAVED_EXECUTION_ATTEMPTS_V1',accountIdentity:identity,checkedAt:now(),readOnly:true,ordersInferred:false,ordersCreated:false,leaseAcquired:false,records:[]};
    if(!result.ok||!Array.isArray(result.records)||!Array.isArray(result.unresolved)||result.records.some(record=>!sameAccount(record.accountIdentity,identity))){savedAttempts={...base,status:'UNAVAILABLE',entryBlocked:null};return;}
    const records=result.records.map(record=>({key:record.key,status:record.status,accountIdentity:accountIdentity(record.accountIdentity),eventIdentity:copy(record.eventIdentity),
      sourceIdentity:Object.fromEntries(['identityKey','runId'].filter(key=>typeof record.sourceIdentity?.[key]==='string').map(key=>[key,record.sourceIdentity[key]])),
      reservedAt:record.reservedAt,updatedAt:record.updatedAt,nativeOrderId:record.history.findLast(item=>typeof item.proof?.nativeOrderId==='string')?.proof.nativeOrderId??null}));
    records.sort((a,b)=>Number(terminalAttemptStates.has(a.status))-Number(terminalAttemptStates.has(b.status))||b.updatedAt-a.updatedAt);
    savedAttempts={...base,status:result.status,entryBlocked:result.entryBlocked===true,totalRecords:records.length,unresolvedCount:result.unresolved.length,records:records.slice(0,100)};
  }

  listen($('execution-account-new'),'click',()=>{writeForm();message('אפשר להוסיף ספק ומזהה חשבון חדשים.');});
  listen($('execution-account-edit'),'click',()=>{const profile=model.getSelection()?.profile;if(profile)writeForm(profile);});
  listen($('execution-account-cancel'),'click',()=>{$('execution-account-editor').hidden=true;});
  listen($('execution-account-form'),'submit',event=>{event.preventDefault();return run(async()=>{
    const raw={id:editingId??makeId(),...Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value])),enabled:$('execution-enabled').checked,userManagedRisk:true};
    raw.label=raw.label.trim();raw.provider=raw.provider.trim().toUpperCase();raw.adapterId=raw.adapterId.trim();raw.currency=raw.currency.trim().toUpperCase();
    const changed=model.upsert(raw,{expectedRevision:editRegistryRevision});if(!changed.ok)throw Error(reason(changed));
    if(raw.enabled){const selected=model.select(raw.id);if(!selected.ok)throw Error(reason(selected));}invalidate('ACCOUNT_SAVED');await persist();editingId=raw.id;$('execution-account-editor').hidden=true;message(raw.enabled?'החשבון נשמר ונבחר. נדרש אימות חיבור לפני ביצוע.':'החשבון נשמר כמושבת.');
  });});
  listen($('execution-account-select'),'change',()=>{const id=$('execution-account-select').value||null;return run(async()=>{const profile=model.snapshot().registry.profiles.find(item=>item.id===id);if(profile&&!profile.enabled){invalidate('DISABLED_ACCOUNT_EDIT');writeForm(profile);message('החשבון מושבת. אפשר לערוך ולהפעיל אותו בטופס בלי לבחור בו לביצוע.');return;}const result=model.select(id);if(!result.ok)throw Error(reason(result));invalidate('ACCOUNT_SELECTED');await persist();message('החשבון שנבחר עודכן. אימות קודם אינו מועבר לחשבון אחר.');});});
  listen($('execution-source-tab'),'change',()=>{invalidate('ACCOUNT_SOURCE_CHANGED');render();});
  listen($('execution-refresh-tabs'),'click',()=>run(async()=>{invalidate('ACCOUNT_TABS_REFRESHED');await refreshTabs();}));
  listen($('execution-read-visible'),'click',()=>run(inspectVisible));
  listen($('execution-inspect-selected'),'click',()=>run(inspectSelected));
  listen($('execution-read-saved-attempts'),'click',()=>run(inspectSavedAttempts));
  listen($('execution-add-visible'),'click',()=>{if(observation?.status!=='OBSERVED'||!observation.provider)return;writeForm();$('execution-label').value=observation.providerLabel+' · '+(observation.environmentVerified?environmentNames[observation.environment]:'חשבון');$('execution-provider').value=observation.provider;$('execution-native-id').value=observation.nativeAccountId;$('execution-environment').value=observation.environment??'PA';message('פרטי הזהות הועתקו לטופס. בדוק את סוג החשבון ושמור כדי לבחור אותו.');});
  const storageChanged=(changes,area)=>{if(area!=='local')return;if(changes?.[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]){invalidate('ACCOUNT_STORAGE_CHANGED');storageReload=true;if(!busy&&ready)void run(async()=>{});}else if(changes?.[EXECUTION_ATTEMPT_STORAGE_KEY]){serial++;savedAttempts=null;renderSavedAttempts();evidence();}};
  extension?.storage?.onChanged?.addListener(storageChanged);
  const tabChanged=(tabId,change)=>{if(source()?.tabId===tabId&&(change?.url||change?.status==='loading')){invalidate('ACCOUNT_SOURCE_NAVIGATED');render();}};
  const tabRemoved=tabId=>{if(source()?.tabId===tabId){invalidate('ACCOUNT_SOURCE_CLOSED');tabs=tabs.filter(tab=>tab.id!==tabId);$('execution-source-tab').value='';render();}};
  extension?.tabs?.onUpdated?.addListener(tabChanged);extension?.tabs?.onRemoved?.addListener(tabRemoved);
  async function restore(){const generation=serial,loaded=await loadBrokerAccountRegistry(extension?.storage?.local);if(disposed||generation!==serial)return;if(loaded.registry){const result=model.replace(loaded.registry);if(!result.ok)message('פרטי החשבונות השמורים אינם תקינים.','error');}else if(['INVALID','EMPTY'].includes(loaded.status)){model.replace(makeEmptyBrokerAccountRegistry(now()));if(loaded.status==='INVALID')message('פרטי החשבונות השמורים אינם תקינים; לא אומת חשבון.','error');}}
  async function initialize(){setConnection();await restore();await refreshTabs();while(storageReload&&!disposed){storageReload=false;await restore();}ready=true;writeForm();$('execution-account-editor').hidden=model.snapshot().registry.profiles.length>0;render();return snapshot();}
  function snapshot(){return {registry:copy(model.snapshot().registry),selection:copy(model.getSelection()),observation:copy(observation),inspection:copy(lastInspection),savedAttempts:copy(savedAttempts),busy,ordersCreated:false};}
  function dispose(){disposed=true;invalidate('ACCOUNT_PAGE_CLOSED');for(const [node,event,fn]of listeners)node.removeEventListener(event,fn);extension?.storage?.onChanged?.removeListener(storageChanged);extension?.tabs?.onUpdated?.removeListener(tabChanged);extension?.tabs?.onRemoved?.removeListener(tabRemoved);}
  return {initialize,snapshot,dispose};
}

if(typeof document!=='undefined'&&document.getElementById('execution-accounts-root')){
  const page=createExecutionAccountsPage({document,chrome:globalThis.chrome});
  void page.initialize().catch(()=>{document.getElementById('execution-account-message').textContent='לא ניתן לטעון את פרטי החשבונות. לא אומת חיבור.';});
  window.addEventListener('pagehide',()=>page.dispose(),{once:true});
}
