import {analyzeGuideSignals} from './guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';
import {describeGuideAnalysis} from './guide-explanations.mjs';
import {renderGuideAnalysis} from './guide-analysis-view.mjs';
import {normalizeReplayDataset,buildReplayAnalysisInput,readReplayChartGate,presentReplayAnalysis} from './replay-research.mjs';
import {readTradingViewWindowEvidence} from './tradingview-window-reader.mjs';
import {prepareTradingViewWindowUi} from './tradingview-window-controls.mjs';
import {replayChartOverlayCommand} from './replay-chart-overlay.mjs';
import {createReplayReservationLedger} from './replay-execution-ledger.mjs';
import {createUserMarketExecutionFlow} from './user-market-execution-flow.mjs';
import {userMarketTradingUiCommand} from './user-market-trading-ui.mjs';
import {inspectReplayOrderPreset} from './replay-order-preset-inspector.mjs';
import {describeGuideStrategyStatus,renderGuideStrategyStatus} from './guide-strategy-status.mjs';
import {watchBrokerAccountChanges} from './broker-account-change-guard.mjs';

export const USER_MARKET_RESEARCH_VERSION='0.30.5';
const VERIFIED_RESEARCH_HISTORY_PATH='verification/0.19.0/older-batch/native-NQ-session-2026-10-30.json';
const VERIFIED_RESEARCH_HISTORY_SHA256='a2e64a858078f1e75c72a481a977f7d09d0f65500b01e606fbabc31428ea7baa';
const copy=value=>structuredClone(value),fail=code=>{throw Error(code);};
if(typeof document!=='undefined'&&document.getElementById('user-market-research-root'))initializeUserMarketResearchPage();

