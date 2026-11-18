// Causal, deterministic research definitions from Candlestick_Codex_Guide_HE.txt.
// These describe historical prices; no probability or order-flow claim is made.
import {declaredSessionGapMatches} from './session-gap-proof.mjs';
export const CONTEXT_DEFINITION_VERSION='guide-context-2.0.0';
export const CONTEXT_SOURCE_KIND='original_research_definition';
const finite=Number.isFinite;
const DEFAULTS={tickSize:null,pivotLeft:2,pivotRight:2,equalToleranceTicks:1,zoneToleranceTicks:2,minTouchSeparationBars:3,minZoneTouches:2,zoneExpiryBars:100,minRangeWidthTicks:8,rangeEdgeFraction:.2,breakBufferTicks:1,atrPeriod:14,smaPeriod:20,emaPeriod:20,emaSlopeBars:5,fibRatios:[.382,.5,.618],supplyDemandEnabled:false,baseMaxBars:3,baseRangeAtr:.5,displacementAtr:1,displacementBars:3,insideMinRangeTicks:4,insideAllowEqualEdges:false,insideAnchorMode:'original_mother',insideExpiryBars:5,insideSetup:'false_break',falseBreakMode:'wick_rejection',penetrationTicks:1,reclaimBars:3,allowReclaimOnBoundary:false,expectedIntervalMs:null,allowSessionGaps:false,asOf:null};
Object.assign(DEFAULTS,{sessionGaps:[],roleReversalEnabled:false,emaEvaluation:'before_pattern',emaProximityMode:'disabled',emaProximityTicks:2,emaProximityAtr:.25,emaProximityReference:'range',trendlineScale:'linear',trendlineTimeBasis:'bar_index',trendlineMinTouches:3,trendlineTouchMode:'range_intersection',insideBreakoutReference:'mother',insideReferenceAnchor:'latest',insideConfirmationMode:'close',insideMinMotherRangeAtr:0,insideMaxMotherRangeAtr:null});
export const DEFAULT_CONTEXT_CONFIG=Object.freeze({...DEFAULTS,fibRatios:Object.freeze([...DEFAULTS.fibRatios]),sessionGaps:Object.freeze([])});

export function validateContextConfig(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULTS,k))||input.fibRatios!==undefined&&!Array.isArray(input.fibRatios)||input.sessionGaps!==undefined&&!Array.isArray(input.sessionGaps))return {valid:false,reasonCodes:['INVALID_CONTEXT_CONFIG'],config:null};
 const c={...DEFAULTS,...input,fibRatios:[...(input.fibRatios??DEFAULTS.fibRatios)],sessionGaps:structuredClone(input.sessionGaps??DEFAULTS.sessionGaps)};
 if(!finite(c.tickSize)||c.tickSize<=0)return {valid:false,reasonCodes:['MISSING_TICK_SIZE'],config:c};
 const integers={pivotLeft:[1,20],pivotRight:[1,20],minTouchSeparationBars:[1,100],minZoneTouches:[2,20],zoneExpiryBars:[2,4096],atrPeriod:[1,250],smaPeriod:[1,250],emaPeriod:[1,250],emaSlopeBars:[1,100],baseMaxBars:[1,3],displacementBars:[1,20],insideMinRangeTicks:[0,Number.MAX_SAFE_INTEGER],insideExpiryBars:[1,100],reclaimBars:[1,100]};
 if(Object.entries(integers).some(([key,[lo,hi]])=>!Number.isSafeInteger(c[key])||c[key]<lo||c[key]>hi)||['equalToleranceTicks','zoneToleranceTicks','minRangeWidthTicks','breakBufferTicks','penetrationTicks'].some(k=>!finite(c[k])||c[k]<0)||!finite(c.rangeEdgeFraction)||c.rangeEdgeFraction<=0||c.rangeEdgeFraction>=.5||!finite(c.baseRangeAtr)||c.baseRangeAtr<=0||!finite(c.displacementAtr)||c.displacementAtr<=0||!c.fibRatios.length||c.fibRatios.length>20||c.fibRatios.some(v=>!finite(v)||v<0||v>1)||!['original_mother','previous_bar'].includes(c.insideAnchorMode)||!['breakout','false_break'].includes(c.insideSetup)||!['wick_rejection','close_then_reclaim'].includes(c.falseBreakMode)||['supplyDemandEnabled','insideAllowEqualEdges','allowReclaimOnBoundary','allowSessionGaps'].some(k=>typeof c[k]!=='boolean')||c.asOf!==null&&!finite(c.asOf)||c.expectedIntervalMs!==null&&(!finite(c.expectedIntervalMs)||c.expectedIntervalMs<=0))return {valid:false,reasonCodes:['INVALID_CONTEXT_CONFIG'],config:c};
 if(typeof c.roleReversalEnabled!=='boolean'||!['before_pattern','signal_close'].includes(c.emaEvaluation)||!['disabled','ticks','atr'].includes(c.emaProximityMode)||!['range','close'].includes(c.emaProximityReference)||!['linear','logarithmic'].includes(c.trendlineScale)||!['bar_index','time'].includes(c.trendlineTimeBasis)||![2,3].includes(c.trendlineMinTouches)||!['range_intersection','close_distance','extreme_distance'].includes(c.trendlineTouchMode)||!['mother','inside'].includes(c.insideBreakoutReference)||!['first','latest'].includes(c.insideReferenceAnchor)||!['close','touch_research'].includes(c.insideConfirmationMode)||['emaProximityTicks','emaProximityAtr','insideMinMotherRangeAtr'].some(key=>!finite(c[key])||c[key]<0)||c.insideMaxMotherRangeAtr!==null&&(!finite(c.insideMaxMotherRangeAtr)||c.insideMaxMotherRangeAtr<c.insideMinMotherRangeAtr)||c.sessionGaps.length>4096||c.sessionGaps.some(gap=>!gap||!finite(gap.from)||!finite(gap.to)||gap.to<=gap.from||gap.kind!=='market_closed'))return {valid:false,reasonCodes:['INVALID_CONTEXT_CONFIG'],config:c};
 c.sessionGaps=c.sessionGaps.filter(gap=>c.asOf===null||gap.to<=c.asOf);
 return {valid:true,reasonCodes:[],config:c};
}

