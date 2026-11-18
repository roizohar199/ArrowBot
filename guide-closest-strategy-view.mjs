import {describeGuideFormingPreview} from './guide-forming-view.mjs';
import {describeGuideStrategyStatus,GUIDE_STRATEGY_LABELS} from './guide-strategy-status.mjs';
import {getGuideStrategyProfile,GUIDE_STRATEGY_PROFILES} from './guide-strategy-policy.mjs';

const labels={STRUCTURE:'מבנה השוק',KNOWN_LOCATION:'אזור מחיר',EMA:'EMA',FIB:'פיבונאצ׳י',TRENDLINE:'קו מגמה',SUPPLY_DEMAND:'היצע וביקוש',HIGHER_TIMEFRAME:'מסגרת זמן גבוהה'};
const passed=c=>c?.enabled!==false&&c?.available===true&&c.passed===true&&c.state==='PASS'&&c.pendingConfirmation!==true;
const number=value=>new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(value);
const contexts=new WeakMap();
function contextFor(analysis){
  if(!analysis||typeof analysis!=='object')return null;
  if(!contexts.has(analysis))contexts.set(analysis,{valid:describeGuideStrategyStatus(analysis).status==='ACTIVE',events:(analysis.events??[]).filter(e=>e.status==='ARMED'||e.status==='REJECTED'&&analysis.asOfTime-e.barCloseTime>=0&&analysis.asOfTime-e.barCloseTime<(analysis.metadata?.timeframeMs??60000))});
  return contexts.get(analysis);
}

