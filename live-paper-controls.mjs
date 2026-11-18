import {createPaperExecutionController} from './paper-execution.mjs';
import {paperTradingUiCommand} from './paper-ui-driver.mjs';
import {verifyPaperOrderTableProof} from './paper-order-proof.mjs';

export const PAPER_RESERVATION_STORAGE_KEY='arrow.paperExecutionReservations.v1';
const copy=value=>structuredClone(value);
const validKey=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f\u007f]/.test(value);

// Shared extension-origin Web Locks serialize storage claims across side panels
// and popouts. Claims are never evicted automatically or retried after failure.
export function createPaperReservationLedger({storage,locks,now=Date.now}={}){
  return async function reserve(key,record={}){
    if(!validKey(key)||typeof storage?.get!=='function'||typeof storage?.set!=='function'||typeof locks?.request!=='function')return {ok:false,reason:'DURABLE_PAPER_LEDGER_UNAVAILABLE'};
    try{return await locks.request('arrow-paper-execution-ledger-v1',{mode:'exclusive'},async()=>{
      const values=await storage.get(PAPER_RESERVATION_STORAGE_KEY),stored=values?.[PAPER_RESERVATION_STORAGE_KEY];
      if(stored!==undefined&&(!stored||stored.schemaVersion!==1||!stored.claims||typeof stored.claims!=='object'||Array.isArray(stored.claims)))return {ok:false,reason:'INVALID_PAPER_LEDGER'};
      const claims=stored?.claims??{};
      if(Object.hasOwn(claims,key))return {ok:false,reason:'PAPER_EVENT_ALREADY_RESERVED'};
      if(Object.keys(claims).length>=1000)return {ok:false,reason:'PAPER_LEDGER_FULL_REVIEW_REQUIRED'};
      const claim={reservedAt:now(),eventId:String(record.eventId??'').slice(0,512),accountKey:String(record.accountKey??'').slice(0,512),sourceBinding:copy(record.sourceBinding??null),state:'RESERVED_NO_BLIND_RETRY'};
      await storage.set({[PAPER_RESERVATION_STORAGE_KEY]:{schemaVersion:1,claims:{...claims,[key]:claim}}});
      const verify=await storage.get(PAPER_RESERVATION_STORAGE_KEY);
      if(JSON.stringify(verify?.[PAPER_RESERVATION_STORAGE_KEY]?.claims?.[key])!==JSON.stringify(claim))return {ok:false,reason:'PAPER_LEDGER_WRITE_UNVERIFIED'};
      return {ok:true,status:'RESERVED'};
    });}catch{return {ok:false,reason:'DURABLE_PAPER_LEDGER_FAILED'};}
  };
}

const statusLabels={DISARMED:'ביצוע אוטומטי כבוי',ARMED:'פייפר מחובר · ממתין לאיתות חי מאושר חדש',PREPARING:'מכין פקודת פייפר ובודק את ההגנות',SUBMITTING:'פקודת פייפר נשלחת · ממתין לאימות',RECONCILING:'בודק מצב פקודה קיימת · ללא שיגור חוזר',WORKING:'פקודת פייפר ממתינה · מילוי טרם אומת',FILLED_PROTECTED:'מילוי חוזה אחד והגנות פייפר אומתו',UNKNOWN:'תוצאת הפקודה אינה ודאית · הביצוע נעול לבדיקה',UNKNOWNLOCK:'תוצאת הפקודה אינה ודאית · הביצוע נעול לבדיקה',LOCKED:'הביצוע נעול לבדיקה'};
const code=value=>String(value?.code??value?.message??value??'PAPER_OPERATION_FAILED').slice(0,160);

// A driver reply is an observation, not a fill. Only the typed-table verifier
// may promote it to a proven WORKING/FILLED_PROTECTED result.
export function verifyLivePaperUiResult(intent,result,{now=Date.now(),baselineOrderIds}={}){
  const proof=verifyPaperOrderTableProof(intent,result?.evidence,{now,baselineOrderIds});
  return {...proof,rawUiVerification:copy(result??null),verificationScope:'TYPED_PUBLIC_PAPER_TABLES_NOT_CLICK_ACKNOWLEDGEMENT'};
}

