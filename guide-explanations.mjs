// A read-only explanation of the versioned rules. This module does not match
// new patterns, approve orders, infer fills or convert a shape into a forecast.
import {describeGuideEntryModels as describeEntryPlanning} from './guide-entry-models.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';
export const GUIDE_EXPLANATION_VERSION='guide-explanations-3';
const finite=Number.isFinite;
const copy=value=>value===undefined?null:structuredClone(value);
export const GUIDE_PATTERN_DESCRIPTIONS=Object.freeze([
  ['DOJI','דוג׳י','NEUTRAL',1,'2.3'],['DRAGONFLY_DOJI','דוג׳י שפירית','LONG',1,'2.4'],['GRAVESTONE_DOJI','דוג׳י מצבה','SHORT',1,'2.5'],
  ['HAMMER_SHAPE','צורת פטיש','LONG',1,'2.8'],['SHOOTING_STAR_SHAPE','צורת כוכב נופל','SHORT',1,'2.9'],
  ['HANGING_MAN_SHAPE','Hanging Man · צורה הדורשת עלייה קודמת','SHORT',1,'2.8'],['INVERTED_HAMMER_SHAPE','Inverted Hammer · צורה הדורשת ירידה קודמת','LONG',1,'2.9'],
  ['BULLISH_PIN_SHAPE','צורת Pin Bar שורית','LONG',1,'4.2'],['BEARISH_PIN_SHAPE','צורת Pin Bar דובית','SHORT',1,'4.2'],
  ['BULLISH_ENGULFING','בליעה שורית','LONG',2,'2.2'],['BEARISH_ENGULFING','בליעה דובית','SHORT',2,'2.2'],
  ['BULLISH_HARAMI','הראמי שורי','LONG',2,'2.10'],['BEARISH_HARAMI','הראמי דובי','SHORT',2,'2.10'],['HARAMI_CROSS','הראמי קרוס','CONTEXTUAL',2,'2.10'],
  ['INSIDE_BAR','Inside Bar','NEUTRAL',2,'6.1'],['OUTSIDE_BAR','Outside Bar','NEUTRAL',2,'2.2'],
  ['TWEEZER_BOTTOM','תחתית פינצטה','LONG',2,'2.11'],['TWEEZER_TOP','פסגת פינצטה','SHORT',2,'2.11'],
  ['MORNING_STAR','כוכב בוקר','LONG',3,'2.6'],['EVENING_STAR','כוכב ערב','SHORT',3,'2.7'],
].map(([id,label,direction,span,guideSection])=>Object.freeze({id,label,direction,span,guideSection})));
const labels=Object.fromEntries(GUIDE_PATTERN_DESCRIPTIONS.map(item=>[item.id,item.label]));
const conditionLabels={smallBody:'גוף קטן',doji:'גוף בגודל דוג׳י',longLowerWick:'פתיל תחתון ארוך',longUpperWick:'פתיל עליון ארוך',smallUpperWick:'פתיל עליון קטן',smallLowerWick:'פתיל תחתון קטן',nonzeroBody:'גוף גדול מאפס',highClose:'סגירה בחלק העליון',lowClose:'סגירה בחלק התחתון',previousDown:'נר קודם יורד',previousUp:'נר קודם עולה',currentUp:'נר נוכחי עולה',currentDown:'נר נוכחי יורד',tickKnown:'גודל טיק ידוע',bodyContains:'גוף נוכחי מכיל את הגוף הקודם',oneTickExtension:'התרחבות של טיק לפחות',previousBodyNonzero:'גוף קודם גדול מאפס',bodyContained:'גוף נוכחי בתוך הגוף הקודם',oppositeColor:'צבעים מנוגדים לפי ההגדרה',enabled:'הווריאציה מופעלת',highContained:'גבוה בתוך הנר הקודם',lowContained:'נמוך בתוך הנר הקודם',higherHigh:'גבוה גבוה מהקודם',lowerLow:'נמוך נמוך מהקודם',equalLows:'נמוכים שווים בתוך הסבילות',equalHighs:'גבוהים שווים בתוך הסבילות',atrWarmup:'ATR קודם זמין לאחר חימום',atrKnownBeforePattern:'ה־ATR היה ידוע לפני תחילת התבנית',significantFirstBody:'גוף ראשון משמעותי ביחס ל־ATR קודם',smallMiddleBody:'גוף אמצעי קטן ביחס לגוף הראשון',firstDown:'נר ראשון יורד',firstUp:'נר ראשון עולה',lastUp:'נר אחרון עולה',lastDown:'נר אחרון יורד',middleNotAbove:'אמצע גוף שני אינו מעל הראשון',middleNotBelow:'אמצע גוף שני אינו מתחת לראשון',closePastMidpoint:'סגירה מעבר לאמצע הגוף הראשון',requiredGaps:'פערי גוף לפי וריאציית השוק'};
const filterLabels={STRUCTURE:'מבנה השוק',KNOWN_LOCATION:'מיקום ברמה שהייתה ידועה מראש',EMA:'ממוצע מעריכי ושיפועו',FIB:'פיבונאצ׳י מעוגן לתנודות מאושרות',TRENDLINE:'קו מגמה עם נגיעה שלישית מאושרת',SUPPLY_DEMAND:'היצע וביקוש לפי כלל מחקר מפורש',HIGHER_TIMEFRAME:'התאמה לטווחי זמן גבוהים סגורים'};
const filterRules={STRUCTURE:'מגמה בכיוון התרחיש, היפוך ברמה מוכרת או קצה דשדוש מוכר',KNOWN_LOCATION:'טווח הנרות נוגע באזור מתאים שאושר לפני תחילת התבנית',EMA:'הסגירה בצד המתאים של EMA ושיפועו באותו כיוון',FIB:'נגיעה ברמת תיקון בכיוון המתאים בתוך סבילות ההגדרה',TRENDLINE:'נגיעה בקו פעיל המוקרן מעוגנים קפואים, לאחר נגיעה שלישית ידועה',SUPPLY_DEMAND:'בסיס קטן ביחס ל־ATR קודם ואחריו תזוזה מאשרת; זיהוי מחיר בלבד',HIGHER_TIMEFRAME:'כל הסדרות שסופקו הן באותו מכשיר, גבוהות מטווח הבסיס ומסכימות בכיוון על סמך מידע שהיה זמין בזמן ההחלטה'};
Object.assign(conditionLabels,{toleranceAvailable:'סבילות המחיר זמינה לפני תחילת הצמד',pricesOnTickGrid:'המחירים הומרו לטיקים שלמים'});
filterLabels.TRENDLINE='קו מגמה לפי וריאציית עוגנים מפורשת';filterRules.TRENDLINE='מגע לפי השיטה שנבחרה בקו פעיל מסולם וציר זמן מוגדרים, לאחר מספר הנגיעות הנדרש';filterRules.EMA='צד ושיפוע, ובמידת הצורך קרבה לממוצע; זמן המדידה ויחידות המרחק מפורשים';filterRules.HIGHER_TIMEFRAME='נתוני מקור גבוהים סגורים וזמינים: התאמת כל המגמות, או מבנה בטווח הרחב ואזור בטווח הביניים לפי המדיניות שנבחרה';
const reasons={
  NO_CLOSED_AVAILABLE_BARS:'אין נר סגור שזמין בזמן ההחלטה',NOT_ENOUGH_CONTEXT:'אין די נקודות תנודה מאושרות לקביעת מבנה',MIXED_OR_EQUAL_PIVOTS:'השיאים והשפלים מעורבים או שווים',REPEATED_CONFIRMED_BOUNDARIES:'גבולות חוזרים ומאושרים מגדירים דשדוש',STRUCTURE_BREAK_DOWN:'סגירה מתחת למבנה העולה',STRUCTURE_BREAK_UP:'סגירה מעל למבנה היורד',
  HIGHER_TIMEFRAME_NOT_SUPPLIED:'לא סופקו נתונים לטווח זמן גבוה',HIGHER_TIMEFRAME_STRUCTURE_NOT_READY:'מבנה טווח הזמן הגבוה עדיין אינו מאושר',OPTIONAL_RESEARCH_RULE_DISABLED:'הכלל האופציונלי אינו מופעל',FILTER_CONDITION_NOT_MET:'המידע חושב, אך תנאי המסנן לא התקיים',INSUFFICIENT_CONDITIONS:'מספר התנאים הבלתי תלויים קטן מהמינימום',INVALID_CONTEXT:'נתוני ההקשר אינם תקינים',
  LATER_CLOSED_BAR_CONFIRMED:'נר מאוחר יותר נסגר מעבר לרמת האישור',CONFIRMATION_EXPIRED:'חלף מספר נרות ההמתנה שהוגדר',CLOSE_BEYOND_INVALIDATION:'נר סגור חצה את רמת הביטול',FROZEN_RANGE_BROKEN:'גבול הדשדוש שהיה ידוע בתחילת התבנית נשבר',FROZEN_REVERSAL_ZONE_BROKEN:'אזור ההיפוך המקורי נשבר',FROZEN_REQUIRED_LOCATION_BROKEN:'כל אזורי המיקום המקוריים נשברו',CONFLICTING_CONFIRMED_DIRECTIONS:'תרחישים לשני הכיוונים אושרו באותו זמן ולכן אין איתות',
  RISK_PARAMETERS_REQUIRED:'חסרה הגדרת סיכון מפורשת',RISK_REJECTED:'תוכנית הסיכון נדחתה',RISK_BUDGET_BELOW_ONE_CONTRACT:'הסיכון הכולל לחוזה אחד עולה על התקציב',INSTRUMENT_POINT_VALUE_MISMATCH:'ערך הנקודה בהגדרת הסיכון שונה מנתוני המכשיר',EXPLICIT_RISK_CONFIGURATION_REQUIRED:'חסרים תקציב, עמלה, החלקה או מספר חוזים מפורשים',OBSTACLE_BEFORE_TARGET:'רמה מבנית מפריעה לפני היעד המתוכנן',STRUCTURAL_ROOM_INSUFFICIENT:'אין מספיק מרחק עד הרמה המבנית',INSUFFICIENT_REWARD_RISK:'יחס הסיכוי לסיכון קטן מהמינימום',CONSECUTIVE_LOSS_LIMIT:'מגבלת הפסדים רצופים הושגה',DAILY_RISK_EXHAUSTED:'תקציב הסיכון היומי נוצל',
  INSUFFICIENT_ELIGIBLE_HISTORY:'חסרים נרות קודמים סגורים שעומדים בדרישות האיכות',BELOW_MIN_RANGE:'טווח הנר קטן מהמינימום',ZERO_RANGE:'לנר אין טווח',BAR_NOT_YET_KNOWN:'הנתון עדיין לא היה זמין בזמן ההחלטה',OPEN_BAR_EXCLUDED:'נר פתוח אינו מאשר תבנית סופית',STAR_ATR_WARMUP_REQUIRED:'נדרש חימום ATR לפני תחילת תבנית הכוכב',
};
Object.assign(reasons,{FROZEN_STRUCTURE_BROKEN:'נקודת המבנה שאושרה לפני המערך נשברה; המערך אינו מתחדש לאחר חזרה',FROZEN_ROLE_REVERSAL_BROKEN:'האזור ששינה תפקיד לפי כלל המחקר נשבר חזרה',CONTEXTUAL_PATTERN_REQUIRES_TREND_UP:'שם Hanging Man מחייב עלייה מאושרת לפני הצורה',CONTEXTUAL_PATTERN_REQUIRES_TREND_DOWN:'שם Inverted Hammer מחייב ירידה מאושרת לפני הצורה',CONFIRMATION_SESSION_BOUNDARY:'האישור חצה גבול Session; ברירת המחדל אינה ממשיכה מערך ישן',PATTERN_SPANS_SESSION_BOUNDARY:'התבנית חוצה גבול Session ואינה מותרת בווריאציה שנבחרה',SIGNAL_RANGE_EXCEEDS_PRIOR_ATR:'טווח המערך גדול מהמסנן המפורש ביחס ל־ATR שהיה ידוע קודם',SIGNAL_RANGE_ATR_UNAVAILABLE:'מסנן הטווח דורש ATR קודם שעדיין אינו זמין',INVALID_PROVIDER_SESSION_PROOF:'פרטי זמינות וגבול Session של המקור אינם תקינים',PROVIDER_BAR_INDEX_GAP:'רצף אינדקסי הנרות של הספק מכיל נר חסר'});
reasons.INSUFFICIENT_CONDITIONS='מספר התנאים שהתקיימו קטן מהמינימום; זו אינה טענה לעצמאות סטטיסטית';
export function describeGuideReason(code){
  if(reasons[code])return reasons[code];
  if(code?.startsWith('MISSING_')&&filterLabels[code.slice(8)])return 'תנאי נדרש לא התקיים: '+filterLabels[code.slice(8)];
  if(code?.startsWith('INSUFFICIENT_CONFIRMED_'))return 'חסר מידע מאושר לחישוב '+(filterLabels[code.slice(23)]??code.slice(23));
  return String(code??'UNKNOWN_REASON');
}
const reasonDetails=codes=>[...new Set(codes??[])].map(code=>({code,text:describeGuideReason(code)}));
const prices=(f,ohlc)=>ohlc??(!f?null:{open:f.direction==='LONG'?f.bodyLow:f.bodyHigh,close:f.direction==='LONG'?f.bodyHigh:f.bodyLow,high:f.bodyHigh+f.upper,low:f.bodyLow-f.lower});