// Read-only ranking of actual strategy-engine setups, never trade eligibility.
// Context counts use each profile's own requirements; risk is not ranked here.
export function describeClosestGuideStrategy(preview,{analysis,...options}={}){
  const live=describeGuideFormingPreview(preview,options),base={status:live.status,message:live.message,candidate:null,candidates:[],candidateOnly:true,signalApproved:false,orderEligible:false,probabilityComputed:false};
  if(live.status!=='PREVIEW')return base;
  const context=contextFor(analysis);
  if(!context?.valid||analysis.metadata?.sourceId!==live.sourceIdentity?.sourceId||analysis.metadata?.instrument!==live.sourceIdentity?.instrument||analysis.metadata?.timeframe!==live.sourceIdentity?.timeframe||analysis.asOfTime<live.openBarTime||analysis.asOfTime>=live.openBarCloseTime)return {...base,status:'UNAVAILABLE',message:'ממתין להקשר אסטרטגיות מעודכן מאותו מקור.'};
  const pending=new Map((preview.pendingConfirmations??[]).map(item=>[item.eventId,item])),rows=[];
  for(const event of context.events){
    const profile=getGuideStrategyProfile(event.strategyId),proof=event.strategyProof;
    if(!profile||proof?.profileId!==profile.id||proof.applicable!==true||!['LONG','SHORT'].includes(event.direction)||event.instrument!==analysis.metadata.instrument||event.timeframe!==analysis.metadata.timeframe||event.detectedAt>analysis.asOfTime)continue;
    const current=pending.get(event.eventId),armed=event.status==='ARMED'&&current;
    // Failed/expired/consumed old setups must not compete as live opportunities.
    if(!armed&&!(event.status==='REJECTED'&&event.barCloseTime===live.openBarTime&&event.confirmedAt==null))continue;
    if(armed&&['FORMING_PRICE_BEYOND_INVALIDATION','FORMING_FROZEN_CONTEXT_BROKEN'].includes(current.state))continue;
    const checks=armed?current.checks:event.contextSnapshot?.checks;
    if(!Array.isArray(checks))continue;
    const required=profile.requiredCheckIds.map(id=>checks.filter(c=>c?.id===id)),missing=required.flatMap((items,index)=>items.length===1&&passed(items[0])?[]:[profile.requiredCheckIds[index]]);
    if(!armed&&!missing.length)continue;
    const count=profile.requiredCheckIds.length-missing.length,priceMet=armed&&current.checks.some(c=>c.id==='CONFIRMATION_PRICE'&&c.passed===true&&c.state==='PASS');
    const observed=current?.levels?.entryReference,trigger=event.trigger,distance=Number.isFinite(observed)&&Number.isFinite(trigger)?Math.max(0,event.direction==='LONG'?trigger-observed:observed-trigger):null;
    rows.push({eventId:event.eventId,patternIds:event.patternIds,profileId:profile.id,label:GUIDE_STRATEGY_LABELS[profile.id],direction:event.direction,phase:armed?'PENDING_CONFIRMATION':'MISSING_CONTEXT',passedCount:count,requiredCount:required.length,missingCheckIds:missing,missingLabels:missing.map(id=>labels[id]??id),priceMet:!!priceMet,trigger:Number.isFinite(trigger)?trigger:null,distancePoints:distance,detectedAt:event.detectedAt,sourceBarTime:event.barOpenTime,rank:count/required.length+(armed?2:0)+(priceMet?1:0)});
  }
  // Open-bar shapes can disappear. Project their measured checks onto matching
  // profiles, without rerunning history or inheriting unrelated global gates.
  for(const scenario of preview.scenarios??[]){
    if(!scenario.contextApplicable||!['LONG','SHORT'].includes(scenario.direction)||!['FORMING_CANDIDATE','FORMING_CANDIDATE_MISSING_REQUIRED_CONTEXT'].includes(scenario.state))continue;
    const ids=scenario.patternIds??[scenario.patternId];
    for(const profile of GUIDE_STRATEGY_PROFILES){
      if(!(profile.family?profile.family===scenario.family:profile.applicableSetupKinds.includes(scenario.family))||!profile.patterns.some(id=>ids.includes(id)))continue;
      const required=profile.requiredCheckIds.map(id=>(scenario.checks??[]).filter(c=>c.id===id)),missing=required.flatMap((items,index)=>items.length===1&&passed(items[0])?[]:[profile.requiredCheckIds[index]]),count=required.length-missing.length;
      rows.push({eventId:`forming:${profile.id}:${scenario.direction}:${ids.join(',')}`,patternIds:ids,profileId:profile.id,label:GUIDE_STRATEGY_LABELS[profile.id],direction:scenario.direction,phase:'FORMING_PATTERN',passedCount:count,requiredCount:required.length,missingCheckIds:missing,missingLabels:missing.map(id=>labels[id]??id),priceMet:false,trigger:null,distancePoints:null,detectedAt:live.openBarTime,sourceBarTime:live.openBarTime,rank:count/required.length});
    }
  }
  rows.sort((a,b)=>b.rank-a.rank||b.detectedAt-a.detectedAt||(a.distancePoints??Infinity)-(b.distancePoints??Infinity)||a.eventId.localeCompare(b.eventId));
  // Show all armed setups and matching shapes with at most one missing context
  // condition. One row per strategy/direction keeps duplicate patterns out.
  const unique=new Map(),hiddenCandidates=[];
  for(const row of rows){
    if(row.phase!=='PENDING_CONFIRMATION'&&(row.passedCount===0||row.missingCheckIds.length>1)){hiddenCandidates.push(row);continue;}
    const key=row.profileId+'|'+row.direction;if(!unique.has(key))unique.set(key,row);
  }
  const candidates=[...unique.values()].map(row=>({...row,oppositeDirectionTie:rows.some(other=>other.direction!==row.direction&&other.rank===row.rank)})),candidate=candidates[0]??null;
  return {...base,status:candidate?'TRACKING':'WAITING_PATTERN',message:candidate?'תנאים זמניים בלבד · לא איתות כניסה':'טרם נמצא מערך קרוב לאישור.',sourceObservedAt:live.sourceObservedAt,openBarTime:live.openBarTime,candidate,candidates,hiddenCandidates};
}

