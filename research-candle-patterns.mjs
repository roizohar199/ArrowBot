import {normalizeCandleBars,candleAnatomy} from './candle-patterns.mjs';

// Additive, versioned shape observations from the three supplied November 17
// guides. These definitions never approve, veto, size or execute a trade.
export const RESEARCH_CANDLE_VERSION='research-candles-2026-11-17.v2';
export const RESEARCH_CANDLE_DEFAULTS=Object.freeze({
  tickSize:null,asOfTime:null,maxBars:4096,maxPatterns:300,sessionGaps:Object.freeze([]),
  patternIds:null,
  minRangeTicks:4,longBodyPeriod:20,longBodyMedianMultiple:1.2,
  directionalBodyMinRatio:.6,fullMarubozuBodyMinRatio:.9,
  fullMarubozuWickMaxRatio:.05,dojiBodyMaxRatio:.1,smallBodyMaxRatio:.3,
  relativeSmallBodyMaxRatio:.5,kickerBodyMinRatio:.8,closeEdgeFraction:.25,
  continuousOpenToleranceTicks:1,
});
const labels={
  BULLISH_MARUBOZU:'מרובוזו שורי',BEARISH_MARUBOZU:'מרובוזו דובי',
  BULLISH_BELT_HOLD:'Belt Hold שורי',BEARISH_BELT_HOLD:'Belt Hold דובי',
  ADVANCE_BLOCK:'Advance Block · היחלשות בעלייה',PIERCING_LINE:'קו חודר',DARK_CLOUD_COVER:'ענן כהה',
  THREE_INSIDE_UP:'שלושה נרות פנימה — עולה',THREE_INSIDE_DOWN:'שלושה נרות פנימה — יורד',
  THREE_OUTSIDE_UP:'שלושה נרות החוצה — עולה',THREE_OUTSIDE_DOWN:'שלושה נרות החוצה — יורד',
  THREE_WHITE_SOLDIERS:'שלושה חיילים לבנים',THREE_BLACK_CROWS:'שלושה עורבים שחורים',
  BULLISH_KICKER:'Kicker שורי',BEARISH_KICKER:'Kicker דובי',
  BULLISH_ABANDONED_BABY:'תינוק נטוש שורי',BEARISH_ABANDONED_BABY:'תינוק נטוש דובי',
  FALLING_WINDOW:'חלון יורד',RISING_THREE_METHODS:'שלוש שיטות עולות',
  FALLING_THREE_METHODS:'שלוש שיטות יורדות',BULLISH_MAT_HOLD:'Mat Hold שורי',
};
export const RESEARCH_CANDLE_CATALOG=Object.freeze(Object.entries(labels).map(([id,label])=>Object.freeze({id,label,researchOnly:true})));
const unique=items=>[...new Set(items)],finite=Number.isFinite;
const tolerance=(a,b)=>Math.max(1,Math.abs(a),Math.abs(b))*Number.EPSILON*32;
const le=(a,b)=>a<=b+tolerance(a,b),ge=(a,b)=>a+tolerance(a,b)>=b;
const lt=(a,b)=>a<b-tolerance(a,b),gt=(a,b)=>a>b+tolerance(a,b);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const onGrid=(value,tick)=>{const coordinate=value/tick;return Number.isSafeInteger(Math.round(coordinate))&&Math.abs(coordinate-Math.round(coordinate))<=Math.max(1,Math.abs(coordinate))*Number.EPSILON*32;};

