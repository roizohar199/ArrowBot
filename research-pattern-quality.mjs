import {analyzeMarketContext} from './market-context.mjs';
import {validateHistoryBar} from './history-24-core.mjs';
import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';

export const QUALITY_VERSION='nq-pattern-quality-v1';
const minute=60_000,contextBars=120,minContext=20;
const frames=['5','15'];
const local=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const qualities=['session','zone','direction5','direction15','market','rsi','stochastic','bollinger','macd','rvol','vwap'];
export const researchBarAvailability=bar=>Math.max(bar.closeTime,bar.knownAt??bar.closeTime,bar.receivedAt??bar.closeTime);
export const researchBarsAdjacent=(left,right)=>left.closeTime===right.time&&!left.sessionLast&&!right.sessionFirst;

export function newYorkBarSlot(time){
  const p=Object.fromEntries(local.formatToParts(time).map(({type,value})=>[type,value]));
  const minuteOfDay=Number(p.hour)*60+Number(p.minute);
  const session=minuteOfDay>=570&&minuteOfDay<630?'NEW_YORK_OPEN':minuteOfDay>=630&&minuteOfDay<960?'NEW_YORK_DAY':'OVERNIGHT';
  return {day:`${p.year}-${p.month}-${p.day}`,minuteOfDay,session};
}

function provenHigher(entry,tf,metadata){
  const m=entry?.metadata,bars=entry?.bars;
  const duration=Number(tf)*minute;
  if(m?.instrument!==metadata.instrument||m.sourceId!==metadata.sourceId||m.timeframe!==tf||m.session!==metadata.session||
    m.tickSize!==metadata.tickSize||m.chartType!=='standard'||!Array.isArray(bars)||bars.length<minContext||bars.length>4096||
    bars.some(bar=>!validateHistoryBar(bar,duration)||bar.synthetic===true||!Number.isFinite(researchBarAvailability(bar))))return null;
  const proof=deriveVerifiedSessionGaps(bars);
  return proof.valid?{bars:bars.map(bar=>({...bar,knownAt:researchBarAvailability(bar)})),gaps:proof.gaps,duration,cache:new Map()}:null;
}

function knownContext(bars,end,asOf,gaps,tickSize){
  if(end+1<minContext)return null;
  const prefix=bars.slice(Math.max(0,end+1-contextBars),end+1);
  if(prefix.some(bar=>bar.knownAt>asOf))return null;
  const result=analyzeMarketContext(prefix,{asOf,sessionGaps:gaps,tickSize,zoneToleranceTicks:4,roleReversalEnabled:true});
  return result.valid?result:null;
}

function latestClosed(bars,cutoff){
  let start=0,end=bars.length;
  while(start<end){
    const mid=Math.floor((start+end)/2);
    if(bars[mid].closeTime<=cutoff)start=mid+1;
    else end=mid;
  }
  return start-1;
}

function higherContext(series,closeTime,knownAt,tickSize){
  if(!series)return {state:'UNKNOWN',closeTime:null};
  const {bars,duration,gaps,cache}=series;
  let end=latestClosed(bars,closeTime);
  while(end>=0&&bars[end].knownAt>knownAt)end--;
  if(end<0||closeTime-bars[end].closeTime>=duration)return {state:'UNKNOWN',closeTime:null};
  if(!cache.has(end)){
    const ready=bars.slice(Math.max(0,end+1-contextBars),end+1).every(bar=>bar.knownAt<=knownAt);
    if(ready)cache.set(end,knownContext(bars,end,knownAt,gaps,tickSize)?.state??'UNKNOWN');
  }
  const state=cache.get(end)??'UNKNOWN';
  // A late interior receipt can leave this prefix unusable at an earlier observation.
  if(state!=='UNKNOWN'&&bars.slice(Math.max(0,end+1-contextBars),end+1).some(bar=>bar.knownAt>knownAt))return {state:'UNKNOWN',closeTime:null};
  return {state,closeTime:bars[end].closeTime};
}

function zoneAt(context,bar){
  const zones=context?.zones?.filter(zone=>zone.active)??[];
  if(!zones.length)return {zone:context?'NO_ACTIVE_ZONE':'UNKNOWN',levels:[]};
  const touch=zones.filter(zone=>bar.low<=zone.upper&&bar.high>=zone.lower);
  const types=new Set(touch.map(zone=>zone.type));
  return {zone:types.size>1?'BOTH_ZONES':types.has('SUPPORT')?'SUPPORT':types.has('RESISTANCE')?'RESISTANCE':'AWAY',
    levels:touch.slice(0,6).map(({type,lower,upper,knownAt})=>({type,lower,upper,knownAt}))};
}

