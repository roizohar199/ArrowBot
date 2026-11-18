import {analyzeCandlePatternTail,validatePatternConfig,PATTERN_DEFINITION_VERSION} from './candle-patterns.mjs';
import {analyzeMarketContext,validateContextConfig,projectGuideTrendline,prepareGuideReversalTrendline,evaluateGuideReversalTrendlineBreak} from './market-context.mjs';
import {validateGuideSignalConfig} from './guide-signal-engine.mjs';
import {planGuideRisk,roundGuidePriceToTick} from './guide-risk.mjs';

export const GUIDE_FORMING_PREVIEW_VERSION='guide-forming-preview-1';
const finite=Number.isFinite,copy=value=>structuredClone(value),unique=values=>[...new Set(values)];
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const rowKey=bar=>[bar.time,bar.closeTime,bar.knownAt??bar.closeTime,bar.open,bar.high,bar.low,bar.close].join(',');
const withoutClock=config=>Object.fromEntries(Object.entries(config??{}).filter(([key])=>!['asOf','asOfTime','mode'].includes(key)));
const intersects=(bar,zone)=>bar.low<=zone.upper&&bar.high>=zone.lower;
const aliases={HANGING_MAN_SHAPE:{state:'TREND_UP',family:'HANGING_MAN_REVERSAL'},INVERTED_HAMMER_SHAPE:{state:'TREND_DOWN',family:'INVERTED_HAMMER_REVERSAL'}};
const baseResult=(status,reasonCodes,extra={})=>({definitionVersion:GUIDE_FORMING_PREVIEW_VERSION,sourceKind:'original_research_definition',status,candidateOnly:true,final:false,orderEligible:false,execution:'OBSERVATION_ONLY',ordersCreated:false,fillInferred:false,signalApproved:false,
  reasonCodes:unique(['FORMING_BAR_PREVIEW_ONLY','LATER_CLOSED_CONFIRMATION_REQUIRED',...reasonCodes]),patterns:[],matchedPatternIds:[],patternChecks:{},directions:{},scenarios:[],...extra});

// Continue warmed indicators through at most the three formation candles.
// The long confirmed prefix is never recomputed for an intrabar EMA update.
function formingIndicators(context,prefix,formation,config){
  const original=context.indicators??{},emaTail=[],atrTail=[],trTail=[],emaPeriod=config.emaPeriod,atrPeriod=config.atrPeriod,n=prefix.length;
  let ema=original.ema?.at(-1)??null,atr=original.atr?.at(-1)??null,previousClose=prefix.at(-1)?.close;
  for(let offset=0;offset<formation.length;offset++){
    const bar=formation[offset],index=n+offset,tr=finite(previousClose)?Math.max(bar.high-bar.low,Math.abs(bar.high-previousClose),Math.abs(bar.low-previousClose)):bar.high-bar.low;trTail.push(tr);previousClose=bar.close;
    if(finite(ema))ema+=2/(emaPeriod+1)*(bar.close-ema);
    else if(index===emaPeriod-1)ema=(prefix.reduce((sum,bar)=>sum+bar.close,0)+formation.slice(0,offset+1).reduce((sum,bar)=>sum+bar.close,0))/emaPeriod;
    if(finite(atr))atr=(atr*(atrPeriod-1)+tr)/atrPeriod;
    else if(index===atrPeriod-1)atr=((original.trueRange??[]).reduce((sum,value)=>sum+value,0)+trTail.reduce((sum,value)=>sum+value,0))/atrPeriod;
    emaTail.push(ema);atrTail.push(atr);
  }
  const oldIndex=n+formation.length-1-config.emaSlopeBars,oldEma=oldIndex<0?null:oldIndex<n?original.ema?.[oldIndex]:emaTail[oldIndex-n];
  return {ema,oldEma,atr};
}