export const CLOSEST_STRATEGIES_COLLAPSED_KEY='arrow.closest-strategies.collapsed.v1';
export function createClosestGuideStrategyView(container,{storage}={}){
  if(!container?.ownerDocument)throw TypeError('CLOSEST_STRATEGY_CONTAINER_REQUIRED');
  const doc=container.ownerDocument,node=(tag,cls)=>{const n=doc.createElement(tag);n.className=cls;return n;},set=(n,value)=>{if(n.textContent!==value)n.textContent=value;};
  try{storage??=doc.defaultView?.localStorage;}catch{}
  const disclosure=node('details','closest-strategies-disclosure'),summary=node('summary','closest-strategies-toggle'),heading=node('h2','closest-strategies-heading'),count=node('span','closest-strategies-count'),toggle=node('span','closest-strategies-action'),body=node('div','closest-strategies-body'),empty=node('p','closest-strategy-empty'),list=node('div','closest-strategies-list'),note=node('small','closest-strategy-note');
  heading.id='closest-strategy-title';heading.textContent='אסטרטגיות קרובות לאישור';summary.append(heading,count,toggle);body.append(empty,list,note);disclosure.append(summary,body);container.replaceChildren(disclosure);
  let model=null,order='',collapsed=false;const slots=new Map();
  try{collapsed=storage?.getItem(CLOSEST_STRATEGIES_COLLAPSED_KEY)==='true';}catch{}
  disclosure.open=!collapsed;
  const updateToggle=()=>set(toggle,disclosure.open?'צמצום':'הרחבה');updateToggle();
  disclosure.addEventListener('toggle',()=>{updateToggle();try{storage?.setItem(CLOSEST_STRATEGIES_COLLAPSED_KEY,String(!disclosure.open));}catch{}});
  function paint(value){
    model=value;const entries=value.candidates??[];container.dataset.state=value.status;container.dataset.direction=value.candidate?.direction??'';
    set(count,entries.length?String(entries.length):'');set(empty,value.message);empty.hidden=!!entries.length;list.hidden=!entries.length;note.hidden=!entries.length;
    set(note,'תנאים זמניים בלבד · לא איתות כניסה. מוצגים מערכים הממתינים לאישור ותבניות שחסר להן עד תנאי הקשר אחד.');
    for(const c of entries){
      const key=c.profileId+'|'+c.direction;let slot=slots.get(key);
      if(!slot){const row=node('article','closest-strategy-row'),title=node('strong','closest-strategy-name'),progress=node('p','closest-strategy-progress'),missing=node('p','closest-strategy-missing');row.append(title,progress,missing);slot={row,title,progress,missing};slots.set(key,slot);}
      slot.row.dataset.direction=c.direction;slot.row.dataset.strategyId=c.profileId;
      set(slot.title,`${c.label} · ${c.direction==='LONG'?'לונג':'שורט'}`);
      set(slot.progress,`${c.passedCount}/${c.requiredCount} תנאי האסטרטגיה · ${c.phase==='FORMING_PATTERN'?'תבנית בתוך הנר':c.phase==='MISSING_CONTEXT'?'הנר הסגור האחרון':c.priceMet?'ממתין לסגירה מאשרת':'ממתין לתנאי המחיר'}`);
      set(slot.missing,c.missingLabels.length?`חסר: ${c.missingLabels.join(' · ')}`:c.phase==='FORMING_PATTERN'?'ממתין לסגירת התבנית ולאישור בנר מאוחר':c.priceMet?'טרם התקבלה סגירה מאשרת':`רמת אישור ${number(c.trigger)}${c.distancePoints!==null?` · מרחק ${number(c.distancePoints)} נק׳`:''}`);
    }
    const next=entries.map(c=>c.profileId+'|'+c.direction),signature=next.join(';');
    if(signature!==order){list.replaceChildren(...next.map(key=>slots.get(key).row));order=signature;for(const key of slots.keys())if(!next.includes(key))slots.delete(key);}
    return {...structuredClone(value),collapsed:!disclosure.open};
  }
  const view={render:(preview,options)=>paint(describeClosestGuideStrategy(preview,options)),clear:(message='ממתין למקור חי ולהקשר תקין.')=>paint({status:'UNAVAILABLE',message,candidate:null,candidates:[],candidateOnly:true,signalApproved:false,orderEligible:false,probabilityComputed:false}),snapshot:()=>model?{...structuredClone(model),collapsed:!disclosure.open}:null};
  view.clear();return view;
}