export function normalizeContextBars(input,{asOf=null,expectedIntervalMs=null,allowSessionGaps=false,sessionGaps=[]}={}){
 const fail=reason=>({valid:false,bars:[],reasonCodes:[reason],excludedFutureBars:0});
 if(!Array.isArray(input)||input.length>4096)return fail('INVALID_BAR_SERIES');
 if(asOf!==null&&!finite(asOf))return fail('INVALID_DECISION_TIME');
 const bars=[];let previous=null,excludedFutureBars=0,unavailable=false;
 for(let i=0;i<input.length;i++){
  const r=input[i];
  if(!r||!['open','high','low','close'].every(k=>finite(r[k]))||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.high<r.low)return fail('INVALID_OHLC');
  if(r.chartType!==undefined&&!['standard','candles'].includes(r.chartType))return fail('NONSTANDARD_CHART');
  const time=r.time??r.openTime,closeTime=r.closeTime,knownAt=r.knownAt??closeTime;
  if(!finite(time)||!finite(closeTime)||!finite(knownAt)||closeTime<=time||knownAt<closeTime)return fail('INVALID_BAR_TIMING');
  if(previous&&(time<=previous.time||closeTime<=previous.closeTime))return fail('INVALID_TIME_ORDER');
  if(asOf!==null&&(closeTime>asOf||knownAt>asOf)){excludedFutureBars++;unavailable=true;previous={time,closeTime};continue;}
  if(unavailable)return fail('UNAVAILABLE_INTERIOR_BAR');
  if(r.closed!==true)return fail('OPEN_BAR');
  if(previous&&time<previous.closeTime)return fail('OVERLAPPING_BAR_TIMES');
  if(previous&&time>previous.closeTime){
   const declared=sessionGaps.some(gap=>gap.from===previous.closeTime&&gap.to===time&&gap.kind==='market_closed'&&(gap.basis===undefined||declaredSessionGapMatches(gap,input[i-1],r)));
   const legacySession=allowSessionGaps&&r.session!=null&&input[i-1].session!=null&&r.session!==input[i-1].session;
   if(!declared&&!legacySession)return fail('DATA_GAP');
  }
  bars.push({...r,time,closeTime,knownAt,index:i,closed:true,chartType:r.chartType??'standard'});previous={time,closeTime};
 }
 return {valid:true,bars,reasonCodes:[],excludedFutureBars};
}

// Wilder ATR starts with the mean of the first full period of true ranges;
// the first true range is high-low. SMA/EMA likewise require full warm-up.
export function calculateIndicators(bars,{atrPeriod=14,smaPeriod=20,emaPeriod=20}={}){
 for(const n of [atrPeriod,smaPeriod,emaPeriod])if(!Number.isSafeInteger(n)||n<1||n>250)throw TypeError('Invalid indicator period');
 const atr=[],sma=[],ema=[],trueRange=[];let trSum=0,smaSum=0,emaSum=0,previousAtr=null,previousEma=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(!b||!['open','high','low','close'].every(k=>finite(b[k]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low)throw TypeError('Invalid OHLC');
  const tr=i?Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)):b.high-b.low;trueRange.push(tr);
  if(i<atrPeriod)trSum+=tr;
  if(i===atrPeriod-1)previousAtr=trSum/atrPeriod;else if(i>=atrPeriod)previousAtr=(previousAtr*(atrPeriod-1)+tr)/atrPeriod;
  atr.push(previousAtr);
  smaSum+=b.close;if(i>=smaPeriod)smaSum-=bars[i-smaPeriod].close;sma.push(i>=smaPeriod-1?smaSum/smaPeriod:null);
  if(i<emaPeriod)emaSum+=b.close;
  if(i===emaPeriod-1)previousEma=emaSum/emaPeriod;else if(i>=emaPeriod)previousEma+=2/(emaPeriod+1)*(b.close-previousEma);
  ema.push(previousEma);
 }
 return {trueRange,atr,sma,ema};
}

