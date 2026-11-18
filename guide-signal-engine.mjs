import {analyzeCandlePatterns,validatePatternConfig} from './candle-patterns.mjs';
import {analyzeMarketContext,analyzeMultiTimeframe,analyzeInsideSequence,validateContextConfig,calculateIndicators,projectGuideTrendline,prepareGuideReversalTrendline,evaluateGuideReversalTrendlineBreak} from './market-context.mjs';
import {planGuideRisk,roundGuidePriceToTick} from './guide-risk.mjs';
import {declaredSessionGapMatches} from './session-gap-proof.mjs';
import {GUIDE_STRATEGY_POLICY,guideStrategyProfilesForCandidate,guideStrategyConfig,describeGuideStrategyProfiles,createGuideStrategyProof} from './guide-strategy-policy.mjs';

export const GUIDE_SIGNAL_VERSION='guide-signals-5';
// Standard app workflows evaluate every implemented scenario family. Keep the
// low-level context defaults stable for versioned research inputs; applications
// opt into the causal role-reversal rule explicitly and record it in exports.
export const GUIDE_ALL_SCENARIO_CONTEXT=Object.freeze({roleReversalEnabled:true});
export const GUIDE_SIGNAL_DEFAULTS=Object.freeze({strategyPolicy:'configured',confirmationBufferTicks:1,stopBufferTicks:null,expiryBars:3,insideExpiryBars:5,minConditions:2,requireLocation:true,requireRisk:true,requireHigherTimeframe:false,requireEma:false,requireFib:false,requireTrendline:false,requireSupplyDemand:false,higherTimeframePolicy:'all_aligned',engulfingStopReference:'formation',rangeTargetPolicy:'fixed_r',maxSignalRangeAtr:null,entryLimitRetracement:.5,entryExpiryBars:null,entryMode:'close_confirmation',maxBars:600});
const finite=Number.isFinite;
const clone=value=>structuredClone(value);
const directional=direction=>['LONG','SHORT'].includes(direction);
const normalChart=value=>['standard','candles'].includes(value);
const intersects=(bar,zone)=>bar.low<=zone.upper&&bar.high>=zone.lower;
const REJECTION_LONG=new Set(['HAMMER_SHAPE','INVERTED_HAMMER_SHAPE','BULLISH_PIN_SHAPE','DRAGONFLY_DOJI']);
const REJECTION_SHORT=new Set(['SHOOTING_STAR_SHAPE','HANGING_MAN_SHAPE','BEARISH_PIN_SHAPE','GRAVESTONE_DOJI']);
const INTERNAL_ANALYSIS_MEMO=Symbol('guide-analysis-memo');
export function validateGuideSignalConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(GUIDE_SIGNAL_DEFAULTS,key)))throw TypeError('INVALID_SIGNAL_CONFIG');
  const config={...GUIDE_SIGNAL_DEFAULTS,...input};
  if(!['configured',GUIDE_STRATEGY_POLICY].includes(config.strategyPolicy))throw TypeError('INVALID_STRATEGY_POLICY');
  for(const key of ['confirmationBufferTicks'])if(!finite(config[key])||config[key]<0||config[key]>100)throw TypeError('INVALID_'+key);
  if(config.stopBufferTicks!==null&&(!Number.isSafeInteger(config.stopBufferTicks)||config.stopBufferTicks<0||config.stopBufferTicks>100)||config.maxSignalRangeAtr!==null&&(!finite(config.maxSignalRangeAtr)||config.maxSignalRangeAtr<=0)||!finite(config.entryLimitRetracement)||config.entryLimitRetracement<0||config.entryLimitRetracement>1||config.entryExpiryBars!==null&&(!Number.isSafeInteger(config.entryExpiryBars)||config.entryExpiryBars<1||config.entryExpiryBars>100)||!['all_aligned','structure_and_location'].includes(config.higherTimeframePolicy)||!['formation','signal_bar'].includes(config.engulfingStopReference)||!['fixed_r','range_midpoint','opposite_boundary'].includes(config.rangeTargetPolicy))throw TypeError('INVALID_SIGNAL_VARIANT');
  for(const key of ['expiryBars','insideExpiryBars'])if(!Number.isSafeInteger(config[key])||config[key]<1||config[key]>100)throw TypeError('INVALID_'+key);
  if(!Number.isSafeInteger(config.minConditions)||config.minConditions<1||config.minConditions>8||!Number.isSafeInteger(config.maxBars)||config.maxBars<3||config.maxBars>4096)throw TypeError('INVALID_SIGNAL_LIMITS');
  for(const key of ['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'])if(typeof config[key]!=='boolean')throw TypeError('INVALID_'+key);
  // This engine produces alerts after a later close. Stop/limit execution is a
  // different model and must never be silently simulated with ideal fills.
  if(config.entryMode!=='close_confirmation')throw TypeError('UNSUPPORTED_ENTRY_MODE');
  return config;
}

function validateInput(bars,metadata,config,asOf){
  const reasons=[];
  if(metadata.source!=='ohlc')reasons.push('VERIFIED_OHLC_REQUIRED');
  if(!normalChart(metadata.chartType))reasons.push('STANDARD_CANDLES_REQUIRED');
  if(typeof metadata.instrument!=='string'||!metadata.instrument.trim()||typeof metadata.timeframe!=='string'||!metadata.timeframe.trim())reasons.push('INSTRUMENT_TIMEFRAME_REQUIRED');
  if(!finite(metadata.tickSize)||metadata.tickSize<=0)reasons.push('TICK_SIZE_REQUIRED');
  if(!Number.isSafeInteger(metadata.timeframeMs)||metadata.timeframeMs<=0)reasons.push('TIMEFRAME_DURATION_REQUIRED');
  if(typeof metadata.timezone!=='string'||!metadata.timezone.trim()||typeof metadata.session!=='string'||!metadata.session.trim())reasons.push('SESSION_TIMEZONE_REQUIRED');
  else try{new Intl.DateTimeFormat('en',{timeZone:metadata.timezone});}catch{reasons.push('INVALID_TIMEZONE');}
  if(!Array.isArray(bars)||bars.length<1||bars.length>config.maxBars)return {valid:false,reasonCodes:[...reasons,'BAR_COUNT_LIMIT'],bars:[]};
  const available=[];let unavailable=false;
  for(let i=0;i<bars.length;i++){
    const bar=bars[i],previous=bars[i-1];
    if(!bar||!['open','high','low','close'].every(k=>finite(bar[k]))||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low){reasons.push('INVALID_OHLC');break;}
    if(!finite(bar.time)||!finite(bar.closeTime)||bar.closeTime<=bar.time||bar.closeTime-bar.time!==metadata.timeframeMs||previous&&bar.time<previous.closeTime){reasons.push('INVALID_BAR_TIMES');break;}
    const known=bar.knownAt??bar.closeTime;
    if(!finite(known)||known<bar.closeTime||previous&&known<(previous.knownAt??previous.closeTime)){reasons.push('INVALID_AVAILABILITY_TIME');break;}
    if(bar.chartType!==undefined&&!normalChart(bar.chartType)){reasons.push('STANDARD_CANDLES_REQUIRED');break;}
    if(typeof bar.closed!=='boolean'||!bar.closed&&i!==bars.length-1){reasons.push('UNVERIFIED_BAR_CLOSE');break;}
    if(['providerBarIndex','sessionFirst','sessionLast'].some(key=>Object.hasOwn(bar,key))&&(!Number.isSafeInteger(bar.providerBarIndex)||bar.providerBarIndex<0||typeof bar.sessionFirst!=='boolean'||typeof bar.sessionLast!=='boolean')){reasons.push('INVALID_PROVIDER_SESSION_PROOF');break;}
    if(previous&&Number.isSafeInteger(previous.providerBarIndex)&&Number.isSafeInteger(bar.providerBarIndex)&&bar.providerBarIndex!==previous.providerBarIndex+1){reasons.push('PROVIDER_BAR_INDEX_GAP');break;}
    if(previous&&bar.time>previous.closeTime){
      const declared=Array.isArray(metadata.sessionGaps)&&metadata.sessionGaps.some(g=>g?.from===previous.closeTime&&g?.to===bar.time&&g?.kind==='market_closed'&&(g.basis===undefined||declaredSessionGapMatches(g,previous,bar)));
      if(!declared){reasons.push('UNDECLARED_DATA_GAP');break;}
    }
    if(!bar.closed||known>asOf)unavailable=true;
    if(!unavailable)available.push({...bar,knownAt:known,chartType:'standard'});
  }
  return {valid:reasons.length===0,reasonCodes:[...new Set(reasons)],bars:available};
}

