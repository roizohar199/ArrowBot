import {describeGuideReason} from './guide-explanations.mjs';

const limit=20;
const key='arrow.closest-strategies.journal.v1';
const clock=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const phases={
  FORMING_PATTERN:'תבנית בתוך נר פתוח',MISSING_CONTEXT:'חסר תנאי הקשר',PENDING_CONFIRMATION:'ממתין לתנאי מחיר',
  PRICE_MET:'ממתין לסגירה מאשרת',UNAVAILABLE:'נתונים לא זמינים',HIDDEN:'ירד מהתצוגה',
  CONFIRMED:'אושר',INVALIDATED:'בוטל',EXPIRED:'פקע',REJECTED:'נדחה',AMBIGUOUS:'אישור עמום',
};
const terminal=new Set(['CONFIRMED','INVALIDATED','EXPIRED','REJECTED','AMBIGUOUS']);
const rowKey=row=>JSON.stringify([row.profileId,row.direction]);
const phase=row=>row.priceMet?'PRICE_MET':row.phase;
const fingerprint=row=>JSON.stringify([row.eventId,row.sourceBarTime,phase(row),row.missingCheckIds,row.trigger]);
const finite=value=>Number.isFinite(value)?value:null;
const format=value=>new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(value);
const matchScope=(a,b)=>a?.sessionId===b?.sessionId&&a?.sourceId===b?.sourceId&&a?.instrument===b?.instrument&&a?.timeframe===b?.timeframe;

function transition(row,to,reason,levels={}){
  return {profileId:row.profileId,eventId:row.eventId,sourceBarTime:row.sourceBarTime,label:row.label,
    direction:row.direction,missingLabels:row.missingLabels,trigger:finite(levels.confirmationTrigger??row.trigger),
    invalidation:finite(levels.invalidation),observedPrice:finite(levels.entryReference),to,reason};
}

function departure(row,replacement,{model,preview,analysis}){
  const event=analysis?.events?.find(item=>row.phase==='FORMING_PATTERN'
    ?item.barOpenTime===row.sourceBarTime&&item.strategyId===row.profileId&&item.direction===row.direction&&item.patternIds?.some(id=>row.patternIds?.includes(id))
    :item.eventId===row.eventId);
  if(terminal.has(event?.status)&&(row.phase!=='MISSING_CONTEXT'||event.status!=='REJECTED')){
    const reasons=event.reasonCodes?.map(describeGuideReason).join(' · ');
    return transition(row,event.status,reasons||phases[event.status],{confirmationTrigger:event.trigger,invalidation:event.invalidation});
  }
  const pending=preview?.pendingConfirmations?.find(item=>item.eventId===row.eventId);
  if(pending?.state==='FORMING_PRICE_BEYOND_INVALIDATION'){
    return transition(row,'HIDDEN','המחיר בנר הפתוח עבר את רמת הביטול',pending.levels);
  }
  if(pending?.state==='FORMING_FROZEN_CONTEXT_BROKEN'){
    const reasons=pending.checks?.find(check=>check.id==='FROZEN_CONTEXT')?.reasonCodes?.map(describeGuideReason).join(' · ');
    return transition(row,'HIDDEN',reasons||'תנאי ההקשר המקוריים השתנו בנר הפתוח',pending.levels);
  }
  const excluded=model.hiddenCandidates?.find(item=>rowKey(item)===rowKey(row)&&item.eventId===row.eventId&&item.sourceBarTime===row.sourceBarTime);
  if(excluded)return transition(excluded,'HIDDEN',`מחוץ לסף התצוגה. חסר ${excluded.missingLabels.join(', ')}`);
  if(row.phase==='FORMING_PATTERN'&&row.sourceBarTime!==model.openBarTime){
    return transition(row,'HIDDEN','הנר התחלף. המועמד מהנר הפתוח הסתיים ללא אישור שתועד ביומן');
  }
  if(row.phase==='FORMING_PATTERN'&&row.patternIds?.length&&Array.isArray(preview?.matchedPatternIds)&&
    row.patternIds.every(id=>!preview.matchedPatternIds.includes(id))){
    return transition(row,'HIDDEN','התבנית כבר אינה מזוהה בנר הפתוח');
  }
  if(replacement)return transition(row,'HIDDEN','מועמד אחר של אותה אסטרטגיה מוצג כעת');
  return transition(row,'HIDDEN',row.phase==='MISSING_CONTEXT'&&row.sourceBarTime!==model.openBarTime
    ?'הנר כבר אינו הנר הסגור האחרון שנבדק בתצוגה':'המועמד יצא מרשימת הקרובים לאישור');
}

function enter(row,previous){
  const to=phase(row);
  const reason=row.missingLabels.length?`חסר ${row.missingLabels.join(', ')}`:
    previous?.missingLabels.length?'תנאי ההקשר החסרים התקיימו':
    to==='PRICE_MET'?'המחיר מעבר לרמת האישור וממתין לסגירה':
    previous?.priceMet?'המחיר חזר לצד שלפני רמת האישור':
    to==='PENDING_CONFIRMATION'?'המועמד ממתין לתנאי המחיר':'התבנית מזוהה בנר הפתוח';
  return transition(row,to,reason);
}

