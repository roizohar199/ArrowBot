import {MAX_SHORTCUT_DELAY_MS,validShortcutDelay} from './shortcut-delay.mjs';
import {isAutoFlatRecoveryReason} from './auto-flat-proof.mjs';

const LABELS = {
  SENT_UNCONFIRMED: 'הקיצור נשלח — אין אישור שעסקה בוצעה.',
  UNCERTAIN: 'תוצאת ההקשה אינה ידועה. אין אישור ביצוע.',
  NOT_TRADINGVIEW: 'לא נשלח: הלשונית הפעילה אינה TradingView.',
  NOT_FOCUSED: 'לא נשלח: חלון TradingView אינו ממוקד.',
  EDITING: 'לא נשלח: הסמן נמצא בשדה עריכה.',
  IGNORED_BUSY: 'האות דולג: הקשה קודמת עדיין בתהליך.',
  IGNORED_DUPLICATE: 'האות דולג: מזהה האות כבר טופל.',
  DISABLED: 'לא נשלח: קיצורי המקלדת כבויים.',
  STALE_SIGNAL: 'לא נשלח: האות ישן מדי.',
  SIGNAL_EXPIRED: 'לא נשלח: תוקף האות פג.',
  SIGNAL_SUPERSEDED: 'האיתות בוטל לפני ההקשה כי הופיע חץ מאוחר יותר.',
  INVALID_SIGNAL: 'לא נשלח: האות אינו תקין.',
  SOURCE_STOPPED: 'לא נשלח: המעקב נעצר.',
  CANCELLED: 'לא נשלח: ההקשה בוטלה.',
  TARGET_CHANGED: 'לא נשלח: לשונית היעד השתנתה.',
  INVALID_OR_STALE_SIGNAL: 'לא נשלח: האות אינו תקין או ישן מדי.',
  SESSION_CHANGED: 'קיצורי המקלדת כובו: החיבור השתנה. יש לטעון את העמוד מחדש.',
  TARGET_SELECTION_REQUIRED: 'לא נשלח: יש לבחור את לשונית הגרף המשותפת.',
  TARGET_UNAVAILABLE: 'לא נשלח: לשונית הגרף שנבחרה אינה זמינה.',
  TARGET_NOT_ACTIVE: 'לא נשלח: לשונית הגרף שנבחרה אינה פעילה בחלון שלה.',
  WINDOW_NOT_FOCUSED: 'לא נשלח: חלון הגרף שנבחר אינו ממוקד.',
  DOCUMENT_NOT_FOCUSED: 'לא נשלח: הגרף שנבחר אינו מקבל מיקוד מקלדת.',
  DOCUMENT_HIDDEN: 'לא נשלח: לשונית הגרף שנבחרה מוסתרת.',
  SOURCE_UNAVAILABLE: 'לא נשלח: לא התקבל אישור מחיבור המעקב לרכיב ההקשה.',
  STALE_SOURCE_INTENT: 'החץ דולג: האיתות שייך להפעלת מעקב קודמת.',
  POSITION_TARGET_MISMATCH: 'לא נשלח: תמונת המעקב אינה קשורה ללשונית שנבחרה.',
  IGNORED_POSITION_OPEN: 'החץ דולג: קיימת פוזיציה פתוחה לפי הסימון בגרף.',
  POSITION_PENDING: 'ממתין לאישור הכניסה בגרף. חצים נוספים מדולגים; הקיצורים נשארים פעילים.',
  IGNORED_ENTRY_PENDING: 'החץ דולג: כניסה קודמת עדיין ממתינה לאישור בגרף.',
  POSITION_UNKNOWN: 'ממתין לתמונה תקינה ולאישור מצב הפוזיציה. הקיצורים נשארים פעילים.',
  POSITION_STABILIZING: 'ממתין לאישור מצב פנוי בכמה תמונות חדשות מהגרף.',
  POSITION_STALE: 'ממתין לתמונת פוזיציה חדשה; התמונה הקודמת אינה עדכנית.',
  INPUT_DISCONNECTED: 'חיבור המקשים נותק. לא נשלח ניסיון חוזר לאיתות שכבר טופל.',
  IGNORED_BEFORE_POSITION_CLOSE: 'החץ דולג: הוא הופיע לפני סיום הפוזיציה או בדיקת המצב מחדש.',
  IGNORED_BEFORE_SOURCE_CHANGE: 'החץ דולג: הוא הופיע לפני החלפת הגרף או הסגירה האחרונה.',
  POSITION_RESET: 'מצב הפוזיציה נבדק מחדש. ממתין לחץ חדש.',
  AUTOMATIC_POSITION_CHECK: 'בדיקת הפוזיציה אוטומטית. יש לפתוח לוח חדש לגרסה המעודכנת.',
  VISIBLE_FLAT_REQUIRED: 'יש להמתין לסימון פנוי יציב ועדכני בגרף לפני בדיקה מחדש.',
  MANUAL_FLAT_CONFIRMATION_REQUIRED: 'נדרש אישור מפורש שבדקת בחשבון שאין פוזיציה.',
  POSITION_CONFIRMATION_CHANGED: 'המצב השתנה בזמן האישור. בדוק שוב שהחשבון פנוי.',
  CHART_CONTEXT_CHANGED: 'הסימול, טווח הזמן או מצב Replay השתנו. ממתין לבסיס חדש של הגרף.',
  CHART_IDENTITY_UNAVAILABLE: 'זהות הגרף אינה קריאה. הצג את כותרת הסימול וטווח הזמן; כניסות חסומות.',
  CHART_REPLAY_ACTIVE: 'כניסות חסומות כאשר הגרף במצב Replay.',
};
export function describeShortcutOutcome(code) {return LABELS[code]??`לא התקבל אישור ביצוע (${String(code||'NO_RESPONSE')}).`;}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FOCUS_LABELS={
  FOCUS_READY:'מיקוד תקין: הגרף שנבחר פעיל.',
  TARGET_NOT_ACTIVE:'לשונית הגרף שנבחרה אינה הלשונית הפעילה בחלון שלה.',
  WINDOW_NOT_FOCUSED:'חלון הגרף שנבחר אינו ממוקד.',
  DOCUMENT_NOT_FOCUSED:'הגרף שנבחר אינו מקבל כרגע מיקוד מקלדת.',
  DOCUMENT_HIDDEN:'לשונית הגרף שנבחרה מוסתרת.',
  EDITING:'המיקוד נמצא בשדה עריכה או בחלון דו־שיח בגרף.',
  TARGET_UNAVAILABLE:'לשונית הגרף שנבחרה אינה זמינה.',
  TARGET_CHANGED:'כתובת הגרף השתנתה; ממתין לבדיקה חדשה.',
  NOT_TRADINGVIEW:'הלשונית שנבחרה אינה גרף TradingView נתמך.',
  TARGET_SELECTION_REQUIRED:'בחרו לשונית גרף כדי לבדוק מיקוד.',
  CHART_CONTEXT_CHANGED:'זהות הגרף השתנתה; נבנה בסיס חדש.',
  CHART_IDENTITY_UNAVAILABLE:'לא ניתן לאמת את הסימול וטווח הזמן בכותרת הגרף.',
  CHART_REPLAY_ACTIVE:'מצב Replay פעיל — כניסות חסומות.',
};