export function confirmedPivots(bars,{pivotLeft=2,pivotRight=2,equalToleranceTicks=1,tickSize}={}){
 if(!finite(tickSize)||tickSize<=0||!Number.isSafeInteger(pivotLeft)||pivotLeft<1||!Number.isSafeInteger(pivotRight)||pivotRight<1)throw TypeError('Invalid pivot definition');
 const tolerance=equalToleranceTicks*tickSize,pivots=[];
 for(let i=pivotLeft;i+ pivotRight<bars.length;i++){
  const bar=bars[i];let high=true,low=true;
  for(let j=i-pivotLeft;j<=i+pivotRight;j++)if(j!==i){if(bar.high-bars[j].high<=tolerance)high=false;if(bars[j].low-bar.low<=tolerance)low=false;}
  const confirmed=bars[i+pivotRight];
  for(const type of high?low?['HIGH','LOW']:['HIGH']:low?['LOW']:[]){const price=type==='HIGH'?bar.high:bar.low;pivots.push({id:`pivot:${type}:${bar.time}`,type,price,index:bar.index??i,localIndex:i,time:bar.time,knownAt:confirmed.knownAt??confirmed.closeTime,confirmedAtIndex:confirmed.index??i+pivotRight});}
 }
 return pivots.sort((a,b)=>a.confirmedAtIndex-b.confirmedAtIndex||a.index-b.index||a.type.localeCompare(b.type));
}

const distance=(price,zone)=>price<zone.lower?zone.lower-price:price>zone.upper?price-zone.upper:0;
const intersects=(bar,zone)=>bar.high>=zone.lower&&bar.low<=zone.upper;
function buildZones(bars,pivots,c){
 const zones=[],tolerance=c.zoneToleranceTicks*c.tickSize,pad=tolerance/2,latest=bars.at(-1),buffer=c.breakBufferTicks*c.tickSize;
 function invalidate(z,throughIndex){
  if(z.establishedAt===null||z.invalidatedAt!==null)return;
  // Normalization assigns contiguous local indices. Scan only the previously
  // unchecked interval; rescanning the full prefix for every confirmed pivot
  // made formation-context rebuilding needlessly quadratic inside this loop.
  for(let index=z.lastCheckedIndex+1;index<bars.length&&index<=throughIndex;index++){
   const b=bars[index];if(z.type==='SUPPORT'?b.close<z.lower-buffer:b.close>z.upper+buffer){z.invalidatedAt=b.knownAt;break;}
  }
  z.lastCheckedIndex=throughIndex;
 }
 for(const pivot of pivots){
  for(const z of zones)invalidate(z,pivot.confirmedAtIndex);
  const type=pivot.type==='LOW'?'SUPPORT':'RESISTANCE';
  let z=zones.find(z=>z.type===type&&z.invalidatedAt===null&&pivot.confirmedAtIndex-z.lastKnownIndex<=c.zoneExpiryBars&&Math.abs(pivot.price-z.anchorPrice)<=tolerance);
  if(!z){z={id:`zone:${type}:${pivot.id}`,type,anchorPrice:pivot.price,center:pivot.price,lower:pivot.price-pad,upper:pivot.price+pad,createdAt:pivot.knownAt,knownAt:pivot.knownAt,establishedAt:null,invalidatedAt:null,touches:0,version:0,pivotIds:[],lastTouchIndex:-Infinity,lastKnownIndex:pivot.confirmedAtIndex,lastCheckedIndex:pivot.confirmedAtIndex,prices:[]};zones.push(z);}
  if(pivot.index-z.lastTouchIndex<c.minTouchSeparationBars)continue;
  z.prices.push(pivot.price);z.pivotIds.push(pivot.id);z.touches++;z.version++;z.lastTouchIndex=pivot.index;z.lastKnownIndex=pivot.confirmedAtIndex;z.knownAt=pivot.knownAt;
  z.center=z.prices.reduce((a,b)=>a+b,0)/z.prices.length;z.lower=Math.min(...z.prices)-pad;z.upper=Math.max(...z.prices)+pad;
  if(z.touches>=c.minZoneTouches&&z.establishedAt===null){z.establishedAt=pivot.knownAt;z.lastCheckedIndex=pivot.confirmedAtIndex;}
 }
 return zones.filter(z=>z.establishedAt!==null).map(z=>{
  invalidate(z,latest.index);
  const expired=latest.index-z.lastKnownIndex>c.zoneExpiryBars;
  const {prices,lastTouchIndex,lastKnownIndex,lastCheckedIndex,anchorPrice,...publicZone}=z;
  return {...publicZone,active:z.invalidatedAt===null&&!expired,expired};
 });
}

// Optional, explicitly original research choice for3.4: a formerly established
// zone changes role only after its closing break. Later closes can invalidate
// the new role permanently. No future retest is used to create it earlier.
function roleReversalZones(bars,zones,c){
 if(!c.roleReversalEnabled)return [];
 const buffer=c.breakBufferTicks*c.tickSize,output=[];
 for(const original of zones){
  if(!finite(original.invalidatedAt))continue;
  const type=original.type==='SUPPORT'?'RESISTANCE':'SUPPORT',breakIndex=bars.findIndex(bar=>bar.knownAt===original.invalidatedAt),later=bars.filter(bar=>bar.knownAt>original.invalidatedAt),zone={id:`role:${original.id}:${original.invalidatedAt}`,sourceZoneId:original.id,type,originalType:original.type,lower:original.lower,upper:original.upper,center:original.center,createdAt:original.invalidatedAt,knownAt:original.invalidatedAt,establishedAt:original.invalidatedAt,roleReversal:true,sourceKind:'original_research_definition',rule:'ONE_CLOSED_BREAK_THEN_RETEST_OF_PRIOR_ESTABLISHED_ZONE',expiryBars:c.zoneExpiryBars,originalTouches:original.touches,touches:0,retestCount:0,invalidatedAt:null,expired:false,active:true};
  let lastTouch=-Infinity;
  for(const bar of later){if(bar.index-breakIndex>c.zoneExpiryBars){zone.expired=true;zone.expiredAt=bar.knownAt;zone.active=false;break;}if(type==='SUPPORT'?bar.close<zone.lower-buffer:bar.close>zone.upper+buffer){zone.invalidatedAt=bar.knownAt;zone.active=false;break;}if(intersects(bar,zone)&&bar.index-lastTouch>=c.minTouchSeparationBars){zone.retestCount++;zone.touches++;lastTouch=bar.index;}}
  output.push(zone);
 }
 return output;
}