function measuredCondition(pattern,id,passed,shapes,index){
  const c=shapes.config??{},a=shapes.features?.[index],p=shapes.features?.[index-1],first=shapes.features?.[index-2],b=prices(a,shapes.byBar?.[index]?.ohlc),previous=prices(p,shapes.byBar?.[index-1]?.ohlc),firstBar=prices(first,shapes.byBar?.[index-2]?.ohlc);
  const result={id,label:conditionLabels[id]??id,passed:passed===true,state:passed?'PASS':'FAIL',actual:null,expected:null,operator:null,unit:null};
  const set=(actual,operator,expected,unit=null)=>Object.assign(result,{actual:copy(actual),operator,expected:copy(expected),unit});
  if(!a)return {...result,state:'UNAVAILABLE'};
  const hammer=['HAMMER_SHAPE','SHOOTING_STAR_SHAPE','HANGING_MAN_SHAPE','INVERTED_HAMMER_SHAPE'].includes(pattern),pin=pattern.includes('PIN_SHAPE'),harami=pattern.includes('HARAMI');
  switch(id){
    case 'doji':set(a.bodyRatio,'<=',c.dojiBodyMaxRatio,'ratio');break;
    case 'smallBody':if(harami)set(a.body,'<=',p?p.body*c.haramiBodyMaxRatio:null,'price');else set(a.bodyRatio,'<=',hammer?c.hammerBodyMaxRatio:pin?c.pinBodyMaxRatio:c.dojiBodyMaxRatio,'ratio');break;
    case 'nonzeroBody':set(a.body,'>',0,'price');break;
    case 'longLowerWick':case 'longUpperWick':{const lower=id==='longLowerWick';set(hammer?a[lower?'lower':'upper']:a[lower?'lowerRatio':'upperRatio'],'>=',hammer?c.hammerWickBodyMinRatio*a.body:pin?c.pinWickMinRatio:c.dojiWickMinRatio,hammer?'price':'ratio');break;}
    case 'smallUpperWick':case 'smallLowerWick':set(a[id==='smallUpperWick'?'upperRatio':'lowerRatio'],'<=',hammer?c.hammerOppositeWickMaxRatio:pin?c.pinOppositeWickMaxRatio:c.dojiOppositeWickMaxRatio,'ratio');break;
    case 'highClose':set(a.closePosition,'>=',hammer?c.hammerCloseMinRatio:c.pinCloseMinRatio,'ratio');break;
    case 'lowClose':set(a.closePosition,'<=',1-(hammer?c.hammerCloseMinRatio:c.pinCloseMinRatio),'ratio');break;
    case 'previousDown':case 'previousUp':set(p?.direction,'=',id==='previousDown'?'SHORT':'LONG');break;
    case 'currentUp':case 'lastUp':case 'currentDown':case 'lastDown':set(a.direction,'=',id.endsWith('Up')?'LONG':'SHORT');break;
    case 'tickKnown':set(c.tickSize,'>',0,'price');break;
    case 'bodyContains':set({lower:a.bodyLow,upper:a.bodyHigh},'contains',p?{lower:p.bodyLow,upper:p.bodyHigh}:null,'price');break;
    case 'oneTickExtension':set(p?Math.max(p.bodyLow-a.bodyLow,a.bodyHigh-p.bodyHigh):null,'>=',c.tickSize,'price');break;
    case 'previousBodyNonzero':set(p?.body,'>',0,'price');break;
    case 'bodyContained':set({lower:a.bodyLow,upper:a.bodyHigh},c.allowEqualHaramiEdges?'within_inclusive':'within_strict',p?{lower:p.bodyLow,upper:p.bodyHigh}:null,'price');break;
    case 'oppositeColor':set({current:a.direction,previous:p?.direction??null},(pattern.startsWith('TWEEZER')?c.requireOppositeTweezer:c.requireOppositeHarami)?'opposite_non_neutral':'optional',true);break;
    case 'enabled':set(c.enableHaramiCross,'=',true);break;
    case 'highContained':set(b.high,c.allowEqualInsideEdges?'<=':'<',previous?.high,'price');break;
    case 'lowContained':set(b.low,c.allowEqualInsideEdges?'>=':'>',previous?.low,'price');break;
    case 'higherHigh':set(b.high,'>',previous?.high,'price');break;
    case 'lowerLow':set(b.low,'<',previous?.low,'price');break;
    case 'equalLows':case 'equalHighs':{const key=id==='equalLows'?'low':'high',prior=shapes.tweezerAtr?.[index-2],tolerance=c.tweezerToleranceMode==='atr'&&finite(prior)?prior*c.tweezerToleranceAtr:c.tweezerToleranceMode==='ticks'&&finite(c.tickSize)?c.tickSize*c.tweezerToleranceTicks:null;set(previous?Math.abs(b[key]-previous[key]):null,'<=',tolerance,'price');break;}
    case 'toleranceAvailable':{const prior=shapes.tweezerAtr?.[index-2],knownAt=shapes.availabilityPrefixKnownAt?.[index-2],before=shapes.byBar?.[index-1]?.time;set(c.tweezerToleranceMode==='ticks'&&finite(c.tickSize)?c.tickSize*c.tweezerToleranceTicks:c.tweezerToleranceMode==='atr'&&finite(prior)&&knownAt<=before?prior*c.tweezerToleranceAtr:null,'finite_nonnegative',true,'price');break;}
    case 'pricesOnTickGrid':{const key=pattern==='TWEEZER_BOTTOM'?'low':'high';set({current:b?.[key]??null,previous:previous?.[key]??null,tickSize:c.tickSize},'integer_tick_coordinates',true);break;}
    case 'atrWarmup':set(shapes.atr?.[index-3],'>',0,'price');break;
    case 'atrKnownBeforePattern':{const known=shapes.byBar?.slice(0,index-2).map(row=>row.knownAt??row.closeTime)??[];set(known.length&&known.every(finite)?Math.max(...known):null,'<=',shapes.byBar?.[index-2]?.time,'epoch_ms');break;}
    case 'significantFirstBody':set(first?.body,'>=',finite(shapes.atr?.[index-3])?c.starFirstBodyMinAtr*shapes.atr[index-3]:null,'price');break;
    case 'smallMiddleBody':set(p?.body,'<=',first?c.starMiddleBodyMaxRatio*first.body:null,'price');break;
    case 'firstDown':case 'firstUp':set(first?.direction,'=',id==='firstDown'?'SHORT':'LONG');break;
    case 'middleNotAbove':case 'middleNotBelow':set(previous?(previous.open+previous.close)/2:null,id==='middleNotAbove'?'<=':'>=',firstBar?(firstBar.open+firstBar.close)/2:null,'price');break;
    case 'closePastMidpoint':set(b.close,pattern==='MORNING_STAR'?'>':'<',firstBar?(firstBar.open+firstBar.close)/2:null,'price');break;
    case 'requiredGaps':set({mode:c.starMode,currentBody:a?{lower:a.bodyLow,upper:a.bodyHigh}:null,middleBody:p?{lower:p.bodyLow,upper:p.bodyHigh}:null,firstBody:first?{lower:first.bodyLow,upper:first.bodyHigh}:null},c.starMode==='strict_gap'?'two_strict_body_gaps':'gaps_not_required',pattern==='MORNING_STAR'?'gap_below_first_then_above_middle':'gap_above_first_then_below_middle');break;
  }
  if(result.actual===null||result.actual===undefined)result.state='UNAVAILABLE';
  return result;
}

