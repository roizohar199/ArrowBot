// Additive observation only. This never approves a strategy or creates orders.
// S01 in Roi_Candlestick_Bot_Codex_HE.txt has a stricter FVG chronology than
// sections 10.1 / 14.2 of the other documents. Keep it as a named profile;
// do not silently mix an MSS-middle FVG with the wider MSS+0..2 alternative.
import {normalizeContextBars,confirmedPivots} from './market-context.mjs';

export const RESEARCH_STRUCTURE_VERSION='research-structure-1';
export const RESEARCH_STRUCTURE_PROFILE='S01_SWEEP_MSS_MIDDLE_FVG_LATER_RETEST_V1';
export const RESEARCH_STRUCTURE_DEFAULTS=Object.freeze({
  tickSize:null,asOfTime:null,pivotLeft:2,pivotRight:2,atrPeriod:14,
  sweepDepthTicks:1,breakBufferTicks:1,stopBufferTicks:1,fvgMinGapTicks:1,
  displacementBodyAtr:.8,displacementBodyRatio:.6,displacementCloseEdge:.8,
  sweepToMssBars:5,retestExpiryBars:10,setupExpiryBars:20,
  expectedIntervalMs:null,sessionGaps:Object.freeze([])
});
const finite=Number.isFinite;
const active=s=>['WAIT_MSS','WAIT_FVG','WAIT_RETEST'].includes(s.state);
const clone=value=>structuredClone(value);
function configuration(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(RESEARCH_STRUCTURE_DEFAULTS,k)))return null;
  const c={...RESEARCH_STRUCTURE_DEFAULTS,...input};
  if(!finite(c.tickSize)||c.tickSize<=0||c.asOfTime!==null&&!finite(c.asOfTime))return null;
  for(const key of ['pivotLeft','pivotRight','atrPeriod','sweepDepthTicks','breakBufferTicks','fvgMinGapTicks','sweepToMssBars','retestExpiryBars','setupExpiryBars'])if(!Number.isSafeInteger(c[key])||c[key]<1||c[key]>4096)return null;
  if(c.pivotLeft>20||c.pivotRight>20||c.atrPeriod>250||!Number.isSafeInteger(c.stopBufferTicks)||c.stopBufferTicks<0||c.stopBufferTicks>4096)return null;
  if(!finite(c.displacementBodyAtr)||c.displacementBodyAtr<=0||!finite(c.displacementBodyRatio)||c.displacementBodyRatio<=0||c.displacementBodyRatio>1||!finite(c.displacementCloseEdge)||c.displacementCloseEdge<=.5||c.displacementCloseEdge>1)return null;
  if(c.expectedIntervalMs!==null&&(!finite(c.expectedIntervalMs)||c.expectedIntervalMs<=0)||!Array.isArray(c.sessionGaps)||c.sessionGaps.some(g=>!g||!finite(g.from)||!finite(g.to)||g.to<=g.from||g.kind!=='market_closed'))return null;
  return c;
}

// Wilder seed: mean of N true ranges having a previous close, excluding TR[0].
// This is explicitly separate from the legacy context indicator seed.
function atrWithPriorClose(bars,period){
  const result=bars.map(()=>null);let sum=0,value=null;
  for(let i=1;i<bars.length;i++){
    const b=bars[i],prior=bars[i-1],tr=Math.max(b.high-b.low,Math.abs(b.high-prior.close),Math.abs(b.low-prior.close));
    if(i<=period)sum+=tr;
    if(i===period)value=sum/period;else if(i>period)value=(value*(period-1)+tr)/period;
    result[i]=value;
  }
  return result;
}

/**
 * Pure causal diagnostics from closed ordinary OHLC bars. Each immutable event
 * records its own knowledge time; setups describe their state at asOfTime.
 * Explicit session gaps reset pending research setups and pattern history.
 * Retests mean closed directional far-edge reclaims, not trade/fill evidence.
 */