export function projectGuideTrendline(line,{index,time}={}){
 const coordinate=line?.timeBasis==='time'?time:index;
 if(!finite(coordinate)||!finite(line?.originCoordinate)||!finite(line?.originValue)||!finite(line?.slope)||!['linear','logarithmic'].includes(line.scale))return null;
 const value=line.originValue+line.slope*(coordinate-line.originCoordinate),price=line.scale==='logarithmic'?Math.exp(value):value;
 return finite(price)?price:null;
}
function trendline(bars,pivots,type,c){
 const values=pivots.filter(p=>p.type===type),anchors=values.length>=3?values.slice(-3,-1):values.slice(-2);
 if(anchors.length<2)return null;
 const [a,b]=anchors,coordinate=p=>c.trendlineTimeBasis==='time'?p.time:p.index;
 if(c.trendlineScale==='logarithmic'&&(a.price<=0||b.price<=0))return null;
 const originValue=c.trendlineScale==='logarithmic'?Math.log(a.price):a.price,lastValue=c.trendlineScale==='logarithmic'?Math.log(b.price):b.price,slope=(lastValue-originValue)/(coordinate(b)-coordinate(a)),up=type==='LOW';
 if(up?slope<=0:slope>=0)return null;
 const model={scale:c.trendlineScale,timeBasis:c.trendlineTimeBasis,originCoordinate:coordinate(a),originValue,slope},lineAt=point=>projectGuideTrendline(model,{index:point.index,time:point.time}),tolerance=c.zoneToleranceTicks*c.tickSize,buffer=c.breakBufferTicks*c.tickSize;
 const third=values.find(p=>p.index>b.index&&p.index-b.index>=c.minTouchSeparationBars&&Math.abs(p.price-lineAt(p))<=tolerance);
 const broken=bars.find(bar=>bar.knownAt>b.knownAt&&(up?bar.close<lineAt(bar)-buffer:bar.close>lineAt(bar)+buffer));
 return {id:`line:${c.trendlineScale}:${c.trendlineTimeBasis}:${a.id}:${b.id}`,type:up?'SUPPORT':'RESISTANCE',...model,anchorIds:[a.id,b.id],knownAt:b.knownAt,referenceIndex:bars.at(-1).index,referenceTime:bars.at(-1).time,price:lineAt(bars.at(-1)),touches:third?3:2,thirdTouchId:third?.id??null,thirdTouchKnownAt:third?.knownAt??null,invalidatedAt:broken?.knownAt??null,active:!broken};
}