function describePatterns(shapes,index){
  const row=shapes?.byBar?.[index],features=shapes?.features??[],c=shapes?.config??{};
  return GUIDE_PATTERN_DESCRIPTIONS.map(definition=>{
    const check=row?.checks?.[definition.id],conditions=Object.entries(check?.conditions??{}).map(([id,passed])=>measuredCondition(definition.id,id,passed,shapes,index));
    const missing=[...(row?.reasonCodes??[]).filter(code=>code!=='STAR_ATR_WARMUP_REQUIRED'||definition.span===3).filter(code=>code!=='TICK_SIZE_REQUIRED_FOR_ENGULFING_AND_TWEEZERS'||definition.id.includes('ENGULFING')||definition.id.startsWith('TWEEZER')),...(check?.reason?[check.reason]:[])];
    if(index<definition.span-1)missing.push('INSUFFICIENT_ELIGIBLE_HISTORY');
    if(check?.conditions?.atrWarmup===false)missing.push('STAR_ATR_WARMUP_REQUIRED');
    if(check?.conditions?.atrKnownBeforePattern===false)missing.push('BAR_NOT_YET_KNOWN');
    const disabled=definition.id==='HARAMI_CROSS'&&c.enableHaramiCross===false;
    const unavailable=!row||!check||Boolean(check.reason)||definition.span===3&&(check.conditions?.atrWarmup===false||check.conditions?.atrKnownBeforePattern===false);
    const state=disabled?'DISABLED':unavailable?'UNAVAILABLE':check.matched?'MATCH':'NO_MATCH';
    return {...definition,state,matched:check?.matched===true,barIndex:index,barOpenTime:row?.time??null,knownAt:row?.knownAt??row?.closeTime??null,
      conditions,failedConditions:conditions.filter(condition=>!condition.passed).map(condition=>condition.id),reasonDetails:reasonDetails(missing),
      measurements:{current:copy(features[index]),currentOHLC:copy(row?.ohlc),previous:definition.span>1?copy(features[index-1]):null,previousOHLC:definition.span>1?copy(shapes?.byBar?.[index-1]?.ohlc):null,first:definition.span>2?copy(features[index-2]):null,firstOHLC:definition.span>2?copy(shapes?.byBar?.[index-2]?.ohlc):null,minRange:Math.max(c.minRange??0,(c.minRangeTicks??0)*(c.tickSize??0)),tickSize:c.tickSize??null},
      interpretation:definition.direction==='NEUTRAL'?'תצפית ניטרלית; הכיוון דורש הקשר ואישור נוסף':'התאמת צורה בלבד; המשמעות תלויה במיקום, במבנה ובאישור',
      provenance:{definitionVersion:shapes?.definitionVersion??null,sourceKind:shapes?.sourceKind??null,guideSection:definition.guideSection,guideLink:'guide-library.html#topic='+definition.guideSection,numericDefinitionSection:'א.2/א.3',units:c.unit??null,closed:row?.closed===true},
    };
  });
}
const statusLabels={ARMED:'ממתין לאישור בסגירה מאוחרת',CONFIRMED:'איתות מחקר מאושר לפי הכללים',REJECTED:'תנאים נדרשים לא התקיימו',EXPIRED:'חלון האישור פג',INVALIDATED:'התרחיש בוטל',AMBIGUOUS:'כיוונים סותרים; אין איתות'};
reasons.LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED='נדרשת סגירה מאוחרת מעבר לקו המגמה הקודמת ולעבר טריגר התבנית';
function describeFilter(check){
  const state=check.state??(check.passed?'PASS':check.available===false?'UNAVAILABLE':'FAIL');
  return {...copy(check),state,label:filterLabels[check.id]??check.id,rule:check.evidence?.policy==='FROZEN_PRIOR_TRENDLINE_LATER_CLOSE_BREAK'?'קו מאושר של המגמה הקודמת מוקפא לפני התבנית; האישור מחייב סגירה מאוחרת מעבר לקו ולרמת התבנית':filterRules[check.id]??null,reasonDetails:reasonDetails(check.reasonCodes),
    text:state==='PASS'?'התנאי התקיים':state==='PENDING'?'ממתין לסגירה מאוחרת מעבר לקו המקורי ולטריגר התבנית':state==='DISABLED'?'כלל אופציונלי שאינו מופעל':state==='UNAVAILABLE'?'חסר מידע מאושר; אין לפרש זאת כתנאי שעבר':check.required?'תנאי נדרש לא התקיים':'התנאי האופציונלי חושב ולא התקיים'};
}