function locationFor(bar,context,direction,freezeTime){
  const type=direction==='LONG'?'SUPPORT':'RESISTANCE';
  const known=z=>finite(z.knownAt)&&z.knownAt<=freezeTime;
  const zones=(context.zones??[]).filter(z=>z.type===type&&known(z)&&z.active!==false&&z.invalidatedAt==null&&intersects(bar,z));
  const supplyType=direction==='LONG'?'DEMAND':'SUPPLY';
  const supply=(context.supplyDemand?.zones??[]).filter(z=>z.type===supplyType&&known(z)&&z.active!==false&&z.invalidatedAt==null&&intersects(bar,z));
  return {zones,supply};
}
function higherContextAt(higherTimeframes,metadata,config,contextConfig,freezeTime){
  if(higherTimeframes==null||Array.isArray(higherTimeframes)&&higherTimeframes.length===0||typeof higherTimeframes==='object'&&!Array.isArray(higherTimeframes)&&Object.keys(higherTimeframes).length===0)return {valid:false,alignment:'UNKNOWN',reasonCodes:['HIGHER_TIMEFRAME_NOT_SUPPLIED'],states:{},asOf:freezeTime};
  if(typeof higherTimeframes!=='object'||Array.isArray(higherTimeframes))return {valid:false,alignment:'UNKNOWN',reasonCodes:['HIGHER_TIMEFRAME_OBJECT_REQUIRED'],states:{},asOf:freezeTime};
  const accepted={},availability={},reasonCodes=[];
  for(const [name,entry] of Object.entries(higherTimeframes)){
    const duration=entry?.timeframeMs??entry?.metadata?.timeframeMs;
    if(!Number.isSafeInteger(duration)||duration<=metadata.timeframeMs){reasonCodes.push('HIGHER_TIMEFRAME_DURATION_REQUIRED:'+name);continue;}
    const instrument=entry?.instrument??entry?.metadata?.instrument??metadata.instrument;
    if(instrument!==metadata.instrument){reasonCodes.push('HIGHER_TIMEFRAME_INSTRUMENT_MISMATCH:'+name);continue;}
    const higherMetadata={...metadata,...entry.metadata,instrument,timeframe:entry.timeframe??entry.metadata?.timeframe??name,timeframeMs:duration,sessionGaps:entry.sessionGaps??entry.metadata?.sessionGaps??[]};
    const quality=validateInput(entry.bars,higherMetadata,config,freezeTime);
    if(!quality.valid){reasonCodes.push(...quality.reasonCodes.map(code=>'HIGHER_TIMEFRAME_'+code+':'+name));continue;}
    accepted[name]={bars:quality.bars,timeframe:higherMetadata.timeframe,timeframeMs:duration,sessionGaps:higherMetadata.sessionGaps};
    // Frozen provenance describes only the known prefix. Counting later input
    // here would rewrite an old setup when future higher bars are appended.
    availability[name]={sourceBars:quality.bars.length,availableClosedBars:quality.bars.length,lastAvailableKnownAt:quality.bars.at(-1)?.knownAt??null,lastAvailableCloseTime:quality.bars.at(-1)?.closeTime??null,asOf:freezeTime,timeframeMs:duration,policy:'CONFIRMED_AVAILABLE_PREFIX_ONLY'};
  }
  if(reasonCodes.length)return {valid:false,alignment:'UNKNOWN',reasonCodes,states:{},availability,asOf:freezeTime};
  return {...analyzeMultiTimeframe(accepted,{...contextConfig,tickSize:metadata.tickSize,asOf:freezeTime}),availability};
}
function contextFilters(prior,patternBars,direction,context,config,higherTimeframes,metadata,contextConfig,higherCache=new Map(),scenarioKind=null){
  const freezeTime=patternBars[0].time,last=patternBars.at(-1),locationBar={low:Math.min(...patternBars.map(b=>b.low)),high:Math.max(...patternBars.map(b=>b.high))},location=locationFor(locationBar,context,direction,freezeTime);
  const trend=direction==='LONG'?'TREND_UP':'TREND_DOWN',opposite=direction==='LONG'?'TREND_DOWN':'TREND_UP';
  const state=context.state??'UNKNOWN';
  const trendMatch=state===trend,reversal=state===opposite&&location.zones.length>0;
  const range=context.range,rangeWidth=range?((range.upper??range.high)-(range.lower??range.low)):NaN;
  const rangeLow=range?.lower??range?.low,rangeHigh=range?.upper??range?.high;
  const rangePosition=finite(rangeWidth)&&rangeWidth>0?(last.close-rangeLow)/rangeWidth:null;
  const edge=context.config?.rangeEdgeFraction??.2;
  const rangeEdge=state==='RANGE'&&finite(range?.knownAt)&&range.knownAt<=freezeTime&&rangePosition!==null&&(direction==='LONG'?rangePosition<=edge:rangePosition>=1-edge)&&last.close>=rangeLow&&last.close<=rangeHigh;
  const rangeBuffer=(context.config?.breakBufferTicks??1)*metadata.tickSize,rangeReclaim=scenarioKind==='ENGULFING_RANGE_RECLAIM'&&state==='RANGE'&&finite(range?.knownAt)&&range.knownAt<=freezeTime&&last.close>rangeLow&&last.close<rangeHigh&&(direction==='LONG'?locationBar.low<rangeLow-rangeBuffer:locationBar.high>rangeHigh+rangeBuffer);
  const roleReversal=location.zones.some(zone=>zone.roleReversal===true),knownLocation=location.zones.length>0||location.supply.length>0||rangeEdge||rangeReclaim;
  const indicators=contextConfig.emaEvaluation==='signal_close'?calculateIndicators([...prior,...patternBars],contextConfig):context.indicators??{},ema=Array.isArray(indicators.ema)?indicators.ema.at(-1):indicators.ema?.value??indicators.ema;
  const emaSeries=Array.isArray(indicators.ema)?indicators.ema:[],slopeBars=context.config?.emaSlopeBars??5,oldEma=emaSeries.length>slopeBars?emaSeries.at(-1-slopeBars):null;
  const emaDirection=finite(ema)&&finite(oldEma)&&(direction==='LONG'?last.close>ema&&ema>oldEma:last.close<ema&&ema<oldEma),emaDistance=finite(ema)?contextConfig.emaProximityReference==='close'?Math.abs(last.close-ema):ema<last.low?last.low-ema:ema>last.high?ema-last.high:0:null,emaAtr=indicators.atr?.at(-1),emaTolerance=contextConfig.emaProximityMode==='ticks'?contextConfig.emaProximityTicks*metadata.tickSize:contextConfig.emaProximityMode==='atr'&&finite(emaAtr)?contextConfig.emaProximityAtr*emaAtr:null;
  const emaProximity=contextConfig.emaProximityMode==='disabled'||finite(emaDistance)&&finite(emaTolerance)&&emaDistance<=emaTolerance,emaPass=emaDirection&&emaProximity;
  const tolerance=(context.config?.zoneToleranceTicks??2)*metadata.tickSize;
  const fib=context.fib,fibLevels=fib?.levels??[],fibPass=finite(fib?.knownAt)&&fib.knownAt<=freezeTime&&fib.direction===(direction==='LONG'?'UP':'DOWN')&&fibLevels.some(level=>{const p=level.price;return finite(p)&&locationBar.low<=p+tolerance&&locationBar.high>=p-tolerance;});
  const lines=context.trendlines??[],trendlinePass=lines.some(line=>{
    if(!finite(line.knownAt)||line.knownAt>freezeTime||line.type!==(direction==='LONG'?'SUPPORT':'RESISTANCE')||line.active!==true||line.touches<contextConfig.trendlineMinTouches||contextConfig.trendlineMinTouches===3&&(!finite(line.thirdTouchKnownAt)||line.thirdTouchKnownAt>freezeTime))return false;
    // Project the frozen anchors, rather than comparing the new pattern with
    // the line's stale price at the last pre-pattern bar.
    return patternBars.some((bar,offset)=>{const index=prior.length+offset,p=projectGuideTrendline(line,{index,time:bar.time});return finite(p)&&(contextConfig.trendlineTouchMode==='close_distance'?Math.abs(bar.close-p)<=tolerance:contextConfig.trendlineTouchMode==='extreme_distance'?Math.abs((direction==='LONG'?bar.low:bar.high)-p)<=tolerance:bar.low<=p+tolerance&&bar.high>=p-tolerance);});
  });
  const reversalLineFamily=['HANGING_MAN_REVERSAL','INVERTED_HAMMER_REVERSAL'].includes(scenarioKind)?scenarioKind:!scenarioKind&&reversal?'REVERSAL_AT_ZONE':null;
  const reversalLineRequired=config.requireTrendline&&reversalLineFamily!==null;
  const reversalTrendlineGate=reversalLineRequired?prepareGuideReversalTrendline(context,{family:reversalLineFamily,direction,freezeTime,formationCloseTime:patternBars.at(-1).closeTime,minTouches:contextConfig.trendlineMinTouches,tickSize:metadata.tickSize,breakBufferTicks:contextConfig.breakBufferTicks}):null;
  if(!higherCache.has(freezeTime))higherCache.set(freezeTime,higherContextAt(higherTimeframes,metadata,config,contextConfig,freezeTime));
  const suppliedHigher=higherCache.get(freezeTime),orderedHigher=Object.keys(suppliedHigher.states??{}).sort((a,b)=>(suppliedHigher.availability?.[b]?.timeframeMs??0)-(suppliedHigher.availability?.[a]?.timeframeMs??0)),structureName=orderedHigher[0],locationName=orderedHigher[1],structureState=suppliedHigher.states?.[structureName],locationState=suppliedHigher.states?.[locationName],higherLocation=locationState?locationFor(locationBar,locationState,direction,freezeTime):{zones:[],supply:[]};
  const policyEvaluation={policy:config.higherTimeframePolicy,structureTimeframe:structureName??null,locationTimeframe:locationName??null,structureMatches:structureState?.state===trend,matchingZoneIds:[...higherLocation.zones,...higherLocation.supply].map(zone=>zone.id),availabilityPolicy:'CONFIRMED_AVAILABLE_PREFIX_ONLY'};
  const higher={...suppliedHigher,policyEvaluation},higherPass=higher.valid===true&&(config.higherTimeframePolicy==='all_aligned'?higher.alignment===(direction==='LONG'?'ALIGNED_UP':'ALIGNED_DOWN'):orderedHigher.length>=2&&policyEvaluation.structureMatches&&policyEvaluation.matchingZoneIds.length>0);
  const checks=[
    {id:'STRUCTURE',passed:scenarioKind==='ENGULFING_RANGE_RECLAIM'?rangeReclaim:scenarioKind==='ROLE_REVERSAL_RETEST'?roleReversal:trendMatch||reversal||rangeEdge,required:true},
    {id:'KNOWN_LOCATION',passed:knownLocation,required:config.requireLocation},
    {id:'EMA',passed:emaPass,required:config.requireEma},
    {id:'FIB',passed:fibPass,required:config.requireFib},
    {id:'TRENDLINE',passed:reversalLineRequired?false:trendlinePass,required:config.requireTrendline},
    {id:'SUPPLY_DEMAND',passed:location.supply.length>0,required:config.requireSupplyDemand},
    {id:'HIGHER_TIMEFRAME',passed:higherPass,required:config.requireHigherTimeframe},
  ];
  // An optional calculation, missing warm-up and a calculated rejection are
  // distinct states. Keep the exact observations beside each boolean so the
  // explanation layer never has to invent a reason for a failed filter.
  const availability={
    // A previously established zone's closed break and known retest are a
    // causal structure observation even before two directional pivot pairs
    // classify the wider market. Do not confuse that with missing evidence.
    STRUCTURE:context.valid===true&&(state!=='UNKNOWN'||scenarioKind==='ROLE_REVERSAL_RETEST'&&roleReversal||scenarioKind==='ENGULFING_RANGE_RECLAIM'&&rangeReclaim),
    KNOWN_LOCATION:context.valid===true&&(context.barsUsed??0)>=(context.config?.pivotLeft??2)+(context.config?.pivotRight??2)+1,
    EMA:finite(ema)&&finite(oldEma)&&(contextConfig.emaProximityMode!=='atr'||finite(emaAtr)),FIB:finite(fib?.knownAt)&&fib.knownAt<=freezeTime,
    TRENDLINE:reversalLineRequired?reversalTrendlineGate.available:lines.some(line=>line.touches>=contextConfig.trendlineMinTouches&&(contextConfig.trendlineMinTouches===2||finite(line.thirdTouchKnownAt)&&line.thirdTouchKnownAt<=freezeTime)),
    SUPPLY_DEMAND:context.supplyDemand?.enabled===true&&finite(indicators.atr?.at?.(-1)),
    HIGHER_TIMEFRAME:higher.valid===true&&(config.higherTimeframePolicy==='all_aligned'?Object.values(higher.states??{}).length>0&&Object.values(higher.states).every(value=>value.valid&&value.state!=='UNKNOWN'):orderedHigher.length>=2&&structureState?.valid===true&&structureState.state!=='UNKNOWN'&&locationState?.valid===true),
  };
  const evidence={
    STRUCTURE:{state,trendMatch,reversal,rangeEdge,rangeReclaim,roleReversal},
    KNOWN_LOCATION:{zoneIds:location.zones.map(z=>z.id),supplyZoneIds:location.supply.map(z=>z.id),rangeEdge,rangeReclaim,rangePosition},
    EMA:{close:last.close,ema:finite(ema)?ema:null,previousEma:finite(oldEma)?oldEma:null,slopeBars,evaluation:contextConfig.emaEvaluation,knownAt:contextConfig.emaEvaluation==='signal_close'?last.knownAt:prior.at(-1)?.knownAt??null,directionPassed:emaDirection,proximityMode:contextConfig.emaProximityMode,proximityReference:contextConfig.emaProximityReference,distance:emaDistance,tolerance:emaTolerance,proximityPassed:emaProximity},
    FIB:{direction:fib?.direction??null,knownAt:fib?.knownAt??null,levels:fibLevels.map(level=>({ratio:level.ratio,price:level.price})),tolerance},
    TRENDLINE:{lineIds:(reversalLineRequired?reversalTrendlineGate.lines:lines).map(line=>line.id),confirmedThirdTouches:(reversalLineRequired?reversalTrendlineGate.lines:lines).filter(line=>finite(line.thirdTouchKnownAt)&&line.thirdTouchKnownAt<=freezeTime).map(line=>line.id),timeBasis:contextConfig.trendlineTimeBasis,scale:contextConfig.trendlineScale,touchMode:contextConfig.trendlineTouchMode,minimumTouches:contextConfig.trendlineMinTouches,tolerance,...(reversalLineRequired?{policy:reversalTrendlineGate.policy,reversalFamily:reversalLineFamily,priorLineType:reversalTrendlineGate.lineType??null,gate:clone(reversalTrendlineGate),requiresLaterClosedBreak:true,confirmation:null}:{})},
    SUPPLY_DEMAND:{enabled:context.supplyDemand?.enabled===true,matchingZoneIds:location.supply.map(z=>z.id),rule:context.supplyDemand?.rule??null,institutionalActivityInferred:false},
    HIGHER_TIMEFRAME:{alignment:higher.alignment,policyEvaluation,availability:higher.availability??{},reasonCodes:higher.reasonCodes??[]},
  };
  for(const check of checks){
    check.available=availability[check.id];check.enabled=check.id!=='SUPPLY_DEMAND'||context.supplyDemand?.enabled===true;
    check.state=!check.enabled?'DISABLED':!check.available?'UNAVAILABLE':check.passed?'PASS':'FAIL';check.evidence=evidence[check.id];
    if(check.id==='TRENDLINE'&&reversalLineRequired&&reversalTrendlineGate.available){check.state='PENDING';check.pendingConfirmation=true;}
    check.reasonCodes=check.passed?[]:check.state==='DISABLED'?['OPTIONAL_RESEARCH_RULE_DISABLED']:check.state==='UNAVAILABLE'?[check.id==='HIGHER_TIMEFRAME'?(higher.reasonCodes?.[0]??'HIGHER_TIMEFRAME_STRUCTURE_NOT_READY'):'INSUFFICIENT_CONFIRMED_'+check.id]:['FILTER_CONDITION_NOT_MET'];
    if(check.pendingConfirmation)check.reasonCodes=['LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED'];
  }
  // Correlated rejection labels are one shape, not several independent votes.
  const conditionsMet=checks.filter(c=>c.passed&&c.available&&c.enabled).length,pending=checks.filter(c=>c.required&&c.pendingConfirmation&&c.available&&c.enabled),missing=checks.filter(c=>c.required&&(!c.passed||!c.available||!c.enabled)&&!pending.includes(c)).map(c=>'MISSING_'+c.id);
  if(!context.valid)missing.push('INVALID_CONTEXT',...(context.reasonCodes??[]));
  if(conditionsMet+pending.length<config.minConditions)missing.push('INSUFFICIENT_CONDITIONS');
  return {passed:missing.length===0&&pending.length===0,armingEligible:missing.length===0,pendingRequiredChecks:pending.map(c=>c.id),reasonCodes:[...new Set([...missing,...pending.flatMap(c=>c.reasonCodes)])],checks,conditionsMet,conditionsEvaluated:checks.length,conditionsAreStatisticallyIndependent:false,setupKind:scenarioKind==='ENGULFING_RANGE_RECLAIM'?'ENGULFING_RANGE_RECLAIM':scenarioKind==='ROLE_REVERSAL_RETEST'?'ROLE_REVERSAL_RETEST':rangeEdge?'RANGE_EDGE':trendMatch?'TREND_CONTINUATION':reversal?'REVERSAL_AT_ZONE':'UNDEFINED',context,location,rangePosition,higherTimeframe:higher,freezeTime,...(reversalTrendlineGate?{reversalTrendlineGate}:{} )};
}