// Reversal research policy combining guide2.8/2.9,3.5 and5.1: retain the PRIOR
// trend's confirmed line, then demand a later closed break. This operational
// definition is explicit; the guide does not prescribe a universal line gate.
// An already opposite-sloping three-touch line contradicts the prior trend.
export function prepareGuideReversalTrendline(context,{family,direction,freezeTime,formationCloseTime,minTouches=3,tickSize,breakBufferTicks=1}={}){
 const model=family==='HANGING_MAN_REVERSAL'||family==='REVERSAL_AT_ZONE'&&direction==='SHORT'?{direction:'SHORT',state:'TREND_UP',type:'SUPPORT'}:family==='INVERTED_HAMMER_REVERSAL'||family==='REVERSAL_AT_ZONE'&&direction==='LONG'?{direction:'LONG',state:'TREND_DOWN',type:'RESISTANCE'}:null;
 const base={policy:'FROZEN_PRIOR_TRENDLINE_LATER_CLOSE_BREAK',family,direction,freezeTime,formationCloseTime,minTouches,bufferPrice:breakBufferTicks*tickSize,available:false,lines:[],reasonCodes:[]};
 if(!model||direction!==model.direction||context?.valid!==true||context.state!==model.state||!finite(freezeTime)||!finite(formationCloseTime)||formationCloseTime<=freezeTime||![2,3].includes(minTouches)||!finite(tickSize)||tickSize<=0||!finite(breakBufferTicks)||breakBufferTicks<0)return {...base,reasonCodes:['REVERSAL_PRIOR_TRENDLINE_CONTEXT_REQUIRED']};
 const pivots=new Map((context.pivots??[]).map(p=>[p.id,p]));
 const lines=(context.trendlines??[]).filter(line=>{
  if(line.type!==model.type||line.active!==true||line.invalidatedAt!=null||!finite(line.knownAt)||line.knownAt>freezeTime||line.touches<minTouches||!Array.isArray(line.anchorIds)||line.anchorIds.length!==2)return false;
  const anchors=line.anchorIds.map(id=>pivots.get(id));
  if(anchors.some(p=>!p||!finite(p.knownAt)||p.knownAt>freezeTime)||anchors[0].index>=anchors[1].index||line.type==='SUPPORT'&&!(line.slope>0)||line.type==='RESISTANCE'&&!(line.slope<0))return false;
  if(minTouches===3){const third=pivots.get(line.thirdTouchId);if(!third||!finite(line.thirdTouchKnownAt)||line.thirdTouchKnownAt>freezeTime||third.knownAt!==line.thirdTouchKnownAt||third.index<=anchors[1].index)return false;}
  return finite(projectGuideTrendline(line,{index:line.referenceIndex,time:line.referenceTime}));
 });
 return {...base,available:lines.length>0,lines:structuredClone(lines),priorState:model.state,lineType:model.type,reasonCodes:lines.length?[]:['KNOWN_THREE_TOUCH_PRIOR_TRENDLINE_REQUIRED']};
}
export function evaluateGuideReversalTrendlineBreak(gate,bar,{index,provisional=false}={}){
 const base={policy:gate?.policy??'FROZEN_PRIOR_TRENDLINE_LATER_CLOSE_BREAK',available:false,passed:false,observedBreak:false,provisional,confirmedAt:null,projections:[],reasonCodes:[]};
 const valid=gate?.available===true&&Array.isArray(gate.lines)&&['LONG','SHORT'].includes(gate.direction)&&finite(index)&&finite(bar?.time)&&finite(bar.close)&&bar.time>=gate.formationCloseTime&&finite(gate.bufferPrice)&&gate.bufferPrice>=0;
 if(!valid||(provisional?bar.closed!==false:bar.closed!==true||!finite(bar.knownAt??bar.closeTime)||(bar.knownAt??bar.closeTime)<=gate.formationCloseTime))return {...base,reasonCodes:['LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED']};
 const projections=gate.lines.map(line=>{const price=projectGuideTrendline(line,{index,time:bar.time}),threshold=price+(gate.direction==='LONG'?1:-1)*gate.bufferPrice;return {lineId:line.id,price,threshold,crossed:finite(price)&&(gate.direction==='LONG'?bar.close>threshold:bar.close<threshold)};});
 const matched=projections.find(p=>p.crossed),available=projections.some(p=>finite(p.price));
 return {...base,available,observedBreak:!!matched,passed:!provisional&&!!matched,confirmedAt:!provisional&&matched?(bar.knownAt??bar.closeTime):null,matchedLineId:matched?.lineId??null,observedClose:bar.close,observedTime:bar.time,projections,reasonCodes:matched?[]:['LATER_CLOSED_PRIOR_TRENDLINE_BREAK_REQUIRED']};
}

function fibonacci(bars,pivots,c){
 const ordered=[...pivots].sort((a,b)=>a.index-b.index),b=ordered.at(-1);if(!b)return null;
 const a=ordered.filter(p=>p.index<b.index&&p.type!==b.type).at(-1);if(!a)return null;
 const up=b.type==='HIGH',span=up?b.price-a.price:a.price-b.price;if(span<=0)return null;
 const latest=bars.at(-1),tolerance=c.zoneToleranceTicks*c.tickSize;
 return {id:`fib:${a.id}:${b.id}`,anchorMode:'latest_confirmed_swing',direction:up?'UP':'DOWN',anchorIds:[a.id,b.id],knownAt:Math.max(a.knownAt,b.knownAt),start:a.price,end:b.price,levels:c.fibRatios.map(r=>{const price=up?b.price-r*span:b.price+r*span;return {ratio:r,price,distance:Math.abs(latest.close-price),near:latest.low<=price+tolerance&&latest.high>=price-tolerance};})};
}

function supplyDemandZones(bars,atr,c){
 if(!c.supplyDemandEnabled)return {enabled:false,reasonCodes:['SUPPLY_DEMAND_REQUIRES_EXPLICIT_RESEARCH_RULE'],zones:[]};
 const zones=[],buffer=c.breakBufferTicks*c.tickSize;
 for(let end=0;end<bars.length-1;end++){
  let start=null,previousAtr=null;
  for(let length=c.baseMaxBars;length>=1;length--){const candidate=end-length+1,a=atr[candidate-1];if(candidate>=0&&finite(a)&&a>0&&bars.slice(candidate,end+1).every((b,index)=>b.high-b.low<=a*c.baseRangeAtr&&(index===0||b.time===bars[candidate+index-1].closeTime))){start=candidate;previousAtr=a;break;}}
  if(start===null)continue;
  const base=bars.slice(start,end+1),lower=Math.min(...base.map(b=>b.low)),upper=Math.max(...base.map(b=>b.high));
  let confirmed=null,type=null;
  for(let j=end+1;j<bars.length&&j<=end+c.displacementBars;j++){
   if(bars[j].time!==bars[j-1].closeTime)break;
   if(bars[j].close>=upper+previousAtr*c.displacementAtr){confirmed=j;type='DEMAND';break;}
   if(bars[j].close<=lower-previousAtr*c.displacementAtr){confirmed=j;type='SUPPLY';break;}
  }
  if(confirmed===null||zones.some(z=>z.type===type&&z.baseStart===bars[start].time&&Math.abs(z.lower-lower)<=c.tickSize&&Math.abs(z.upper-upper)<=c.tickSize))continue;
  const z={id:`base-zone:${type}:${bars[start].time}:${bars[end].time}`,type,lower,upper,createdAt:bars[end].knownAt,knownAt:bars[confirmed].knownAt,confirmedAt:bars[confirmed].knownAt,baseStart:bars[start].time,baseEnd:bars[end].time,retestCount:0,touches:0,invalidatedAt:null,active:true,sourceKind:CONTEXT_SOURCE_KIND};
  let previousTouch=-Infinity;
  for(let j=confirmed+1;j<bars.length;j++){
   const bar=bars[j];if(type==='DEMAND'?bar.close<lower-buffer:bar.close>upper+buffer){z.invalidatedAt=bar.knownAt;z.active=false;break;}
   if(intersects(bar,z)&&j-previousTouch>=c.minTouchSeparationBars){z.retestCount++;z.touches++;previousTouch=j;}
  }
  z.fresh=z.retestCount===0;zones.push(z);
 }
 return {enabled:true,rule:{maxBaseBars:c.baseMaxBars,maxBaseRangePriorAtr:c.baseRangeAtr,minDisplacementPriorAtr:c.displacementAtr,maxConfirmationBars:c.displacementBars},zones};
}

