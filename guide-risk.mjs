// Research arithmetic from the supplied guide. No order, fill, account rule,
// or instrument specification is inferred here.
export const GUIDE_RISK_DEFINITION_VERSION='guide-risk-1';
const finite=Number.isFinite;
const sideOf=value=>value==='LONG'||value==='UP'?'LONG':value==='SHORT'||value==='DOWN'?'SHORT':null;
const nonnegative=value=>finite(value)&&value>=0;
const positive=value=>finite(value)&&value>0;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function tickCoordinate(value,tickSize){
  const ticks=value/tickSize,nearest=Math.round(ticks),epsilon=Math.min(1e-7,Math.max(1,Math.abs(ticks))*Number.EPSILON*8);
  return Math.abs(ticks-nearest)<=epsilon?nearest:ticks;
}
export function roundGuidePriceToTick(value,tickSize,rounding){
  if(!finite(value)||!positive(tickSize)||!['UP','DOWN'].includes(rounding))throw TypeError('Finite price, positive tickSize and UP/DOWN rounding are required');
  const coordinate=tickCoordinate(value,tickSize),ticks=rounding==='UP'?Math.ceil(coordinate):Math.floor(coordinate);
  if(!Number.isSafeInteger(ticks))throw RangeError('Price exceeds safe tick coordinates');
  const price=ticks*tickSize;
  if(!finite(price))throw RangeError('Rounded price is not finite');
  const normalized=Number(price.toPrecision(15));
  // Tidy harmless binary noise only when doing so preserves the exact selected
  // tick coordinate; large quotes must not lose a protective/trigger tick.
  return tickCoordinate(normalized,tickSize)===ticks?normalized:price;
}