export function describeGuideEntryModels(event,options){return describeEntryPlanning(event,options);}
function describeScenario(event,entryOptions){
  const context=event.contextSnapshot??{},risk=event.riskPlan;
  return {eventId:event.eventId,setupId:event.setupId,direction:event.direction,status:event.status,label:statusLabels[event.status]??event.status,
    patternIds:[...(event.patternIds??[])],patternLabels:(event.patternIds??[]).map(id=>labels[id]??(id==='INSIDE_FALSE_BREAK'?'פריצת שווא של Inside Bar':id==='INSIDE_BREAKOUT'?'פריצת Inside Bar':id)),
    levels:{signalLow:event.signalLow,signalHigh:event.signalHigh,signalClose:event.signalClose??null,confirmationTrigger:event.trigger,invalidation:event.invalidation,confirmationClose:event.confirmationClose??null},
    timing:{formationStartTime:event.formationStartTime??context.freezeTime??null,detectedAt:event.detectedAt,contextFrozenAt:context.freezeTime??null,confirmedAt:event.confirmedAt??null,confirmationBarCloseTime:event.confirmationBarCloseTime??null,invalidatedAt:event.invalidatedAt??null,expiresAt:event.expiresAt??null,expiresAfterBars:event.expiresAfterBars},
    conditions:(context.checks??[]).map(describeFilter),conditionsMet:context.conditionsMet??0,conditionsAreStatisticallyIndependent:false,minimumConditions:event.parameterSnapshot?.config?.minConditions??null,applicability:copy(event.scenarioApplicability),signalRangeCheck:copy(event.signalRangeCheck),stopReference:copy(event.stopReference),breakoutReference:copy(event.breakoutReference),
    reasonDetails:reasonDetails(event.reasonCodes),confirmation:{policy:event.confirmationPolicy,requiresLaterClosedBar:true,observed:event.confirmedAt!=null,strictBeyondTrigger:true},
    risk:risk?{status:risk.status,quantity:risk.quantity,stop:risk.initialStop,target:risk.target,perContractRisk:risk.perContractRisk??null,totalPlannedRisk:risk.totalPlannedRisk??null,budget:risk.effectiveBudget??risk.parameterSnapshot?.riskBudget??null,commissionAllowance:risk.commissionAllowance??null,slippageAllowance:risk.slippageAllowance??null,pointValue:risk.parameterSnapshot?.pointValue??null,reasonDetails:reasonDetails(risk.reasonCodes)}:{status:event.parameterSnapshot?.config?.requireRisk?'NOT_PLANNED_REQUIRED':'OPTIONAL_NOT_PLANNED',reasonDetails:reasonDetails(event.parameterSnapshot?.config?.requireRisk?['RISK_PARAMETERS_REQUIRED']:[])},
    higherTimeframe:{alignment:context.higherTimeframe?.alignment??'UNKNOWN',availability:copy(context.higherTimeframe?.availability??{}),reasonDetails:reasonDetails(context.higherTimeframe?.reasonCodes)},
    entryModels:describeGuideEntryModels(event,entryOptions),orderEligible:false,execution:'OBSERVATION_ONLY',
    provenance:{definitionVersion:event.definitionVersion,sourceKind:'original_research_definition',contextCutoff:context.freezeTime??null,parameterSnapshot:copy(event.parameterSnapshot)},
  };
}
function describeFamilies(analysis,checks,index){
  const latestEvents=(analysis.events??[]).filter(event=>event.signalIndex===index),currentPatterns=analysis.patterns?.byBar?.[index]?.patternIds??[];
  const definitions=[['TREND_CONTINUATION','המשך מגמה','trendMatch','4.3'],['REVERSAL_AT_ZONE','היפוך ברמה מוכרת','reversal','4.3'],['RANGE_EDGE','דחייה מקצה דשדוש','rangeEdge','3.6'],['INSIDE_BREAKOUT','פריצת Inside Bar',null,'6.4'],['INSIDE_FALSE_BREAK','פריצת שווא וחזרה לטווח',null,'6.5'],['HANGING_MAN_REVERSAL','Hanging Man לאחר עלייה','hangingMan','2.8'],['INVERTED_HAMMER_REVERSAL','Inverted Hammer לאחר ירידה','invertedHammer','2.9'],['ENGULFING_RANGE_RECLAIM','בליעה וחזרה לתוך דשדוש','rangeReclaim','5.1'],['ROLE_REVERSAL_RETEST','בדיקה חוזרת של אזור שהחליף תפקיד','roleReversal','3.4']];
  return definitions.map(([id,label,predicate,guideSection])=>({id,label,guideSection,directions:['LONG','SHORT'].map(direction=>{
    const filter=checks?.directions?.[direction],structure=filter?.checks?.find(check=>check.id==='STRUCTURE'),matches=latestEvents.filter(event=>event.direction===direction&&(predicate?event.setupId===id||event.setupId===id+'_INSIDE':event.patternIds.includes(id)));
    const contextual=predicate==='hangingMan'||predicate==='invertedHammer',expectedDirection=predicate==='hangingMan'?'SHORT':'LONG',contextPresent=contextual?direction===expectedDirection&&structure?.evidence?.state===(predicate==='hangingMan'?'TREND_UP':'TREND_DOWN'):predicate?structure?.evidence?.[predicate]===true:null;
    const study=id==='INSIDE_BREAKOUT'?analysis.insideStudies?.breakout:id==='INSIDE_FALSE_BREAK'?analysis.insideStudies?.false_break:null;
    return {direction,state:contextual&&direction!==expectedDirection?'NOT_APPLICABLE':matches.length?'CANDIDATE_EVALUATED':predicate?contextPresent?'CONTEXT_PRESENT_NO_MATCHING_SETUP':'CONTEXT_CONDITION_NOT_MET':study?.active?'WAITING_INSIDE_SEQUENCE':'NO_CURRENT_SEQUENCE_EVENT',contextPresent,
      activeInsideSequence:study?.active?copy(study.active):null,candidateIds:matches.map(event=>event.eventId),candidateStatuses:matches.map(event=>event.status),currentPatternIds:[...currentPatterns],
      requiredFiltersPassed:filter?.passed??null,missingRequiredConditions:reasonDetails(filter?.reasonCodes),conditionsMet:filter?.conditionsMet??null,conditionsAreStatisticallyIndependent:false,
      note:'חישוב מקביל של תרחיש; מצב הקשר לבדו אינו איתות מאושר',orderEligible:false};
  })}));
}