export function analyzeMarketContext(input,options={}){
 const parsed=validateContextConfig(options),base={definitionVersion:CONTEXT_DEFINITION_VERSION,sourceKind:CONTEXT_SOURCE_KIND,state:'UNKNOWN',pivots:[],zones:[],nearestSupport:null,nearestResistance:null,range:null,location:null,indicators:{atr:[],sma:[],ema:[]},fib:null,trendlines:[],supplyDemand:{enabled:false,zones:[]},config:parsed.config};
 if(!parsed.valid)return {...base,valid:false,reasonCodes:parsed.reasonCodes};
 const c=parsed.config,normalized=normalizeContextBars(input,c);
 if(!normalized.valid)return {...base,valid:false,reasonCodes:normalized.reasonCodes};
 const bars=normalized.bars;if(!bars.length)return {...base,valid:true,reasonCodes:['NOT_ENOUGH_CONTEXT'],asOf:c.asOf,barsUsed:0,excludedFutureBars:normalized.excludedFutureBars};
 const latest=bars.at(-1),indicators=calculateIndicators(bars,c),pivots=confirmedPivots(bars,c),highs=pivots.filter(p=>p.type==='HIGH').slice(-2),lows=pivots.filter(p=>p.type==='LOW').slice(-2),tolerance=c.equalToleranceTicks*c.tickSize;
 let state='UNKNOWN';const reasonCodes=[];
 if(highs.length===2&&lows.length===2){
  const hh=highs[1].price-highs[0].price,ll=lows[1].price-lows[0].price;
  if(hh>tolerance&&ll>tolerance)state='TREND_UP';else if(hh< -tolerance&&ll< -tolerance)state='TREND_DOWN';else {state='TRANSITION';reasonCodes.push('MIXED_OR_EQUAL_PIVOTS');}
 }else reasonCodes.push('NOT_ENOUGH_CONTEXT');
 if(state==='TREND_UP'&&latest.close<lows.at(-1).price-tolerance){state='TRANSITION';reasonCodes.push('STRUCTURE_BREAK_DOWN');}
 if(state==='TREND_DOWN'&&latest.close>highs.at(-1).price+tolerance){state='TRANSITION';reasonCodes.push('STRUCTURE_BREAK_UP');}
 const primaryZones=buildZones(bars,pivots,c),zones=[...primaryZones,...roleReversalZones(bars,primaryZones,c)],active=zones.filter(z=>z.active),supports=active.filter(z=>z.type==='SUPPORT').sort((a,b)=>distance(latest.close,a)-distance(latest.close,b)),resistances=active.filter(z=>z.type==='RESISTANCE').sort((a,b)=>distance(latest.close,a)-distance(latest.close,b)),nearestSupport=supports[0]??null,nearestResistance=resistances[0]??null;
 let range=null;
 const rangeSupport=supports.find(zone=>!zone.roleReversal),rangeResistance=resistances.find(zone=>!zone.roleReversal);
 if(rangeSupport&&rangeResistance){const lower=rangeSupport.center,upper=rangeResistance.center,width=upper-lower,buffer=c.breakBufferTicks*c.tickSize;if(width>=c.minRangeWidthTicks*c.tickSize&&latest.close>=rangeSupport.lower-buffer&&latest.close<=rangeResistance.upper+buffer){range={lower,upper,width,knownAt:Math.max(rangeSupport.knownAt,rangeResistance.knownAt),supportId:rangeSupport.id,resistanceId:rangeResistance.id,position:(latest.close-lower)/width};if(!['TREND_UP','TREND_DOWN'].includes(state)){state='RANGE';reasonCodes.push('REPEATED_CONFIRMED_BOUNDARIES');}}}
 const location={atSupport:!!nearestSupport&&intersects(latest,nearestSupport),atResistance:!!nearestResistance&&intersects(latest,nearestResistance),supportDistance:nearestSupport?distance(latest.close,nearestSupport):null,resistanceDistance:nearestResistance?distance(latest.close,nearestResistance):null,rangeEdge:range?range.position<=c.rangeEdgeFraction?'LOWER':range.position>=1-c.rangeEdgeFraction?'UPPER':'CENTER':null};
 const lastEma=indicators.ema.at(-1),priorEma=indicators.ema.at(-1-c.emaSlopeBars),emaSlope=finite(lastEma)&&finite(priorEma)?lastEma-priorEma:null;
 return {...base,valid:true,state,reasonCodes,asOf:c.asOf??latest.knownAt,barsUsed:bars.length,excludedFutureBars:normalized.excludedFutureBars,pivots,zones,nearestSupport,nearestResistance,range,location,indicators:{...indicators,latest:{atr:indicators.atr.at(-1),sma:indicators.sma.at(-1),ema:lastEma,emaSlope}},fib:fibonacci(bars,pivots,c),trendlines:['LOW','HIGH'].map(t=>trendline(bars,pivots,t,c)).filter(Boolean),supplyDemand:supplyDemandZones(bars,indicators.atr,c)};
}

