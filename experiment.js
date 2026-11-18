import {labelTextKey} from './label-image-key.mjs';
import {createLabelOcr} from './label-ocr.mjs';
import {createRetainedPrice} from './retained-price.mjs';
import { priceConfidenceLabel } from './price-validation.mjs';
import { findNumberedLabels } from './numbered-labels.mjs';
import { createLiveMonitor } from './live-monitor.mjs';
import { validRecentRegion } from './chart-context.mjs';
import { findPriceBadge, priceTextBounds } from './price-badge.mjs';
import { detectAutoLayout, cachedLayoutStillVisible } from './auto-layout.mjs';
import { createPriceOcr } from './price-ocr.mjs';
import { createTimingStats } from './timing.mjs';
import { priceImageKey } from './price-cache.mjs';
import { createShortcutControls, describeShortcutOutcome } from './shortcut-controls.mjs';
import { MAX_CAPTURE_GAP_MS } from './capture-timing.mjs';
import { createVisualPositionReader } from './position-vision.mjs';
import {hasAutoFlatProof} from './auto-flat-proof.mjs';
import { createFrameScheduler } from './frame-scheduler.mjs';
import { createOcrSupervisor } from './ocr-supervisor.mjs';
import { createLatestVisible } from './latest-visible.mjs';
import { createCaptureSession } from './capture-session.mjs';
import { createNumberHints, inspectNumberHintQuality } from './number-hints.mjs';
import { createLabelReadScheduler } from './label-read-scheduler.mjs';
import { copyFrameRectToCanvas } from './frame-snapshot.mjs';
import { createChartMotionReader } from './chart-motion-reader.mjs';
import { createSignalLatency } from './signal-latency.mjs';
import { createCaptureRateController, compareCaptureRates, validCaptureRate, CAPTURE_RATE_KEY } from './capture-rate.mjs';
import { createReplayRecorder, encodeReplayPng } from './replay-recorder.mjs';
import { createEntrySignalGate } from './entry-signal-gate.mjs';
import { createPositionQuantityProof,quantityImageKey } from './position-quantity.mjs';
import { createCandleVision } from './candle-vision.mjs';
import { createCandleReader } from './candle-reader.mjs';
import { createCandleDisplay } from './candle-display.mjs';
import { createGuideVisualAdvisor,createGuideSignalDisplay } from './guide-visual-advisor.mjs';
import { installCaptureProbeControls } from './capture-probe-controls.mjs';
import { installSourceMarkerControls } from './source-marker-controls.mjs';

const $ = id => document.getElementById(id);
const canvas = $('preview'), ctx = canvas.getContext('2d', { willReadFrequently: true });
const video = document.createElement('video'); video.muted = true; video.playsInline = true;
let stream = null, region = null, recentRegion = null, priceRegion = null, selection = 'chart', tracker = null, drag = null, running = false, rows = [];
let lastSignalId=null,lastKnownArrow=null,lastLayoutProbeAt=0;
let videoStalled=false;
let lastVideoTime = -1, lastNewFrameAt = 0;
let autoMode = false, activeLayout = null, pendingLayout = null, pendingCount = 0, autoGap = false, usingCachedLayout = false;
let layoutSearchStartedAt=null,layoutWaitLogged=false;
let ocrBusy = false, ocrRequest=0, ocrSession = 0, chartEpoch = 0, currentBadgeKey = '', attemptedKey = '', lastOcrValue = null,priceRetryAt=0;
let timing = createTimingStats();
const retainedPrice=createRetainedPrice();
const positionReader=createVisualPositionReader();
const priceReader=createOcrSupervisor({create:()=>createPriceOcr()});
const labelReader=createOcrSupervisor({create:()=>createLabelOcr()});
const latestVisible=createLatestVisible();
const numberHints=createNumberHints();
const labelReads=createLabelReadScheduler({needsRead:meta=>numberHints.needsRead(meta)});
const chartMotion=createChartMotionReader();
const candleVision=createCandleVision();
const candleReader=createCandleReader();
const candleDisplay=createCandleDisplay({document});
const guideAdvisor=createGuideVisualAdvisor();
const guideDisplay=createGuideSignalDisplay({document});
const captureProbeControls=installCaptureProbeControls({panel:window,container:$('capture-probe-controls'),preview:canvas,detail:$('candle-detail')});
const sourceMarkerControls=installSourceMarkerControls({panel:window,container:$('source-marker-probe-controls'),detail:$('candle-detail'),getTarget:()=>shortcuts.getTarget(),getContext:()=>[ocrSession,shortcuts.getTarget()?.id??'',canvas.width,canvas.height,JSON.stringify(region)].join('|'),isMonitoring:()=>running&&!!stream,executeSource:async(tabId,func,command)=>{
  const executions=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args:[command]});
  if(executions.length!==1||!executions[0]?.result)throw Error('SOURCE_MARKER_RESPONSE_UNAVAILABLE');return executions[0].result;
}});
let guideEnabled=true;
const guideEvents=new Set();
function resetCandles(text){candleReader.reset();candleDisplay.clear(text);guideAdvisor.reset();guideDisplay.clear(text);guideEvents.clear();}
function observeCandles(image,chart,meta){
  // Reuse the clean capture and scan only the recent chart tail. No OCR,
  // frame queue, additional screen capture or per-frame pixel buffer copy.
  const width=Math.min(800,chart.width,Math.floor(1500000/Math.ceil(chart.height))),scan={x:chart.x+chart.width-width,y:chart.y,width,height:chart.height};
  const started=performance.now(),detection=candleVision.inspect(image,scan);
  const result=candleReader.inspect(detection,{...meta,geometry:meta.geometry+':'+JSON.stringify(scan)}),processingMs=performance.now()-started;
  const detailBefore=$('candle-detail').textContent;
  timing.add('candles',processingMs);candleDisplay.render(result,{capturedAt:meta.capturedAt,processingMs,diagnostics:detection.diagnostics});
  sourceMarkerControls.onFrame(image,{frameId:meta.frameId,receivedAt:meta.frameReceivedAt??started,resultRendered:detailBefore!==$('candle-detail').textContent,tracking:result.status==='TRACKING'});
  let guide={status:'DISABLED',final:false,orderEligible:false};
  if(guideEnabled){
    const guideStarted=performance.now();guide=guideAdvisor.inspect(result,meta);timing.add('guide',performance.now()-guideStarted);guideDisplay.render(guide);
    if(guide.status==='ADVISORY'&&!guideEvents.has(guide.candidateId)){
      guideEvents.add(guide.candidateId);if(guideEvents.size>128)guideEvents.delete(guideEvents.values().next().value);
      log(new Date(meta.capturedAt).toISOString()+' | GUIDE_VISUAL_ADVISORY | '+JSON.stringify(guide));
    }
  }
  return {status:result.status,reason:result.reason,active:result.active,metrics:result.metrics,stats:result.stats,ignoredHistorical:result.ignoredHistorical,ignoredHistoricalGroups:result.ignoredHistoricalGroups,detected:detection.candles.length,processingMs,guide};
}
const signalLatency=createSignalLatency();
const captureRate=createCaptureRateController();
const replayRecorder=createReplayRecorder({encode:encodeReplayPng});
const entrySignals=createEntrySignalGate();
const quantityReader=createOcrSupervisor({create:async()=>{const {createQuantityOcr}=await import('./quantity-ocr.mjs');return createQuantityOcr();}});
const quantityProof=createPositionQuantityProof();
let quantityBusy=false,quantityRequest=0,quantityLastReadAt=-Infinity,quantityIdentity=null;
function readPositionQuantity(image,position,meta){
  const box=position.boxes?.[0]?.quantityBox,key=box?quantityImageKey(image,box):null;
  if(!key||!['LONG','SHORT'].includes(position.state)){quantityIdentity=null;quantityProof.reset();return {quantity:null,quantityVerified:false};}
  const identity=meta.context+'|'+position.state+'|'+key;
  if(identity!==quantityIdentity){quantityIdentity=identity;quantityProof.reset();quantityLastReadAt=-Infinity;}
  const input={...meta,side:position.state,key},proof=quantityProof.lookup(input);
  if(!quantityBusy&&meta.capturedAt-quantityLastReadAt>=(proof.quantityVerified?1000:80)){
    let snapshot;try{snapshot=copyFrameRectToCanvas(image,box);}catch{return proof;}
    const request=++quantityRequest,session=ocrSession;quantityBusy=true;quantityLastReadAt=meta.capturedAt;
    quantityReader.recognize(snapshot).then(result=>{if(running&&session===ocrSession&&identity===quantityIdentity){quantityProof.record({...input,result});log(new Date().toISOString()+' | POSITION_QUANTITY_READ | '+JSON.stringify({quantity:result.quantity??null,side:input.side,capturedAt:input.capturedAt}));}}).catch(error=>{if(session===ocrSession)log('POSITION_QUANTITY_ERROR | '+String(error?.code??error?.message??error));}).finally(()=>{if(request===quantityRequest)quantityBusy=false;});
  }
  return proof;
}
let numberHintScope=null,numberHintRequests=[];
const BUILD=chrome.runtime.getManifest().version;
let lastPositionDiagnostic='',lastLoggedDelay=null;
let lastTelemetryAt=0,rateIntent=0,comparison=null,recordingTimer=null,exportingReplay=false;