// Preserve the levels that justified the setup, while processing subsequent
// closes causally. A broken boundary cannot become valid again by a later rally.
function frozenContextGuard(filters,config,tickSize,direction){
  const buffer=(filters.context.config?.breakBufferTicks??1)*tickSize,range=filters.context.range;
  const anchors=[...filters.location.zones,...filters.location.supply],broken=new Set();
  return bar=>{
    if(['RANGE_EDGE','ENGULFING_RANGE_RECLAIM'].includes(filters.setupKind)&&(bar.close<range.lower-buffer||bar.close>range.upper+buffer))return 'FROZEN_RANGE_BROKEN';
    if(filters.setupKind==='TREND_CONTINUATION'){
      const pivot=filters.context.pivots?.filter(pivot=>pivot.type===(direction==='LONG'?'LOW':'HIGH')).at(-1);
      if(pivot&&(direction==='LONG'?bar.close<pivot.price-buffer:bar.close>pivot.price+buffer))return 'FROZEN_STRUCTURE_BROKEN';
    }
    for(const zone of anchors)if(direction==='LONG'?bar.close<zone.lower-buffer:bar.close>zone.upper+buffer)broken.add(zone.id);
    if(filters.setupKind==='ROLE_REVERSAL_RETEST'&&filters.location.zones.filter(zone=>zone.roleReversal).every(zone=>broken.has(zone.id)))return 'FROZEN_ROLE_REVERSAL_BROKEN';
    if(filters.setupKind==='REVERSAL_AT_ZONE'&&filters.location.zones.every(zone=>broken.has(zone.id)))return 'FROZEN_REVERSAL_ZONE_BROKEN';
    if(config.requireLocation&&filters.setupKind!=='RANGE_EDGE'&&anchors.length&&anchors.every(zone=>broken.has(zone.id)))return 'FROZEN_REQUIRED_LOCATION_BROKEN';
    return null;
  };
}

