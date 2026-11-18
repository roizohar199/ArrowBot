import {createLiveOhlcStore} from './live-ohlc-store.mjs';
import {createGuideAnalyzer,GUIDE_SIGNAL_DEFAULTS,GUIDE_ALL_SCENARIO_CONTEXT} from './guide-signal-engine.mjs';
import {describeGuideAnalysis} from './guide-explanations.mjs?revision=strategy-scan-1';
import {renderGuideAnalysis} from './guide-analysis-view.mjs?revision=strategy-scan-1';
import {createLiveTimeframes} from './live-timeframes.mjs';
import {createLiveIntrabar} from './live-intrabar.mjs';
import {sourceDomTimingCommand,createSourceDomLatency} from './live-source-timing.mjs';
import {createLiveSignalLatency} from './live-signal-latency.mjs';
import {parsePineOhlcMessage} from './pine-ohlc-protocol.mjs';
import {readPineLogsEvidence} from './tradingview-log-reader.mjs';
import {readTradingViewWindowEvidence} from './tradingview-window-reader.mjs?revision=continuity-1';
import {prepareTradingViewWindowUi} from './tradingview-window-controls.mjs?revision=continuity-1';
import {GUIDE_PATTERN_LABELS} from './guide-visual-advisor.mjs';
import {LIVE_RULE_FIELD_IDS,LIVE_RULE_CHECK_IDS,makeLiveRuleSettings,loadLiveRuleSettings,saveLiveRuleSettings} from './live-ohlc-settings.mjs';
import {createLiveAccountControls} from './live-account-controls.mjs';
import {selectFreshLiveSignal} from './live-signal-eligibility.mjs';
import {createLiveWindowPollScheduler,windowWakeSourceCommand,validateWindowWakeMessage} from './live-window-wake.mjs';
import {createLiveRuntimeDiagnostics} from './live-runtime-diagnostics.mjs';
import {chartSignalOverlayCommand} from './chart-signal-overlay.mjs';
import {createApprovedDeliveryProbe} from './live-delivery-probe.mjs';
import {createPreopenContext} from './live-preopen-context.mjs';
import {createGuideFormingPreview} from './guide-forming-preview.mjs';
import {createGuideFormingView} from './guide-forming-view.mjs';
import {createClosestGuideStrategyView} from './guide-closest-strategy-view.mjs';
import {createClosestStrategyJournalView} from './guide-closest-strategy-journal.mjs';
import {createLiveWindowClock} from './live-window-clock.mjs';
import {createLivePaperControls} from './live-paper-controls.mjs';
import {watchBrokerAccountChanges} from './broker-account-change-guard.mjs';
import {createLiveUserAccountControls} from './live-user-account-controls.mjs';
import {readTradingViewExecutionAccount} from './tradingview-account-inspector.mjs';
import {isUserManagedLiveMode,userManagedLiveAnalysisOptions,GUIDE_USER_CONTEXT_BALANCED} from './live-user-mode.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';
import {createLivePaperUserControls} from './live-paper-user-controls.mjs?revision=warmup3000-1';
import {createLiveNativeQuickStart,readNativeStartupWarmup} from './live-native-quick-start.mjs';
import {nativeUserMarketUiCommand} from './tradovate-user-market-ui.mjs?revision=native-chart-market-2';
import {createLiveCandleMarkers} from './live-candle-markers.mjs';
import {nativeCandleMarkerUiCommand} from './candle-marker-ui.mjs';
import {createHistory24Controller} from './history-24-controller.mjs';
import {createHistory24View} from './history-24-view.mjs';
import {createHistoryWarmupController} from './history-warmup-controller.mjs';
import {createWarmupModel} from './history-warmup-model.mjs';
import {createLiveResearchUpgrades} from './live-research-upgrades.mjs';
import {createLiveTelegramControls} from './live-telegram-controls.mjs';
export const LIVE_POLL_INTERVAL_MS=50;

// Context-only continuity, never source freshness or an order permit. A reader
// reprime may accompany the clock quarantine in the same completed DOM read.
export function canPreserveWindowClosedContext(evidence,state){
  const m=state?.metadata,b=evidence?.bootstrapMetadata,f=evidence?.windowFrame,d=evidence?.continuityDecisions?.at(-1);
  const checks=['inactivityOnly','forwardBoundedSequence','clockNotRegressed','sourceStrictlyAdvanced','currentNotRegressed','onlyBenignReprimePending','noInvalidSeries','currentAdjacent','historyRowsPresent','observedClosedUnchanged'];
  if(evidence?.resetRequired!==true||!Array.isArray(evidence.reasonCodes)||!evidence.reasonCodes.includes('WINDOW_COHERENCE_REPRIMING')||evidence.reasonCodes.some(code=>!['WINDOW_COHERENCE_REPRIMING','NO_FRESH_SOURCE_PACKET'].includes(code))
    ||!m||!b?.metadata||b.runId!==m.sourceId||m.source!=='ohlc'||b.metadata.source!=='ohlc'||typeof m.sourceUrl!=='string'||m.sourceUrl!==evidence.sourceUrl
    ||state.availabilityClock!=='pine_source_execution_unverified_sync'||!state.bars?.some(bar=>bar.closed===true&&bar.finalOhlcVerified===true)
    ||evidence.chart?.replay!==false||evidence.chart?.documentVisible!==true||f?.coherent!==true||f.checksumsVerified!==true||f.realtime!==true)return false;
  if(['instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'].some(key=>m[key]!==b.metadata[key]))return false;
  const continued=Number.isSafeInteger(d?.sequence)&&Number.isSafeInteger(f.sequence)&&f.sequence>=d.sequence&&f.sequence-d.sequence<4096
    &&Number.isSafeInteger(d.sourceEmittedAt)&&Number.isSafeInteger(f.sourceEmittedAt)
    &&(f.sequence===d.sequence?f.sourceEmittedAt===d.sourceEmittedAt:f.sourceEmittedAt>d.sourceEmittedAt&&f.sourceEmittedAt-d.sourceEmittedAt<=15000);
  return d?.action==='COHERENCE_REPRIME'&&d.runId===b.runId&&d.preserve===true&&d.inactive===true&&Number.isSafeInteger(d.delta)&&d.delta>0&&d.delta<4096
    &&continued&&Array.isArray(d.failedPreserveChecks)&&d.failedPreserveChecks.length===0
    &&d.preserveChecks&&Object.keys(d.preserveChecks).length===checks.length&&checks.every(key=>d.preserveChecks[key]===true);
}

// Exact chart identity is required; ticker suffixes from different exchanges
// cannot silently stand in for one another. Pine's isrealtime is execution
// state and is never promoted into an exchange-data entitlement assertion.
export function verifyLiveChart(packet,evidence,tabId,{provider='TradingView Pine Logs',allowResearchLiveMultiChart=false}={}){
  const chart=evidence?.chart,meta=packet?.metadata,reasons=[];
  const latest=packet?.bars?.at(-1),sourceAt=packet?.sourceEmittedAt;
  // Producer bar time and timenow share Pine's clock. This verifies currentness
  // of a regular bar without assuming that the receiver's wall clock is synced
  // or claiming a paid exchange-data entitlement. An explicit delayed badge
  // always wins. Historical/replay execution cannot pass this fallback.
  const producerFresh=packet?.realtime===true&&chart?.marketOpen===true&&chart?.realtime!==false&&
    Number.isSafeInteger(sourceAt)&&Number.isSafeInteger(latest?.time)&&Number.isSafeInteger(latest?.closeTime)&&
    latest.closeTime-latest.time===meta?.timeframeMs&&sourceAt>=latest.time&&
    (!latest.closed||sourceAt>=latest.closeTime)&&sourceAt-latest.closeTime<=15000;
  const currentnessVerified=chart?.realtime===true||producerFresh;
  const selection=chart?.researchSelection,labels=chart?.chartLabels,researchMulti=allowResearchLiveMultiChart===true&&chart?.visibleCharts>=2&&chart.visibleCharts<=3&&Array.isArray(labels)&&labels.length===chart.visibleCharts&&labels.every(label=>typeof label==='string'&&/^Chart for CME_MINI:NQ1!, /.test(label))&&labels.filter(label=>label==='Chart for CME_MINI:NQ1!, 1 minute').length===1&&chart.interval==='1'&&meta?.timeframe==='1'&&selection?.kind==='UNIQUE_ACTIVE_RESEARCH_NQ_1M'&&selection.visibleCharts===chart.visibleCharts&&selection.targetCharts===1&&selection.interval==='1'&&selection.selectedChartLabel==='Chart for CME_MINI:NQ1!, 1 minute'&&selection.researchLayoutVerified===true&&selection.liveMultiChartExplicit===true&&selection.statusLegendScoped===true&&selection.sourceMode==='LIVE'&&chart.replay===false&&chart.symbols?.length===1&&chart.symbols[0]==='CME_MINI:NQ1!';
  if(!chart||chart.visibleCharts!==1&&!researchMulti||!Array.isArray(chart.symbols)||chart.symbols.length!==1)reasons.push('SINGLE_VISIBLE_CHART_REQUIRED');
  if(allowResearchLiveMultiChart===true){let sourceUrlVerified=false;try{const url=new URL(evidence?.sourceUrl),knownName=({'/chart/ARROWRV1/':'Arrow OHLC Live Verification','/chart/ARROWFR1/':'Full Screens Live'})[url.pathname],namedPair=!!knownName&&(url.pathname==='/chart/ARROWFR1/'?selection?.layoutName===knownName:selection?.layoutName===undefined||selection.layoutName===knownName);sourceUrlVerified=url.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/chart\/[A-Za-z0-9_-]+\/$/.test(url.pathname)&&(chart?.visibleCharts===1||namedPair);}catch{}if(!sourceUrlVerified)reasons.push('CHART_SOURCE_URL_UNVERIFIED');}
  if(!meta||chart?.symbols?.[0]?.trim().toUpperCase()!==meta.instrument?.trim().toUpperCase())reasons.push('CHART_SYMBOL_MISMATCH');
  if(typeof chart?.interval!=='string'||chart.interval.trim().toUpperCase()!==String(meta?.timeframe??'').trim().toUpperCase())reasons.push('CHART_TIMEFRAME_MISMATCH');
  if(chart?.replay!==false)reasons.push(chart?.replay===true?'REPLAY_SOURCE':'REPLAY_STATUS_UNVERIFIED');
  if(!currentnessVerified)reasons.push(chart?.realtime===false?'DELAYED_SOURCE':'LIVE_STATUS_UNVERIFIED');
  if(chart?.marketOpen===false)reasons.push('MARKET_CLOSED');
  const identityValid=!reasons.some(reason=>['SINGLE_VISIBLE_CHART_REQUIRED','CHART_SYMBOL_MISMATCH','CHART_TIMEFRAME_MISMATCH','CHART_SOURCE_URL_UNVERIFIED'].includes(reason));
  return {identityValid,liveVerified:reasons.length===0,reasonCodes:reasons,metadata:meta?{...meta,...(typeof evidence?.sourceUrl==='string'?{sourceUrl:evidence.sourceUrl}:{}),tabId,sourceId:packet.runId,provider,realtime:identityValid&&currentnessVerified&&chart?.marketOpen!==false,replay:chart?.replay===true?true:chart?.replay===false?false:undefined,
    realtimeVerification:{basis:producerFresh&&chart?.realtime!==true?'PINE_BAR_CURRENTNESS_WITH_VISIBLE_CHART':chart?.realtimeBasis??'UNVERIFIED',maxSourceCloseAgeMs:15000,exchangeEntitlementVerified:false,reference:chart?.realtimeReference??null,observedAtWall:evidence?.observedAtWall??null},chartIdentityVerified:identityValid}:null};
}

const reasonNames={
  USER_STOPPED:'המעקב נעצר',PROFILE_SAVED_REVIEW_REQUIRED:'הפרופיל נשמר; נדרשת בדיקה לפני התחלה',
  ACCOUNT_REVIEW_REQUIRED:'יש לבדוק את הגדרת החשבון לפני כל התחלה',ACCOUNT_SETUP_OPENED:'הגדרת החשבון פתוחה; המעקב נעצר',ACCOUNT_SETTINGS_CHANGED:'הגדרות החשבון השתנו; נדרשת התחלה חדשה',ACCOUNT_PROFILE_CHANGED:'פרופיל החשבון השתנה; נדרשת בדיקה חדשה',ACCOUNT_INSTRUMENT_MISMATCH:'הנכס בגרף אינו תואם לפרופיל החשבון',ACCOUNT_POINT_VALUE_MISMATCH:'ערך הנקודה בגרף אינו תואם לפרופיל החשבון',ACCOUNT_TICK_SIZE_MISMATCH:'גודל הטיק בגרף אינו תואם לפרופיל החשבון',ACCOUNT_CURRENCY_MISMATCH:'מטבע המקור אינו תואם לפרופיל החשבון',ACCOUNT_REVIEW_SOURCE_CHANGED:'לשונית הגרף השתנתה; נדרשת בדיקת חשבון חדשה',SOURCE_METADATA_REQUIRED:'ממתין לפרטי נכס כדי לבדוק התאמה לחשבון',EXPLICIT_COST_REVIEW_REQUIRED:'נדרשת בדיקה מפורשת של החשבון והעלויות להפעלה הזו',
  SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED:'חותמת המקור רחוקה מזמן הקליטה; נדרשת הודעה חדשה',
  PINE_LOGS_NOT_VISIBLE:'הודעות הגשר אינן נראות ב־Pine Logs',TRADINGVIEW_CHART_REQUIRED:'נדרש גרף TradingView',SINGLE_VISIBLE_CHART_REQUIRED:'זיהוי הגרף הפעיל והפריסה טרם אומת',CHART_SYMBOL_MISMATCH:'הנכס שבסקריפט אינו תואם לגרף הנראה',CHART_TIMEFRAME_MISMATCH:'הטיימפריים שבסקריפט אינו תואם לגרף הנראה',REPLAY_SOURCE:'Replay פעיל; אין התרעה חיה',REPLAY_STATUS_UNVERIFIED:'מצב Replay טרם אומת',DELAYED_SOURCE:'מקור הנתונים מושהה',LIVE_STATUS_UNVERIFIED:'נתוני זמן אמת טרם אומתו',MARKET_CLOSED:'השוק מסומן כסגור',HISTORY_WARMUP:'ממתין להיסטוריית חימום',FINAL_OHLC_NOT_VERIFIED:'טרם התקבל ערך סופי מאומת לנר קודם',FEED_STALE:'אין הודעת מקור חדשה; הנתונים התיישנו',RECONNECT_SNAPSHOT_REQUIRED:'נדרש בסיס חדש אחרי פער קליטה',SNAPSHOT_REQUIRED:'נדרשת הודעת בסיס חדשה מהסקריפט',CLOSED_BAR_CORRECTION:'נר סגור השתנה; נדרש בסיס חדש',UNDECLARED_DATA_GAP:'יש פער נתונים לא מוסבר',SOURCE_CHANGED:'מקור הנתונים השתנה; נדרש בסיס חדש',NEXT_BAR_NOT_CONTIGUOUS:'נחצה פער בין נרות ללא סגירה סופית',HISTORICAL_BOOTSTRAP_NO_ALERT:'היסטוריית החיבור משמשת חימום בלבד',LIVE_CLOSE_TOO_OLD:'הנר התקבל מאוחר מכדי להיות התרעה חיה',DOM_SCAN_LIMIT:'קריאת הדף הגיעה למגבלה',RULES_DIRTY:'ההגדרות השתנו; יש להחיל אותן לפני התרעות',NO_FRESH_SOURCE_PACKET:'ממתין להודעת מקור חדשה',STANDARD_CANDLES_REQUIRED:'נדרשים נרות רגילים',NONSTANDARD_CHART:'נרות לא רגילים אינם כשירים לאישור',RISK_PARAMETERS_REQUIRED:'חסרים פרמטרים לתוכנית סיכון',RISK_REJECTED:'תוכנית הסיכון נפסלה',RISK_BUDGET_BELOW_ONE_CONTRACT:'התקציב אינו מאפשר חוזה אחד',MISSING_STRUCTURE:'אין מבנה שוק מתאים',MISSING_KNOWN_LOCATION:'אין אזור מחיר ידוע מתאים',INSUFFICIENT_CONDITIONS:'חסרים תנאים לאישור',LATER_CLOSED_BAR_CONFIRMED:'נר סגור מאוחר אישר את המערך'};