export function analyzeMultiTimeframe(series,options={}){
 const asOf=options.asOf;
 if(!finite(asOf)||!series||typeof series!=='object'||Array.isArray(series))return {valid:false,reasonCodes:['MISSING_DECISION_TIME_OR_TIMEFRAMES'],states:{},alignment:'UNKNOWN',asOf};
 const states={},reasonCodes=[];
 for(const [name,entry] of Object.entries(series)){
  const input=Array.isArray(entry)?entry:entry?.bars;
  if(!Array.isArray(input)){reasonCodes.push(`INVALID_TIMEFRAME:${name}`);continue;}
  // An open/future higher bar is not a completed observation. Availability
  // filtering happens before calculating structure, never by copying finals.
  states[name]=analyzeMarketContext(input,{...options,sessionGaps:entry?.sessionGaps??entry?.metadata?.sessionGaps??options.sessionGaps??[],asOf});
  if(!states[name].valid)reasonCodes.push(...states[name].reasonCodes.map(code=>`${name}:${code}`));
 }
 const values=Object.values(states),directions=values.map(v=>v.state);
 const alignment=values.length&&values.every(v=>v.valid)&&directions.every(v=>v==='TREND_UP')?'ALIGNED_UP':values.length&&values.every(v=>v.valid)&&directions.every(v=>v==='TREND_DOWN')?'ALIGNED_DOWN':directions.includes('TREND_UP')&&directions.includes('TREND_DOWN')?'CONFLICT':'UNKNOWN';
 return {valid:reasonCodes.length===0&&values.length>0,reasonCodes,states,alignment,asOf};
}