// Only the short pattern tail is reclassified on each update. Prior market
// contexts are immutable for a formation cutoff and known closed-price prefix.
// This module never invokes the complete signal/confirmation engine.
export function createGuideFormingPreview(){
  const contexts=new Map();let scopeKey=null,contextComputations=0,contextReuses=0,contextHits=0,patternComputations=0;
  function cachedContext(prefix,cutoff,contextConfig,reusable=[]){
    const key=cutoff+'|'+prefix.map(rowKey).join(';')+'|'+stable(withoutClock(contextConfig));
    if(contexts.has(key)){contextHits++;return contexts.get(key);}
    const suitable=reusable.find(context=>context?.valid===true&&context.barsUsed===prefix.length&&stable(withoutClock(context.config))===stable(withoutClock(contextConfig))&&(!prefix.length||prefix.every(bar=>(bar.knownAt??bar.closeTime)<=cutoff)));
    const value=suitable?{...copy(suitable),asOf:cutoff,config:{...copy(suitable.config),asOf:cutoff}}:analyzeMarketContext(prefix,{...contextConfig,asOf:cutoff});
    if(suitable)contextReuses++;else contextComputations++;
    contexts.set(key,value);if(contexts.size>16)contexts.delete(contexts.keys().next().value);return value;
  }
  const stats=()=>({contextComputations,contextReuses,contextHits,patternComputations,cachedContexts:contexts.size});
  const contextSummary=(context,cutoff,prefix)=>({definitionVersion:context.definitionVersion,state:context.state,valid:context.valid===true,asOf:cutoff,barsUsed:context.barsUsed??prefix.length,lastAvailableCloseTime:prefix.at(-1)?.closeTime??null,lastAvailableKnownAt:prefix.at(-1)?.knownAt??prefix.at(-1)?.closeTime??null,
    reasonCodes:[...(context.reasonCodes??[])],pivots:(context.pivots??[]).slice(-4).map(pivot=>({id:pivot.id,type:pivot.type,price:pivot.price,knownAt:pivot.knownAt})),zones:(context.zones??[]).filter(zone=>zone.active!==false&&zone.invalidatedAt==null).map(zone=>({id:zone.id,type:zone.type,lower:zone.lower,upper:zone.upper,knownAt:zone.knownAt,roleReversal:zone.roleReversal===true,sourceZoneId:zone.sourceZoneId??null})),indicators:copy(context.indicators?.latest??{})});
  function analyze(openBar,{closedBars=[],closedAnalysis,metadata={},risk=null,config={},patternConfig={},contextConfig={},higherTimeframes={},asOfTime=Date.now()}={}){
    const unavailable=(...reasons)=>baseResult('UNAVAILABLE',reasons,{openBarTime:openBar?.time??null,cache:stats()});
    if(!openBar||openBar.closed!==false||!['time','closeTime','open','high','low','close'].every(key=>finite(openBar[key]))||openBar.closeTime<=openBar.time||openBar.high<Math.max(openBar.open,openBar.close)||openBar.low>Math.min(openBar.open,openBar.close)||openBar.high<openBar.low||!finite(asOfTime)||asOfTime<openBar.time)return unavailable('VALID_FORMING_BAR_REQUIRED');
    if(!metadata||metadata.source!=='ohlc'||!['standard','candles'].includes(metadata.chartType)||!finite(metadata.tickSize)||metadata.tickSize<=0||!Number.isSafeInteger(metadata.timeframeMs)||metadata.timeframeMs<=0||openBar.closeTime-openBar.time!==metadata.timeframeMs)return unavailable('FORMING_OHLC_METADATA_REQUIRED');
    if(!contextConfig||typeof contextConfig!=='object'||Array.isArray(contextConfig)||!patternConfig||typeof patternConfig!=='object'||Array.isArray(patternConfig))return unavailable('INVALID_FORMING_PREVIEW_CONFIGURATION');
    let signalConfig,effectivePattern;try{signalConfig=validateGuideSignalConfig(config);effectivePattern=validatePatternConfig({...patternConfig,tickSize:metadata.tickSize,mode:'closed',unit:'price',chartType:'standard',requireTimestamps:true,asOfTime:null});}catch{return unavailable('INVALID_FORMING_PREVIEW_CONFIGURATION');}
    const validated=validateContextConfig({...contextConfig,tickSize:metadata.tickSize,sessionGaps:contextConfig.sessionGaps??metadata.sessionGaps??[],insideMinRangeTicks:contextConfig.insideMinRangeTicks??Math.max(effectivePattern.minRangeTicks,Math.ceil((effectivePattern.minRange??0)/metadata.tickSize)),supplyDemandEnabled:signalConfig.requireSupplyDemand||contextConfig.supplyDemandEnabled===true});
    if(!validated.valid)return unavailable(...validated.reasonCodes);
    const resolvedContext=validated.config,closedPatterns=closedAnalysis?.patterns;
    if(!closedAnalysis?.metadata||['instrument','timeframe','timeframeMs','tickSize','chartType','sourceId'].some(key=>metadata[key]!==undefined&&closedAnalysis.metadata[key]!==metadata[key]))return unavailable('CLOSED_ANALYSIS_IDENTITY_MISMATCH');
    if(closedPatterns?.definitionVersion!==PATTERN_DEFINITION_VERSION||closedPatterns.config?.tickSize!==metadata.tickSize||stable(withoutClock(closedPatterns.config))!==stable(withoutClock(effectivePattern)))return unavailable('MATCHING_CLOSED_PATTERN_CONFIGURATION_REQUIRED');
    if(!Array.isArray(closedBars)||closedBars.length>4096)return unavailable('INVALID_CLOSED_PREVIEW_PREFIX');
    const observed=[];
    for(const bar of closedBars){
      const knownAt=bar?.knownAt??bar?.closeTime;
      if(bar?.closed!==true||!finite(knownAt)||knownAt>asOfTime||!finite(bar?.closeTime)||bar.closeTime>openBar.time)continue;
      if(!['time','open','high','low','close'].every(key=>finite(bar[key]))||bar.closeTime<=bar.time||knownAt<bar.closeTime||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low||observed.length&&bar.time<observed.at(-1).closeTime)return unavailable('INVALID_CLOSED_PREVIEW_PREFIX');
      observed.push({...bar,knownAt});
    }
    if(closedPatterns.byBar?.length!==observed.length||observed.some((bar,index)=>{const cached=closedPatterns.byBar[index];return !cached||cached.time!==bar.time||cached.closeTime!==bar.closeTime||cached.knownAt!==bar.knownAt||['open','high','low','close'].some(key=>cached.ohlc?.[key]!==bar[key]);}))return unavailable('CLOSED_PATTERN_CACHE_MISMATCH');
    const contextIdentity=stable({instrument:metadata.instrument,timeframe:metadata.timeframe,timeframeMs:metadata.timeframeMs,tickSize:metadata.tickSize,sourceId:metadata.sourceId,contextConfig:withoutClock(resolvedContext)}),nextScope=openBar.time+'|'+contextIdentity;
    if(nextScope!==scopeKey){contexts.clear();scopeKey=nextScope;}
    const cacheBefore=stats(),tail=analyzeCandlePatternTail(openBar,{closedBars:observed,closedPatterns,asOfTime});patternComputations++;
    if(tail.status==='UNAVAILABLE'||['INVALID_INPUT','INVALID_CONFIG'].includes(tail.status))return unavailable(...(tail.reasonCodes??['FORMING_TAIL_UNAVAILABLE']));
    const formationCache=new Map(),reusable=[closedAnalysis.context,closedAnalysis.currentChecks?.directions?.LONG?.context].filter(Boolean);
    const atFormation=(index=observed.length)=>{
      if(formationCache.has(index))return formationCache.get(index);
      const cutoff=index<observed.length?observed[index].time:openBar.time,prefix=observed.slice(0,index).filter(bar=>bar.knownAt<=cutoff),context=cachedContext(prefix,cutoff,resolvedContext,reusable),higher=[];
      for(const [name,entry]of Object.entries(higherTimeframes??{})){
        const duration=entry?.timeframeMs??entry?.metadata?.timeframeMs,instrument=entry?.instrument??entry?.metadata?.instrument??metadata.instrument;
        if(!Number.isSafeInteger(duration)||duration<=metadata.timeframeMs||instrument!==metadata.instrument||!Array.isArray(entry?.bars)){higher.push({name,valid:false,reasonCodes:['HIGHER_TIMEFRAME_IDENTITY_OR_DURATION_MISMATCH']});continue;}
        const known=entry.bars.filter(bar=>bar?.closed===true&&finite(bar.knownAt??bar.closeTime)&&(bar.knownAt??bar.closeTime)<=cutoff&&bar.closeTime<=cutoff);
        const higherConfig={...resolvedContext,expectedIntervalMs:duration,sessionGaps:entry.sessionGaps??entry.metadata?.sessionGaps??[]},higherContext=cachedContext(known,cutoff,higherConfig);
        higher.push({name,duration,valid:higherContext.valid,context:higherContext,knownBars:known.length,lastKnownAt:known.at(-1)?.knownAt??known.at(-1)?.closeTime??null,reasonCodes:higherContext.reasonCodes??[]});
      }
      const value={context,prefix,cutoff,index,higher};formationCache.set(index,value);return value;
    };
    const checksFor=(direction,formation,patternBars=[openBar],family=null)=>{
      const {context,prefix,cutoff,higher}=formation,bar={low:Math.min(...patternBars.map(bar=>bar.low)),high:Math.max(...patternBars.map(bar=>bar.high)),close:openBar.close},type=direction==='LONG'?'SUPPORT':'RESISTANCE',supplyType=direction==='LONG'?'DEMAND':'SUPPLY',trend=direction==='LONG'?'TREND_UP':'TREND_DOWN',opposite=direction==='LONG'?'TREND_DOWN':'TREND_UP';
      const zones=(context.zones??[]).filter(zone=>zone.type===type&&zone.active!==false&&zone.invalidatedAt==null&&zone.knownAt<=cutoff&&intersects(bar,zone)),supply=(context.supplyDemand?.zones??[]).filter(zone=>zone.type===supplyType&&zone.active!==false&&zone.invalidatedAt==null&&zone.knownAt<=cutoff&&intersects(bar,zone)),range=context.range,width=range?range.upper-range.lower:NaN,position=finite(width)&&width>0?(bar.close-range.lower)/width:null;
      const rangeEdge=context.state==='RANGE'&&range.knownAt<=cutoff&&position!==null&&position>=0&&position<=1&&(direction==='LONG'?position<=resolvedContext.rangeEdgeFraction:position>=1-resolvedContext.rangeEdgeFraction),trendMatch=context.state===trend,reversal=context.state===opposite&&zones.length>0;
      const emaSeries=context.indicators?.ema??[],signalEma=resolvedContext.emaEvaluation==='signal_close',forming=signalEma?formingIndicators(context,prefix,patternBars,resolvedContext):null,ema=signalEma?forming.ema:emaSeries.at(-1),oldEma=signalEma?forming.oldEma:emaSeries.at(-1-resolvedContext.emaSlopeBars),emaDirection=finite(ema)&&finite(oldEma)&&(direction==='LONG'?bar.close>ema&&ema>oldEma:bar.close<ema&&ema<oldEma),distance=finite(ema)?resolvedContext.emaProximityReference==='close'?Math.abs(bar.close-ema):ema<openBar.low?openBar.low-ema:ema>openBar.high?ema-openBar.high:0:null;
      const oldAtr=context.indicators?.atr?.at(-1),emaAtr=signalEma?forming.atr:oldAtr,
        emaTolerance=resolvedContext.emaProximityMode==='ticks'?resolvedContext.emaProximityTicks*metadata.tickSize:resolvedContext.emaProximityMode==='atr'&&finite(emaAtr)?resolvedContext.emaProximityAtr*emaAtr:null,emaPass=emaDirection&&(resolvedContext.emaProximityMode==='disabled'||finite(distance)&&finite(emaTolerance)&&distance<=emaTolerance);
      const tolerance=resolvedContext.zoneToleranceTicks*metadata.tickSize,fib=context.fib,fibPass=fib?.knownAt<=cutoff&&fib.direction===(direction==='LONG'?'UP':'DOWN')&&fib.levels.some(level=>bar.low<=level.price+tolerance&&bar.high>=level.price-tolerance),lines=(context.trendlines??[]).filter(line=>line.active&&line.type===type&&line.knownAt<=cutoff&&line.touches>=resolvedContext.trendlineMinTouches&&(resolvedContext.trendlineMinTouches===2||line.thirdTouchKnownAt<=cutoff));
      const linePass=lines.some(line=>patternBars.some((candidate,offset)=>{const price=projectGuideTrendline(line,{index:formation.index+offset,time:candidate.time});return finite(price)&&(resolvedContext.trendlineTouchMode==='close_distance'?Math.abs(candidate.close-price)<=tolerance:resolvedContext.trendlineTouchMode==='extreme_distance'?Math.abs((direction==='LONG'?candidate.low:candidate.high)-price)<=tolerance:candidate.low<=price+tolerance&&candidate.high>=price-tolerance);}));
      const ordered=[...higher].sort((a,b)=>(b.duration??0)-(a.duration??0)),higherKnown=higher.length>0&&higher.every(entry=>entry.valid&&entry.context?.state!=='UNKNOWN'),higherLocation=ordered[1]?.context,
        higherAvailable=signalConfig.higherTimeframePolicy==='structure_and_location'?ordered.length>=2&&ordered[0].valid&&ordered[0].context?.state!=='UNKNOWN'&&ordered[1].valid:higherKnown,
        higherPass=signalConfig.higherTimeframePolicy==='structure_and_location'?higherAvailable&&ordered[0].context?.state===trend&&[...(higherLocation?.zones??[]),...(higherLocation?.supplyDemand?.zones??[])].some(zone=>(zone.type===type||zone.type===supplyType)&&zone.active!==false&&zone.invalidatedAt==null&&zone.knownAt<=cutoff&&intersects(bar,zone)):higherKnown&&higher.every(entry=>entry.context.state===trend);
      const definitions=[['STRUCTURE',trendMatch||reversal||rangeEdge,true,context.valid===true&&context.state!=='UNKNOWN',{state:context.state,trendMatch,reversal,rangeEdge}],['KNOWN_LOCATION',zones.length>0||supply.length>0||rangeEdge,signalConfig.requireLocation,context.valid===true&&prefix.length>=resolvedContext.pivotLeft+resolvedContext.pivotRight+1,{zoneIds:zones.map(zone=>zone.id),supplyZoneIds:supply.map(zone=>zone.id),rangePosition:position}],['EMA',emaPass,signalConfig.requireEma,finite(ema)&&finite(oldEma)&&(resolvedContext.emaProximityMode!=='atr'||finite(emaAtr)),{value:ema??null,previousValue:oldEma??null,distance,tolerance:emaTolerance,evaluation:resolvedContext.emaEvaluation,formingValue:signalEma}],['FIB',!!fibPass,signalConfig.requireFib,finite(fib?.knownAt)&&fib.knownAt<=cutoff,{anchorIds:fib?.anchorIds??[],direction:fib?.direction??null}],['TRENDLINE',linePass,signalConfig.requireTrendline,lines.length>0,{lineIds:lines.map(line=>line.id)}],['SUPPLY_DEMAND',supply.length>0,signalConfig.requireSupplyDemand,context.supplyDemand?.enabled===true&&finite(oldAtr),{zoneIds:supply.map(zone=>zone.id)}],['HIGHER_TIMEFRAME',higherPass,signalConfig.requireHigherTimeframe,higherAvailable,{policy:signalConfig.higherTimeframePolicy,series:higher.map(entry=>({name:entry.name,state:entry.context?.state??'UNKNOWN',knownBars:entry.knownBars??0,lastKnownAt:entry.lastKnownAt??null,reasonCodes:entry.reasonCodes}))}]];
      const checks=definitions.map(([id,passed,required,available,evidence])=>({id,passed:!!passed,required,available,provisional:true,state:id==='SUPPLY_DEMAND'&&!resolvedContext.supplyDemandEnabled?'DISABLED':!available?'UNAVAILABLE':passed?'PASS':'FAIL',evidence}));
      const reversalLineFamily=['HANGING_MAN_REVERSAL','INVERTED_HAMMER_REVERSAL'].includes(family)?family:!family&&reversal?'REVERSAL_AT_ZONE':null;
      if(signalConfig.requireTrendline&&reversalLineFamily){
        const gate=prepareGuideReversalTrendline(context,{family:reversalLineFamily,direction,freezeTime:cutoff,formationCloseTime:openBar.closeTime,minTouches:resolvedContext.trendlineMinTouches,tickSize:metadata.tickSize,breakBufferTicks:resolvedContext.breakBufferTicks}),check=checks.find(c=>c.id==='TRENDLINE');
        Object.assign(check,{passed:false,available:gate.available,state:gate.available?'PENDING':'UNAVAILABLE',pendingConfirmation:true,reasonCodes:['LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED'],evidence:{policy:gate.policy,lineIds:gate.lines.map(l=>l.id),gate,requiresLaterClosedBreak:true}});
      }
      const missing=checks.filter(check=>check.required&&!check.passed).flatMap(check=>check.pendingConfirmation?check.reasonCodes:['MISSING_'+check.id]),conditionsMet=checks.filter(check=>check.passed).length;
      if(conditionsMet<signalConfig.minConditions)missing.push('INSUFFICIENT_CONDITIONS');
      return {direction,freezeTime:cutoff,structureState:context.state,checks,conditionsMet,conditionsAreStatisticallyIndependent:false,reasonCodes:unique(missing),setupKind:rangeEdge?'RANGE_EDGE':trendMatch?'TREND_CONTINUATION':reversal?'REVERSAL_AT_ZONE':'UNDEFINED',candidateOnly:true,final:false,orderEligible:false,signalApproved:false};
    };
    const primary=atFormation(),directions=Object.fromEntries(['LONG','SHORT'].map(direction=>[direction,checksFor(direction,primary)])),scenarios=[];
    for(const pattern of tail.patterns??[]){
      const globalStart=(tail.globalIndexOffset??0)+pattern.startIndex,formation=atFormation(globalStart),shapeBars=[...observed.slice(globalStart),openBar],direction=pattern.direction;
      if(!['LONG','SHORT'].includes(direction)){scenarios.push({patternId:pattern.id,direction:'NEUTRAL',family:'UNDEFINED',state:'DIRECTION_NOT_DEFINED',contextApplicable:false,reasonCodes:['NEUTRAL_SHAPE_REQUIRES_DIRECTIONAL_SETUP'],candidateOnly:true,final:false,orderEligible:false,signalApproved:false});continue;}
      const alias=aliases[pattern.id],checks=checksFor(direction,formation,shapeBars,alias?.family),contextApplicable=!alias||formation.context.state===alias.state,reasonCodes=unique([...checks.reasonCodes,...(!contextApplicable?['REQUIRED_PRIOR_STATE_NOT_MET']:[])]);
      scenarios.push({patternId:pattern.id,direction,family:alias?.family??checks.setupKind,state:!contextApplicable?'CONTEXT_NOT_APPLICABLE':reasonCodes.length?'FORMING_CANDIDATE_MISSING_REQUIRED_CONTEXT':'FORMING_CANDIDATE',contextApplicable,requiredPriorState:alias?.state??null,observedPriorState:formation.context.state,freezeTime:formation.cutoff,reasonCodes,checks:checks.checks,candidateOnly:true,final:false,orderEligible:false,signalApproved:false});
    }
    for(const direction of ['LONG','SHORT']){
      const model={patternId:'ENGULFING_RANGE_RECLAIM',direction,family:'ENGULFING_RANGE_RECLAIM',candidateOnly:true,final:false,orderEligible:false,signalApproved:false},pattern=tail.patterns?.find(item=>item.id===(direction==='LONG'?'BULLISH_ENGULFING':'BEARISH_ENGULFING'));
      if(!pattern){scenarios.push({...model,state:'NOT_APPLICABLE',contextApplicable:false,reasonCodes:['FORMING_ENGULFING_SHAPE_REQUIRED']});continue;}
      const formation=atFormation((tail.globalIndexOffset??0)+pattern.startIndex),range=formation.context.range,knownRange=formation.context.state==='RANGE'&&finite(range?.knownAt)&&range.knownAt<=formation.cutoff&&range.upper>range.lower;
      if(!knownRange){scenarios.push({...model,state:'CONTEXT_NOT_APPLICABLE',contextApplicable:false,freezeTime:formation.cutoff,reasonCodes:['KNOWN_PRE_FORMATION_RANGE_REQUIRED']});continue;}
      const shapeBars=[...observed.slice(formation.index),openBar],buffer=resolvedContext.breakBufferTicks*metadata.tickSize,excursion=direction==='LONG'?Math.min(...shapeBars.map(bar=>bar.low))<range.lower-buffer:Math.max(...shapeBars.map(bar=>bar.high))>range.upper+buffer,reclaim=openBar.close>range.lower&&openBar.close<range.upper;
      if(!excursion||!reclaim){scenarios.push({...model,state:'WAITING_FOR_FORMING_RANGE_RECLAIM',contextApplicable:false,freezeTime:formation.cutoff,range:{lower:range.lower,upper:range.upper,knownAt:range.knownAt},reasonCodes:unique([...(!excursion?['RANGE_EXCURSION_NOT_OBSERVED']:[]),...(!reclaim?['FORMING_CLOSE_NOT_INSIDE_RANGE']:[])])});continue;}
      const current=checksFor(direction,formation,shapeBars,'ENGULFING_RANGE_RECLAIM'),checks=current.checks.map(check=>['STRUCTURE','KNOWN_LOCATION'].includes(check.id)?{...check,passed:true,available:true,state:'PASS',evidence:{...check.evidence,rangeReclaim:true}}:check),conditionsMet=checks.filter(check=>check.passed).length,missing=checks.filter(check=>check.required&&!check.passed).map(check=>'MISSING_'+check.id);if(conditionsMet<signalConfig.minConditions)missing.push('INSUFFICIENT_CONDITIONS');
      scenarios.push({...model,state:missing.length?'FORMING_CANDIDATE_MISSING_REQUIRED_CONTEXT':'FORMING_CANDIDATE',contextApplicable:true,patternIds:[pattern.id],freezeTime:formation.cutoff,range:{lower:range.lower,upper:range.upper,knownAt:range.knownAt},checks,conditionsMet,conditionsAreStatisticallyIndependent:false,reasonCodes:unique(missing)});
    }
    for(const direction of ['LONG','SHORT']){
      const model={patternId:'ROLE_REVERSAL_RETEST',direction,family:'ROLE_REVERSAL_RETEST',candidateOnly:true,final:false,orderEligible:false,signalApproved:false};
      if(!resolvedContext.roleReversalEnabled){scenarios.push({...model,state:'NOT_APPLICABLE',contextApplicable:false,reasonCodes:['OPTIONAL_ROLE_REVERSAL_RULE_DISABLED']});continue;}
      const eligible=[];
      for(const pattern of tail.patterns??[]){
        if(pattern.direction!==direction)continue;
        const formation=atFormation((tail.globalIndexOffset??0)+pattern.startIndex),alias=aliases[pattern.id];if(alias&&formation.context.state!==alias.state)continue;
        const shapeBars=[...observed.slice(formation.index),openBar],span={low:Math.min(...shapeBars.map(bar=>bar.low)),high:Math.max(...shapeBars.map(bar=>bar.high))},zones=(formation.context.zones??[]).filter(zone=>zone.roleReversal===true&&zone.type===(direction==='LONG'?'SUPPORT':'RESISTANCE')&&zone.active!==false&&zone.invalidatedAt==null&&zone.knownAt<=formation.cutoff&&intersects(span,zone));
        if(zones.length)eligible.push({patternId:pattern.id,formation,zones,checks:checksFor(direction,formation,shapeBars,'ROLE_REVERSAL_RETEST')});
      }
      if(!eligible.length){scenarios.push({...model,state:'WAITING_FOR_KNOWN_ROLE_REVERSAL_RETEST',contextApplicable:false,reasonCodes:['ROLE_REVERSAL_REQUIRES_KNOWN_ZONE_AND_APPLICABLE_SHAPE']});continue;}
      const first=eligible[0],checks=first.checks.checks.map(check=>check.id==='STRUCTURE'?{...check,passed:true,available:true,state:'PASS',evidence:{...check.evidence,roleReversal:true}}:check.id==='KNOWN_LOCATION'?{...check,passed:true,available:true,state:'PASS',evidence:{...check.evidence,roleZoneIds:first.zones.map(zone=>zone.id)}}:check),conditionsMet=checks.filter(check=>check.passed).length,missing=checks.filter(check=>check.required&&!check.passed).map(check=>'MISSING_'+check.id);if(conditionsMet<signalConfig.minConditions)missing.push('INSUFFICIENT_CONDITIONS');
      scenarios.push({...model,state:missing.length?'FORMING_CANDIDATE_MISSING_REQUIRED_CONTEXT':'FORMING_CANDIDATE',contextApplicable:true,patternIds:unique(eligible.map(item=>item.patternId)),matchingRoleZoneIds:unique(eligible.flatMap(item=>item.zones.map(zone=>zone.id))),freezeTime:first.formation.cutoff,checks,conditionsMet,conditionsAreStatisticallyIndependent:false,reasonCodes:unique(missing)});
    }
    for(const [kind,id]of [['breakout','INSIDE_BREAKOUT'],['false_break','INSIDE_FALSE_BREAK']]){
      const active=closedAnalysis.insideStudies?.[kind]?.active;
      if(!active||active.state!=='ARMED'||!finite(active.knownAt)||active.knownAt>openBar.time||observed.length>active.expiresIndex)continue;
      const index=kind==='breakout'&&resolvedContext.insideBreakoutReference==='inside'?(resolvedContext.insideReferenceAnchor==='first'?active.insideIndices[0]:active.insideIndices.at(-1)):resolvedContext.insideAnchorMode==='previous_bar'?observed.length-1:active.motherIndex,reference=observed[index];if(!reference)continue;
      if(reference.knownAt>openBar.time){for(const direction of ['LONG','SHORT'])scenarios.push({patternId:id,direction,family:id,formationStartIndex:active.motherIndex,state:'PRIOR_REFERENCE_NOT_YET_KNOWN',contextApplicable:false,sequenceId:active.id,reasonCodes:['INSIDE_REFERENCE_NOT_KNOWN_AT_FORMING_START'],candidateOnly:true,final:false,orderEligible:false,fillInferred:false,signalApproved:false});continue;}
      const high=reference.high,low=reference.low,buffer=resolvedContext.penetrationTicks*metadata.tickSize,touchResearch=kind==='breakout'&&resolvedContext.insideConfirmationMode==='touch_research',down=(touchResearch||openBar.low<low)&&openBar.low<=low-buffer,up=(touchResearch||openBar.high>high)&&openBar.high>=high+buffer,inside=resolvedContext.allowReclaimOnBoundary?openBar.close>=low&&openBar.close<=high:openBar.close>low&&openBar.close<high;
      for(const direction of ['LONG','SHORT']){const relevant=kind==='breakout'?(direction==='LONG'?touchResearch?openBar.high>=high+buffer:openBar.close>high+buffer:touchResearch?openBar.low<=low-buffer:openBar.close<low-buffer):resolvedContext.falseBreakMode==='wick_rejection'?inside&&(direction==='LONG'?down:up):inside&&active.excursion?.direction===direction&&active.excursion.knownAt<=openBar.time;
        scenarios.push({patternId:id,direction,family:id,formationStartIndex:active.motherIndex,state:down&&up?'AMBIGUOUS_FORMING_REACHABILITY':relevant?'FORMING_CANDIDATE':'WAITING_FOR_FORMING_PRICE_CONDITION',contextApplicable:true,sequenceId:active.id,reference:{mode:kind==='breakout'?resolvedContext.insideBreakoutReference:'mother',high,low,index},reasonCodes:down&&up?['BOTH_REFERENCE_EDGES_REACHED_ORDER_UNKNOWN']:['FORMING_BAR_CANNOT_CONFIRM_SEQUENCE'],candidateOnly:true,final:false,orderEligible:false,fillInferred:false,signalApproved:false});}
    }
    // These prices are tentative: the current close may change, and a later
    // provider-final close is still mandatory. No order/fill is inferred.
    const stopBufferTicks=risk?.stopBufferTicks??signalConfig.stopBufferTicks??signalConfig.confirmationBufferTicks;
    const levelsFor=(direction,shapeBars=[openBar],reference=null,patternIds=[])=>{
      const low=Math.min(...shapeBars.map(bar=>bar.low)),high=Math.max(...shapeBars.map(bar=>bar.high)),engulfing=patternIds.some(id=>['BULLISH_ENGULFING','BEARISH_ENGULFING'].includes(id)),stopBar=engulfing&&signalConfig.engulfingStopReference==='signal_bar'?openBar:null;
      if(!Number.isSafeInteger(stopBufferTicks)||stopBufferTicks<0)return null;
      try{return {entryReference:openBar.close,entryReferencePolicy:'OBSERVED_OPEN_BAR_PRICE_ONLY',confirmationTrigger:roundGuidePriceToTick(direction==='LONG'?(reference?.high??high)+signalConfig.confirmationBufferTicks*metadata.tickSize:(reference?.low??low)-signalConfig.confirmationBufferTicks*metadata.tickSize,metadata.tickSize,direction==='LONG'?'UP':'DOWN'),invalidation:roundGuidePriceToTick(direction==='LONG'?(stopBar?.low??low)-stopBufferTicks*metadata.tickSize:(stopBar?.high??high)+stopBufferTicks*metadata.tickSize,metadata.tickSize,direction==='LONG'?'DOWN':'UP'),formationLow:low,formationHigh:high,provisional:true};}catch{return null;}
    };
    const riskFor=(direction,levels,context,scenarioKind)=>{
      let plan=null,reasons=[];
      if(!levels)reasons=['PROVISIONAL_LEVELS_UNAVAILABLE'];
      else if(!risk||typeof risk!=='object')reasons=['RISK_PARAMETERS_REQUIRED'];
      else if(!context||!Array.isArray(context.zones))reasons=['PROVISIONAL_FROZEN_CONTEXT_REQUIRED'];
      else if(finite(metadata.pointValue)&&(!finite(risk.pointValue)||Math.abs(risk.pointValue-metadata.pointValue)>Math.max(1,Math.abs(metadata.pointValue))*Number.EPSILON*8))reasons=['INSTRUMENT_POINT_VALUE_MISMATCH'];
      else{
        const obstacle=(context?.zones??[]).filter(zone=>zone.active!==false&&zone.invalidatedAt==null&&(direction==='LONG'?zone.type==='RESISTANCE'&&zone.lower>openBar.close:zone.type==='SUPPORT'&&zone.upper<openBar.close)).map(zone=>direction==='LONG'?zone.lower:zone.upper).sort((a,b)=>direction==='LONG'?a-b:b-a)[0];
        const range=context?.range,opposite=(context?.zones??[]).find(zone=>zone.id===(direction==='LONG'?range?.resistanceId:range?.supportId)),rangeTarget=['RANGE_EDGE','ENGULFING_RANGE_RECLAIM'].includes(scenarioKind)&&range?signalConfig.rangeTargetPolicy==='range_midpoint'?(range.lower+range.upper)/2:signalConfig.rangeTargetPolicy==='opposite_boundary'?(direction==='LONG'?opposite?.lower??range.upper:opposite?.upper??range.lower):null:null;
        plan={...planGuideRisk({...risk,direction,entry:openBar.close,stop:levels.invalidation,stopBufferTicks:0,tickSize:metadata.tickSize,...(finite(obstacle)?{obstaclePrice:obstacle}:{}),...(finite(rangeTarget)?{target:rangeTarget}:{})}),provisional:true,entryReferencePolicy:'OBSERVED_OPEN_BAR_PRICE_ONLY'};reasons=plan.reasonCodes??[];
      }
      return {plan,check:{id:'RISK',required:signalConfig.requireRisk,passed:plan?.status==='PLANNED',available:!!plan,provisional:true,state:!signalConfig.requireRisk?'DISABLED':!plan?'UNAVAILABLE':plan.status==='PLANNED'?'PASS':'FAIL',reasonCodes:reasons,evidence:{entryReference:openBar.close,invalidation:levels?.invalidation??null,status:plan?.status??'UNAVAILABLE',quantity:plan?.quantity??0,totalPlannedRisk:plan?.totalPlannedRisk??null,perContractRisk:plan?.perContractRisk??null,budget:risk?.riskBudget??null,commission:plan?.commissionAllowance??risk?.commissionPerContract??null,slippageAllowance:plan?.slippageAllowance??null,entryReferencePolicy:'OBSERVED_OPEN_BAR_PRICE_ONLY'}}};
    };
    for(const direction of ['LONG','SHORT']){const entry=directions[direction],levels=levelsFor(direction),result=riskFor(direction,levels,primary.context,entry.setupKind);entry.levels=levels;entry.riskPreview=result.plan;entry.checks.push(result.check);}
    for(const scenario of scenarios){
      if(!['LONG','SHORT'].includes(scenario.direction))continue;
      const ids=scenario.patternIds??[scenario.patternId],patterns=(tail.patterns??[]).filter(pattern=>ids.includes(pattern.id)),startIndex=Number.isSafeInteger(scenario.formationStartIndex)?scenario.formationStartIndex:patterns.length?Math.min(...patterns.map(pattern=>(tail.globalIndexOffset??0)+pattern.startIndex)):observed.length,formation=atFormation(startIndex),shapeBars=[...observed.slice(startIndex),openBar],levels=levelsFor(scenario.direction,shapeBars,scenario.patternId==='INSIDE_BREAKOUT'?scenario.reference:null,ids),result=riskFor(scenario.direction,levels,formation.context,scenario.family);
      scenario.freezeTime??=formation.cutoff;scenario.levels=levels;scenario.riskPreview=result.plan;scenario.checks=[...(scenario.checks??checksFor(scenario.direction,formation,shapeBars).checks),result.check];
    }
    const pendingConfirmations=(closedAnalysis.events??[]).filter(event=>event.status==='ARMED'&&['LONG','SHORT'].includes(event.direction)&&finite(event.trigger)&&finite(event.invalidation)&&event.barCloseTime<=openBar.time&&observed.length-event.signalIndex<=event.expiresAfterBars).map(event=>{
      const levels={entryReference:openBar.close,entryReferencePolicy:'OBSERVED_OPEN_BAR_PRICE_ONLY',confirmationTrigger:event.trigger,invalidation:event.invalidation,provisional:true},result=riskFor(event.direction,levels,event.contextSnapshot?.context,event.setupId),priceMet=event.direction==='LONG'?openBar.close>event.trigger:openBar.close<event.trigger,invalidationMet=event.direction==='LONG'?openBar.close<event.invalidation:openBar.close>event.invalidation;
      const frozen=event.contextSnapshot,context=frozen?.context,buffer=(context?.config?.breakBufferTicks??1)*metadata.tickSize,range=context?.range,anchors=[...(frozen?.location?.zones??[]),...(frozen?.location?.supply??[])],broken=zone=>event.direction==='LONG'?openBar.close<zone.lower-buffer:openBar.close>zone.upper+buffer;
      const frozenChecks=copy(frozen?.checks??[]),lineObservation=frozen?.reversalTrendlineGate?evaluateGuideReversalTrendlineBreak(frozen.reversalTrendlineGate,openBar,{index:observed.length,provisional:true}):null;
      if(lineObservation){const check=frozenChecks.find(c=>c.id==='TRENDLINE');if(check)Object.assign(check,{provisional:true,passed:lineObservation.available&&lineObservation.observedBreak,state:!lineObservation.available?'UNAVAILABLE':lineObservation.observedBreak?'PASS':'PENDING',pendingConfirmation:true,evidence:{...check.evidence,provisionalBreak:lineObservation,requiresLaterClosedBreak:true}});}
      let guardReason=!context?'PROVISIONAL_FROZEN_CONTEXT_REQUIRED':null;
      if(!guardReason&&['RANGE_EDGE','ENGULFING_RANGE_RECLAIM'].includes(frozen.setupKind)&&(openBar.close<range.lower-buffer||openBar.close>range.upper+buffer))guardReason='FROZEN_RANGE_BROKEN';
      if(!guardReason&&frozen.setupKind==='TREND_CONTINUATION'){const pivot=context.pivots?.filter(pivot=>pivot.type===(event.direction==='LONG'?'LOW':'HIGH')).at(-1);if(pivot&&(event.direction==='LONG'?openBar.close<pivot.price-buffer:openBar.close>pivot.price+buffer))guardReason='FROZEN_STRUCTURE_BROKEN';}
      if(!guardReason&&frozen.setupKind==='ROLE_REVERSAL_RETEST'&&(frozen.location.zones??[]).filter(zone=>zone.roleReversal).every(broken))guardReason='FROZEN_ROLE_REVERSAL_BROKEN';
      if(!guardReason&&frozen.setupKind==='REVERSAL_AT_ZONE'&&(frozen.location.zones??[]).every(broken))guardReason='FROZEN_REVERSAL_ZONE_BROKEN';
      if(!guardReason&&signalConfig.requireLocation&&frozen.setupKind!=='RANGE_EDGE'&&anchors.length&&anchors.every(broken))guardReason='FROZEN_REQUIRED_LOCATION_BROKEN';
      return {eventId:event.eventId,family:event.setupId,patternIds:[...event.patternIds],direction:event.direction,state:invalidationMet?'FORMING_PRICE_BEYOND_INVALIDATION':guardReason?'FORMING_FROZEN_CONTEXT_BROKEN':priceMet&&lineObservation&&!lineObservation.observedBreak?'FORMING_PRIOR_LINE_BREAK_PENDING':priceMet?'FORMING_PRICE_BEYOND_TRIGGER':'WAITING_FOR_FORMING_PRICE_CONDITION',contextApplicable:true,freezeTime:event.contextSnapshot?.freezeTime??event.formationStartTime,levels,riskPreview:result.plan,checks:[...frozenChecks,result.check,{id:'FROZEN_CONTEXT',required:true,passed:!guardReason,available:!!context,provisional:true,state:!context?'UNAVAILABLE':guardReason?'FAIL':'PASS',reasonCodes:guardReason?[guardReason]:[],evidence:{}},{id:'CONFIRMATION_PRICE',required:true,passed:priceMet&&!invalidationMet,available:true,provisional:true,state:priceMet&&!invalidationMet?'PASS':'FAIL',evidence:{observedPrice:openBar.close,trigger:event.trigger,invalidation:event.invalidation}}],reasonCodes:['LATER_CLOSED_CONFIRMATION_REQUIRED',...(guardReason?[guardReason]:[]),...(lineObservation&&!lineObservation.observedBreak?['LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED']:[]),...(invalidationMet?['FORMING_PRICE_BEYOND_INVALIDATION']:[])],candidateOnly:true,final:false,signalApproved:false,orderEligible:false,ordersCreated:false,fillInferred:false};
    });
    return baseResult('PREVIEW',tail.reasonCodes??[],{openBarTime:openBar.time,openBarCloseTime:openBar.closeTime,observedAt:asOfTime,sourceIdentity:{instrument:metadata.instrument,timeframe:metadata.timeframe,sourceId:metadata.sourceId??null},contextFrozenAt:openBar.time,closedPrefixBars:observed.length,patterns:copy(tail.patterns??[]),matchedPatternIds:(tail.patterns??[]).map(pattern=>pattern.id),patternChecks:copy(tail.byBar?.at(-1)?.checks??{}),features:copy(tail.features?.at(-1)??null),barsEvaluated:tail.barsEvaluated,atrSeedPolicy:tail.atrSeedPolicy,frozenContext:contextSummary(primary.context,primary.cutoff,primary.prefix),contexts:[...formationCache.values()].map(formation=>contextSummary(formation.context,formation.cutoff,formation.prefix)),directions,scenarios,pendingConfirmations,
      cache:{...stats(),contextWorkThisUpdate:contextComputations+contextReuses-cacheBefore.contextComputations-cacheBefore.contextReuses},limits:{maxTailBars:3,maxCachedContexts:16,fullSignalEngineInvoked:false}});
  }
  return {analyze,clear(){contexts.clear();scopeKey=null;contextComputations=0;contextReuses=0;contextHits=0;patternComputations=0;},getStats:stats};
}