function describeStrategyScan(value,baseline){
  if(value.approvalPolicy!=='guide_scenarios_v1'||!Array.isArray(value.strategyProfiles))return null;
  const names={CANDLE_TREND_AT_ZONE:'נר עם מגמה באזור מחיר',CANDLE_REVERSAL_AT_ZONE:'היפוך באזור מחיר',CANDLE_RANGE_EDGE:'נר בקצה טווח',PIN_TREND_AT_ZONE:'פין עם המגמה',PIN_CONFLUENCE:'פין עם מפגש גורמים',PIN_RANGE_EDGE:'פין בקצה טווח',ENGULFING_EMA:'בליעה עם EMA',ENGULFING_FIB:'בליעה עם פיבונאצ׳י',ENGULFING_TRENDLINE:'בליעה עם קו מגמה',ENGULFING_RANGE:'בליעה בקצה טווח',ENGULFING_SUPPLY_DEMAND:'בליעה עם היצע וביקוש',ENGULFING_RANGE_RECLAIM:'בליעה וחזרה לטווח',HANGING_MAN_REVERSAL:'Hanging Man',INVERTED_HAMMER_REVERSAL:'Inverted Hammer',INSIDE_BREAKOUT:'פריצת נר פנימי',INSIDE_FALSE_BREAK:'פריצת שווא של נר פנימי',INSIDE_FALSE_BREAK_FIB:'פריצת שווא עם פיבונאצ׳י',ROLE_REVERSAL_RETEST:'החלפת תפקיד ובדיקה חוזרת'};
  const events=value.events??[],afterBaseline=e=>baseline!==null&&finite(e.formationStartTime)&&e.formationStartTime>baseline;
  const profiles=value.strategyProfiles.map(profile=>{
    const candidates=events.filter(e=>e.strategyId===profile.id),latest=[...candidates].sort((a,b)=>b.barCloseTime-a.barCloseTime||b.knownAt-a.knownAt)[0];
    const required=(latest?.contextSnapshot?.checks??[]).filter(c=>profile.requiredCheckIds.includes(c.id));
    return {id:profile.id,label:names[profile.id]??profile.id,requiredCheckIds:[...profile.requiredCheckIds],candidates:candidates.length,afterBaselineCandidates:baseline===null?null:candidates.filter(afterBaseline).length,
      latest:latest?{eventId:latest.eventId,direction:latest.direction,barCloseTime:latest.barCloseTime,formationStartTime:latest.formationStartTime,status:latest.status,statusLabel:statusLabels[latest.status]??latest.status,
        afterBaseline:baseline===null?null:afterBaseline(latest),requiredPassed:required.filter(c=>c.passed===true&&c.available===true&&c.enabled===true).length,requiredTotal:profile.requiredCheckIds.length,
        checks:required.map(describeFilter),reasonDetails:reasonDetails(latest.reasonCodes)}:null};
  });
  return {policy:value.approvalPolicy,signalTimeframe:value.metadata?.timeframe??null,contextTimeframes:Object.keys(value.currentChecks?.directions?.LONG?.checks?.find(c=>c.id==='HIGHER_TIMEFRAME')?.evidence?.availability??{}),
    closedBars:value.stats?.closedBars??0,shapeDetections:value.stats?.patterns??0,candidateEvaluations:events.length,confirmedCandles:value.signals?.length??0,
    baseline,afterBaselineCandidates:baseline===null?null:events.filter(afterBaseline).length,profiles,scope:'CURRENT_CLOSED_CONTEXT_WINDOW_NOT_EXECUTED_OR_MISSED_TRADES',diagnosticOnly:true};
}

