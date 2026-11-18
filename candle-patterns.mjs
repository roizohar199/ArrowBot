// Versioned research definitions from Candlestick_Codex_Guide_HE.txt.
// Shape matches are observations, never win probabilities or order requests.
export const PATTERN_DEFINITION_VERSION='guide-he-2026-11-13.v2';
export const PATTERN_SOURCE_KIND='original_research_definition';
export const DEFAULT_PATTERN_CONFIG=Object.freeze({
  mode:'closed',unit:'price',chartType:'standard',requireTimestamps:true,asOfTime:null,
  tickSize:null,minRangeTicks:4,minRange:null,maxBars:4096,
  dojiBodyMaxRatio:.10,dojiWickMinRatio:.60,dojiOppositeWickMaxRatio:.10,
  hammerBodyMaxRatio:.35,hammerWickBodyMinRatio:2,hammerOppositeWickMaxRatio:.15,hammerCloseMinRatio:.65,
  pinWickMinRatio:.60,pinBodyMaxRatio:.30,pinOppositeWickMaxRatio:.20,pinCloseMinRatio:.65,
  haramiBodyMaxRatio:.50,requireOppositeHarami:true,enableHaramiCross:true,allowEqualHaramiEdges:true,
  tweezerToleranceTicks:1,tweezerToleranceMode:'ticks',tweezerToleranceAtr:.05,tweezerAtrPeriod:14,requireOppositeTweezer:true,allowEqualInsideEdges:false,allowPatternAcrossSessionGaps:false,
  starMode:'continuous_market',starAtrPeriod:14,starFirstBodyMinAtr:.60,starMiddleBodyMaxRatio:.35,
});
const finite=Number.isFinite;
const normalChart=type=>type==='standard'||type==='candles';
const unique=items=>[...new Set(items)];
const ratioKeys=['dojiBodyMaxRatio','dojiWickMinRatio','dojiOppositeWickMaxRatio','hammerBodyMaxRatio','hammerOppositeWickMaxRatio','hammerCloseMinRatio','pinWickMinRatio','pinBodyMaxRatio','pinOppositeWickMaxRatio','pinCloseMinRatio','haramiBodyMaxRatio','starMiddleBodyMaxRatio'];
const boolKeys=['requireTimestamps','requireOppositeHarami','enableHaramiCross','allowEqualHaramiEdges','requireOppositeTweezer','allowEqualInsideEdges','allowPatternAcrossSessionGaps'];

export function validatePatternConfig(config={}){
  if(!config||typeof config!=='object'||Array.isArray(config))throw TypeError('Pattern config must be an object');
  for(const key of Object.keys(config))if(!Object.hasOwn(DEFAULT_PATTERN_CONFIG,key))throw TypeError('Unknown pattern parameter: '+key);
  const c={...DEFAULT_PATTERN_CONFIG,...config};
  if(!['closed','preview'].includes(c.mode)||!['price','pixels'].includes(c.unit)||!normalChart(c.chartType)||!['continuous_market','strict_gap'].includes(c.starMode)||!['ticks','atr'].includes(c.tweezerToleranceMode))throw TypeError('Invalid pattern mode, units, chart type or variant');
  for(const key of ratioKeys)if(!finite(c[key])||c[key]<0||c[key]>1)throw TypeError('Invalid ratio parameter: '+key);
  for(const key of boolKeys)if(typeof c[key]!=='boolean')throw TypeError('Invalid boolean parameter: '+key);
  for(const key of ['tickSize','minRange'])if(c[key]!==null&&(!finite(c[key])||c[key]<=0))throw TypeError('Invalid positive parameter: '+key);
  for(const key of ['minRangeTicks','tweezerToleranceTicks'])if(!Number.isSafeInteger(c[key])||c[key]<0||c[key]>100000)throw TypeError('Invalid tick count: '+key);
  for(const key of ['hammerWickBodyMinRatio','starFirstBodyMinAtr','tweezerToleranceAtr'])if(!finite(c[key])||c[key]<=0||c[key]>1000)throw TypeError('Invalid positive ratio: '+key);
  if(['starAtrPeriod','tweezerAtrPeriod'].some(key=>!Number.isSafeInteger(c[key])||c[key]<1||c[key]>1000)||!Number.isSafeInteger(c.maxBars)||c.maxBars<3||c.maxBars>10000)throw TypeError('Invalid pattern history limit');
  if(c.asOfTime!==null&&!finite(c.asOfTime))throw TypeError('Invalid asOfTime');
  return Object.freeze(c);
}