function configuration(options){
  if(!options||typeof options!=='object'||Array.isArray(options))throw TypeError('Configuration must be an object');
  for(const key of Object.keys(options))if(!Object.hasOwn(RESEARCH_CANDLE_DEFAULTS,key))throw TypeError('Unknown research candle parameter: '+key);
  const c={...RESEARCH_CANDLE_DEFAULTS,...options};
  if(c.patternIds!==null&&(!Array.isArray(c.patternIds)||c.patternIds.some(id=>!Object.hasOwn(labels,id))))throw TypeError('Unknown research pattern');
  if(!finite(c.tickSize)||c.tickSize<=0||c.asOfTime!==null&&!finite(c.asOfTime))throw TypeError('Tick size and valid availability cutoff required');
  for(const key of ['maxBars','maxPatterns','longBodyPeriod','minRangeTicks','continuousOpenToleranceTicks'])if(!Number.isSafeInteger(c[key])||c[key]<(key==='continuousOpenToleranceTicks'?0:1)||c[key]>10000)throw TypeError('Invalid integer parameter: '+key);
  if(c.maxBars<5||c.longBodyPeriod>1000||c.maxPatterns>5000)throw TypeError('Invalid research history bounds');
  for(const key of ['directionalBodyMinRatio','fullMarubozuBodyMinRatio','fullMarubozuWickMaxRatio','dojiBodyMaxRatio','smallBodyMaxRatio','relativeSmallBodyMaxRatio','kickerBodyMinRatio','closeEdgeFraction'])if(!finite(c[key])||c[key]<0||c[key]>1)throw TypeError('Invalid ratio parameter: '+key);
  if(!finite(c.longBodyMedianMultiple)||c.longBodyMedianMultiple<=0||c.longBodyMedianMultiple>100)throw TypeError('Invalid long body multiple');
  if(!Array.isArray(c.sessionGaps)||c.sessionGaps.length>10000||c.sessionGaps.some(gap=>!gap||!finite(gap.from)||!finite(gap.to)||gap.to<=gap.from))throw TypeError('Invalid declared session gaps');
  c.sessionGaps=c.sessionGaps.map(gap=>({...gap}));
  return c;
}

