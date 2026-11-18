import {analyzeGuideSignals,GUIDE_SIGNAL_VERSION,GUIDE_SIGNAL_DEFAULTS,GUIDE_ALL_SCENARIO_CONTEXT} from './guide-signal-engine.mjs';
import {DEFAULT_PATTERN_CONFIG,PATTERN_DEFINITION_VERSION} from './candle-patterns.mjs';
import {DEFAULT_CONTEXT_CONFIG,CONTEXT_DEFINITION_VERSION} from './market-context.mjs';
import {evaluateSignalExcursions} from './guide-risk.mjs';
import {parseGuideImport,parseGuideTime,GuideImportError} from './guide-import.mjs';

const $=id=>document.getElementById(id);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const PAGE_SIZE=40;
let loadedDocument=null,lastRun=null,ledgerRows=[],page=0,fileGeneration=0,analysisGeneration=0,busy=false;
const patternNames={DOJI:'דוג׳י',DRAGONFLY_DOJI:'דוג׳י שפירית',GRAVESTONE_DOJI:'דוג׳י מצבה',HAMMER_SHAPE:'צורת פטיש',SHOOTING_STAR_SHAPE:'צורת כוכב נופל',BULLISH_PIN_SHAPE:'Pin Bar שורי',BEARISH_PIN_SHAPE:'Pin Bar דובי',BULLISH_ENGULFING:'בליעה שורית',BEARISH_ENGULFING:'בליעה דובית',ENGULFING_BULLISH:'בליעה שורית',ENGULFING_BEARISH:'בליעה דובית',BULLISH_HARAMI:'Harami שורי',BEARISH_HARAMI:'Harami דובי',HARAMI_BULLISH:'Harami שורי',HARAMI_BEARISH:'Harami דובי',HARAMI_CROSS:'Harami Cross',TWEEZER_BOTTOM:'פינצטה תחתונה',TWEEZER_TOP:'פינצטה עליונה',MORNING_STAR:'כוכב בוקר',EVENING_STAR:'כוכב ערב',INSIDE_BAR:'נר פנימי',OUTSIDE_BAR:'נר חיצוני',INSIDE_BREAKOUT:'פריצת Mother Bar',INSIDE_FALSE_BREAK:'פריצת שווא של Inside Bar',INSIDE_FALSE_BREAK_BULLISH:'פריצת שווא שורית',INSIDE_FALSE_BREAK_BEARISH:'פריצת שווא דובית'};
const statusNames={CONFIRMED:'מאושר בכללי המחקר',ARMED:'ממתין לאישור',REJECTED:'נפסל',EXPIRED:'פג תוקף',INVALIDATED:'בוטל',AMBIGUOUS:'עמום'};
const contextNames={TREND_UP:'מגמה עולה',TREND_DOWN:'מגמה יורדת',RANGE:'טווח מוגדר',TRANSITION:'מעבר / מבנה מעורב',UNKNOWN:'לא מוגדר',UNDEFINED:'לא מוגדר',UPTREND:'מגמה עולה',DOWNTREND:'מגמה יורדת'};
const reasonNames={
  VERIFIED_OHLC_REQUIRED:'נדרש מקור OHLC מוצהר',STANDARD_CANDLES_REQUIRED:'נדרשים נרות רגילים',INSTRUMENT_TIMEFRAME_REQUIRED:'חסרים נכס או טיימפריים',TICK_SIZE_REQUIRED:'חסר גודל טיק',TIMEFRAME_DURATION_REQUIRED:'חסר משך נר',SESSION_TIMEZONE_REQUIRED:'חסרים Session או אזור זמן',INVALID_TIMEZONE:'אזור הזמן אינו תקין',BAR_COUNT_LIMIT:'מספר הנרות מחוץ למגבלה',INVALID_OHLC:'נתוני OHLC אינם תקינים',INVALID_BAR_TIMES:'זמני הנרות אינם תקינים',INVALID_AVAILABILITY_TIME:'זמן זמינות הנתונים אינו תקין',UNVERIFIED_BAR_CLOSE:'סגירת נר לא אומתה',UNDECLARED_DATA_GAP:'יש פער נתונים שלא הוגדר כסגירת שוק',NO_CLOSED_AVAILABLE_BARS:'אין נרות סגורים שהיו זמינים בזמן ההחלטה',MISSING_STRUCTURE:'אין מבנה שוק מתאים לפני התבנית',MISSING_KNOWN_LOCATION:'אין אזור מחיר מתאים שהיה ידוע מראש',MISSING_EMA:'מסנן EMA לא התקיים',MISSING_FIB:'אין התאמה לרמת פיבונאצ׳י ידועה',MISSING_TRENDLINE:'אין התאמה לקו מגמה ידוע',MISSING_SUPPLY_DEMAND:'אין אזור היצע / ביקוש מתאים',MISSING_HIGHER_TIMEFRAME:'אין התאמה לטיימפריים גבוה זמין',INSUFFICIENT_CONDITIONS:'מספר התנאים שהתקיימו קטן מהנדרש',LATER_CLOSED_BAR_CONFIRMED:'נר סגור מאוחר אישר מעבר לרמה',CONFIRMATION_EXPIRED:'האישור לא התקבל בתוך חלון התוקף',CLOSE_BEYOND_INVALIDATION:'סגירה מעבר לרמת ביטול המערך',RISK_REJECTED:'תוכנית הסיכון נפסלה',RISK_PARAMETERS_REQUIRED:'חסרים פרמטרים לחישוב סיכון',RISK_BUDGET_BELOW_ONE_CONTRACT:'התקציב אינו מאפשר אפילו חוזה אחד',INSTRUMENT_METADATA_REQUIRED:'חסרים מפרט טיק וערך נקודה מפורשים',EXPLICIT_RISK_CONFIGURATION_REQUIRED:'חסרות הנחות סיכון ועלויות מפורשות',INSUFFICIENT_REWARD_RISK:'יחס הסיכוי לסיכון קטן מהנדרש',STRUCTURAL_ROOM_INSUFFICIENT:'אין די מקום עד המכשול המבני',OBSTACLE_BEFORE_TARGET:'מכשול ידוע נמצא לפני היעד',DAILY_RISK_EXHAUSTED:'תקציב הסיכון היומי שנותר אפס',CONSECUTIVE_LOSS_LIMIT:'הושגה מגבלת הפסדים רצופים',CONFLICTING_CONFIRMED_DIRECTIONS:'אושרו שני כיוונים מנוגדים באותו זמן',STOP_NOT_ON_PROTECTIVE_SIDE:'הסטופ אינו בצד המגן של הכניסה',TARGET_NOT_ON_PROFIT_SIDE:'היעד אינו בצד הרצוי של הכניסה',ENTRY_REPRICED:'הסיכון חושב מחדש לפי מחיר כניסה שסופק',FULL_HORIZON_NOT_AVAILABLE:'טרם חלף כל חלון מדידת התנועה',FUTURE_BARS_NOT_CLOSED_OR_AVAILABLE:'נרות חלון המדידה עדיין פתוחים או לא זמינים',UNACKNOWLEDGED_DATA_GAP:'פער זמן במדידת התנועה דורש הגדרה מפורשת',BAR_STRADDLES_CONFIRMATION:'נר המדידה חוצה את זמן האישור; סדר התנועה אינו ידוע',REFERENCE_PRICE_REQUIRED:'חסר מחיר ייחוס למדידת התנועה',CLOSE_TIME_DERIVED_FROM_DECLARED_TIMEFRAME:'סוף הנר חושב ממשך הטיימפריים שהוצהר',AVAILABILITY_ASSUMED_AT_BAR_CLOSE:'זמינות הנתונים הוגדרה בסגירת הנר',CSV_CLOSE_FLAGS_FROM_EXPLICIT_USER_CONFIRMATION:'סגירת נרות ה־CSV מבוססת על האישור המפורש שלכם',NOT_REALIZED_PNL:'זהו מדד תנועה ולא רווח ממומש',INTRABAR_ORDER_UNKNOWN:'סדר התנועה בתוך הנר אינו ידוע',INVALID_CONTEXT_CONFIG:'הגדרות ההקשר אינן תקינות',OPEN_BAR:'נר פתוח אינו כשיר לאישור סופי'};