function bounded(groups){
  let remaining=limit;
  const result=[];
  for(const group of groups){
    if(!remaining)break;
    const changes=group.changes.slice(-remaining);
    result.push({...group,changes});
    remaining-=changes.length;
  }
  return result;
}

export function createClosestStrategyJournal({storage}={}){
  let groups=[],scope=null,active=new Map(),connected=false,lastTime=-Infinity;
  try{
    const saved=JSON.parse(storage?.getItem(key)??'null');
    if(saved?.version===1&&Array.isArray(saved.groups)){
      groups=bounded(saved.groups.slice(0,limit).filter(group=>Number.isFinite(group?.at)&&group.at>=0&&group.at<=8.64e15&&
        typeof group.scope?.instrument==='string'&&Array.isArray(group.changes)&&group.changes.length&&
        group.changes.every(change=>typeof change?.reason==='string'&&typeof change.label==='string')));
    }
  }catch{}
  const snapshot=()=>({version:1,researchOnly:true,groups:structuredClone(groups)});
  function append(at,changes){
    if(!changes.length)return false;
    groups=bounded([{at,scope:{...scope},changes},...groups]);
    try{storage?.setItem(key,JSON.stringify({version:1,groups}));}catch{}
    return true;
  }

  function suspend(at,reason){
    if(!connected||!Number.isFinite(at)||at<lastTime)return false;
    connected=false;
    lastTime=at;
    const rows=[...active.values()];
    return append(at,[{label:'מקור הנתונים',direction:null,from:'TRACKING',to:'UNAVAILABLE',reason,
      affected:rows.map(({label,direction,eventId})=>({label,direction,eventId}))}]);
  }

  function observe({scope:nextScope,at,model,preview,analysis}){
    if(!nextScope?.sessionId||!nextScope.sourceId||!nextScope.instrument||!Number.isFinite(at)||!['TRACKING','WAITING_PATTERN'].includes(model?.status))return false;
    if(!matchScope(scope,nextScope)){
      scope={...nextScope};active=new Map();connected=true;lastTime=-Infinity;
    }
    if(at<lastTime)return false;
    const changes=[];
    if(!connected)changes.push({label:'מקור הנתונים',from:'UNAVAILABLE',to:'TRACKING',reason:'ניתוח המקור שוב זמין'});
    connected=true;lastTime=at;
    const next=new Map(model.candidates.map(row=>[rowKey(row),row]));
    for(const [id,previous] of active){
      const current=next.get(id);
      // The same open-bar candidate can become a closed setup as its source candle closes.
      const sameCandidate=current&&current.sourceBarTime===previous.sourceBarTime&&
        (current.eventId===previous.eventId||previous.phase==='FORMING_PATTERN'&&current.phase!=='FORMING_PATTERN'&&
          previous.patternIds?.some(patternId=>current.patternIds?.includes(patternId)));
      if(!sameCandidate)changes.push({...departure(previous,current,{model,preview,analysis}),from:phase(previous)});
      else if(fingerprint(current)!==fingerprint(previous))changes.push({...enter(current,previous),from:phase(previous)});
      if(sameCandidate)next.delete(id);
    }
    for(const row of next.values())changes.push({...enter(row),from:null});
    active=new Map(model.candidates.map(row=>[rowKey(row),row]));
    return append(at,changes);
  }

  return {observe,suspend,snapshot};
}

export function createClosestStrategyJournalView(container,{storage}={}){
  const doc=container.ownerDocument;
  try{storage??=doc.defaultView?.localStorage;}catch{}
  const journal=createClosestStrategyJournal({storage});
  const node=(tag,text)=>{const element=doc.createElement(tag);element.textContent=text;return element;};
  function render(){
    const {groups}=journal.snapshot();
    const list=groups.map(group=>{
      const update=node('li','');
      update.append(node('p',`${clock.format(group.at)} · ${group.scope.instrument} · ${group.scope.timeframe} דק׳`));
      for(const change of group.changes){
        const side=change.direction==='LONG'?' · לונג':change.direction==='SHORT'?' · שורט':'';
        const from=change.from&&phases[change.from],to=phases[change.to];
        update.append(node('strong',change.label+side));
        const levels=[['אישור',change.trigger],['ביטול',change.invalidation],['מחיר נצפה',change.observedPrice]]
          .filter(([,value])=>Number.isFinite(value)).map(([label,value])=>`${label} ${format(value)}`);
        const sourceBar=Number.isFinite(change.sourceBarTime)?`נר ${clock.format(change.sourceBarTime)} · `:'';
        const affected=change.affected?.map(row=>`${row.label} (${row.direction==='LONG'?'לונג':'שורט'})`).join(', ');
        update.append(node('p',[sourceBar+([from,to].filter(Boolean).join(' ← ')||'מקור הנתונים'),change.reason,...levels,affected].filter(Boolean).join(' · ')));
      }
      return update;
    });
    container.replaceChildren(...(list.length?list:[node('li','השינויים יופיעו כאן לאחר שנצפתה תנועה במועמדים.')]));
  }
  render();
  return {
    observe(input){if(journal.observe(input))render();},
    suspend(at,reason){if(journal.suspend(at,reason))render();},
    snapshot:journal.snapshot,
  };
}
