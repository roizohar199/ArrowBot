import {GUIDE_PATTERN_DESCRIPTIONS,describeGuideReason} from './guide-explanations.mjs';

// A presentation-only projection. Neither a passing provisional condition nor
// a complete provisional checklist can approve a signal or create an order.
export const GUIDE_FORMING_VIEW_VERSION='guide-forming-view-1';
const labels={STRUCTURE:'מבנה השוק',KNOWN_LOCATION:'אזור מחיר ידוע',HIGHER_TIMEFRAME:'התאמה ל־5 ו־15 דקות',EMA:'ממוצע EMA ושיפועו',FIB:'פיבונאצ׳י',TRENDLINE:'קו מגמה',SUPPLY_DEMAND:'היצע וביקוש',RISK:'סיכון כולל עלויות',FROZEN_CONTEXT:'שמירת ההקשר של המערך הסגור',CONFIRMATION_PRICE:'המחיר כעת ביחס לרמת האישור'};
const states={PASS:'התקיים זמנית',PENDING:'ממתין לסגירה מאשרת',FAIL:'לא התקיים',UNAVAILABLE:'מידע חסר',DISABLED:'כבוי'};
const marketStates={TREND_UP:'מגמה עולה',TREND_DOWN:'מגמה יורדת',RANGE:'דשדוש',TRANSITION:'מעבר בין מצבים',UNKNOWN:'לא ידוע'};
const familyLabels={TREND_CONTINUATION:'המשך מגמה',REVERSAL_AT_ZONE:'היפוך באזור מחיר',RANGE_EDGE:'קצה דשדוש',HANGING_MAN_REVERSAL:'היפוך Hanging Man',INVERTED_HAMMER_REVERSAL:'היפוך Inverted Hammer',ENGULFING_RANGE_RECLAIM:'בליעה וחזרה לתוך הטווח',ROLE_REVERSAL_RETEST:'בדיקת אזור שהחליף תפקיד',INSIDE_BREAKOUT:'פריצת Inside Bar',INSIDE_FALSE_BREAK:'פריצת שווא של Inside Bar',UNDEFINED:'תבנית ללא הקשר כניסה'};
const scenarioStates={FORMING_CANDIDATE:'מועמד מתהווה',FORMING_CANDIDATE_MISSING_REQUIRED_CONTEXT:'חסרים תנאי חובה',FORMING_PRICE_BEYOND_TRIGGER:'המחיר מעבר לרמת האישור; ממתין לסגירה',FORMING_PRICE_BEYOND_INVALIDATION:'המחיר כעת מעבר לרמת הביטול',FORMING_FROZEN_CONTEXT_BROKEN:'המחיר כעת אינו שומר על ההקשר המקורי',WAITING_FOR_FORMING_PRICE_CONDITION:'ממתין לתנאי מחיר',WAITING_FOR_FORMING_RANGE_RECLAIM:'ממתין לחזרה לתוך הטווח',WAITING_FOR_KNOWN_ROLE_REVERSAL_RETEST:'ממתין לאזור ידוע שהחליף תפקיד ולתבנית מתאימה',CONTEXT_NOT_APPLICABLE:'ההקשר אינו מתאים',NOT_APPLICABLE:'התבנית הנדרשת טרם הופיעה',DIRECTION_NOT_DEFINED:'טרם נקבע כיוון',AMBIGUOUS_FORMING_REACHABILITY:'שני הגבולות נחצו; סדר התנועה אינו ידוע',PRIOR_REFERENCE_NOT_YET_KNOWN:'נר הייחוס טרם היה ידוע בתחילת הנר'};
scenarioStates.FORMING_PRIOR_LINE_BREAK_PENDING='המחיר עבר את הטריגר; ממתין לשבירת קו המגמה המקורי';
const patternLabels=Object.fromEntries(GUIDE_PATTERN_DESCRIPTIONS.map(({id,label})=>[id,label]));
const number=value=>Number.isFinite(value)?new Intl.NumberFormat('he-IL',{maximumFractionDigits:4}).format(value):'חסר';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const safeTime=value=>Number.isFinite(value)&&value>=0&&value<=8640000000000000;
const clock=value=>safeTime(value)?new Date(value).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'חסר';
function evidenceText(check){
  const e=check.evidence??{};
  switch(check.id){
    case 'STRUCTURE':return marketStates[e.state]??'מבנה לפי ההקשר שהיה ידוע לפני היווצרות המערך';
    case 'KNOWN_LOCATION':return `${(e.zoneIds??e.roleZoneIds??[]).length} אזורי מחיר ו־${(e.supplyZoneIds??[]).length} אזורי היצע וביקוש מתאימים`;
    case 'EMA':return `ערך ${number(e.value)} · מרחק ${number(e.distance)} · סבילות ${number(e.tolerance)}${e.formingValue?' · הערך משתנה עם המחיר הנצפה':''}`;
    case 'FIB':return e.direction==='UP'?'רמות מתנודה עולה מאושרת':e.direction==='DOWN'?'רמות מתנודה יורדת מאושרת':'אין עוגנים מאושרים מתאימים';
    case 'TRENDLINE':return e.policy==='FROZEN_PRIOR_TRENDLINE_LATER_CLOSE_BREAK'?`${(e.lineIds??[]).length} קווים מאושרים של המגמה הקודמת · נדרשת סגירה מאוחרת מעבר לקו${e.provisionalBreak?.projections?.length?' · רמת שבירה כעת '+number(e.provisionalBreak.projections[0].threshold):''}`:`${(e.lineIds??[]).length} קווים ידועים עומדים בדרישות`;
    case 'SUPPLY_DEMAND':return `${(e.zoneIds??[]).length} אזורים מתאימים`;
    case 'HIGHER_TIMEFRAME':return (e.series??[]).map(series=>`${series.name}: ${marketStates[series.state]??'לא ידוע'} (${series.knownBars??0} נרות סגורים)`).join(' · ')||'נדרשים נתוני מסגרות הזמן הגבוהות';
    case 'RISK':return `סיכון לחוזה ${number(e.perContractRisk)} דולר · תקציב ${number(e.budget)} דולר · כמות בתכנון ${number(e.quantity)} · עמלת סיבוב ${number(e.commission)} · הקצאת החלקה ${number(e.slippageAllowance)}`;
    case 'CONFIRMATION_PRICE':return `מחיר נצפה ${number(e.observedPrice)} · רמת אישור ${number(e.trigger)} · ביטול ${number(e.invalidation)}`;
    default:return '';
  }
}
function checkModel(check){
  const state=check.state==='DISABLED'?'DISABLED':check.available===false?'UNAVAILABLE':check.state==='UNAVAILABLE'?'UNAVAILABLE':check.state==='PENDING'?'PENDING':check.passed===true?'PASS':'FAIL';
  return {id:check.id,label:labels[check.id]??'תנאי נוסף',state,stateLabel:states[state],required:check.required===true,provisional:true,evidenceText:evidenceText(check),reasonText:(check.reasonCodes??[]).map(describeGuideReason).join(' · ')};
}
function scenarioModel(scenario,pending=false){
  const risk=scenario.riskPreview,levels=scenario.levels;
  return {id:scenario.eventId??[scenario.family,scenario.direction,scenario.patternId,(scenario.patternIds??[]).join(',')].join('|'),direction:scenario.direction,label:familyLabels[scenario.family]??'מערך תבניות',patterns:(scenario.patternIds??[scenario.patternId]).filter(Boolean).map(id=>patternLabels[id]??familyLabels[id]??'תבנית מחיר'),stateLabel:scenarioStates[scenario.state]??'ממתין להשלמת תנאים',pendingConfirmation:pending,contextApplicable:scenario.contextApplicable===true,checks:(scenario.checks??[]).map(checkModel),levels:levels?{observedPrice:levels.entryReference,trigger:levels.confirmationTrigger,invalidation:levels.invalidation}:null,risk:risk?{status:risk.status,quantity:risk.quantity,perContractRisk:risk.perContractRisk??null,totalPlannedRisk:risk.totalPlannedRisk??null,budget:risk.parameterSnapshot?.riskBudget??null}:null,freezeTime:scenario.freezeTime??null,candidateOnly:true,signalApproved:false,orderEligible:false};
}