/** Reports visual position evidence and key dispatch without account confirmation. */
export function createShortcutControls({ document, send, isRunning, onEnable = async () => {},onTargetChanged=()=>{},onChartContextChanged=()=>{},now=Date.now, log = () => {}, session = crypto.randomUUID(), requestTimeoutMs=3000 }) {
  const el = Object.fromEntries(['shortcut-toggle','shortcut-state','shortcut-status','shortcut-focus-status','shortcut-last-key','shortcut-last-time','shortcut-last-result','shortcut-delay','shortcut-delay-applied','shortcut-delay-status','shortcut-target','position-state','position-detail'].map(id => [id, document.getElementById(id)]));
  for (const [id, node] of Object.entries(el)) if (!node) throw new Error(`Missing shortcut control: ${id}`);
  let enabled = false, generation = 0, changing = false, dispatching = false, polling = false, initialized = false, lastAt = -Infinity;
  let delayMs = 0, delaySaving = false, delayEpoch = 0, delayDirty = false;
  let sourceGeneration=0,sourceActiveRequested=false,target=null,targets=[],targetEpoch=0,targetChangedAt=-Infinity,targetChanging=false,targetRefreshing=false;
  let position=null,positionRevision=0,observationEpoch=0,riskEpoch=0,latestObservedState='UNKNOWN',entryPending=null;
  let readinessAt=-Infinity;
  let chartRevision=null;
  function applyChartContext(response){
    const revision=response?.state?.chartRevision;if(!Number.isSafeInteger(revision))return;
    if(chartRevision===null){chartRevision=revision;return;}
    if(revision<=chartRevision)return;
    chartRevision=revision;invalidateSource();
    try{onChartContextChanged({identity:response.state.chartIdentity??null,revision});}catch(error){log('CHART_CONTEXT_CALLBACK_ERROR | '+String(error));}
  }
  let flatTask=null,pendingFlat=null,latestPositionTask=null;
  const consumed=new Set(),signalQueue=[],dispatchCancellations=new Set();
  function cancelDispatchWaits(code){for(const cancel of dispatchCancellations)cancel(code);}
  function replyDeadline(operation,budgetMs=requestTimeoutMs){
    let timer;
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SOURCE_UNAVAILABLE')),budgetMs);});
    return Promise.race([operation,expired]).finally(()=>clearTimeout(timer));
  }
  const validDelay = validShortcutDelay;
  const text = (id, value) => { if(el[id].textContent!==value)el[id].textContent = value; };
  const status = message => text('shortcut-status', message);
  const describe = describeShortcutOutcome;
  const isOpen=value=>value==='LONG'||value==='SHORT';
  function positionBlock() {
    if(!target)return 'TARGET_SELECTION_REQUIRED';
    if(isOpen(latestObservedState)||isOpen(position?.state)||isOpen(position?.held))return 'IGNORED_POSITION_OPEN';
    if(entryPending||position?.state==='PENDING'||position?.pendingId)return 'IGNORED_ENTRY_PENDING';
    if(position?.canEnter!==true)return position?.reason==='POSITION_STALE'?'POSITION_STALE':'POSITION_UNKNOWN';
    return null;
  }
  function outcome(response){return{...response,uiText:describe(resultCode(response))};}
  function flushSignalQueue(code){while(signalQueue.length){const ticket=signalQueue.shift();log(`SHORTCUT_RESULT | ${ticket.item.direction==='UP'?'LONG':'SHORT'} | id=${ticket.item.event.signalId} | ${code}`);ticket.resolve(outcome({ok:false,error:code,code,skipped:true}));}}
  function clearReadiness(message='ממתין לבדיקת מיקוד של הגרף שנבחר.') {readinessAt=-Infinity;text('shortcut-focus-status',message);el['shortcut-focus-status'].dataset.code='WAITING';}
  function applyReadiness(response,targetToken) {
    const value=response?.readiness;
    if(targetToken!==targetEpoch||!value||!Number.isFinite(value.checkedAt)||value.checkedAt<=readinessAt)return;
    if(target?(value.targetId!==target.id||value.targetUrl!==target.url):(value.targetId!=null||value.targetUrl!=null))return;
    readinessAt=value.checkedAt;
    const code=typeof value.code==='string'?value.code:'UNKNOWN';
    text('shortcut-focus-status',FOCUS_LABELS[code]??`בדיקת המיקוד לא הושלמה (${code}).`);
    el['shortcut-focus-status'].dataset.code=code;
  }
  function delayStatus(message, error = false) { text('shortcut-delay-status', message); el['shortcut-delay-status'].dataset.error=String(error); }
  function applyDelay(response, token = delayEpoch) {
    if (token !== delayEpoch || !validDelay(response?.state?.delayMs)) return false;
    delayMs=response.state.delayMs;
    text('shortcut-delay-applied', `דיליי פעיל: ${delayMs} ms`);
    if (!delayDirty && !delaySaving) el['shortcut-delay'].value=String(delayMs);
    return true;
  }
  function paint() {
    el['shortcut-toggle'].textContent = enabled ? 'עצור קיצורי מקלדת' : 'הפעל קיצורי מקלדת';
    el['shortcut-toggle'].setAttribute('aria-pressed', String(enabled));
    // A pending enable cannot be clicked twice; pause() remains available to the source.
    el['shortcut-toggle'].disabled = !initialized || changing;
    el['shortcut-delay'].disabled = !initialized || delaySaving;
    el['shortcut-target'].disabled = !initialized || targetChanging;
    text('shortcut-state', enabled ? 'קיצורי המקלדת פעילים' : 'קיצורי המקלדת כבויים');
  }
  function paintTargets() {
    const select=el['shortcut-target'];select.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=targets.length?'בחרו את הגרף המשותף':'לא נמצאה לשונית TradingView';placeholder.selected=!target;select.appendChild(placeholder);
    for(const item of targets){const option=document.createElement('option');option.value=String(item.id);option.textContent=item.title||item.url;option.selected=item.id===target?.id;select.appendChild(option);}
  }
  function applyTarget(response,token=targetEpoch) {
    if(token!==targetEpoch)return;
    let changed=false;
    if(Array.isArray(response?.targets)){targets=response.targets.filter(item=>Number.isSafeInteger(item?.id)&&item.id>0&&typeof item.url==='string');changed=true;}
    if(response?.state&&Object.hasOwn(response.state,'target')){
      const next=response.state.target&&Number.isSafeInteger(response.state.target.id)?{...response.state.target}:null;
      if(next?.id!==target?.id||next?.url!==target?.url){
        const previous=target?{...target}:null;
        invalidateSource();entryPending=null;position=null;++targetEpoch;targetChangedAt=now();
        clearReadiness();
        target=next;changed=true;applyPosition(response);
        try{const result=onTargetChanged({previous,next:target?{...target}:null});if(result?.catch)void result.catch(error=>log(`SHORTCUT_TARGET_CALLBACK_ERROR | ${String(error?.message??error)}`));}catch(error){log(`SHORTCUT_TARGET_CALLBACK_ERROR | ${String(error?.message??error)}`);}
      }else if(next&&target){if(next.title!==target.title)changed=true;target=next;}
    }
    if(target&&!targets.some(item=>item.id===target.id))targets.push(target);
    if(changed)paintTargets();
  }
  function applyPosition(response,token=positionRevision) {
    if(token!==positionRevision||!response?.state?.position)return;
    position={...response.state.position};
    const resolved=entryPending&&!position.held&&!position.pendingId&&position.barrierAt>entryPending.at&&['MANUAL_FLAT_CONFIRMED','POSITION_CLOSED','POSITION_FLAT_RECONFIRMED'].includes(position.lastResolution);
    if(resolved){entryPending=null;cancelDispatchWaits('ENTRY_RESOLVED');}
    if(isOpen(position.state)||isOpen(position.held)||!dispatching&&position.canEnter===true&&!position.pendingId&&position.state==='FLAT'&&Number.isFinite(position.capturedAt)&&position.capturedAt>(entryPending?.at??Infinity))entryPending=null;
    const recheckingView=position.syncRequired==='POSITION_VIEW_CHANGED'&&!isOpen(position.observedState);
    const state=recheckingView?'UNKNOWN':isOpen(position.state)?position.state:isOpen(position.held)?position.held:position.state==='PENDING'||entryPending?'PENDING':position.state==='FLAT'?'FLAT':'UNKNOWN';
    if(isOpen(state)||state==='PENDING')flushSignalQueue(isOpen(state)?'IGNORED_POSITION_OPEN':'IGNORED_ENTRY_PENDING');
    el['position-state'].dataset.state=state;
    text('position-state',recheckingView?'בדיקת פנוי אוטומטית אחרי שינוי תצוגה':state==='FLAT'?'הגרף פנוי לכניסה':state==='LONG'?'פוזיציית לונג פתוחה':state==='SHORT'?'פוזיציית שורט פתוחה':state==='PENDING'?'ממתין לאישור כניסה':'ממתין לאישור מצב הפוזיציה');
    const detail=isOpen(state)?'חצים בזמן העסקה מדולגים. לאחר סגירה מאומתת השליחה חוזרת אוטומטית.'
      :state==='PENDING'?'קיצור נשלח או נמצא בתהליך. חצים נוספים אינם נשמרים לשליחה מאוחרת.'
      :state==='FLAT'?'מצב פנוי אושר אוטומטית לפי תמונות הגרף. ממתין לחץ חדש.'
      :'ממתין לכמה תמונות תקינות מאותו גרף. הבחירה נשארת פעילה.';
    const autoChecking=isAutoFlatRecoveryReason(position.syncRequired);
    const syncText=position.syncRequired==='POSITION_QUANTITY_MISMATCH'&&isOpen(position.observedState)?'זוהתה כמות שאינה חוזה אחד. כניסות נוספות חסומות; לאחר הסגירה תתבצע בדיקת פנוי אוטומטית.':autoChecking?'מתבצעת בדיקת פנוי אוטומטית: נדרשות שתי שניות רצופות של תמונות מלאות ועדכניות מאותו גרף. אין צורך באישור שלך.':position.syncRequired?'מצב הפוזיציה אינו ברור בעקבות שינוי גרף או תצוגה. אין עדיין הוכחה חזותית מספקת לסגירה; כניסות נוספות חסומות.':null;
    const qty=isOpen(state)&&isOpen(position.observedState)?(position.quantityVerified?' כמות שזוהתה בצילום: '+position.quantity+'.':' כמות החוזים אינה קריאה כרגע.') : '';
    const progress=autoChecking&&position.autoFlatFrames>0?` רצף אימות: ${(Math.min(2000,position.autoFlatElapsedMs??0)/1000).toFixed(1)} מתוך 2.0 שניות; ${position.autoFlatFrames} תמונות.`:'';
    text('position-detail',(syncText??detail)+qty+progress+(position.reason?` (${position.reason})`:''));paint();
  }
  function dropPendingFlat() {
    if(pendingFlat){pendingFlat.resolve({ok:false,error:'CANCELLED',skipped:true});pendingFlat=null;}
  }
  function invalidateSource() {
    cancelDispatchWaits('CANCELLED');
    ++sourceGeneration;++observationEpoch;++positionRevision;sourceActiveRequested=false;latestObservedState='UNKNOWN';flatTask=null;latestPositionTask=null;dropPendingFlat();
    flushSignalQueue('CANCELLED');
    const held=isOpen(position?.state)?position.state:isOpen(position?.held)?position.held:null;
    if(held||entryPending||position?.pendingId)applyPosition({state:{position:{state:held?'UNKNOWN':'PENDING',held,pendingId:entryPending?.id??position?.pendingId,canEnter:false,reason:held?'LAST_OPEN_MARKER':'AWAITING_POSITION_MARKER'}}});
    else{position=null;text('position-state','ממתין לאישור מצב הפוזיציה');text('position-detail','הבחירה נשארת פעילה; ממתין לתמונות חדשות מהגרף.');}
  }
  function evidence(last) {
    if (!last || typeof last !== 'object' || !Number.isFinite(last.at) || last.at < lastAt) return;
    lastAt = last.at;
    const expected = last.side === 'LONG' ? 'Shift+B' : last.side === 'SHORT' ? 'Shift+S' : null;
    text('shortcut-last-key', expected && last.key === expected ? last.key : '—');
    text('shortcut-last-time', new Date(last.at).toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
    text('shortcut-last-result', describe(last.code)+(validDelay(last.delayMs) ? ` דיליי שנבחר לאיתות: ${last.delayMs} ms.` : ''));
    el['shortcut-last-result'].dataset.code = String(last.code ?? 'UNKNOWN');
  }
  function currentSession(response) {
    if (response?.state?.session !== undefined && response.state.session !== session) {
      enabled = false; changing = false; initialized = false; generation++; paint();
      invalidateSource();++targetEpoch;
      clearReadiness('החיבור השתנה; יש לטעון מחדש כדי לבדוק מיקוד.');
      status(describe('SESSION_CHANGED'));
      delayStatus('החיבור השתנה. יש לטעון מחדש כדי לשנות את הדיליי.',true);
      return false;
    }
    return true;
  }
  const resultCode = response => response?.code ?? response?.error ?? response?.state?.last?.code ?? 'NO_RESPONSE';
  function accept(response, token, { showStatus = false, delayToken = delayEpoch,positionToken=positionRevision,targetToken=targetEpoch } = {}) {
    if (!currentSession(response)) return false;
    applyChartContext(response);
    applyDelay(response, delayToken);
    applyTarget(response,targetToken);applyPosition(response,positionToken);
    // Last-attempt evidence remains useful after Stop, but may never re-enable the UI.
    evidence(response?.state?.last);
    if (token !== generation) return true;
    applyReadiness(response,targetToken);
    if (response?.state?.enabled === false && enabled) { enabled = false; generation++; paint(); }
    if (showStatus) status(describe(resultCode(response)));
    return true;
  }
  paint();
  const ready = Promise.resolve().then(() => replyDeadline(send({type:'SHORTCUT_INIT', session}))).then(response => {
    if (!currentSession(response)) return response;
    initialized = response?.ok === true;
    applyChartContext(response);
    applyTarget(response);applyPosition(response);
    applyDelay(response, 0);
    delayStatus(initialized ? 'הגדרת הדיליי מוכנה.' : 'לא ניתן לטעון את הגדרת הדיליי.', !initialized);
    evidence(response?.state?.last);
    status(initialized ? 'קיצורי המקלדת כבויים. הפעלה מתבצעת רק בלחיצה שלך.' : describe(response?.error ?? 'INIT_FAILED'));
    paint();
    return response;
  }).catch(error => {
    initialized = false; status('לא ניתן להתחבר לרכיב קיצורי המקלדת.');
    delayStatus('לא ניתן לטעון את הגדרת הדיליי.', true);
    log(`SHORTCUT_INIT_ERROR | ${String(error?.message ?? error)}`); paint();
    return {ok:false,error:'INIT_FAILED'};
  });
  async function refreshTargets() {
    if(!initialized||targetRefreshing||targetChanging)return;
    targetRefreshing=true;const token=generation,targetToken=targetEpoch,positionToken=positionRevision,delayToken=delayEpoch;
    try{const response=await replyDeadline(send({type:'SHORTCUT_TARGETS',session}));accept(response,token,{targetToken,positionToken,delayToken});return response;}
    catch(error){log(`SHORTCUT_TARGETS_ERROR | ${String(error?.message??error)}`);return {ok:false,error:'TARGET_UNAVAILABLE'};}
    finally{targetRefreshing=false;}
  }
  el['shortcut-target'].addEventListener('focus',()=>{void refreshTargets();});
  el['shortcut-target'].addEventListener('change',()=>{void selectTarget();});
  async function selectTarget() {
    if(!initialized||targetChanging)return;
    const tabId=Number(el['shortcut-target'].value);
    if(!Number.isSafeInteger(tabId)||!targets.some(item=>item.id===tabId)){status(describe('TARGET_SELECTION_REQUIRED'));paintTargets();return;}
    invalidateSource();const targetToken=++targetEpoch,positionToken=positionRevision,token=generation,delayToken=delayEpoch;
    clearReadiness();
    position=null;targetChanging=true;text('position-state','ממתין לתמונה מהגרף שנבחר');text('position-detail','נדרשת תמונת מצב חדשה לאחר בחירת הלשונית.');paint();
    try{const response=await replyDeadline(send({type:'SHORTCUT_TARGET',session,tabId}));accept(response,token,{targetToken,positionToken,delayToken});if(!response?.ok)status(describe(resultCode(response)));return response;}
    catch(error){status(describe('TARGET_UNAVAILABLE'));log(`SHORTCUT_TARGET_ERROR | ${String(error?.message??error)}`);return {ok:false,error:'TARGET_UNAVAILABLE'};}
    finally{targetChanging=false;paint();paintTargets();}
  }
  function sendPosition(sample,epoch,targetToken,isFlat) {
    const positionToken=++positionRevision,token=generation,delayToken=delayEpoch;
    const task=(async()=>{
      if(epoch!==observationEpoch||targetToken!==targetEpoch)return {ok:false,error:'CANCELLED',skipped:true};
      try{
        const response=await replyDeadline(send({type:'SHORTCUT_POSITION',session,...sample}));
        if(epoch===observationEpoch&&targetToken===targetEpoch)accept(response,token,{positionToken,targetToken,delayToken});
        return response;
      }catch(error){
        if(positionToken===positionRevision){text('position-state','לא התקבל עדכון מצב פוזיציה');text('position-detail','ממתין לתמונה עדכנית; לא ניתן לאשר כניסה.');position=null;paint();}
        log(`SHORTCUT_POSITION_ERROR | ${String(error?.message??error)}`);return {ok:false,error:'POSITION_UNKNOWN'};
      }
    })();
    latestPositionTask=task;if(isFlat)flatTask=task;
    void task.finally(()=>{
      if(latestPositionTask===task)latestPositionTask=null;
      if(flatTask===task){
        flatTask=null;
        const next=pendingFlat;pendingFlat=null;
        if(next){
          if(next.epoch!==observationEpoch||next.targetToken!==targetEpoch)next.resolve({ok:false,error:'CANCELLED',skipped:true});
          else void sendPosition(next.sample,next.epoch,next.targetToken,true).then(next.resolve);
        }
      }
    });
    return task;
  }
  function observePosition(sample) {
    if(!initialized)return ready.then(()=>initialized?observePosition(sample):{ok:false,error:'INIT_FAILED'});
    if(!target||targetChanging)return Promise.resolve({ok:false,error:'TARGET_SELECTION_REQUIRED'});
    if(!Number.isFinite(sample?.capturedAt)||sample.capturedAt<=targetChangedAt)return Promise.resolve({ok:false,error:'TARGET_CHANGED',skipped:true});
    const state=['FLAT','LONG','SHORT','UNKNOWN'].includes(sample?.state)?sample.state:'UNKNOWN';
    latestObservedState=state;if(isOpen(state)){++riskEpoch;cancelDispatchWaits('IGNORED_POSITION_OPEN');flushSignalQueue('IGNORED_POSITION_OPEN');}
    const bound={...sample,targetId:target.id,targetUrl:target.url,context:`${String(sample?.context??'')}|target=${target.id}:${target.url}`};
    const epoch=observationEpoch,targetToken=targetEpoch;
    if(state!=='FLAT'){
      if(pendingFlat&&pendingFlat.sample.capturedAt<=bound.capturedAt)dropPendingFlat();
      // A newer blocking observation supersedes an older request even if its
      // response was lost. Later flat frames must not wait behind that request.
      if(flatTask)flatTask=null;
      return sendPosition(bound,epoch,targetToken,false);
    }
    if(!flatTask)return sendPosition(bound,epoch,targetToken,true);
    if(pendingFlat){pendingFlat.sample=bound;return pendingFlat.promise;}
    let resolve;const promise=new Promise(done=>{resolve=done;});pendingFlat={sample:bound,epoch,targetToken,promise,resolve};return promise;
  }
  async function flushPositions() {
    const waits=[];if(latestPositionTask)waits.push(latestPositionTask);if(pendingFlat)waits.push(pendingFlat.promise);
    if(waits.length)await Promise.all(waits);
  }
  el['shortcut-delay'].addEventListener('input', () => { delayDirty=true; });
  el['shortcut-delay'].addEventListener('change', () => { void saveDelay(); });
  async function saveDelay() {
    if (!initialized || delaySaving) return;
    const raw=el['shortcut-delay'].value.trim(), value=Number(raw);
    delayDirty=true;
    if (!/^\d+$/.test(raw) || !validDelay(value)) {
      el['shortcut-delay'].setAttribute('aria-invalid','true');
      delayStatus(`יש להזין מספר שלם בין 0 ל־${MAX_SHORTCUT_DELAY_MS} מילישניות.`, true); return;
    }
    const token=++delayEpoch;
    const targetToken=targetEpoch,positionToken=positionRevision;
    delaySaving=true;el['shortcut-delay'].setAttribute('aria-invalid','false');paint();delayStatus('שומר דיליי…');
    try {
      const response=await replyDeadline(send({type:'SHORTCUT_DELAY',session,delayMs:value}));
      if (!currentSession(response)) return;
      applyTarget(response,targetToken);applyPosition(response,positionToken);
      const applied=applyDelay(response,token);
      if (response?.ok === true && applied) {
        delayDirty=false;el['shortcut-delay'].value=String(delayMs);delayStatus(`הדיליי נשמר: ${delayMs} ms.`);
      } else delayStatus(`לא התקבל אישור לשמירת הדיליי. הערך האחרון שאושר: ${delayMs} ms.`,true);
    } catch(error) {
      delayStatus(`לא התקבל אישור לשמירת הדיליי. הערך האחרון שאושר: ${delayMs} ms.`,true);
      log(`SHORTCUT_DELAY_ERROR | ${String(error?.message ?? error)}`);
    } finally { delaySaving=false;paint(); }
  }
  async function pause(reason = 'SOURCE_STOPPED', {ended=false}={}) {
    const manual=reason==='USER_STOPPED',shouldSend=manual||ended||sourceActiveRequested;
    const token = manual?++generation:generation;
    const delayToken=delayEpoch;
    if(shouldSend)invalidateSource();else{++sourceGeneration;flushSignalQueue('CANCELLED');}
    const positionToken=positionRevision,targetToken=targetEpoch;
    if(manual){enabled=false;changing=false;}paint();
    if(manual)clearReadiness('קיצורי המקלדת כבויים; בדיקת המיקוד מושהית.');
    status(manual?'קיצורי המקלדת נעצרו.':enabled||changing?'קיצורי המקלדת נשארים פעילים וממתינים לחזרת המעקב.':'המעקב נעצר. בחירת קיצורי המקלדת לא השתנתה.');
    // INIT precedes SET even when Stop arrives during startup.
    await ready;
    if(!shouldSend)return {ok:true,skipped:true};
    try {
      const response = await replyDeadline(send(manual?{type:'SHORTCUT_SET',session,enabled:false,intent:token,sourceIntent:sourceGeneration}:{type:'SHORTCUT_SOURCE',session,active:false,sourceIntent:sourceGeneration,...(ended?{ended:true}:{})}));
      accept(response, token, {delayToken,positionToken,targetToken});
      if (!response?.ok && token === generation) status(manual?'ההפעלה המקומית כבויה; לא התקבל אישור עצירה מרכיב ההקשה.':'הבחירה נשארה פעילה; לא התקבל אישור להשהיית המעקב.');
      return response;
    } catch (error) {
      log(`SHORTCUT_PAUSE_ERROR | ${String(error?.message ?? error)}`);
      if (token === generation) status(manual?'ההפעלה המקומית כבויה; לא התקבל אישור עצירה מרכיב ההקשה.':'הבחירה נשארה פעילה; לא התקבל אישור להשהיית המעקב.');
      return {ok:false,error:'STOP_UNCONFIRMED'};
    }
  }
  async function toggle() {
    if (enabled) { await pause('USER_STOPPED'); return; }
    if (!initialized || changing) return;
    if(!target){status(describe('TARGET_SELECTION_REQUIRED'));return;}
    if (!isRunning()) { status('יש להתחיל מעקב לפני הפעלת קיצורי המקלדת.'); return; }
    const token = ++generation;
    const delayToken=delayEpoch;
    const targetToken=targetEpoch,positionToken=positionRevision;
    changing = true; paint();
    try {
      await onEnable();
      if (token !== generation || !isRunning()) return;
      const response = await replyDeadline(send({type:'SHORTCUT_SET', session, enabled:true,intent:token,sourceIntent:sourceGeneration}));
      if (!currentSession(response)) return;
      applyTarget(response,targetToken);applyPosition(response,positionToken);
      applyDelay(response,delayToken);
      evidence(response?.state?.last);
      if (token !== generation) return;
      enabled = response?.ok === true && response.state?.enabled === true && isRunning();
      status(enabled ? 'הקיצורים פעילים עד כיבוי ידני. כניסה אחת בכל פעם, והמשך אוטומטי לאחר סגירה מאומתת.' : describe(response?.error ?? 'ENABLE_FAILED'));
    } catch (error) {
      if (token === generation) {
        enabled=false;changing=false;const stopIntent=++generation;paint();
        // A missing acknowledgement can arrive after the timeout. A newer
        // versioned off intent fences that activation on the worker too.
        void replyDeadline(send({type:'SHORTCUT_SET',session,enabled:false,intent:stopIntent,sourceIntent:sourceGeneration})).catch(()=>{});
        status('לא התקבל אישור הפעלה. ניתן לנסות להפעיל שוב.');
      }
      log(`SHORTCUT_ENABLE_ERROR | ${String(error?.message ?? error)}`);
    } finally { if (token === generation) { changing=false; paint(); } }
  }
  el['shortcut-toggle'].addEventListener('click', () => { void toggle(); });
  function dispatch(item) {
    if (!enabled || !isRunning()) return Promise.resolve(outcome({ok:false,error:'SOURCE_STOPPED',skipped:true}));
    if (!['UP','DOWN'].includes(item?.direction) || !ID.test(item.event?.signalId ?? '') || !Number.isFinite(item.event?.confirmedAt)||!Number.isFinite(item.event?.firstSeenAt)||item.event.firstSeenAt>item.event.confirmedAt) {
      status(describe('INVALID_SIGNAL')); return Promise.resolve(outcome({ok:false,error:'INVALID_SIGNAL',skipped:true}));
    }
    if(consumed.has(item.event.signalId)){status(describe('IGNORED_DUPLICATE'));return Promise.resolve(outcome({ok:true,code:'IGNORED_DUPLICATE',skipped:true}));}
    consumed.add(item.event.signalId);if(consumed.size>2048)consumed.delete(consumed.values().next().value);
    const blocked=positionBlock()??(dispatching?'IGNORED_ENTRY_PENDING':null);
    if(blocked){status(describe(blocked));return Promise.resolve(outcome({ok:false,error:blocked,code:blocked,skipped:true}));}
    return new Promise(resolve=>{
      const ticket={item,token:generation,sourceToken:sourceGeneration,targetToken:targetEpoch,riskToken:riskEpoch,delayToken:delayEpoch,eventDelayMs:delayMs,resolve};
      startSignal(ticket);
    });
  }
  function startSignal(ticket){
    dispatching=true;
    const finish=result=>{dispatching=false;const next=signalQueue.shift();if(next)startSignal(next);ticket.resolve(result);};
    void executeDispatch(ticket).then(finish,error=>finish(outcome({ok:false,error:'UNCERTAIN',code:'UNCERTAIN',detail:String(error?.message??error)})));
  }
  async function executeDispatch({item,token,sourceToken,targetToken,riskToken,delayToken,eventDelayMs}) {
    let cancel;
    const cancelled=new Promise(resolve=>{cancel=resolve;});dispatchCancellations.add(cancel);
    const current=operation=>Promise.race([operation,cancelled.then(code=>{throw Object.assign(Error(code),{shortcutCancelled:true,code});})]);
    const side=item.direction==='UP'?'LONG':'SHORT';
    const unchanged=()=>token===generation&&sourceToken===sourceGeneration&&targetToken===targetEpoch&&riskToken===riskEpoch&&enabled&&isRunning();
    const skip=code=>{status(describe(code));log(`SHORTCUT_RESULT | ${side} | id=${item.event.signalId} | ${code}`);return outcome({ok:false,error:code,code,skipped:true});};
    let signalRequested=false;
    try {
      await current(flushPositions());
      if(!unchanged())return skip(riskToken!==riskEpoch?'IGNORED_POSITION_OPEN':'CANCELLED');
      let blocked=positionBlock();if(blocked)return skip(blocked);
      sourceActiveRequested=true;
      const positionToken=positionRevision;
      const source=await current(replyDeadline(send({type:'SHORTCUT_SOURCE',session,active:true,sourceIntent:sourceToken})));
      if(!accept(source,token,{targetToken,positionToken,delayToken}))return outcome({...source,ok:false,error:'SESSION_CHANGED',code:'SESSION_CHANGED'});
      if(positionToken!==positionRevision)await current(flushPositions());
      if(!unchanged())return skip(riskToken!==riskEpoch?'IGNORED_POSITION_OPEN':'CANCELLED');
      if(source?.ok!==true||source.state?.sourceActive!==true)return skip(resultCode(source));
      blocked=positionBlock();if(blocked)return skip(blocked);
      if (eventDelayMs > 0) status(`התקבל חץ חדש; דיליי מוגדר: ${eventDelayMs} ms. ממתין לתוצאת שליחת הקיצור.`);
      const signalPositionToken=positionRevision;
      signalRequested=true;
      entryPending={id:item.event.signalId,at:now()};
      const request=send({type:'SHORTCUT_SIGNAL',session,id:item.event.signalId,side,firstSeenAt:item.event.firstSeenAt,detectedAt:item.event.confirmedAt,capturedDelayMs:eventDelayMs,sourceIntent:sourceToken});
      // A late reply may update attempt evidence, but cannot restore old
      // position proof or re-arm a cancelled source.
      void Promise.resolve(request).then(reply=>{if(reply?.state?.session===undefined||reply.state.session===session)evidence(reply?.state?.last);},()=>{});
      const response=await current(replyDeadline(request,requestTimeoutMs+eventDelayMs));
      const returnedCode=resultCode(response);
      if(!['SENT_UNCONFIRMED','UNCERTAIN'].includes(returnedCode)&&response?.state?.position?.state!=='PENDING'&&!response?.state?.position?.pendingId)entryPending=null;
      const accepted=accept(response,token,{showStatus:sourceToken===sourceGeneration,delayToken,positionToken:signalPositionToken,targetToken});
      log(`SHORTCUT_RESULT | ${side} | id=${item.event.signalId} | ${accepted ? resultCode(response) : 'SESSION_CHANGED'}`);
      return outcome(accepted?response:{...response,ok:false,error:'SESSION_CHANGED',code:'SESSION_CHANGED'});
    } catch (error) {
      // A lost response is not proof that the key was not dispatched. Never retry.
      const code=signalRequested?'UNCERTAIN':error?.shortcutCancelled?error.code:'SOURCE_UNAVAILABLE';
      if(token===generation&&sourceToken===sourceGeneration)status(describe(code));
      log(`SHORTCUT_RESULT | ${side} | id=${item.event.signalId} | ${code}`);
      return outcome({ok:false,error:code,code});
    }finally{dispatchCancellations.delete(cancel);}
  }
  const timer=setInterval(async()=>{
    if(!initialized||!enabled||polling||changing)return;
    const token=generation,delayToken=delayEpoch,positionToken=positionRevision,targetToken=targetEpoch;polling=true;
    try{const response=await replyDeadline(send({type:'SHORTCUT_STATUS',session}));accept(response,token,{delayToken,positionToken,targetToken});}catch{/* The next signal still requires its own worker response. */}finally{polling=false;}
  },1000);
  timer?.unref?.();
  // Reserve the exclusive route during enable as well as after worker acknowledgement.
  async function dispose(){clearInterval(timer);enabled=false;changing=false;const intent=++generation;invalidateSource();await ready;return replyDeadline(send({type:'SHORTCUT_DISPOSE',session,intent}));}
  async function noteLatest(event){
    if(!enabled||!isRunning())return {ok:false,code:'DISABLED'};
    return replyDeadline(send({type:'SHORTCUT_LATEST',session,id:event.signalId,firstSeenAt:event.firstSeenAt,detectedAt:event.confirmedAt,sourceIntent:sourceGeneration}));
  }
  return {isEnabled:()=>enabled || changing,pause,dispatch,noteLatest,observePosition,refreshTargets,dispose,getTarget:()=>target&&!targetChanging?{...target}:null,ready};
}
