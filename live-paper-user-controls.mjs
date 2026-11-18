import {createExecutionSessionRunner} from './execution-session-runner.mjs';
import {createExecutionAttemptLedger} from './execution-attempt-ledger.mjs';
import {paperUserMarketUiCommand} from './paper-user-market-ui.mjs';
import {selectGuideTechnicalDecision,corroborateGuideTechnicalDecision,GUIDE_TECHNICAL_DECISION_VERSION,GUIDE_TECHNICAL_CHECK_IDS} from './guide-technical-decision.mjs';
import {GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';
import {selectFreshLiveSignal} from './live-signal-eligibility.mjs';

const copy=x=>structuredClone(x),finite=Number.isFinite,integer=Number.isSafeInteger;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=16384&&!/[\u0000-\u001f\u007f]/.test(x);
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const same=(a,b)=>canonical(a)===canonical(b),tick=x=>finite(x)&&x>0&&integer(x/.25);
const ids=['paper-user-panel','paper-user-inspect','paper-user-consent','paper-user-arm','paper-user-disarm','paper-user-status','paper-user-account','paper-user-journal'];
const statusLabels={INACTIVE:'כניסת Paper כבויה',WAITING_NEW_SIGNAL:'Paper דרוך · ממתין לאישור טכני חדש',WAITING_NEXT_SIGNAL:'הסגירה אומתה · ממתין לאישור הבא',RECONCILIATION_REQUIRED:'ניסיון Paper נשלח · מילוי עדיין לא אומת',RECOVERY_REQUIRED:'ניסיון שמור מחייב בירור · אין שיגור חוזר',CLOSED_REVIEW_REQUIRED:'סגירת ניסיון משוחזר אומתה · נדרשת הפעלה חדשה',CLOSED_VERIFYING:'נדרשת דגימת סגירה שנייה',FILLED:'מילוי Paper אומת · ניהול העסקה בידיך',WORKING:'פקודת Paper ממתינה',UNKNOWN:'תוצאת הניסיון אינה ודאית',DISCONNECTED:'המקור או החשבון אינם מאומתים כרגע',NOT_READY:'הפעלת Paper חסומה'};
const startupReasonLabels={NATIVE_START_TIMEOUT:'ההפעלה נעצרה כי מקור TradingView טרם הגיע למצב חי מאומת בזמן ההמתנה.',PAPER_DEMO_PROFILE_REQUIRED:'יש לבחור פרופיל Paper מסוג DEMO לפני ההפעלה.',MULTIPLE_RESEARCH_TABS:'נמצאו כמה לשוניות מחקר; לא נבחר יעד באופן אוטומטי.',RESEARCH_START_TIMEOUT:'המקור החי לא היה מוכן בזמן הקצוב. הבוט לא נדרך.',RESEARCH_PAPER_UI_UNAVAILABLE:'לא ניתן היה לאמת את חשבון הפייפר ואת בקרי המסחר בחלון המחקר.',STOP_OTHER_SOURCE_BEFORE_START:'מקור אחר כבר פעיל. יש לעצור אותו לפני הפעלת מחקר הפייפר.',RESEARCH_SOURCE_CHANGED:'לשונית המחקר או מקור הנתונים השתנו במהלך ההפעלה. הבוט לא נדרך.',EXECUTION_ADAPTER_NOT_IMPLEMENTED:'מסלול ביצוע אוטומטי ל־PA עדיין אינו מחובר.',PA_PREPARATION_RESULT_NOT_VERIFIED:'תוצאת בדיקת ה־PA לא אומתה כתצפית לקריאה בלבד.',EXACT_TRADOVATE_PROVIDER_REQUIRED:'ב־TradingView נדרש חיבור Tradovate התואם לחשבון ה־PA שנבחר.',SELECTED_AND_VISIBLE_PA_ACCOUNT_DIFFER:'החשבון הגלוי ב־TradingView אינו תואם ל־PA שנבחר.',NEW_NATIVE_MARKET_ORDER_TICKET_REQUIRED:'יש להציג את כרטיס Order המקורי כדי לקרוא את הפריסט.'};
const reasonText=value=>startupReasonLabels[value]??value;

// Provider-specific native commands remain separate. The generic runner owns
// durable claims and lifecycle; selecting a profile never starts execution.
export function createLivePaperUserControls({document,chrome,extension,getContext,prepareSession,prepareOtherAccount,prepareBrokerSession,nativeCommandForProfile,onStart,onEntrySubmission=()=>{},onVerifiedFill=()=>{},now=Date.now,locks=globalThis.navigator?.locks,
  performanceEpoch=()=>globalThis.performance.timeOrigin+globalThis.performance.now(),receiverTimeOrigin=()=>globalThis.performance?.timeOrigin,
  requestAnimationFrame=globalThis.requestAnimationFrame?.bind(globalThis),cancelAnimationFrame=globalThis.cancelAnimationFrame?.bind(globalThis),
  isVisible=()=>{if(document?.visibilityState!=='visible'||document?.hidden===true)return false;let node=document?.getElementById('paper-user-status'),depth=0;const styleOf=document?.defaultView?.getComputedStyle?.bind(document.defaultView)??globalThis.getComputedStyle;if(!node?.isConnected||typeof styleOf!=='function')return false;for(;node&&depth<64;node=node.parentElement,depth++){const style=styleOf(node);if(node.hidden||style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.contentVisibility==='hidden'||style.opacity!==''&&Number(style.opacity)===0)return false;}return !node;},
  isOnscreen=()=>{const node=document?.getElementById('paper-user-status'),r=node?.getBoundingClientRect?.(),view=document?.defaultView??globalThis;return node?.isConnected===true&&!!r&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&finite(view.innerWidth)&&finite(view.innerHeight)&&r.right<=view.innerWidth&&r.bottom<=view.innerHeight;},
}={}){
  if(typeof getContext!=='function'||typeof now!=='function')throw TypeError('PAPER_USER_CONTEXT_REQUIRED');
  if(prepareSession!==undefined&&typeof prepareSession!=='function')throw TypeError('PAPER_USER_SESSION_PREPARATION_CALLBACK_REQUIRED');
  if(prepareOtherAccount!==undefined&&typeof prepareOtherAccount!=='function')throw TypeError('OTHER_ACCOUNT_PREPARATION_CALLBACK_REQUIRED');
  if(prepareBrokerSession!==undefined&&typeof prepareBrokerSession!=='function')throw TypeError('BROKER_SESSION_PREPARATION_CALLBACK_REQUIRED');
  if(nativeCommandForProfile!==undefined&&typeof nativeCommandForProfile!=='function')throw TypeError('NATIVE_COMMAND_RESOLVER_REQUIRED');
  if([performanceEpoch,receiverTimeOrigin,isVisible,isOnscreen].some(fn=>typeof fn!=='function'))throw TypeError('PAPER_USER_TIMING_CALLBACKS_REQUIRED');
  const ui=Object.fromEntries(ids.map(id=>[id,document?.getElementById(id)]));
  if(Object.values(ui).some(node=>!node))return {accept(){},activate(){},refresh(){},disconnect(){},disarm(){},dispose(){},snapshot:()=>({status:'UNAVAILABLE',ordersCreated:false,realBrokerOrdersAuthorized:false})};
  const power={bar:document?.getElementById('paper-user-power-bar'),state:document?.getElementById('paper-user-power-state'),detail:document?.getElementById('paper-user-power-detail')};
  let disposed=false,operation=0,busy=false,presentationBusy=false,wanted=false,timer=null,lastLoopAt=-Infinity,candidate=null,nativeEvidence=null,bound=null,preparedConnection=null,lastNativeResult=null,lastError=null,pendingStored=false,releasedClosedKey=null,pendingNativeFill=null,lastVerifiedFill=null,pendingSignalWake=false,lastWakeEvent=null;
  let entryMarkerLedger=[],entryMarkerFillFacts=[];
  const listeners=[],journal=[],attemptAnchors=new Map(),recordedFills=new Set(),attemptTimings=new Map();
  let latestTiming=null,pendingFillPaint=null,paintSerial=0,startup=null,startupMeasurement=null,startupMeasurementOrigin=null,otherAccountPreparation=null,otherPreparationSelection=null;
  function recordJournal(value){journal.push(value);if(journal.length>30)journal.shift();}
  const context=()=>getContext()??{};
  const recent=(at,age=2000)=>finite(at)&&at<=now()&&now()-at<=age;
  const epoch=()=>{try{const value=performanceEpoch();return finite(value)&&value>=0?value:null;}catch{return null;}};
  const receiverOrigin=()=>{try{const value=receiverTimeOrigin();return finite(value)&&value>=0?value:null;}catch{return null;}};
  function beginStartupMeasurement(){try{Promise.resolve(onStart?.()).catch(()=>{});}catch{}startupMeasurementOrigin=receiverOrigin();startupMeasurement={startedAt:epoch(),activeAt:null,elapsedMs:null,status:'STARTING',clockDomain:'RECEIVER_PERFORMANCE_EPOCH'};return startupMeasurement;}
  function finishStartupMeasurement(measurement,status){
    if(measurement!==startupMeasurement||measurement?.status!=='STARTING')return;
    const state=runner.snapshot(),active=status==='ACTIVE'&&wanted&&state.running&&state.lifecycle?.connected===true&&state.lifecycle?.entryAllowed===true;
    measurement.status=status==='ACTIVE'&&!active?'NOT_ACTIVE':status;
    if(active){const at=epoch();if(finite(measurement.startedAt)&&finite(at)&&at>=measurement.startedAt&&startupMeasurementOrigin!==null&&receiverOrigin()===startupMeasurementOrigin){measurement.activeAt=at;measurement.elapsedMs=at-measurement.startedAt;}}
  }
  function ownedOrigin(item){
    const p=item?.sourceObservation,unavailable=code=>({sourceObservation:null,sourceObservationStatus:'UNAVAILABLE',sourceObservationReasonCodes:[code]});
    if(!p)return unavailable('SOURCE_PACKET_ORIGIN_MISSING');
    if(p.kind!=='OWNED_SOURCE_PACKET_ORIGIN_V1'||p.sessionId!==context().source?.sessionId||p.packetId!==item.sourcePacketId||!text(p.packetId)||!finite(p.sourceAppearanceEpochMs)||!finite(p.sourceDocumentTimeOrigin)||p.sourceDocumentTimeOrigin<0||p.sourceAppearanceEpochMs<p.sourceDocumentTimeOrigin||!integer(p.sourceSequence)||p.sourceSequence<0)return unavailable('SOURCE_PACKET_ORIGIN_IDENTITY_OR_CLOCK_INVALID');
    const value=Object.fromEntries(['kind','sessionId','packetId','sourceAppearanceEpochMs','sourceDocumentTimeOrigin','sourceSequence','sourceTransport','sourceObservationMeaning'].filter(k=>p[k]!==undefined).map(k=>[k,copy(p[k])]));
    const c=p.calibration;if(c&&[c.receiverTimeOrigin,c.sourceAppearanceEarliestReceiverPerformanceMs,c.sourceAppearanceLatestReceiverPerformanceMs].every(finite)&&c.receiverTimeOrigin>=0&&c.sourceAppearanceEarliestReceiverPerformanceMs>=0&&c.sourceAppearanceLatestReceiverPerformanceMs>=c.sourceAppearanceEarliestReceiverPerformanceMs){value.calibration=copy(c);if(finite(p.calibrationBracketMs)&&p.calibrationBracketMs>=0)value.calibrationBracketMs=p.calibrationBracketMs;}
    return {sourceObservation:value,sourceObservationStatus:'MATCHED_OWNED_PACKET',sourceObservationReasonCodes:[]};
  }
  function newTiming(key,anchor){
    const value={kind:'LIVE_PAPER_SOURCE_TO_VERIFIED_FILL_TIMING_V1',attemptKey:key,measurementAnchor:copy(anchor),nativeClick:null,nativeFill:null,
      sourceToClickMs:null,sourceToVerifiedFillMs:null,clickToVerifiedFillMs:null,sourceClockMatched:false,
      nativeTimingStatus:'UNAVAILABLE',reasonCodes:[...(anchor?.sourceObservationReasonCodes??['SOURCE_PACKET_ORIGIN_MISSING'])],
      fillStatusDisplay:{status:'NOT_MEASURED',reasonCodes:['NATIVE_FILL_NOT_VERIFIED']},
      scope:'First extension-observed source DOM packet to native click dispatch and native fill verification. Receiver status painting is measured separately; no exchange, screen capture or physical pixels.',
      marketLatencyMeasured:false,physicalDisplayMeasured:false,protectionVerified:false};
    attemptTimings.set(key,value);latestTiming=value;return value;
  }
  function recordClickTiming(key,reply){
    const value=attemptTimings.get(key);if(!value)return;
    const d=reply?.documentTimeOrigin,c=finite(d)&&finite(reply?.submittedPerformance)?d+reply.submittedPerformance:null;
    if(!['PAPER_USER_SUBMITTED_UNCONFIRMED','TRADOVATE_USER_SUBMITTED_UNCONFIRMED'].includes(reply?.status)||reply.submitted!==true||reply.attemptKey!==key||!finite(d)||d<0||!finite(reply.submittedPerformance)||reply.submittedPerformance<0||!finite(c)||!finite(reply.verificationEpochMs)||reply.verificationEpochMs<c){value.reasonCodes.push('NATIVE_CLICK_CLOCK_OR_RECEIPT_UNVERIFIED');return;}
    value.nativeClick={documentTimeOrigin:d,submittedPerformance:reply.submittedPerformance,clickDispatchEpochMs:c,verificationEpochMs:reply.verificationEpochMs};
    const origin=value.measurementAnchor?.sourceObservation;
    if(!origin)return;
    if(origin.sourceDocumentTimeOrigin!==d){value.reasonCodes.push('SOURCE_AND_NATIVE_DOCUMENT_CLOCK_MISMATCH');return;}
    if(c<origin.sourceAppearanceEpochMs){value.reasonCodes.push('SOURCE_ORIGIN_FOLLOWS_NATIVE_CLICK');return;}
    if(c-origin.sourceAppearanceEpochMs>30000){value.reasonCodes.push('SOURCE_PACKET_ORIGIN_STALE_AT_CLICK');return;}
    value.sourceClockMatched=true;value.sourceToClickMs=c-origin.sourceAppearanceEpochMs;value.nativeTimingStatus='SOURCE_TO_CLICK_MEASURED';
  }
  function recordFillTiming(key,reply){
    const value=attemptTimings.get(key)??newTiming(key,attemptAnchors.get(key)??null),f=reply?.verificationEpochMs,d=reply?.documentTimeOrigin;
    value.nativeFill={documentTimeOrigin:finite(d)?d:null,verificationEpochMs:finite(f)?f:null,nativeOrderId:reply.nativeOrderId};
    value.receiverFillVerifiedEpochMs=epoch();value.receiverDocumentTimeOrigin=receiverOrigin();
    const click=value.nativeClick;
    if(!click)value.reasonCodes.push('NATIVE_CLICK_RECEIPT_MISSING');
    else if(d!==click.documentTimeOrigin||!finite(f))value.reasonCodes.push('NATIVE_FILL_DOCUMENT_CLOCK_UNVERIFIED');
    else if(f<click.clickDispatchEpochMs)value.reasonCodes.push('NATIVE_FILL_PRECEDES_CLICK');
    else{
      value.clickToVerifiedFillMs=f-click.clickDispatchEpochMs;
      if(value.sourceClockMatched){value.sourceToVerifiedFillMs=f-value.measurementAnchor.sourceObservation.sourceAppearanceEpochMs;value.nativeTimingStatus='SOURCE_TO_NATIVE_FILL_VERIFICATION_MEASURED';}
    }
    value.protectionVerified=verifiedProtection(reply);
    value.sourceToVerifiedProtectedFillMs=value.protectionVerified?value.sourceToVerifiedFillMs:null;
    if(value.protectionVerified&&finite(value.sourceToVerifiedFillMs))value.nativeTimingStatus='SOURCE_TO_NATIVE_PROTECTED_FILL_VERIFICATION_MEASURED';
    latestTiming=value;return value;
  }
  function cancelFillPaint(code){
    if(!pendingFillPaint)return;const pending=pendingFillPaint;pendingFillPaint=null;paintSerial++;
    for(const handle of pending.handles)try{cancelAnimationFrame?.(handle);}catch{}
    pending.timing.fillStatusDisplay.status='UNAVAILABLE';pending.timing.fillStatusDisplay.reasonCodes=[code];
  }
  function beginFillPaint(value){
    cancelFillPaint('FILLED_STATUS_SUPERSEDED');
    const display=value.fillStatusDisplay={status:'PENDING',reasonCodes:[],receiverDocumentTimeOrigin:receiverOrigin(),mutationEpochMs:epoch(),firstPaintOpportunityEpochMs:null,secondPaintOpportunityEpochMs:null,
      sourceToMutationLowerMs:null,sourceToMutationUpperMs:null,sourceToPaintLowerMs:null,sourceToPaintUpperMs:null,physicalDisplayMeasured:false,
      boundary:'FIRST_VERIFIED_FILLED_STATUS_RENDER_BEFORE_TIMING_ANNOTATION'};
    if(!finite(display.mutationEpochMs)||display.receiverDocumentTimeOrigin===null||!finite(value.receiverFillVerifiedEpochMs)||display.mutationEpochMs<value.receiverFillVerifiedEpochMs){display.status='UNAVAILABLE';display.reasonCodes=['RECEIVER_PERFORMANCE_CLOCK_UNAVAILABLE_OR_REGRESSED'];return;}
    display.receiverVerificationToMutationMs=display.mutationEpochMs-value.receiverFillVerifiedEpochMs;
    try{if(!isVisible()){display.status='UNAVAILABLE';display.reasonCodes=['FILLED_STATUS_HIDDEN'];return;}if(!isOnscreen()){display.status='UNAVAILABLE';display.reasonCodes=['FILLED_STATUS_OFFSCREEN_OR_UNOBSERVABLE'];return;}}catch{display.status='UNAVAILABLE';display.reasonCodes=['FILLED_STATUS_VISIBILITY_CHECK_FAILED'];return;}
    if(typeof requestAnimationFrame!=='function'){display.status='UNAVAILABLE';display.reasonCodes=['RECEIVER_ANIMATION_FRAME_UNAVAILABLE'];return;}
    const pending={token:++paintSerial,timing:value,handles:[],operation};pendingFillPaint=pending;
    const valid=()=>{
      if(disposed||pendingFillPaint!==pending||pending.token!==paintSerial||pending.operation!==operation)return false;
      const s=runner.snapshot();if(s.status!=='FILLED'||s.ownedRecord?.key!==value.attemptKey){cancelFillPaint('FILLED_STATUS_NO_LONGER_CURRENT');return false;}
      try{if(!isVisible()){cancelFillPaint('FILLED_STATUS_HIDDEN');return false;}if(!isOnscreen()){cancelFillPaint('FILLED_STATUS_OFFSCREEN_OR_UNOBSERVABLE');return false;}}catch{cancelFillPaint('FILLED_STATUS_VISIBILITY_CHECK_FAILED');return false;}return true;
    };
    const capture=first=>{
      if(!valid())return;const at=epoch(),previous=first?display.mutationEpochMs:display.firstPaintOpportunityEpochMs;
      if(!finite(at)||at<previous||receiverOrigin()!==display.receiverDocumentTimeOrigin){cancelFillPaint('RECEIVER_PERFORMANCE_CLOCK_CHANGED_OR_REGRESSED');return;}
      if(first){display.firstPaintOpportunityEpochMs=at;try{pending.handles.push(requestAnimationFrame(()=>capture(false)));}catch{cancelFillPaint('RECEIVER_ANIMATION_FRAME_FAILED');}return;}
      display.secondPaintOpportunityEpochMs=at;display.receiverVerificationToPaintLowerMs=display.firstPaintOpportunityEpochMs-value.receiverFillVerifiedEpochMs;display.receiverVerificationToPaintUpperMs=at-value.receiverFillVerifiedEpochMs;
      const calibration=value.measurementAnchor?.sourceObservation?.calibration;
      display.status='MEASURED_RECEIVER_CLOCK_ONLY';display.reasonCodes=['SOURCE_RECEIVER_CALIBRATION_UNAVAILABLE'];
      if(calibration&&value.sourceClockMatched&&finite(value.sourceToVerifiedFillMs)&&calibration.receiverTimeOrigin===display.receiverDocumentTimeOrigin){
        const earliest=calibration.sourceAppearanceEarliestReceiverPerformanceMs,latest=calibration.sourceAppearanceLatestReceiverPerformanceMs,mutation=display.mutationEpochMs-display.receiverDocumentTimeOrigin,firstAt=display.firstPaintOpportunityEpochMs-display.receiverDocumentTimeOrigin,lastAt=at-display.receiverDocumentTimeOrigin;
        if(mutation>=earliest){Object.assign(display,{status:'MEASURED_SOURCE_CALIBRATED_INTERVAL',reasonCodes:[],sourceToMutationLowerMs:Math.max(0,mutation-latest),sourceToMutationUpperMs:mutation-earliest,sourceToPaintLowerMs:Math.max(0,firstAt-latest),sourceToPaintUpperMs:lastAt-earliest});}
        else display.reasonCodes=['SOURCE_RECEIVER_CALIBRATION_TIME_ORDER_INVALID'];
      }else if(calibration)display.reasonCodes=[calibration.receiverTimeOrigin!==display.receiverDocumentTimeOrigin?'SOURCE_RECEIVER_DOCUMENT_CLOCK_MISMATCH':'SOURCE_NATIVE_FILL_CLOCK_NOT_CORROBORATED'];
      pendingFillPaint=null;recordJournal({phase:'VERIFIED_FILL_STATUS_PAINT_OPPORTUNITIES',attemptKey:value.attemptKey,timing:copy(value)});render();
    };
    try{pending.handles.push(requestAnimationFrame(()=>capture(true)));}catch{cancelFillPaint('RECEIVER_ANIMATION_FRAME_FAILED');}
  }
  function captureVerifiedFill(state){
    if(!['FILLED','CLOSED_VERIFYING','WAITING_NEXT_SIGNAL','CLOSED_REVIEW_REQUIRED'].includes(state.status)||pendingNativeFill?.fillVerified!==true||pendingNativeFill?.intentKey!==(state.ownedRecord?.key??state.lifecycle?.lastClosedAttempt?.attemptKey)||recordedFills.has(pendingNativeFill.intentKey))return null;
    const fillKey=pendingNativeFill.intentKey;recordedFills.add(fillKey);lastVerifiedFill=copy(pendingNativeFill);
    const timing=recordFillTiming(fillKey,pendingNativeFill);
    try{Promise.resolve(onVerifiedFill(copy(pendingNativeFill))).catch(()=>{});}catch{}
    recordJournal({phase:'NATIVE_FILLED_VERIFIED',observedAtReceiver:now(),attemptKey:fillKey,eventId:state.ownedRecord?.eventIdentity?.eventId??state.lifecycle?.lastClosedAttempt?.signal?.eventId,measurementAnchor:copy(attemptAnchors.get(fillKey)??null),result:copy(pendingNativeFill),timing:copy(timing),timingScope:'SAME_NATIVE_DOCUMENT_SOURCE_TO_FILL_VERIFICATION_WHEN_MATCHED_RECEIVER_RENDER_SEPARATE'});return timing;
  }
  function timingText(){
    if(!latestTiming?.nativeFill)return '';
    const value=latestTiming,display=value.fillStatusDisplay,ms=x=>x.toFixed(1);
    let out=finite(value.sourceToVerifiedFillMs)?` · מדידת המילוי האחרון: מקור DOM→אימות ${value.protectionVerified?'מילוי והגנות מקוריות':'מילוי'} ${ms(value.sourceToVerifiedFillMs)} ms`:' · השהיית מקור DOM→אימות מילוי אינה זמינה: '+value.reasonCodes.join(' · ');
    if(finite(value.sourceToClickMs))out+=` · מקור DOM→לחיצה ${ms(value.sourceToClickMs)} ms`;
    if(display.status==='MEASURED_SOURCE_CALIBRATED_INTERVAL')out+=` · מקור DOM→תצוגת מילוי ${ms(display.sourceToPaintLowerMs)}–${ms(display.sourceToPaintUpperMs)} ms (הזדמנויות ציור)`;
    else if(display.status==='MEASURED_RECEIVER_CLOCK_ONLY')out+=' · תצוגת המילוי נמדדה בשעון המקבל בלבד; אין מדד מלא מקור→תצוגה';
    else if(display.status==='UNAVAILABLE')out+=' · מדידת תצוגת המילוי חסרה: '+display.reasonCodes.join(' · ');
    return out+' · זמן בורסה והצגת פיקסלים אינם נמדדים.';
  }
  const profile=c=>c.account?.brokerProfile;
  const isPaper=c=>profile(c)?.enabled===true&&profile(c).provider==='TRADINGVIEW_PAPER'&&profile(c).environment==='DEMO'&&profile(c).userManagedRisk===true&&integer(profile(c).revision)&&profile(c).revision>0&&text(profile(c).nativeAccountId)&&text(c.account?.selectionFingerprint);
  const isPa=c=>profile(c)?.enabled===true&&profile(c).provider==='TRADOVATE'&&profile(c).environment==='PA'&&profile(c).userManagedRisk===true&&integer(profile(c).revision)&&profile(c).revision>0&&text(profile(c).nativeAccountId)&&text(c.account?.selectionFingerprint)&&c.profile?.mode==='USER_MANAGED'&&c.profile.risk===null;
  const isTradovate=c=>profile(c)?.enabled===true&&profile(c).provider==='TRADOVATE'&&['PA','LIVE','DEMO','EVALUATION'].includes(profile(c).environment)&&profile(c).userManagedRisk===true&&integer(profile(c).revision)&&profile(c).revision>0&&text(profile(c).nativeAccountId)&&text(c.account?.selectionFingerprint)&&c.profile?.mode==='USER_MANAGED'&&c.profile.risk===null;
  const brokerExecutionConfigured=c=>isTradovate(c)&&typeof prepareBrokerSession==='function'&&typeof nativeCommandForProfile==='function';
  const executableAccount=c=>isPaper(c)||brokerExecutionConfigured(c);
  const readonlyPa=c=>isPa(c)&&!brokerExecutionConfigured(c);
  const accountLabel=c=>isTradovate(c)?`Tradovate ${profile(c).environment}`:'Paper';
  const nativeStatus=(c,suffix)=>(isTradovate(c)?'TRADOVATE_USER_':'PAPER_USER_')+suffix;
  const nativeIdentityValid=(e,c)=>isPaper(c)?e?.environmentVerified===true:isTradovate(c)&&e?.environmentVerified===false&&e?.environmentBasis==='USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'&&e?.nativeIdentityVerified===true;
  const preparationIdentity=c=>({profile:profile(c),selectionKey:c.account?.selectionFingerprint});
  const otherPending=()=>startup?.phase==='OTHER_ACCOUNT_PREPARATION';
  function readonlyPreparation(result,selected,{status,reason}={}){
    const valid=result?.kind==='TRADOVATE_NATIVE_READINESS_V1'&&['PREPARATION_ONLY','INCOMPLETE','BLOCKED'].includes(result.status)&&result.readOnly===true&&result.ordersCreated===false&&result.submitted===false&&result.botActive===false&&result.executionReady===false&&result.realBrokerOrdersAuthorized===false
      &&result.capabilities?.inspectAccount===true&&['preflight','submitMarket','reconcile'].every(k=>result.capabilities[k]===false)&&recent(result.observedAt)
      &&(!result.account||result.account.provider==='TRADOVATE'&&result.account.nativeAccountId===selected.profile.nativeAccountId&&result.account.environment==='PA'&&result.account.environmentVerified===false&&result.account.ordersAuthorized===false)
      &&(result.status!=='PREPARATION_ONLY'||result.account?.nativeIdentityVerified===true)
      &&(!result.preset||result.preset.readOnly===true&&['freshApplicationVerified','inheritanceVerified','protectionVerified','inputValuesSetByDriver'].every(k=>result.preset[k]===false))
      &&(!result.inventory||['positionsComplete','workingOrdersComplete','flatVerified'].every(k=>result.inventory[k]===false));
    const codes=[...new Set(['EXECUTION_ADAPTER_NOT_IMPLEMENTED',...(valid&&Array.isArray(result.missingChecks)?result.missingChecks.filter(c=>text(c)&&c.length<=160):[]),...(!valid&&!status?['PA_PREPARATION_RESULT_NOT_VERIFIED']:[]),...(reason?[reason]:[])])];
    return {kind:'PA_READ_ONLY_PREPARATION_SESSION_V1',status:status??(valid?result.status:'BLOCKED'),selectedAccount:{provider:'TRADOVATE',environment:'PA',nativeAccountId:selected.profile.nativeAccountId,revision:selected.profile.revision},
      observedAt:valid?result.observedAt:null,finishedAt:now(),readOnly:true,botActive:false,executionReady:false,armed:false,submitted:false,ordersCreated:false,realBrokerOrdersAuthorized:false,
      capabilities:{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false},
      account:valid?copy(result.account):null,source:valid?copy(result.source):null,preset:valid?copy(result.preset):null,inventory:valid?copy(result.inventory):null,checks:valid&&Array.isArray(result.checks)?copy(result.checks):[],missingChecks:codes,reasonCodes:codes};
  }
  const target=c=>({researchUrl:c.source?.researchUrl??c.account?.review?.sourceUrl,sourceTabId:c.source?.sourceTabId,provider:profile(c)?.provider,environment:profile(c)?.environment,nativeAccountId:profile(c)?.nativeAccountId,accountRevision:profile(c)?.revision,selectionKey:c.account?.selectionFingerprint,allowResearchLiveMultiChart:true});
  const stableTarget=t=>({researchUrl:t?.researchUrl,sourceTabId:t?.sourceTabId,provider:t?.provider,environment:t?.environment,nativeAccountId:t?.nativeAccountId,accountRevision:t?.accountRevision,selectionKey:t?.selectionKey});
  function pinExecutionSurface(e){
    if(!['DOM_MARKET','USER_MANAGED_CHART_MARKET','ORDER_TICKET_PRESET'].includes(e?.executionSurface))throw Error('PAPER_USER_EXECUTION_SURFACE_UNVERIFIED');
    const pin={executionSurface:e.executionSurface};
    if(e.executionSurface==='ORDER_TICKET_PRESET'){
      const application=e.nativePreset?.application;
      if(!text(application?.name)||application.nameVerified!==true||application.freshNoticeVerified!==true)throw Error('PAPER_USER_NAMED_NATIVE_PRESET_UNVERIFIED');
      pin.nativePresetName=application.name;
    }
    if(e.executionSurface==='USER_MANAGED_CHART_MARKET'){
      if(!text(e.nativePreset?.fingerprint))throw Error('NATIVE_USER_PRESET_FINGERPRINT_REQUIRED');
      pin.nativePresetFingerprint=e.nativePreset.fingerprint;
    }
    bound={...bound,...pin};
  }
  function verifiedSource(c,maxReceiptAgeMs){
    const s=c.source,v=c.state,m=v?.metadata,p=profile(c),closed=v?.bars?.at(-1),t=target(c);
    if(!extension||!executableAccount(c)||c.profile?.mode!=='USER_MANAGED'||c.profile?.risk!==null||c.account?.reviewAccepted!==true||!c.account.review?.nativeIdentityVerified||isPaper(c)&&!c.account.review?.environmentVerified
      ||c.account.review?.brokerProfile?.provider!==p.provider||c.account.review.brokerProfile.environment!==p.environment||c.account.review.brokerProfile.nativeAccountId!==p.nativeAccountId||c.account.review?.reviewId!==s?.accountReviewId||c.account.review?.sourceTabId!==s?.sourceTabId||c.account.review.sourceUrl!==t.researchUrl||s?.active!==true||s.mode!=='LIVE'||s.settingsDirty===true||!text(s.sessionId)||!text(s.runId)||!integer(s.generation)||!integer(s.sourceTabId)||s.sourceTabId<1||!text(t.researchUrl)
      ||v?.ready!==true||v.liveEligible!==true||v.connected!==true||v.stale!==false||v.requiresSnapshot!==false||v.contextOnly===true||!recent(v.lastReceivedAt,maxReceiptAgeMs)||v.generation!==s.generation
      ||m?.source!=='ohlc'||m.instrument!=='CME_MINI:NQ1!'||m.timeframe!=='1'||m.timeframeMs!==60000||m.sourceId!==s.runId||m.tabId!==s.sourceTabId||m.currency!=='USD'||m.tickSize!==.25||m.pointValue!==20||!['standard','candles'].includes(m.chartType)||m.replay===true||m.realtime===false||m.synthetic===true||m.testOnly===true
      ||closed?.closed!==true||closed.finalOhlcVerified!==true||!integer(closed.time)||closed.closeTime-closed.time!==60000||!['open','high','low','close'].every(k=>tick(closed[k])))throw Error('PAPER_USER_FRESH_VERIFIED_LIVE_SOURCE_REQUIRED');
    return {sourceTabId:s.sourceTabId,researchUrl:t.researchUrl,sessionId:s.sessionId,runId:s.runId,generation:s.generation,asOfTime:closed.closeTime,
      closedBar:Object.fromEntries(['time','closeTime','open','high','low','close'].map(k=>[k,closed[k]])),instrument:'CME_MINI:NQ1!',timeframe:'1',mode:'LIVE'};
  }
  const source=(c=context())=>verifiedSource(c,2000);
  // Quiet producer intervals may exceed the entry freshness window. Read-only
  // connection health follows the existing 15s LIVE bound without restamping a
  // packet. Approval, inspection, preparation and dispatch still use source().
  const sourceForConnection=(c=context())=>verifiedSource(c,15000);
  const sourceKey=t=>canonical([t.researchUrl,t.sourceTabId,'CME_MINI:NQ1!','1']);
  async function native(action,extra={}){
    if(disposed||!extension||!chrome?.scripting?.executeScript)throw Error('PAPER_USER_EXTENSION_REQUIRED');
    const c=context(),expected=bound??target(c),token=operation;
    if(action!=='disarm'&&(!executableAccount(c)||!same(stableTarget(expected),stableTarget(target(c)))))throw Error('PAPER_USER_SELECTED_ACCOUNT_CHANGED');
    const before=await chrome.tabs.get(expected.sourceTabId);if(before.url!==expected.researchUrl)throw Error('PAPER_USER_SOURCE_TAB_CHANGED');
    if(disposed||token!==operation||action!=='disarm'&&!same(stableTarget(expected),stableTarget(target(context()))))throw Error('PAPER_USER_CONTEXT_CHANGED');
    const command=nativeCommandForProfile?.(copy(profile(c)))??(isPaper(c)?paperUserMarketUiCommand:null);
    if(typeof command!=='function')throw Error('EXECUTION_ADAPTER_NOT_IMPLEMENTED');
    const executionAuthorized=executableAccount(c)&&wanted&&ui['paper-user-consent'].checked===true;
    const rows=await chrome.scripting.executeScript({target:{tabId:expected.sourceTabId},world:'ISOLATED',func:command,args:[{action,expected:{...copy(expected),executionAuthorized},...copy(extra)}]});
    const after=await chrome.tabs.get(expected.sourceTabId);
    if(disposed||token!==operation||after.url!==expected.researchUrl||rows.length!==1||action!=='disarm'&&!same(stableTarget(expected),stableTarget(target(context()))))throw Error('PAPER_USER_CONTEXT_CHANGED');
    const result=rows[0]?.result??{status:'UNKNOWN'};
    // A preparation is an opaque native lease. Rewriting its nested status
    //changes the object checked by the private source-side lease at dispatch.
    if(result.kind==='EXECUTION_SESSION_NATIVE_PREPARATION_V1'){lastNativeResult=copy(result);return result;}
    // The shared chart command preserves the real provider/account evidence;
    // only its generic status vocabulary is projected for the existing UI.
    const normalizeReply=value=>typeof value?.status==='string'&&value.status.startsWith('NATIVE_USER_')?{...value,nativeStatus:value.status,status:nativeStatus(c,value.status.slice('NATIVE_USER_'.length))}:value;
    const normalized=normalizeReply(result);
    if(result.connection)normalized.connection=normalizeReply(result.connection);
    lastNativeResult=copy(normalized);return normalized;
  }
  const ledger=createExecutionAttemptLedger({storage:extension?chrome?.storage?.local:null,locks,now});
  function checkedConnection(e,s,c=context()){
    const p=profile(c),t=target(c);
    if(e?.status!==nativeStatus(c,'CONNECTION_VERIFIED')||e.provider!==p?.provider||e.environment!==p?.environment||!nativeIdentityValid(e,c)||e.nativeAccountId!==p?.nativeAccountId||e.sourceVerified!==true||e.synthetic===true||e.testOnly===true||!recent(e.observedAt)
      ||!/^NQ[HMUZ]20\d\d$/.test(e.symbol??'')||!integer(e.quantity)||e.quantity<1||e.quantity>1000000||e.latestClosedAt!==s.asOfTime)throw Error('PAPER_USER_NATIVE_CONNECTION_NOT_VERIFIED');
    if(bound?.executionSurface&&(e.executionSurface!==bound.executionSurface||bound.nativePresetName&&e.nativePreset?.application?.name!==bound.nativePresetName||bound.nativePresetFingerprint&&e.nativePreset?.fingerprint!==bound.nativePresetFingerprint))throw Error('PAPER_USER_PINNED_PRESET_OR_SURFACE_CHANGED');
    const binding={accountIdentity:{provider:p.provider,environment:p.environment,nativeAccountId:p.nativeAccountId},adapterId:isTradovate(c)?'tradovate-market-ui':'tradingview-paper-market-ui',accountRevision:p.revision,selectionKey:t.selectionKey,sourceIdentity:sourceKey(t),sourceRunId:s.runId,symbol:e.symbol,quantity:e.quantity};
    return {binding,verification:{kind:'EXECUTION_LIFECYCLE_VERIFIED_CONTEXT_V1',...copy(binding),observedAt:e.observedAt,sampleId:e.sampleId??'paper-inspect:'+e.observedAt,connected:true,nativeAccountVerified:true,sourceVerified:true,adapterEligible:ui['paper-user-consent'].checked===true,latestClosedAt:s.asOfTime,synthetic:false,testOnly:false}};
  }
  function approval(){
    const c=context(),s=source(c),a=candidate;
    if(!a||!recent(a.originalReceivedAt,15000)||a.source.runId!==s.runId||a.source.sessionId!==s.sessionId||a.source.generation!==s.generation||!same(a.source.closedBar,s.closedBar))throw Error('PAPER_USER_NEW_CLOSED_APPROVAL_REQUIRED');
    const current=selectGuideTechnicalDecision({analysis:c.analysis,bars:c.state.bars,asOfTime:c.analysis?.asOfTime});
    if(current.status!=='CONFIRMED'||current.synthetic||current.testOnly||current.signal?.eventId!==a.approvalProof.eventId||current.direction!==a.direction||a.approvalProof.sourceEventIds.some(id=>!current.signal.sourceEventIds.includes(id))
      ||a.setups.some(setup=>{const event=c.analysis.events.find(e=>e.eventId===setup.eventId);return !event||event.trigger!==setup.trigger||event.invalidation!==setup.structuralInvalidation;}))throw Error('PAPER_USER_CURRENT_ANALYSIS_VETOED_APPROVAL');
    // The strategy confirms the CLOSED candle beyond its trigger. A later
    // tick may retest that trigger without undoing the closed confirmation;
    // the frozen structural invalidation still vetoes a broken setup.
    const closedQuote=c.state.bars.at(-1).close,quote=c.state.current?.close??closedQuote,eligibleSetupIds=a.setups.filter(x=>a.direction==='LONG'?closedQuote>x.trigger&&quote>=x.structuralInvalidation:closedQuote<x.trigger&&quote<=x.structuralInvalidation).map(x=>x.eventId);
    if(!tick(quote)||!eligibleSetupIds.length){
      if(!a.vetoRecorded){a.vetoRecorded=true;recordJournal({phase:'TECHNICAL_APPROVAL_VETO',eventId:a.approvalProof.eventId,observedAtReceiver:now(),reason:'PAPER_USER_CURRENT_PRICE_INVALIDATES_APPROVAL',direction:a.direction,quote,confirmedClose:closedQuote,setups:copy(a.setups),submitted:false,ordersCreated:false});}
      throw Error('PAPER_USER_CURRENT_PRICE_INVALIDATES_APPROVAL');
    }
    return {...a,sourceBinding:s,technicalEntryWitness:{kind:'CURRENT_LIVE_QUOTE_PRESERVES_FROZEN_SETUP',direction:a.direction,quote,asOfTime:s.asOfTime,sourceEventIds:copy(a.approvalProof.sourceEventIds),eligibleSetupIds,setups:copy(a.setups),pricesAdjusted:false}};
  }
  function nativeOwned(reply,{record,binding,verification,lifecycle}){
    const c=context();
    if(reply?.status!==nativeStatus(c,'OWNED_STATE_VERIFIED')||reply.provider!==binding.accountIdentity.provider||reply.environment!==binding.accountIdentity.environment||!nativeIdentityValid(reply,c)||reply.nativeAccountId!==binding.accountIdentity.nativeAccountId||reply.sourceVerified!==true||reply.ownershipVerified!==true||reply.synthetic===true||reply.testOnly===true||!recent(reply.observedAt)||!text(reply.sampleId)||!text(reply.nativeOrderId)||reply.intentKey!==record.key||!['WORKING','FILLED','CLOSED'].includes(reply.ownedStatus)||reply.positionsComplete!==true||reply.workingOrdersComplete!==true||!Array.isArray(reply.positions)||!Array.isArray(reply.workingOrders))return {};
    const original=record.intentBinding.binding,base={kind:'EXECUTION_LIFECYCLE_OWNED_STATE_V1',accountIdentity:copy(original.accountIdentity),adapterId:original.adapterId,sourceIdentity:original.sourceIdentity,sourceRunId:binding.sourceRunId,symbol:original.symbol,attemptKey:record.key,nativeOrderId:reply.nativeOrderId,observedAt:reply.observedAt,sampleId:reply.sampleId,nativeAccountVerified:true,sourceVerified:true,ownershipVerified:true,accountScope:'EXACT_NATIVE_ACCOUNT',positionsComplete:true,workingOrdersComplete:true,positions:copy(reply.positions),workingOrders:copy(reply.workingOrders),status:reply.ownedStatus,closedVerified:reply.closedVerified===true,latestClosedAt:verification.latestClosedAt,synthetic:false,testOnly:false};
    const sample={sampleId:base.sampleId,observedAt:base.observedAt,latestClosedAt:base.latestClosedAt,attemptKey:base.attemptKey,accountIdentity:copy(base.accountIdentity),sourceIdentity:base.sourceIdentity,sourceRunId:base.sourceRunId,symbol:base.symbol,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],ownershipVerified:true};
    return {lifecycleProof:base,ledgerProof:{kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:record.key,status:reply.ownedStatus,binding:copy(record.intentBinding),attributionVerified:true,
      accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...copy(original.accountIdentity),origin:'PUBLIC_NATIVE_UI',nativeIdentityVerified:true,environmentVerified:reply.environmentVerified,...(reply.environmentBasis?{environmentBasis:reply.environmentBasis}:{}),connected:true,observedAt:reply.observedAt,synthetic:false,testOnly:false},nativeOrderId:reply.nativeOrderId,direction:record.eventIdentity.direction,quantity:original.quantity,...(reply.nativeFill?{nativeFill:copy(reply.nativeFill)}:{}),fillVerified:reply.ownedStatus==='FILLED'||reply.fillVerified===true,closedVerified:reply.closedVerified===true,accountInventory:sample,closureSamples:[...copy(lifecycle.closureSamples),sample],synthetic:false,testOnly:false}};
  }
  function nativeReconciliationPending(reply,{record,binding},sourceBinding){
    const c=context();
    if(reply?.status!==nativeStatus(c,'RECONCILIATION_PENDING')||reply.provider!==binding.accountIdentity.provider||reply.environment!==binding.accountIdentity.environment||reply.nativeAccountId!==binding.accountIdentity.nativeAccountId||reply.nativeIdentityVerified!==true||!nativeIdentityValid(reply,c)||reply.sourceVerified!==true||reply.intentKey!==record.key||reply.attemptKey!==record.key||!recent(reply.observedAt)||reply.latestClosedAt!==sourceBinding.asOfTime||!same(reply.sourceBinding,sourceBinding)||!same(source(),sourceBinding)||reply.inventoryRead!==false||reply.inventoryFresh!==false||reply.ownedStateChanged!==false||reply.synthetic===true||reply.testOnly===true||['positions','workingOrders','positionsComplete','workingOrdersComplete','flat'].some(key=>Object.hasOwn(reply,key)))return null;
    // A fresh identity/quote observation is not a fresh inventory observation.
    // Preserve the owned attempt while awaiting a genuine native state change.
    return {kind:'EXECUTION_SESSION_NATIVE_RECONCILIATION_PENDING_V1',pending:true,attemptKey:record.key,binding:copy(binding),observedAt:reply.observedAt};
  }
  const runner=createExecutionSessionRunner({ledger,now,resumeAfterVerifiedRecovery:true,onChange:()=>render(),
    async readConnection(){
      for(let attempt=0;attempt<2;attempt++){
        const c=context(),s=sourceForConnection(c);let e;
        if(preparedConnection&&recent(preparedConnection.evidence.observedAt,500)&&same(preparedConnection.source,s)){e=preparedConnection.evidence;preparedConnection=null;}
        else e=await native('read_connection',{sourceBinding:s});
        const latest=sourceForConnection(),identity=x=>Object.fromEntries(Object.entries(x).filter(([key])=>!['asOfTime','closedBar'].includes(key)));
        // A minute may close during this read-only RPC. Re-read its fresh
        // cutoff once, without disconnecting/rebaselining over the new signal.
        // No order or prepared entry is retried here.
        if(attempt===0&&latest.asOfTime>s.asOfTime&&same(identity(s),identity(latest)))continue;
        if(!same(latest,s))throw Error('PAPER_USER_CONNECTION_SOURCE_CHANGED_DURING_READ');
        const pendingCodes=['NATIVE_USER_COHERENT_SOURCE_RUN_REQUIRED','NATIVE_USER_SOURCE_CHECKSUM_MISMATCH','NATIVE_USER_SOURCE_TAG_MISMATCH','NATIVE_USER_APPROVED_CLOSED_BAR_CHANGED','NATIVE_USER_VISIBLE_OWN_SOURCE_REQUIRED','NATIVE_USER_LIVE_SOURCE_CURRENTNESS_REQUIRED'],binding=runner.snapshot().lifecycle.binding;
        if(e?.status==='BLOCKED'&&e.submitted===false&&e.ordersCreated===false&&e.reasonCodes?.length===1&&pendingCodes.includes(e.reasonCodes[0])&&binding
          &&recent(context().state.lastReceivedAt,2000)&&binding.sourceIdentity===sourceKey(target(c))&&binding.sourceRunId===s.runId)
          return {kind:'EXECUTION_SESSION_CONNECTION_PENDING_V1',binding:copy(binding),observedAt:now(),reason:'NATIVE_COHERENT_SOURCE_FRAME_PENDING'};
        if(e?.status==='BLOCKED'&&e.reasonCodes?.length===1&&typeof e.reasonCodes[0]==='string'&&/^NATIVE_USER_[A-Z_]{1,140}$/.test(e.reasonCodes[0]))throw Error(e.reasonCodes[0]);
        nativeEvidence=copy(e);return checkedConnection(e,s,c);
      }
    },
    async readSignal({binding}){if(!ui['paper-user-consent'].checked)return null;let a;try{a=approval();}catch{return null;}return {eventId:a.approvalProof.eventId,direction:a.direction,symbol:binding.symbol,sourceIdentity:binding.sourceIdentity,sourceRunId:binding.sourceRunId,confirmedAt:a.sourceBinding.asOfTime,confirmationBarCloseTime:a.sourceBinding.asOfTime,observedAt:context().state.lastReceivedAt,status:'CONFIRMED',synthetic:false,testOnly:false};},
    async prepareEntry({permit,attemptKey}){
      const closed=runner.snapshot().lifecycle.lastClosedAttempt;
      if(closed&&releasedClosedKey!==closed.attemptKey){
        const recovered=await ledger.recover({accountIdentity:closed.binding.accountIdentity}),record=recovered.ok&&recovered.records.find(r=>r.key===closed.attemptKey&&r.status==='CLOSED');
        if(!record)throw Error('PAPER_USER_DURABLE_CLOSED_RECORD_REQUIRED');
        const released=await native('release_closed',{record});if(released.status!==nativeStatus(context(),'CLOSED_RELEASED'))throw Error('PAPER_USER_NATIVE_CLOSED_RELEASE_NOT_VERIFIED');releasedClosedKey=closed.attemptKey;
      }
      const a=approval();if(a.approvalProof.eventId!==permit.signal.eventId||a.direction!==permit.signal.direction)throw Error('PAPER_USER_APPROVAL_CHANGED');
      const reply=await native('prepare',{permit,attemptKey,approvalProof:a.approvalProof,technicalEntryWitness:a.technicalEntryWitness,sourceBinding:a.sourceBinding});
      approval();if(reply.connection){const evidence=copy(reply.connection);if(evidence.status?.startsWith('NATIVE_USER_')){evidence.nativeStatus=evidence.status;evidence.status=nativeStatus(context(),evidence.status.slice('NATIVE_USER_'.length));}preparedConnection={evidence,source:copy(a.sourceBinding)};}return reply;
    },
    async dispatchEntry(args){const a=approval();if(!wanted||!ui['paper-user-consent'].checked)throw Error('PAPER_USER_CONSENT_REVOKED');attemptAnchors.set(args.attemptKey,copy(a.measurementAnchor));newTiming(args.attemptKey,a.measurementAnchor);const result=await native('submit',args);recordClickTiming(args.attemptKey,result);const receipt={phase:'NATIVE_SUBMISSION_REPLY',observedAtReceiver:now(),eventId:args.permit.signal.eventId,attemptKey:args.attemptKey,accountIdentity:copy(args.permit.binding.accountIdentity),confirmationBar:copy(a.sourceBinding.closedBar),measurementAnchor:copy(a.measurementAnchor),result:copy(result),timing:copy(attemptTimings.get(args.attemptKey)),timingScope:'RAW_CLOCK_DOMAINS_NO_EXCHANGE_OR_PHYSICAL_DISPLAY_MEASUREMENT'};recordJournal(receipt);try{Promise.resolve(onEntrySubmission(copy(receipt))).catch(()=>{});}catch{}if(result.status==='BLOCKED'&&result.submitted===false&&result.ordersCreated===false&&result.nonSubmissionReceiptId){const proof=await native('verify_not_submitted',{record:args.record,receipt,sourceBinding:source()});if(proof?.status==='NOT_SUBMITTED')return {...result,notSubmittedProof:proof};}return result;},
    async readOwnedState(args){const sourceBinding=source(),reply=await native('reconcile',{record:args.record,sourceBinding});const pending=nativeReconciliationPending(reply,args,sourceBinding);if(pending)return pending;const projected=nativeOwned(reply,args);if(projected.lifecycleProof?.status==='FILLED'||projected.lifecycleProof?.status==='CLOSED'&&reply.fillVerified===true)pendingNativeFill={...copy(reply),fillVerified:true};return projected;},
  });
  const flatNative=e=>e?.flat===true&&e.positionsComplete===true&&e.workingOrdersComplete===true&&Array.isArray(e.positions)&&!e.positions.length&&Array.isArray(e.workingOrders)&&!e.workingOrders.length;
  function verifiedProtection(reply){const proof=reply?.nativeProtection;return reply?.protectionVerified===true&&proof?.kind==='PUBLIC_NATIVE_POSITION_BRACKET_FIELDS_AND_MATCHING_WORKING_ORDERS'&&proof.status==='INHERITED_NATIVE_PRESET_PROTECTION_VERIFIED'&&proof.nativeOrderId===reply.nativeOrderId&&['protectionVerified','inheritanceVerified','linkVerified'].every(key=>proof[key]===true);}
  function snapshot(){const state=runner.snapshot();return {...state,presentationBusy,startup:copy(startup),startupMeasurement:copy(startupMeasurement),otherAccountPreparation:copy(otherAccountPreparation),connection:copy(nativeEvidence),lastNativeResult:copy(lastNativeResult),lastVerifiedFill:copy(lastVerifiedFill),timing:copy(latestTiming),candidate:candidate?{eventId:candidate.approvalProof.eventId,originalReceivedAt:candidate.originalReceivedAt,measurementAnchor:copy(candidate.measurementAnchor),approvalProof:copy(candidate.approvalProof)}:null,journal:copy(journal),entryMarkerLedger:copy(entryMarkerLedger),entryMarkerFillFacts:copy(entryMarkerFillFacts),lastError,savedAttemptRecoveryRequired:pendingStored,armed:wanted,riskManagement:'USER_MANAGED',protectionVerified:state.status==='FILLED'&&state.ownedRecord?.key===lastVerifiedFill?.intentKey&&verifiedProtection(lastVerifiedFill),realBrokerOrdersAuthorized:brokerExecutionConfigured(context())&&wanted};}
  function renderPower(state){
    const on=wanted&&state.running,filled=state.status==='FILLED'||state.lifecycle?.ownedAttempt?.status==='FILLED';
    let value='off',label='כבוי',detail='כניסות אוטומטיות בפייפר כבויות.';
    if(readonlyPa(context())){
      value=otherPending()?'waiting':otherAccountPreparation?'review':'off';label=otherPending()?'בדיקת PA · לא פעיל':'PA · לא פעיל';
      const outcome=otherAccountPreparation?.status==='CANCELLED'?'בדיקת PA בוטלה. ':otherAccountPreparation?.status==='FAILED'?'בדיקת PA לא הושלמה. ':otherAccountPreparation?'בדיקת PA לקריאה בלבד הסתיימה. ':'אפשר לבדוק את חשבון ה־PA ואת הפריסט; ',
        actionable=otherAccountPreparation?.missingChecks?.filter(code=>!['EXECUTION_ADAPTER_NOT_IMPLEMENTED','BROKER_ENVIRONMENT_NOT_ATTESTED','NATIVE_INVENTORY_COMPLETENESS_NOT_VERIFIED','PRESET_INHERITANCE_NOT_VERIFIED'].includes(code)&&Object.hasOwn(startupReasonLabels,code)).slice(0,2)??[];
      detail=otherPending()?startup.message:outcome+reasonText('EXECUTION_ADAPTER_NOT_IMPLEMENTED')+(actionable.length?' '+actionable.map(reasonText).join(' '):'');
    }
    else if(startup){value='waiting';label='מתחבר / בהפעלה';detail=startup.message;}
    else if(filled){value=on?'active':'off';label=on?'פעיל · עסקה פתוחה':'כבוי · עסקה קיימת';detail='מילוי Paper אומת; ניהול העסקה בידיך. עצירה אינה סוגרת את העסקה.';}
    else if(['UNKNOWN','RECOVERY_REQUIRED','CLOSED_REVIEW_REQUIRED','RECONCILIATION_REQUIRED','CLOSED_VERIFYING'].includes(state.status)||state.lifecycle?.ownedAttempt?.status==='UNKNOWN'){
      value='review';label='נדרשת בדיקה';detail='ניסיון קיים דורש אימות; אין שיגור חוזר אוטומטי.';
    }else if(on&&state.status==='DISCONNECTED'){value='waiting';label='פעיל · ממתין לחיבור';detail='ההפעלה נשמרה; כניסות חדשות חסומות עד לאימות המקור והחשבון.';}
    else if(on&&state.status==='WAITING_SOURCE_FRAME'){value='waiting';label='פעיל · מאמת עדכון נתונים';detail='ממתין למסגרת מקור עקבית חדשה. אין כניסה מהקריאה החלקית.';}
    else if(on&&state.lifecycle?.connected===true&&state.lifecycle?.entryAllowed===true){value='active';label='פעיל וממתין לאיתות';detail='Paper דרוך; ממתין לאישור טכני חדש לפי תנאי האסטרטגיה.';}
    else if((wanted||state.running)&&(busy||state.busy)){value='waiting';label='מתחבר / בהפעלה';detail='בודק את החיבור לפני כניסה חדשה.';}
    else if(on){value='waiting';label=state.status==='WORKING'?'פעיל · פקודה ממתינה':'פעיל · ממתין לחיבור';detail=statusLabels[state.status]??'כניסה חדשה עדיין אינה מאושרת.';}
    if(power.bar?.dataset)power.bar.dataset.state=value;
    if(power.state)power.state.textContent=label;
    if(value==='active'&&startupMeasurement?.status==='ACTIVE'&&finite(startupMeasurement.elapsedMs))detail+=` · הפעלה אחרונה: ${startupMeasurement.elapsedMs.toFixed(1)} ms`;
    if(power.detail)power.detail.textContent=detail.replaceAll('Paper',accountLabel(context())).replaceAll('בפייפר',isTradovate(context())?'בחשבון שנבחר':'בפייפר')+(lastError?' · '+reasonText(lastError):'');
  }
  function render(){
    if(disposed)return;const state=runner?.snapshot?.()??{status:'INACTIVE'},c=context();
    if(readonlyPa(c)){
      ui['paper-user-consent'].checked=false;ui['paper-user-consent'].disabled=true;
      ui['paper-user-arm'].textContent='בדיקת חיבור PA';ui['paper-user-arm'].disabled=!extension||busy||wanted||state.running||typeof prepareOtherAccount!=='function';
      ui['paper-user-disarm'].disabled=!busy;ui['paper-user-inspect'].disabled=true;
      ui['paper-user-status'].textContent=(otherPending()?'בדיקת PA לקריאה בלבד · '+startup.message:'PA לא פעיל · '+reasonText('EXECUTION_ADAPTER_NOT_IMPLEMENTED'))+(lastError?' · '+reasonText(lastError):'');
      const native=otherAccountPreparation?.account,preset=otherAccountPreparation?.preset;
      ui['paper-user-account'].textContent=native?`Tradovate · ${native.nativeAccountId} · PA (הגדרת המשתמש)${preset?` · כמות שנקראה: ${preset.quantity??'—'} · פריסט שנצפה: ${preset.name??'טרם נקרא'}`:''}. קריאה בלבד; הבוט אינו פעיל ב־PA.`:'חשבון ה־PA שנבחר ייבדק לקריאה בלבד; בדיקה אינה מפעילה מסחר או שולחת פקודה.';
      renderPower(state);ui['paper-user-journal'].textContent=JSON.stringify(snapshot(),null,2);return;
    }
    ui['paper-user-consent'].disabled=false;ui['paper-user-arm'].textContent='הפעלת הבוט';
    if(pendingFillPaint&&state.status!=='FILLED')cancelFillPaint('FILLED_STATUS_NO_LONGER_CURRENT');
    const fillTiming=captureVerifiedFill(state);
    ui['paper-user-status'].textContent=(startup?'הפעלת '+accountLabel(c)+' · '+startup.message:(statusLabels[state.status]??state.status).replaceAll('Paper',accountLabel(c)))+(lastError?' · '+reasonText(lastError):'')+timingText();
    if(fillTiming)beginFillPaint(fillTiming);
    const preset=nativeEvidence?.nativePreset,presetText=bound?.nativePresetName?` · פריסט: ${bound.nativePresetName} · SL ${preset?.stop?.value??'—'} ${preset?.stop?.unit??''} · TP ${preset?.target?.value??'—'} ${preset?.target?.unit??''}`:'';
    ui['paper-user-account'].textContent=nativeEvidence?.status===nativeStatus(c,'CONNECTION_VERIFIED')?`${accountLabel(c)} · ${nativeEvidence.nativeAccountId} · ${nativeEvidence.symbol} · כמות שנקראה: ${nativeEvidence.quantity}${presetText}. ניהול הכמות, הסטופ, היעד והעסקה בידיך.`:'טרם נקראו זהות החשבון וכמות מקוריות. בחירת חשבון אינה מפעילה כניסות.';
    ui['paper-user-inspect'].disabled=!extension||busy;let eligible=false;try{source(c);eligible=true;}catch{}
    ui['paper-user-arm'].disabled=typeof (isTradovate(c)?prepareBrokerSession:prepareSession)==='function'?busy||wanted||!extension||!executableAccount(c)||c.profile?.mode!=='USER_MANAGED'||c.profile?.risk!==null:busy||wanted||!eligible||!ui['paper-user-consent'].checked||!same(stableTarget(bound),stableTarget(target(c)))||nativeEvidence?.status!==nativeStatus(c,'CONNECTION_VERIFIED')||!flatNative(nativeEvidence)&&!pendingStored;
    ui['paper-user-disarm'].disabled=!wanted&&!busy;
    renderPower(state);
    ui['paper-user-journal'].textContent=JSON.stringify(snapshot(),null,2);
  }
  function schedule(){if(timer!==null)clearTimeout(timer);timer=null;const delay=pendingSignalWake?0:500;pendingSignalWake=false;if(wanted&&!disposed)timer=setTimeout(()=>{timer=null;void loop();},delay);}
  async function loop(){if(disposed||busy||!wanted)return;busy=true;const token=operation;lastLoopAt=now();try{await runner.tick();if(token===operation&&!runner.snapshot().running)wanted=false;}catch(e){if(token===operation)lastError=String(e?.message??e).slice(0,160);}finally{if(token===operation){busy=false;render();schedule();}}}
  async function inspect(){if(disposed||busy)return;if(wanted)disarm('PAPER_USER_NEW_INSPECTION_REQUIRES_REARM');busy=true;const token=++operation;lastError=null;try{bound=target(context());const s=source(),e=await native('inspect',{sourceBinding:s});if(token!==operation)return;const connection=checkedConnection(e,s);pinExecutionSurface(e);entryMarkerFillFacts=(e.nativeFillRecords??[]).map(nativeFill=>({account:copy(connection.binding.accountIdentity),nativeFill:copy(nativeFill)}));const saved=await ledger.recover({accountIdentity:connection.binding.accountIdentity});if(token!==operation)return;if(!saved.ok)throw Error(saved.reason);pendingStored=saved.unresolved.length>0;entryMarkerLedger=copy(saved.records.filter(r=>['FILLED','CLOSED'].includes(r.status)));nativeEvidence=copy(e);}catch(e){if(token===operation){nativeEvidence=null;pendingStored=false;lastError=String(e?.message??e).slice(0,160);}}finally{if(token===operation){busy=false;render();}}}
  async function arm(){if(disposed||busy||ui['paper-user-arm'].disabled)return;busy=true;const token=++operation;lastError=null;try{source();const result=await runner.start();if(token!==operation)return;wanted=result.running===true;if(!wanted)lastError=result.reason;}catch(e){lastError=String(e?.message??e).slice(0,160);}finally{if(token===operation){busy=false;render();schedule();}}}
  async function preparePa(){
    if(disposed||busy||wanted||runner.snapshot().running||!extension||!isPa(context())||typeof prepareOtherAccount!=='function')return snapshot();
    const selected=copy(preparationIdentity(context())),token=++operation;
    const isCancelled=()=>disposed||token!==operation||!otherPending()||!isPa(context())||!same(selected,preparationIdentity(context()));
    const guard=()=>{if(isCancelled())throw Error('PA_PREPARATION_CANCELLED');};
    busy=true;lastError=null;candidate=null;preparedConnection=null;startupMeasurement=null;otherPreparationSelection=selected;otherAccountPreparation=null;ui['paper-user-consent'].checked=false;
    startup={phase:'OTHER_ACCOUNT_PREPARATION',message:'בודק את חשבון ה־PA ואת הפריסט לקריאה בלבד; הבוט אינו פעיל',startedAt:now()};render();
    try{
      const result=await prepareOtherAccount({isCancelled,onProgress:message=>{if(!isCancelled()&&text(message)&&message.length<=300){startup={...startup,message};render();}}});
      guard();otherAccountPreparation=readonlyPreparation(result,selected);if(otherAccountPreparation.missingChecks.includes('PA_PREPARATION_RESULT_NOT_VERIFIED'))lastError='PA_PREPARATION_RESULT_NOT_VERIFIED';
    }catch(error){if(token===operation){if(!same(selected,preparationIdentity(context()))){otherAccountPreparation=null;otherPreparationSelection=null;}else{lastError=String(error?.message??error).slice(0,160);otherAccountPreparation=readonlyPreparation(null,selected,{status:'FAILED',reason:lastError});}}}
    finally{if(token===operation){startup=null;busy=false;ui['paper-user-consent'].checked=false;render();}}
    return snapshot();
  }
  async function activate(){
    if(readonlyPa(context()))return preparePa();
    const prepare=isTradovate(context())?prepareBrokerSession:prepareSession;
    if(typeof prepare!=='function'){
      if(disposed||busy||ui['paper-user-arm'].disabled)return snapshot();const measurement=beginStartupMeasurement();await arm();const state=runner.snapshot();finishStartupMeasurement(measurement,state.lifecycle?.ownedAttempt?'REVIEW_REQUIRED':state.running?'ACTIVE':'FAILED');render();return snapshot();
    }
    if(disposed||busy||wanted||!extension||!executableAccount(context())||context().profile?.mode!=='USER_MANAGED'||context().profile?.risk!==null)return snapshot();
    const identity=c=>({profile:profile(c),selectionKey:c.account?.selectionFingerprint}),selected=copy(identity(context())),token=++operation;
    const isCancelled=()=>disposed||token!==operation||startup===null||!executableAccount(context())||!same(selected,identity(context()));
    const guard=()=>{if(isCancelled())throw Error('PAPER_USER_STARTUP_CANCELLED');if(!executableAccount(context())||!same(selected,identity(context())))throw Error('PAPER_USER_SELECTED_ACCOUNT_CHANGED');};
    const progress=(phase,message)=>{guard();startup={...startup,phase,message};render();};
    const measurement=beginStartupMeasurement();
    busy=true;lastError=null;candidate=null;preparedConnection=null;otherAccountPreparation=null;otherPreparationSelection=null;startup={phase:'SOURCE_PREPARATION',message:'מכין את המקור שנבחר וממתין לנתונים חיים מאומתים',startedAt:now()};render();
    try{
      await prepare({isCancelled,onProgress:message=>{if(!isCancelled()&&text(message)&&message.length<=300)progress('SOURCE_PREPARATION',message);}});
      guard();const s=source();bound=target(context());
      progress('NATIVE_INSPECTION','בודק את זהות החשבון ואת בקרי הכניסה המקוריים');
      const e=await native('inspect',{sourceBinding:s});guard();source();const connection=checkedConnection(e,s);pinExecutionSurface(e);entryMarkerFillFacts=(e.nativeFillRecords??[]).map(nativeFill=>({account:copy(connection.binding.accountIdentity),nativeFill:copy(nativeFill)}));
      const saved=await ledger.recover({accountIdentity:connection.binding.accountIdentity});guard();if(saved.ok)entryMarkerLedger=copy(saved.records.filter(r=>['FILLED','CLOSED'].includes(r.status)));
      if(!saved.ok)throw Error(saved.reason);pendingStored=saved.unresolved.length>0;nativeEvidence=copy(e);
      if(!flatNative(e)&&!pendingStored)throw Error('PAPER_USER_NATIVE_ZERO_INVENTORY_REQUIRED');
      ui['paper-user-consent'].checked=true;progress('SESSION_START','מפעיל את הבוט בחשבון שנבחר לאחר אימות המקור והחשבון');
      const result=await runner.start();guard();wanted=result.running===true;if(!wanted)lastError=result.reason;finishStartupMeasurement(measurement,result.lifecycle?.ownedAttempt?'REVIEW_REQUIRED':wanted?'ACTIVE':'FAILED');
    }catch(e){if(token===operation){wanted=false;runner.stop('PAPER_USER_STARTUP_FAILED');ui['paper-user-consent'].checked=false;lastError=String(e?.message??e).slice(0,160);finishStartupMeasurement(measurement,'FAILED');}}
    finally{if(token===operation){startup=null;busy=false;render();schedule();}}
    return snapshot();
  }
  function disarm(reason='PAPER_USER_DISARMED'){
    cancelFillPaint('FILLED_STATUS_DISARMED_BEFORE_PAINT');
    finishStartupMeasurement(startupMeasurement,'CANCELLED');
    if(otherPending()&&otherPreparationSelection)otherAccountPreparation=readonlyPreparation(null,otherPreparationSelection,{status:'CANCELLED',reason});
    operation++;startup=null;wanted=false;candidate=null;preparedConnection=null;pendingSignalWake=false;busy=false;if(timer!==null)clearTimeout(timer);timer=null;runner.stop(reason);ui['paper-user-consent'].checked=false;
    if(bound&&extension)void native('disarm',{reason}).catch(()=>{});render();return snapshot();
  }
  function disconnect(reason='PAPER_USER_SOURCE_DISCONNECTED'){
    cancelFillPaint('FILLED_STATUS_DISCONNECTED_BEFORE_PAINT');
    if(otherPending()){candidate=null;preparedConnection=null;render();return snapshot();}
    if(startup?.phase==='SOURCE_PREPARATION'){candidate=null;preparedConnection=null;runner.disconnect(reason);render();return snapshot();}
    if(startup)return disarm(reason);
    operation++;candidate=null;preparedConnection=null;pendingSignalWake=false;busy=false;runner.disconnect(reason);
    if(bound&&extension)void native('disarm',{reason}).catch(()=>{});
    render();schedule();return snapshot();
  }
  function accept(item,analysis,state){
    try{
      const c=context(),s=source(c),technical=selectGuideTechnicalDecision({analysis,bars:state.bars,asOfTime:analysis.asOfTime});
      // approvedAtReceiverEpoch belongs to the receiver performance clock. It
      // is retained for measurement; wall-clock freshness comes from receipt
      // and the current verified source, never from comparing those domains.
      if(item?.testOnly===true||item?.sessionId!==c.source.sessionId||item.runId!==c.source.runId||item.sourceTabId!==c.source.sourceTabId||!recent(item.receivedAt,15000)||!finite(item.approvedAtReceiverEpoch)||item.approvedAtReceiverEpoch<0||technical.status!=='CONFIRMED'||technical.synthetic||technical.testOnly||technical.signal.approvalPolicy!=='guide_scenarios_v1'||technical.currentClosedBarCloseTime!==s.asOfTime||state.bootstrap===true||state.generation!==c.state.generation||!state.newlyClosed?.some(b=>b.closeTime===s.asOfTime&&b.finalOhlcVerified===true))throw Error('PAPER_USER_GENUINE_NEW_TECHNICAL_APPROVAL_REQUIRED');
      const fresh=selectFreshLiveSignal(item.signal,analysis,{bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:state.eligibleCloseTimes,bars:state.bars});
      if(!fresh||!corroborateGuideTechnicalDecision(technical,fresh).passed)throw Error('PAPER_USER_POST_BOOTSTRAP_SETUP_REQUIRED');
      const selected=new Set(fresh.setupEventIds),strategyProofs=technical.signal.strategyProofs.map(p=>({...copy(p),sourceEventIds:p.sourceEventIds.filter(id=>selected.has(id))})).filter(p=>p.sourceEventIds.length);
      const required=new Set(strategyProofs.flatMap(p=>p.requiredCheckIds)),sourceEventIds=technical.signal.sourceEventIds.filter(id=>selected.has(id));
      const events=new Map(analysis.events.map(e=>[e.eventId,e])),setups=sourceEventIds.map(id=>({eventId:id,trigger:events.get(id).trigger,structuralInvalidation:events.get(id).invalidation}));
      candidate={source:s,direction:technical.direction,originalReceivedAt:item.receivedAt,measurementAnchor:{readEventId:item.readEventId??null,sourcePacketId:item.sourcePacketId??null,receivedAt:item.receivedAt,approvedAtReceiverEpoch:item.approvedAtReceiverEpoch,sourceEmittedAt:item.sourceEmittedAt??null,...ownedOrigin(item),clockDomains:{receivedAt:'RECEIVER_PACKET_RECEIPT_EPOCH',approvedAtReceiverEpoch:'RECEIVER_PERFORMANCE_TIME_ORIGIN_PLUS_NOW',sourceEmittedAt:'PRODUCER_SOURCE_EPOCH_NOT_COMPARED_TO_RECEIVER',sourceObservation:'SOURCE_DOCUMENT_PERFORMANCE_EPOCH_WITH_OPTIONAL_RECEIVER_CALIBRATION'}},setups,approvalProof:{engineDefinitionVersion:GUIDE_SIGNAL_VERSION,technicalDecisionVersion:GUIDE_TECHNICAL_DECISION_VERSION,eventId:technical.signal.eventId,asOfTime:s.asOfTime,analysisAsOfTime:analysis.asOfTime,direction:technical.direction,confirmedAt:technical.signal.confirmedAt,confirmationBarCloseTime:technical.signal.confirmationBarCloseTime,confirmationPolicy:'later_close_beyond_setup',approvalPolicy:'guide_scenarios_v1',strategyProofs,requiredChecks:technical.signal.requiredChecks.filter(check=>required.has(check.id)),roleReversalEnabled:true,supplyDemandEnabled:true,sourceEventIds}};
      approval();if(wanted&&!busy)return loop();if(wanted&&busy&&!runner.snapshot().ownedRecord&&lastWakeEvent!==candidate.approvalProof.eventId){pendingSignalWake=true;lastWakeEvent=candidate.approvalProof.eventId;}render();return snapshot();
    }catch(e){lastError=String(e?.message??e).slice(0,160);render();return snapshot();}
  }
  function refresh(){
    if(disposed)return;const c=context();
    if(otherPreparationSelection&&!same(otherPreparationSelection,preparationIdentity(c))){const pending=otherPending();otherAccountPreparation=null;otherPreparationSelection=null;if(pending){disarm('PA_PREPARATION_ACCOUNT_CHANGED');return;}}
    if(startup&&(otherPending()?!isPa(c):!executableAccount(c))){disarm('PAPER_USER_ACCOUNT_OR_TARGET_CHANGED');return;}if(wanted&&(!executableAccount(c)||!same(stableTarget(bound),stableTarget(target(c)))||c.source?.settingsDirty===true)){disarm('PAPER_USER_ACCOUNT_OR_TARGET_CHANGED');return;}
    if(wanted){try{sourceForConnection(c);}catch{if(runner.snapshot().status!=='DISCONNECTED')disconnect('PAPER_USER_LIVE_SOURCE_UNAVAILABLE');}if(!busy&&now()-lastLoopAt>=500)void loop();}
    render();
  }
  for(const [id,event,fn]of [['paper-user-inspect','click',inspect],['paper-user-arm','click',activate],['paper-user-disarm','click',()=>disarm()],['paper-user-consent','change',()=>{if(!ui['paper-user-consent'].checked&&(wanted||startup))disarm('PAPER_USER_CONSENT_REVOKED');else render();}]]){ui[id].addEventListener(event,fn);listeners.push([ui[id],event,fn]);}
  async function runPresentation(task){
    const owned=runner.snapshot().ownedRecord;
    if(disposed||busy||startup||owned&&!['FILLED','CLOSED'].includes(owned.status)||!owned&&candidate&&recent(candidate.originalReceivedAt,15000))return {status:'PRESENTATION_DEFERRED'};
    busy=true;presentationBusy=true;const token=operation;
    try{return await task();}
    finally{presentationBusy=false;if(token===operation){busy=false;render();schedule();}}
  }
  async function reviewNotSubmittedExport(value){
    if(disposed||busy||!wanted||!isPaper(context()))throw Error('PAPER_USER_ACTIVE_PAPER_REVIEW_REQUIRED');const owned=runner.snapshot().ownedRecord;if(!owned||owned.status!=='UNKNOWN'||value?.kind!=='LIVE_OHLC_OBSERVATION')throw Error('PAPER_USER_EXACT_UNKNOWN_EXPORT_REQUIRED');
    const receipts=value.paperUserExecution?.journal?.filter(r=>r.phase==='NATIVE_SUBMISSION_REPLY'&&r.attemptKey===owned.key)??[];if(receipts.length!==1)throw Error('PAPER_USER_ONE_EXACT_BLOCKED_RECEIPT_REQUIRED');busy=true;
    try{
      if(receipts[0].result?.submitted===true){
        const diagnostic=lastNativeResult?.reconciliationDiagnostics,fill=diagnostic?.nativeFillCandidate;
        if(diagnostic?.newTypedFillCount!==1||diagnostic.flat!==true||!text(fill?.nativeOrderId))throw Error('PAPER_USER_ONE_TYPED_COMPLETED_FILL_REQUIRED');
        const proof=await native('review_closed',{record:owned,receipt:receipts[0],operatorReviewedExport:true,nativeOrderId:fill.nativeOrderId,sourceBinding:source()});
        if(proof?.ownedStatus!=='CLOSED'||proof.closedVerified!==true||proof.fillVerified!==true)throw Error(proof?.reasonCodes?.[0]??'PAPER_USER_COMPLETED_FILL_NOT_VERIFIED');
        candidate=null;lastError=null;recordJournal({phase:'NATIVE_COMPLETED_FILL_OPERATOR_REVIEWED',observedAtReceiver:now(),attemptKey:owned.key,nativeOrderId:proof.nativeOrderId,result:copy(proof),oldEventRetained:true,ordersCreated:false});return snapshot();
      }
      const proof=await native('verify_not_submitted',{record:owned,receipt:receipts[0],operatorReviewedExport:true,sourceBinding:source()});if(proof?.status!=='NOT_SUBMITTED')throw Error(proof?.reasonCodes?.[0]??'PAPER_USER_NON_SUBMISSION_NOT_VERIFIED');const result=await runner.resolveNotSubmitted(proof);if(result.status!=='WAITING_NEW_SIGNAL')throw Error(result.reason);pendingStored=false;candidate=null;lastError=null;recordJournal({phase:'NATIVE_NON_SUBMISSION_VERIFIED',observedAtReceiver:now(),attemptKey:owned.key,basis:proof.nonSubmissionBasis,oldEventRetained:true,ordersCreated:false});return snapshot();
    }finally{busy=false;render();schedule();}
  }
  const reviewInput=document?.getElementById('paper-user-recovery-export');if(reviewInput){const onReview=async()=>{try{const file=reviewInput.files?.[0];if(!file||file.size>25000000)throw Error('PAPER_USER_BOUNDED_EXPORT_REQUIRED');await reviewNotSubmittedExport(JSON.parse(await file.text()));}catch(error){lastError=String(error?.message??error);render();}finally{reviewInput.value='';}};reviewInput.addEventListener('change',onReview);listeners.push([reviewInput,'change',onReview]);}
  render();return {accept,activate,refresh,disconnect,disarm,snapshot,runPresentation,reviewNotSubmittedExport,dispose(){if(disposed)return;disarm('PAPER_USER_PAGE_CLOSED');disposed=true;for(const [node,event,fn]of listeners)node.removeEventListener?.(event,fn);}};
}