// No missing rows are filtered out: an invalid or out-of-order series fails as
// a whole, so candles separated by a hole never become adjacent by accident.
export function normalizeCandleBars(input,config={}){
  const c=validatePatternConfig(config),errors=[],bars=[];
  if(!Array.isArray(input))return {ok:false,bars:[],errors:[{index:null,code:'BARS_REQUIRED'}],reasonCodes:['BARS_REQUIRED']};
  if(input.length>c.maxBars)return {ok:false,bars:[],errors:[{index:null,code:'BAR_LIMIT_EXCEEDED'}],reasonCodes:['BAR_LIMIT_EXCEEDED']};
  let previousTime=null,previousCloseTime=null,openSeen=false;
  const anyTime=input.some(b=>b&&b.time!==undefined);
  for(let index=0;index<input.length;index++){
    const source=input[index];
    if(!source||typeof source!=='object'||!['open','high','low','close'].every(key=>finite(source[key]))){errors.push({index,code:'INVALID_OHLC'});continue;}
    const {open,high,low,close}=source;
    if(high<Math.max(open,close)||low>Math.min(open,close)||high<low)errors.push({index,code:'INCONSISTENT_OHLC'});
    if(typeof source.closed!=='boolean')errors.push({index,code:'BAR_CLOSE_UNKNOWN'});
    if(c.mode==='closed'&&openSeen&&source.closed===true)errors.push({index,code:'OPEN_BAR_BEFORE_CLOSED'});
    if(source.closed===false)openSeen=true;
    const chartType=source.chartType??c.chartType;
    if(!normalChart(chartType))errors.push({index,code:'UNSUPPORTED_CHART_TYPE'});
    const time=source.time===undefined?null:source.time,closeTime=source.closeTime===undefined?null:source.closeTime,knownAt=source.knownAt??closeTime;
    if((c.requireTimestamps||anyTime)&&!finite(time))errors.push({index,code:'BAR_TIME_REQUIRED'});
    if(time!==null&&!finite(time))errors.push({index,code:'INVALID_BAR_TIME'});
    if(finite(time)&&previousTime!==null&&time<=previousTime)errors.push({index,code:'BAR_TIME_NOT_INCREASING'});
    if(finite(time))previousTime=time;
    if(c.requireTimestamps&&!finite(closeTime))errors.push({index,code:'BAR_CLOSE_TIME_REQUIRED'});
    if(closeTime!==null&&(!finite(closeTime)||finite(time)&&closeTime<=time))errors.push({index,code:'INVALID_CLOSE_TIME'});
    if(finite(closeTime)&&previousCloseTime!==null&&closeTime<=previousCloseTime)errors.push({index,code:'CLOSE_TIME_NOT_INCREASING'});
    if(finite(closeTime))previousCloseTime=closeTime;
    if(source.knownAt!==undefined&&(!finite(source.knownAt)||source.closed===true&&finite(closeTime)&&source.knownAt<closeTime||source.closed===false&&finite(time)&&source.knownAt<time))errors.push({index,code:'INVALID_KNOWN_AT'});
    const available=c.asOfTime===null||finite(knownAt)&&knownAt<=c.asOfTime;
    bars.push({index,open,high,low,close,closed:source.closed===true,time,closeTime,knownAt:finite(knownAt)?knownAt:null,chartType,available});
  }
  return {ok:errors.length===0,bars:errors.length?[]:bars,errors,reasonCodes:unique(errors.map(error=>error.code))};
}

export function candleAnatomy(bar){
  if(!bar||!['open','high','low','close'].every(key=>finite(bar[key]))||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low)return null;
  const range=bar.high-bar.low,body=Math.abs(bar.close-bar.open),bodyLow=Math.min(bar.open,bar.close),bodyHigh=Math.max(bar.open,bar.close),upper=bar.high-bodyHigh,lower=bodyLow-bar.low;
  return {range,body,bodyLow,bodyHigh,upper,lower,bodyRatio:range>0?body/range:null,upperRatio:range>0?upper/range:null,lowerRatio:range>0?lower/range:null,closePosition:range>0?(bar.close-bar.low)/range:null,direction:bar.close>bar.open?'LONG':bar.close<bar.open?'SHORT':'NEUTRAL'};
}