const reasonText=code=>reasonNames[code]??`תנאי מחקר: ${String(code)}`;
const directions={LONG:'לונג',SHORT:'שורט'};
const number=value=>Number.isFinite(value)?new Intl.NumberFormat('he-IL',{maximumFractionDigits:6}).format(value):'—';
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function showStatus(id,text,state=''){const node=$(id);node.textContent=text;node.dataset.state=state;}
function download(value,name,type='application/json'){
  const content=typeof value==='string'?value:JSON.stringify(value,null,2),url=URL.createObjectURL(new Blob([content],{type})),a=element('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function timestamp(value){
  if(!Number.isFinite(value))return '—';
  try{return new Intl.DateTimeFormat('he-IL',{timeZone:lastRun?.input.metadata.timezone??'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(value);}catch{return new Date(value).toISOString();}
}
function numericInput(id,{required=false,integer=false}={}){
  const raw=$(id).value.trim();
  if(!raw){if(required)throw Error(`חסר ערך: ${$(id).closest('label')?.childNodes[0]?.textContent?.trim()??id}`);return undefined;}
  const value=Number(raw);
  if(!Number.isFinite(value)||integer&&!Number.isSafeInteger(value))throw Error(`ערך מספרי אינו תקין: ${id}`);
  return value;
}
function formMetadata(){
  const source=loadedDocument?.metadata??{};
  return {...source,source:'ohlc',instrument:$('instrument').value.trim(),timeframe:$('timeframe').value.trim(),timeframeMs:numericInput('timeframe-ms',{required:true,integer:true}),tickSize:numericInput('tick-size',{required:true}),timezone:$('timezone').value.trim(),session:$('session').value.trim(),chartType:$('chart-type').value};
}
function riskFromForm(){
  const mapping={pointValue:'point-value',riskBudget:'risk-budget',commissionPerContract:'commission',slippageTicks:'slippage',maxContracts:'max-contracts',rewardRisk:'reward-risk',minRewardRisk:'min-reward-risk',dailyRiskRemaining:'daily-risk',consecutiveLosses:'loss-count',maxConsecutiveLosses:'loss-limit'};
  const values={...loadedDocument?.risk};
  for(const [key,id] of Object.entries(mapping))values[key]=numericInput(id,{integer:['maxContracts','consecutiveLosses','maxConsecutiveLosses'].includes(key)});
  return ['pointValue','riskBudget','commissionPerContract','slippageTicks','maxContracts'].some(key=>values[key]!==undefined)?values:null;
}
function configFromForm(){
  const config={...GUIDE_SIGNAL_DEFAULTS,...loadedDocument?.config,expiryBars:numericInput('expiry-bars',{required:true,integer:true}),insideExpiryBars:numericInput('inside-expiry-bars',{required:true,integer:true}),minConditions:numericInput('min-conditions',{required:true,integer:true}),confirmationBufferTicks:numericInput('confirmation-buffer',{required:true})};
  const checks={requireLocation:'require-location',requireRisk:'require-risk',requireEma:'require-ema',requireFib:'require-fib',requireTrendline:'require-trendline',requireSupplyDemand:'require-supply-demand',requireHigherTimeframe:'require-higher-timeframe'};
  for(const [key,id] of Object.entries(checks))config[key]=$(id).checked;
  return config;
}
function fillForm(document){
  const meta=document.metadata,fields={instrument:'instrument',timeframe:'timeframe',timeframeMs:'timeframe-ms',tickSize:'tick-size',timezone:'timezone',session:'session'};
  for(const [key,id] of Object.entries(fields))$(id).value=meta[key]??'';
  $('chart-type').value=['standard','heikin_ashi'].includes(meta.chartType)?meta.chartType:meta.chartType==='candles'?'standard':'other';
  const risk=document.risk??{},riskFields={pointValue:'point-value',riskBudget:'risk-budget',commissionPerContract:'commission',slippageTicks:'slippage',maxContracts:'max-contracts',rewardRisk:'reward-risk',minRewardRisk:'min-reward-risk',dailyRiskRemaining:'daily-risk',consecutiveLosses:'loss-count',maxConsecutiveLosses:'loss-limit'};
  for(const [key,id] of Object.entries(riskFields))$(id).value=risk[key]??(key==='rewardRisk'?2:key==='minRewardRisk'?1:'');
  const config={...GUIDE_SIGNAL_DEFAULTS,...document.config},configuration={expiryBars:'expiry-bars',insideExpiryBars:'inside-expiry-bars',minConditions:'min-conditions',confirmationBufferTicks:'confirmation-buffer'};
  for(const [key,id] of Object.entries(configuration))$(id).value=config[key];
  for(const [key,id] of Object.entries({requireLocation:'require-location',requireRisk:'require-risk',requireEma:'require-ema',requireFib:'require-fib',requireTrendline:'require-trendline',requireSupplyDemand:'require-supply-demand',requireHigherTimeframe:'require-higher-timeframe'}))$(id).checked=config[key];
  $('advanced-config').value=JSON.stringify({patternConfig:document.patternConfig??{},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,...document.contextConfig},higherTimeframes:document.higherTimeframes??{}},null,2);
  $('as-of-time').value='';riskModeNote();
}
function riskModeNote(){
  $('risk-mode-note').textContent=$('require-risk').checked?'תוכנית סיכון תקינה נדרשת לאיתות מאושר. מספר תנאים שהתקיימו אינו הסתברות לרווח.':'בדיקת סיכון אינה תנאי חובה לפי הבחירה שלכם. איתות מחקרי אינו אישור להתאמה לתקציב, ומספר תנאים אינו הסתברות לרווח.';
}
function clearResults(message='טרם נותחו נתונים.'){
  lastRun=null;ledgerRows=[];page=0;$('export-results').disabled=true;
  for(const id of ['stat-bars','stat-patterns','stat-confirmed','stat-rejected'])$(id).textContent='—';
  $('market-context').textContent='מצב השוק יופיע לאחר הניתוח.';$('latest-signal').textContent='איתות מאושר אחרון בקובץ יופיע כאן.';$('latest-signal').removeAttribute('data-direction');$('quality-status').textContent=message;
  $('event-rows').replaceChildren();const row=element('tr'),cell=element('td',message);cell.colSpan=5;row.append(cell);$('event-rows').append(row);
  $('page-status').textContent='—';$('previous-page').disabled=true;$('next-page').disabled=true;$('technical-result').textContent=message;
}
function markAnalysisDirty(){analysisGeneration++;clearResults('ההגדרות השתנו; נדרש ניתוח מחדש.');showStatus('analysis-status','ההגדרות השתנו; נתחו שוב כדי לקבל תוצאה התואמת להן.');}
function importCurrent(){
  analysisGeneration++;clearResults();
  try{
    const format=$('import-format').value,text=$('input-text').value,isCsv=format==='csv'||format==='auto'&&!/^[\s\uFEFF]*[\[{]/.test(text);
    const parsed=parseGuideImport(text,{format,metadata:isCsv?formMetadata():undefined,closedBarsConfirmed:$('csv-closed-confirmed').checked,delimiter:$('csv-delimiter').value==='tab'?'\t':$('csv-delimiter').value});
    loadedDocument=parsed;fillForm(parsed);$('analyze').disabled=false;
    $('sample-banner').hidden=parsed.metadata.synthetic!==true&&parsed.provenance?.kind!=='synthetic';
    $('input-summary').textContent=`${parsed.importInfo.bars} נרות · ${parsed.importInfo.closedBars} מסומנים כסגורים · ${parsed.importInfo.format.toUpperCase()}`;
    const warnings=parsed.importInfo.warnings.map(reasonText);
    showStatus('import-status',`נטענו ${parsed.bars.length} נרות. בדקו את פרטי המקור וההגדרות לפני ניתוח.${warnings.length?'\n'+warnings.join(' · '):''}`,'ok');
    showStatus('analysis-status','הנתונים נטענו. אפשר לבדוק את ההגדרות ולהתחיל ניתוח.');
  }catch(error){loadedDocument=null;$('analyze').disabled=true;$('input-summary').textContent='הייבוא לא הושלם';showStatus('import-status',formatError(error),'error');showStatus('analysis-status','הניתוח ממתין לנתונים תקינים.');}
}
function formatError(error){return error instanceof GuideImportError?`${error.message}${error.row!==null?' שורה / נר '+error.row:''} (${error.code})`:String(error?.message??error);}

export function createSyntheticGuideDocument(){
  const closes=[105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105],start=Date.parse('2026-01-01T00:00:00Z'),duration=60000;
  const bars=closes.map((close,index)=>({time:start+index*duration,closeTime:start+(index+1)*duration,open:close,high:close+1,low:close-1,close,closed:true}));
  for(const [open,high,low,close] of [[100.5,101.25,98.75,101],[101.25,102.5,101,102]]){const index=bars.length;bars.push({time:start+index*duration,closeTime:start+(index+1)*duration,open,high,low,close,closed:true});}
  return {provenance:{kind:'synthetic',description:'מחירים ונתוני חוזה סינתטיים להמחשת הכללים בלבד; אין זו היסטוריית מסחר או תוצאת בק־טסט אמיתי.'},metadata:{source:'ohlc',instrument:'SYNTHETIC_DEMO',timeframe:'1m',timeframeMs:duration,tickSize:.25,timezone:'Asia/Jerusalem',session:'synthetic',chartType:'standard',synthetic:true},
    risk:{pointValue:20,riskBudget:100,commissionPerContract:0,slippageTicks:0,maxContracts:2,rewardRisk:2,minRewardRisk:1},config:{...GUIDE_SIGNAL_DEFAULTS},patternConfig:{},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT},higherTimeframes:{},bars};
}
function advancedOptions(){
  let value;try{value=JSON.parse($('advanced-config').value);}catch{throw Error('הגדרות מתקדמות חייבות להיות JSON תקין.');}
  if(!plain(value)||Object.keys(value).some(key=>!['patternConfig','contextConfig','higherTimeframes'].includes(key)))throw Error('ההגדרות המפורטות תומכות רק ב־patternConfig, contextConfig ו־higherTimeframes.');
  for(const key of ['patternConfig','contextConfig','higherTimeframes'])if(value[key]!==undefined&&!plain(value[key]))throw Error(`${key} חייב להיות אובייקט JSON.`);
  return {patternConfig:value.patternConfig??{},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,...value.contextConfig},higherTimeframes:value.higherTimeframes??{}};
}
function excursionFor(event,bars,horizon,asOf){
  if(event.status!=='CONFIRMED'||!Number.isFinite(event.confirmationClose))return null;
  return evaluateSignalExcursions(bars.map(bar=>({...bar,openTime:bar.time,availableAt:bar.knownAt??bar.closeTime})),{direction:event.direction,confirmedAt:event.confirmedAt,referencePrice:event.confirmationClose},
    {horizonBars:horizon,reference:'event',asOf});
}
async function analyze(){
  if(!loadedDocument||busy)return;
  const token=++analysisGeneration;busy=true;$('analyze').disabled=true;clearResults('מנתח את הנתונים…');showStatus('analysis-status','מחשב צורות, הקשר ואישורים מנרות סגורים בלבד.');
  try{
    await new Promise(resolve=>setTimeout(resolve,0));
    const metadata=formMetadata(),config=configFromForm(),risk=riskFromForm(),advanced=advancedOptions(),asOfText=$('as-of-time').value.trim(),asOfTime=asOfText?parseGuideTime(asOfText):Date.now(),horizon=numericInput('excursion-horizon',{required:true,integer:true});
    if(horizon<1||horizon>10000)throw Error('חלון MFE / MAE חייב להכיל בין 1 ל־10000 נרות.');
    if(config.requireSupplyDemand)advanced.contextConfig={...advanced.contextConfig,supplyDemandEnabled:true};
    // Revalidate amended metadata and keep original per-bar close declarations.
    const input=parseGuideImport(JSON.stringify({...loadedDocument,metadata,risk,config,...advanced}));
    const started=performance.now(),result=analyzeGuideSignals(input.bars,{metadata,risk,config,...advanced,asOfTime});
    const evaluations=Object.fromEntries((result.signals??[]).map(event=>[event.eventId,excursionFor(event,input.bars,horizon,asOfTime)]));
    const processingMs=performance.now()-started;
    if(token!==analysisGeneration)return;
    lastRun={schemaVersion:1,kind:'GUIDE_SIGNAL_RESEARCH',exportScope:'Loaded historical/synthetic data, never orders or realized trading results',input,decisionTime:asOfTime,excursionHorizon:horizon,analysis:result,excursions:evaluations,processingMs,analyzedAt:new Date().toISOString()};
    renderResult();$('export-results').disabled=false;
    const statuses={SIGNALS:'נמצאו איתותים מאושרים בכללי המחקר.',WAITING_CONFIRMATION:'יש מערכים הממתינים לנר אישור סגור.',NO_SIGNAL:'אין איתות מאושר לפי ההגדרות.',BLOCKED:'הניתוח חסום עקב איכות נתונים או הגדרות.',WAITING:'ממתין לנרות סגורים שהיו זמינים בזמן ההחלטה.'};
    showStatus('analysis-status',`${statuses[result.status]??'הניתוח הסתיים.'} זמן חישוב מקומי: ${processingMs.toFixed(1)} ms. אין שליחת פקודות.`,result.status==='BLOCKED'?'error':'ok');
  }catch(error){if(token===analysisGeneration){clearResults('הניתוח לא הושלם.');showStatus('analysis-status',formatError(error),'error');}}
  finally{busy=false;$('analyze').disabled=!loadedDocument;}
}
function renderResult(){
  const result=lastRun.analysis;
  $('definition-version').textContent=result.definitionVersion??GUIDE_SIGNAL_VERSION;
  $('stat-bars').textContent=String(result.stats?.closedBars??0);$('stat-patterns').textContent=String(result.stats?.patterns??0);$('stat-confirmed').textContent=String(result.signals?.length??0);$('stat-rejected').textContent=String(result.stats?.rejected??0);
  const state=result.context?.state??'UNKNOWN';$('market-context').textContent=`מצב השוק בקצה הנתונים הזמינים: ${contextNames[state]??state}. נכס: ${lastRun.input.metadata.instrument} · ${lastRun.input.metadata.timeframe}.`;
  const latest=result.signals?.at(-1);$('latest-signal').textContent=latest?`איתות מאושר אחרון בקובץ: ${directions[latest.direction]??latest.direction} · ${timestamp(latest.confirmedAt)}`:'אין איתות מאושר בקובץ לפי הגדרות הניתוח.';
  if(latest)$('latest-signal').dataset.direction=latest.direction;
  const reasons=[...new Set([...(result.dataQuality?.reasonCodes??[]),...(result.reasonCodes??[])])];
  $('quality-status').textContent=reasons.length?reasons.map(reasonText).join(' · '):`הנתונים עומדים בבדיקת הקלט. הניתוח נכון לזמן החלטה ${timestamp(result.asOfTime)}. אירועים היסטוריים אינם איתות חדש בזמן אמת.`;
  ledgerRows=[...(result.signals??[]),...(result.events??[]).filter(event=>event.status!=='CONFIRMED')].sort((a,b)=>(b.confirmedAt??b.knownAt??0)-(a.confirmedAt??a.knownAt??0));
  page=0;renderLedger();
  $('technical-result').textContent=JSON.stringify({status:result.status,reasonCodes:result.reasonCodes,dataQuality:result.dataQuality,parameterSnapshot:result.parameterSnapshot,context:result.context,patterns:result.patterns,stats:result.stats,execution:result.execution,orderEligible:result.orderEligible},null,2);
}
function renderLedger(){
  const filter=$('status-filter').value,filtered=ledgerRows.filter(event=>filter==='ALL'||event.status===filter),pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.min(page,pages-1);
  $('event-rows').replaceChildren();
  if(!filtered.length){const row=element('tr'),cell=element('td','לא נמצאו אירועים בתצוגה שנבחרה.');cell.colSpan=5;row.append(cell);$('event-rows').append(row);}
  for(const event of filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
    const row=element('tr'),time=element('td'),pattern=element('td'),status=element('td'),levels=element('td'),explanation=element('td');
    time.append(element('p',timestamp(event.knownAt),'event-time'),element('p',`נר מקור: ${timestamp(event.barCloseTime)}`,'event-time'));
    pattern.append(element('p',directions[event.direction]??event.direction,event.direction==='LONG'?'long':'short'),element('p',(event.patternIds??[]).map(id=>patternNames[id]??id).join(' · ')));
    const tag=element('span',statusNames[event.status]??event.status,'status-tag');tag.dataset.state=event.status;status.append(tag);
    const context=event.contextSnapshot?.context?.state??event.contextSnapshot?.state;
    if(context)status.append(element('p',contextNames[context]??context));
    const conditions=event.contextSnapshot?.conditionsMet,checks=event.contextSnapshot?.checks?.length;
    if(Number.isFinite(conditions)&&Number.isFinite(checks))status.append(element('p',`${conditions}/${checks} תנאים התקיימו`,'muted'));
    levels.append(element('p',`רמת אישור: ${number(event.trigger)}`),element('p',`רמת ביטול: ${number(event.invalidation)}`));
    if(event.confirmedAt!==null&&event.confirmedAt!==undefined)levels.append(element('p',`אישור מחיר: ${timestamp(event.confirmedAt)}`,'event-time'));
    explanation.append(element('p',(event.reasonCodes??[]).map(reasonText).join(' · ')||'ללא סיבה נוספת.','reason-list'));
    const risk=event.riskPlan;if(risk)explanation.append(element('p',risk.status==='PLANNED'?`סיכון מחקרי: ${risk.quantity} חוזים · כניסה ${number(risk.effectiveEntry)} · סטופ ${number(risk.initialStop)} · יעד ${number(risk.target)}`:`חישוב סיכון נפסל: ${(risk.reasonCodes??[]).map(reasonText).join(' · ')}`,'muted'));
    const excursion=lastRun.excursions[event.eventId];
    if(excursion)explanation.append(element('p',excursion.status==='AVAILABLE'?`תנועה לאורך ${excursion.horizonBars} נרות: MFE ${number(excursion.mfe)} · MAE ${number(excursion.mae)}. אלה אינם רווחי עסקה.`:`MFE / MAE: ${(excursion.reasonCodes??[]).map(reasonText).join(' · ')}`,'muted'));
    const details=element('details',undefined,'row-detail');details.append(element('summary','תנאים, פרמטרים וזמני ידיעה'),element('pre',JSON.stringify({event,excursion},null,2)));details.querySelector('pre').dir='ltr';explanation.append(details);
    row.append(time,pattern,status,levels,explanation);$('event-rows').append(row);
  }
  $('page-status').textContent=`${filtered.length} אירועים · עמוד ${page+1} מתוך ${pages}`;$('previous-page').disabled=page===0;$('next-page').disabled=page>=pages-1;
}

$('definition-version').textContent=GUIDE_SIGNAL_VERSION;
$('validate-input').addEventListener('click',importCurrent);
$('analyze').addEventListener('click',()=>{void analyze();});
$('load-example').addEventListener('click',()=>{fileGeneration++;$('import-format').value='json';$('input-text').value=JSON.stringify(createSyntheticGuideDocument(),null,2);importCurrent();});
$('download-example').addEventListener('click',()=>download(createSyntheticGuideDocument(),'guide-synthetic-example.json'));
$('download-template').addEventListener('click',()=>download({metadata:{source:'ohlc',instrument:'',timeframe:'',timeframeMs:null,tickSize:null,timezone:'Asia/Jerusalem',session:'',chartType:'standard'},bars:[],risk:null,config:{...GUIDE_SIGNAL_DEFAULTS},patternConfig:{},contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT},higherTimeframes:{},formatInstructions:['Fill metadata and explicit per-bar closed flags.','Each bar: time (open epoch ms), closeTime, knownAt optional, open, high, low, close, closed; volume optional.','Do not remove missing bars silently; declare market-closed session gaps explicitly.']},'guide-input-template.json'));
$('download-rules').addEventListener('click',()=>download({sourceKind:'original_research_definition',guide:'Candlestick_Codex_Guide_HE.txt',definitions:{signals:GUIDE_SIGNAL_VERSION,patterns:PATTERN_DEFINITION_VERSION,context:CONTEXT_DEFINITION_VERSION},signalDefaults:GUIDE_SIGNAL_DEFAULTS,patternDefaults:DEFAULT_PATTERN_CONFIG,contextDefaults:DEFAULT_CONTEXT_CONFIG,standardWorkflowContext:GUIDE_ALL_SCENARIO_CONTEXT,note:'Research definitions only; tick size, point value, budgets, source data and measured profitability are not inferred.'},'guide-research-rules.json'));
$('export-results').addEventListener('click',()=>{if(lastRun)download({...lastRun,exportedAt:new Date().toISOString()},'guide-research-result-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');});
$('status-filter').addEventListener('change',()=>{page=0;if(lastRun)renderLedger();});$('previous-page').addEventListener('click',()=>{page--;renderLedger();});$('next-page').addEventListener('click',()=>{page++;renderLedger();});
$('input-text').addEventListener('input',()=>{fileGeneration++;loadedDocument=null;$('analyze').disabled=true;$('input-summary').textContent='הנתונים השתנו; נדרשת טעינה';markAnalysisDirty();showStatus('import-status','לחצו על טעינת הנתונים ובדיקתם לאחר העריכה.');});
for(const id of ['instrument','timeframe','timeframe-ms','tick-size','timezone','session','chart-type','as-of-time','expiry-bars','inside-expiry-bars','min-conditions','confirmation-buffer','require-location','require-risk','require-ema','require-fib','require-trendline','require-supply-demand','require-higher-timeframe','advanced-config','point-value','risk-budget','commission','slippage','max-contracts','reward-risk','min-reward-risk','daily-risk','loss-count','loss-limit','excursion-horizon'])$(id).addEventListener('input',()=>{riskModeNote();markAnalysisDirty();});
$('input-file').addEventListener('change',async()=>{
  const file=$('input-file').files?.[0];if(!file)return;const token=++fileGeneration;
  loadedDocument=null;$('analyze').disabled=true;$('input-summary').textContent='טוען קובץ חדש';markAnalysisDirty();
  if(file.size>2000000){showStatus('import-status','הקובץ גדול ממגבלת 2 מיליון בתים.','error');return;}
  try{const text=await file.text();if(token!==fileGeneration)return;$('input-text').value=text;$('import-format').value=file.name.toLowerCase().endsWith('.csv')?'csv':'auto';importCurrent();}catch(error){showStatus('import-status',formatError(error),'error');}
});
riskModeNote();