export function createLivePaperControls({document,chrome,extension,getContext,locks=globalThis.navigator?.locks,now=Date.now}={}){
  const $=id=>document.getElementById(id),ui={};
  for(const id of ['paper-read','paper-arm','paper-disarm','paper-test-draft','paper-consent','paper-status','paper-account-status','paper-test-status','paper-journal'])ui[id]=$(id);
  if(Object.values(ui).some(node=>!node))return {accept(){},disarm(){},refresh(){},snapshot(){return {status:'UNAVAILABLE',reasonCodes:['PAPER_UI_NOT_MOUNTED']};}};
  let boundUrl=null,boundTabId=null,lastEvidence=null,busy=false,reconciling=false,lastReconcileAt=-Infinity,operationSerial=0,controller=null,testDraft=null,lastControllerState={status:'DISARMED',journal:[]},journalSignature=null;
  const context=()=>{
    const current=getContext();
    return {...current,source:{...current.source,researchUrl:current.source?.sourceTabId===boundTabId?boundUrl:null}};
  };
  const reserve=createPaperReservationLedger({storage:extension?chrome?.storage?.local:null,locks,now});
  function render(snapshot){
    if(snapshot){if(snapshot.status==='WORKING'&&lastControllerState.status!=='WORKING')lastReconcileAt=now();lastControllerState=snapshot;}
    const state=lastControllerState,ctx=context();
    const reasons=state.reasonCodes??(state.reason?[state.reason]:[]);
    ui['paper-status'].textContent=(statusLabels[state.status]??state.status??statusLabels.DISARMED)+(reasons.length?' · '+reasons.join(' · '):'');
    if(state.status==='WORKING'&&state.lastResult?.protectionState==='PENDING_PARENT_FILL')ui['paper-status'].textContent+=' · פקודות היציאה ממתינות למילוי ההורה; אינן הגנות פעילות לפוזיציה';
    ui['paper-status'].dataset.state=/UNKNOWN|LOCK/.test(state.status)?'error':state.status==='ARMED'?'ok':'';
    ui['paper-read'].disabled=!extension||busy||reconciling||state.busy===true||!ctx.source?.sourceTabId;
    const profile=ctx.profile??ctx.account?.review?.profile;
    const eligible=extension&&!busy&&!reconciling&&ctx.source?.active&&ctx.state?.liveEligible&&!ctx.source?.settingsDirty&&profile?.mode==='PAPER'&&profile?.riskBudget<=200&&profile?.maxContracts===1&&ui['paper-consent'].checked&&lastEvidence?.status==='PAPER_UI_VERIFIED'&&lastEvidence.flat===true&&lastEvidence.accountKey;
    ui['paper-arm'].disabled=!eligible||state.status!=='DISARMED';
    ui['paper-disarm'].disabled=state.status==='DISARMED'&&!busy&&!reconciling;
    const draftProfile=['PAPER','RESEARCH'].includes(profile?.mode)&&profile?.maxContracts===1&&profile?.riskBudget>0&&profile.riskBudget<=200&&profile?.pointValue===20&&profile?.tickSize===.25&&/^CME_MINI:NQ(?:1!|[HMUZ]20\d\d)$/.test(profile?.instrument??'');
    ui['paper-test-draft'].disabled=!extension||busy||reconciling||!draftProfile||!ui['paper-consent'].checked||!ctx.source?.sourceTabId||!['DISARMED'].includes(state.status);
    const note=$('paper-verification-status');
    if(note)note.textContent=state.status==='FILLED_PROTECTED'&&state.lastResult?.fillVerified===true?'בחיבור הזה אומתו מילוי חוזה אחד ופקודות הגנה לפי טבלאות הפייפר.':'בדיקת מילוי מאיתות שוק חי עדיין לא הושלמה. טופס בדיקה או פקודה ממתינה אינם הוכחת כניסה או הגנות פעילות.';
    const journal={status:state.status,armed:state.status==='ARMED',journal:state.journal??state.events??[],lastIntent:state.lastIntent??null,lastResult:state.lastResult??null,testDraft},signature=JSON.stringify(journal);
    if(signature!==journalSignature){journalSignature=signature;ui['paper-journal'].textContent=JSON.stringify(journal,null,2);}
  }
  async function resolveTarget(){
    const tabId=context().source?.sourceTabId;
    if(!Number.isSafeInteger(tabId)||tabId<1||!extension||typeof chrome?.tabs?.get!=='function')throw Error('RESEARCH_TAB_REQUIRED');
    const tab=await chrome.tabs.get(tabId),url=new URL(tab.url);
    if(url.protocol!=='https:'||!['tradingview.com','www.tradingview.com'].includes(url.hostname)||!url.pathname.startsWith('/chart/'))throw Error('RESEARCH_CHART_URL_REQUIRED');
    if(context().source?.sourceTabId!==tabId)throw Error('RESEARCH_TAB_CHANGED');
    boundUrl=url.href;boundTabId=tabId;return tabId;
  }
  async function command(action,{intent,accountKey,mode,submission}={}){
    const ctx=context(),tabId=ctx.source?.sourceTabId;
    if(!extension||tabId!==boundTabId||!boundUrl)throw Error('PAPER_TARGET_NOT_BOUND');
    const expected={researchUrl:boundUrl,instrument:ctx.state?.metadata?.instrument??ctx.profile?.instrument,timeframe:'1',...(accountKey?{accountKey}:{} )};
    const result=await chrome.scripting.executeScript({target:{tabId},func:paperTradingUiCommand,args:[{action,expected,...(intent?{intent}:{}),...(mode?{mode}:{}),...(submission?{submission}:{})}],world:'ISOLATED'});
    return result[0]?.result??{status:'PAPER_UI_NO_RESPONSE',reasonCodes:['PAPER_UI_NO_RESPONSE']};
  }
  controller=createPaperExecutionController({getContext:context,now,reserve,onChange:render,
    readEvidence:async({accountKey}={})=>command('read',{accountKey}),
    prepareTicket:async intent=>command('prepare',{intent,accountKey:intent.accountKey}),
    submitTicket:async(intent,{isCurrent}={})=>{
      if(typeof isCurrent!=='function'||!isCurrent())return {status:'CANCELLED',submitted:false,reasonCodes:['PAPER_CONTEXT_INVALIDATED']};
      return command('submit',{intent,accountKey:intent.accountKey});
    },
    verifyResult:async(intent,{submission}={})=>{
      const observed=await command('verify',{intent,accountKey:intent.accountKey,submission});
      return verifyLivePaperUiResult(intent,observed,{now:now(),baselineOrderIds:submission?.baselineOrderIds});
    },
  });
  function renderAccountEvidence(evidence){
    lastEvidence=evidence;
    ui['paper-account-status'].textContent=evidence?.status==='PAPER_UI_VERIFIED'
      ?evidence.flat===true?'חשבון Paper Trading נבדק בגרף המחקר. אין פוזיציה או פקודה עובדת לפי הטבלאות שנקראו.':'חשבון Paper Trading זוהה; פוזיציה, פקודה או מידע חסר חוסמים כניסה נוספת.'
      :'החיבור לפייפר לא אומת: '+(evidence?.reasonCodes??[evidence?.status??'PAPER_EVIDENCE_UNAVAILABLE']).join(' · ');
  }
  const hasSubmissionToReconcile=()=>!!lastControllerState.lastIntent&&(lastControllerState.submissionAttempted===true||lastControllerState.status==='WORKING'||/UNKNOWN/.test(lastControllerState.status));
  async function reconcileCurrent(serial){
    if(reconciling||typeof controller.reconcile!=='function')return;
    reconciling=true;lastReconcileAt=now();render();
    try{
      const result=await controller.reconcile();
      if(serial!==operationSerial)return;
      renderAccountEvidence(result?.lastResult?.rawUiVerification?.evidence??null);
    }catch(error){if(serial===operationSerial)ui['paper-account-status'].textContent='עדכון מצב הפקודה נעצר: '+code(error);}
    finally{if(serial===operationSerial){reconciling=false;render();}}
  }
  async function read(){
    if(busy||reconciling)return;busy=true;const serial=++operationSerial;render();
    try{
      await resolveTarget();
      if(serial!==operationSerial)return;
      if(hasSubmissionToReconcile()){await reconcileCurrent(serial);return;}
      const evidence=await command('read');
      if(serial!==operationSerial)return;
      renderAccountEvidence(evidence);
    }catch(error){if(serial===operationSerial){lastEvidence=null;ui['paper-account-status'].textContent='בדיקת הפייפר נעצרה: '+code(error);}}
    finally{if(serial===operationSerial){busy=false;render();}}
  }
  async function draft(){
    if(busy||ui['paper-test-draft'].disabled)return;busy=true;const serial=++operationSerial;render();
    try{
      await resolveTarget();const evidence=await command('read');
      if(serial!==operationSerial)return;
      if(evidence.status!=='PAPER_UI_VERIFIED')throw Error((evidence.reasonCodes??[evidence.status]).join(' · '));
      const entry=evidence.ticket?.ask;
      if(!Number.isFinite(entry))throw Error('PAPER_TICKET_PRICE_REQUIRED');
      const intent={quantity:1,direction:'LONG',entry,stopTicks:37,targetTicks:74,expectedSymbol:evidence.ticket.symbol,accountKey:evidence.accountKey,expiresAt:now()+15000,testOnly:true};
      const result=await command('prepare',{intent,accountKey:evidence.accountKey,mode:'TEST_DRAFT'});
      if(serial!==operationSerial)return;
      testDraft={scope:'TEST_TICKET_PREPARATION_NO_SIGNAL_NO_SUBMISSION',at:now(),intent,result,ordersCreated:false};
      ui['paper-test-status'].textContent=result.status==='TICKET_PREPARED'?'טופס בדיקה הוכן: חוזה אחד, סטופ 37 טיקים ויעד 74 טיקים. לא נשלחה פקודה; זו אינה בדיקת איתות שוק.':'הכנת טופס הבדיקה נעצרה: '+(result.reasonCodes??[result.status]).join(' · ');
    }catch(error){if(serial===operationSerial)ui['paper-test-status'].textContent='הכנת טופס הבדיקה נעצרה: '+code(error);}
    finally{if(serial===operationSerial){busy=false;render();}}
  }
  async function arm(){
    if(ui['paper-arm'].disabled||busy)return;
    busy=true;const serial=++operationSerial,expectedAccount=lastEvidence?.accountKey;render();
    try{
      await resolveTarget();const evidence=await command('read',{accountKey:expectedAccount});
      if(serial!==operationSerial)return;
      if(!ui['paper-consent'].checked||evidence.status!=='PAPER_UI_VERIFIED'||evidence.flat!==true||evidence.accountKey!==expectedAccount)throw Error('PAPER_ACCOUNT_CHANGED_OR_NOT_FLAT_BEFORE_ARM');
      lastEvidence=evidence;controller.arm({accountKey:evidence.accountKey});
    }catch(error){if(serial===operationSerial){controller.disarm(code(error));ui['paper-account-status'].textContent='הפעלת הפייפר נעצרה: '+code(error);}}
    finally{if(serial===operationSerial){busy=false;render();}}
  }
  function disarm(reason='PAPER_USER_DISARMED'){
    operationSerial++;busy=false;reconciling=false;controller.disarm(reason);ui['paper-consent'].checked=false;
    if(boundUrl&&boundTabId)void command('disarm',{accountKey:lastEvidence?.accountKey}).catch(()=>{});
    render();
  }
  ui['paper-read'].addEventListener('click',()=>{void read();});
  ui['paper-arm'].addEventListener('click',()=>{void arm();});
  ui['paper-disarm'].addEventListener('click',()=>disarm());
  ui['paper-consent'].addEventListener('change',()=>{if(!ui['paper-consent'].checked&&lastControllerState.status!=='DISARMED')disarm('PAPER_CONSENT_REVOKED');else render();});
  ui['paper-test-draft'].addEventListener('click',()=>{void draft();});
  render();
  return {
    accept(alert,analysis,state){return controller.accept(alert,analysis,state);},
    disarm,
    refresh(){
      const ctx=context();
      if((!ctx.source?.active||!ctx.state?.liveEligible||ctx.state?.stale||ctx.state?.requiresSnapshot||ctx.source?.settingsDirty)&&lastControllerState.armed===true){disarm('PAPER_LIVE_SOURCE_NOT_ELIGIBLE');return;}
      render();
      // Read-only best-effort follow-up while one parent remains working. Never
      // runs in DISARMED/UNKNOWN and never calls preparation or submission.
      if(lastControllerState.status==='WORKING'&&hasSubmissionToReconcile()&&!busy&&!reconciling&&now()-lastReconcileAt>=1000)void reconcileCurrent(operationSerial);
    },
    snapshot(){return {...controller.snapshot(),connection:lastEvidence?copy(lastEvidence):null,testDraft:copy(testDraft),target:{tabId:boundTabId,researchUrl:boundUrl},brokerConnectionIsPaperOnly:true};},
  };
}