// ATR is Wilder-smoothed: first TR is H-L, then TR includes the prior close;
// the first ATR is the SMA of period true ranges. Stars use only ATR[i-3],
// which was known before the three-candle pattern began.
function priorAtrSeries(bars,period,mode){
  const values=new Array(bars.length).fill(null);let seed=0,count=0,last=null,previousClose=null;
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(!b.available||mode==='closed'&&!b.closed){seed=0;count=0;last=null;previousClose=null;continue;}
    const tr=previousClose===null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-previousClose),Math.abs(b.low-previousClose));previousClose=b.close;
    if(last===null){seed+=tr;count++;if(count===period)last=seed/period;}else last=(last*(period-1)+tr)/period;
    values[i]=last;
  }
  return values;
}

export function analyzeCandlePatterns(input,config={}){return analyzeCandlePatternsCore(input,config);}
function analyzeCandlePatternsCore(input,config={},prefix=null){
  const empty=(status,reasonCodes,extra={})=>({definitionVersion:PATTERN_DEFINITION_VERSION,sourceKind:PATTERN_SOURCE_KIND,status,reasonCodes,patterns:[],byBar:[],features:[],config:null,...extra});
  let c;try{c=validatePatternConfig(config);}catch(error){return empty('INVALID_CONFIG',['INVALID_PATTERN_CONFIG'],{detail:String(error.message)});}
  const normalized=normalizeCandleBars(input,c);
  if(!normalized.ok)return empty('INVALID_INPUT',normalized.reasonCodes,{errors:normalized.errors,config:{...c}});
  const bars=normalized.bars;
  if(!bars.length)return empty('NO_DATA',['NO_BARS'],{config:{...c}});
  const features=bars.map(candleAnatomy),atr=prefix?.atrValues??priorAtrSeries(bars,c.starAtrPeriod,c.mode),tweezerAtr=prefix?.tweezerAtrValues??(c.tweezerAtrPeriod===c.starAtrPeriod?atr:priorAtrSeries(bars,c.tweezerAtrPeriod,c.mode)),patterns=[],byBar=[],reasons=[],prefixKnownAt=[];
  let latestKnownAt=prefix?.knownAt??-Infinity;
  for(const bar of bars){latestKnownAt=Math.max(latestKnownAt,finite(bar.knownAt)?bar.knownAt:Infinity);prefixKnownAt.push(latestKnownAt);}
  const minimum=c.tickSize!==null?Math.max(c.minRange??0,c.minRangeTicks*c.tickSize):c.minRange;
  // Each comparison uses only its own operands. A distant future price must
  // never change the numerical tolerance of an earlier pattern.
  const epsilon=(a,b)=>Math.max(1,Math.abs(a),Math.abs(b))*Number.EPSILON*32;
  const le=(a,b)=>a<=b+epsilon(a,b),ge=(a,b)=>a+epsilon(a,b)>=b,lt=(a,b)=>a<b-epsilon(a,b),gt=(a,b)=>a>b+epsilon(a,b);
  const usable=index=>index>=0&&bars[index].available&&(c.mode==='preview'||bars[index].closed)&&features[index].range>0&&minimum!==null&&ge(features[index].range,minimum);
  const spanUsable=(index,length)=>{for(let j=index-length+1;j<=index;j++)if(!usable(j)||!c.allowPatternAcrossSessionGaps&&j>index-length+1&&finite(bars[j].time)&&finite(bars[j-1].closeTime)&&bars[j].time!==bars[j-1].closeTime)return false;return true;};
  for(let i=0;i<bars.length;i++){
    const b=bars[i],f=features[i],previous=bars[i-1],pf=features[i-1];
    const row={barIndex:i,time:b.time,closeTime:b.closeTime,knownAt:b.knownAt,ohlc:{open:b.open,high:b.high,low:b.low,close:b.close},closed:b.closed,available:b.available,patternIds:[],reasonCodes:[],checks:{}};
    byBar.push(row);
    if(!b.available)row.reasonCodes.push('BAR_NOT_YET_KNOWN');
    if(c.mode==='closed'&&!b.closed)row.reasonCodes.push('OPEN_BAR_EXCLUDED');
    if(f.range===0)row.reasonCodes.push('ZERO_RANGE');
    if(minimum===null)row.reasonCodes.push('TICK_SIZE_OR_MIN_RANGE_REQUIRED');
    else if(f.range>0&&!ge(f.range,minimum))row.reasonCodes.push('BELOW_MIN_RANGE');
    if(!usable(i)){reasons.push(...row.reasonCodes);continue;}
    const add=(id,direction,length,conditions,evidence={},variant='guide')=>{
      const matched=spanUsable(i,length)&&Object.values(conditions).every(Boolean);
      const crossesSession=length>1&&i-length+1>=0&&bars.slice(i-length+2,i+1).some((bar,index)=>finite(bar.time)&&finite(bars[i-length+1+index].closeTime)&&bar.time!==bars[i-length+1+index].closeTime);
      row.checks[id]={matched,conditions:{...conditions},...(!spanUsable(i,length)?{reason:crossesSession&&!c.allowPatternAcrossSessionGaps?'PATTERN_SPANS_SESSION_BOUNDARY':'INSUFFICIENT_ELIGIBLE_HISTORY'}:{})};
      if(!matched)return;
      const startIndex=i-length+1,used=bars.slice(startIndex,i+1),known=used.map(bar=>bar.knownAt),timestampsKnown=known.every(finite);
      const final=c.mode==='closed'&&c.unit==='price'&&c.requireTimestamps&&used.every(bar=>bar.closed)&&timestampsKnown;
      const event={id,patternId:id,direction,barIndex:i,startIndex,endIndex:i,span:length,variant,definitionVersion:PATTERN_DEFINITION_VERSION,sourceKind:PATTERN_SOURCE_KIND,
        status:final?'DETECTED':'PROVISIONAL',final,eligibleForConfirmation:final,knownAt:timestampsKnown?Math.max(...known):null,
        barOpenTime:b.time,barCloseTime:b.closeTime,signalHigh:Math.max(...used.map(bar=>bar.high)),signalLow:Math.min(...used.map(bar=>bar.low)),
        evidence:{...evidence,conditions:{...conditions}}};
      patterns.push(event);row.patternIds.push(id);
    };
    const doji=le(f.bodyRatio,c.dojiBodyMaxRatio),anatomy={...f};
    add('DOJI','NEUTRAL',1,{smallBody:doji},anatomy);
    add('DRAGONFLY_DOJI','LONG',1,{doji,longLowerWick:ge(f.lowerRatio,c.dojiWickMinRatio),smallUpperWick:le(f.upperRatio,c.dojiOppositeWickMaxRatio)},anatomy);
    add('GRAVESTONE_DOJI','SHORT',1,{doji,longUpperWick:ge(f.upperRatio,c.dojiWickMinRatio),smallLowerWick:le(f.lowerRatio,c.dojiOppositeWickMaxRatio)},anatomy);
    add('HAMMER_SHAPE','LONG',1,{nonzeroBody:f.body>0,smallBody:le(f.bodyRatio,c.hammerBodyMaxRatio),longLowerWick:ge(f.lower,c.hammerWickBodyMinRatio*f.body),smallUpperWick:le(f.upperRatio,c.hammerOppositeWickMaxRatio),highClose:ge(f.closePosition,c.hammerCloseMinRatio)},anatomy);
    add('SHOOTING_STAR_SHAPE','SHORT',1,{nonzeroBody:f.body>0,smallBody:le(f.bodyRatio,c.hammerBodyMaxRatio),longUpperWick:ge(f.upper,c.hammerWickBodyMinRatio*f.body),smallLowerWick:le(f.lowerRatio,c.hammerOppositeWickMaxRatio),lowClose:le(f.closePosition,1-c.hammerCloseMinRatio)},anatomy);
    add('HANGING_MAN_SHAPE','SHORT',1,{nonzeroBody:f.body>0,smallBody:le(f.bodyRatio,c.hammerBodyMaxRatio),longLowerWick:ge(f.lower,c.hammerWickBodyMinRatio*f.body),smallUpperWick:le(f.upperRatio,c.hammerOppositeWickMaxRatio),highClose:ge(f.closePosition,c.hammerCloseMinRatio)},{...anatomy,requiredPriorState:'TREND_UP',contextualMeaning:'HANGING_MAN_AFTER_RISE'},'contextual_hammer_geometry');
    add('INVERTED_HAMMER_SHAPE','LONG',1,{nonzeroBody:f.body>0,smallBody:le(f.bodyRatio,c.hammerBodyMaxRatio),longUpperWick:ge(f.upper,c.hammerWickBodyMinRatio*f.body),smallLowerWick:le(f.lowerRatio,c.hammerOppositeWickMaxRatio),lowClose:le(f.closePosition,1-c.hammerCloseMinRatio)},{...anatomy,requiredPriorState:'TREND_DOWN',contextualMeaning:'INVERTED_HAMMER_AFTER_DECLINE'},'contextual_shooting_geometry');
    add('BULLISH_PIN_SHAPE','LONG',1,{longLowerWick:ge(f.lowerRatio,c.pinWickMinRatio),smallBody:le(f.bodyRatio,c.pinBodyMaxRatio),smallUpperWick:le(f.upperRatio,c.pinOppositeWickMaxRatio),highClose:ge(f.closePosition,c.pinCloseMinRatio)},anatomy);
    add('BEARISH_PIN_SHAPE','SHORT',1,{longUpperWick:ge(f.upperRatio,c.pinWickMinRatio),smallBody:le(f.bodyRatio,c.pinBodyMaxRatio),smallLowerWick:le(f.lowerRatio,c.pinOppositeWickMaxRatio),lowClose:le(f.closePosition,1-c.pinCloseMinRatio)},anatomy);
    if(!previous)continue;
    const opposite=f.direction!=='NEUTRAL'&&pf.direction!=='NEUTRAL'&&f.direction!==pf.direction;
    const engulf={tickKnown:c.tickSize!==null,bodyContains:le(f.bodyLow,pf.bodyLow)&&ge(f.bodyHigh,pf.bodyHigh),oneTickExtension:c.tickSize!==null&&(ge(pf.bodyLow-f.bodyLow,c.tickSize)||ge(f.bodyHigh-pf.bodyHigh,c.tickSize))};
    add('BULLISH_ENGULFING','LONG',2,{previousDown:pf.direction==='SHORT',currentUp:f.direction==='LONG',...engulf},{previousBodyLow:pf.bodyLow,previousBodyHigh:pf.bodyHigh,...anatomy});
    add('BEARISH_ENGULFING','SHORT',2,{previousUp:pf.direction==='LONG',currentDown:f.direction==='SHORT',...engulf},{previousBodyLow:pf.bodyLow,previousBodyHigh:pf.bodyHigh,...anatomy});
    const bodyContained=c.allowEqualHaramiEdges?ge(f.bodyLow,pf.bodyLow)&&le(f.bodyHigh,pf.bodyHigh):gt(f.bodyLow,pf.bodyLow)&&lt(f.bodyHigh,pf.bodyHigh);
    const harami={previousBodyNonzero:pf.body>0,bodyContained,smallBody:le(f.body,c.haramiBodyMaxRatio*pf.body),oppositeColor:!c.requireOppositeHarami||opposite};
    add('BULLISH_HARAMI','LONG',2,{previousDown:pf.direction==='SHORT',...harami},{...anatomy});
    add('BEARISH_HARAMI','SHORT',2,{previousUp:pf.direction==='LONG',...harami},{...anatomy});
    add('HARAMI_CROSS',pf.direction==='SHORT'?'LONG':pf.direction==='LONG'?'SHORT':'NEUTRAL',2,{enabled:c.enableHaramiCross,previousBodyNonzero:pf.body>0,bodyContained,smallBody:le(f.body,c.haramiBodyMaxRatio*pf.body),doji},{...anatomy},'harami_cross');
    add('INSIDE_BAR','NEUTRAL',2,{highContained:c.allowEqualInsideEdges?le(b.high,previous.high):lt(b.high,previous.high),lowContained:c.allowEqualInsideEdges?ge(b.low,previous.low):gt(b.low,previous.low)},
      {motherIndex:i-1,motherHigh:previous.high,motherLow:previous.low},c.allowEqualInsideEdges?'inclusive':'strict');
    add('OUTSIDE_BAR','NEUTRAL',2,{higherHigh:gt(b.high,previous.high),lowerLow:lt(b.low,previous.low)},{} ,'strict');
    const priorTweezerAtr=i>=2?tweezerAtr[i-2]:i===1?prefix?.tweezerAtrBeforeInput:null,atrAvailableBeforePair=finite(priorTweezerAtr)&&priorTweezerAtr>0&&(!c.requireTimestamps||(i>=2?prefixKnownAt[i-2]:prefix?.knownAt??Infinity)<=previous.time);
    const tweezerTolerance=c.tweezerToleranceMode==='ticks'?c.tickSize===null?null:c.tweezerToleranceTicks*c.tickSize:atrAvailableBeforePair?priorTweezerAtr*c.tweezerToleranceAtr:null;
    const tickCoordinate=price=>{if(c.tickSize===null)return null;const raw=price/c.tickSize,rounded=Math.round(raw);return Number.isSafeInteger(rounded)&&Math.abs(raw-rounded)<=Math.max(1,Math.abs(raw))*Number.EPSILON*32?rounded:null;};
    const comparison=key=>{const currentTicks=tickCoordinate(b[key]),previousTicks=tickCoordinate(previous[key]),distanceTicks=currentTicks===null||previousTicks===null?null:Math.abs(currentTicks-previousTicks),toleranceTicks=c.tickSize!==null&&finite(tweezerTolerance)?tweezerTolerance/c.tickSize:null;return {currentTicks,previousTicks,distanceTicks,toleranceTicks,passed:distanceTicks!==null&&toleranceTicks!==null&&le(distanceTicks,toleranceTicks)};};
    const lows=comparison('low'),highs=comparison('high'),tweezers={tickKnown:c.tickSize!==null,oppositeColor:!c.requireOppositeTweezer||opposite,toleranceAvailable:finite(tweezerTolerance)};
    const tweezerEvidence={tolerance:tweezerTolerance,toleranceMode:c.tweezerToleranceMode,priorAtr:priorTweezerAtr,atrIndex:i-2,atrKnownBeforePattern:atrAvailableBeforePair};
    add('TWEEZER_BOTTOM','LONG',2,{...tweezers,pricesOnTickGrid:lows.distanceTicks!==null,equalLows:lows.passed},{distance:Math.abs(b.low-previous.low),...tweezerEvidence,...lows},c.tweezerToleranceMode);
    add('TWEEZER_TOP','SHORT',2,{...tweezers,pricesOnTickGrid:highs.distanceTicks!==null,equalHighs:highs.passed},{distance:Math.abs(b.high-previous.high),...tweezerEvidence,...highs},c.tweezerToleranceMode);
    if(c.tickSize===null)row.reasonCodes.push('TICK_SIZE_REQUIRED_FOR_ENGULFING_AND_TWEEZERS');
    if(i<2)continue;
    const first=bars[i-2],ff=features[i-2],middle=previous,mf=pf,priorAtr=i>=3?atr[i-3]:prefix?.atrBeforeInput??null,firstMid=(first.open+first.close)/2,middleMid=(middle.open+middle.close)/2;
    const atrKnownBeforePattern=!c.requireTimestamps||finite(first.time)&&(i>=3?prefixKnownAt[i-3]:prefix?.knownAt??Infinity)<=first.time;
    const significant={atrWarmup:finite(priorAtr)&&priorAtr>0,atrKnownBeforePattern,significantFirstBody:finite(priorAtr)&&priorAtr>0&&ge(ff.body,c.starFirstBodyMinAtr*priorAtr),smallMiddleBody:le(mf.body,c.starMiddleBodyMaxRatio*ff.body)};
    add('MORNING_STAR','LONG',3,{...significant,firstDown:ff.direction==='SHORT',lastUp:f.direction==='LONG',middleNotAbove:le(middleMid,firstMid),closePastMidpoint:gt(b.close,firstMid),
      requiredGaps:c.starMode!=='strict_gap'||lt(mf.bodyHigh,ff.bodyLow)&&gt(f.bodyLow,mf.bodyHigh)},
      {priorAtr,atrIndex:i-3,atrMethod:'Wilder',atrPeriod:c.starAtrPeriod,firstMid,middleMid,middleDoji:le(mf.bodyRatio,c.dojiBodyMaxRatio),subtype:le(mf.bodyRatio,c.dojiBodyMaxRatio)?'MORNING_DOJI_STAR':'MORNING_STAR'},c.starMode);
    add('EVENING_STAR','SHORT',3,{...significant,firstUp:ff.direction==='LONG',lastDown:f.direction==='SHORT',middleNotBelow:ge(middleMid,firstMid),closePastMidpoint:lt(b.close,firstMid),
      requiredGaps:c.starMode!=='strict_gap'||gt(mf.bodyLow,ff.bodyHigh)&&lt(f.bodyHigh,mf.bodyLow)},
      {priorAtr,atrIndex:i-3,atrMethod:'Wilder',atrPeriod:c.starAtrPeriod,firstMid,middleMid,middleDoji:le(mf.bodyRatio,c.dojiBodyMaxRatio),subtype:le(mf.bodyRatio,c.dojiBodyMaxRatio)?'EVENING_DOJI_STAR':'EVENING_STAR'},c.starMode);
    if(!finite(priorAtr))row.reasonCodes.push('STAR_ATR_WARMUP_REQUIRED');
  }
  reasons.push(...byBar.flatMap(row=>row.reasonCodes));
  if(c.mode==='preview')reasons.push('PREVIEW_ONLY');
  if(c.unit==='pixels')reasons.push('PIXEL_UNITS_NOT_MARKET_PRICES');
  if(!c.requireTimestamps)reasons.push('TIMESTAMPS_UNVERIFIED');
  return {definitionVersion:PATTERN_DEFINITION_VERSION,sourceKind:PATTERN_SOURCE_KIND,status:c.mode==='preview'||c.unit==='pixels'||!c.requireTimestamps?'PROVISIONAL':'OK',reasonCodes:unique(reasons),patterns,byBar,features,config:{...c},atr,tweezerAtr,availabilityPrefixKnownAt:prefixKnownAt};
}