export function followingCloseChange(bars,index,n){
  for(let i=index+1;i<=index+n;i++)if(!bars[i]||!researchBarsAdjacent(bars[i-1],bars[i]))return null;
  return bars[index+n].close-bars[index].close;
}

function summarized(bucket,horizon){
  const {total,days,eligible,favorable,flat,matched,matchedFavorable,expected}=bucket;
  return {horizon,total,days:days.size,eligible,favorable,flat,matched,matchedFavorable,
    baselineRate:matched?expected/matched:null,missing:total-eligible};
}

export function analyzePatternQuality({bars,groups,metadata,higherTimeframes,sessionGaps,horizons,indicatorContext=[]}){
  const source=bars.map(bar=>({...bar,knownAt:researchBarAvailability(bar)}));
  const higher=Object.fromEntries(frames.map(tf=>[tf,provenHigher(higherTimeframes?.[tf],tf,metadata)]));
  const hits=new Map();
  for(const group of groups)for(const hit of group.detections){
    const sameBar=hits.get(hit.endIndex)??[];
    sameBar.push({group,hit});hits.set(hit.endIndex,sameBar);
  }
  const controls=new Map(),exposures=[];
  const getKey=(row,dimension,horizon)=>JSON.stringify([row.day,Math.floor(row.minuteOfDay/30),row.session,dimension,row[dimension],horizon]);
  for(const [i,bar] of source.entries()){
    const slot=newYorkBarSlot(bar.time),matched=hits.get(i);
    // Hold the levels before this candle. Its range can subsequently touch them.
    const context=knownContext(source,i-1,bar.knownAt,sessionGaps,metadata.tickSize);
    const at5=higherContext(higher['5'],bar.closeTime,bar.knownAt,metadata.tickSize);
    const at15=higherContext(higher['15'],bar.closeTime,bar.knownAt,metadata.tickSize);
    const row={...slot,...zoneAt(context,bar),market:context?.state??'UNKNOWN',
      ...indicatorContext[i],
      direction5:at5.state,direction15:at15.state,close5:at5.closeTime,close15:at15.closeTime};
    if(matched){
      for(const {group,hit} of matched){hit.context=row;exposures.push({group,hit,row});}
      continue;
    }
    for(const [index,n] of horizons.entries()){
      const change=followingCloseChange(source,i,n);
      if(change===null)continue;
      for(const dim of qualities){
        if(row[dim]===undefined)continue;
        const key=getKey(row,dim,index),cnt=controls.get(key)??{total:0,up:0,down:0};
        cnt.total++;if(change>0)cnt.up++;if(change<0)cnt.down++;
        controls.set(key,cnt);
      }
    }
  }
  const grouped=new Map();
  for(const {group,hit,row} of exposures){
    for(const dim of qualities){
      if(row[dim]===undefined)continue;
      for(const [index,horizon] of horizons.entries()){
        const key=JSON.stringify([group.id,dim,row[dim],horizon]);
        const bucket=grouped.get(key)??{patternId:group.id,dimension:dim,value:row[dim],horizon,
          days:new Set(),total:0,eligible:0,favorable:0,flat:0,expected:0,matched:0,matchedFavorable:0};
        bucket.total++;bucket.days.add(row.day);
        const observed=hit.horizons[index];
        if(observed.status==='AVAILABLE'){
          const short=hit.direction==='SHORT';
          const wentWith=short?observed.change<0:observed.change>0;
          bucket.eligible++;if(wentWith)bucket.favorable++;
          if(observed.change===0)bucket.flat++;
          const control=controls.get(getKey(row,dim,index));
          if(control){bucket.expected+=(short?control.down:control.up)/control.total;bucket.matched++;if(wentWith)bucket.matchedFavorable++;}
        }
        grouped.set(key,bucket);
      }
    }
  }
  return {version:QUALITY_VERSION,displayOnly:true,timezone:'America/New_York',nativeFrames:Object.fromEntries(frames.map(tf=>[tf,!!higher[tf]])),
    rows:[...grouped.values()].map(row=>({patternId:row.patternId,dimension:row.dimension,value:row.value,...summarized(row,row.horizon)}))};
}