export function analyzeInsideSequence(input,options={}){
 const parsed=validateContextConfig(options),base={definitionVersion:CONTEXT_DEFINITION_VERSION,sourceKind:CONTEXT_SOURCE_KIND,events:[],sequences:[],active:null,config:parsed.config};
 if(!parsed.valid)return {...base,valid:false,reasonCodes:parsed.reasonCodes};
 const c=parsed.config,normalized=normalizeContextBars(input,c);if(!normalized.valid)return {...base,valid:false,reasonCodes:normalized.reasonCodes};
 const bars=normalized.bars,events=[],sequences=[],penetration=c.penetrationTicks*c.tickSize,minimumRange=c.insideMinRangeTicks*c.tickSize,atr=calculateIndicators(bars,c).atr;let active=null;
 // Match the pattern library's inclusive tick threshold without rejecting an
 // exact decimal boundary solely because of floating-point subtraction.
 const eligible=b=>{const range=b.high-b.low,epsilon=Math.max(1,Math.abs(range),Math.abs(minimumRange))*Number.EPSILON*32;return range>0&&range>=minimumRange-epsilon;};
 const inside=(b,m)=>eligible(b)&&eligible(m)&&(c.insideAllowEqualEdges?b.high<=m.high&&b.low>=m.low:b.high<m.high&&b.low>m.low);
 const reclaimed=(b,m)=>c.allowReclaimOnBoundary?b.close>=m.low&&b.close<=m.high:b.close>m.low&&b.close<m.high;
 const reference=seq=>{const index=c.insideBreakoutReference==='inside'?(c.insideReferenceAnchor==='first'?seq.insideIndices[0]:seq.insideIndices.at(-1)):seq.motherIndex;return {index,high:bars[index].high,low:bars[index].low};};
 const motherQuality=index=>{const mother=bars[index],priorAtr=atr[index-1],range=mother.high-mother.low,atrRequired=c.insideMinMotherRangeAtr>0||c.insideMaxMotherRangeAtr!==null,knownBefore=index>0&&bars.slice(0,index).every(bar=>bar.knownAt<=mother.time),available=finite(priorAtr)&&priorAtr>0&&knownBefore;return {passed:!atrRequired||available&&range>=priorAtr*c.insideMinMotherRangeAtr&&(c.insideMaxMotherRangeAtr===null||range<=priorAtr*c.insideMaxMotherRangeAtr),range,priorAtr:available?priorAtr:null,minimumPriorAtr:c.insideMinMotherRangeAtr,maximumPriorAtr:c.insideMaxMotherRangeAtr,knownBeforeMother:knownBefore};};
 function trigger(seq,b,index,direction,type,ref={index:seq.motherIndex,high:seq.high,low:seq.low}){const researchOnly=type==='INSIDE_BREAKOUT'&&c.insideConfirmationMode==='touch_research';seq.state='TRIGGERED';seq.phase=researchOnly?'TOUCH_RESEARCH':'CONFIRMED';seq.confirmedAt=researchOnly?null:b.knownAt;seq.observedAt=b.knownAt;events.push({id:`${seq.id}:${type}:${b.time}`,type,direction,motherIndex:seq.motherIndex,originalMotherIndex:seq.originalMotherIndex,insideIndices:[...seq.insideIndices],barIndex:index,knownAt:b.knownAt,signalHigh:b.high,signalLow:b.low,motherHigh:seq.high,motherLow:seq.low,breakoutReference:c.insideBreakoutReference,referenceIndex:ref.index,referenceHigh:ref.high,referenceLow:ref.low,confirmationMode:c.insideConfirmationMode,researchOnly,eligibleForConfirmation:!researchOnly,ordersCreated:false,fillInferred:false,motherQuality:seq.motherQuality,definitionVersion:CONTEXT_DEFINITION_VERSION});active=null;}
 for(let i=1;i<bars.length;i++){
  const bar=bars[i];
  if(bar.time!==bars[i-1].closeTime){if(active){active.state='INVALIDATED';active.phase='SESSION_BOUNDARY';active.reason='INSIDE_SEQUENCE_SESSION_BOUNDARY';active.endedAt=bar.knownAt;active=null;}continue;}
  if(active){
   if(i>active.expiresIndex||active.excursion&&i>active.excursion.index+c.reclaimBars){active.state='EXPIRED';active.phase='EXPIRED';active.endedAt=bar.knownAt;active=null;continue;}
   if(c.insideAnchorMode==='previous_bar'){
    if(!eligible(bars[i-1])){active.state='INVALIDATED';active.phase='INELIGIBLE_MOTHER';active.reason='BELOW_MIN_INSIDE_RANGE';active.endedAt=bar.knownAt;active=null;continue;}
    active.motherIndex=i-1;active.high=bars[i-1].high;active.low=bars[i-1].low;
   }
   const ref=c.insideSetup==='breakout'?reference(active):{index:active.motherIndex,high:active.high,low:active.low},touchResearch=c.insideSetup==='breakout'&&c.insideConfirmationMode==='touch_research',down=(touchResearch||bar.low<ref.low)&&bar.low<=ref.low-penetration,up=(touchResearch||bar.high>ref.high)&&bar.high>=ref.high+penetration;
   if(down&&up){active.state='INVALIDATED';active.phase='AMBIGUOUS';active.reason='BOTH_MOTHER_EDGES_CROSSED';active.endedAt=bar.knownAt;active=null;continue;}
   if(c.insideSetup==='breakout'){
    if(c.insideConfirmationMode==='touch_research'?bar.high>=ref.high+penetration:bar.close>ref.high+penetration){trigger(active,bar,i,'LONG','INSIDE_BREAKOUT',ref);continue;}
    if(c.insideConfirmationMode==='touch_research'?bar.low<=ref.low-penetration:bar.close<ref.low-penetration){trigger(active,bar,i,'SHORT','INSIDE_BREAKOUT',ref);continue;}
   }else if(c.falseBreakMode==='wick_rejection'){
    if(reclaimed(bar,active)&&(down||up)){trigger(active,bar,i,down?'LONG':'SHORT','INSIDE_FALSE_BREAK');continue;}
    if(bar.close<active.low-penetration||bar.close>active.high+penetration){active.state='INVALIDATED';active.phase='CLOSED_OUTSIDE';active.endedAt=bar.knownAt;active=null;continue;}
   }else{
    if(active.excursion){
     if(active.excursion.direction==='LONG'?bar.close>active.high+penetration:bar.close<active.low-penetration){active.state='INVALIDATED';active.phase='OPPOSITE_BREAK';active.endedAt=bar.knownAt;active=null;continue;}
     if(reclaimed(bar,active)){trigger(active,bar,i,active.excursion.direction,'INSIDE_FALSE_BREAK');continue;}
    }
    else if(bar.close<active.low-penetration||bar.close>active.high+penetration){active.excursion={index:i,knownAt:bar.knownAt,direction:bar.close<active.low?'LONG':'SHORT'};active.phase='EXCURSION';}
   }
   if(active&&inside(bar,active))active.insideIndices.push(i);
   continue;
  }
  if(inside(bar,bars[i-1])){
   const mother=bars[i-1],quality=motherQuality(i-1);active={id:`inside:${c.insideAnchorMode}:${c.insideSetup}:${c.insideBreakoutReference}:${c.insideReferenceAnchor}:${c.insideConfirmationMode}:${mother.time}:${bar.time}`,motherIndex:i-1,originalMotherIndex:i-1,high:mother.high,low:mother.low,insideIndices:[i],createdAt:bar.knownAt,knownAt:bar.knownAt,expiresIndex:i+c.insideExpiryBars,state:quality.passed?'ARMED':'INVALIDATED',phase:quality.passed?'INSIDE':'MOTHER_RANGE_FILTER',reason:quality.passed?null:'MOTHER_RANGE_PRIOR_ATR_REJECTED',motherQuality:quality,excursion:null};sequences.push(active);if(!quality.passed)active=null;
  }
 }
 return {...base,valid:true,reasonCodes:[],events,sequences:sequences.map(s=>({...s,insideIndices:[...s.insideIndices],excursion:s.excursion?{...s.excursion}:null})),active:active?{...active,insideIndices:[...active.insideIndices],excursion:active.excursion?{...active.excursion}:null}:null};
}