export function describeGuideAnalysis(analysis,{maxScenarios=120,barIndex,liveSourceBaseline=null}={}){
  if(!Number.isSafeInteger(maxScenarios)||maxScenarios<1||maxScenarios>10000)throw TypeError('INVALID_EXPLANATION_SCENARIO_LIMIT');
  if(liveSourceBaseline!==null&&(!finite(liveSourceBaseline)||liveSourceBaseline<0))throw TypeError('INVALID_EXPLANATION_SOURCE_BASELINE');
  const value=analysis??{},index=barIndex??((value.patterns?.byBar?.length??0)-1);
  if(!Number.isSafeInteger(index)||index< -1||index>=(value.patterns?.byBar?.length??0)&&index!==-1)throw TypeError('INVALID_EXPLANATION_BAR_INDEX');
  const checks=value.currentChecks,indexIsCurrent=index===checks?.barIndex,context=value.context??{},allEvents=value.events??[];
  const entryOptions={bars:(value.patterns?.byBar??[]).map(row=>({...row.ohlc,time:row.time,closeTime:row.closeTime,knownAt:row.knownAt,closed:row.closed})),metadata:value.metadata??{},risk:value.parameterSnapshot?.risk??null,asOfTime:value.asOfTime??Date.now()},selected=allEvents.slice(-maxScenarios),scenarios=selected.map(event=>describeScenario(event,entryOptions)),directions={};
  for(const direction of ['LONG','SHORT']){
    const frozen=indexIsCurrent?checks?.directions?.[direction]:null;
    directions[direction]={available:!!frozen,freezeTime:frozen?.freezeTime??null,setupKind:frozen?.setupKind??null,passed:frozen?.passed??false,conditionsMet:frozen?.conditionsMet??0,checks:(frozen?.checks??[]).map(describeFilter),missingRequiredConditions:reasonDetails(frozen?.reasonCodes)};
  }
  const filterCoverage=Object.keys(filterLabels).map(id=>({id,label:filterLabels[id],directions:Object.fromEntries(['LONG','SHORT'].map(direction=>{const check=directions[direction].checks.find(item=>item.id===id);return [direction,check?{state:check.state,required:check.required,available:check.available,enabled:check.enabled,passed:check.passed,reasonDetails:check.reasonDetails}:{state:'UNAVAILABLE',required:null,available:false,enabled:null,passed:false,reasonDetails:reasonDetails(['NO_CLOSED_AVAILABLE_BARS'])}];}))}));
  const headline=value.status==='BLOCKED'?'הניתוח חסום בגלל נתונים או הגדרות לא תקינים':value.status==='WAITING'?'ממתין לנר סגור זמין':value.stats?.confirmed>0?'קיימים איתותי מחקר מאושרים ביומן; יש לבדוק את זמן האישור':value.status==='WAITING_CONFIRMATION'?'קיימים תרחישים שממתינים לסגירה מאשרת':'לא נמצא איתות מחקר מאושר לפי התנאים';
  return {version:GUIDE_EXPLANATION_VERSION,status:value.status??'NO_ANALYSIS',headline,asOfTime:value.asOfTime??null,barIndex:index,orderEligible:false,
    market:{valid:context.valid??false,state:context.state??'UNKNOWN',stateLabel:{TREND_UP:'מגמה עולה',TREND_DOWN:'מגמה יורדת',RANGE:'דשדוש',TRANSITION:'מעבר או מבנה מעורב',UNKNOWN:'אין מספיק מידע לקביעת מבנה'}[context.state??'UNKNOWN'],asOf:context.asOf??null,barsUsed:context.barsUsed??0,pivots:copy(context.pivots??[]),zones:copy(context.zones??[]),nearestSupport:copy(context.nearestSupport),nearestResistance:copy(context.nearestResistance),range:copy(context.range),location:copy(context.location),indicators:copy(context.indicators?.latest??{}),fib:copy(context.fib),trendlines:copy(context.trendlines??[]),supplyDemand:{...copy(context.supplyDemand??{enabled:false,zones:[]}),institutionalActivityInferred:false},reasonDetails:reasonDetails(context.reasonCodes)},
    patternChecks:describePatterns(value.patterns,index).map(pattern=>{const required=pattern.id==='HANGING_MAN_SHAPE'?'TREND_UP':pattern.id==='INVERTED_HAMMER_SHAPE'?'TREND_DOWN':null;if(!required)return pattern;const event=allEvents.find(event=>event.signalIndex===index&&event.patternIds.includes(pattern.id)),observed=event?.contextSnapshot?.context?.state??(indexIsCurrent?checks?.directions?.[pattern.direction]?.context?.state:null);return {...pattern,contextualApplicability:{requiredPriorState:required,observedPriorState:observed??'UNKNOWN',state:observed==null?'UNAVAILABLE':observed===required?'APPLICABLE':'NOT_APPLICABLE',shapeMatchIsNotContextConfirmation:true}};}),directions,filterCoverage,
    neutralObservations:['DOJI','INSIDE_BAR','OUTSIDE_BAR'].map(id=>({id,label:labels[id],state:value.patterns?.byBar?.[index]?.patternIds?.includes(id)?'MATCHED_NEUTRAL_OBSERVATION':'NO_MATCH',direction:null,orderEligible:false,reason:'הצורה אינה קובעת כיוון; נדרש הקשר ואישור נפרדים'})),
    scenarioFamilies:indexIsCurrent?describeFamilies(value,checks,index):[],scenarios,
    strategyScan:indexIsCurrent?describeStrategyScan(value,liveSourceBaseline):null,
    technicalDecision:indexIsCurrent?selectGuideTechnicalDecision({analysis:value}):null,
    riskManagementMode:value.parameterSnapshot?.config?.requireRisk===false&&value.parameterSnapshot?.risk==null?'USER_MANAGED':'BOT_PLANNED',
    coverage:{patternDefinitions:GUIDE_PATTERN_DESCRIPTIONS.length,shapesMatchedAtBar:value.patterns?.byBar?.[index]?.patternIds?.length??0,totalCandidateScenarios:allEvents.length,displayedScenarios:scenarios.length,omittedHistoricalScenarios:Math.max(0,allEvents.length-selected.length),allCandidatesEvaluated:!!value.patterns&&value.status!=='BLOCKED',closedCandleConfirmationOnly:true,intrabarSequenceAvailable:false,entryModelsExecution:'PLANNING_ONLY',filters:filterCoverage,missingData:filterCoverage.filter(item=>Object.values(item.directions).some(check=>check.state==='UNAVAILABLE')).map(item=>item.id),optionalDisabled:filterCoverage.filter(item=>Object.values(item.directions).every(check=>check.state==='DISABLED')).map(item=>item.id)},
    reasonDetails:reasonDetails(value.reasonCodes),provenance:{definitionVersion:value.definitionVersion??null,sourceKind:value.sourceKind??null,metadata:copy(value.metadata??{}),contextKnownBeforeLatestPattern:checks?.freezeTime??null,guideFile:'Candlestick_Codex_Guide_HE.txt'},
  };
}
