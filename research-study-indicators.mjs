import {researchBarAvailability,researchBarsAdjacent,newYorkBarSlot} from './research-pattern-quality.mjs';

export const STUDY_INDICATORS_VERSION='indicators-and-volume-v1';
const minSessions=5;
const finite=Number.isFinite,volume=bar=>finite(bar.volume)&&bar.volume>=0;
const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const median=values=>{const s=values.slice().sort((a,b)=>a-b),mid=Math.floor(s.length/2);return s.length%2?s[mid]:(s[mid-1]+s[mid])/2;};
const trailing=(values,n)=>values.slice(-n);

function ema(period){
  let value=null,count=0,seed=0;
  return input=>{
    if(value===null){
      seed+=input;count++;
      if(count===period)value=seed/period;
    }else value+=(input-value)*2/(period+1);
    return value;
  };
}

function momentum(){
  const closes=[],ranges=[],raw=[],smoothed=[],widths=[];
  const fast=ema(12),slow=ema(26),smooth=ema(9);
  let previous=null,gains=0,losses=0,count=0;
  return bar=>{
    const value=bar.close;
    closes.push(value);if(closes.length>20)closes.shift();
    ranges.push(bar);if(ranges.length>12)ranges.shift();
    if(ranges.length===12){
      const [low,high]=[Math.min(...ranges.map(row=>row.low)),Math.max(...ranges.map(row=>row.high))];
      raw.push(high>low?100*(value-low)/(high-low):null);
      if(raw.length>3)raw.shift();
      if(raw.length===3){
        smoothed.push(raw.every(finite)?average(raw):null);
        if(smoothed.length>3)smoothed.shift();
      }
    }
    if(previous!==null){
      const diff=value-previous;
      count++;
      if(count<=14){gains+=Math.max(0,diff)/14;losses+=Math.max(0,-diff)/14;}
      else {gains=(gains*13+Math.max(0,diff))/14;losses=(losses*13+Math.max(0,-diff))/14;}
    }
    previous=value;
    const rsi=count<14?null:!gains&&!losses?50:!losses?100:100-100/(1+gains/losses);
    const a=fast(value),b=slow(value),macd=a===null||b===null?null:a-b,signal=macd===null?null:smooth(macd);
    let width=null,widthRatio=null;
    if(closes.length===20){
      const mid=average(closes);
      width=4*Math.sqrt(average(closes.map(close=>(close-mid)**2)))/mid;
      if(widths.length===20){const ref=median(widths);if(ref>0)widthRatio=width/ref;}
      widths.push(width);if(widths.length>20)widths.shift();
    }
    return {rsi,macd,macdSignal:signal,width,widthRatio,
      stochastic:smoothed.length===3&&smoothed.every(finite)?smoothed.at(-1):null};
  };
}

function finishedVolumeSessions(bars){
  const result=[];
  let segment=[];
  for(const bar of bars){
    if(bar.sessionFirst)segment=[bar];
    else if(segment.length&&researchBarsAdjacent(segment.at(-1),bar))segment.push(bar);
    else segment=[];
    if(!bar.sessionLast||!segment.length)continue;
    if(segment.every(volume)){
      const slots=new Map(),duplicated=new Set();
      for(const row of segment){
        const {minuteOfDay}=newYorkBarSlot(row.time);
        if(slots.has(minuteOfDay))duplicated.add(minuteOfDay);
        slots.set(minuteOfDay,row.volume);
      }
      for(const key of duplicated)slots.delete(key);
      result.push({start:segment[0].time,end:bar.closeTime,
        knownAt:Math.max(...segment.map(researchBarAvailability)),slots});
    }
    segment=[];
  }
  return result;
}

function dedupeVolumeSessions(sources){
  const matched=new Map(),conflicts=new Set();
  for(const bars of sources)for(const session of finishedVolumeSessions(bars)){
    const saved=matched.get(session.start);
    if(saved&&(saved.end!==session.end||saved.slots.size!==session.slots.size||
      [...saved.slots].some(([slot,value])=>session.slots.get(slot)!==value)))conflicts.add(session.start);
    if(!saved||session.knownAt<saved.knownAt)matched.set(session.start,session);
  }
  return {sessions:[...matched.values()].filter(session=>!conflicts.has(session.start)).sort((a,b)=>a.end-b.end),conflicts:conflicts.size};
}

export function analyzeStudyIndicators(bars,priorVolume=[]){
  const {sessions,conflicts}=dedupeVolumeSessions([bars,...priorVolume]),coverage=new Map();
  let last=null,calc=momentum(),sumPv=0,sumV=0,volumeReady=false,sessionStart=null,prefixKnownAt=-Infinity;
  const rows=bars.map((bar,i)=>{
    const {day,session,minuteOfDay}=newYorkBarSlot(bar.time),key=day+'|'+session;
    const part=coverage.get(key)??{day,session,bars:0,known:0,zero:0};
    part.bars++;if(volume(bar)){part.known++;if(bar.volume===0)part.zero++;}
    coverage.set(key,part);
    if(!last||!researchBarsAdjacent(last,bar)){
      calc=momentum();sumPv=0;sumV=0;volumeReady=bar.sessionFirst===true;
      sessionStart=bar.time;prefixKnownAt=-Infinity;
    }
    last=bar;prefixKnownAt=Math.max(prefixKnownAt,researchBarAvailability(bar));
    if(!volume(bar))volumeReady=false;
    if(volumeReady){sumV+=bar.volume;sumPv+=(bar.high+bar.low+bar.close)/3*bar.volume;}
    const vwap=volumeReady&&sumV>0?sumPv/sumV:null;
    const context=trailing(sessions.filter(s=>s.end<=sessionStart&&s.knownAt<=researchBarAvailability(bar)&&s.slots.has(minuteOfDay)),20);
    const ref=context.length>=minSessions?median(context.map(s=>s.slots.get(minuteOfDay))):null;
    const rvol=volume(bar)&&ref>0?bar.volume/ref:null;
    return {index:i,knownAt:prefixKnownAt,...calc(bar),vwap,rvol,referenceSessions:context.length,close:bar.close};
  });
  return {version:STUDY_INDICATORS_VERSION,displayOnly:true,rows,coverage:[...coverage.values()],
    volumeReference:{minSessions,completeSessions:sessions.length,conflicts,
      usableComparisons:rows.filter(row=>row.rvol!==null).length,vwapBars:rows.filter(row=>row.vwap!==null).length}};
}

export function indicatorBuckets(row,knownAt){
  if(!row||row.knownAt>knownAt)return {};
  const bucket=(value,low,high)=>!finite(value)?'UNKNOWN':value<=low?'LOW':value>=high?'HIGH':'MID';
  return {rsi:bucket(row.rsi,30,70),stochastic:bucket(row.stochastic,20,80),
    bollinger:bucket(row.widthRatio,.8,1.2),rvol:bucket(row.rvol,.8,1.5),
    macd:row.macdSignal===null?'UNKNOWN':row.macd>row.macdSignal?'HIGH':row.macd<row.macdSignal?'LOW':'MID',
    vwap:row.vwap===null?'UNKNOWN':row.close>row.vwap?'HIGH':row.close<row.vwap?'LOW':'MID'};
}