const textReason=reason=>reason==='SOURCE_BAR_TOO_OLD'?'זמן הנר האחרון ישן מדי להתרעה חיה':reasonNames[reason]??String(reason);
Object.assign(reasonNames,{
  WINDOW_CLOCK_REBASELINE_REQUIRED:'בדיקת המקור חודשה; ממתין לשתי תצפיות טריות ולבסיס חי חדש',
  WINDOW_CLOCK_OBSERVER_DELAY:'התצפית התעכבה; בונה בסיס חדש לפני חידוש האיתותים',
  WINDOW_CLOCK_OBSERVER_GAP:'התצפיות הופסקו; ממתין לבדיקה חדשה ולבסיס חי חדש',
  WINDOW_CLOCK_POST_FAULT_REGRESSION:'זמן המקור נסוג במהלך ההתאוששות; איתותים חסומים ונדרשת התחלה חדשה',
  WINDOW_CLOCK_OWNER_MISMATCH:'זהות חיבור המקור השתנתה; נדרשת התחלה חדשה',WINDOW_CLOCK_RECEIVER_REGRESSION:'שעון הקליטה נסוג; נדרשת התחלה חדשה',WINDOW_CLOCK_OBSERVER_REGRESSION:'זמן תצפית המקור נסוג; נדרשת התחלה חדשה',WINDOW_CLOCK_PAIR_UNSTABLE:'זמני המקור אינם עקביים; נדרשת התחלה חדשה',WINDOW_CLOCK_SOURCE_NOT_ELIGIBLE:'בדיקת השעון ממתינה למקור חי תקין',WINDOW_CLOCK_ADVANCING_OBSERVATION_REQUIRED:'ממתין לתצפית מקור חדשה עם זמן מתקדם',WINDOW_CLOCK_OBSERVER_PAIR_REQUIRED:'ממתין לשתי תצפיות חדשות לבדיקת שעון המקור',WINDOW_CLOCK_BOUNDED_CORRELATION:'התאמה מוגבלת בין שעון המקור לשעון הקליטה נבדקה',WINDOW_CLOCK_OBSERVER_STALE:'נדרשת תצפית מקור חדשה לבדיקת השעון',WINDOW_CLOCK_FROZEN_OFFSET_CHANGED:'הפרש השעונים השתנה; נדרשת התחלה חדשה',WINDOW_CLOCK_OBSERVATION_DISCONTINUITY:'רצף זמני המקור השתנה; נדרשת התחלה חדשה',WINDOW_CLOCK_LEAD_OUT_OF_BOUNDS:'הפרש השעונים חורג מהגבול; איתותים חסומים',PRODUCER_CLOCK_STALE:'שעון המקור לא התקדם; הנתונים התיישנו',WINDOW_RECOVERY_CONTEXT_ONLY:'ההיסטוריה שוחזרה כהקשר בלבד; אין עדיין אישור מקור חי',WINDOW_RECOVERY_WAITING_FRESH_FRAMES:'ההיסטוריה שמורה; ממתין לשתי מסגרות מקור חדשות ועקביות',CONTEXT_BASELINE_REQUIRES_FRESH_SNAPSHOT:'ההיסטוריה מוכנה; בסיס הקליטה החי טרם חודש',INVALID_CONTEXT_BASELINE_SCOPE:'הודעת שחזור ההקשר אינה תקינה',
  WINDOW_HISTORY_WARMUP:'אוסף היסטוריה סגורה לפני אישור איתותים',WINDOW_COHERENCE_PRIMING:'בודק שתי מסגרות מקור עקביות',WINDOW_COHERENCE_REPRIMING:'רצף המקור השתנה; מתחיל חימום חדש',WINDOW_METADATA_FRAME_REQUIRED:'ממתין להגדרת המקור המוטמעת בחלון הנתונים',WINDOW_LAST_BAR_REQUIRED:'החזירו את הסמן מהנר ההיסטורי למחיר הנוכחי',WINDOW_FRAME_CHECKSUM_MISMATCH:'שדות המקור עדיין אינם שייכים לאותו עדכון',WINDOW_MIXED_FRAME:'ממתין לעדכון מלא ועקבי של שדות המקור',WINDOW_SOURCE_UNSUPPORTED:'מפרט המקור אינו מתאים למסלול הנתונים הזה',WINDOW_METADATA_TEXT_UNREPRESENTABLE:'פרטי המקור אינם ניתנים להעברה במסלול זה',WINDOW_STUDY_NOT_VISIBLE:'מציג את כותרת מקור Arrow בחלון הנתונים',WINDOW_STUDY_NOT_FOUND:'נדרש הסקריפט Arrow OHLC Window v2 בגרף',DATA_WINDOW_NOT_SELECTED:'חלון הנתונים של המקור אינו מוצג',DATA_WINDOW_PANEL_OPEN_REQUESTED:'פותח את חלון הנתונים',DATA_WINDOW_TAB_SELECT_REQUESTED:'בוחר את לשונית הנתונים',WINDOW_OWN_STUDY_SCROLL_REQUESTED:'מציג את נתוני Arrow',WINDOW_OWN_STUDY_EXPAND_REQUESTED:'מרחיב את נתוני Arrow',DATA_WINDOW_PANEL_MOUNTING:'ממתין לטעינת חלון הנתונים',WINDOW_FIELDS_NOT_MOUNTED:'ממתין להופעת כל שדות המקור',WINDOW_CLOSED_BAR_CORRECTION:'ערכי נר סגור השתנו; נדרש חימום חדש',WINDOW_HISTORY_ROW_UNAVAILABLE:'היסטוריית המקור אינה שלמה; מתחיל חימום חדש',SOURCE_LOG_BUDGET_EXHAUSTED:'מכסת הלוגים מוצתה; נדרשת הרצה חדשה של הגשר המוגבל',UNRELATED_DIALOG_OPEN:'סגרו את חלון ההגדרות הפתוח בגרף כדי להמשיך',
});
const unique=list=>[...new Set(list)];
const isTvUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='tradingview.com'||url.hostname.endsWith('.tradingview.com'))&&url.pathname.startsWith('/chart/');}catch{return false;}};
const isTvPineUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='tradingview.com'||url.hostname.endsWith('.tradingview.com'))&&url.pathname==='/pine/';}catch{return false;}};

if(typeof document!=='undefined')initializeLivePage();

