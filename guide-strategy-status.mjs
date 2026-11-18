import {GUIDE_STRATEGY_POLICY,GUIDE_STRATEGY_PROFILES,validateGuideStrategyProof} from './guide-strategy-policy.mjs';
import {GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';

const labels={CANDLE_TREND_AT_ZONE:'נרות במגמה ובאזור',CANDLE_REVERSAL_AT_ZONE:'נרות היפוך באזור',CANDLE_RANGE_EDGE:'נרות בקצה דשדוש',PIN_TREND_AT_ZONE:'פין במגמה ובאזור',PIN_CONFLUENCE:'פין עם מסגרת זמן גבוהה',PIN_RANGE_EDGE:'פין בקצה דשדוש',ENGULFING_EMA:'נר בולע עם EMA',ENGULFING_FIB:'נר בולע עם פיבונאצ׳י',ENGULFING_TRENDLINE:'נר בולע עם קו מגמה',ENGULFING_RANGE:'נר בולע בדשדוש',ENGULFING_SUPPLY_DEMAND:'נר בולע בהיצע וביקוש',ENGULFING_RANGE_RECLAIM:'נר בולע שחוזר לטווח',HANGING_MAN_REVERSAL:'Hanging Man בהיפוך',INVERTED_HAMMER_REVERSAL:'Inverted Hammer בהיפוך',INSIDE_BREAKOUT:'פריצת Inside',INSIDE_FALSE_BREAK:'פריצת שווא Inside',INSIDE_FALSE_BREAK_FIB:'פריצת שווא Inside עם פיבונאצ׳י',ROLE_REVERSAL_RETEST:'החלפת תפקיד ובדיקה חוזרת'};
const checks={STRUCTURE:'מבנה',KNOWN_LOCATION:'מיקום',EMA:'EMA',FIB:'פיבונאצ׳י',TRENDLINE:'קו מגמה',SUPPLY_DEMAND:'היצע וביקוש',HIGHER_TIMEFRAME:'מסגרת זמן גבוהה'};
const states={CURRENT_CONFIRMED:'אישור טכני בסגירה הנוכחית',ARMED:'ממתין לסגירה מאשרת',MISSING_CONDITIONS:'תנאים חסרים במערך האחרון',WAITING_FOR_PATTERN:'ממתין לתבנית מתאימה',CONFLICT:'כיוונים סותרים בסגירה הנוכחית'};

export const GUIDE_STRATEGY_LABELS=Object.freeze(labels);

export function describeGuideStrategyStatus(analysis,{technicalDecision,recentBars=5}={}){
  const base={kind:'GUIDE_STRATEGY_RUNTIME_STATUS',status:'UNAVAILABLE',asOfTime:analysis?.asOfTime??null,rows:[],orderEligible:false,probabilityComputed:false};
  const profiles=analysis?.strategyProfiles,asOf=analysis?.asOfTime;
  if(analysis?.definitionVersion!==GUIDE_SIGNAL_VERSION||analysis.sourceKind!=='original_research_definition'||analysis.execution!=='OBSERVATION_ONLY'||analysis.orderEligible!==false||analysis?.parameterSnapshot?.config?.strategyPolicy!==GUIDE_STRATEGY_POLICY||analysis.dataQuality?.valid!==true||analysis.status==='BLOCKED'||!Number.isSafeInteger(asOf)||!Array.isArray(profiles)||profiles.length!==GUIDE_STRATEGY_PROFILES.length||new Set(profiles.map(p=>p?.id)).size!==profiles.length||!Array.isArray(analysis.events)||!Number.isSafeInteger(recentBars)||recentBars<1||recentBars>50)return base;
  if(GUIDE_STRATEGY_PROFILES.some(p=>{const actual=profiles.find(item=>item.id===p.id);return !actual||JSON.stringify(actual.requiredCheckIds)!==JSON.stringify(p.requiredCheckIds);}))return base;
  const current=technicalDecision?.status==='CONFIRMED'&&technicalDecision.approvalPolicy===GUIDE_STRATEGY_POLICY&&technicalDecision.asOfTime===asOf&&technicalDecision.currentClosedBarCloseTime===asOf&&technicalDecision.signal?.confirmationBarCloseTime===asOf?technicalDecision.signal:null;
  const currentIds=new Set(current?.sourceEventIds??[]),conflictIds=new Set((technicalDecision?.conflicts??[]).filter(c=>c.confirmationBarCloseTime===asOf).flatMap(c=>c.sourceEventIds??[]));
  const since=asOf-recentBars*(analysis.metadata?.timeframeMs??60000),rows=GUIDE_STRATEGY_PROFILES.map(profile=>{
    const events=analysis.events.filter(e=>e?.strategyId===profile.id&&Number.isFinite(e.detectedAt)&&e.detectedAt<=asOf&&e.instrument===analysis.metadata?.instrument&&e.timeframe===analysis.metadata?.timeframe).sort((a,b)=>b.detectedAt-a.detectedAt);
    const proof=e=>validateGuideStrategyProof(e.strategyProof,{eventId:e.eventId,checks:e.contextSnapshot?.checks,patternIds:e.patternIds,setupKind:e.contextSnapshot?.setupKind});
    const confirmed=events.filter(e=>currentIds.has(e.eventId)&&e.direction===current.direction&&e.confirmationBarCloseTime===asOf&&e.confirmedAt===asOf&&proof(e));
    const pending=events.find(e=>e.status==='ARMED'&&e.confirmedAt==null&&e.detectedAt>=since&&proof(e));
    const conflicted=events.find(e=>conflictIds.has(e.eventId)&&e.confirmationBarCloseTime===asOf),recent=events.find(e=>e.detectedAt>=since);
    const missing=recent?profile.requiredCheckIds.filter(id=>{const found=recent.contextSnapshot?.checks?.filter(c=>c?.id===id)??[];return found.length!==1||!['required','enabled','available','passed'].every(key=>found[0][key]===true)||found[0].state!=='PASS'||found[0].pendingConfirmation===true;}):[];
    const status=conflicted?'CONFLICT':confirmed.length?'CURRENT_CONFIRMED':pending?'ARMED':missing.length?'MISSING_CONDITIONS':'WAITING_FOR_PATTERN';
    return {profileId:profile.id,label:labels[profile.id],requiredCheckIds:[...profile.requiredCheckIds],status,direction:confirmed.length?current.direction:pending?.direction??null,missingRequiredCheckIds:missing,eventIds:confirmed.length?confirmed.map(e=>e.eventId):pending?[pending.eventId]:[],asOfTime:asOf,orderEligible:false};
  });
  return {...base,status:'ACTIVE',rows};
}

export function renderGuideStrategyStatus(container,model){
  const document=container.ownerDocument,node=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=String(text);return item;};
  container.replaceChildren();
  if(model?.status!=='ACTIVE'){container.append(node('p','ממתין לניתוח תקף של האסטרטגיות.'));return;}
  container.append(node('p',`${model.rows.length} אסטרטגיות פעילות. לכל שורה תנאי החובה שלה; תנאי נוסף שמוצג בניתוח אינו בהכרח חובה לכל אסטרטגיה. המצבים אינם הסתברות להצלחה או הוכחת ביצוע.`));
  container.append(node('p','נכון לסגירת '+new Date(model.asOfTime).toISOString()));
  const table=node('table'),head=node('thead'),titles=node('tr');for(const title of ['אסטרטגיה','תנאי חובה','מצב בנר הסגור','מה חסר'])titles.append(node('th',title));head.append(titles);table.append(head);
  const body=node('tbody');
  for(const row of model.rows){const tr=node('tr');tr.dataset.strategyId=row.profileId;tr.dataset.state=row.status;
    for(const value of [row.label+' · '+row.profileId,row.requiredCheckIds.map(id=>checks[id]??id).join(' · '),(states[row.status]??row.status)+(row.direction==='LONG'?' · לונג':row.direction==='SHORT'?' · שורט':''),row.status==='MISSING_CONDITIONS'?row.missingRequiredCheckIds.map(id=>checks[id]??id).join(' · '):'—'])tr.append(node('td',value));body.append(tr);}
  table.append(body);container.append(table);
}