export function planGuideRisk(input={}){
  const {direction,entry,stop,actualEntry,target,tickSize,pointValue,riskBudget,commissionPerContract,slippageTicks,maxContracts,dailyRiskRemaining,
    consecutiveLosses,maxConsecutiveLosses,rewardRisk=2,minRewardRisk=1,obstaclePrice,stopBufferTicks=0,requireClearPathToTarget=true}=input??{};
  const side=sideOf(direction),reasonCodes=[];
  const base={kind:'RESEARCH_PLAN',definitionVersion:GUIDE_RISK_DEFINITION_VERSION,status:'BLOCKED',direction:side,quantity:0,reasonCodes,
    ordersCreated:false,fillInferred:false,targetPolicy:'FROZEN_AT_PLANNED_ENTRY',
    costModel:'commissionPerContract is the complete round-trip commission allowance; slippageTicks is a round-trip adverse-movement allowance charged once',
    parameterSnapshot:{tickSize,pointValue,riskBudget,commissionPerContract,slippageTicks,maxContracts,dailyRiskRemaining,consecutiveLosses,maxConsecutiveLosses,rewardRisk,minRewardRisk,stopBufferTicks,requireClearPathToTarget}};
  const reject=reason=>({...base,quantity:0,totalPlannedRisk:0,reasonCodes:[...reasonCodes,reason]});
  if(!side)return reject('INVALID_DIRECTION');
  if(!finite(entry)||!finite(stop)||actualEntry!==undefined&&!finite(actualEntry)||target!==undefined&&!finite(target)||obstaclePrice!==undefined&&!finite(obstaclePrice))return reject('INVALID_PRICE');
  if(!positive(tickSize)||!positive(pointValue)||!positive(tickSize*pointValue))return reject('INSTRUMENT_METADATA_REQUIRED');
  if(!nonnegative(riskBudget)||!nonnegative(commissionPerContract)||!nonnegative(slippageTicks)||!Number.isSafeInteger(maxContracts)||maxContracts<1)return reject('EXPLICIT_RISK_CONFIGURATION_REQUIRED');
  if(!positive(rewardRisk)||!positive(minRewardRisk)||!integer(stopBufferTicks)||typeof requireClearPathToTarget!=='boolean')return reject('INVALID_RISK_CONFIGURATION');
  if(dailyRiskRemaining!==undefined&&!nonnegative(dailyRiskRemaining))return reject('INVALID_DAILY_RISK_REMAINING');
  if(consecutiveLosses!==undefined||maxConsecutiveLosses!==undefined){
    if(!integer(consecutiveLosses)||!Number.isSafeInteger(maxConsecutiveLosses)||maxConsecutiveLosses<1)return reject('INVALID_CONSECUTIVE_LOSS_CONFIGURATION');
    if(consecutiveLosses>=maxConsecutiveLosses)return reject('CONSECUTIVE_LOSS_LIMIT');
  }
  const effectiveBudget=Math.min(riskBudget,dailyRiskRemaining??riskBudget);
  Object.assign(base,{effectiveBudget,tickValue:tickSize*pointValue});
  if(effectiveBudget===0)return reject(dailyRiskRemaining===0?'DAILY_RISK_EXHAUSTED':'NO_RISK_BUDGET');
  let plannedEntry,initialStop,plannedTarget;
  try{
    plannedEntry=roundGuidePriceToTick(entry,tickSize,side==='LONG'?'UP':'DOWN');
    initialStop=roundGuidePriceToTick(stop,tickSize,side==='LONG'?'DOWN':'UP');
    initialStop=roundGuidePriceToTick(initialStop+(side==='LONG'?-1:1)*stopBufferTicks*tickSize,tickSize,side==='LONG'?'DOWN':'UP');
    const plannedRisk=side==='LONG'?plannedEntry-initialStop:initialStop-plannedEntry;
    if(!(plannedRisk>0))return reject('STOP_NOT_ON_PROTECTIVE_SIDE');
    // Explicit structural targets round toward entry, so reward is not inflated.
    // Generated R targets round away from entry. A later gap never moves them.
    plannedTarget=target===undefined
      ?roundGuidePriceToTick(plannedEntry+(side==='LONG'?1:-1)*plannedRisk*rewardRisk,tickSize,side==='LONG'?'UP':'DOWN')
      :roundGuidePriceToTick(target,tickSize,side==='LONG'?'DOWN':'UP');
  }catch{return reject('UNSAFE_TICK_COORDINATES');}
  const effectiveEntry=actualEntry??plannedEntry;
  Object.assign(base,{plannedEntry,actualEntry:actualEntry??null,effectiveEntry,initialStop,target:plannedTarget});
  if(actualEntry!==undefined){
    const coordinate=tickCoordinate(actualEntry,tickSize);
    if(!Number.isSafeInteger(coordinate))return reject('ACTUAL_ENTRY_OFF_TICK');
    if(actualEntry!==plannedEntry)reasonCodes.push('ENTRY_REPRICED');
  }
  const riskPoints=side==='LONG'?effectiveEntry-initialStop:initialStop-effectiveEntry;
  if(!(riskPoints>0))return reject('STOP_NOT_ON_PROTECTIVE_SIDE');
  const rewardPoints=side==='LONG'?plannedTarget-effectiveEntry:effectiveEntry-plannedTarget;
  const slippageAllowance=slippageTicks*tickSize*pointValue,perContractRisk=riskPoints*pointValue+commissionPerContract+slippageAllowance;
  if(!positive(perContractRisk)||!finite(rewardPoints))return reject('NONFINITE_RISK');
  const affordableQuantity=Math.floor(effectiveBudget/perContractRisk),quantity=Math.min(maxContracts,affordableQuantity);
  const effectiveRewardRisk=rewardPoints/riskPoints;
  Object.assign(base,{riskPoints,riskTicks:riskPoints/tickSize,rewardPoints,rewardRisk:effectiveRewardRisk,perContractRisk,
    commissionAllowance:commissionPerContract,slippageAllowance,affordableQuantity,totalPlannedRisk:quantity*perContractRisk,
    riskAfterProvidedEntry:actualEntry!==undefined});
  if(!(rewardPoints>0))return reject('TARGET_NOT_ON_PROFIT_SIDE');
  if(effectiveRewardRisk+1e-12<minRewardRisk)return reject('INSUFFICIENT_REWARD_RISK');
  if(obstaclePrice!==undefined){
    const room=side==='LONG'?obstaclePrice-effectiveEntry:effectiveEntry-obstaclePrice;
    const availableRewardRisk=room/riskPoints;
    Object.assign(base,{obstaclePrice,availableRewardRisk});
    if(!(room>0)||availableRewardRisk+1e-12<minRewardRisk)return reject('STRUCTURAL_ROOM_INSUFFICIENT');
    if(requireClearPathToTarget&&room+tickSize*1e-8<rewardPoints)return reject('OBSTACLE_BEFORE_TARGET');
  }
  if(quantity<1)return reject('RISK_BUDGET_BELOW_ONE_CONTRACT');
  return {...base,status:'PLANNED',quantity,reasonCodes:[...reasonCodes]};
}

function readBar(value){
  const bar={open:value?.open??value?.O,high:value?.high??value?.H,low:value?.low??value?.L,close:value?.close??value?.C,
    openTime:value?.openTime,closeTime:value?.closeTime,availableAt:value?.availableAt??value?.knownAt??value?.closeTime,closed:value?.closed};
  if(!['open','high','low','close','openTime','closeTime','availableAt'].every(k=>finite(bar[k]))||bar.closeTime<=bar.openTime||bar.availableAt<bar.closeTime||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.high<bar.low||typeof bar.closed!=='boolean')return null;
  return bar;
}