export function describeGuideFormingPreview(preview,{eligible=false,sourceId,barTime,sourceObservedAt,now=Date.now(),maxAgeMs=15000}={}){
  const base={version:GUIDE_FORMING_VIEW_VERSION,status:'UNAVAILABLE',message:'ממתין למקור חי ולהקשר תקין.',directions:[],scenarios:[],pendingConfirmations:[],candidateOnly:true,signalApproved:false,orderEligible:false};
  if(!eligible)return {...base,message:'התצוגה הזמנית אינה פעילה: נדרש מקור חי תקין והגדרות מאושרות.'};
  if(!plain(preview)||preview.status!=='PREVIEW')return base;
  if(preview.candidateOnly!==true||preview.final!==false||preview.signalApproved!==false||preview.orderEligible!==false||preview.ordersCreated!==false||preview.fillInferred!==false)return {...base,message:'נתוני התצוגה הזמנית אינם תקינים.'};
  if(!safeTime(now)||!safeTime(sourceObservedAt)||!Number.isFinite(maxAgeMs)||maxAgeMs<=0||sourceObservedAt>now)return {...base,message:'זמן קליטת המקור אינו תקין; ממתין לעדכון חדש.'};
  const ageMs=now-sourceObservedAt;
  if(ageMs>maxAgeMs)return {...base,status:'STALE',sourceAgeMs:ageMs,message:'המקור לא התעדכן בזמן. התנאים הקודמים הוסרו עד לחידוש נתונים תקינים.'};
  if(sourceId!==undefined&&preview.sourceIdentity?.sourceId!==sourceId)return {...base,message:'זהות המקור השתנתה; ממתין לניתוח חדש.'};
  if(barTime!==undefined&&preview.openBarTime!==barTime)return {...base,message:'נר המקור התחלף; ממתין לתנאים מעודכנים.'};
  const safeScenario=scenario=>scenario?.candidateOnly===true&&scenario.final===false&&scenario.signalApproved===false&&scenario.orderEligible===false;
  if(!['LONG','SHORT'].every(direction=>safeScenario(preview.directions?.[direction]))||[...(preview.scenarios??[]),...(preview.pendingConfirmations??[])].some(scenario=>!safeScenario(scenario)))return {...base,message:'נתוני התנאים הזמניים אינם תקינים.'};
  return {...base,status:'PREVIEW',message:'נר פתוח — כל התנאים זמניים. אישור דורש נר מאוחר סגור וכל בדיקות החובה.',sourceAgeMs:ageMs,sourceObservedAt,openBarTime:preview.openBarTime,openBarCloseTime:preview.openBarCloseTime,sourceIdentity:preview.sourceIdentity,directions:['LONG','SHORT'].map(direction=>({direction,label:direction==='LONG'?'לונג':'שורט',checks:(preview.directions[direction].checks??[]).map(checkModel)})),scenarios:(preview.scenarios??[]).map(scenario=>scenarioModel(scenario)),pendingConfirmations:(preview.pendingConfirmations??[]).map(scenario=>scenarioModel(scenario,true))};
}