export function analyzeGuideSignals(inputBars,options={}){
  const {metadata={},risk=null,higherTimeframes={},patternConfig={},contextConfig={}}=options;
  const config=validateGuideSignalConfig(options.config),asOf=options.asOfTime??Date.now();
  if(!finite(asOf))throw TypeError('INVALID_AS_OF_TIME');
  const quality=validateInput(inputBars,metadata,config,asOf);
  const evaluationStartIndex=options.evaluationStartIndex??0;
  if(!Number.isSafeInteger(evaluationStartIndex)||evaluationStartIndex<0||evaluationStartIndex>(Array.isArray(inputBars)?inputBars.length:0))throw TypeError('INVALID_EVALUATION_START_INDEX');
  if(risk&&finite(metadata.pointValue)&&(!finite(risk.pointValue)||Math.abs(risk.pointValue-metadata.pointValue)>Math.max(1,Math.abs(metadata.pointValue))*Number.EPSILON*8)){
    quality.valid=false;quality.reasonCodes.push('INSTRUMENT_POINT_VALUE_MISMATCH');
  }
  const base={definitionVersion:GUIDE_SIGNAL_VERSION,sourceKind:'original_research_definition',execution:'OBSERVATION_ONLY',orderEligible:false,asOfTime:asOf,metadata:clone(metadata),parameterSnapshot:clone({config,patternConfig,contextConfig,risk}),dataQuality:{valid:quality.valid,reasonCodes:quality.reasonCodes},events:[],signals:[],latest:null};
  if(!quality.valid)return {...base,status:'BLOCKED',reasonCodes:quality.reasonCodes};
  if(!contextConfig||typeof contextConfig!=='object'||Array.isArray(contextConfig))return {...base,status:'BLOCKED',reasonCodes:['INVALID_CONTEXT_CONFIG']};
  const contextValidation=validateContextConfig({...contextConfig,sessionGaps:metadata.sessionGaps??contextConfig.sessionGaps??[],tickSize:metadata.tickSize});
  if(!contextValidation.valid)return {...base,status:'BLOCKED',reasonCodes:contextValidation.reasonCodes};
  try{validatePatternConfig(patternConfig);}catch{return {...base,status:'BLOCKED',reasonCodes:['INVALID_PATTERN_CONFIG']};}
  const bars=quality.bars;
  if(!bars.length)return {...base,status:'WAITING',reasonCodes:['NO_CLOSED_AVAILABLE_BARS']};
  const shapes=analyzeCandlePatterns(bars,{...patternConfig,mode:'closed',unit:'price',tickSize:metadata.tickSize,requireTimestamps:true,asOfTime:asOf});
  if(['INVALID_INPUT','INVALID_CONFIG','INVALID'].includes(shapes.status))return {...base,status:'BLOCKED',reasonCodes:shapes.reasonCodes??['INVALID_PATTERN_DATA'],patterns:shapes};
  const resolvedContextConfig={...contextValidation.config,insideMinRangeTicks:contextConfig.insideMinRangeTicks??Math.max(shapes.config.minRangeTicks,Math.ceil((shapes.config.minRange??0)/metadata.tickSize)),supplyDemandEnabled:config.strategyPolicy===GUIDE_STRATEGY_POLICY||config.requireSupplyDemand||contextConfig.supplyDemandEnabled===true};
  const resolvedContextValidation=validateContextConfig(resolvedContextConfig);
  if(!resolvedContextValidation.valid)return {...base,status:'BLOCKED',reasonCodes:resolvedContextValidation.reasonCodes};
  base.parameterSnapshot=clone({config,patternConfig:shapes.config,contextConfig:{...resolvedContextConfig,asOf},risk,requested:{patternConfig,contextConfig}});
  const candidates=new Map(),buffer=config.confirmationBufferTicks*metadata.tickSize,stopBufferTicks=risk?.stopBufferTicks??config.stopBufferTicks??config.confirmationBufferTicks,stopBuffer=stopBufferTicks*metadata.tickSize;
  if(!Number.isSafeInteger(stopBufferTicks)||stopBufferTicks<0)return {...base,status:'BLOCKED',reasonCodes:['INVALID_STOP_BUFFER_TICKS']};
  const candidateFamily=pattern=>pattern.id==='HANGING_MAN_SHAPE'?'HANGING_MAN_REVERSAL':pattern.id==='INVERTED_HAMMER_SHAPE'?'INVERTED_HAMMER_REVERSAL':null;
  const addCandidate=(pattern,family=null)=>{const key=pattern.startIndex+':'+pattern.endIndex+':'+pattern.direction+':'+(family??'SHAPE');if(!candidates.has(key))candidates.set(key,{endIndex:pattern.endIndex,startIndex:pattern.startIndex,direction:pattern.direction,family,patterns:[]});candidates.get(key).patterns.push(pattern);};
  for(const pattern of shapes.patterns??[]){
    if(!directional(pattern.direction)||pattern.final===false||pattern.eligibleForConfirmation===false)continue;
    addCandidate(pattern,candidateFamily(pattern));
    if(resolvedContextConfig.roleReversalEnabled)addCandidate(pattern,'ROLE_REVERSAL_RETEST');
    if(pattern.id==='BULLISH_ENGULFING'||pattern.id==='BEARISH_ENGULFING')addCandidate(pattern,'ENGULFING_RANGE_RECLAIM');
  }
  // Inside-bar breakouts and false breaks have their own causal return/trigger
  // time; an unbroken Inside Bar has no direction by itself.
  const insideStudies={};
  for(const insideSetup of ['breakout','false_break']){
    const inside=analyzeInsideSequence(bars,{...resolvedContextConfig,tickSize:metadata.tickSize,insideSetup,insideExpiryBars:config.insideExpiryBars,asOf});
    insideStudies[insideSetup]=inside;
    for(const item of inside.events??[]){
      if(!directional(item.direction)||item.eligibleForConfirmation===false)continue;
      addCandidate({id:item.type,direction:item.direction,startIndex:item.motherIndex,endIndex:item.barIndex,knownAt:item.knownAt,final:true,eligibleForConfirmation:true,evidence:clone(item)});
    }
  }
  const memo=options[INTERNAL_ANALYSIS_MEMO],events=[],formationContexts=memo?.formationContexts??new Map(),higherContexts=memo?.higherContexts??new Map();
  const contextAt=startIndex=>{
    if(!formationContexts.has(startIndex))formationContexts.set(startIndex,analyzeMarketContext(bars.slice(0,startIndex),{...resolvedContextConfig,sessionGaps:resolvedContextConfig.sessionGaps.filter(gap=>gap.to<=bars[startIndex].time),tickSize:metadata.tickSize,asOf:bars[startIndex].time}));
    return formationContexts.get(startIndex);
  };
  const evaluatedCandidates=config.strategyPolicy===GUIDE_STRATEGY_POLICY?[...candidates.values()].flatMap(group=>guideStrategyProfilesForCandidate({family:group.family,patternIds:group.patterns.map(p=>p.id)}).map(strategyProfile=>({...group,strategyProfile}))):candidates.values();
  for(const group of evaluatedCandidates){
    const {startIndex,endIndex,direction}=group,signalBar=bars[endIndex];
    if(!signalBar||startIndex<0||startIndex>endIndex||endIndex<evaluationStartIndex)continue;
    const profile=group.strategyProfile,appliedConfig=profile?guideStrategyConfig(profile,config):config;
    const appliedContextConfig=profile?.id==='ENGULFING_EMA'&&resolvedContextConfig.emaProximityMode==='disabled'?{...resolvedContextConfig,emaProximityMode:'ticks'}:resolvedContextConfig;
    const eventId=[metadata.instrument,metadata.timeframe,bars[startIndex].time,signalBar.time,direction,...(group.family?[group.family]:[]),...(profile?[profile.id]:[])].join(':');
    // Terminal decisions depend only on their already-observed prefix. The
    // reusable analyzer invalidates this memo on corrections/config/feed changes.
    if(memo?.finalEvents.has(eventId)){events.push(memo.finalEvents.get(eventId));continue;}
    const prior=bars.slice(0,startIndex),patternBars=bars.slice(startIndex,endIndex+1),rawContext=contextAt(startIndex),context=appliedContextConfig===resolvedContextConfig?rawContext:{...rawContext,config:{...rawContext.config,emaProximityMode:appliedContextConfig.emaProximityMode}};
    const filters=contextFilters(prior,patternBars,direction,context,appliedConfig,higherTimeframes,metadata,appliedContextConfig,higherContexts,group.family);
    const high=Math.max(...patternBars.map(b=>b.high)),low=Math.min(...patternBars.map(b=>b.low));
    const ids=[...new Set(group.patterns.map(p=>p.id))].sort(),inside=ids.some(id=>id.startsWith('INSIDE_'));
    // Scenario aliases retain the contextual meaning of their source shape.
    // Cloning a named reversal into ROLE_REVERSAL_RETEST cannot justify its
    // direction without the same prior trend that the original shape requires.
    const contextualPattern=group.patterns.find(pattern=>['HANGING_MAN_SHAPE','INVERTED_HAMMER_SHAPE'].includes(pattern.id));
    const requiredPriorState=contextualPattern?.id==='HANGING_MAN_SHAPE'?'TREND_UP':contextualPattern?.id==='INVERTED_HAMMER_SHAPE'?'TREND_DOWN':null;
    if(requiredPriorState&&context.state!==requiredPriorState){filters.passed=false;filters.armingEligible=false;filters.reasonCodes.push('CONTEXTUAL_PATTERN_REQUIRES_'+requiredPriorState);const check=filters.checks.find(check=>check.id==='STRUCTURE');check.passed=false;check.state='FAIL';check.evidence.contextualPriorStateRequired=requiredPriorState;check.reasonCodes=['CONTEXTUAL_PATTERN_REQUIRES_'+requiredPriorState];filters.conditionsMet=filters.checks.filter(check=>check.passed).length;}
    const scenarioApplicable=requiredPriorState?context.state===requiredPriorState&&(group.family!=='ROLE_REVERSAL_RETEST'||filters.checks.find(check=>check.id==='STRUCTURE')?.passed===true):['ROLE_REVERSAL_RETEST','ENGULFING_RANGE_RECLAIM'].includes(group.family)?filters.checks.find(check=>check.id==='STRUCTURE')?.passed===true:filters.setupKind!=='UNDEFINED';
    const strategyApplicable=!profile||scenarioApplicable&&profile.applicableSetupKinds.includes(filters.setupKind);
    if(!strategyApplicable){filters.passed=false;filters.armingEligible=false;filters.reasonCodes.push('STRATEGY_CONTEXT_NOT_APPLICABLE');}
    const previousAtr=context.indicators?.atr?.at(-1),signalRange=signalBar.high-signalBar.low,signalRangeCheck={enabled:config.maxSignalRangeAtr!==null,available:finite(previousAtr)&&previousAtr>0,reference:'signal_bar',range:signalRange,formationRange:high-low,priorAtr:previousAtr??null,maximumPriorAtr:config.maxSignalRangeAtr,knownBeforePattern:true};
    if(config.maxSignalRangeAtr!==null&&(!signalRangeCheck.available||signalRange>previousAtr*config.maxSignalRangeAtr)){filters.passed=false;filters.armingEligible=false;filters.reasonCodes.push(signalRangeCheck.available?'SIGNAL_RANGE_EXCEEDS_PRIOR_ATR':'SIGNAL_RANGE_ATR_UNAVAILABLE');}
    const engulfing=ids.includes('BULLISH_ENGULFING')||ids.includes('BEARISH_ENGULFING'),stopBar=engulfing&&config.engulfingStopReference==='signal_bar'?signalBar:null,stopLow=stopBar?.low??low,stopHigh=stopBar?.high??high,breakout=group.patterns.find(pattern=>pattern.id==='INSIDE_BREAKOUT')?.evidence,triggerHigh=breakout?.referenceHigh??high,triggerLow=breakout?.referenceLow??low;
    const event={eventId,instrument:metadata.instrument,timeframe:metadata.timeframe,barOpenTime:signalBar.time,barCloseTime:signalBar.closeTime,
      patternIds:ids,definitionVersion:GUIDE_SIGNAL_VERSION,setupId:group.family??filters.setupKind+(inside?'_INSIDE':''),direction,formationStartTime:patternBars[0].time,detectedAt:signalBar.knownAt,knownAt:signalBar.knownAt,confirmedAt:null,expiresAt:null,expiresAfterBars:inside?config.insideExpiryBars:config.expiryBars,
      signalHigh:high,signalLow:low,signalClose:signalBar.close,trigger:roundGuidePriceToTick(direction==='LONG'?triggerHigh+buffer:triggerLow-buffer,metadata.tickSize,direction==='LONG'?'UP':'DOWN'),invalidation:roundGuidePriceToTick(direction==='LONG'?stopLow-stopBuffer:stopHigh+stopBuffer,metadata.tickSize,direction==='LONG'?'DOWN':'UP'),
      scenarioApplicability:{family:group.family??filters.setupKind,requiredPriorState,observedPriorState:context.state,applicable:scenarioApplicable,contextualName:contextualPattern?.id==='HANGING_MAN_SHAPE'?'HANGING_MAN':contextualPattern?.id==='INVERTED_HAMMER_SHAPE'?'INVERTED_HAMMER':null},signalRangeCheck,stopReference:{mode:engulfing?config.engulfingStopReference:'formation',low:stopLow,high:stopHigh,bufferTicks:stopBufferTicks},breakoutReference:breakout?{mode:breakout.breakoutReference,index:breakout.referenceIndex,high:breakout.referenceHigh,low:breakout.referenceLow}:null,
      contextSnapshot:clone(filters),status:filters.armingEligible?'ARMED':'REJECTED',reasonCodes:[...filters.reasonCodes],parameterSnapshot:clone({...base.parameterSnapshot,config:appliedConfig,patternConfig:{...shapes.config,asOfTime:signalBar.knownAt},contextConfig:context.config}),orderEligible:false,execution:'OBSERVATION_ONLY',confirmationPolicy:'later_close_beyond_setup',riskPlan:null,signalStartIndex:startIndex,signalIndex:endIndex,confirmationIndex:null,...(profile?{strategyId:profile.id}:{})};
    if(event.status==='ARMED'){
      const guard=frozenContextGuard(filters,appliedConfig,metadata.tickSize,direction);
      // A declared Inside false-break model explicitly allows a formation-time
      // excursion followed by reclaim. Its frozen-boundary guard starts at the
      // reclaim close; later closes must still preserve that reclaimed boundary.
      const guardedFormation=ids.includes('INSIDE_FALSE_BREAK')||group.family==='ENGULFING_RANGE_RECLAIM'?patternBars.slice(-1):patternBars;
      for(const bar of guardedFormation){const reason=guard(bar);if(reason){event.status='INVALIDATED';event.reasonCodes=[reason];event.invalidatedAt=bar.knownAt;break;}}
      if(event.status==='ARMED')
      for(let i=endIndex+1;i<bars.length;i++){
        const next=bars[i],age=i-endIndex;
        if(!shapes.config.allowPatternAcrossSessionGaps&&next.time!==bars[i-1].closeTime){event.status='INVALIDATED';event.reasonCodes=['CONFIRMATION_SESSION_BOUNDARY'];event.invalidatedAt=next.knownAt;break;}
        if(age>event.expiresAfterBars){event.status='EXPIRED';event.reasonCodes=['CONFIRMATION_EXPIRED'];event.expiresAt=next.knownAt;break;}
        const contextInvalidation=guard(next);
        if(contextInvalidation){event.status='INVALIDATED';event.reasonCodes=[contextInvalidation];event.invalidatedAt=next.knownAt;break;}
        if(direction==='LONG'?next.close<event.invalidation:next.close>event.invalidation){event.status='INVALIDATED';event.reasonCodes=['CLOSE_BEYOND_INVALIDATION'];event.invalidatedAt=next.knownAt;break;}
        const priceConfirmed=direction==='LONG'?next.close>event.trigger:next.close<event.trigger;
        const lineConfirmation=filters.reversalTrendlineGate?evaluateGuideReversalTrendlineBreak(filters.reversalTrendlineGate,next,{index:i}):null;
        if(!priceConfirmed||lineConfirmation&&!lineConfirmation.passed){
          if(age===event.expiresAfterBars){event.status='EXPIRED';event.reasonCodes=['CONFIRMATION_EXPIRED'];event.expiresAt=next.knownAt;break;}
          continue;
        }
        if(lineConfirmation){
          const check=event.contextSnapshot.checks.find(c=>c.id==='TRENDLINE');check.passed=true;check.state='PASS';check.pendingConfirmation=false;check.reasonCodes=[];check.evidence.confirmation=clone(lineConfirmation);
          event.contextSnapshot.pendingRequiredChecks=[];event.contextSnapshot.conditionsMet=event.contextSnapshot.checks.filter(c=>c.passed).length;event.contextSnapshot.passed=event.contextSnapshot.checks.every(c=>!c.required||c.passed)&&event.contextSnapshot.conditionsMet>=appliedConfig.minConditions;event.contextSnapshot.reasonCodes=event.contextSnapshot.reasonCodes.filter(r=>r!=='LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED');
        }
        event.confirmedAt=next.knownAt;event.confirmationBarCloseTime=next.closeTime;event.confirmationIndex=i;event.confirmationClose=next.close;event.status='CONFIRMED';event.reasonCodes=['LATER_CLOSED_BAR_CONFIRMED'];
        if(risk){
          const obstacle=(context.zones??[]).filter(z=>z.active!==false&&z.invalidatedAt==null&&(direction==='LONG'?z.type==='RESISTANCE'&&z.lower>next.close:z.type==='SUPPORT'&&z.upper<next.close)).map(z=>direction==='LONG'?z.lower:z.upper).sort((a,b)=>direction==='LONG'?a-b:b-a)[0];
          const oppositeZone=context.zones?.find(zone=>zone.id===(direction==='LONG'?context.range?.resistanceId:context.range?.supportId));
          const rangeTarget=filters.setupKind==='RANGE_EDGE'||filters.setupKind==='ENGULFING_RANGE_RECLAIM'?config.rangeTargetPolicy==='range_midpoint'?(context.range.lower+context.range.upper)/2:config.rangeTargetPolicy==='opposite_boundary'?(direction==='LONG'?oppositeZone?.lower??context.range.upper:oppositeZone?.upper??context.range.lower):null:null;
          event.riskPlan=planGuideRisk({...risk,direction,entry:next.close,stop:event.invalidation,stopBufferTicks:0,tickSize:metadata.tickSize,...(finite(rangeTarget)?{target:rangeTarget}:{}),...(finite(obstacle)?{obstaclePrice:obstacle}:{})});
          event.riskPlan.researchTargetPolicy=finite(rangeTarget)?config.rangeTargetPolicy:'fixed_r';event.riskPlan.targetReference=finite(rangeTarget)?{rangeId:context.range.supportId+':'+context.range.resistanceId,knownAt:context.range.knownAt,price:rangeTarget}:null;
          if(event.riskPlan.status!=='PLANNED'){event.status='REJECTED';event.reasonCodes=['RISK_REJECTED',...(event.riskPlan.reasonCodes??[])];}
        }else if(config.requireRisk){event.status='REJECTED';event.reasonCodes=['RISK_PARAMETERS_REQUIRED'];}
        break;
      }
    }
    if(profile)event.strategyProof=createGuideStrategyProof(profile,event.contextSnapshot.checks,{eventId:event.eventId,applicable:strategyApplicable});
    events.push(event);if(memo&&event.status!=='ARMED')memo.finalEvents.set(event.eventId,event);
  }
  events.sort((a,b)=>a.knownAt-b.knownAt||a.eventId.localeCompare(b.eventId));
  const confirmed=events.filter(event=>event.status==='CONFIRMED'),byConfirmation=new Map();
  for(const event of confirmed){
    const key=event.confirmationBarCloseTime;
    if(!byConfirmation.has(key))byConfirmation.set(key,[]);byConfirmation.get(key).push(event);
  }
  const signals=[];
  for(const batch of byConfirmation.values()){
    if(new Set(batch.map(event=>event.direction)).size>1){for(const event of batch){event.status='AMBIGUOUS';event.reasonCodes=['CONFLICTING_CONFIRMED_DIRECTIONS'];}continue;}
    // Several valid descriptions at the same close are one alert, not several
    // entries. Underlying setups remain available in the event ledger.
    const representative=batch[0];signals.push({...clone(representative),eventId:representative.instrument+':'+representative.timeframe+':'+representative.confirmationBarCloseTime+':'+representative.direction,setupEventIds:batch.map(event=>event.eventId),setupFormations:batch.map(event=>({eventId:event.eventId,formationStartTime:event.formationStartTime,signalStartIndex:event.signalStartIndex,signalIndex:event.signalIndex,detectedAt:event.detectedAt,confirmedAt:event.confirmedAt,confirmationBarCloseTime:event.confirmationBarCloseTime})),patternIds:[...new Set(batch.flatMap(event=>event.patternIds))].sort()});
  }
  const currentContext=analyzeMarketContext(bars,{...resolvedContextConfig,tickSize:metadata.tickSize,asOf});
  const lastIndex=bars.length-1,latestClosedBar=bars[lastIndex],latestPrior=bars.slice(0,lastIndex),latestFrozenContext=contextAt(lastIndex);
  const currentChecks={barIndex:lastIndex,barOpenTime:latestClosedBar.time,knownAt:latestClosedBar.knownAt,freezeTime:latestClosedBar.time,...(config.strategyPolicy===GUIDE_STRATEGY_POLICY?{diagnosticOnly:true,approvalPolicy:GUIDE_STRATEGY_POLICY}:{}),
    directions:Object.fromEntries(['LONG','SHORT'].map(direction=>[direction,contextFilters(latestPrior,[latestClosedBar],direction,latestFrozenContext,config,higherTimeframes,metadata,resolvedContextConfig,higherContexts)]))};
  return {...base,status:signals.length?'SIGNALS':events.some(e=>e.status==='ARMED')?'WAITING_CONFIRMATION':'NO_SIGNAL',reasonCodes:[],patterns:shapes,context:currentContext,events,signals,latest:signals.at(-1)??events.at(-1)??null,
    currentChecks,insideStudies,...(config.strategyPolicy===GUIDE_STRATEGY_POLICY?{strategyProfiles:describeGuideStrategyProfiles(),approvalPolicy:GUIDE_STRATEGY_POLICY}:{}),
    stats:{closedBars:bars.length,patterns:shapes.patterns?.length??0,setups:events.length,confirmed:signals.length,rejected:events.filter(e=>e.status==='REJECTED').length,expired:events.filter(e=>e.status==='EXPIRED').length},
    sourceCoverage:{rejectionLong:[...REJECTION_LONG],rejectionShort:[...REJECTION_SHORT]}};
}

