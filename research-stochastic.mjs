import {normalizeContextBars} from './market-context.mjs';

// The bundled Stochastic lesson proposes 12/3/3 and the 20/80 bands.
// This observation uses simple moving averages and restarts at session gaps.
export const RESEARCH_STOCHASTIC_VERSION='stochastic-12-3-3-v1';
const lookback=12,smoothK=3,smoothD=3;
const config=Object.freeze({lookback,smoothK,smoothD,lowerBand:20,upperBand:80,gapPolicy:'RESET_AT_SESSION_GAP'});

function average(window){
  if(window.some(value=>value===null))return null;
  return window.reduce((sum,value)=>sum+value,0)/window.length;
}

export function analyzeResearchStochastic(input,{asOfTime,sessionGaps=[],timeframeMs}={}){
  const base={version:RESEARCH_STOCHASTIC_VERSION,config,researchOnly:true,signalApproved:false,orderEligible:false};
  const unavailable=reason=>({...base,status:'UNAVAILABLE',reason,latest:null});
  if(!Number.isFinite(asOfTime))return unavailable('DECISION_TIME_REQUIRED');
  const normalized=normalizeContextBars(input,{asOf:asOfTime,sessionGaps});
  if(!normalized.valid)return unavailable(normalized.reasonCodes[0]);
  if(!normalized.bars.length)return unavailable('NO_CLOSED_BARS');

  const window=[],raw=[],smoothed=[];
  let previousBar=null,previous=null,latest=null,knownAt=null,reason='WARMUP_REQUIRED';
  for(const bar of normalized.bars){
    if(bar.synthetic===true||timeframeMs!==undefined&&bar.closeTime-bar.time!==timeframeMs)return unavailable('INVALID_RESEARCH_BAR');
    if(previousBar&&bar.time!==previousBar.closeTime){
      window.length=raw.length=smoothed.length=0;
      previous=null;
      knownAt=null;
    }
    previousBar=bar;
    window.push(bar);
    if(window.length>lookback)window.shift();
    knownAt=Math.max(knownAt??bar.knownAt,bar.knownAt);
    latest=null;
    reason='WARMUP_REQUIRED';
    if(window.length<lookback)continue;

    const high=Math.max(...window.map(row=>row.high)),low=Math.min(...window.map(row=>row.low));
    raw.push(high>low?100*((bar.close-low)/(high-low)):null);
    if(raw.length>smoothK)raw.shift();
    if(raw.length<smoothK)continue;

    const k=average(raw);
    smoothed.push(k);
    if(smoothed.length>smoothD)smoothed.shift();
    if(smoothed.length<smoothD)continue;
    const d=average(smoothed);
    if(k===null||d===null){
      previous=null;
      reason='FLAT_RANGE';
      continue;
    }
    const zone=k<=config.lowerBand?'LOW':k>=config.upperBand?'HIGH':'MID';
    let cross=null;
    if(previous){
      if(previous.k<=previous.d&&k>d)cross='UP';
      if(previous.k>=previous.d&&k<d)cross='DOWN';
    }
    latest={k,d,zone,cross,barCloseTime:bar.closeTime,knownAt};
    previous=latest;
  }
  return latest?{...base,status:'READY',latest}:unavailable(reason);
}