export function analyzeResearchCandles(input,options={}){
  const base={version:RESEARCH_CANDLE_VERSION,definitionVersion:RESEARCH_CANDLE_VERSION,sourceKind:'original_research_definition',
    status:'UNAVAILABLE',reasonCodes:[],patterns:[],latest:[],totalDetected:0,config:null,
    researchOnly:true,signalApproved:false,orderEligible:false,ordersCreated:false};
  let c;try{c=configuration(options);}catch(error){return {...base,status:'INVALID_CONFIG',reasonCodes:['INVALID_RESEARCH_CANDLE_CONFIG'],detail:error.message};}
  // An explicit receive timestamp cannot make a candle known before receipt.
  const source=Array.isArray(input)?input.map(b=>b&&typeof b==='object'?{...b,knownAt:Math.max(b.closeTime??-Infinity,b.knownAt??-Infinity,b.receivedAt??-Infinity)}:b):input;
  const normalized=normalizeCandleBars(source,{tickSize:c.tickSize,asOfTime:c.asOfTime,mode:'closed',maxBars:c.maxBars});
  if(!normalized.ok)return {...base,status:'INVALID_INPUT',reasonCodes:normalized.reasonCodes,errors:normalized.errors,config:c};
  const bars=normalized.bars,features=bars.map(candleAnatomy),patterns=[],reasonCodes=[];
  if(!bars.length)return {...base,status:'NO_DATA',reasonCodes:['NO_BARS'],config:c};
  const grid=bars.map(b=>['open','high','low','close'].every(key=>onGrid(b[key],c.tickSize)));
  if(grid.some(valid=>!valid))return {...base,status:'INVALID_INPUT',reasonCodes:['PRICE_OFF_TICK_GRID'],config:c};
  const usable=i=>i>=0&&i<bars.length&&bars[i].closed&&bars[i].available&&features[i].range>0&&input[i]?.synthetic!==true;
  const span=(end,length)=>{
    const start=end-length+1;if(start<0)return false;
    for(let i=start;i<=end;i++)if(!usable(i)||i>start&&(bars[i].time!==bars[i-1].closeTime||c.sessionGaps.some(gap=>gap.from<bars[i].time&&gap.to>bars[i-1].time)||input[i]?.instrument!==input[i-1]?.instrument||input[i]?.sourceId!==input[i-1]?.sourceId))return false;
    return ge(Math.max(...bars.slice(start,end+1).map(b=>b.high))-Math.min(...bars.slice(start,end+1).map(b=>b.low)),c.minRangeTicks*c.tickSize);
  };
  const longBodies=bars.map((b,i)=>{
    if(!usable(i)||i<c.longBodyPeriod)return null;
    const first=i-c.longBodyPeriod,window=bars.slice(first,i);
    if(window.some((_,offset)=>!usable(first+offset)||input[first+offset]?.instrument!==input[i]?.instrument||input[first+offset]?.sourceId!==input[i]?.sourceId))return null;
    const reference=median(features.slice(first,i).map(f=>f.body)),f=features[i];
    return {passed:ge(f.bodyRatio,c.directionalBodyMinRatio)&&ge(f.body,c.tickSize)&&ge(f.body,c.longBodyMedianMultiple*reference),
      referenceMedian:reference,referenceStartTime:window[0].time,referenceEndTime:window.at(-1).closeTime,
      knownAt:Math.max(b.knownAt,...window.map(x=>x.knownAt))};
  });
  const long=i=>longBodies[i]?.passed===true;
  const requestedPatterns=c.patternIds&&new Set(c.patternIds);
  const add=(id,variant,direction,end,length,checks,{longIndices=[],evidenceFamily=id,evidence={},gap=false}={})=>{
    if(requestedPatterns&&!requestedPatterns.has(id))return;
    if(!span(end,length)||!Object.values(checks).every(Boolean))return;
    const start=end-length+1,used=bars.slice(start,end+1),knownAt=Math.max(...used.map(b=>b.knownAt),...longIndices.map(i=>longBodies[i]?.knownAt??Infinity));
    if(!finite(knownAt)||c.asOfTime!==null&&knownAt>c.asOfTime)return;
    patterns.push({id,patternId:id,label:labels[id],variant,direction,evidenceFamily,
      observationId:`${RESEARCH_CANDLE_VERSION}:${bars[start].time}:${bars[end].closeTime}:${id}:${variant}`,
      definitionVersion:RESEARCH_CANDLE_VERSION,sourceKind:'original_research_definition',
      status:'RESEARCH_ONLY',researchOnly:true,shapeDetected:true,contextValid:null,setupConfirmed:false,
      signalApproved:false,orderEligible:false,executionEligible:false,ordersCreated:false,
      startIndex:start,endIndex:end,formationStartTime:bars[start].time,barOpenTime:bars[end].time,
      barCloseTime:bars[end].closeTime,knownAt,signalHigh:Math.max(...used.map(b=>b.high)),signalLow:Math.min(...used.map(b=>b.low)),
      reasonCodes:gap?['GAP_CAUSE_NOT_VERIFIED']:[],
      evidence:{checks:{...checks},...evidence,longBodyReferences:longIndices.map(i=>({barTime:bars[i].time,...longBodies[i]}))}});
  };
  for(let i=0;i<bars.length;i++){
    if(!usable(i))continue;
    const b=bars[i],f=features[i],direction=f.direction;
    if(direction!=='NEUTRAL'){
      const id=direction==='LONG'?'BULLISH_MARUBOZU':'BEARISH_MARUBOZU',family=`IMPULSE:${b.time}`;
      const common={longBody:long(i)};
      add(id,'FULL',direction,i,1,{...common,dominantBody:ge(f.bodyRatio,c.fullMarubozuBodyMinRatio),smallUpper:le(f.upperRatio,c.fullMarubozuWickMaxRatio),smallLower:le(f.lowerRatio,c.fullMarubozuWickMaxRatio)},{longIndices:[i],evidenceFamily:family});
      add(id,'OPEN',direction,i,1,{...common,openAtEdge:le(direction==='LONG'?b.open-b.low:b.high-b.open,c.tickSize)},{longIndices:[i],evidenceFamily:family});
      add(id,'CLOSE',direction,i,1,{...common,closeAtEdge:le(direction==='LONG'?b.high-b.close:b.close-b.low,c.tickSize)},{longIndices:[i],evidenceFamily:family});
      add('BULLISH_BELT_HOLD','SINGLE_CANDLE','LONG',i,1,{longBody:long(i),bull:direction==='LONG',openAtLow:le(b.open-b.low,c.tickSize),highClose:ge(f.closePosition,1-c.closeEdgeFraction)},{longIndices:[i],evidenceFamily:family});
      add('BEARISH_BELT_HOLD','SINGLE_CANDLE','SHORT',i,1,{
        longBody:long(i),bear:direction==='SHORT',openAtHigh:le(b.high-b.open,c.tickSize),lowClose:le(f.closePosition,c.closeEdgeFraction),
      },{longIndices:[i],evidenceFamily:family});
    }
    if(i<1)continue;
    const a=bars[i-1],af=features[i-1],mid=(a.open+a.close)/2;
    const piercing={firstDown:af.direction==='SHORT',firstLong:long(i-1),lastUp:direction==='LONG',pastMid:gt(b.close,mid),notEngulfing:lt(b.close,a.open)};
    const cloud={firstUp:af.direction==='LONG',firstLong:long(i-1),lastDown:direction==='SHORT',pastMid:lt(b.close,mid),notEngulfing:gt(b.close,a.open)};
    const pairFamily=`RECOVERY:${a.time}:${b.closeTime}`;
    add('PIERCING_LINE','CLASSIC_GAP','LONG',i,2,{...piercing,openBelowLow:lt(b.open,a.low)},{longIndices:[i-1],evidenceFamily:pairFamily,gap:true});
    add('PIERCING_LINE','CONTINUOUS_RECOVERY','LONG',i,2,{...piercing,nearPriorClose:le(b.open,a.close+c.continuousOpenToleranceTicks*c.tickSize)},{longIndices:[i-1],evidenceFamily:pairFamily});
    add('DARK_CLOUD_COVER','CLASSIC_GAP','SHORT',i,2,{...cloud,openAboveHigh:gt(b.open,a.high)},{longIndices:[i-1],evidenceFamily:pairFamily,gap:true});
    add('DARK_CLOUD_COVER','CONTINUOUS_RECOVERY','SHORT',i,2,{...cloud,nearPriorClose:ge(b.open,a.close-c.continuousOpenToleranceTicks*c.tickSize)},{longIndices:[i-1],evidenceFamily:pairFamily});
    for(const side of ['LONG','SHORT']){
      const up=side==='LONG',id=up?'BULLISH_KICKER':'BEARISH_KICKER';
      const common={firstOpposite:af.direction===(up?'SHORT':'LONG'),lastDirection:direction===side,bothLong:long(i-1)&&long(i),firstDominant:ge(af.bodyRatio,c.kickerBodyMinRatio),lastDominant:ge(f.bodyRatio,c.kickerBodyMinRatio)};
      const options={longIndices:[i-1,i],evidenceFamily:`KICKER:${a.time}:${b.closeTime}`,gap:true};
      add(id,'BODY_GAP',side,i,2,{...common,separatedBodies:up?gt(f.bodyLow,af.bodyHigh):lt(f.bodyHigh,af.bodyLow)},options);
      add(id,'FULL_GAP',side,i,2,{...common,separatedRanges:up?gt(b.low,a.high):lt(b.high,a.low)},options);
    }
    add('FALLING_WINDOW','RANGE_GAP','SHORT',i,2,{separatedRanges:lt(b.high,a.low)},{gap:true,evidenceFamily:`WINDOW:${a.time}:${b.closeTime}`,evidence:{zone:{lower:b.high,upper:a.low,knownAt:Math.max(a.knownAt,b.knownAt)}}});
    if(i<2)continue;
    const first=bars[i-2],ff=features[i-2],middle=a,mf=af,last=b,lf=f;
    add('ADVANCE_BLOCK','SHRINKING_BODIES_GROWING_UPPER_WICKS','SHORT',i,3,{
      allBullish:[ff,mf,lf].every(feature=>feature.direction==='LONG'),
      higherHighs:lt(first.high,middle.high)&&lt(middle.high,last.high),
      higherCloses:lt(first.close,middle.close)&&lt(middle.close,last.close),
      shrinkingBodies:gt(ff.body,mf.body)&&gt(mf.body,lf.body),
      growingUpperWicks:lt(ff.upper,mf.upper)&&lt(mf.upper,lf.upper),
      finalWickAtLeastBody:ge(lf.upper,lf.body),
    },{evidenceFamily:`SEQUENTIAL_IMPULSE:${first.time}:${last.closeTime}`});
    const tripleFamily=`CONTAINMENT:${first.time}:${last.closeTime}`;
    for(const side of ['LONG','SHORT']){
      const up=side==='LONG',id=up?'THREE_INSIDE_UP':'THREE_INSIDE_DOWN';
      const harami={firstOpposite:ff.direction===(up?'SHORT':'LONG'),firstLong:long(i-2),middleOpposite:mf.direction===side,
        bodyContained:ge(mf.bodyLow,ff.bodyLow)&&le(mf.bodyHigh,ff.bodyHigh),oneInnerTick:ge(mf.bodyLow-ff.bodyLow,c.tickSize)||ge(ff.bodyHigh-mf.bodyHigh,c.tickSize),
        middleSmall:le(mf.body,c.relativeSmallBodyMaxRatio*ff.body),lastDirection:lf.direction===side};
      const opts={longIndices:[i-2],evidenceFamily:tripleFamily,evidence:{middleRangeContained:ge(middle.low,first.low)&&le(middle.high,first.high)}};
      add(id,'BODY_CONFIRM',side,i,3,{...harami,closeBeyondBody:up?gt(last.close,first.open):lt(last.close,first.open)},opts);
      add(id,'RANGE_CONFIRM',side,i,3,{...harami,closeBeyondRange:up?gt(last.close,first.high):lt(last.close,first.low)},opts);
      const engulf={firstOpposite:ff.direction===(up?'SHORT':'LONG'),middleDirection:mf.direction===side,lastDirection:lf.direction===side,
        bodyContains:le(mf.bodyLow,ff.bodyLow)&&ge(mf.bodyHigh,ff.bodyHigh),oneTickExtension:ge(ff.bodyLow-mf.bodyLow,c.tickSize)||ge(mf.bodyHigh-ff.bodyHigh,c.tickSize),
        closeBeyondPair:up?ge(last.close,Math.max(first.high,middle.high)+c.tickSize):le(last.close,Math.min(first.low,middle.low)-c.tickSize)};
      add(up?'THREE_OUTSIDE_UP':'THREE_OUTSIDE_DOWN','RANGE_CONFIRM',side,i,3,engulf,{evidenceFamily:`ENGULFING:${first.time}:${last.closeTime}`});
      const baby={firstOpposite:ff.direction===(up?'SHORT':'LONG'),firstLong:long(i-2),middleDoji:le(mf.bodyRatio,c.dojiBodyMaxRatio),lastDirection:lf.direction===side,
        lastDominant:ge(lf.bodyRatio,c.directionalBodyMinRatio),firstRangeGap:up?lt(middle.high,first.low):gt(middle.low,first.high),lastRangeGap:up?lt(middle.high,last.low):gt(middle.low,last.high),
        pastFirstMidpoint:up?gt(last.close,(first.open+first.close)/2):lt(last.close,(first.open+first.close)/2)};
      add(up?'BULLISH_ABANDONED_BABY':'BEARISH_ABANDONED_BABY','FULL_RANGE_GAPS_MIDPOINT',side,i,3,baby,{longIndices:[i-2],gap:true,evidenceFamily:`STAR:${first.time}:${last.closeTime}`});
      const sequential=[i-2,i-1,i];
      add(up?'THREE_WHITE_SOLDIERS':'THREE_BLACK_CROWS','PRIOR_BODY_OPEN',side,i,3,{
        allDirections:sequential.every(j=>features[j].direction===side),allLong:sequential.every(long),
        closeAtEdge:sequential.every(j=>up?ge(features[j].closePosition,1-c.closeEdgeFraction):le(features[j].closePosition,c.closeEdgeFraction)),
        progressiveCloses:up?gt(middle.close,first.close)&&gt(last.close,middle.close):lt(middle.close,first.close)&&lt(last.close,middle.close),
        opensInsidePriorBodies:ge(middle.open,ff.bodyLow)&&le(middle.open,ff.bodyHigh)&&ge(last.open,mf.bodyLow)&&le(last.open,mf.bodyHigh),
      },{longIndices:sequential,evidenceFamily:`SEQUENTIAL_IMPULSE:${first.time}:${last.closeTime}`});
    }
    if(i<4)continue;
    const start=i-4,opening=bars[start],of=features[start],correction=[i-3,i-2,i-1];
    for(const side of ['LONG','SHORT']){
      const up=side==='LONG',common={firstDirection:of.direction===side,lastDirection:lf.direction===side,firstLong:long(start),lastLong:long(i),
        smallCorrections:correction.every(j=>le(features[j].body,c.relativeSmallBodyMaxRatio*of.body)&&le(features[j].bodyRatio,c.smallBodyMaxRatio)),
        rangesInsideOpening:correction.every(j=>ge(bars[j].low,opening.low)&&le(bars[j].high,opening.high)),
        resumedBeyondOpening:up?gt(last.close,opening.high):lt(last.close,opening.low)};
      const opts={longIndices:[start,i],evidenceFamily:`THREE_METHODS:${opening.time}:${last.closeTime}`},id=up?'RISING_THREE_METHODS':'FALLING_THREE_METHODS';
      add(id,'FIVE_CANDLE_RANGE_CONTAINED',side,i,5,common,opts);
      add(id,'FIVE_CANDLE_OPPOSITE_CORRECTION',side,i,5,{...common,oppositeCorrections:correction.every(j=>features[j].direction===(up?'SHORT':'LONG'))},opts);
    }
    add('BULLISH_MAT_HOLD','FIVE_CANDLE_BODY_GAP','LONG',i,5,{
      firstUp:of.direction==='LONG',lastUp:lf.direction==='LONG',firstLong:long(start),lastLong:long(i),
      smallCorrections:correction.every(j=>le(features[j].body,c.relativeSmallBodyMaxRatio*of.body)&&le(features[j].bodyRatio,c.smallBodyMaxRatio)),
      firstCorrectionBodyGap:gt(features[i-3].bodyLow,of.bodyHigh),
      downwardCorrection:gt(bars[i-3].close,bars[i-2].close)&&gt(bars[i-2].close,bars[i-1].close),
      heldFirstBodyMidpoint:correction.every(j=>ge(bars[j].low,(opening.open+opening.close)/2)),
      resumedBeyondAll:gt(last.close,Math.max(...bars.slice(start,i).map(x=>x.high))),
    },{longIndices:[start,i],gap:true,evidenceFamily:`MAT_HOLD:${opening.time}:${last.closeTime}`});
  }
  if(bars.some((_,i)=>!bars[i].closed))reasonCodes.push('OPEN_BARS_EXCLUDED');
  if(bars.some(b=>!b.available))reasonCodes.push('FUTURE_AVAILABILITY_EXCLUDED');
  if(bars.some((_,i)=>input[i]?.synthetic===true))reasonCodes.push('SYNTHETIC_BARS_EXCLUDED');
  if(bars.filter((_,i)=>usable(i)).length<c.longBodyPeriod+1)reasonCodes.push('LONG_BODY_WARMUP_REQUIRED');
  const lastIndex=bars.findLastIndex((_,i)=>usable(i));
  return {...base,status:'OK',config:c,reasonCodes:unique(reasonCodes),totalDetected:patterns.length,
    patterns:patterns.slice(-c.maxPatterns),latest:patterns.filter(p=>p.endIndex===lastIndex),lastClosedBarTime:lastIndex>=0?bars[lastIndex].time:null,
    independentVoteCount:null,notes:['Overlapping variants share evidenceFamily; labels are not independent confirmations.','Shape detection is not context validation, setup approval or a fill.']};
}