// Reuse a completed causal decision when only the forming candle or wall clock
// changed. Validation still examines the entire incoming series on every call;
// malformed/future input can therefore never reuse an earlier successful read.
// Returned analyses are read-only observations; consumers must not mutate them.
export function createGuideAnalyzer(){
  const freshMemo=()=>({formationContexts:new Map(),higherContexts:new Map(),finalEvents:new Map()});
  let previousKey=null,previous=null,computations=0,hits=0,memo=freshMemo(),previousRows=[],previousConfigurationKey=null;
  const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  return {
    analyze(inputBars,options={}){
      const asOf=options.asOfTime??Date.now(),config=validateGuideSignalConfig(options.config);
      if(!finite(asOf))throw TypeError('INVALID_AS_OF_TIME');
      const quality=validateInput(inputBars,options.metadata??{},config,asOf);
      const semanticBars=quality.bars.map(bar=>({open:bar.open,high:bar.high,low:bar.low,close:bar.close,time:bar.time,closeTime:bar.closeTime,knownAt:bar.knownAt,closed:true,chartType:bar.chartType,providerBarIndex:bar.providerBarIndex,sessionFirst:bar.sessionFirst,sessionLast:bar.sessionLast}));
      // The receiver observation timestamp is evidence about this read, not a
      // change in the source, contract or live/replay gate. Keep every semantic
      // proof field in the key; refresh the complete proof in returned output.
      const semanticMetadata={...(options.metadata??{})};
      if(semanticMetadata.realtimeVerification&&typeof semanticMetadata.realtimeVerification==='object'&&!Array.isArray(semanticMetadata.realtimeVerification)){
        const {observedAtWall,...proof}=semanticMetadata.realtimeVerification;semanticMetadata.realtimeVerification=proof;
      }
      const configurationKey=stable({metadata:semanticMetadata,config,risk:options.risk??null,patternConfig:options.patternConfig??{},contextConfig:options.contextConfig??{},higherTimeframes:options.higherTimeframes??{}});
      const rows=semanticBars.map(bar=>JSON.stringify(bar)),key=quality.valid?configurationKey+'|'+(options.evaluationStartIndex??0)+'|'+rows.join('|'):null;
      if(key!==null&&key===previousKey&&previous){
        hits++;
        return {...previous,asOfTime:asOf,metadata:clone(options.metadata??{}),
          ...(previous.context?{context:{...previous.context,asOf,config:{...previous.context.config,asOf}}}:{}),
          ...(previous.patterns?{patterns:{...previous.patterns,config:{...previous.patterns.config,asOfTime:asOf}}}:{}),
          ...(previous.insideStudies?{insideStudies:Object.fromEntries(Object.entries(previous.insideStudies).map(([name,study])=>[name,{...study,config:{...study.config,asOf}}]))}:{}),
          parameterSnapshot:{...previous.parameterSnapshot,patternConfig:{...previous.parameterSnapshot.patternConfig,asOfTime:asOf},contextConfig:{...previous.parameterSnapshot.contextConfig,asOf}},
          cache:{hit:true,computations,hits,closedBars:quality.bars.length}};
      }
      const appendOnly=quality.valid&&previousConfigurationKey===configurationKey&&rows.length>=previousRows.length&&previousRows.every((row,index)=>row===rows[index]);
      if(!appendOnly)memo=freshMemo();
      if(Number.isSafeInteger(options.evaluationStartIndex)&&options.evaluationStartIndex>0){
        const keep=Math.max(0,options.evaluationStartIndex-config.insideExpiryBars-(options.contextConfig?.reclaimBars??3)-3),time=quality.bars[keep]?.time??0;
        for(const key of memo.formationContexts.keys())if(key<keep)memo.formationContexts.delete(key);
        for(const key of memo.higherContexts.keys())if(key<time)memo.higherContexts.delete(key);
        for(const [key,event]of memo.finalEvents)if(event.signalIndex<keep)memo.finalEvents.delete(key);
      }
      const reusedContexts=memo.formationContexts.size,reusedTerminalEvents=memo.finalEvents.size;
      const result=analyzeGuideSignals(inputBars,{...options,asOfTime:asOf,[INTERNAL_ANALYSIS_MEMO]:memo});computations++;
      previousKey=result.status==='BLOCKED'||!quality.bars.length?null:key;previous=previousKey===null?null:result;
      previousRows=previous?rows:[];previousConfigurationKey=previous?configurationKey:null;
      return {...result,cache:{hit:false,computations,hits,closedBars:quality.bars.length,appendOnly,reusedContexts,reusedTerminalEvents}};
    },
    clear(){previousKey=null;previous=null;computations=0;hits=0;memo=freshMemo();previousRows=[];previousConfigurationKey=null;},
    getStats(){return {computations,hits,cached:previous!==null};},
  };
}