function resetNumberHints(binding){numberHints.reset(binding);labelReads.reset(binding?{...binding,proofGeneration:numberHints.snapshot().proofGeneration}:undefined);numberHintScope=binding?binding.context+'|'+binding.geometry:null;numberHintRequests=[];}
function clearLatestArrow() { latestVisible.reset();resetNumberHints();lastKnownArrow=null; $('latest-arrow').className='latest-arrow'; $('latest-arrow-symbol').textContent='—'; $('latest-arrow-label').textContent='אין חץ ברור בגרף'; }
function showArrowNumber(arrow){
  if(!arrow)return;
  const read=labelReads.read(arrow),base=arrow.direction==='UP'?'לונג אחרון בגרף':'שורט אחרון בגרף';
  $('latest-arrow-label').textContent=base+(arrow.retained?' · נשמר מהתמונה הקודמת':'')+(read.number?' · מספר '+read.number:read.status==='unreadable'?' · המספר לא קריא':' · מזהה מספר');
}
function updateLatestArrow(candidates,image) {
  const {arrow:next}=latestVisible.observe(candidates);
  const arrow=next??(lastKnownArrow?{...lastKnownArrow,retained:true}:null);
  if(next)lastKnownArrow={...next};
  const el=$('latest-arrow');el.className='latest-arrow'+(arrow?(arrow.direction==='UP'?' up':' down'):'');
  $('latest-arrow-symbol').textContent=arrow?(arrow.direction==='UP'?'▲':'▼'):'—';
  if(arrow)showArrowNumber(arrow);else $('latest-arrow-label').textContent='ממתין לחץ ראשון';
  return arrow;
}