export function evaluateSignalExcursions(bars,event,options={}){
  const {horizonBars,reference='event',referencePrice,asOf,allowSessionGaps=false}=options??{},direction=sideOf(event?.direction),confirmedAt=event?.confirmedAt;
  const base={kind:'SIGNAL_EXCURSIONS',definitionVersion:GUIDE_RISK_DEFINITION_VERSION,status:'BLOCKED',direction,horizonBars,
    mfe:null,mae:null,realizedPnl:null,intrabarOrderKnown:false,reasonCodes:[],
    scope:'Nonnegative price excursions after confirmation; these are not realized trading profit or stop/target order of arrival'};
  const blocked=reason=>({...base,reasonCodes:[reason]});
  if(!direction||!finite(confirmedAt))return blocked('INVALID_EVENT');
  if(!Number.isSafeInteger(horizonBars)||horizonBars<1||horizonBars>10000||typeof allowSessionGaps!=='boolean'||!['event','next_open','confirmation_close'].includes(reference)||asOf!==undefined&&!finite(asOf))return blocked('INVALID_MEASUREMENT_CONFIGURATION');
  if(!Array.isArray(bars)||bars.length>100000)return blocked('INVALID_BARS');
  const normalized=bars.map(readBar);
  if(normalized.some(bar=>!bar)||normalized.some((bar,i)=>i&&(bar.openTime<=normalized[i-1].openTime||bar.openTime<normalized[i-1].closeTime)))return blocked('INVALID_OR_UNORDERED_BARS');
  if(normalized.some(bar=>bar.openTime<confirmedAt&&bar.closeTime>confirmedAt))return blocked('BAR_STRADDLES_CONFIRMATION');
  const future=normalized.filter(bar=>bar.openTime>=confirmedAt).slice(0,horizonBars),observedBars=future.length;
  const pending=reason=>({...base,status:'PENDING',observedBars,reasonCodes:[reason]});
  if(future.length<horizonBars)return pending('FULL_HORIZON_NOT_AVAILABLE');
  const knownNow=asOf??Math.max(confirmedAt,...normalized.filter(bar=>bar.closed).map(bar=>bar.availableAt));
  if(future.some(bar=>!bar.closed||bar.availableAt>knownNow))return pending('FUTURE_BARS_NOT_CLOSED_OR_AVAILABLE');
  if(!allowSessionGaps&&(future[0].openTime!==confirmedAt||future.some((bar,i)=>i&&bar.openTime!==future[i-1].closeTime)))return blocked('UNACKNOWLEDGED_DATA_GAP');
  let price=referencePrice??event?.referencePrice;
  if(reference==='next_open')price=future[0].open;
  else if(reference==='confirmation_close'){
    const bar=normalized.find(bar=>bar.closeTime===confirmedAt&&bar.closed&&bar.availableAt<=knownNow);
    price=bar?.close;
  }
  if(!finite(price))return blocked('REFERENCE_PRICE_REQUIRED');
  let mfe=0,mae=0;
  for(const bar of future){
    mfe=Math.max(mfe,direction==='LONG'?bar.high-price:price-bar.low);
    mae=Math.max(mae,direction==='LONG'?price-bar.low:bar.high-price);
  }
  return {...base,status:'AVAILABLE',observedBars,reference,referencePrice:price,confirmedAt,measurementStartsAt:future[0].openTime,
    measurementEndsAt:future.at(-1).closeTime,availableAt:Math.max(...future.map(bar=>bar.availableAt)),mfe,mae,reasonCodes:['NOT_REALIZED_PNL','INTRABAR_ORDER_UNKNOWN']};
}

export function evaluateBarExitAmbiguity(bar,{direction,stop,target}={}){
  const side=sideOf(direction),high=bar?.high??bar?.H,low=bar?.low??bar?.L;
  const base={kind:'BAR_EXIT_REACHABILITY',direction:side,fillInferred:false,intrabarOrderKnown:false};
  if(!side||!finite(high)||!finite(low)||high<low||!finite(stop)||!finite(target)||(side==='LONG'?target<=stop:target>=stop))return {...base,status:'BLOCKED',reasonCodes:['INVALID_EXIT_LEVELS']};
  const stopReached=side==='LONG'?low<=stop:high>=stop,targetReached=side==='LONG'?high>=target:low<=target;
  return {...base,status:stopReached&&targetReached?'AMBIGUOUS':stopReached?'STOP_REACHED':targetReached?'TARGET_REACHED':'NEITHER_REACHED',stopReached,targetReached,
    reasonCodes:stopReached&&targetReached?['BOTH_REACHED_ORDER_UNKNOWN']:['REACHABILITY_IS_NOT_A_FILL']};
}