export function createGuideFormingView(container){
  if(!container?.ownerDocument)throw TypeError('FORMING_VIEW_CONTAINER_REQUIRED');
  const document=container.ownerDocument,node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(className)element.className=className;return element;},setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};
  let signature=null,lastModel=null,contentWrites=0,layout=null;
  const status=node('p',undefined,'forming-status'),freshness=node('p',undefined,'forming-freshness'),content=node('div');
  container.replaceChildren(status,freshness,content);container.dataset.state='UNAVAILABLE';
  function patchChecks(parent,checks,cache){
    const order=checks.map(check=>check.id).join('|');
    for(const check of checks){
      let slot=cache.entries.get(check.id);
      if(!slot){const row=node('div',undefined,'forming-check'),label=node('span',undefined,'forming-check-label'),state=node('b',undefined,'forming-check-state'),required=node('small',undefined,'forming-check-required'),evidence=node('details',undefined,'forming-check-evidence'),evidenceSummary=node('summary'),evidenceFull=node('p',undefined,'forming-check-detail');row.dataset.condition=check.id;row.append(label,state,required);evidence.append(evidenceSummary,evidenceFull);slot={row,label,state,required,evidence,evidenceSummary,evidenceFull};cache.entries.set(check.id,slot);}
      slot.row.dataset.state=check.state;setText(slot.label,check.label);setText(slot.state,check.stateLabel);setText(slot.required,check.required?'חובה':'אופציונלי');const detailText=[check.evidenceText,check.reasonText].filter(Boolean).join(' · ');setText(slot.evidenceSummary,detailText||'אין מדידה זמינה');setText(slot.evidenceFull,detailText||'אין מדידה זמינה');slot.evidenceSummary.title=detailText;slot.evidenceSummary.tabIndex=0;
    }
    if(order!==cache.order){cache.order=order;parent.replaceChildren(...checks.flatMap(check=>{const slot=cache.entries.get(check.id);return [slot.row,slot.evidence];}));for(const key of cache.entries.keys())if(!checks.some(check=>check.id===key))cache.entries.delete(key);}
  }
  const newChecks=()=>({entries:new Map(),order:null});
  function patchScenarios(parent,entries,cache){
    const order=entries.map(entry=>entry.id).join(';;');
    for(const entry of entries){
      let slot=cache.entries.get(entry.id);
      if(!slot){const details=node('details',undefined,'forming-scenario'),summary=node('summary'),patterns=node('p',undefined,'help'),levels=node('p',undefined,'forming-levels'),scope=node('p',undefined,'help'),checks=node('div');details.append(summary,patterns,levels,scope,checks);slot={details,summary,patterns,levels,scope,checks,checkCache:newChecks()};cache.entries.set(entry.id,slot);}
      slot.details.dataset.direction=entry.direction;setText(slot.summary,(entry.direction==='LONG'?'לונג':entry.direction==='SHORT'?'שורט':'ללא כיוון')+' · '+entry.label+' · '+entry.stateLabel);setText(slot.patterns,entry.patterns.join(' + '));setText(slot.levels,entry.levels?'מחיר נצפה '+number(entry.levels.observedPrice)+' · רמת אישור '+number(entry.levels.trigger)+' · רמת ביטול '+number(entry.levels.invalidation):'רמות מחיר טרם זמינות');setText(slot.scope,entry.pendingConfirmation?'המערך נוצר בנרות סגורים. המחיר הנוכחי עדיין אינו אישור סופי.':'התבנית בנר הפתוח יכולה להשתנות עד הסגירה.');patchChecks(slot.checks,entry.checks,slot.checkCache);
    }
    if(order!==cache.order){cache.order=order;parent.replaceChildren(...entries.map(entry=>cache.entries.get(entry.id).details));for(const key of cache.entries.keys())if(!entries.some(entry=>entry.id===key))cache.entries.delete(key);}
  }
  function initializeLayout(){
    const grid=node('div',undefined,'forming-grid'),directions=new Map();
    for(const direction of ['LONG','SHORT']){const card=node('article',undefined,'forming-direction'),title=node('h3'),checks=node('div');card.append(title,checks);grid.append(card);directions.set(direction,{card,title,checks,cache:newChecks()});}
    const pending=node('div',undefined,'forming-pending'),pendingEmpty=node('p','אין כרגע מערך סגור שממתין לאישור.','help'),pendingEntries=node('div');pending.append(node('h3','מערכים סגורים הממתינים לנר אישור'),pendingEmpty,pendingEntries);
    const candidates=node('details',undefined,'forming-candidates'),candidateSummary=node('summary'),candidateEmpty=node('p','טרם זוהתה תבנית מועמדת.','help'),candidateEntries=node('div');candidates.append(candidateSummary,candidateEmpty,candidateEntries);
    content.replaceChildren(grid,pending,candidates,node('p','בדיקת הסיכון משתמשת במחיר הנצפה כעת. מחיר האישור, הסטופ והעלות עשויים להשתנות; אין כאן הוראה או הסתברות לכניסה.','help'));
    return {directions,pendingEmpty,pendingEntries,pendingCache:{entries:new Map(),order:null},candidateSummary,candidateEmpty,candidateEntries,candidateCache:{entries:new Map(),order:null}};
  }
  function render(preview,options={}){
    const model=describeGuideFormingPreview(preview,options),{sourceAgeMs,sourceObservedAt,...semantic}=model,next=JSON.stringify(semantic);lastModel=model;
    container.dataset.state=model.status;setText(status,model.message);setText(freshness,model.status==='PREVIEW'?'נר '+clock(model.openBarTime)+'–'+clock(model.openBarCloseTime)+' · עדכון נקלט לפני '+Math.floor(sourceAgeMs)+' ms · זמן קליטה '+clock(sourceObservedAt):'');
    if(next===signature)return {changed:false,contentWrites,status:model.status};
    signature=next;contentWrites++;
    if(model.status!=='PREVIEW'){content.replaceChildren();layout=null;return {changed:true,contentWrites,status:model.status};}
    if(!layout)layout=initializeLayout();
    for(const direction of model.directions){const slot=layout.directions.get(direction.direction);setText(slot.title,'תנאי '+direction.label+' לפי הנר הפתוח');patchChecks(slot.checks,direction.checks,slot.cache);}
    layout.pendingEmpty.hidden=model.pendingConfirmations.length>0;patchScenarios(layout.pendingEntries,model.pendingConfirmations,layout.pendingCache);
    setText(layout.candidateSummary,'תבניות ותרחישים בנר המתהווה · '+model.scenarios.length);layout.candidateEmpty.hidden=model.scenarios.length>0;patchScenarios(layout.candidateEntries,model.scenarios,layout.candidateCache);
    return {changed:true,contentWrites,status:model.status};
  }
  function clear(message='ממתין למקור חי ולהקשר תקין.'){
    const result=render(null,{eligible:false});setText(status,message);lastModel={...lastModel,message};return result;
  }
  return {render,clear,snapshot:()=>lastModel?structuredClone(lastModel):null};
}