function updateLabelNumbers(image,candidates,display,frame){
  const task=labelReads.pick({...frame,candidates,display:display&&!display.retained?display:null,requests:numberHintRequests,proofGeneration:numberHints.snapshot().proofGeneration});
  if(display)showArrowNumber(display);
  if(!task)return;
  const started=performance.now();let snapshot;
  try{snapshot=copyFrameRectToCanvas(image,task.candidate.box);}catch(error){labelReads.fail(task);log('LABEL_SNAPSHOT_ERROR | '+String(error?.message??error));return;}
  labelReader.recognize(snapshot,task.candidate.direction,{fresh:task.fresh}).then(result=>{
    const outcome=labelReads.complete(task,result);
    if(!outcome.accepted||!running)return;
    timing.add('labelOcr',performance.now()-started);
    const hint=numberHints.record({...task.meta,result});
    if(hint){tracker?.annotateNumberHint?.({...task.candidate,numberHint:hint});log(new Date().toISOString()+' | NUMBER_HINT | '+JSON.stringify({number:hint.number,direction:task.candidate.direction,x:task.candidate.x,y:task.candidate.y,firstCapturedAt:hint.firstCapturedAt,confirmedAt:hint.confirmedAt,reason:task.reason}));}
    if(outcome.display&&lastKnownArrow)showArrowNumber(lastKnownArrow);
    if(!outcome.number)log(new Date().toISOString()+' | LABEL_OCR_UNREADABLE | reason='+task.reason);
  }).catch(error=>{const outcome=labelReads.fail(task);if(outcome.accepted&&running&&error?.code!=='OCR_RESET')log(new Date().toISOString()+' | LABEL_OCR_ERROR | '+String(error?.code??error?.message??error));});
}
function shortcutTargetChanged({previous,next}){
  cancelComparison();
  if(!stream&&!captureSession.selecting)return;
  if(previous?.id!==next?.id){captureSession.cancel('TARGET_CHANGED');stream=null;region=null;recentRegion=null;priceRegion=null;activeLayout=null;pendingLayout=null;stop('נבחרה לשונית אחרת. שתפו את הלשונית שנבחרה והתחילו מעקב מחדש.');}
  else if(running){blockShortcuts('TARGET_CHANGED');ocrSession++;ocrRequest++;ocrBusy=false;priceReader.reset();labelReader.reset();resetDigitContext();signalLatency.reset();tracker=createLiveMonitor({continuous:true});chartMotion.reset();resetCandles('לשונית הגרף השתנתה; ממתין לבסיס חדש.');clearLatestArrow();}
}
function chartContextChanged(meta){
  ocrSession++;ocrRequest++;ocrBusy=false;priceReader.reset();labelReader.reset();resetDigitContext();entrySignals.reset();tracker=createLiveMonitor({continuous:true});chartMotion.reset();resetCandles('זהות הגרף השתנתה; ממתין לבסיס חדש.');clearLatestArrow();
  log(new Date().toISOString()+' | CHART_CONTEXT_CHANGED | '+JSON.stringify(meta));
  setStatus('זהות הגרף השתנתה. ממתין לתמונות חדשות ולאימות הפוזיציה.');
}
const shortcuts=createShortcutControls({document,send:message=>chrome.runtime.sendMessage(message),isRunning:()=>running&&!!stream,onTargetChanged:shortcutTargetChanged,onChartContextChanged:chartContextChanged,log});
const frameLoop=createFrameScheduler({video,onFrame:sample,onStall:({gapMs})=>{
  if(!running||videoStalled)return;videoStalled=true;blockShortcuts('VIDEO_STALLED');resetCandles('קליטת הגרף נעצרה; ממתין לתמונה חדשה.');
  log(new Date().toISOString()+' | CAPTURE_GAP | ms='+gapMs);setStatus('ממתין לתמונת הגרף; המעקב ימשיך אוטומטית.');
},onError:error=>{resetCandles('שגיאה בקריאת התמונה; ממתין לבסיס חדש.');log(new Date().toISOString()+' | ANALYSIS_ERROR | '+String(error?.message??error));setStatus('מנסה לקרוא שוב את תמונת הגרף.');}});
const captureSession=createCaptureSession({
  request:()=>navigator.mediaDevices.getDisplayMedia({video:{frameRate:captureRate.request()},audio:false}),
  onPreparing:()=>{
    stop();stream=null;void captureRate.attach(null);video.srcObject=null;retainedPrice.clear();showRetainedPrice();
    region=null;recentRegion=null;priceRegion=null;selection='chart';$('start').disabled=true;$('auto').disabled=true;$('chart').disabled=true;$('recent').disabled=true;$('price-region').disabled=true;$('share').disabled=true;
    setStatus('ממתין לבחירת לשונית לשיתוף.');
  },
  connect:async current=>{stream=current;video.srcObject=current;void captureRate.attach(current.getVideoTracks()[0]).then(updateCaptureDisplay);await video.play();},
  onReady:()=>{warmReaders();lastLayoutProbeAt=0;paint();$('auto').disabled=false;$('chart').disabled=false;$('recent').disabled=true;$('price-region').disabled=true;setStatus('אפשר להתחיל מעקב אוטומטי.');},
  onEnded:()=>{stream=null;void captureRate.attach(null);video.srcObject=null;region=null;recentRegion=null;priceRegion=null;stop('שיתוף המסך הופסק.');},
  onError:()=>{stream=null;void captureRate.attach(null);video.srcObject=null;stop('שיתוף הגרף לא התחיל או בוטל.');},
  onSettled:()=>{$('share').disabled=captureSession.selecting;},
});
window.addEventListener('pagehide',()=>{void sourceMarkerControls.dispose();captureProbeControls.dispose();running=false;ocrSession++;cancelComparison();clearTimeout(recordingTimer);replayRecorder.cancel();chartMotion.reset();candleReader.reset();candleVision.reset();frameLoop.stop();captureSession.dispose();void captureRate.attach(null);priceReader.reset();labelReader.reset();quantityReader.reset();void shortcuts.dispose().catch(()=>{});});
function blockShortcuts(reason){if(shortcuts.isEnabled())void shortcuts.pause(reason);log(new Date().toISOString()+' | SOURCE_PAUSED | '+reason);}
async function dispatchSignal(item){
  const replyStarted=performance.now(),dispatchAt=Date.now(),signalSession=ocrSession;
  const id=item.event.signalId;lastSignalId=id;
  $('signal-state').textContent=(item.direction==='UP'?'זוהה חץ ללונג':'זוהה חץ לשורט')+' · '+new Date(item.event.confirmedAt).toLocaleTimeString('he-IL');
  $('signal-detail').textContent='ממתין לשליחת הקיצור לפי הדיליי שנבחר. תוצאת האיתות הזה תופיע כאן.';
  try{
    const latest=await shortcuts.noteLatest(item.event);
    if(signalSession!==ocrSession)return;
    const response=latest?.ok?await shortcuts.dispatch(item):latest,code=response?.code??response?.error??'NO_RESPONSE';
    if(signalSession!==ocrSession){log(new Date().toISOString()+' | STALE_SIGNAL_RESULT | id='+id+' | '+code);return;}
    if(code==='SENT_UNCONFIRMED'||code==='UNCERTAIN')timing.add('keyReply',performance.now()-replyStarted);
    if(lastSignalId===id)$('signal-detail').textContent=response?.uiText??describeShortcutOutcome(code);
    const p=response?.state?.position,last=response?.state?.last;
    const measured=signalLatency.record({id,firstSeenAt:item.event.firstSeenAt,confirmedAt:item.event.confirmedAt,dispatchAt,keyDownAt:last?.id===id?last.keyDownAt:null,replyAt:Date.now(),delayMs:last?.id===id?last.delayMs:null,code});
    if(measured)log(new Date().toISOString()+' | SIGNAL_TIMING | '+JSON.stringify(measured));
    updateTimingDisplay();
    log(new Date().toISOString()+' | SIGNAL_RESULT | id='+id+' | '+code+' | elapsedMs='+Math.round(performance.now()-replyStarted)+(p?' | position='+p.state+' | reason='+p.reason:'')+(last?.id===id?' | input='+JSON.stringify({keyDownAt:last.keyDownAt,keyUpAt:last.keyUpAt,keyDownElapsedMs:last.keyDownElapsedMs,transportSettledAt:p?.transportSettledAt??null,delayMs:last.delayMs}):''));
  }catch(error){if(signalSession!==ocrSession){log('STALE_SIGNAL_RESULT | '+id+' | '+String(error?.message??error));return;}if(lastSignalId===id)$('signal-detail').textContent='לא התקבלה תוצאת שליחה. אין ניסיון חוזר לאותו חץ.';signalLatency.record({id,firstSeenAt:item.event.firstSeenAt,confirmedAt:item.event.confirmedAt,dispatchAt,replyAt:Date.now(),code:'TRANSPORT_ERROR'});updateTimingDisplay();log('SIGNAL_RESULT | '+id+' | '+String(error?.message??error));}
}
let statusPaintAt=0;
const setStatus=(text,telemetry=false)=>{const at=performance.now();if(telemetry&&at-statusPaintAt<250)return;statusPaintAt=at;if($('status').textContent!==text)$('status').textContent=text;};
let logPaintPending=false;
function log(text){rows.push(text);if(logPaintPending)return;logPaintPending=true;setTimeout(()=>{logPaintPending=false;$('log').textContent=rows.slice(-200).join('\n');},100);}
function updateTimingDisplay() {
  const s=timing.snapshot(), part=(name,value)=>value.count ? `${name}: חציון ${value.p50} מ״ש${value.count>=20 ? `, 95% עד ${value.p95} מ״ש` : ''} (${value.count} מדידות)` : `${name}: ממתין לנתונים`;
  $('timing-status').textContent=`${part('קליטת תמונה',s.capture)} | ${part('פוזיציה',s.position)} | ${part('חצים',s.arrows)} | ${part('תנועת גרף',s.motion)} | ${part('נרות',s.candles)} | ${part('כללי המדריך',s.guide)} | ${part('עיבוד פריים',s.total)} | ${part('OCR מספר',s.labelOcr)} | ${part('OCR מחיר',s.ocr)}. הזמן אינו זמן מילוי עסקה.`;
  const latency=signalLatency.snapshot(),last=latency.last,ms=value=>Number.isFinite(value)?Math.round(value)+' ms':'—';
  $('signal-timing').textContent=last?`אישור חץ: ${ms(last.confirmationMs)} | מהאישור לבקשת מקש: ${ms(last.confirmedToKeyMs)} | מהפריים הראשון: ${ms(last.firstFrameToKeyMs)} | דיליי שנבחר: ${ms(last.delayMs)} | מעבר לדיליי: ${ms(last.beyondDelayMs)}. חציון כולל: ${ms(latency.firstFrameToKeyMs.p50)}, אחוזון 95: ${ms(latency.firstFrameToKeyMs.p95)} (${latency.attempted} בקשות). תוצאה: ${last.code}.`:'ממתין לניסיון שליחה ראשון.';
}
function updateCaptureDisplay(){
  const s=captureRate.snapshot(),r=replayRecorder.snapshot(),fps=value=>Number.isFinite(value)?value.toFixed(1):'—';
  const scheduler=frameLoop.snapshot();
  $('capture-path-status').textContent=!running?'קליטה ברקע ובמזעור תיבדק בתחילת המעקב.':scheduler.mode==='TRACK_PROCESSOR'&&!scheduler.stalled?'קליטה ישירה מהשיתוף פעילה גם כשהלוח ברקע או ממוזער. גרף המסחר חייב להישאר פעיל וממוקד.':scheduler.stalled?'לא מתקבלות תמונות חדשות. השליחה ממתינה לחידוש הקליטה.':'קליטה דרך התצוגה: הדפדפן לא הפעיל את מסלול המזעור. השאירו את הלוח גלוי בחלון נפרד.';
  $('capture-rate-status').textContent=`מבוקש: ${s.requested} FPS | מדווח מהמקור: ${fps(s.reported)} | מתקבל: ${fps(s.deliveredFps)} FPS | עיבוד פריים, אחוזון 95: ${fps(s.processingP95)} ms | פריימים שהוחמצו: ${s.missedKnown?s.missed:'לא נמדד'}.`+(s.reason==='FALLBACK_30'?' המקור לא אישר 60; הוחל 30 FPS.':s.reason==='SOURCE_BELOW_60'?' המקור מספק פחות מ־60 FPS.':s.reason==='CONSTRAINT_FAILED'?' שינוי הקצב לא אושר.':s.reason==='CONSTRAINT_TIMEOUT'?' לא התקבל אישור לשינוי הקצב; הקצב בפועל מוצג בנפרד.':s.reason==='PENDING'?' ממתין לאישור שינוי הקצב.':s.reason==='CONSTRAINT_UNAVAILABLE'?' המקור אינו מאפשר שינוי קצב במהלך השיתוף.':'');
  $('capture-compare').disabled=!running||!shortcuts.getTarget()||!!comparison||r.active||r.busy;
  $('capture-rate').disabled=!!comparison;
  $('replay-record').disabled=!running||!!comparison||r.active||r.busy;
  $('replay-download').disabled=r.frames===0||r.active||exportingReplay;
}
function updateRecordingDisplay(){
  const r=replayRecorder.snapshot();
  $('replay-status').textContent=r.active?`מקליט קטע אבחון · ${r.frames} תמונות · ${(r.bytes/1048576).toFixed(1)} MB. פריימים שדולגו בזמן קידוד: ${r.skipped}.`:r.frames?`קטע זמין להורדה · ${r.frames} תמונות · ${(r.bytes/1048576).toFixed(1)} MB · דילוגי קידוד: ${r.skipped}.`+(r.reason==='ENCODE_TIMEOUT'?' קידוד תמונה נעצר; התמונות שכבר נשמרו זמינות.':''):r.reason==='IDLE'?'טרם הוקלט קטע אבחון.':r.reason==='ENCODE_TIMEOUT'?'קידוד התמונה לא הסתיים. אפשר להמשיך במעקב; להקלטה חדשה פתחו לוח חדש.':'לא נשמרו תמונות. אפשר לנסות שוב בזמן מעקב.';
  updateCaptureDisplay();
}
function cancelComparison(){
  const current=comparison;if(!current)return;comparison=null;clearInterval(current.sourceWatch);current.controller.abort();$('capture-compare-result').textContent='ההשוואה נעצרה; נבחר מחדש הקצב שהיה לפני הבדיקה.';void captureRate.setRate(current.original).then(updateCaptureDisplay);
}
function comparisonWait(ms,signal){return new Promise((resolve,reject)=>{const fail=()=>{clearTimeout(timer);signal.removeEventListener('abort',fail);reject(Error('CANCELLED'));},timer=setTimeout(()=>{signal.removeEventListener('abort',fail);resolve();},ms);signal.addEventListener('abort',fail,{once:true});if(signal.aborted)fail();});}
async function comparisonRate(rate,signal){let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(Error('CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});try{return await Promise.race([captureRate.setRate(rate),cancelled]);}finally{signal.removeEventListener('abort',abort);}}
async function checkComparisonSource(task){
  if(comparison!==task)return;
  if(task.sourceCheck)return task.sourceCheck;
  task.sourceCheck=(async()=>{let timer;try{
    const tab=await Promise.race([chrome.tabs.get(task.target.id),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SOURCE_TIMEOUT')),1500);})]);
    if(comparison===task&&(task.stream!==stream||task.session!==ocrSession||tab?.url!==task.target.url||shortcuts.getTarget()?.id!==task.target.id))cancelComparison();
  }catch{if(comparison===task)cancelComparison();}finally{clearTimeout(timer);task.sourceCheck=null;}})();
  return task.sourceCheck;
}
async function compareRates(){
  const target=shortcuts.getTarget();if(!running||!target||comparison||replayRecorder.snapshot().active)return;
  const task={controller:new AbortController(),original:captureRate.snapshot().requested,session:ocrSession,stream,target};comparison=task;task.sourceWatch=setInterval(()=>{void checkComparisonSource(task);},1000);task.sourceWatch?.unref?.();updateCaptureDisplay();
  const samples={};
  try{
    for(const rate of [30,60]){
      await checkComparisonSource(task);if(comparison!==task)throw Error('CANCELLED');
      const applied=await comparisonRate(rate,task.controller.signal);if(comparison!==task||!running||ocrSession!==task.session)throw Error('CANCELLED');
      if(applied.applied!==rate||applied.reason!=='APPLIED')throw Error('RATE_NOT_CONFIRMED');
      $('capture-compare-result').textContent=`בודק ${rate} FPS · ההשוואה תסתיים בתוך כ־20 שניות.`;
      await comparisonWait(1000,task.controller.signal);captureRate.resetMetrics();await comparisonWait(9000,task.controller.signal);samples[rate]=captureRate.snapshot();
    }
    await checkComparisonSource(task);if(comparison!==task)throw Error('CANCELLED');
    const result=compareCaptureRates(samples[30],samples[60]),format=s=>`${s.deliveredFps?.toFixed(1)??'—'} FPS, עיבוד95 ${s.processingP95?.toFixed(1)??'—'} ms`;
    $('capture-compare-result').textContent=`30: ${format(samples[30])} | 60: ${format(samples[60])}. `+(result.recommended?`לפי המדידה מומלץ ${result.recommended} FPS.`:'לא התקבלו מספיק פריימים להשוואה.')+' ההעדפה שנבחרה לפני הבדיקה נשמרה.';
    log(new Date().toISOString()+' | CAPTURE_COMPARISON | '+JSON.stringify({samples,result}));
  }catch(error){if(comparison===task)$('capture-compare-result').textContent=error?.message==='RATE_NOT_CONFIRMED'?'המקור לא אישר את אחד מקצבי הבדיקה. לא ניתנה המלצה; חוזרים לקצב שנבחר לפני הבדיקה.':'ההשוואה נעצרה. חוזרים לקצב שנבחר לפני הבדיקה.';}
  finally{clearInterval(task.sourceWatch);if(comparison===task){comparison=null;await captureRate.setRate(task.original);updateCaptureDisplay();}}
}
function downloadFile(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function resetDigitContext(){chartEpoch++;quantityRequest++;quantityBusy=false;quantityIdentity=null;quantityProof.reset();quantityReader.reset();clearNumericPrice();}
function resetSignals() { lastSignalId=null;$('shortcut-detection').textContent='ממתין לתמונת זיהוי חדשה.'; $('signal-state').textContent='ממתין לאיתות חדש.'; $('signal-detail').textContent='חצים שכבר בגרף משמשים להשוואה.'; }
function warmReaders(){
  for(const [name,reader] of [['PRICE',priceReader],['LABEL',labelReader]])void reader.warm().catch(error=>{if(error?.code!=='OCR_RESET')log(new Date().toISOString()+' | '+name+'_OCR_INITIALIZATION_ERROR | '+String(error?.code??error?.message??error));});
}
function showRetainedPrice(confidenceText) {
  const p=retainedPrice.snapshot();
  if(p.value===null){$('price-number').textContent='—';$('price-confidence').textContent='ממתין למחיר ראשון';return;}
  $('price-number').textContent=p.value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const time=new Date(p.observedAt).toLocaleTimeString('he-IL');
  $('price-confidence').textContent=p.fresh ? 'נקרא ב־'+time+' · '+(confidenceText||'קריאה חזותית') : 'מחיר אחרון מ־'+time+' · קורא עדכון';
}
function clearNumericPrice() { currentBadgeKey='';attemptedKey='';lastOcrValue=null;priceRetryAt=0;retainedPrice.stale();showRetainedPrice(); }
function updateNumericPrice(image, badge, frameStarted) {
  const textBounds=priceTextBounds(badge,image), key=priceImageKey(image,textBounds), session=ocrSession, epoch=chartEpoch;
  if (key !== currentBadgeKey) {currentBadgeKey=key;attemptedKey='';lastOcrValue=null;priceRetryAt=0;retainedPrice.stale();showRetainedPrice();}
  if (ocrBusy || lastOcrValue !== null || attemptedKey===key&&Date.now()<priceRetryAt) return;
  attemptedKey=key;
  priceRetryAt=Date.now()+300;
  ocrBusy=true;const request=++ocrRequest;
  const snapshot=document.createElement('canvas'); snapshot.width=textBounds.width; snapshot.height=textBounds.height;
  snapshot.getContext('2d').putImageData(ctx.getImageData(textBounds.x,textBounds.y,textBounds.width,textBounds.height),0,0);
  const ocrStarted=performance.now(),observedAt=Date.now();
  priceReader.recognize(snapshot,badge.color).then(result=>{
    if (session!==ocrSession || epoch!==chartEpoch) return;
    timing.add(result.cached?'cache':'ocr',performance.now()-ocrStarted);if(!result.cached)timing.readResult(result.value!==null);
    if (!running) {timing.discarded();updateTimingDisplay();return;}
    if (result.value===null) { lastOcrValue=null; retainedPrice.stale();showRetainedPrice(); updateTimingDisplay(); return; }
    if(key===currentBadgeKey)lastOcrValue=result.value;
    retainedPrice.accept(result.value,observedAt);if(key!==currentBadgeKey)retainedPrice.stale();showRetainedPrice(priceConfidenceLabel(result.confidence));
    timing.add('display',performance.now()-frameStarted); updateTimingDisplay();
  }).catch(error=>{ if(running && session===ocrSession && epoch===chartEpoch && key===currentBadgeKey) { retainedPrice.stale();showRetainedPrice();log(new Date().toISOString()+' | PRICE_OCR_ERROR | '+String(error?.code??error?.message??error)); } }).finally(()=>{if(request===ocrRequest)ocrBusy=false;});
}
function stop(reason = 'המעקב נעצר.') {
  void shortcuts.pause(reason,{ended:true});
  cancelComparison();clearTimeout(recordingTimer);replayRecorder.stop();chartMotion.reset();resetCandles('מעקב הנרות נעצר.');
  clearLatestArrow();
  running = false;frameLoop.stop();tracker = null;entrySignals.reset();positionReader.reset();videoStalled=false;lastSignalId=null;lastPositionDiagnostic='';
  ocrSession++;ocrRequest++;ocrBusy=false;priceReader.reset();labelReader.reset();quantityRequest++;quantityBusy=false;quantityIdentity=null;quantityProof.reset();quantityReader.reset();clearNumericPrice();updateRecordingDisplay();
  $('stop').disabled = true; $('auto').disabled = !stream; $('start').disabled = !stream || !priceRegion || !validRecentRegion(region, recentRegion); $('chart').disabled = !stream; $('recent').disabled = !stream || !region; $('price-region').disabled = !stream || !recentRegion; $('price-preview').hidden = true; $('price-status').textContent = 'אין תצוגת מחיר פעילה.'; setStatus(reason);
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.round((event.clientX - rect.left) * canvas.width / rect.width), y: Math.round((event.clientY - rect.top) * canvas.height / rect.height) };
}
function paint(source=video) {
  const width=source===video?video.videoWidth:source.displayWidth,height=source===video?video.videoHeight:source.displayHeight;
  if (!stream || !Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16000000) return false;
  if (!canvas.hasAttribute('width') || canvas.width !== width || canvas.height !== height) {
    resetCandles('גודל התמונה השתנה; ממתין לבסיס חדש.');
    layoutSearchStartedAt=null;layoutWaitLogged=false;
    log(new Date().toISOString()+' | CAPTURE_DIMENSIONS | from='+canvas.width+'x'+canvas.height+' | to='+width+'x'+height);
    if (running && !autoMode) { stop('גודל התמונה השתנה. יש לסמן שוב את האזורים.'); region = null; recentRegion = null; priceRegion = null; $('start').disabled = true; $('recent').disabled = true; $('price-region').disabled = true; return false; }
    if (running && autoMode) { if(activeLayout || pendingLayout) { blockShortcuts('CAPTURE_RESIZED'); resetDigitContext(); } activeLayout = null; pendingLayout = null; pendingCount = 0; if(!autoGap) log(`${new Date().toISOString()} | GAP START | CAPTURE_RESIZED | signals may be missed`); autoGap = true; }
    canvas.width = width; canvas.height = height; region = null; recentRegion = null; priceRegion = null;
  }
  ctx.drawImage(source, 0, 0);
  return true;
}
function mark(rect, color = '#ffdc4d') { if (!rect) return; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(rect.x, rect.y, rect.width, rect.height); }
function drawRegions() { mark(region); mark(recentRegion, '#55bfff'); mark(priceRegion, '#ffffff'); }
canvas.addEventListener('pointerdown', event => { if (!stream || running) return; drag = point(event); canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => { if (!drag || !paint()) return; const p = point(event); drawRegions(); mark({ x:drag.x, y:drag.y, width:p.x-drag.x, height:p.y-drag.y }, selection === 'chart' ? '#ffdc4d' : selection === 'recent' ? '#55bfff' : '#ffffff'); });
canvas.addEventListener('pointerup', event => {
  if (!drag) return; const p = point(event); const selected = { x: Math.min(drag.x,p.x), y: Math.min(drag.y,p.y), width: Math.abs(p.x-drag.x), height: Math.abs(p.y-drag.y) }; drag = null;
  if (selected.width < 30 || selected.height < 30) { setStatus('האזור קטן מדי. סמנו שוב.'); return; }
  if (selected.x < 0 || selected.y < 0 || selected.x+selected.width > canvas.width || selected.y+selected.height > canvas.height) { setStatus('יש לסמן אזור בתוך התמונה.'); return; }
  if (selection === 'chart') { region = selected; recentRegion = null; priceRegion = null; selection = 'recent'; $('recent').disabled = false; $('price-region').disabled = true; $('start').disabled = true; setStatus('הגרף סומן. כעת סמנו בתוכו את אזור הנרות החדשים.'); }
  else if (selection === 'recent' && !validRecentRegion(region, selected)) { setStatus('אזור הנרות החדשים חייב להיות כולו בתוך הגרף. סמנו שוב.'); return; }
  else if (selection === 'recent') { recentRegion = selected; priceRegion = null; selection = 'price'; $('price-region').disabled = false; $('start').disabled = true; setStatus('סמנו את רצועת המחירים מימין לגרף, לכל גובה הגרף.'); }
  else { priceRegion = selected; $('start').disabled = false; setStatus('שלושת האזורים נבחרו. אפשר להתחיל מעקב.'); }
  paint(); drawRegions();
});
$('share').addEventListener('click',()=>{void captureSession.select();});
function sample(frame={}) {
  if(!running)return;
  const frameStarted=performance.now(),capturedAt=frame.receivedAt??Date.now();
  try{
    const captureGapMs=lastNewFrameAt?capturedAt-lastNewFrameAt:0;
    if(Number.isFinite(frame.frameNow)&&Number.isFinite(frame.metadata?.expectedDisplayTime))timing.add('callbackLate',Math.max(0,frame.frameNow-frame.metadata.expectedDisplayTime));
    if(captureGapMs>0)timing.add('frameInterval',captureGapMs);
    lastVideoTime=video.currentTime;lastNewFrameAt=capturedAt;videoStalled=false;
    if(!paint(frame.videoFrame??video)){resetCandles('ממתין לתמונת גרף תקינה.');return;}
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);timing.add('capture',performance.now()-frameStarted);
    let badge=null;
    if(autoMode){
      // Reuse a visually checked layout; full-screen discovery is only needed
      // when the existing chart boundary actually disappears.
      if(activeLayout&&!cachedLayoutStillVisible(data,activeLayout)){
        blockShortcuts('LAYOUT_CHANGED');activeLayout=null;pendingLayout=null;pendingCount=0;clearLatestArrow();resetDigitContext();resetCandles('אזור הגרף השתנה; ממתין לזיהוי מחדש.');
        layoutSearchStartedAt=null;layoutWaitLogged=false;
      }
      if(!activeLayout){
        let found=null;
        if(capturedAt-lastLayoutProbeAt>=200){found=detectAutoLayout(data);lastLayoutProbeAt=capturedAt;}
        if(pendingLayout&&cachedLayoutStillVisible(data,pendingLayout))pendingCount++;
        else if(found){pendingLayout=found;pendingCount=1;}else if(!pendingLayout){pendingCount=0;}
        if(pendingCount<2){
          if(layoutSearchStartedAt===null)layoutSearchStartedAt=capturedAt;
          const waitMs=capturedAt-layoutSearchStartedAt,longWait=waitMs>=3000;
          if(longWait&&!layoutWaitLogged){layoutWaitLogged=true;log(new Date(capturedAt).toISOString()+' | LAYOUT_WAIT | '+JSON.stringify({reason:'NO_UNAMBIGUOUS_CHART',waitMs,captureWidth:canvas.width,captureHeight:canvas.height}));}
          setStatus(longWait?'לא נמצא אזור גרף חד־משמעי. הציגו גרף יחיד בגודל מלא, או עצרו את המעקב וסמנו את האזורים ידנית.':'מאתר את אזור הגרף.');return;
        }
        activeLayout=pendingLayout;pendingLayout=null;pendingCount=0;region=activeLayout.chart;recentRegion=activeLayout.recent;priceRegion=activeLayout.price;if(!tracker)tracker=createLiveMonitor({continuous:true});
        layoutSearchStartedAt=null;layoutWaitLogged=false;
        log(new Date().toISOString()+' | LAYOUT_READY | '+JSON.stringify({captureWidth:canvas.width,captureHeight:canvas.height,chart:region,price:priceRegion,validated:activeLayout.validated===true,scale:activeLayout.scale,confidence:activeLayout.confidence}));
      }
      badge=findPriceBadge(data,priceRegion);
    }else badge=findPriceBadge(data,priceRegion);
    const target=shortcuts.getTarget(),sourceTarget=(target?.id??'')+':'+(target?.url??''),geometry=sourceTarget+':'+canvas.width+'x'+canvas.height+':'+JSON.stringify(region);
    const context=ocrSession+':'+sourceTarget,positionStarted=performance.now();
    if(numberHintScope!==context+'|'+geometry)resetNumberHints({context,geometry});
    const detectedPosition=positionReader.inspect(data,region,{context:context+':'+geometry,chartValidated:autoMode&&activeLayout.validated===true});
    const visualPosition={...detectedPosition,...readPositionQuantity(data,detectedPosition,{context:context+':'+geometry,capturedAt,frameId:frame.frameId??video.currentTime})};
    timing.add('position',performance.now()-positionStarted);
    let positionViewChanged=false;
    const publishPosition=()=>shortcuts.observePosition({...visualPosition,autoFlatProof:hasAutoFlatProof(visualPosition,{chartValidated:autoMode&&activeLayout?.validated===true,viewChanged:positionViewChanged}),viewChanged:positionViewChanged,capturedAt,frameId:frame.frameId??video.currentTime,context:context+':'+geometry}).then(response=>{
      const p=response?.state?.position;if(!p)return;
      const key=[p.state,p.held,p.pendingId,p.reason,p.lastResolution].join(':');if(key!==lastPositionDiagnostic){lastPositionDiagnostic=key;log(new Date().toISOString()+' | POSITION_STATE | '+JSON.stringify({state:p.state,observed:p.observedState,held:p.held,pendingId:p.pendingId,reason:p.reason,resolution:p.lastResolution,capturedAt:p.capturedAt,frameId:frame.frameId??video.currentTime,boxes:visualPosition.boxes,flatProof:visualPosition.flatProof===true,scan:visualPosition.scan}));}
      const delay=response?.state?.delayMs;if(Number.isFinite(delay)&&delay!==lastLoggedDelay){lastLoggedDelay=delay;log(new Date().toISOString()+' | SHORTCUT_DELAY | ms='+delay);}
    }).catch(error=>log(new Date().toISOString()+' | POSITION_UPDATE_ERROR | '+String(error?.message??error)));
    const arrowStarted=performance.now();
    const labelResult=findNumberedLabels(data,region),candidates=labelResult.candidates.map(candidate=>{
      const appearanceKey=labelTextKey(data,candidate.box,candidate.direction),numberHintQuality=inspectNumberHintQuality(data,{...candidate,appearanceKey},{bounds:region,ambiguous:labelResult.ambiguous});
      const numberHint=numberHints.lookup({...candidate,appearanceKey,key:appearanceKey,context,geometry,capturedAt,quality:numberHintQuality});
      return {...candidate,appearanceKey,numberHintQuality,...(numberHint?{numberHint}:{})};
    });
    const motionStarted=performance.now(),motion=chartMotion.inspect(data,region,{context,geometry,capturedAt}),motionMs=performance.now()-motionStarted;timing.add('motion',motionMs);
    if(!tracker)tracker=createLiveMonitor({continuous:true});
    const result=tracker.observe({capturedAt,geometry,context,candidates,bounds:region,...(motion.motion?{chartMotion:motion.motion}:{})});timing.add('arrows',Math.max(0,performance.now()-arrowStarted-motionMs));
    positionViewChanged=['GEOMETRY_CHANGED','CAPTURE_GAP','CONTEXT_CHANGED'].includes(result.baselineReason)||!!result.rebase&&(Math.abs(result.rebase.y)>.5||Math.abs(result.rebase.scaleY-1)>.002||Math.abs(result.rebase.scaleX-1)>.002)||Math.abs(motion.motion?.y??0)>.5;
    void publishPosition();
    if(result.rebase||result.baselineReason)resetNumberHints({context,geometry});
    numberHintRequests=result.numberHintRequests??[];
    if(result.rebase)log(new Date().toISOString()+' | TRACKING_REBASE | '+JSON.stringify(result.rebase));
    // Observe all labels for diagnostics, but only the fresh, uniquely latest
    // arrow is eligible for entry. Consume rejected IDs instead of queuing them.
    const entryResult=entrySignals.observe({capturedAt,context,geometry,candidates,events:result.events??[],motion:result.motion,trackingReason:result.reason,baselineReason:result.baselineReason,rebase:result.rebase});
    for(const event of result.events??[]){
      log(new Date(event.confirmedAt).toISOString()+' | NEW_ARROW | '+event.direction+' | id='+event.signalId+' | frame='+String(frame.frameId??video.currentTime)+' | x='+event.x+' | y='+event.y+' | firstSeenAt='+event.firstSeenAt+' | geometry='+geometry);
    }
    for(const {event,reason} of entryResult.skipped)log(new Date(capturedAt).toISOString()+' | ARROW_ENTRY_SKIPPED | id='+event?.signalId+' | reason='+reason+' | x='+event?.x+' | firstSeenAt='+event?.firstSeenAt);
    if(entryResult.allowed.length||entryResult.skipped.length){
      const labels={NOT_LATEST_AT_APPEARANCE:'החץ לא היה האחרון כשהופיע',NOT_LATEST_VISIBLE:'קיים חץ מאוחר יותר',BEHIND_LATEST_HISTORY:'החץ נמצא מאחורי החץ האחרון שנראה',VISUAL_ALREADY_SEEN:'תווית שכבר נראתה באותו מקום',STALE_OR_PREBASELINE:'החץ ישן או שייך לבסיס הקודם',DUPLICATE_EVENT:'החץ כבר טופל',AMBIGUOUS_LATEST_EVENTS:'יש כמה מועמדים לאותו איתות',EVENT_MEMORY_LIMIT:'זיכרון האיתותים מלא — יש להתחיל מעקב חדש',QUIET_BASELINE:'נקבע בסיס שקט ללא כניסה'};
      $('entry-filter-status').textContent=entryResult.allowed.length?'החץ האחרון עבר את הסינון. שליחה עדיין מותנית באימות הפוזיציה והמיקוד.':'כניסה דולגה: '+entryResult.skipped.map(s=>labels[s.reason]??'ראיות הזיהוי אינן מספיקות').join('; ');
    }
    for(const event of entryResult.allowed)void dispatchSignal({event,direction:event.direction,state:'CANDIDATE'});
    // Candle observations never enter the arrow or keyboard authorization path.
    const candleObservation=observeCandles(data,region,{context,geometry,capturedAt,motion:motion.motion,frameReceivedAt:frameStarted,frameId:frame.frameId??video.currentTime});
    const selectedArrow=updateLatestArrow(candidates,data);
    updateLabelNumbers(data,candidates,selectedArrow,{context,geometry,capturedAt,frameId:frame.frameId??video.currentTime});
    if(replayRecorder.snapshot().active)replayRecorder.offer(data,{context,geometry,capturedAt,frameId:frame.frameId??video.currentTime,region,chartValidated:autoMode&&activeLayout?.validated===true,observations:{candles:candleObservation,position:visualPosition.state,quantity:visualPosition.quantity,quantityVerified:visualPosition.quantityVerified,entryAllowed:entryResult.allowed.map(e=>e.signalId),entrySkipped:entryResult.skipped.map(s=>({id:s.event.signalId,reason:s.reason})),events:(result.events??[]).map(e=>({id:e.signalId,direction:e.direction,x:e.x,y:e.y,firstSeenAt:e.firstSeenAt,confirmedAt:e.confirmedAt}))}});
    const pricePreview=$('price-preview');
    if(badge){
      pricePreview.width=badge.width;pricePreview.height=badge.height;pricePreview.getContext('2d').putImageData(ctx.getImageData(badge.x,badge.y,badge.width,badge.height),0,0);pricePreview.hidden=false;
      $('price-status').textContent='תג המחיר מתעדכן ברקע.';updateNumericPrice(data,badge,frameStarted);
    }else{$('price-status').textContent='מוצגת קריאת המחיר האחרונה.';pricePreview.hidden=true;}
    drawRegions();
    for(const candidate of candidates){ctx.strokeStyle=candidate.direction==='UP'?'#ffeb3b':'#ed7dff';ctx.lineWidth=2;ctx.strokeRect(candidate.x-10,candidate.y-10,20,20);}
    if(capturedAt-lastTelemetryAt>=500){
      $('shortcut-detection').textContent='תמונה: '+canvas.width+'×'+canvas.height+' | גרף: '+region.width+'×'+region.height+' | חצים: '+candidates.length+' | חדשים: '+(result.events?.length??0)+' | עברו סינון כניסה: '+entryResult.allowed.length+' | פוזיציה חזותית: '+visualPosition.state+' | פער צילום: '+captureGapMs+' ms. סיבת פסילת חץ נרשמת באבחון.';
      const waiting=numberHintRequests.length,blocked=candidates.filter(c=>c.numberHintQuality?.complete===false).length;
      $('identity-status').textContent=`אימותי החלפה ממתינים: ${waiting} | תוויות חלקיות או מוסתרות: ${blocked} | קריאת מספר: ${labelReads.snapshot().busy?'בפעולה':'זמין'}. `+(motion.motion?`תנועת גרף אומתה: ${motion.motion.x}, ${motion.motion.y} פיקסלים.`:'תנועת הנרות אינה חד־משמעית; המעקב נעזר בעוגני החצים.');
    }
    setStatus('מעקב פעיל | חצים בתמונה: '+candidates.length+' | זמן זיהוי: '+Math.round(performance.now()-frameStarted)+' ms',true);
  }catch(error){resetCandles('קריאת הנרות הופסקה; ממתין לבסיס חדש.');log(new Date().toISOString()+' | ANALYSIS_ERROR | '+String(error?.message??error));setStatus('מנסה לקרוא שוב את תמונת הגרף.');}
  finally{
    // Layout discovery can return before candle analysis. Keep receipt and
    // processing telemetry live on that path too, using the same 500 ms budget.
    if(running&&capturedAt-lastTelemetryAt>=500){
      lastTelemetryAt=capturedAt;updateTimingDisplay();
      const recording=replayRecorder.snapshot();
      if(recording.active||recording.busy)updateRecordingDisplay();else updateCaptureDisplay();
    }
    // Include synchronous telemetry painting in the complete frame duration.
    const processingMs=performance.now()-frameStarted;timing.add('total',processingMs);captureRate.observe({at:capturedAt,processingMs,presentedFrames:frame.metadata?.presentedFrames});
  }
}

$('chart').addEventListener('click', () => { if (!stream || running) return; selection = 'chart'; setStatus('סמנו מחדש את שטח הגרף.'); });
$('recent').addEventListener('click', () => { if (!stream || running || !region) return; selection = 'recent'; setStatus('סמנו בתוך הגרף את אזור הנרות החדשים.'); });
$('price-region').addEventListener('click', () => { if (!stream || running || !recentRegion) return; selection = 'price'; setStatus('סמנו את רצועת המחירים מימין לגרף, לכל גובה הגרף.'); });
function beginObservation(automatic){
  if(!stream||!automatic&&(!priceRegion||!validRecentRegion(region,recentRegion)))return;
  layoutSearchStartedAt=null;layoutWaitLogged=false;
  frameLoop.stop();ocrSession++;entrySignals.reset();positionReader.reset();chartMotion.reset();resetCandles();signalLatency.reset();captureRate.resetMetrics();lastPositionDiagnostic='';lastLoggedDelay=null;lastTelemetryAt=0;clearLatestArrow();
  timing=createTimingStats();updateTimingDisplay();resetSignals();autoMode=automatic;
  if(automatic){activeLayout=null;pendingLayout=null;pendingCount=0;autoGap=false;usingCachedLayout=false;}
  tracker=createLiveMonitor({continuous:true});lastVideoTime=-1;lastNewFrameAt=0;running=true;
  $('auto').disabled=true;$('chart').disabled=true;$('recent').disabled=true;$('price-region').disabled=true;$('start').disabled=true;$('stop').disabled=false;
  const track=stream.getVideoTracks()[0],settings=track?.getSettings?.()??{};
  log(new Date().toISOString()+' | START | '+(automatic?'automatic observation':'manual observation')+' | build='+BUILD+' | capture='+JSON.stringify(settings)+' | scheduler='+frameLoop.snapshot().mode);
  frameLoop.start();
  updateCaptureDisplay();
}
$('auto').addEventListener('click',()=>beginObservation(true));
$('start').addEventListener('click',()=>beginObservation(false));
$('stop').addEventListener('click', () => { log(`${new Date().toISOString()} | STOP`); stop(); });
$('guide-enabled').addEventListener('change',()=>{
  guideEnabled=$('guide-enabled').checked;guideAdvisor.reset();guideEvents.clear();guideDisplay.clear(guideEnabled?'ממתין לתמונת נרות חדשה.':'מועמדי המדריך כבויים.');
  void chrome.storage.local.set({guideVisualEnabled:guideEnabled}).catch(()=>{});
});
const guideLoadIntent=$('guide-enabled').checked;
void chrome.storage.local.get('guideVisualEnabled').then(saved=>{
  if($('guide-enabled').checked!==guideLoadIntent||typeof saved.guideVisualEnabled!=='boolean')return;
  guideEnabled=saved.guideVisualEnabled;$('guide-enabled').checked=guideEnabled;if(!guideEnabled)guideDisplay.clear('מועמדי המדריך כבויים.');
}).catch(()=>{});
$('capture-rate').addEventListener('change',()=>{
  const rate=Number($('capture-rate').value);if(!validCaptureRate(rate))return;
  rateIntent++;cancelComparison();void captureRate.setRate(rate).then(updateCaptureDisplay);
  void chrome.storage.local.set({[CAPTURE_RATE_KEY]:rate}).catch(()=>{$('capture-rate-status').textContent='הקצב הוחל להפעלה הנוכחית; שמירת ההגדרה נכשלה.';});
});
const rateLoadIntent=rateIntent;
void chrome.storage.local.get(CAPTURE_RATE_KEY).then(saved=>{if(rateIntent!==rateLoadIntent||!validCaptureRate(saved[CAPTURE_RATE_KEY]))return;$('capture-rate').value=String(saved[CAPTURE_RATE_KEY]);return captureRate.setRate(saved[CAPTURE_RATE_KEY]).then(updateCaptureDisplay);}).catch(()=>{});
$('capture-compare').addEventListener('click',()=>{void compareRates();});
$('replay-record').addEventListener('click',()=>{
  if(!running||comparison||replayRecorder.snapshot().busy)return;
  try{replayRecorder.start({build:BUILD,fpsRequested:captureRate.snapshot().requested});clearTimeout(recordingTimer);recordingTimer=setTimeout(()=>{replayRecorder.stop('COMPLETE');void replayRecorder.flush().then(updateRecordingDisplay);},3000);updateRecordingDisplay();}catch{updateRecordingDisplay();}
});
$('replay-download').addEventListener('click',()=>{if(exportingReplay)return;exportingReplay=true;updateCaptureDisplay();void replayRecorder.export().then(clip=>{if(clip.frames.length)downloadFile(JSON.stringify(clip),'arrow-replay-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json','application/json');updateRecordingDisplay();}).catch(()=>{$('replay-status').textContent='הקטע הוחלף. הקליטו קטע חדש.';}).finally(()=>{exportingReplay=false;updateCaptureDisplay();});});
$('download').addEventListener('click',()=>{const content=[...rows,`${new Date().toISOString()} | TIMING_SUMMARY | ${JSON.stringify(timing.snapshot())} | scheduler=${JSON.stringify(frameLoop.snapshot())} | excludes delay before frame receipt`,`${new Date().toISOString()} | SIGNAL_LATENCY_SUMMARY | ${JSON.stringify(signalLatency.snapshot())}`,`${new Date().toISOString()} | CAPTURE_RATE_SUMMARY | ${JSON.stringify(captureRate.snapshot())}`,`${new Date().toISOString()} | READER_SUMMARY | ${JSON.stringify({price:priceReader.snapshot(),label:labelReader.snapshot(),labelSchedule:labelReads.snapshot(),capture:captureSession.snapshot()})}`];downloadFile(content.join('\n'),'arrow-observation.txt','text/plain;charset=utf-8');});
