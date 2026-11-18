// Plain DOM rendering: explanations are text, never executable HTML.
export function renderGuideAnalysis(container,explanation){
  const document=container.ownerDocument;
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(className)n.className=className;return n;};
  const value=v=>v===null||v===undefined?'חסר':typeof v==='number'?new Intl.NumberFormat('he-IL',{maximumFractionDigits:6}).format(v):typeof v==='object'?JSON.stringify(v):String(v);
  const names={PASS:'התקיים',FAIL:'לא התקיים',UNAVAILABLE:'מידע חסר',DISABLED:'כבוי',MATCH:'זוהתה',NO_MATCH:'לא זוהתה'};
  const details=(title,parent=container)=>{const d=node('details');d.append(node('summary',title));parent.append(d);return d;};
  const row=(text,state,parent)=>{const n=node('p',text,'analysis-row');if(state)n.dataset.state=state;parent.append(n);return n;};
  container.replaceChildren();if(!explanation){container.append(node('p','ממתין לניתוח חדש של נרות סגורים.','help'));return;}
  const technical=explanation.technicalDecision;
  if(technical){
    const card=node('article',undefined,'scenario-card');card.dataset.kind='technical-direction-decision';
    card.dataset.state=technical.status;card.dataset.direction=technical.direction??'';
    card.append(node('h3','אישור כיוון טכני · ניהול הסיכון בידיך'));
    const direction=technical.direction==='LONG'?'לונג':technical.direction==='SHORT'?'שורט':null;
    row(technical.status==='CONFIRMED'&&direction?`אישור טכני ל${direction} בנר הסגור האחרון: תרחיש וסגירה מאשרת; כל תנאי החובה של האסטרטגיות המאושרות התקיימו.`:
      technical.status==='AMBIGUOUS'?'אושרו תרחישי לונג ושורט באותה סגירה; אין כיוון יחיד לכניסה.':
      technical.status==='BLOCKED'?'אין אישור כיוון: נתוני הנר או אישור התרחיש אינם תקינים או זמינים.':
      'ממתין לתרחיש ולסגירה מאשרת, לפי תנאי החובה של כל אסטרטגיה.',technical.status==='CONFIRMED'?'PASS':null,card);
    if(Number.isSafeInteger(technical.asOfTime)&&Number.isFinite(new Date(technical.asOfTime).getTime()))row('מועד סגירת הנר שנבדק: '+new Date(technical.asOfTime).toISOString(),null,card);
    row((explanation.riskManagementMode==='USER_MANAGED'?'ניהול סיכון ידני: אישור הכיוון אינו תלוי בתקציב, בכמות או בתוכנית סיכון של הבוט. מסלול הביצוע מופעל בנפרד. ':'מסלול הכניסה האוטומטית בודק בנפרד את הגדרות הביצוע והסיכון שבחרת. ')+'אישור טכני מתאר התאמה לכללים; שיעור ההצלחה שלו טרם אומת.',null,card);
    container.append(card);
  }
  const market=explanation.market??{};
  row(`מבנה שוק: ${market.stateLabel??market.state??'לא ידוע'} · ${market.barsUsed??0} נרות. כל תרחיש משתמש רק בהקשר שהיה ידוע לפני היווצרותו.`,null,container);
  const scan=explanation.strategyScan;
  if(scan){
    const audit=node('section');audit.dataset.kind='per-strategy-scan';
    audit.append(node('h3',`סריקה לפי אסטרטגיה · ${scan.profiles.length} פרופילים`));
    row(`${scan.closedBars} נרות סגורים · ${scan.shapeDetections} זיהויי צורה · ${scan.candidateEvaluations} בדיקות מועמד · ${scan.confirmedCandles} נרות אישור. הספירות כוללות נרות הקשר; אינן עסקאות.`,null,audit);
    row(`תבניות כניסה: ${scan.signalTimeframe??'לא ידוע'} דקות · הקשר בלבד: ${scan.contextTimeframes.join(', ')||'לא סופק'} דקות. אין סריקת תבניות עצמאית בכל טווח.`,null,audit);
    if(scan.afterBaselineCandidates!==null)row(`מועמדים שהיווצרותם התחילה לאחר בסיס החיבור הנוכחי: ${scan.afterBaselineCandidates}. איפוס מקור יוצר בסיס חדש; נרות הקשר קודמים אינם כניסות חדשות.`,null,audit);
    row('לכל אסטרטגיה נספרים רק תנאי החובה שלה. מוצג המועמד האחרון שלה בחלון הנתונים, שאינו בהכרח מהנר הנוכחי. מספר תנאים אינו הסתברות להצלחה.',null,audit);
    for(const profile of scan.profiles){
      const latest=profile.latest,d=details(`${profile.label} · ${latest?`${latest.direction==='LONG'?'לונג':'שורט'} · ${latest.requiredPassed}/${latest.requiredTotal} תנאי חובה · ${latest.statusLabel}`:'לא זוהתה צורה מתאימה בחלון'}`,audit);
      if(!latest)continue;
      row(`סגירת התבנית: ${new Date(latest.barCloseTime).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})}${latest.afterBaseline===false?' · מלפני בסיס החיבור הנוכחי':latest.afterBaseline===true?' · לאחר בסיס החיבור הנוכחי':''}`,null,d);
      for(const check of latest.checks){row(`${check.label} · ${names[check.state]??check.state}`,check.state,d);row('מדידה: '+value(check.evidence),null,d);}
      for(const reason of latest.reasonDetails)row(reason.text??reason.code,null,d);
    }
    container.append(audit);
  }
  const grid=node('div',undefined,'scenario-grid');container.append(grid);
  for(const [direction,entry] of Object.entries(explanation.directions??{})){
    const card=node('article',undefined,'scenario-card');card.append(node('h3',direction==='LONG'?'תנאי כיוון לונג':'תנאי כיוון שורט'));
    row(scan?'סקירת הקשר כללית בלבד. תנאי החובה וספירתם נקבעים בנפרד לכל אסטרטגיה בסריקה לעיל.':`${entry.conditionsMet??0} תנאים התקיימו. ${entry.passed?'המסננים הנדרשים עברו; עדיין נדרשות תבנית וסגירה מאשרת.':'טרם התקיימו כל התנאים הנדרשים.'}`,!scan&&entry.passed?'PASS':null,card);
    for(const check of entry.checks??[]){
      const d=details(`${check.label} · ${names[check.state]??check.state} · ${scan?'נדרש רק באסטרטגיות המתאימות':check.required?'חובה':'אופציונלי'}`,card);
      row(check.rule??check.text,check.state,d);row('מדידה: '+value(check.evidence),null,d);
      for(const reason of check.reasonDetails??[])row(reason.label??reason.text??reason.code,null,d);
    }
    grid.append(card);
  }
  const patterns=details(`${explanation.coverage?.patternDefinitions??explanation.patternChecks?.length??0} הגדרות צורת נרות · ${explanation.coverage?.shapesMatchedAtBar??0} התאמות בנר הסגור האחרון`);
  const patternGrid=node('div',undefined,'scenario-grid');patterns.append(patternGrid);
  for(const pattern of explanation.patternChecks??[]){
    const card=node('article',undefined,'scenario-card');card.dataset.state=pattern.state;
    card.append(node('h3',`${pattern.label} · ${names[pattern.state]??pattern.state}`));card.append(node('p',pattern.interpretation,'help'));
    const more=details('הספים והמדידות',card);
    for(const condition of pattern.conditions??[])row(`${condition.label??condition.id}: ${value(condition.actual)} · כלל ${value(condition.comparator??condition.operator)} ${value(condition.threshold??condition.expected)} · ${condition.passed?'עבר':'לא עבר'}`,condition.state??(condition.passed?'PASS':'FAIL'),more);
    for(const reason of pattern.reasonDetails??[])row(reason.label??reason.text??reason.code,'UNAVAILABLE',more);
    const link=node('a','הסבר ודוגמה במדריך');link.href=pattern.provenance?.guideLink??'guide-library.html';link.target='_blank';link.rel='noopener';card.append(link);patternGrid.append(card);
  }
  const families=details('חישוב מקביל של משפחות תרחישים');
  for(const family of explanation.scenarioFamilies??[]){
    const d=details(family.label,families);for(const entry of family.directions??[])row(`${entry.direction}: ${entry.state} · מועמדים ${(entry.candidateIds??[]).length} · ${entry.conditionsMet??0} תנאים`,null,d);
  }
  const scenarios=details(`יומן נימוקי המערכים · ${explanation.coverage?.displayedScenarios??0} מוצגים מתוך ${explanation.coverage?.totalCandidateScenarios??0}`);
  if(!explanation.scenarios?.length)row('טרם נמצא מערך. כישלון בהתאמת צורה אינו איתות הפוך.',null,scenarios);
  for(const scenario of (explanation.scenarios??[]).slice().reverse()){
    const d=details(`${scenario.patternLabels.join(' + ')} · ${scenario.direction} · ${scenario.label}`,scenarios);
    row(`תחילת היווצרות ${value(scenario.timing?.formationStartTime)} · אישור ${value(scenario.timing?.confirmedAt)} · טריגר ${value(scenario.levels?.confirmationTrigger)} · ביטול ${value(scenario.levels?.invalidation)}`,null,d);
    for(const check of scenario.conditions??[])row(`${check.label} · ${names[check.state]??check.state} · ${check.required?'נדרש':'אופציונלי'}`,check.state,d);
    for(const reason of scenario.reasonDetails??[])row(reason.label??reason.text??reason.code,null,d);
    const risk=scenario.risk??{};row(`תוכנית סיכון: ${risk.status} · כמות ${value(risk.quantity)} · סיכון כולל ${value(risk.totalPlannedRisk)} · תקציב ${value(risk.budget)}`,null,d);
    const raw=details('עדות מספרית מלאה',d),pre=node('pre',JSON.stringify(scenario,null,2));pre.dir='ltr';raw.append(pre);
  }
  row('הגדרות צורה ותרחישים מחקריות. בחינת צורות ונתוני מחיר אינה הוכחה לרווחיות או לביצוע עסקה.','',container);
}