function initializeLivePage(){
  const $=id=>document.getElementById(id),extension=typeof chrome!=='undefined'&&!!chrome.tabs?.query&&!!chrome.scripting?.executeScript;
  const userManagedMode=isUserManagedLiveMode(window.location?.search??'');
  const telegram=userManagedMode&&extension?createLiveTelegramControls({document,chrome}):null;
  const thresholdProfile=$('guide-threshold-profile');if(userManagedMode&&thresholdProfile){thresholdProfile.hidden=false;thresholdProfile.textContent=`ספים מקלים במידה: סובלנות אזור ${GUIDE_USER_CONTEXT_BALANCED.zoneToleranceTicks} טיקים, קרבה ל־EMA עד ${GUIDE_USER_CONTEXT_BALANCED.emaProximityTicks} טיקים, קצה טווח ${GUIDE_USER_CONTEXT_BALANCED.rangeEdgeFraction*100}%. הגדרות צורת הנר ותנאי האישור נשמרים; SL ו־TP בידיך.`;}
  const store=createLiveOhlcStore(),timeframes=createLiveTimeframes({timeframes:['5','15'],minBars:20}),intrabar=createLiveIntrabar(),analyzer=createGuideAnalyzer(),sourceLatency=createSourceDomLatency(),preopenContext=createPreopenContext({allowResearchLiveMultiChart:userManagedMode}),formingPreview=createGuideFormingPreview(),maxEvidence=500;
  let preparingContext=false,lastFormingPreview=null,lastFormingPreviewReceiptAt=null,bootstrapLogTabs=new Set(),preopenReadSource=null;
  let observerSession=null,windowClock=null,lastClockQuarantineId=null,lastExplanation=null,lastAnalysisInputs=null,activeTransport='window',windowPrepared=false,lastWindowEvidence=null,lastPointerRepairAt=-Infinity;
  const pointerRecovery=[];
  const warmupModel=createWarmupModel();let warmup=null,activeModelInput=null;
  let lastRenderSignature=null,lastIntrabarSignature=null,evidenceDirty=true,lastEvidenceAt=-Infinity,lastLatencyAt=-Infinity,liveOverlayVisible=false,overlaySerial=0,overlayLiveSession=null,overlayTestSession=null,probeBusy=false,sourceWakeCount=0,lastWakeAt=-Infinity;
  const alertDelivery=[],deliveryProbes=[],sessionHistory=[];
  let sessionStartedAtWall=null,sessionMetadata=null;
  const runtimeDiagnostics=createLiveRuntimeDiagnostics({document,window});
  const windowMode=()=>activeTransport==='window';
  const providerOptions=()=>({provider:windowMode()?'TradingView public Data Window v2':'TradingView Pine Logs',allowResearchLiveMultiChart:userManagedMode});
  let active=false,inflight=false,timer=null,selectedTabId=null,connectionSerial=0,pollSerial=0,selectedRun=null,lastSourceAt=-Infinity,settingsDirty=false,lastAnalysis=null,latestEvidence=null,lastState=store.snapshot(),appliedOptions=null,rulesReady=false,applyingRules=false,starting=false,accountEvaluation={ok:false,reasonCodes:['ACCOUNT_REVIEW_REQUIRED']};
  let paperControls=null,paperUserControls=null;
  const ruleControls=[...LIVE_RULE_FIELD_IDS,...LIVE_RULE_CHECK_IDS,'live-transport','apply-live-rules','connect-live','refresh-tabs','live-tab','bootstrap-log-tab','popout-live','prepare-window-history','account-profile','edit-account','new-account'];
  for(const id of ruleControls)$(id).disabled=true;
  const storageNote=document.createElement('p');storageNote.className='help';storageNote.textContent='טוען הגדרות מקומיות…';$('apply-live-rules').after(storageNote);
  let rawEvidence=[],pollEvidence=[],closeBoundarySamples=[],alerts=[],alertIds=new Set(),seenSequences=new Map(),latencyArchives=[],inflightToken=null,lastVisibleAlert=null;
  const accountDependencies={document,storage:extension?chrome.storage?.local:undefined,onInvalidate:reason=>{paperUserControls?.disarm(reason);accountEvaluation={ok:false,reasonCodes:[reason]};if(active)stop(reason);settingsDirty=true;renderState(store.snapshot());updateEvidence();},onProfileApplied:()=>{if(active)stop('ACCOUNT_PROFILE_CHANGED');settingsDirty=true;renderRiskNote();paperControls?.refresh();paperUserControls?.refresh();}};
  const accountControls=userManagedMode?createLiveUserAccountControls({...accountDependencies,readNativeAccount:async({tabId})=>{const before=await chrome.tabs.get(tabId);const rows=await chrome.scripting.executeScript({target:{tabId},func:readTradingViewExecutionAccount,args:[{tabId,url:before.url}],world:'ISOLATED'});const after=await chrome.tabs.get(tabId);if(before.url!==after.url||rows.length!==1)throw Error('ACCOUNT_SOURCE_TAB_CHANGED');return rows[0].result;}}):createLiveAccountControls(accountDependencies);
  paperControls=createLivePaperControls({document,chrome:extension?chrome:undefined,extension,getContext:()=>{
    const account=accountControls.snapshot();
    return {source:{active,mode:'LIVE',sessionId:observerSession,runId:selectedRun,sourceTabId:active?selectedTabId:Number($('live-tab').value)||null,generation:lastState.generation,settingsDirty,accountReviewId:account.review?.reviewId??null},state:decisionState(lastState),analysis:lastAnalysis,profile:account.draftProfile,account};
  }});
  const paperQuickStart=userManagedMode&&extension?createLiveNativeQuickStart({chrome,getSession:()=>{
    const account=accountControls.snapshot();
    return {profile:account.brokerProfile,active,sourceTabId:selectedTabId,preferredSourceTabId:Number($('live-tab').value)||null,reviewAccepted:account.reviewAccepted,settingsDirty,
      ready:lastState.ready,liveEligible:lastState.liveEligible,stale:lastState.stale,lastReceivedAt:lastState.lastReceivedAt,accountReady:accountEvaluation.ok,
      warmup:readNativeStartupWarmup(latestEvidence),
      progress:$('history-status').textContent+' · '+$('feed-status').textContent};
  },selectSource:async tabId=>{await refreshTabs();$('live-tab').value=String(tabId);$('live-transport').value='window';},connectSource:options=>connect(options)}):null;
  if(userManagedMode)paperUserControls=createLivePaperUserControls({document,chrome:extension?chrome:undefined,extension,prepareSession:paperQuickStart?.prepare,prepareBrokerSession:paperQuickStart?.prepare,onVerifiedFill:fill=>{telegram?.fill(fill);refreshCandleMarkers();captureResearchFill(fill);},onStart:()=>{warmupModel.clear();activeModelInput=null;history24?.start();warmup?.start();},nativeCommandForProfile:profile=>['TRADINGVIEW_PAPER','TRADOVATE'].includes(profile?.provider)?nativeUserMarketUiCommand:null,getContext:()=>{
    const account=accountControls.snapshot();
    return {source:{active,mode:'LIVE',sessionId:observerSession,runId:selectedRun,sourceTabId:active?selectedTabId:Number($('live-tab').value)||null,researchUrl:account.review?.sourceUrl??null,generation:lastState.generation,settingsDirty,accountReviewId:account.review?.reviewId??null},state:decisionState(lastState),analysis:lastAnalysis,profile:account.draftProfile,account,latestEvidence};
  }});
  const candleMarkers=userManagedMode&&extension?createLiveCandleMarkers({entryDisplay:true,interactiveFillList:true,
    execute:async(func,command)=>(await chrome.scripting.executeScript({target:{tabId:selectedTabId},func,args:[command],world:'ISOLATED'}))[0]?.result,
    getContext:()=>({active,ready:lastState.ready,liveEligible:lastState.liveEligible,closedAsOfTime:lastState.bars?.at(-1)?.closeTime,tabId:selectedTabId,sourceUrl:lastState.metadata?.sourceUrl,sourceMode:'LIVE',runEpoch:latestEvidence?.windowFrame?.runEpoch,accountIdentity:accountControls.snapshot().brokerProfile}),
    runUi:task=>paperUserControls?.runPresentation?paperUserControls.runPresentation(task):task(),storage:chrome.storage?.local,
    onChange:state=>{const node=$('candle-markers-status');if(node)node.textContent=state.status==='VERIFIED'?`סימונים אומתו: ${state.payload.entryArrowCount??0} חצי מילוי מאומתים · ${state.payload.researchCircleCount??0} עיגולי מחקר. תכלת לונג · כתום שורט. חצים גדולים מסמנים מילוי בפועל; המחיר והשעה מוצגים בטבלת המילויים בפינה העליונה.`:state.status==='BLOCKED'?'סימון הנרות טרם אומת: '+state.reasonCodes.join(' · '):'ממתין לסנכרון סימוני הנרות; הביצוע מקבל קדימות.';},
  }):null;
  const history24View=createHistory24View(document);
  const history24Context=()=>{
    const frame=latestEvidence?.windowFrame,previous=frame?.checksumsVerified===true&&frame.coherent===true&&frame.previous?.sourceClosed===true?frame.previous:null;
    const metadata=lastState.metadata??latestEvidence?.bootstrapMetadata?.metadata;
    return {active,metadata,bars:lastState.bars?.length?lastState.bars:previous?[{...previous,closed:true,finalOhlcVerified:true}]:[],generation:lastState.generation,runId:selectedRun??('archive-observation:'+frame?.runEpoch),sourceUrl:metadata?.sourceUrl??latestEvidence?.sourceUrl,higherTimeframes:timeframes.snapshot({asOfTime:lastState.decisionAsOfTime??undefined}).higherTimeframes};
  };
  const history24=userManagedMode&&extension?createHistory24Controller({getContext:history24Context,
    execute:async(func,command)=>(await chrome.scripting.executeScript({target:{tabId:selectedTabId},func,args:[command],world:'ISOLATED'}))[0]?.result,
    storage:chrome.storage?.local,onChange:state=>history24View.render(state),onResult:result=>{void candleMarkers?.acceptHistorical(result);},
  }):null;
  if(userManagedMode&&extension)warmup=createHistoryWarmupController({getContext:history24Context,historyCache:history24,storage:chrome.storage?.local,
    execute:async(func,command)=>(await chrome.scripting.executeScript({target:{tabId:selectedTabId},func,args:[command],world:'ISOLATED'}))[0]?.result,
    requestRepair:repair=>{
      const frame=latestEvidence?.windowFrame;
      if(!active||!Number.isSafeInteger(frame?.runEpoch)||frame.current?.closeTime-frame.sourceEmittedAt<4000)return Promise.resolve({status:'PRESENTATION_DEFERRED'});
      return paperUserControls.runPresentation(async()=>(await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:nativeCandleMarkerUiCommand,world:'ISOLATED',args:[{action:'repair_archive',repair,expected:{researchUrl:lastState.metadata?.sourceUrl??latestEvidence?.sourceUrl,instrument:'CME_MINI:NQ1!',timeframe:'1',sourceMode:'LIVE',runEpoch:frame.runEpoch,allowResearchLiveMultiChart:true,backgroundSync:true}}]}))[0]?.result);
    },
    onReady:value=>warmupModel.offer(value),onChange:value=>{
      const node=$('warmup3000-status'),progress=$('warmup3000-progress'),note=$('warmup3000-detail');if(!node)return;
      const labels={NOT_STARTED:'חימום 3,000 נרות דקה יתחיל בהפעלת הבוט.',WAITING_SOURCE:'ממתין למקור חי; חימום 3,000 הנרות אינו חוסם כניסות חיות.',COLLECTING:'אוסף 3,000 נרות דקה סגורים ומאומתים.',PROCESSING:'מעבד את ההיסטוריה לפי סדר הזמנים בתהליך רקע.',WAITING_SAFE_ACTIVATION:'כל 3,000 הנרות עובדו; ממתין להפעלת ההקשר בלי לקטוע מערך חי ממתין.',ACTIVE:'הקשר של 3,000 נרות דקה פעיל במנוע.',BLOCKED:'חימום 3,000 הנרות טרם הושלם; יש לבדוק את הסיבה.'};
      node.textContent=labels[value.status]??value.status;if(progress)progress.textContent=`נאספו ${value.receivedBars??0}/3,000 · עובדו לפי הסדר ${value.processedBars??0}/3,000`;
      if(note)note.textContent=(value.result?.signals?`נמצאו ${value.result.signals.length} אישורים היסטוריים מחושבים. `:'')+'איתותי עבר נשמרים למחקר. כניסה במהלך החימום מותרת רק מאישור חי חדש לפי תנאי האסטרטגיה; SL ו־TP בידיך.';
    },
  });
  const resultNode=$('live-output');
  const formingView=createGuideFormingView($('forming-conditions'));
  const closestView=createClosestGuideStrategyView($('closest-strategy'));
  const closestJournal=createClosestStrategyJournalView($('closest-strategy-journal'));
  const research=createLiveResearchUpgrades({document,storage:extension?chrome.storage?.local:undefined});
  let researchTimer=null;
  function scheduleResearch(state,analysis){
    // Dispatch/approval runs in the current task. Diagnostics start later and
    // all detectors execute in a separate worker, never as a new entry gate.
    if(!research.available())return;
    clearTimeout(researchTimer);researchTimer=setTimeout(()=>{
      research.observe({bars:state.bars,metadata:state.metadata,asOfTime:analysis.asOfTime});
    },0);
  }
  function captureResearchFill(fill){
    const item=[...alerts].reverse().find(a=>a.runId===selectedRun&&a.signal?.instrument===lastState.metadata?.instrument&&a.signal?.timeframe===lastState.metadata?.timeframe&&a.signal?.confirmationBarCloseTime===fill.latestClosedAt&&a.signal.direction===fill.direction);
    if(!item)return;
    const selected=decisionState(lastState);
    research.capture({fill,signal:item.signal,bars:selected.bars,metadata:selected.metadata});
    if(lastAnalysis)scheduleResearch(selected,lastAnalysis);
  }
  const previewViews={clear(message){formingView.clear(message);closestView.clear(message);},render(preview,options){formingView.render(preview,options);return closestView.render(preview,{...options,analysis:lastAnalysis});}};
  const wakeAvailable=extension&&typeof chrome.runtime?.id==='string'&&typeof chrome.runtime?.onMessage?.addListener==='function';
  let pollScheduler=wakeAvailable?createLiveWindowPollScheduler({run:attempt=>poll(attempt)}):null;
  const onscreen=()=>{const r=resultNode.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=window.innerHeight&&r.right<=window.innerWidth;};
  const latency=createLiveSignalLatency({requestAnimationFrame:callback=>window.requestAnimationFrame(callback),cancelAnimationFrame:handle=>window.cancelAnimationFrame(handle),isVisible:()=>document.visibilityState==='visible'&&!document.hidden,
    isOnscreen:onscreen,onSample:sample=>{const source=sourceLatency.complete(sample);for(const item of alertDelivery)if(item.readEventId===sample.eventId){item.panelRendering=structuredClone(sample);if(source&&source.packetId===item.sourcePacketId)item.sourceObservation=structuredClone(source);completeAlertDelivery(item);}if(performance.now()-lastLatencyAt>=250){lastLatencyAt=performance.now();renderLatency();}}});
  const numberFormatter=new Intl.NumberFormat('he-IL',{maximumFractionDigits:8}),msFormatter=new Intl.NumberFormat('he-IL',{maximumFractionDigits:1});
  const num=value=>Number.isFinite(value)?numberFormatter.format(value):'—';
  const ms=value=>Number.isFinite(value)?msFormatter.format(value):'—';
  const stamp=value=>Number.isFinite(value)?new Date(value).toISOString():'—';
  function status(text,state=''){if($('feed-status').textContent!==text)$('feed-status').textContent=text;if($('feed-status').dataset.state!==state)$('feed-status').dataset.state=state;}
  function boundedPush(list,item,max=maxEvidence){list.push(item);if(list.length>max)list.splice(0,list.length-max);}
  function field(id){const value=$(id).value.trim();if(!value)return undefined;const n=Number(value);if(!Number.isFinite(n))throw Error('ערך מספרי לא תקין: '+id);return n;}
  function readOptions(){
    if(userManagedMode)return userManagedLiveAnalysisOptions();
    readStoredSettings();
    const risk={riskBudget:field('risk-budget'),pointValue:field('point-value'),commissionPerContract:field('commission'),slippageTicks:field('slippage'),maxContracts:field('max-contracts'),rewardRisk:field('reward-risk')};
    return {risk:Object.entries(risk).some(([key,value])=>key!=='rewardRisk'&&value!==undefined)?risk:null,config:{...GUIDE_SIGNAL_DEFAULTS,requireRisk:true,requireLocation:$('require-location').checked,requireEma:$('require-ema').checked,requireFib:$('require-fib').checked,requireHigherTimeframe:$('require-higher-timeframe').checked,requireTrendline:$('require-trendline').checked,requireSupplyDemand:$('require-supply-demand').checked},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,supplyDemandEnabled:$('enable-supply-demand').checked||$('require-supply-demand').checked}};
  }
  function readStoredSettings(){if(userManagedMode)return null;try{return makeLiveRuleSettings(Object.fromEntries(LIVE_RULE_FIELD_IDS.map(id=>[id,$(id).value.trim()])),Object.fromEntries(LIVE_RULE_CHECK_IDS.map(id=>[id,$(id).checked])));}catch{throw Error('פרמטרי הסיכון אינם תקינים: נדרשים מספרים בגבולות המותרים, עלויות ותקציב לא שליליים, ערך נקודה ויחס יעד חיוביים ומספר חוזים שלם וחיובי.');}}
  async function initializeSettings(){
    const loaded=await loadLiveRuleSettings(extension?chrome.storage?.local:undefined);
    if(loaded.settings){for(const id of LIVE_RULE_FIELD_IDS)$(id).value=loaded.settings.fields[id];for(const id of LIVE_RULE_CHECK_IDS)if(Object.hasOwn(loaded.settings.checks,id))$(id).checked=loaded.settings.checks[id];}
    $('require-risk').checked=true;if(!$('live-transport').value)$('live-transport').value='window';$('legacy-follow-setting').hidden=$('live-transport').value!=='logs';await accountControls.initialize();
    appliedOptions=readOptions();rulesReady=true;
    for(const id of [...LIVE_RULE_FIELD_IDS,...LIVE_RULE_CHECK_IDS.filter(id=>id!=='require-risk'),'live-transport','apply-live-rules','refresh-tabs','live-tab','account-profile','edit-account','new-account'])$(id).disabled=false;
    $('require-risk').disabled=true;
    $('popout-live').disabled=!extension||!chrome.windows?.create;
    storageNote.textContent=loaded.status==='RESTORED'?'ההגדרות השמורות נטענו מקומית. החיבור למקור נשאר כבוי עד להפעלה מפורשת.':loaded.status==='INVALID'?'ההגדרות השמורות לא היו תקינות ולא הוחלו. הזינו והחילו הגדרות תקינות.':loaded.status==='UNAVAILABLE'?'שמירת הגדרות מקומית אינה זמינה כרגע. אפשר להפעיל את המסך עם הגדרות בזיכרון בלבד.':'טרם נשמרו הגדרות. לחיצה על החלת הגדרות תשמור את הערכים שהזנתם מקומית.';
    $('prepare-window-history').disabled=!extension;$('bootstrap-log-tab').disabled=!extension;renderRiskNote();renderPreopenContext();await refreshTabs();
    if(userManagedMode){document.body.dataset.executionMode='USER_MANAGED_ANALYSIS';$('paper-execution-panel').hidden=true;if($('paper-user-panel'))$('paper-user-panel').hidden=false;if($('paper-user-power-bar'))$('paper-user-power-bar').hidden=false;for(const id of [...LIVE_RULE_FIELD_IDS,...LIVE_RULE_CHECK_IDS]){$(id).disabled=true;const label=$(id).closest?.('label');if(label)label.hidden=true;}$('account-dialog').hidden=true;$('connect-live').textContent='אימות החשבון והתחלת ניתוח חי';$('user-managed-live-note')?.removeAttribute('hidden');if($('live-mode-intro'))$('live-mode-intro').textContent='ניתוח נרות לפי תנאי החובה של כל אסטרטגיה, עם תצוגת התנאים המתהווים בתוך הנר. ניהול הסיכון והכמות בידיך. נתמכים עד שלושה גרפי NQ בפריסת FULL SCREENS שלך או בחלון המחקר, כאשר גרף הדקה היחיד הוא הפעיל. אישור טכני אינו הוכחת שיגור פקודה.';storageNote.textContent='כל אסטרטגיה נבדקת לפי תנאי החובה שלה. מסנני ההקשר מחושבים; תוכנית סיכון של הבוט אינה נדרשת.';paperUserControls?.refresh();}
  }
  function renderPreopenContext(){
    const context=preopenContext.snapshot(),ready=context.status==='CONTEXT_READY',counts=context.series.map(series=>`${series.timeframe} דקות · ${series.bars} נרות סגורים`).join(' | ');
    const text=ready?'CONTEXT_READY · היסטוריית המקור מוכנה: '+counts+'. הקשר בלבד; אישור חי דורש שתי מסגרות חדשות ומערך חדש לאחר בסיס החיבור.':context.status==='CONTEXT_INCOMPLETE'?'CONTEXT_INCOMPLETE · היסטוריה שנקלטה בהכנה: '+counts+'. נדרשים לפחות 20 נרות בכל סדרה. אפשר להתחיל מעקב; סדרה חסרה נשארת בחימום וחוסמת אישור.':context.reason==='NOT_PREPARED'?'אפשר להכין מראש את היסטוריית המסחר הקודם דרך שלוש הודעות האתחול ב־Pine Logs.':'ההיסטוריה המוקדמת אינה מוכנה: '+context.reason;
    if($('preopen-history-status').textContent!==text)$('preopen-history-status').textContent=text;
    const state=ready?'ok':'';if($('preopen-history-status').dataset.state!==state)$('preopen-history-status').dataset.state=state;
  }
  async function prepareWindowHistory(){
    if(preparingContext||starting||!extension||!windowMode())return;
    const tabId=Number($('live-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)return;
    const logSelection=$('bootstrap-log-tab').value,logTabId=logSelection?Number(logSelection):tabId,paired=logTabId!==tabId;
    if(!Number.isSafeInteger(logTabId)||logTabId<1||paired&&!bootstrapLogTabs.has(logTabId)){status('בחרו עורך Pine מקושר מרשימת לשוניות ההכנה ורעננו אם חסר.','error');return;}
    if(active)stop('HISTORY_PREPARATION_REQUESTED');
    preparingContext=true;preopenReadSource=null;$('prepare-window-history').disabled=true;preopenContext.clear('READING_BOOTSTRAP');renderPreopenContext();
    const messages=new Set();
    try{
      for(let pass=0;pass<3;pass++){
        const result=await chrome.scripting.executeScript({target:{tabId:logTabId},func:readPineLogsEvidence,args:[{followLatest:true,...(paired?{bootstrapOnly:true}:{}),...(userManagedMode?{allowResearchLiveMultiChart:true}:{})}],world:'ISOLATED'});
        let evidence=result[0]?.result;
        if(Number($('live-tab').value)!==tabId)throw Error('SOURCE_TAB_CHANGED_DURING_BOOTSTRAP');
        if($('bootstrap-log-tab').value!==logSelection)throw Error('BOOTSTRAP_LOG_TAB_CHANGED_DURING_READ');
        if(paired){
          if(evidence?.status!=='OK'||evidence?.editorLinked!==true||evidence?.bootstrapLogsOnly!==true)throw Error('BOOTSTRAP_EDITOR_NOT_LINKED');
          const chartResult=await chrome.scripting.executeScript({target:{tabId},func:readPineLogsEvidence,args:[{followLatest:false,...(userManagedMode?{allowResearchLiveMultiChart:true}:{})}],world:'ISOLATED'});
          if(Number($('live-tab').value)!==tabId||$('bootstrap-log-tab').value!==logSelection)throw Error('BOOTSTRAP_SOURCE_CHANGED_DURING_READ');
          evidence={...evidence,chart:chartResult[0]?.result?.chart??null};
        }
        for(const raw of evidence?.messages??[])if(typeof raw==='string'&&raw.length<=40980&&messages.size<256)messages.add(raw);
        const captured=preopenContext.capture([...messages],{sourceTabId:tabId,chart:evidence?.chart,...(userManagedMode?{sourceUrl:(await chrome.tabs.get(tabId)).url}:{}),receivedAt:Date.now()});renderPreopenContext();
        if(captured.ok){preopenReadSource={chartTabId:tabId,logTabId,detachedEditor:paired,editorLinked:paired?true:null,observedAt:Date.now(),contextOnly:true};status(captured.status==='CONTEXT_READY'?'היסטוריית המסחר הקודם מוכנה. השאירו את לוגי העורך הנפרד פתוחים והתחילו מעקב לאחר בדיקת החשבון; ההיסטוריה אינה איתות חי.':'נקלטה היסטוריה תקינה אך חלקית. אפשר להתחיל מעקב ולשמור את הנתונים הזמינים; אישור נשאר חסום עד להשלמת כל סדרה נדרשת.');break;}
        if(captured.reason!=='WINDOW_BOOTSTRAP_BURST_INCOMPLETE')break;
        if(pass<2)await new Promise(resolve=>window.requestAnimationFrame(resolve));
      }
      if(!['CONTEXT_READY','CONTEXT_INCOMPLETE'].includes(preopenContext.snapshot().status))status('נדרשות שלוש הודעות האתחול של מקור המחקר ב־Pine Logs. הרחיבו את אזור הלוגים וגללו לאמצע ההודעות, ואז נסו טעינת היסטוריה שוב. אם שלוש ההודעות עדיין חסרות, עדכנו את מקור המחקר.','error');
    }catch(error){preopenContext.clear(String(error?.message??error).slice(0,100));status('טעינת ההיסטוריה לא הושלמה. אין אישור חי מהנתונים האלה.','error');}
    finally{preparingContext=false;$('prepare-window-history').disabled=!rulesReady||!extension;renderPreopenContext();$('export-live').disabled=false;updateEvidence();}
  }
  function renderRiskNote(){
    if(userManagedMode){$('risk-note').textContent='ניהול הסיכון והכמות בידיך. ניתוח הכיוון משתמש בתנאי החובה של כל אסטרטגיה ואינו מחשב סטופ, יעד או מגבלת 200 דולר.';return;}
    const gross=$('require-risk').checked&&$('commission').value.trim()!==''&&$('slippage').value.trim()!==''&&Number($('commission').value)===0&&Number($('slippage').value)===0;
    $('risk-note').textContent=gross?'חישוב ברוטו: תקציב הסיכון מחושב לפני עמלות והחלקה. אפס עלויות הוא הנחת החישוב, ואינו קביעה שאלו עלויות הברוקר בפועל.':$('require-risk').checked?'איתות מאושר דורש תקציב, ערך נקודה ועלויות מפורשים. שדות ריקים חוסמים אישור סיכון.':'מצב מחקר: תוכנית סיכון אינה תנאי לאיתות. התוצאה אינה קביעה שהעסקה מתאימה לתקציב.';
  }
  function updateEvidence(force=true){
    const at=performance.now();if(!force&&!evidenceDirty&&at-lastEvidenceAt<1000)return;lastEvidenceAt=at;evidenceDirty=false;
    $('live-evidence').textContent=JSON.stringify({active,selectedTabId,selectedRun,pollIntervalMs:LIVE_POLL_INTERVAL_MS,sourceTransport:activeTransport,window:windowMode()?{status:lastWindowEvidence?.status,reasonCodes:lastWindowEvidence?.reasonCodes,history:lastWindowEvidence?.history,frameSequence:lastWindowEvidence?.windowFrame?.sequence}:null,settingsDirty,account:accountControls.snapshot(),accountReasonCodes:accountEvaluation.reasonCodes,store:{status:lastState.status,ready:lastState.ready,liveEligible:lastState.liveEligible,reasonCodes:lastState.reasonCodes,metadata:lastState.metadata,closedBars:lastState.bars?.length,generation:lastState.generation,lastReceivedAt:lastState.lastReceivedAt},chart:latestEvidence?.chart,timeframes:timeframes.summary({asOfTime:lastState.decisionAsOfTime??undefined}),analysis:lastAnalysis?{status:lastAnalysis.status,stats:lastAnalysis.stats,reasonCodes:lastAnalysis.reasonCodes,latest:lastAnalysis.latest}:null,lastRead:pollEvidence.at(-1)},null,2);
  }
  function renderState(state,proofReasons=[]){
    lastState=state;const latest=state.current??state.bars?.at(-1),meta=state.metadata;
    paperUserControls?.refresh();
    paperControls?.refresh();
    $('export-live-focus').disabled=!observerSession;
    const previewEligible=active&&state.liveEligible&&!state.stale&&!state.requiresSnapshot&&state.current&&!state.current.closed&&accountEvaluation.ok&&!settingsDirty;
    if(!previewEligible){lastFormingPreview=null;lastFormingPreviewReceiptAt=null;previewViews.clear('ממתין למקור חי תקין; תנאים קודמים אינם אישור.');$('forming-preview-status').textContent='תנאי הנר המתהווה ממתינים למקור חי תקין ולהקשר סגור.';}
    else if(previewViews.render(lastFormingPreview,{sourceId:meta?.sourceId,sourceObservedAt:lastFormingPreviewReceiptAt,barTime:state.current?.time,now:Date.now(),eligible:true}).status==='STALE')closestJournal.suspend(Date.now(),'עדכון מקור טרי לא התקבל בזמן');
    if(!active||state.stale||state.requiresSnapshot||settingsDirty||!accountEvaluation.ok){
      closestJournal.suspend(Date.now(),!active?'המעקב הופסק':'המעקב ממתין למקור ולהקשר תקינים');
    }
    if(meta)sessionMetadata=structuredClone(meta);
    const signature=JSON.stringify([state.status,state.ready,state.liveEligible,state.stale,state.requiresSnapshot,state.generation,state.reasonCodes,proofReasons,latest?.receivedAt,latest?.time,latest?.close,state.bars?.length,meta?.sourceId,settingsDirty,accountEvaluation.ok,accountEvaluation.reasonCodes]);
    if(signature===lastRenderSignature)return;lastRenderSignature=signature;evidenceDirty=true;
    if($('test-signal-delivery'))$('test-signal-delivery').disabled=probeBusy||!extension||!active||!state.ready||!accountEvaluation.ok;
    if(state.stale||state.requiresSnapshot||settingsDirty||!accountEvaluation.ok||proofReasons.some(reason=>['CHART_SYMBOL_MISMATCH','CHART_TIMEFRAME_MISMATCH','REPLAY_SOURCE','MARKET_CLOSED'].includes(reason)))clearChartOverlay('LIVE');
    for(const [key,id] of Object.entries({open:'live-open',high:'live-high',low:'live-low',close:'live-close'}))$(id).textContent=num(latest?.[key]);
    $('live-volume').textContent=`נפח נצפה: ${num(latest?.volume)}${Number.isFinite(latest?.volume)?windowMode()?' · עד 6 ספרות עשרוניות':' · נתון מקור':' · חסר במקור; אינו נחשב אפס'}.`;
    renderIntrabar();
    $('live-bar-time').textContent=latest?`${latest.closed?'נר סגור מאומת':'נר פתוח'} · פתיחה ${stamp(latest.time)} · סיום מתוכנן ${stamp(latest.closeTime)} · נקלט כאן ${stamp(latest.receivedAt)}.`:'אין נר שהתקבל מהמקור.';
    $('source-identity').textContent=meta?`${meta.instrument} · ${meta.timeframe} · ${meta.provider}`:'—';
    $('source-contract').textContent=meta?`נתוני המקור: טיק ${num(meta.tickSize)} · ערך נקודה ${num(meta.pointValue)} · מטבע ${meta.currency??'לא דווח'} · אזור זמן ${meta.timezone} · Session ${meta.session}. ערכים אלה אינם תקציב חשבון.`:'מפרט הנכס יופיע לאחר קליטה.';
    const tf=timeframes.summary({asOfTime:state.decisionAsOfTime??undefined});
    $('timeframes-status').textContent='טיימפריימים גבוהים: '+(tf.series??[]).map(item=>`${item.timeframe} דקות · ${item.bars?.length??item.closedBars??0} נרות · ${item.ready?'זמין':'בחימום / חסר'}`).join(' | ')+(tf.reasonCodes?.length?' · '+tf.reasonCodes.join(' · '):'');
    $('history-status').textContent=`היסטוריית חימום: ${state.bars?.length??0} נרות סגורים · מצב ${state.status} · בסיס החיבור ${stamp(state.bootstrapAt)}.`;
    if(state.sourceDecisionTime!==null&&state.sourceDecisionTime!==undefined)$('history-status').textContent+=` סדר הנרות נבדק בשעון Pine; ההפרש הנצפה מול שעון הקליטה ${num(state.sourceDecisionTime-state.lastReceivedAt)} ms אינו מדידת השהיה.`;
    const reasons=unique([...proofReasons,...state.reasonCodes,...state.liveReasonCodes,...(!accountEvaluation.ok?accountEvaluation.reasonCodes:[]),...(settingsDirty?['RULES_DIRTY']:[])]).filter(reason=>reason!=='HISTORICAL_BOOTSTRAP_NO_ALERT');
    $('source-proof').textContent=reasons.length?reasons.map(textReason).join(' · '):'הנכס והטיימפריים תואמים, Replay כבוי ורעננות הנר נבדקה מול המקור. אין אימות עצמאי של מנוי הבורסה.';
    if(!state.liveEligible||settingsDirty||!accountEvaluation.ok){$('signal-state').textContent=active?'קריאת נתונים פעילה; התרעה חיה חסומה.':'המעקב כבוי; נדרשת הגדרת חשבון לפני התחלה.';$('signal-state').removeAttribute('data-direction');$('signal-detail').textContent=reasons.map(textReason).join(' · ')||'ממתין לאימות המקור.';}
    else if(!lastVisibleAlert){$('signal-state').textContent='המקור אומת; ממתין למערך חדש ולאישור בנר סגור.';$('signal-state').removeAttribute('data-direction');$('signal-detail').textContent='נבדקים רק מערכים חדשים שנוצרו לאחר החיבור. התנאים והמידע החסר מפורטים בניתוח התרחישים.';}
  }
  function renderLatency(){
    if($('wake-status'))$('wake-status').textContent=pollScheduler&&windowMode()?`קריאה מונעת עדכון: ${sourceWakeCount} הודעות מקור התקבלו · ${performance.now()-lastWakeAt<=10000?'מסלול מיידי עם בדיקת גיבוי':'בדיקת גיבוי עד לחיווי המקור הבא'}.`:'קריאה מחזורית; חיווי מקור מיידי אינו זמין במסלול הזה.';
    const report=latency.snapshot(),lower=report.metrics.receiptToPaintOpportunityLowerMs,upper=report.metrics.receiptToPaintOpportunityUpperMs;
    $('timing-status').textContent=upper.count?`תחילת קריאת הדף → הזדמנויות ציור: חציון ${ms(lower.p50Ms)}–${ms(upper.p50Ms)} ms · אחוזון 95 עד ${ms(upper.p95Ms)} ms · ${upper.count} דגימות. עיבוד: חציון ${ms(report.metrics.analysisMs.p50Ms)} ms.`:'זמן קריאת הדף עד הזדמנות הציור טרם נמדד. יש להשאיר את התוצאה נראית.';
    if(closeBoundarySamples.length){const sorted=closeBoundarySamples.map(item=>item.sourceBoundaryToConfirmationMs).filter(Number.isFinite).sort((a,b)=>a-b);if(sorted.length)$('timing-status').textContent+=` מסיום הנר עד הודעת האישור ב־Pine: חציון ${ms(sorted[Math.floor(sorted.length/2)])} ms (${sorted.length} נרות, בשעון המקור בלבד).`;}
    const source=sourceLatency.snapshot(),lo=source.metrics.sourceToPaintLowerMs,hi=source.metrics.sourceToPaintUpperMs;
    const sourceLabel=windowMode()?'תצפית ראשונה במסגרת מקור עקבית':'הופעת הודעה בגרף';
    $('source-timing-status').textContent=hi.count?`${sourceLabel} → הזדמנויות ציור התוצאה: חציון ${ms(lo.p50Ms)}–${ms(hi.p50Ms)} ms · אחוזון 95 עד ${ms(hi.p95Ms)} ms · ${hi.count} דגימות תואמות.`:`${sourceLabel} → תוצאה: ממתין לעדכון חדש שנצפה כשהמקור והתוצאה נראים. ערכים שכבר היו קיימים בחיבור אינם מדידה.`;
  }
  function renderIntrabar(){
    const t=intrabar.snapshot(),p=t.latest;
    const signature=[t.runId,t.barTime,p?.sequence,t.retainedPoints,t.missingSequences].join('|');if(signature===lastIntrabarSignature)return;lastIntrabarSignature=signature;
    $('intrabar-status').textContent=p?`בתוך הנר: ${t.totalUpdates} עדכונים נצפו · שינוי אחרון ${num(p.delta)} · מהירות נצפית ${num(p.observedSpeedPerSecond)} יחידות/שנייה · ${t.reversals} שינויי כיוון שמורים · ${t.missingSequences} הודעות חסרות ברצף החיבור. אין כאן היסטוריית כל טיק.`:'תנועות בתוך הנר: ממתין לעדכוני מחיר פתוח.';
    const svg=$('intrabar-trace');svg.replaceChildren();if(t.points.length<2)return;
    const prices=t.points.map(x=>x.close),min=Math.min(...prices),max=Math.max(...prices),span=max-min||1;
    const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',prices.map((c,i)=>`${8+i*584/(prices.length-1)},${68-(c-min)*60/span}`).join(' '));svg.append(line);
  }
  function renderAnalysis(){
    $('analysis-headline').textContent=lastExplanation?.headline??'הניתוח יופיע לאחר היסטוריה תקינה וסגירת נר מאומתת.';
    renderGuideAnalysis($('analysis-explanation'),lastExplanation);
  }
  function renderFormingPreview(state){
    state=decisionState(state);
    if(!active||!state.current||state.current.closed||!state.ready||!state.liveEligible||state.stale||state.requiresSnapshot||!lastAnalysis||settingsDirty||!accountEvaluation.ok){lastFormingPreview=null;lastFormingPreviewReceiptAt=null;previewViews.clear('ממתין לנר פתוח ולמקור חי תקין.');$('forming-preview-status').textContent='תצוגת התבנית המתהווה תופיע עם הקשר סגור ונתוני נר פתוח תקינים.';return;}
    lastFormingPreview=formingPreview.analyze(state.current,{closedBars:state.bars,closedAnalysis:lastAnalysis,metadata:state.metadata,...appliedOptions,...(state.bars.length===3000?{config:{...appliedOptions.config,maxBars:3000}}:{}),higherTimeframes:activeModelInput?.higherTimeframes??timeframes.snapshot({asOfTime:state.decisionAsOfTime??undefined}).higherTimeframes,asOfTime:state.decisionAsOfTime??undefined});
    const labels=(lastFormingPreview.matchedPatternIds??[]).map(id=>GUIDE_PATTERN_LABELS[id]??id);
    $('forming-preview-status').textContent='נר מתהווה · מועמד בלבד: '+(labels.length?labels.join(' · '):'טרם זוהתה צורה מתאימה')+'. '+(lastFormingPreview.scenarios?.length?`${lastFormingPreview.scenarios.length} תרחישים נבחנים לפי ההקשר. `:'')+'אין אישור חי לפני סגירת הנר ואישור מאוחר.';
    lastFormingPreviewReceiptAt=state.current.receivedAt??state.lastReceivedAt;
    const now=Date.now(),model=previewViews.render(lastFormingPreview,{sourceId:state.metadata?.sourceId,sourceObservedAt:lastFormingPreviewReceiptAt,barTime:state.current.time,now,eligible:true});
    closestJournal.observe({scope:{sessionId:observerSession,...lastFormingPreview.sourceIdentity},at:now,model,preview:lastFormingPreview,analysis:lastAnalysis});
  }
  function tracePacket(packet){
    if(windowMode()){
      if(packet.kind!=='update'||!Number.isSafeInteger(packet.sequence)||packet.sequence%8!==4)return;
      intrabar.ingest({...packet,sequence:Math.floor(packet.sequence/8)});
    }else intrabar.ingest(packet);
  }
  function analyzeClosedState(state){
    const higher=timeframes.snapshot({asOfTime:state.decisionAsOfTime??undefined}).higherTimeframes,execution=paperUserControls?.snapshot();
    const oldDecision=lastAnalysis&&lastAnalysisInputs?selectGuideTechnicalDecision({analysis:lastAnalysis,bars:lastAnalysisInputs.bars,asOfTime:lastAnalysis.asOfTime}):null;
    const canActivate=!execution?.busy&&!execution?.lifecycle?.ownedAttempt&&!lastAnalysis?.events?.some(e=>e.status==='ARMED')&&oldDecision?.status!=='CONFIRMED';
    const model=userManagedMode?warmupModel.prepare({state,higherTimeframes:higher,canActivate}):null;
    if(!model&&warmup?.snapshot().status==='ACTIVE'&&warmupModel.snapshot().status!=='ACTIVE'){warmup.deactivated(warmupModel.snapshot().reason);warmupModel.clear();warmup.start();}
    activeModelInput=model?{...model,generation:state.generation}:null;
    const selected=decisionState(state),options={metadata:selected.metadata,...appliedOptions,higherTimeframes:model?.higherTimeframes??higher,asOfTime:state.decisionAsOfTime??undefined,
      ...(model?{config:{...appliedOptions.config,maxBars:3000},evaluationStartIndex:Math.max(0,model.bars.length-Math.max(appliedOptions.config.expiryBars,appliedOptions.config.insideExpiryBars)-1)}:{})};
    lastAnalysisInputs=structuredClone({bars:selected.bars,options});lastAnalysis=analyzer.analyze(selected.bars,options);
    lastExplanation=describeGuideAnalysis(lastAnalysis,{liveSourceBaseline:selected.bootstrapAsOfTime??null});renderAnalysis();
    scheduleResearch(selected,lastAnalysis);
    if(model&&warmup?.snapshot().status!=='ACTIVE')warmup?.activated(model.activation);
    void refreshCandleMarkers();
  }
  function refreshCandleMarkers(){if(!candleMarkers||!lastAnalysis)return;const selected=decisionState(lastState);return candleMarkers.update({analysis:lastAnalysis,bars:selected.bars,metadata:selected.metadata,asOfTime:lastAnalysis.asOfTime,approvedSignals:alerts.filter(item=>item.runId===selectedRun).map(item=>item.signal),execution:paperUserControls?.snapshot()});}
  function decisionState(state=lastState){
    const model=activeModelInput,last=state.bars?.at(-1),tail=model?.bars?.at(-1);
    return model&&model.generation===state.generation&&model.metadata.sourceId===state.metadata?.sourceId&&last&&tail&&['time','closeTime','open','high','low','close'].every(k=>last[k]===tail[k])?{...state,bars:model.bars,metadata:model.metadata,bootstrapAsOfTime:model.bootstrapAsOfTime}:state;
  }
  function resetWindowSource(reason,{preserveClosedContext=false}={}){
    paperControls?.disarm(reason);
    paperUserControls?.disconnect?.(reason);
    formingPreview.clear();lastFormingPreview=null;lastFormingPreviewReceiptAt=null;previewViews.clear('המקור נבדק מחדש; ממתין לעדכון חי חדש.');
    clearChartOverlay('LIVE');clearChartOverlay('TEST');
    // A source-clock quarantine revokes currentness, decisions and execution.
    // Identical closed history already observed on this same source remains
    // known context; the fresh snapshot must still re-establish LIVE intake.
    if(preserveClosedContext)store.quarantine(reason);else{store.reset(reason);timeframes.reset(reason);}
    intrabar.reset();analyzer.clear();if(!preserveClosedContext)selectedRun=null;lastSourceAt=-Infinity;seenSequences.clear();lastAnalysis=null;lastAnalysisInputs=null;lastExplanation=null;lastVisibleAlert=null;renderAnalysis();
  }
  function renderWindowWarmup(evidence,receivedAt){
    const frame=evidence?.windowFrame,bootstrap=evidence?.bootstrapMetadata;
    if(!windowMode()||!frame?.current||!bootstrap?.metadata||store.snapshot(receivedAt).ready)return false;
    const retained=store.snapshot(receivedAt);
    if(retained.contextOnly){
      renderState({...retained,liveEligible:false},['WINDOW_RECOVERY_WAITING_FRESH_FRAMES']);
      $('history-status').textContent=`ההיסטוריה שוחזרה: ${retained.bars.length} נרות סגורים. ממתין לשתי מסגרות מקור חדשות ועקביות לפני חידוש האיתותים.`;
      return true;
    }
    const clockWithinBound=Number.isSafeInteger(frame.sourceEmittedAt)&&(Math.abs(receivedAt-frame.sourceEmittedAt)<=3000||frame.sourceEmittedAt>receivedAt&&windowClock?.permitsFrame(frame,receivedAt));
    if(frame.realtime!==true||!clockWithinBound||windowClock?.shouldBlockIntake()||windowClock?.snapshot().requiresRebaseline){
      renderState({...store.snapshot(receivedAt),current:null,status:'WARMING',ready:false,liveEligible:false},[frame.realtime===true?'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED':'LIVE_STATUS_UNVERIFIED']);return true;
    }
    const proof=verifyLiveChart({metadata:bootstrap.metadata,runId:bootstrap.runId,realtime:frame.realtime,sourceEmittedAt:frame.sourceEmittedAt,bars:[frame.current]},evidence,selectedTabId,providerOptions());
    accountEvaluation=accountControls.evaluateMetadata(proof.metadata,selectedTabId);
    renderState({...store.snapshot(receivedAt),metadata:proof.metadata,current:{...frame.current,receivedAt},status:'WARMING',ready:false,liveEligible:false},['WINDOW_HISTORY_WARMUP',...proof.reasonCodes]);
    const counts=(evidence.history??[]).map(item=>`${item.timeframe??''}: ${item.contiguousBars??item.retainedBars??0}`).join(' · ');
    $('history-status').textContent='אוסף היסטוריה סגורה מחלון הנתונים. המחיר הנוכחי מוצג לתצפית; אישור איתות ממתין לחימום מלא.'+(counts?' '+counts:'');
    return true;
  }
  function renderAlerts(){
    const prior=sessionHistory.flatMap(session=>session.alerts.map(item=>({...item,historicalSessionId:session.sessionId}))),entries=[...prior,...alerts];
    $('alert-count').textContent=(alerts.length?`${alerts.length} התרעות חיות נרשמו בהפעלה הנוכחית.`:'טרם נרשמה התרעה חיה בהפעלה הנוכחית.')+(prior.length?` ${prior.length} רשומות מהפעלות קודמות מסומנות כהיסטוריה. מוצגות עד 40 האחרונות.`:'');
    const tbody=$('live-alerts');tbody.replaceChildren();
    if(!entries.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent='אין התרעות בהפעלה הנוכחית. עצם היעדר התרעה אינו תקלה.';row.append(cell);tbody.append(row);return;}
    for(const item of entries.slice(-40).reverse()){
      const event=item.signal,row=document.createElement('tr');
      const account=item.accountReview?.profile,accountLabel=account?` · ${account.label||account.instrument} · ${{PAPER:'דמו',LIVE:'חשבון אמיתי · הגדרה ידנית',RESEARCH:'מחקר'}[account.mode]??account.mode}`:'';
      for(const text of [stamp(item.receivedAt),`${item.historicalSessionId?'היסטוריה · הפעלה קודמת · ':''}${event.instrument} · ${event.direction==='LONG'?'לונג':'שורט'}${accountLabel}`,(event.patternIds??[]).map(id=>GUIDE_PATTERN_LABELS[id]??id).join(' · ')+` · אישור ${num(event.confirmationClose)} · ביטול ${num(event.invalidation)}`,event.reasonCodes.map(textReason).join(' · ')]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}tbody.append(row);
    }
  }
  function archiveCurrentSession(reason){
    if(!observerSession)return;
    const timing=latency.snapshot(),source=sourceLatency.snapshot();
    if(timing.received||alerts.length||alertDelivery.length||deliveryProbes.length)boundedPush(sessionHistory,{scope:'HISTORICAL_SESSION_ONLY',sessionId:observerSession,runId:selectedRun,sourceTabId:selectedTabId,startedAtWall:sessionStartedAtWall,archivedAtWall:Date.now(),reason,metadata:structuredClone(sessionMetadata),alerts:structuredClone(alerts),alertDelivery:structuredClone(alertDelivery),deliveryProbes:structuredClone(deliveryProbes),latency:{context:timing.context,received:timing.received,completed:timing.completed,metrics:timing.metrics},sourceDomLatency:{sessionId:source.sessionId,metrics:source.metrics}},10);
  }
  function clearChartOverlay(mode='LIVE'){
    const session=mode==='LIVE'?overlayLiveSession:overlayTestSession;
    if(mode==='LIVE'){overlayLiveSession=null;liveOverlayVisible=false;formingPreview.clear();lastFormingPreview=null;lastFormingPreviewReceiptAt=null;if($('forming-preview-status'))$('forming-preview-status').textContent='אין תבנית מתהווה מאומתת כרגע; נדרשים נתוני מקור טריים והקשר סגור.';if($('signal-delivery-status'))$('signal-delivery-status').textContent='אין כרטיס איתות חי פעיל על גרף המחקר.';}else overlayTestSession=null;
    if(!session||!extension||!selectedTabId)return;
    void chrome.scripting.executeScript({target:{tabId:selectedTabId},func:chartSignalOverlayCommand,args:[{action:'clear',sessionId:session,mode}],world:'ISOLATED'}).catch(()=>{});
  }
  function completeAlertDelivery(item){
    const appearance=item.sourceObservation?.sourceAppearanceEpochMs,paint=item.chartOverlay;
    if(!Number.isFinite(appearance)||paint?.status!=='RENDERED'||![paint.firstPaintEpoch,paint.secondPaintEpoch].every(Number.isFinite))return;
    if(!Number.isFinite(item.sourceObservation.sourceDocumentTimeOrigin)||item.sourceObservation.sourceDocumentTimeOrigin!==paint.documentTimeOrigin){item.correlationStatus='SOURCE_DOCUMENT_UNVERIFIED';return;}
    const lower=paint.firstPaintEpoch-appearance,upper=paint.secondPaintEpoch-appearance;
    if(lower<0||upper<lower){item.correlationStatus='INVALID_SOURCE_CHART_CLOCK_ORDER';return;}
    item.correlationStatus='SAME_SOURCE_DOCUMENT_CLOCK';item.sourceToChartPaintLowerMs=lower;item.sourceToChartPaintUpperMs=upper;
    item.scope='First observed coherent source frame through ordinary approval to chart rendering opportunities, on the same source document performance clock. No market/capture/physical-display measurement.';
  }
  async function deliverChartSignal(item){
    if(!active||!selectedTabId||!observerSession||!item||!accountEvaluation.ok)return;
    const serial=connectionSerial,run=selectedRun,tabId=selectedTabId,session=observerSession+':live:'+ ++overlaySerial;
    clearChartOverlay('LIVE');overlayLiveSession=session;
    const record={sessionId:observerSession,runId:run,sourceTabId:tabId,eventId:item.signal.eventId,readEventId:item.readEventId,sourcePacketId:item.sourcePacketId,approvedAtReceiverEpoch:item.approvedAtReceiverEpoch,mode:'LIVE',testOnly:false,chartRequestEpoch:performance.timeOrigin+performance.now(),chartOverlay:null};
    const observation=latestEvidence?.sourceDomTiming?.records?.find(entry=>entry.id===item.sourcePacketId&&!entry.initial&&entry.documentVisible===true&&Number.isFinite(entry.appearanceEpochMs));
    const observedAge=observation?latestEvidence.sourceDomTiming.sourceEpoch-observation.appearanceEpochMs:null;
    if(observation&&Number.isFinite(observedAge)&&observedAge>=0&&observedAge<=30000&&Number.isFinite(latestEvidence.sourceDomTiming.documentTimeOrigin))record.sourceObservation={packetId:item.sourcePacketId,sourceAppearanceEpochMs:observation.appearanceEpochMs,sourceDocumentTimeOrigin:latestEvidence.sourceDomTiming.documentTimeOrigin,sourceObservationMeaning:observation.meaning??'FIRST_OBSERVED_VISIBLE_LOG_DOM_APPEARANCE',sourceTransport:observation.transport??'PUBLIC_PINE_LOG_DOM'};
    boundedPush(alertDelivery,record,100);
    try{
      const result=await chrome.scripting.executeScript({target:{tabId},func:chartSignalOverlayCommand,args:[{action:'show',sessionId:session,mode:'LIVE',expectedSourceSession:windowMode()?observerSession:undefined,expectedSourceRunEpoch:windowMode()?latestEvidence?.windowFrame?.runEpoch:undefined,expectedInstrument:lastState.metadata.instrument,expectedTimeframe:lastState.metadata.timeframe,signal:item.signal}],world:'ISOLATED'});
      record.chartReplyEpoch=performance.timeOrigin+performance.now();record.chartOverlay=result[0]?.result??{status:'NO_OVERLAY_RESPONSE'};
      if(!active||serial!==connectionSerial||run!==selectedRun||overlayLiveSession!==session){record.cancelled=true;void chrome.scripting.executeScript({target:{tabId},func:chartSignalOverlayCommand,args:[{action:'clear',sessionId:session,mode:'LIVE'}],world:'ISOLATED'}).catch(()=>{});return;}
      liveOverlayVisible=record.chartOverlay.status==='RENDERED';completeAlertDelivery(record);
      if($('signal-delivery-status'))$('signal-delivery-status').textContent=liveOverlayVisible?'האיתות המאושר הוצג גם על גרף המחקר.':'האיתות נשמר בלוח; תצוגת הגרף: '+record.chartOverlay.status;
    }catch(error){record.chartOverlay={status:'ERROR',message:String(error?.message??error).slice(0,200)};}
  }
  async function runDeliveryProbe(){
    const button=$('test-signal-delivery'),output=$('delivery-test-status');
    if(!extension||!active||!lastState.ready||!accountEvaluation.ok||!selectedTabId||button.disabled)return;
    probeBusy=true;button.disabled=true;const serial=connectionSerial,run=selectedRun,tabId=selectedTabId,session=observerSession+':test:'+ ++overlaySerial,start=performance.timeOrigin+performance.now();
    clearChartOverlay('TEST');overlayTestSession=session;
    const record={sessionId:observerSession,runId:run,sourceTabId:tabId,mode:'TEST',testOnly:true,marketData:false,startedAtReceiverEpoch:start,chartOverlay:null};boundedPush(deliveryProbes,record,30);
    try{
      const probe=createApprovedDeliveryProbe();record.probe=probe;record.preparedAtReceiverEpoch=performance.timeOrigin+performance.now();
      const result=await chrome.scripting.executeScript({target:{tabId},func:chartSignalOverlayCommand,args:[{action:'show',sessionId:session,mode:'TEST',expectedInstrument:lastState.metadata.instrument,expectedTimeframe:lastState.metadata.timeframe,signal:probe.signal}],world:'ISOLATED'});
      record.finishedAtReceiverEpoch=performance.timeOrigin+performance.now();record.chartOverlay=result[0]?.result??{status:'NO_OVERLAY_RESPONSE'};record.receiverEndToReplyMs=record.finishedAtReceiverEpoch-start;
      if(!active||serial!==connectionSerial||run!==selectedRun||overlayTestSession!==session){record.cancelled=true;void chrome.scripting.executeScript({target:{tabId},func:chartSignalOverlayCommand,args:[{action:'clear',sessionId:session,mode:'TEST'}],world:'ISOLATED'}).catch(()=>{});return;}
      const paint=record.chartOverlay;record.sourceCommandToFirstPaintMs=Number.isFinite(paint.firstPaintEpoch)?paint.firstPaintEpoch-paint.renderReceiptEpoch:null;record.sourceCommandToSecondPaintMs=Number.isFinite(paint.secondPaintEpoch)?paint.secondPaintEpoch-paint.renderReceiptEpoch:null;
      output.textContent=paint.status==='RENDERED'?`בדיקת מסירה חיובית עברה: המנוע אישר דוגמה סינתטית והכרטיס המסומן TEST הוצג בגרף. מתחילת הבדיקה עד תשובת שתי הזדמנויות ציור: ${ms(record.receiverEndToReplyMs)} ms. אין זה איתות מהשוק.`:'בדיקת המסירה לא הושלמה: '+paint.status;
    }catch(error){record.error=String(error?.message??error).slice(0,200);if(serial===connectionSerial&&run===selectedRun)output.textContent='בדיקת המסירה נכשלה: '+record.error;}
    finally{if(serial===connectionSerial&&run===selectedRun){probeBusy=false;button.disabled=!active||!lastState.ready||!accountEvaluation.ok;}}
  }
  function acceptSignals(analysis,state,packet,pollId){
    state=decisionState(state);
    if(!accountEvaluation.ok||!accountControls.snapshot().reviewAccepted)return;
    const technical=userManagedMode?selectGuideTechnicalDecision({analysis,bars:state.bars,asOfTime:analysis.asOfTime}):null;
    if(userManagedMode&&technical.status!=='CONFIRMED'){$('signal-state').textContent=technical.status==='AMBIGUOUS'?'כיווני אסטרטגיות סותרים; אין כניסה.':'ממתין לאישור חדש לפי תנאי האסטרטגיה.';$('signal-detail').textContent=technical.reasonCodes.join(' · ');return;}
    const fresh=[];
    for(const candidate of analysis.signals??[]){
      const signal=selectFreshLiveSignal(candidate,analysis,{bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:state.eligibleCloseTimes,bars:state.bars});
      if(!signal)continue;
      if(userManagedMode&&(signal.direction!==technical.direction||signal.confirmationBarCloseTime!==technical.signal.confirmationBarCloseTime))continue;
      const id=packet.runId+':'+signal.eventId;
      if(alertIds.has(id))continue;
      alertIds.add(id);if(alertIds.size>1000)alertIds.delete(alertIds.values().next().value);
      const review=accountControls.snapshot().review;
      const item={id,sessionId:observerSession,runId:packet.runId,sourceTabId:selectedTabId,receivedAt:packet.receivedAt,sourcePacketId:packet.runId+':'+packet.sequence,sourceEmittedAt:packet.sourceEmittedAt,sourceClockVerified:false,accountReview:{reviewId:review.reviewId,reviewedAt:review.reviewedAt,profile:structuredClone(review.profile),brokerAccountVerified:false,commissionVerified:false,slippageVerified:false,ordersAuthorized:false},signal:structuredClone(signal)};
      item.readEventId='read:'+pollId;item.approvedAtReceiverEpoch=performance.timeOrigin+performance.now();item.sourceObservation=sourceLatency.originFor(item.sourcePacketId);boundedPush(alerts,item,500);fresh.push(item);
      if(!userManagedMode)void paperControls?.accept(item,analysis,state)?.catch(()=>paperControls?.disarm('PAPER_EXECUTION_ERROR'));
      else if(['TRADINGVIEW_PAPER','TRADOVATE'].includes(accountControls.snapshot().brokerProfile?.provider))void Promise.resolve(paperUserControls?.accept(item,analysis,state)).catch(()=>paperUserControls?.disarm('NATIVE_USER_EXECUTION_ERROR'));
    }
    if(fresh.length){
      for(const item of fresh)telegram?.signal(item.signal);
      lastVisibleAlert=fresh.at(-1);const latest=lastVisibleAlert.signal;$('signal-state').textContent='איתות חי אחרון שאושר לפי כללי המחקר: '+(latest.direction==='LONG'?'לונג':'שורט');$('signal-state').dataset.direction=latest.direction;
      $('signal-detail').textContent=(latest.patternIds??[]).map(id=>GUIDE_PATTERN_LABELS[id]??id).join(' · ')+` · אישור מחיר ${num(latest.confirmationClose)} · ביטול ${num(latest.invalidation)}. `+(latest.riskPlan?.status==='PLANNED'?`כמות מחקרית ${latest.riskPlan.quantity}, יעד ${num(latest.riskPlan.target)}.`:'ניתוח טכני לפי כל אסטרטגיה; ניהול הסיכון בידיך.');renderAlerts();if(candleMarkers)void candleMarkers.update({analysis,bars:state.bars,metadata:state.metadata,asOfTime:analysis.asOfTime,approvedSignals:alerts.filter(item=>item.runId===selectedRun).map(item=>item.signal)});if(!userManagedMode)void deliverChartSignal(lastVisibleAlert);else if($('signal-delivery-status'))$('signal-delivery-status').textContent='אישור טכני חדש מוצג בלוח. מצב שיגור הפייפר ומדידות הביצוע מוצגים בבקרת הכניסה; החץ החי על הנר טרם אומת.';
    }else if(!lastVisibleAlert){
      const latest=analysis.latest;$('signal-state').textContent=analysis.status==='WAITING_CONFIRMATION'?'מערך חדש ממתין לנר אישור סגור.':'לא התקבל איתות חי מאושר בסגירה הזו.';
      $('signal-detail').textContent=latest?.reasonCodes?.length?latest.reasonCodes.map(textReason).join(' · '):'תבנית לבדה אינה מספיקה; ההקשר ותנאי האישור נבדקים בנפרד.';
    }
  }
  function chooseRun(parsed){
    const newest=parsed.slice().sort((a,b)=>b.packet.sourceEmittedAt-a.packet.sourceEmittedAt||b.packet.sequence-a.packet.sequence)[0];
    if(!newest)return;
    if(selectedRun===null||newest.packet.runId!==selectedRun&&newest.packet.sourceEmittedAt>lastSourceAt){paperControls?.disarm('SOURCE_CHANGED');paperUserControls?.disconnect?.('SOURCE_CHANGED');clearChartOverlay('LIVE');clearChartOverlay('TEST');selectedRun=newest.packet.runId;lastSourceAt=-Infinity;store.reset('SOURCE_CHANGED');timeframes.reset();intrabar.reset();analyzer.clear();lastAnalysis=null;lastExplanation=null;lastVisibleAlert=null;renderAnalysis();}
  }
  async function poll(attempt=null){
    if(!active)return {outcome:'INACTIVE'};if(inflight){if(!(pollScheduler&&windowMode()))timer=setTimeout(()=>{void poll();},LIVE_POLL_INTERVAL_MS);return {outcome:'BUSY'};}inflight=true;const serial=connectionSerial,readStartedAt=performance.now(),readStartedAtWall=Date.now(),pollId=++pollSerial,context=`tv-tab:${selectedTabId}:connection:${serial}`;
    const token=latency.receive({context,eventId:'read:'+pollId,sourceTimestamp:null});inflightToken=token;
    const diagnosis={outcome:'STARTED',readStartedAtWall,pollId,visibility:runtimeDiagnostics.state(),onscreen:onscreen(),reasonCodes:[],sourcePacketIds:[]};
    const finish=(outcome,reasons=[])=>{diagnosis.outcome=outcome;diagnosis.reasonCodes=reasons;return diagnosis;};
    try{
      let reviewedSourceUrl=null;
      if(userManagedMode){reviewedSourceUrl=accountControls.snapshot().review?.sourceUrl;const currentTab=await chrome.tabs.get(selectedTabId);if(!reviewedSourceUrl||currentTab.url!==reviewedSourceUrl){stop('USER_ACCOUNT_REVIEW_SOURCE_CHANGED');latency.discard(token,'ACCOUNT_SOURCE_TAB_CHANGED');return finish('ACCOUNT_SOURCE_TAB_CHANGED');}}
      if(windowMode()&&!windowPrepared){
        const setup=await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:prepareTradingViewWindowUi,args:[{phase:'window',...(userManagedMode?{allowResearchLiveMultiChart:true}:{})}],world:'ISOLATED'});
        if(!active||serial!==connectionSerial){latency.discard(token,'CONNECTION_CHANGED');return finish('CONNECTION_CHANGED');}
        const prepared=setup[0]?.result;windowPrepared=prepared?.status==='READY';
        if(!windowPrepared){if(windowClock?.snapshot().transientFramePending&&Date.now()-(windowClock.snapshot().latestObserver?.observedAtWall??0)<=2000&&prepared?.action==='SCROLL_OWN_STUDY'){latency.discard(token,'OWN_SOURCE_HEADER_RESTORING');return finish('OWN_SOURCE_HEADER_RESTORING',prepared.reasonCodes);}const reasons=prepared?.reasonCodes??['DATA_WINDOW_PREPARING'];status('מכין את חלון הנתונים של Arrow: '+reasons.map(textReason).join(' · '));renderState({...store.snapshot(),liveEligible:false},reasons);updateEvidence(false);latency.discard(token,'SOURCE_UI_PREPARING');return finish('SOURCE_UI_PREPARING',reasons);}
      }
      const execution=await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:windowMode()?readTradingViewWindowEvidence:readPineLogsEvidence,args:[windowMode()?{sessionId:observerSession,needsSnapshot:store.snapshot().requiresSnapshot||!!windowClock?.snapshot().requiresRebaseline,afterSequence:seenSequences.get(selectedRun)||0,afterRunId:selectedRun,...preopenContext.readerArgs(),...(userManagedMode?{allowResearchLiveMultiChart:true}:{})}:{followLatest:$('follow-logs').checked}],world:'ISOLATED'});
      const readFinishedAt=performance.now();diagnosis.readFinishedAt=readFinishedAt;diagnosis.readMs=readFinishedAt-readStartedAt;
      if(!active||serial!==connectionSerial){latency.discard(token,'CONNECTION_CHANGED');return finish('CONNECTION_CHANGED');}
      const evidence=execution[0]?.result,receivedAt=Date.now();
      if(userManagedMode){const currentTab=await chrome.tabs.get(selectedTabId);if(currentTab.url!==reviewedSourceUrl){stop('USER_ACCOUNT_REVIEW_SOURCE_CHANGED');latency.discard(token,'ACCOUNT_SOURCE_TAB_CHANGED');return finish('ACCOUNT_SOURCE_TAB_CHANGED');}if(evidence)evidence.sourceUrl=currentTab.url;}
      latestEvidence=evidence;
      if(userManagedMode&&windowMode()&&evidence?.reasonCodes?.includes('WINDOW_LAST_BAR_REQUIRED')&&receivedAt-lastPointerRepairAt>=1500){
        lastPointerRepairAt=receivedAt;
        const repair=await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:prepareTradingViewWindowUi,args:[{allowResearchLiveMultiChart:true,clearHistoricalPointer:true,sourceUrl:reviewedSourceUrl}],world:'ISOLATED'});
        if(!active||serial!==connectionSerial){latency.discard(token,'CONNECTION_CHANGED');return finish('CONNECTION_CHANGED');}
        diagnosis.pointerRepair=repair[0]?.result??null;
        boundedPush(pointerRecovery,{pollId,requestedAt:receivedAt,completedAt:Date.now(),sourceUrl:reviewedSourceUrl,result:diagnosis.pointerRepair},30);
      }
      // A clock quarantine must not prevent repairing the public source pane.
      // Only schedule the existing owned-study UI preparation here; no source
      // cursor, market context or decision is accepted before the clock gate.
      if(windowMode()&&evidence?.reasonCodes?.some(reason=>['DATA_WINDOW_NOT_SELECTED','WINDOW_STUDY_NOT_FOUND','WINDOW_FIELDS_NOT_MOUNTED','WINDOW_STUDY_NOT_VISIBLE'].includes(reason)))windowPrepared=false;
      const parsed=[],parseErrors=[],windowClockGrants=new Map();
      for(const raw of evidence?.messages??[]){const result=parsePineOhlcMessage(raw,{receivedAt,tabId:selectedTabId});if(result.ok)parsed.push({...result,raw});else parseErrors.push(...result.reasonCodes);}
      // Retain the source observer's original appearance even when intake must
      // wait. A later poll of the same retained packet must include this wait.
      sourceLatency.observe(evidence?.sourceDomTiming,{beforeEpoch:performance.timeOrigin+readStartedAt,afterEpoch:performance.timeOrigin+readFinishedAt,receiverTimeOrigin:performance.timeOrigin});
      if(windowMode()){
        lastWindowEvidence=evidence;diagnosis.sourceFrameSequence=evidence?.windowFrame?.sequence;
        const clockState=windowClock?.observeEvidence(evidence,{sessionId:observerSession,tabId:selectedTabId,receivedAt});
        if(clockState?.transientFramePending){
          // No packet, witness, approval or timestamp is accepted/restamped.
          // Keep the last verified prefix while the public DOM finishes its
          // bounded update. Clock owner age still expires after 2000ms.
          boundedPush(pollEvidence,{pollId,readStartedAt,readFinishedAt,readStartedAtWall,receivedAt,sourcePacketIds:[],pendingFrameReasons:evidence.reasonCodes,resultStatus:lastState.status,liveEligible:false},600);
          status('ממתין להשלמת עדכון נתונים עקבי; הקריאה החלקית אינה אישור לאיתות.');latency.discard(token,'WAITING_COHERENT_SOURCE_FRAME');return finish('WAITING_COHERENT_SOURCE_FRAME',evidence.reasonCodes);
        }
        if(clockState?.requiresRebaseline&&clockState.quarantineId!==lastClockQuarantineId){
          // Drop every previously eligible decision before waiting for a new
          // clock pair. The next reader call must request a fresh baseline.
          resetWindowSource('WINDOW_CLOCK_REBASELINE_REQUIRED',{preserveClosedContext:true});
          lastClockQuarantineId=clockState.quarantineId;
        }
        const frame=evidence?.windowFrame??evidence?.frame,batchSourceAt=Math.max(...parsed.map(result=>result.packet.sourceEmittedAt),...(frame?.coherent===true&&Number.isSafeInteger(frame.sourceEmittedAt)?[frame.sourceEmittedAt]:[]));
        for(const result of parsed)if(result.packet.sourceEmittedAt>receivedAt+3000){const grant=windowClock?.grantFor(result.packet,receivedAt);if(grant)windowClockGrants.set(result.id,grant);}
        const frameClockBlocked=frame?.coherent===true&&frame.sourceEmittedAt>receivedAt+3000&&!windowClock?.permitsFrame(frame,receivedAt),packetClockBlocked=parsed.some(result=>result.packet.sourceEmittedAt>receivedAt+3000&&!windowClockGrants.has(result.id));
        if(windowClock?.shouldBlockIntake()||frameClockBlocked||packetClockBlocked){
          // Ordinary clocks keep the 3s guard. A bounded lead needs two owned,
          // advancing observer frames and an exact process-local packet grant.
          // Defer before any cursor, HTF, run or store mutation if proof fails.
          const reason=clockState?.blockIntake?clockState.reasonCode:'SOURCE_CLOCK_OFFSET_BOUND_EXCEEDED';clearChartOverlay('LIVE');renderState({...store.snapshot(receivedAt),liveEligible:false},[reason]);
          status(clockState?.locked?'השעון השתנה לאחר בדיקת המקור. יש לעצור ולהתחיל מעקב מחדש; איתותים חסומים.':clockState?.requiresRebaseline?'המקור מושהה לבדיקה מחדש. ממתין לשתי תצפיות טריות ולבסיס חדש; איתותים חסומים.':clockState?.blockIntake?'השעון השתנה לאחר בדיקת המקור. יש לעצור ולהתחיל מעקב מחדש; איתותים חסומים.':'בודק את התאמת שעון המקור לפי תצפיות חדשות. הנתונים ממתינים לבדיקה; איתותים חסומים.');
          diagnosis.deferredBatch={sourceEmittedAt:batchSourceAt,receivedAt,sourceClockOffsetMs:batchSourceAt-receivedAt,packetIds:parsed.map(result=>result.id)};
          boundedPush(pollEvidence,{pollId,readStartedAt,readFinishedAt,readStartedAtWall,receivedAt,transportAndReadMs:readFinishedAt-readStartedAt,sourceReadMs:evidence?.readMs??null,sourcePacketIds:[],deferredSourcePacketIds:parsed.map(result=>result.id),deferredReason:reason,sourceClockOffsetMs:batchSourceAt-receivedAt,parserReasons:unique(parseErrors),resultStatus:lastState.status,liveEligible:false},600);
          evidenceDirty=true;updateEvidence(false);latency.discard(token,'SOURCE_FUTURE_BATCH_DEFERRED');return finish('SOURCE_FUTURE_BATCH_DEFERRED',[reason]);
        }
        preopenContext.observe(evidence);renderPreopenContext();
        pollScheduler?.recordSourceFrame(evidence?.windowFrame);
        if(evidence?.resetRequired)resetWindowSource(evidence.reasonCodes?.[0]??'WINDOW_SOURCE_RESET',{preserveClosedContext:canPreserveWindowClosedContext(evidence,store.snapshot(receivedAt))});
      }
      latency.analysisStarted(token);
      if(!evidence||evidence.status!=='OK'){
        const reasons=evidence?.reasonCodes??['READER_UNAVAILABLE'];status(reasons.map(textReason).join(' · '),'error');
        const state={...store.snapshot(receivedAt),liveEligible:false};if(!renderWindowWarmup(evidence,receivedAt))renderState(state,reasons);updateEvidence(false);latency.discard(token,'SOURCE_UNAVAILABLE');return finish('SOURCE_UNAVAILABLE',reasons);
      }
      chooseRun(parsed);
      const fresh=parsed.filter(result=>result.packet.runId===selectedRun&&result.packet.sequence>(seenSequences.get(selectedRun)??0)).sort((a,b)=>a.packet.sequence-b.packet.sequence);
      if(!fresh.length){
        let state=store.snapshot(receivedAt),proof=null;
        if(state.metadata){proof=verifyLiveChart({metadata:state.metadata,runId:selectedRun,realtime:true,sourceEmittedAt:state.sourceDecisionTime,bars:[state.current??state.bars.at(-1)]},evidence,selectedTabId,providerOptions());accountEvaluation=accountControls.evaluateMetadata(state.metadata,selectedTabId);if(!proof.identityValid||evidence.chart?.replay===true){store.disconnect(!proof.identityValid?'CHART_IDENTITY_MISMATCH':'REPLAY_SOURCE');lastVisibleAlert=null;state=store.snapshot(receivedAt);}state={...state,liveEligible:state.liveEligible&&proof.liveVerified&&accountEvaluation.ok&&(!windowMode()||!windowClock?.snapshot().requiresRebaseline&&!windowClock?.shouldBlockIntake())};}
        if(!renderWindowWarmup(evidence,receivedAt))renderState(state,[...parseErrors,...(proof?.reasonCodes??[])]);status(windowMode()&&!state.ready?'אוסף היסטוריה מחלון הנתונים; התרעות ממתינות לחימום.':state.stale?'אין עדכון מקור חדש; הנתונים התיישנו.':'מחובר; ממתין לעדכון מקור חדש.',state.stale?'error':'');updateEvidence(false);latency.discard(token,'NO_FRESH_SOURCE_PACKET');return finish('NO_FRESH_SOURCE_PACKET',[...parseErrors,...(proof?.reasonCodes??[])]);
      }
      const observedAsOfTime=Math.max(...parsed.filter(r=>r.packet.runId===selectedRun).map(r=>r.packet.sourceEmittedAt));
      // One coherent source batch publishes base, 5m and 15m snapshots in that
      // order. Make its verified HTF context available before analyzing the
      // base snapshot. The original observed-as-of clock is retained, so a
      // genuinely later HTF cannot enter an earlier frozen setup.
      for(const result of fresh){
        const packet=result.packet;
        if(!['timeframe_snapshot','timeframe_update'].includes(packet.kind))continue;
        const proof=verifyLiveChart(packet,evidence,selectedTabId,providerOptions());
        if(proof.identityValid)timeframes.ingest({...packet,metadata:proof.metadata},{observedAsOfTime,includeBars:false});
      }
      const processed=[];let lastRenderValid=false,lastRenderedPacketId=null,deferBootstrapAnalysis=false;
      for(const result of fresh){
        const packet=result.packet;seenSequences.set(selectedRun,packet.sequence);lastSourceAt=Math.max(lastSourceAt,packet.sourceEmittedAt);
        const proof=verifyLiveChart(packet,evidence,selectedTabId,providerOptions());
        accountEvaluation=accountControls.evaluateMetadata(proof.metadata,selectedTabId);
        boundedPush(rawEvidence,{id:result.id,receivedAt,readStartedAtWall,sourceEmittedAt:packet.sourceEmittedAt,sourceClockVerified:false,raw:result.raw,chart:structuredClone(evidence.chart),proofReasonCodes:proof.reasonCodes,accountReasonCodes:accountEvaluation.reasonCodes,accountReviewId:accountControls.snapshot().review?.reviewId??null});processed.push(result.id);
        if(packet.kind==='blocked'){store.disconnect('SOURCE_BLOCKED');lastRenderValid=false;renderState(store.snapshot(receivedAt),packet.reasonCodes);status(packet.reasonCodes.map(textReason).join(' · '),'error');continue;}
        if(!proof.identityValid){store.disconnect('CHART_IDENTITY_MISMATCH');lastRenderValid=false;renderState(store.snapshot(receivedAt),proof.reasonCodes);status(proof.reasonCodes.map(textReason).join(' · '),'error');continue;}
        timeframes.ingest({...packet,metadata:proof.metadata},{observedAsOfTime,includeBars:false});
        if(['timeframe_snapshot','timeframe_update'].includes(packet.kind)){tracePacket(packet);continue;}
        // Recovery snapshots refresh an unavailable baseline, never the live
        // baseline of an already healthy stream. Otherwise a periodic snapshot
        // would forever postpone the start of every eligible formation.
        if(packet.kind==='snapshot'&&store.snapshot(receivedAt).ready&&!windowClock?.snapshot().requiresRebaseline){tracePacket(packet);continue;}
        if(packet.kind==='snapshot'){lastAnalysis=null;lastVisibleAlert=null;}
        const ingested=store.ingest({...packet,metadata:proof.metadata,receivedAt},{sourceAsOfTime:packet.sourceEmittedAt,windowClockGrant:windowClockGrants.get(result.id)});
        if(windowMode()&&ingested.accepted&&ingested.bootstrap&&packet.kind==='snapshot')windowClock?.acknowledgeBaseline(packet,{receivedAt,storeState:ingested});
        const clockBaselineReady=!windowMode()||!windowClock?.snapshot().requiresRebaseline&&!windowClock?.shouldBlockIntake();
        const state={...ingested,liveEligible:ingested.liveEligible&&accountEvaluation.ok&&clockBaselineReady};lastRenderValid=state.accepted;if(state.accepted){if(state.bootstrap)intrabar.reset();tracePacket(packet);if(!state.bootstrap)lastRenderedPacketId=result.id;}renderState(state,proof.reasonCodes);
        for(const bar of state.newlyClosed??[])if(bar.finalOhlcVerified)boundedPush(closeBoundarySamples,{pollId,sourcePacketId:result.id,barOpenTime:bar.time,closeTime:bar.closeTime,receivedAt,sourceEmittedAt:packet.sourceEmittedAt,sourceBoundaryToConfirmationMs:packet.sourceEmittedAt-bar.closeTime,crossClockDifferenceMs:receivedAt-bar.closeTime,sourceClockVerified:false,eligibleLive:state.liveEligible&&(state.eligibleCloseTimes??[]).includes(bar.closeTime),scope:'Expected source-clock bar-close boundary to Pine execution/source-frame emission, on the same producer clock. Cross-clock receiver differences are unverified and are not network/capture latency.'},600);
        if(state.ready&&(state.bootstrap||!lastAnalysis||state.newlyClosed.some(bar=>bar.finalOhlcVerified))&&!settingsDirty&&accountEvaluation.ok){
          if(!state.bootstrap&&state.newlyClosed.some(bar=>bar.finalOhlcVerified)){
            deferBootstrapAnalysis=false;analyzeClosedState(state);
            // Preserve the original packet and latency origin of a genuine
            // new confirmation; deferred context never enters this gate.
            if(state.liveEligible)acceptSignals(lastAnalysis,state,packet,pollId);
          }else deferBootstrapAnalysis=true;
        }
        if(state.accepted)renderFormingPreview(state);
        status(state.accepted?state.bootstrap?'נקלט בסיס היסטורי. התרעות היסטוריות חסומות.':state.liveEligible?'נתונים חיים מאומתים נקלטו.':'נתוני מקור נקלטו; התרעות חיות ממתינות לאימות.':state.reasonCodes.map(textReason).join(' · '),state.accepted?'ok':'error');
      }
      // A retained snapshot can precede a newer base update in this batch.
      // Analyze its latest accepted baseline after all causal context arrives,
      // without generating a historical approval or substituting its origin.
      if(deferBootstrapAnalysis&&lastState.ready&&!settingsDirty&&accountEvaluation.ok){analyzeClosedState(lastState);renderFormingPreview(lastState);}
      history24?.updateLive(history24Context());
      if(seenSequences.size>16)seenSequences.delete(seenSequences.keys().next().value);
      boundedPush(pollEvidence,{pollId,readStartedAt,readFinishedAt,readStartedAtWall,receivedAt,transportAndReadMs:readFinishedAt-readStartedAt,sourceReadMs:evidence.readMs??null,sourcePacketIds:processed,parserReasons:unique(parseErrors),resultStatus:lastState.status,liveEligible:lastState.liveEligible},600);
      $('export-live').disabled=false;updateEvidence(false);diagnosis.sourcePacketIds=processed;diagnosis.processedPackets=processed.length;diagnosis.processingMs=performance.now()-readFinishedAt;
      if(lastRenderValid){if(lastRenderedPacketId)sourceLatency.associate('read:'+pollId,lastRenderedPacketId);latency.analysisFinished(token);latency.rendered(token);}else latency.discard(token,'NO_VALID_RESULT_RENDER');return finish(lastRenderValid?'RENDERED':'NO_VALID_RESULT_RENDER',unique(parseErrors));
    }catch(error){
      latency.discard(token,'READ_OR_ANALYSIS_ERROR');status('קריאת המקור נכשלה: '+String(error?.message??error).slice(0,300),'error');store.disconnect('READER_ERROR');renderState(store.snapshot());updateEvidence(false);return finish('READ_OR_ANALYSIS_ERROR',[String(error?.message??error).slice(0,200)]);
    }finally{
      inflight=false;if(inflightToken===token)inflightToken=null;if(active&&serial===connectionSerial&&!(pollScheduler&&windowMode()))timer=setTimeout(()=>{void poll();},LIVE_POLL_INTERVAL_MS);
    }
  }
  async function refreshTabs(){
    if(!rulesReady)return;
    if(!extension){$('live-tab').replaceChildren(new Option('יש לפתוח את המסך מתוך ההרחבה',''));$('connect-live').disabled=true;status('מסך החיבור דורש את הרחבת Arrow ב־Chrome. פתיחה דרך localhost אינה מחברת לשוניות.');return;}
    try{
      const allTabs=await chrome.tabs.query({url:['https://tradingview.com/*','https://*.tradingview.com/*']}),tabs=allTabs.filter(tab=>isTvUrl(tab.url)),logTabs=allTabs.filter(tab=>isTvPineUrl(tab.url));
      const previousLog=$('bootstrap-log-tab').value;bootstrapLogTabs=new Set(logTabs.map(tab=>tab.id));$('bootstrap-log-tab').replaceChildren(new Option('לוגים באותה לשונית גרף · בדיקה בלבד',''));
      for(const tab of logTabs)$('bootstrap-log-tab').append(new Option(`${tab.title??'Pine Editor'} · ${tab.id}`,String(tab.id)));
      if(logTabs.some(tab=>String(tab.id)===previousLog))$('bootstrap-log-tab').value=previousLog;
      const previous=$('live-tab').value;$('live-tab').replaceChildren();
      if(!tabs.length)$('live-tab').append(new Option('לא נמצאה לשונית גרף TradingView',''));
      for(const tab of tabs)$('live-tab').append(new Option(`${tab.title??'TradingView'} · ${tab.id}`,String(tab.id)));
      if(tabs.some(tab=>String(tab.id)===previous))$('live-tab').value=previous;
      else{
        const full=tabs.filter(tab=>tab.url==='https://www.tradingview.com/chart/ARROWFR1/'),research=tabs.filter(tab=>/Arrow OHLC Live Verification/.test(tab.title??''));
        if(full.length===1)$('live-tab').value=String(full[0].id);
        else if(research.length===1)$('live-tab').value=String(research[0].id);
      }
      $('connect-live').disabled=!rulesReady||active||!tabs.length;paperControls?.refresh();
    }catch(error){status('לא ניתן לקרוא את רשימת לשוניות הגרף: '+String(error?.message??error),'error');}
  }
  function cleanupObserver(){windowClock?.reset('SOURCE_STOPPED');lastClockQuarantineId=null;clearChartOverlay('LIVE');clearChartOverlay('TEST');if(extension&&selectedTabId&&observerSession){
    void chrome.scripting.executeScript({target:{tabId:selectedTabId},func:chartSignalOverlayCommand,args:[{action:'clear',sessionId:observerSession}],world:'ISOLATED'}).catch(()=>{});
    if(wakeAvailable)void chrome.scripting.executeScript({target:{tabId:selectedTabId},func:windowWakeSourceCommand,args:[{action:'stop',sessionId:observerSession}],world:'ISOLATED'}).catch(()=>{});
    void chrome.scripting.executeScript({target:{tabId:selectedTabId},func:sourceDomTimingCommand,args:[{action:'stop',sessionId:observerSession}],world:'ISOLATED'}).catch(()=>{});
    if(windowMode())void chrome.scripting.executeScript({target:{tabId:selectedTabId},func:readTradingViewWindowEvidence,args:[{stop:true,sessionId:observerSession}],world:'ISOLATED'}).catch(()=>{});
  }}
  function stop(reason='ACCOUNT_REVIEW_REQUIRED'){clearTimeout(researchTimer);paperControls?.disarm(reason);paperUserControls?.disarm(reason);pollScheduler?.stop(reason);liveOverlayVisible=false;active=false;connectionSerial++;clearTimeout(timer);timer=null;cleanupObserver();if(inflightToken)latency.discard(inflightToken,'STOPPED');accountControls.invalidate(reason,{notify:false});accountEvaluation={ok:false,reasonCodes:[reason]};store.disconnect('USER_STOPPED');lastAnalysis=null;lastExplanation=null;lastVisibleAlert=null;renderAnalysis();renderState(store.snapshot());$('connect-live').disabled=!rulesReady||!extension||!$('live-tab').value;$('stop-live').disabled=true;$('stop-focus-live').disabled=true;$('live-tab').disabled=!rulesReady;status('המעקב נעצר. התחלה נוספת דורשת בדיקה חדשה של הגדרת החשבון.');updateEvidence();}
  async function connect({isCancelled=()=>false}={}){
    if(!rulesReady||!extension||active||starting||preparingContext)return;const tabId=Number($('live-tab').value);if(!Number.isSafeInteger(tabId)||tabId<1)return;
    starting=true;$('connect-live').disabled=true;
    try{
      const accepted=await accountControls.requestReview(tabId);if(!accepted||isCancelled())return;
      if(Number($('live-tab').value)!==tabId){accountControls.invalidate('ACCOUNT_REVIEW_SOURCE_CHANGED');status('לשונית הגרף השתנתה. בדקו את הגדרת החשבון שוב.','error');return;}
      appliedOptions=readOptions();if(!userManagedMode)await saveLiveRuleSettings(extension?chrome.storage?.local:undefined,readStoredSettings());
      if(isCancelled())return;const committed=accountControls.snapshot();
      if(Number($('live-tab').value)!==tabId||!committed.reviewAccepted||committed.review?.reviewId!==accepted.review.reviewId||JSON.stringify(committed.draftProfile)!==JSON.stringify(accepted.profile)){
        accountControls.invalidate('ACCOUNT_REVIEW_REQUIRED');status('החשבון או לשונית המקור השתנו בזמן שמירת ההגדרות. המעקב לא החל; נדרשת בדיקה חדשה.','error');return;
      }
      accountEvaluation={ok:false,reasonCodes:['SOURCE_METADATA_REQUIRED']};archiveCurrentSession('NEW_CONNECTION');const previous=latency.snapshot();if(previous.received)boundedPush(latencyArchives,{...previous,scope:'HISTORICAL_SESSION_ONLY',sessionId:observerSession,runId:selectedRun},10);
      selectedTabId=tabId;activeTransport=$('live-transport').value||'window';windowPrepared=false;lastWindowEvidence=null;latestEvidence=null;connectionSerial++;pollSerial=0;selectedRun=null;lastSourceAt=-Infinity;seenSequences.clear();settingsDirty=false;lastAnalysis=null;lastAnalysisInputs=null;lastExplanation=null;lastVisibleAlert=null;store.reset('CONNECT');timeframes.reset();intrabar.reset();analyzer.clear();observerSession=`tv-tab:${selectedTabId}:connection:${connectionSerial}:${crypto.randomUUID()}`;sessionStartedAtWall=Date.now();sessionMetadata=null;windowClock?.reset('NEW_CONNECTION');lastClockQuarantineId=null;windowClock=windowMode()?createLiveWindowClock({sessionId:observerSession,tabId:selectedTabId,allowResearchLiveMultiChart:userManagedMode,allowOrdinaryClockJitter:true}):null;sourceLatency.reset(observerSession);latency.reset(`tv-tab:${selectedTabId}:connection:${connectionSerial}`,'CONNECT');runtimeDiagnostics.reset();lastRenderSignature=null;lastIntrabarSignature=null;lastLatencyAt=-Infinity;liveOverlayVisible=false;probeBusy=false;sourceWakeCount=0;lastWakeAt=-Infinity;alertDelivery.length=0;deliveryProbes.length=0;alerts=[];alertIds.clear();rawEvidence=[];pollEvidence=[];closeBoundarySamples=[];pollScheduler?.stop('NEW_CONNECTION');pollScheduler=wakeAvailable?createLiveWindowPollScheduler({run:attempt=>poll(attempt)}):null;renderAnalysis();renderAlerts();renderLatency();renderState(store.snapshot());if($('signal-delivery-status'))$('signal-delivery-status').textContent='טרם הוצג איתות חי מאושר בהפעלה הנוכחית.';if($('delivery-test-status'))$('delivery-test-status').textContent='טרם בוצעה בדיקת מסירה בהפעלה הנוכחית.';
      preopenContext.begin({sourceTabId:tabId,instrument:accepted.profile.instrument,connectionSessionId:observerSession,...(userManagedMode?{sourceUrl:accepted.review.sourceUrl}:{})});formingPreview.clear();lastFormingPreview=null;lastFormingPreviewReceiptAt=null;renderPreopenContext();
      if(isCancelled())return;active=true;const serial=connectionSerial;$('connect-live').disabled=true;$('stop-live').disabled=false;$('stop-focus-live').disabled=false;$('live-tab').disabled=true;$('export-live').disabled=false;status('הגדרת החשבון נבדקה להפעלה הזו. קורא את מקור הנתונים מהגרף שנבחר…');
      try{await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:sourceDomTimingCommand,args:[{action:'install',sessionId:observerSession}],world:'ISOLATED'});}catch{ /* OHLC remains usable; the absent source timing stays explicitly unmeasured. */ }
      if(wakeAvailable&&windowMode())try{const installed=await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:windowWakeSourceCommand,args:[{action:'install',sessionId:observerSession}],world:'ISOLATED'});if(installed[0]?.result?.status!=='INSTALLED')pollScheduler.transportFailed('SOURCE_WAKE_UNAVAILABLE');}catch{pollScheduler.transportFailed('SOURCE_WAKE_INSTALL_FAILED');}
      if(!active||serial!==connectionSerial){cleanupObserver();return;}updateEvidence();if(pollScheduler&&windowMode())pollScheduler.start(observerSession);else void poll();
    }catch(error){accountControls.invalidate('ACCOUNT_REVIEW_REQUIRED');status('המעקב לא החל: '+String(error?.message??error),'error');}
    finally{starting=false;$('connect-live').disabled=active||!rulesReady||!extension||!$('live-tab').value;}
  }
  async function applyRules(){
    if(!rulesReady||applyingRules)return;
    try{const settings=readStoredSettings();if(active)stop('RULES_DIRTY');accountControls.invalidate('ACCOUNT_REVIEW_REQUIRED',{notify:false});accountEvaluation={ok:false,reasonCodes:['ACCOUNT_REVIEW_REQUIRED']};appliedOptions=readOptions();settingsDirty=false;store.reset('RULES_CHANGED');lastAnalysis=null;lastVisibleAlert=null;renderState(store.snapshot());status('כללי האיתות נשמרו. התחלה חדשה דורשת בדיקת חשבון וחימום חדש.','ok');updateEvidence();
      applyingRules=true;$('apply-live-rules').disabled=true;
      const saved=userManagedMode?{status:'USER_MANAGED_NO_RISK_SETTINGS'}:await saveLiveRuleSettings(extension?chrome.storage?.local:undefined,settings);
      storageNote.textContent=saved.status==='SAVED'?'ההגדרות שהחלתם נשמרו מקומית וייטענו בפתיחת המסך הבאה.':'ההגדרות הוחלו בזיכרון, אך לא נשמרו מקומית. אפשר להמשיך להשתמש במסך; יש להזין אותן שוב לאחר סגירה.';
    }catch(error){status('ההגדרות לא הוחלו: '+String(error?.message??error),'error');}
    finally{applyingRules=false;$('apply-live-rules').disabled=!rulesReady;}
  }
  async function exportEvidence(){
    let sourceWakeDiagnostics=null;if(wakeAvailable&&windowMode()&&selectedTabId&&observerSession)try{const result=await chrome.scripting.executeScript({target:{tabId:selectedTabId},func:windowWakeSourceCommand,args:[{action:'read',sessionId:observerSession}],world:'ISOLATED'});sourceWakeDiagnostics=result[0]?.result??null;}catch{}
    const content={schemaVersion:1,extensionVersion:'0.31.9',kind:'LIVE_OHLC_OBSERVATION',executionMode:userManagedMode?'USER_MANAGED_ANALYSIS':'LEGACY_RESEARCH',exportedAt:new Date().toISOString(),source:windowMode()?'Personal TradingView public Data Window bridge':'Personal TradingView finite Pine Logs bridge',sourceTransport:activeTransport,scope:'Current observation connection only. Prior alerts, deliveries and timing summaries are separately grouped under sessionHistory/latencyArchives and are never current-run approval evidence. Source OHLC, confirmed provider HTFs, observed intrabar updates and first extension-observed coherent source DOM frame to result rendering opportunities. No exchange/capture/physical-display measurement. Window volume is quantized to 6 decimals.',windowEvidence:windowMode()?lastWindowEvidence:null,pollIntervalMs:LIVE_POLL_INTERVAL_MS,orderEligible:false,
      active,selectedTabId,selectedRun,paperExecution:paperControls?.snapshot()??null,paperUserExecution:paperUserControls?.snapshot()??null,paperQuickStart:paperQuickStart?.snapshot()??null,candleMarkers:candleMarkers?.snapshot()??null,history24:history24?.exportState()??null,warmup3000:warmup?.snapshot()??null,warmupModel:warmupModel.snapshot(),preopenContext:{...preopenContext.snapshot({includeHistory:true}),readSource:preopenReadSource},formingPreview:lastFormingPreview,formingPreviewReceivedAt:lastFormingPreviewReceiptAt,formingDisplay:formingView.snapshot(),closestStrategy:closestView.snapshot(),closestStrategyJournal:closestJournal.snapshot(),researchUpgrades:research.snapshot(),observationSession:{sessionId:observerSession,runId:selectedRun,sourceTabId:selectedTabId,startedAtWall:sessionStartedAtWall,scope:'CURRENT_CONNECTION_ONLY'},settingsDirty,appliedOptions,windowClockCorrelation:windowClock?.snapshot()??null,pointerRecovery,sourceWakeDiagnostics,pollScheduler:pollScheduler?.snapshot()??null,runtimeDiagnostics:runtimeDiagnostics.snapshot(),alertDelivery,deliveryProbes,account:accountControls.snapshot(),accountReasonCodes:accountEvaluation.reasonCodes,store:lastState,retainedStoreClockState:store.snapshot(),timeframes:timeframes.snapshot({asOfTime:lastState.decisionAsOfTime??undefined}),intrabar:intrabar.snapshot(),analysisInputs:lastAnalysis?lastAnalysisInputs:null,latestAnalysis:lastAnalysis,explanation:lastExplanation,alerts,rawEvidence,pollEvidence,closeBoundarySamples,sourceDomLatency:sourceLatency.snapshot(),latency:{...latency.snapshot(),receiptBoundary:'Before chrome.scripting.executeScript starts reading the source tab DOM',marketToDisplayMeasured:false,captureToDisplayMeasured:false},latencyArchives,sessionHistory};
    const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='arrow-live-ohlc-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('refresh-tabs').addEventListener('click',()=>{void refreshTabs();});$('connect-live').addEventListener('click',()=>{void connect();});$('stop-live').addEventListener('click',()=>stop());$('export-live').addEventListener('click',exportEvidence);$('apply-live-rules').addEventListener('click',applyRules);
  $('export-live-focus').addEventListener('click',exportEvidence);
  $('prepare-window-history').addEventListener('click',()=>{void prepareWindowHistory();});
  $('bootstrap-log-tab').addEventListener('change',()=>{if(active)stop('BOOTSTRAP_SOURCE_CHANGED');preopenContext.clear('BOOTSTRAP_SOURCE_SELECTION_CHANGED');preopenReadSource=null;renderPreopenContext();});
  $('popout-live').addEventListener('click',()=>{if(rulesReady&&extension&&chrome.windows?.create)void chrome.windows.create({url:chrome.runtime.getURL('live-ohlc.html'+(userManagedMode?'?execution=user-managed':'')),type:'popup',width:960,height:1000}).catch(error=>status('פתיחת חלון המעקב נכשלה: '+String(error?.message??error),'error'));});
  $('stop-focus-live').addEventListener('click',()=>stop());
  $('focus-live').addEventListener('click',()=>{const focused=document.body.dataset.focus!=='true';document.body.dataset.focus=String(focused);$('focus-live').setAttribute('aria-pressed',String(focused));$('focus-live').textContent=focused?'חזרה לכל המסכים':'תצוגת בדיקה מרוכזת';if(focused)window.scrollTo(0,0);});
  for(const id of [...LIVE_RULE_FIELD_IDS,...LIVE_RULE_CHECK_IDS.filter(id=>id!=='require-risk')])$(id).addEventListener('input',()=>{if(active)stop('RULES_DIRTY');accountControls.invalidate('ACCOUNT_REVIEW_REQUIRED',{notify:false});accountEvaluation={ok:false,reasonCodes:['ACCOUNT_REVIEW_REQUIRED']};settingsDirty=true;renderRiskNote();renderState(store.snapshot());});
  $('live-tab').addEventListener('change',()=>{accountControls.invalidate('ACCOUNT_REVIEW_SOURCE_CHANGED');});
  $('live-transport').addEventListener('change',()=>{if(active)stop('SOURCE_CHANGED');accountControls.invalidate('ACCOUNT_REVIEW_SOURCE_CHANGED');windowPrepared=false;settingsDirty=true;$('legacy-follow-setting').hidden=$('live-transport').value!=='logs';});
  const releaseBrokerAccountGuard=watchBrokerAccountChanges(globalThis.chrome?.storage,reason=>{paperControls?.disarm(reason);paperUserControls?.disarm(reason);if(userManagedMode){if(active)stop(reason);else if(accountControls.handleRegistryChange)accountControls.handleRegistryChange(reason);else accountControls.invalidate(reason);}});
  window.addEventListener('pagehide',()=>{telegram?.dispose();clearTimeout(researchTimer);research.dispose();releaseBrokerAccountGuard();paperControls?.disarm('PAGE_HIDDEN');paperUserControls?.dispose();pollScheduler?.stop('PAGE_HIDDEN');runtimeDiagnostics.dispose();candleMarkers?.dispose();history24?.dispose();warmup?.dispose();active=false;clearTimeout(timer);cleanupObserver();accountControls.dispose();if(inflightToken)latency.discard(inflightToken,'PAGE_HIDDEN');});
  if(wakeAvailable)chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message?.kind!=='ARROW_WINDOW_WAKE_V1'||!active||!windowMode())return false;const result=validateWindowWakeMessage(message,sender,{extensionId:chrome.runtime.id,tabId:selectedTabId,sessionId:observerSession});if(!result.valid)return false;const ok=pollScheduler.wake(result.wake);if(ok){sourceWakeCount++;lastWakeAt=performance.now();}reply?.({ok});return false;});
  const resume=()=>{if(active&&windowMode()&&document.visibilityState==='visible')pollScheduler?.request('visibility-resume');};document.addEventListener?.('visibilitychange',resume);window.addEventListener('focus',resume);
  $('test-signal-delivery')?.addEventListener('click',()=>{void runDeliveryProbe();});
  renderRiskNote();void initializeSettings();
}