export function initializeUserMarketResearchPage(){
  const $=id=>document.getElementById(id),extension=!!globalThis.chrome?.scripting;
  let dataset=null,inputFile=null,session=null,serial=0,busy=false,timer=null,latest=null,failure=null,flow=null,controlsInspection=null,bracketPresetInspection=null,executionRecord=null;
  const journal=[];
  const state=()=>flow?.snapshot()??{state:'DISARMED',armed:false,submissionAttempted:false,locked:false};
  function status(text,kind=''){ $('market-status').textContent=text;$('market-status').dataset.state=kind; }
  function controlsReady(result,target=session?.target){
    const at=Date.now(),quantity=result?.controls?.quantity,buy=result?.controls?.buy,sell=result?.controls?.sell,raw=typeof quantity?.quantityRaw==='string'?quantity.quantityRaw.trim().replace(/,/g,''):'';
    return !!target&&result?.status==='USER_MARKET_CONTROLS_OBSERVED'&&result.provider==='REPLAY_TRADING'&&result.mode==='USER_MARKET'
      &&result.sourceTabId===target.sourceTabId&&result.researchUrl===target.researchUrl&&result.instrument==='CME_MINI:NQ1!'&&result.timeframe==='1'
      &&Number.isFinite(result.observedAt)&&result.observedAt<=at&&at-result.observedAt<=2000
      &&quantity?.sourceControl==='input#dom-quantity-input[data-qa-id~="qty-dom-input"]'&&quantity.disabled===false&&quantity.readOnly===false
      &&/^\d+(?:\.\d+)?$/.test(raw)&&Number.isSafeInteger(quantity.quantity)&&quantity.quantity>0&&quantity.quantity<=1000000&&Number(raw)===quantity.quantity
      &&buy?.label==='Buy Mkt'&&buy.disabled===false&&sell?.label==='Sell Mkt'&&sell.disabled===false;
  }
  function lock(){
    const s=state();
    for(const id of ['market-file','market-tab','market-refresh'])$(id).disabled=busy||!!session;
    $('market-load-verified').disabled=!extension||busy||!!session;
    $('market-start').disabled=!extension||!dataset||busy||!!session;
    $('market-stop').disabled=!session;
    $('market-analyze').disabled=busy||!session;
    $('market-arm').disabled=busy||!session?.sourceRun||s.armed||s.locked||s.submissionAttempted||!!s.intent||!controlsReady(controlsInspection);
    $('market-disarm').disabled=!s.armed&&!s.submissionAttempted;
    $('market-reconcile').disabled=busy||!session||!s.submissionAttempted;
    $('market-export').disabled=busy||!latest&&!failure&&!journal.length&&!s.submissionAttempted&&!controlsInspection&&!bracketPresetInspection;
    $('market-inspect').disabled=!extension||busy||s.armed;
    $('market-inspect-brackets').disabled=!extension||busy||s.armed;
  }
  async function execute(func,args,tabId=session?.tabId){
    if(!extension||!Number.isSafeInteger(tabId))fail('USER_MARKET_RESEARCH_SOURCE_REQUIRED');
    return (await chrome.scripting.executeScript({target:{tabId},func,args,world:'ISOLATED'}))[0]?.result??null;
  }
  const native=command=>execute(userMarketTradingUiCommand,[command],command.expected?.sourceTabId);
  async function source(active,token){
    const tab=await chrome.tabs.get(active.tabId);
    if(session!==active||serial!==token||tab.url!==active.target.researchUrl)fail('USER_MARKET_RESEARCH_TARGET_CHANGED');
    const gate=await execute(readReplayChartGate,[{allowResearchMultiChart:true}],active.tabId);
    if(!gate?.ok)fail(gate?.reasonCodes?.[0]??'USER_MARKET_CHART_GATE_FAILED');
    let evidence;
    for(let attempt=0;attempt<5;attempt++){
      evidence=await execute(readTradingViewWindowEvidence,[{sessionId:active.id,allowResearchMultiChart:true}],active.tabId);
      if(session!==active||serial!==token)fail('USER_MARKET_RESEARCH_CONTEXT_CHANGED');
      if(evidence?.replayWitness)break;
      if(!(evidence?.reasonCodes??[]).some(code=>['WINDOW_STUDY_NOT_VISIBLE','WINDOW_FIELDS_NOT_MOUNTED','DATA_WINDOW_NOT_SELECTED','WINDOW_STUDY_NOT_FOUND'].includes(code)))break;
      await execute(prepareTradingViewWindowUi,[{allowResearchMultiChart:true}],active.tabId);
    }
    if(!evidence?.replayWitness)fail(evidence?.reasonCodes?.[0]??'USER_MARKET_COHERENT_SOURCE_REQUIRED');
    if(active.sourceRun&&active.sourceRun!==evidence.replayWitness.runId)fail('USER_MARKET_SOURCE_RUN_CHANGED');
    const analysisInput=buildReplayAnalysisInput(dataset,evidence,{userManagedRisk:true});
    return {analysisInput,replayWitness:evidence.replayWitness,evidence};
  }
  flow=createUserMarketExecutionFlow({
    requireInheritedPreset:false,
    getContext:()=>({active:!!session,generation:serial,target:session?.target??null,sourceSessionId:session?.id??null,sourceRunId:session?.sourceRun??null}),
    readSource:async({expected})=>{
      const active=session,token=serial;
      if(!active||expected.sourceTabId!==active.tabId||expected.researchUrl!==active.target.researchUrl)fail('USER_MARKET_PINNED_RESEARCH_REQUIRED');
      return source(active,token);
    },
    readPresetAndInventory:command=>native({action:'read_preset',...command}),
    submitMarket:async(command,{isCurrent})=>isCurrent()?native({action:'submit',...command}):{status:'BLOCKED',submitted:false,reasonCodes:['USER_MARKET_CONTEXT_CHANGED']},
    verifySubmission:command=>native({action:'verify',...command}),
    disarmDriver:command=>native({action:'disarm',...command}),
    reserve:createReplayReservationLedger({storage:globalThis.chrome?.storage?.local,locks:globalThis.navigator?.locks}),
    onChange:renderExecution
  });
  function renderExecution(s){
    const labels={DISARMED:'כניסה אוטומטית כבויה.',ARMED:'כניסת Market דרוכה; ממתין לתרחיש מאושר לפי כל תנאי האסטרטגיה שלו.',PREFLIGHT:'קורא את כמות ה־DOM ומוודא שאין פוזיציה או פקודות ממתינות.',SUBMITTING:'ניסיון Market יחיד לפי הכיוון המאושר והכמות שהגדרת.',FILLED_USER_MANAGED:'אומת מילוי לפי הכיוון והכמות שנקראו; ניהול העסקה בידיך.',UNKNOWNLOCK:'תוצאת הניסיון אינה מאומתת. כניסות נוספות נעצרו.',BLOCKED:'הכניסה חסומה בגלל מקור, כיוון או מצב ביצוע לא מאומת.'};
    $('market-execution-status').textContent=labels[s.state]??'מצב ניסיון הכניסה דורש בדיקה.';
    $('market-execution-detail').textContent=(s.reason?`מצב: ${s.reason}. `:'')+'כל אסטרטגיה נבדקת לפי תנאי החובה שלה, ללא תוכנית סיכון של הבוט. הכמות נקראת מבקרי Market; ניהול הסיכון והעסקה בידיך. ירושת סטופ ויעד אינה מאומתת ואינה תנאי לכניסה במסלול הזה.';
    const timing=s.timing??{},spans=[];
    if(Number.isFinite(timing.firstCaptureToClickMs))spans.push(`הקריאה המקורית → לחיצת Market: ${timing.firstCaptureToClickMs.toFixed(1)} ms`);
    if(Number.isFinite(timing.firstCaptureToFillVerificationMs))spans.push(`הקריאה המקורית → אימות מילוי: ${timing.firstCaptureToFillVerificationMs.toFixed(1)} ms`);
    if(timing.protectedFillMeasured===true&&Number.isFinite(timing.firstCaptureToProtectedFillVerificationMs))spans.push(`הקריאה המקורית → מילוי ושתי הגנות: ${timing.firstCaptureToProtectedFillVerificationMs.toFixed(1)} ms`);
    $('market-order-timing').textContent=spans.length?spans.join(' · ')+(timing.protectedFillMeasured===true?'':' · זמן עד מילוי עם סטופ ויעד טרם נמדד.'):'טרם נמדד רצף מאישור טכני טבעי עד מילוי עם סטופ ויעד. זמני קריאה חוזרת נשמרים בנפרד; אין כאן מדידת בורסה.';
    if(!s.armed&&timer!==null){clearTimeout(timer);timer=null;}
    lock();
  }
  async function clear(active){
    if(!active)return;
    try{await execute(replayChartOverlayCommand,[{action:'clear',sessionId:active.id}],active.tabId);}catch{}
  }
  async function stop(reason='USER_MARKET_RESEARCH_STOPPED'){
    serial++;if(timer!==null){clearTimeout(timer);timer=null;}
    const previous=session;
    try{await flow.disarm(reason);}catch{}
    session=null;await clear(previous);renderGuideStrategyStatus($('market-strategies'),null);lock();
  }
  function schedule(){
    if(timer!==null)clearTimeout(timer);timer=null;
    if(!session||!state().armed)return;
    timer=setTimeout(()=>{timer=null;void analyze({automatic:true}).finally(schedule);},500);
  }
  async function analyze({automatic=false}={}){
    if(busy||!session)return;busy=true;lock();
    const active=session,token=serial,started=performance.now();
    try{
      const read=await source(active,token);
      if(session!==active||serial!==token)return;
      active.sourceRun??=read.replayWitness.runId;
      const input=read.analysisInput;
      if(automatic&&latest?.cutoff?.asOfTime===input.options.asOfTime){
        if(state().submissionAttempted&&state().state!=='FILLED_USER_MANAGED')await flow.reconcile();
        return;
      }
      const beforeAnalysis=performance.now(),analysis=analyzeGuideSignals(input.bars,input.options),decision=selectGuideTechnicalDecision({analysis,bars:input.bars,asOfTime:input.options.asOfTime});
      const analysisMs=performance.now()-beforeAnalysis;
      if(decision.status==='BLOCKED')fail(decision.reasonCodes[0]??'TECHNICAL_DIRECTION_BLOCKED');
      renderGuideAnalysis($('market-analysis'),describeGuideAnalysis(analysis));
      renderGuideStrategyStatus($('market-strategies'),describeGuideStrategyStatus(analysis,{technicalDecision:decision}));
      const record={kind:'NQ_USER_MARKET_RESEARCH_OBSERVATION',extensionVersion:USER_MARKET_RESEARCH_VERSION,executionPolicy:'USER_PRESET_MARKET',mode:'REPLAY',liveEligible:false,orderEligible:false,testOnly:false,
        sessionId:active.id,sourceTabId:active.tabId,inputFile,observedAt:new Date().toISOString(),availabilityAssumption:input.availabilityAssumption,cutoff:input.cutoff,replayWitness:read.replayWitness,chart:read.evidence.chart,analysisInputs:{bars:input.bars,options:input.options},analysis,decision:{...decision,currentChecks:analysis.currentChecks}};
      if(state().armed)record.userMarketExecution=await flow.accept({sessionId:active.id,sourceTabId:active.tabId,technicalDecision:decision,decision,analysis,analysisInput:input,replayWitness:read.replayWitness});
      if(record.userMarketExecution?.submissionAttempted)executionRecord=record;
      if(session!==active||serial!==token)return;
      latest=record;
      $('market-cutoff').textContent='סגירת הנר שנבדק: '+new Date(input.options.asOfTime).toISOString()+' · כיוון וסגירה מאשרת בלבד; ללא חישוב סיכון של הבוט.';
      const presentation=await presentReplayAnalysis({record,researchUrl:active.target.researchUrl,isCurrent:()=>session===active&&serial===token,execute:(func,args)=>execute(func,args,active.tabId)});
      if(session!==active||serial!==token)return;
      if(presentation.status!=='REPLAY_PRESENTATION_RENDERED'){
        const s=state(),changed=presentation.reasonCodes?.includes('REPLAY_WITNESS_CHANGED');
        if(changed&&s.armed&&!s.submissionAttempted&&!s.locked&&!s.intent&&['ARMED','BLOCKED'].includes(s.state)&&(active.idleSourceRecoveries??0)<3){
          const fresh=await source(active,token);
          if(session!==active||serial!==token)return;
          active.idleSourceRecoveries=(active.idleSourceRecoveries??0)+1;
          active.recoveryEpisode??={kind:'USER_MARKET_IDLE_SOURCE_RECOVERY',firstWitness:copy(read.replayWitness),firstSourceDocumentTimeOrigin:read.replayWitness.sourceDocumentTimeOrigin,firstSourceObservedEpochMs:read.replayWitness.sourceObservedEpochMs,attempts:[],ordersAttempted:false};
          active.recoveryEpisode.attempts.push({code:'REPLAY_WITNESS_CHANGED',failedWitness:copy(read.replayWitness),freshWitness:copy(fresh.replayWitness),recordedAt:new Date().toISOString()});
          latest=null;await clear(active);$('market-analysis').replaceChildren();renderGuideStrategyStatus($('market-strategies'),null);$('market-cutoff').textContent='';$('market-timing').textContent='המקור התקדם; זמן ההתאוששות יימדד מהקריאה הראשונה שנפסלה.';
          $('market-markers').textContent='ממתין לניתוח מלא חדש באותה ריצת Replay; אין אישור מהכרטיס הקודם.';
          status('מקור המחקר התקדם; מבצע קריאה וניתוח חדשים ללא ניסיון פקודה.');return;
        }
        fail(presentation.reasonCodes?.[0]??'USER_MARKET_PRESENTATION_UNVERIFIED');
      }
      record.presentation=presentation;record.timing={analysisMs,receiverOperationMs:performance.now()-started,...presentation.timing};
      if(active.recoveryEpisode){
        const episode=active.recoveryEpisode,receipt=presentation.finalCardReceipt;
        const sameClock=receipt?.documentTimeOrigin===episode.firstSourceDocumentTimeOrigin&&Number.isFinite(episode.firstSourceObservedEpochMs)&&[receipt.firstPaintEpoch,receipt.secondPaintEpoch].every(value=>Number.isFinite(value)&&value>=episode.firstSourceObservedEpochMs);
        episode.sameSourceDocumentClockVerified=sameClock;episode.status='RECOVERED_WITH_FRESH_FULL_ANALYSIS';
        episode.sourceToFinalCardLowerMs=sameClock?receipt.firstPaintEpoch-episode.firstSourceObservedEpochMs:null;
        episode.sourceToFinalCardUpperMs=sameClock?receipt.secondPaintEpoch-episode.firstSourceObservedEpochMs:null;
        record.sourceRecoveryEpisode=copy(episode);active.recoveryEpisode=null;
      }
      active.idleSourceRecoveries=0;
      $('market-markers').textContent=presentation.status==='REPLAY_PRESENTATION_RENDERED'?'החצים הטכניים וכרטיס המחקר אומתו לפי זמן נר האישור.':'עדכון החצים טרם אומת: '+presentation.reasonCodes.join(' · ')+'. נדרש אינדיקטור Arrow התומך בסכמה הטכנית.';
      const timing=presentation.timing;
      const recovery=record.sourceRecoveryEpisode;
      $('market-timing').textContent=recovery?.sameSourceDocumentClockVerified?`מהקריאה הראשונה שנפסלה → כרטיס סופי, כולל התאוששות: ${recovery.sourceToFinalCardLowerMs.toFixed(1)}–${recovery.sourceToFinalCardUpperMs.toFixed(1)} ms. זמן בורסה ומילוי מאיתות טבעי אינם נמדדים כאן.`:timing.sameSourceDocumentClockVerified?`קריאת מקור עקבית → כרטיס סופי: ${timing.sourceToFinalCardLowerMs.toFixed(1)}–${timing.sourceToFinalCardUpperMs.toFixed(1)} ms · חישוב: ${analysisMs.toFixed(1)} ms. זמן בורסה ומילוי מאיתות טבעי אינם נמדדים כאן.`:`חישוב הכיוון: ${analysisMs.toFixed(1)} ms. עדיין אין מדידת תצוגה מלאה מאומתת בהפעלה הזו.`;
      journal.push({asOfTime:decision.asOfTime,status:decision.status,direction:decision.direction,execution:copy(state()),presentationStatus:presentation.status});if(journal.length>100)journal.shift();
      $('market-evidence').textContent=JSON.stringify({decision,execution:state(),timing:record.timing},null,2);
      status(decision.status==='CONFIRMED'?'אושר כיוון טכני '+(decision.direction==='LONG'?'לונג':'שורט')+'. מצב הביצוע מוצג בנפרד.':decision.status==='AMBIGUOUS'?'כיוונים סותרים: ממתין לתרחיש חד־משמעי.':'הניתוח פעיל; ממתין לתרחיש מאושר.','ok');
    }catch(error){
      if(session!==active||serial!==token)return;
      failure={at:new Date().toISOString(),code:String(error?.message??error).slice(0,160),userMarketExecution:copy(state()),executionEvidenceRetained:!!executionRecord};
      await flow.disarm('USER_MARKET_ANALYSIS_OR_SOURCE_FAILED');latest=null;
      $('market-analysis').replaceChildren();renderGuideStrategyStatus($('market-strategies'),null);$('market-cutoff').textContent='';$('market-timing').textContent='אין מדידה תקפה למקור הנוכחי.';
      $('market-evidence').textContent=JSON.stringify(failure,null,2);await clear(active);
      status('הניתוח נעצר: '+failure.code,'error');
    }finally{busy=false;lock();}
  }
  async function refresh(){
    if(!extension){status('המסך פועל מתוך הרחבת Arrow בלבד.','error');return;}
    const tabs=await chrome.tabs.query({url:['https://*.tradingview.com/chart/*','https://tradingview.com/chart/*']});
    $('market-tab').replaceChildren();
    for(const tab of tabs.filter(tab=>/Arrow.*(?:Verification|Research)|(?:Verification|Research).*Arrow/i.test(tab.title??''))){const option=document.createElement('option');option.value=String(tab.id);option.textContent=(tab.title??'גרף מחקר')+' · '+tab.id;$('market-tab').append(option);}
    lock();
  }
  $('market-file').addEventListener('change',()=>{void(async()=>{
    if(session||busy)return;const file=$('market-file').files?.[0];if(!file)return;
    try{if(file.size>160000000)fail('REPLAY_FILE_TOO_LARGE');dataset=normalizeReplayDataset(JSON.parse(await file.text()));inputFile={name:file.name,size:file.size};$('market-file-status').textContent=`נטענו ${dataset.bars.length} נרות דקה והסדרות הסגורות של 5 ו־15 דקות.`;}
    catch(error){dataset=null;status('טעינת ההיסטוריה נכשלה: '+String(error.message??error),'error');}lock();
  })();});
  $('market-load-verified').addEventListener('click',()=>{void(async()=>{
    if(!extension||session||busy)return;
    busy=true;dataset=null;inputFile=null;lock();
    try{
      if(typeof chrome.runtime?.getURL!=='function'||!globalThis.crypto?.subtle)fail('VERIFIED_RESEARCH_HISTORY_LOCAL_RUNTIME_REQUIRED');
      const url=chrome.runtime.getURL(VERIFIED_RESEARCH_HISTORY_PATH),response=await fetch(url,{cache:'no-store',redirect:'error'});
      if(!response.ok)fail('VERIFIED_RESEARCH_HISTORY_FETCH_FAILED');
      const bytes=await response.arrayBuffer();
      if(!bytes.byteLength||bytes.byteLength>160000000)fail('VERIFIED_RESEARCH_HISTORY_SIZE_INVALID');
      const digest=await crypto.subtle.digest('SHA-256',bytes),sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      if(sha256!==VERIFIED_RESEARCH_HISTORY_SHA256)fail('VERIFIED_RESEARCH_HISTORY_HASH_MISMATCH');
      const normalized=normalizeReplayDataset(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
      dataset=normalized;inputFile={name:'native-NQ-session-2026-10-30.json',size:bytes.byteLength,source:'BUNDLED_VERIFIED_NATIVE_RESEARCH_HISTORY',bundledPath:VERIFIED_RESEARCH_HISTORY_PATH,sha256,verification:'SHA256_MATCH'};
      $('market-file-status').textContent=`נטענו ${dataset.bars.length} נרות דקה והסדרות הסגורות של 5 ו־15 דקות · NQ 30/10 · SHA-256 אומת.`;
      status('היסטוריית המחקר המאומתת נטענה. הניתוח והכניסה האוטומטית עדיין כבויים.');
    }catch(error){dataset=null;inputFile=null;$('market-file-status').textContent='היסטוריית המחקר המאומתת לא נטענה.';status('טעינת ההיסטוריה המאומתת נכשלה: '+String(error.message??error),'error');}
    finally{busy=false;lock();}
  })();});
  $('market-refresh').addEventListener('click',()=>{void refresh();});
  async function inspectBracketPreset(expected){
    bracketPresetInspection=await execute(inspectReplayOrderPreset,[{expected}],expected.sourceTabId);
    const result=bracketPresetInspection;
    $('market-bracket-preset').textContent=(result?.status==='USER_REPLAY_BRACKET_PRESET_MISSING'?'אין פריסט שמור בחיבור Replay.':result?.protectionPresetVerified===true?'נקרא פריסט; ירושת ההגנות לאחר Market עדיין דורשת אימות.':'פריסט ההגנות לא אומת: '+(result?.reasonCodes??[result?.status??'NO_REPLY']).join(' · '))+ ' בדיקה אבחונית בלבד; אינה חוסמת את הכניסה במסלול ניהול הסיכון שלך.';
    $('market-evidence').textContent=JSON.stringify({bracketPresetInspection,controlsInspection,execution:state()},null,2);
    return result;
  }
  $('market-inspect-brackets').addEventListener('click',()=>{void(async()=>{
    if(busy||state().armed)return;const tabId=session?.tabId??Number($('market-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)return;
    busy=true;lock();try{const tab=await chrome.tabs.get(tabId);await inspectBracketPreset({researchUrl:tab.url,sourceTabId:tabId,instrument:'CME_MINI:NQ1!',timeframe:'1'});}
    catch(error){$('market-bracket-preset').textContent='בדיקת הפריסט נעצרה: '+String(error.message??error);}
    finally{busy=false;lock();}
  })();});
  async function inspectMarketControls(expected){
    controlsInspection=null;
    controlsInspection=await native({action:'read_controls',expected});
    const controls=controlsInspection?.controls;
    $('market-preset').textContent=controlsInspection?.status==='USER_MARKET_CONTROLS_OBSERVED'?`כמות שנקראה ב־DOM: ${controls?.quantity?.quantityRaw??'חסרה'} · Buy Mkt: ${controls?.buy?.disabled?'מושבת':'זמין'} · Sell Mkt: ${controls?.sell?.disabled?'מושבת':'זמין'}. ירושת פריסט הגנות אינה מאומתת.`:'קריאת בקרי Market נחסמה: '+(controlsInspection?.reasonCodes??[controlsInspection?.status??'NO_REPLY']).join(' · ');
    $('market-evidence').textContent=JSON.stringify({controlsInspection,execution:state()},null,2);
    return controlsInspection;
  }
  $('market-inspect').addEventListener('click',()=>{void(async()=>{
    if(busy||state().armed)return;const tabId=session?.tabId??Number($('market-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)return;
    busy=true;lock();
    try{
      const tab=await chrome.tabs.get(tabId),expected={researchUrl:tab.url,sourceTabId:tabId,instrument:'CME_MINI:NQ1!',timeframe:'1',allowResearchMultiChart:true};
      await inspectMarketControls(expected);
    }catch(error){$('market-preset').textContent='הקריאה נכשלה: '+String(error.message??error);}
    finally{busy=false;lock();}
  })();});
  $('market-start').addEventListener('click',()=>{void(async()=>{
    if(busy||session||!dataset)return;
    const tabId=Number($('market-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)return;
    const tab=await chrome.tabs.get(tabId);session={id:'USER-MARKET:'+crypto.randomUUID(),tabId,sourceRun:null,target:{researchUrl:tab.url,sourceTabId:tabId,instrument:'CME_MINI:NQ1!',timeframe:'1',allowResearchMultiChart:true}};serial++;latest=null;failure=null;await analyze();
  })();});
  $('market-analyze').addEventListener('click',()=>{void analyze();});
  $('market-arm').addEventListener('click',()=>{void(async()=>{
    if(busy||!session?.sourceRun)return;const active=session,token=serial;busy=true;lock();let ready=false;
    try{
      const controls=await inspectMarketControls(active.target);
      if(session!==active||serial!==token)return;
      if(!controlsReady(controls,active.target)){status('הכניסה לא הופעלה: הכמות או בקרי Market המקוריים אינם תקינים, זמינים או טריים.','error');return;}
      ready=(await flow.arm(active.target)).ok===true;
    }catch(error){status('הכניסה לא הופעלה: '+String(error.message??error),'error');}
    finally{busy=false;lock();}
    if(ready){await analyze({automatic:false});schedule();}
  })();});
  $('market-disarm').addEventListener('click',()=>{void(async()=>{serial++;await flow.disarm('USER_MARKET_OPERATOR_STOPPED_ENTRIES');lock();})();});
  $('market-reconcile').addEventListener('click',()=>{void(async()=>{if(busy||!session)return;busy=true;lock();try{await flow.reconcile();}finally{busy=false;lock();}})();});
  $('market-stop').addEventListener('click',()=>{void stop().then(()=>status('המחקר נעצר. ניהול הפוזיציה הקיימת נשאר בידיך.'));});
  $('market-export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({kind:'NQ_USER_MARKET_RESEARCH_EXPORT',schemaVersion:1,extensionVersion:USER_MARKET_RESEARCH_VERSION,exportedAt:new Date().toISOString(),executionPolicy:'USER_PRESET_MARKET',mode:'REPLAY',liveEligible:false,orderEligible:false,latest,journal,failure,controlsInspection,bracketPresetInspection,executionRecord:executionRecord===latest?null:executionRecord,userMarketExecution:state()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='arrow-user-market-research-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const releaseAccountGuard=watchBrokerAccountChanges(globalThis.chrome?.storage,reason=>{controlsInspection=null;void flow.disarm(reason).then(()=>{lock();status('החשבון להפעלה הקרובה השתנה; כניסות נוספות כבויות. ניהול עסקה קיימת נשאר בידיך.');});});
  window.addEventListener('pagehide',()=>{releaseAccountGuard();void stop();});renderExecution(state());void refresh();
  return {snapshot:()=>({active:!!session,busy,latest,failure,execution:state()}),stop};
}