// Re-evaluate only the two preceding candles and the forming candle. Wilder
// ATR values are copied from the exact closed analysis, never re-seeded from
// a short tail. No open candle becomes a closed/final observation here.
export function analyzeCandlePatternTail(openBar,{closedBars=[],closedPatterns,asOfTime}={}){
  const unavailable=reason=>({definitionVersion:PATTERN_DEFINITION_VERSION,status:'UNAVAILABLE',reasonCodes:[reason],patterns:[],byBar:[],features:[],config:closedPatterns?.config??null,candidateOnly:true,final:false,orderEligible:false,barsEvaluated:0});
  if(!finite(asOfTime)||!openBar||openBar.closed!==false||!finite(openBar.time)||openBar.time>asOfTime||!finite(openBar.closeTime)||openBar.closeTime<=openBar.time)return unavailable('FORMING_BAR_OBSERVATION_REQUIRED');
  if(!Array.isArray(closedBars)||closedPatterns?.definitionVersion!==PATTERN_DEFINITION_VERSION||closedPatterns.config?.mode!=='closed'||closedPatterns.config?.unit!=='price'||closedPatterns.byBar?.length!==closedBars.length)return unavailable('MATCHING_CLOSED_PATTERN_CACHE_REQUIRED');
  const offset=Math.max(0,closedBars.length-2),tail=closedBars.slice(offset);
  for(let i=0;i<tail.length;i++){const cached=closedPatterns.byBar[offset+i],bar=tail[i];if(bar.closed!==true||cached.time!==bar.time||cached.closeTime!==bar.closeTime||['open','high','low','close'].some(key=>cached.ohlc[key]!==bar[key])||(bar.knownAt??bar.closeTime)!==cached.knownAt)return unavailable('CLOSED_PATTERN_CACHE_MISMATCH');}
  if(tail.length&&openBar.time<tail.at(-1).closeTime)return unavailable('FORMING_BAR_TIME_OVERLAP');
  const knownBefore=offset?closedPatterns.availabilityPrefixKnownAt?.[offset-1]??Infinity:-Infinity;
  const prefix={knownAt:knownBefore,atrBeforeInput:closedPatterns.atr?.[offset-1]??null,tweezerAtrBeforeInput:closedPatterns.tweezerAtr?.[offset-1]??null,atrValues:[...(closedPatterns.atr??[]).slice(offset),null],tweezerAtrValues:[...(closedPatterns.tweezerAtr??[]).slice(offset),null]};
  const result=analyzeCandlePatternsCore([...tail,{...openBar,knownAt:asOfTime}],{...closedPatterns.config,mode:'preview',asOfTime},prefix),last=result.byBar.length-1;
  return {...result,patterns:result.patterns.filter(pattern=>pattern.endIndex===last),candidateOnly:true,final:false,orderEligible:false,barsEvaluated:tail.length+1,globalIndexOffset:offset,atrSeedPolicy:'EXACT_CLOSED_ANALYSIS_PREFIX'};
}