export function analyzeResearchStructure(input,options={}){
  const base={version:RESEARCH_STRUCTURE_VERSION,profileId:RESEARCH_STRUCTURE_PROFILE,
    sourceKind:'original_research_definition',researchOnly:true,candidateOnly:true,
    signalApproved:false,orderEligible:false,ordersCreated:false,fillInferred:false,
    status:'UNAVAILABLE',reasonCodes:[],events:[],setups:[],pivots:[],barsUsed:0,excludedFutureBars:0,
    stats:{sweeps:0,mss:0,fvg:0,retests:0,invalidated:0,expired:0}};
  const c=configuration(options);
  if(!c)return {...base,reasonCodes:['INVALID_RESEARCH_STRUCTURE_CONFIGURATION']};
  const normalized=normalizeContextBars(input,{asOf:c.asOfTime,expectedIntervalMs:c.expectedIntervalMs,sessionGaps:c.sessionGaps});
  if(!normalized.valid)return {...base,reasonCodes:normalized.reasonCodes};
  const bars=normalized.bars,tick=c.tickSize,price=ticks=>Number((ticks*tick).toPrecision(15));
  const ticks=value=>Math.round(value/tick);
  if(bars.some(b=>['open','high','low','close'].some(k=>!Number.isSafeInteger(ticks(b[k]))||Math.abs(b[k]/tick-ticks(b[k]))>1e-7)))return {...base,reasonCodes:['RESEARCH_PRICE_OFF_TICK']};
  if(c.expectedIntervalMs!==null&&bars.some(b=>b.closeTime-b.time!==c.expectedIntervalMs))return {...base,reasonCodes:['RESEARCH_BAR_INTERVAL_MISMATCH']};
  const result={...base,status:bars.length?'READY':'WARMING_UP',barsUsed:bars.length,excludedFutureBars:normalized.excludedFutureBars,config:clone(c)};
  const segments=[];
  for(const b of bars){if(!segments.length||b.time!==segments.at(-1).at(-1).closeTime)segments.push([]);segments.at(-1).push(b);}
  function transition(setup,state,bar,reasonCode,evidence={}){
    setup.state=state;setup.updatedAt=bar.knownAt;
    if(state==='RESEARCH_CONFIRMED'){setup.confirmedAt=bar.knownAt;result.stats.retests++;}
    if(state==='INVALIDATED'){setup.invalidatedAt=bar.knownAt;result.stats.invalidated++;}
    if(state==='EXPIRED'){setup.expiredAt=bar.knownAt;result.stats.expired++;}
    const event={eventId:`${setup.setupId}:${state}:${bar.time}`,setupId:setup.setupId,profileId:RESEARCH_STRUCTURE_PROFILE,
      direction:setup.direction,state,barTime:bar.time,barCloseTime:bar.closeTime,knownAt:bar.knownAt,
      reasonCode,evidence:clone(evidence),researchOnly:true,signalApproved:false,orderEligible:false};
    result.events.push(event);setup.lastReasonCode=reasonCode;
  }
  for(let segmentIndex=0;segmentIndex<segments.length;segmentIndex++){
    const segment=segments[segmentIndex];
    if(segmentIndex)for(const s of result.setups.filter(active))transition(s,'EXPIRED',segment[0],'SESSION_BOUNDARY_RESETS_RESEARCH_SETUP');
    const localBars=segment.map((b,index)=>({...b,index}));
    const pivots=confirmedPivots(localBars,{pivotLeft:c.pivotLeft,pivotRight:c.pivotRight,equalToleranceTicks:0,tickSize:tick});
    result.pivots.push(...pivots);
    const atr=atrWithPriorClose(segment,c.atrPeriod),consumed=new Set();
    for(let i=0;i<segment.length;i++){
      const b=segment[i],bh=ticks(b.high),bl=ticks(b.low),bc=ticks(b.close),bo=ticks(b.open);
      // Every candidate keeps the exact two pivots and sweep extreme frozen.
      for(const s of result.setups.filter(active)){
        if(s.segmentIndex!==segmentIndex)continue;
        const long=s.direction==='LONG',age=i-s.sweepIndex;
        const invalidated=long?bl<=s.invalidationTicks:bh>=s.invalidationTicks;
        if(invalidated){transition(s,'INVALIDATED',b,'SWEEP_EXTREME_INVALIDATED_BEFORE_CONFIRMATION');continue;}
        if(age>c.setupExpiryBars){transition(s,'EXPIRED',b,'SETUP_WINDOW_EXPIRED');continue;}
        if(s.state==='WAIT_MSS'){
          if(age>c.sweepToMssBars){transition(s,'EXPIRED',b,'MSS_WINDOW_EXPIRED');continue;}
          const beyond=long?bc>=s.mssTriggerTicks:bc<=s.mssTriggerTicks;
          if(!beyond)continue;
          const priorAtr=atr[i-1],range=b.high-b.low,body=Math.abs(b.close-b.open),position=range>0?(b.close-b.low)/range:null;
          const displacement=finite(priorAtr)&&range>0&&body>=c.displacementBodyAtr*priorAtr&&body/range>=c.displacementBodyRatio&&
            (long?bc>bo&&position>=c.displacementCloseEdge:bc<bo&&position<=1-c.displacementCloseEdge);
          if(!displacement)continue;
          s.mssIndex=i;s.mssAt=b.knownAt;s.frozenAtr=priorAtr;
          result.stats.mss++;transition(s,'WAIT_FVG',b,'MSS_CLOSED_WITH_DISPLACEMENT',{trigger:price(s.mssTriggerTicks),priorAtr,body,range});
        }else if(s.state==='WAIT_FVG'){
          // Strict S01: the MSS must be the middle of exactly three bars.
          if(i!==s.mssIndex+1){transition(s,'EXPIRED',b,'MSS_MIDDLE_FVG_NOT_COMPLETED');continue;}
          const first=segment[i-2],lowerTicks=long?ticks(first.high):bh,upperTicks=long?bl:ticks(first.low);
          if(upperTicks-lowerTicks<c.fvgMinGapTicks){transition(s,'EXPIRED',b,'MSS_MIDDLE_FVG_NOT_COMPLETED');continue;}
          s.fvg={lower:price(lowerTicks),upper:price(upperTicks),createdAt:b.knownAt,knownAt:b.knownAt,barTime:b.time,middleTime:segment[s.mssIndex].time};
          s.fvgIndex=i;result.stats.fvg++;transition(s,'WAIT_RETEST',b,'FVG_KNOWN_WAIT_STRICTLY_LATER_RETEST',{...s.fvg});
        }else if(s.state==='WAIT_RETEST'){
          if(i-s.fvgIndex>c.retestExpiryBars){transition(s,'EXPIRED',b,'RETEST_WINDOW_EXPIRED');continue;}
          const lower=ticks(s.fvg.lower),upper=ticks(s.fvg.upper);
          if(long?bc<lower:bc>upper){transition(s,'INVALIDATED',b,'CLOSE_BROKE_FVG_FAR_SIDE');continue;}
          const touched=bh>=lower&&bl<=upper,reclaimed=long?bc>upper&&bc>bo:bc<lower&&bc<bo;
          if(i>s.fvgIndex&&b.time>=s.fvg.knownAt&&touched&&reclaimed)transition(s,'RESEARCH_CONFIRMED',b,'LATER_DIRECTIONAL_FVG_RECLAIM',{zone:clone(s.fvg),close:b.close,structuralInvalidation:s.structuralInvalidation});
        }
      }
      // A pivot confirmed by this sweep's own close is deliberately too late.
      const known=pivots.filter(p=>p.knownAt<=b.time&&p.confirmedAtIndex<i);
      const low=known.findLast(p=>p.type==='LOW'),high=known.findLast(p=>p.type==='HIGH');
      if(!low||!high)continue;
      for(const direction of ['LONG','SHORT']){
        const long=direction==='LONG',liquidity=long?low:high,structure=long?high:low,key=`${direction}:${liquidity.id}`;
        if(consumed.has(key))continue;
        const swept=long?bl<=ticks(liquidity.price)-c.sweepDepthTicks&&bc>ticks(liquidity.price):bh>=ticks(liquidity.price)+c.sweepDepthTicks&&bc<ticks(liquidity.price);
        if(!swept)continue;
        consumed.add(key);
        const invalidationTicks=long?bl-c.stopBufferTicks:bh+c.stopBufferTicks;
        const setup={setupId:`${RESEARCH_STRUCTURE_PROFILE}:${direction}:${liquidity.id}:${b.time}`,direction,segmentIndex,sweepIndex:i,sweepTime:b.time,
          knownAt:b.knownAt,createdAt:b.knownAt,liquidityPivot:clone(liquidity),structurePivot:clone(structure),
          sweepExtreme:long?b.low:b.high,structuralInvalidation:price(invalidationTicks),invalidationTicks,
          mssTriggerTicks:ticks(structure.price)+(long?1:-1)*c.breakBufferTicks,
          mssTrigger:price(ticks(structure.price)+(long?1:-1)*c.breakBufferTicks),
          expiresAfterBars:c.setupExpiryBars,researchOnly:true,signalApproved:false,orderEligible:false};
        result.setups.push(setup);result.stats.sweeps++;
        transition(setup,'WAIT_MSS',b,'CLOSED_SWEEP_RECLAIM_FROZEN_KNOWN_PIVOTS',{liquidityPivotId:liquidity.id,liquidityKnownAt:liquidity.knownAt,structurePivotId:structure.id,structureKnownAt:structure.knownAt});
      }
    }
  }
  result.reasonCodes=bars.length?[]:['RESEARCH_CLOSED_HISTORY_REQUIRED'];
  return result;
}
