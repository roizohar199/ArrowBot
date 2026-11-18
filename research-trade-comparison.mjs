// Observational exit plans only. This module never approves or dispatches an order.
import {normalizeContextBars,confirmedPivots} from './market-context.mjs';
import {roundGuidePriceToTick} from './guide-risk.mjs';
export const RESEARCH_EXIT_VERSION='structural-shadow-exits-1';
const finite=Number.isFinite,clone=value=>structuredClone(value);
const number=value=>typeof value==='number'?value:typeof value==='string'&&/^[-+]?\d[\d,]*(?:\.\d+)?$/.test(value.trim())?Number(value.replaceAll(',','')):NaN;
const base={version:RESEARCH_EXIT_VERSION,researchOnly:true,orderEligible:false,ordersCreated:false,entryVeto:false};
const validLevels=(direction,entry,stop,target)=>[entry,stop,target].every(finite)&&(direction==='LONG'?stop<entry&&target>entry:direction==='SHORT'&&stop>entry&&target<entry);

export function planStructuralExit({signal,bars,entry,entryTime,tickSize,pointValue,sessionGaps=[],maxPivotAgeBars=100}={}){
  const unavailable=reason=>({...base,status:'UNAVAILABLE',reasonCodes:[reason]});
  if(!signal||!['LONG','SHORT'].includes(signal.direction)||!finite(entry)||!finite(entryTime)||!finite(tickSize)||tickSize<=0||!Number.isSafeInteger(maxPivotAgeBars)||maxPivotAgeBars<1)return unavailable('INVALID_PLAN_INPUT');
  const confirmationTime=signal.confirmedAt??signal.confirmationBarCloseTime;
  if(!finite(confirmationTime)||confirmationTime>entryTime)return unavailable('SIGNAL_NOT_KNOWN_AT_ENTRY');
  const normalized=normalizeContextBars(bars,{asOf:entryTime,sessionGaps});
  if(!normalized.valid||normalized.bars.length<5)return unavailable(normalized.reasonCodes[0]??'INSUFFICIENT_STRUCTURE');
  const history=normalized.bars,direction=signal.direction;
  if(!finite(signal.invalidation))return unavailable('STRUCTURAL_STOP_NOT_PROTECTIVE');
  let stop;
  try{stop=roundGuidePriceToTick(signal.invalidation,tickSize,direction==='LONG'?'DOWN':'UP');}
  catch{return unavailable('UNSAFE_STRUCTURAL_PRICE_COORDINATES');}
  if(direction==='LONG'?stop>=entry:stop<=entry)return unavailable('STRUCTURAL_STOP_NOT_PROTECTIVE');
  // The signal's invalidation already includes its buffer. Never add it twice.
  const pivots=confirmedPivots(history,{tickSize,pivotLeft:2,pivotRight:2,equalToleranceTicks:0});
  const type=direction==='LONG'?'HIGH':'LOW',candidates=[];
  for(const pivot of pivots){
    if(pivot.type!==type||pivot.knownAt>entryTime||history.length-1-pivot.localIndex>maxPivotAgeBars)continue;
    if(direction==='LONG'?pivot.price<=entry:pivot.price>=entry)continue;
    if(history.slice(pivot.localIndex+1).some(bar=>direction==='LONG'?bar.high>pivot.price:bar.low<pivot.price))continue;
    // Take profit one tick before the first unbroken confirmed swing obstacle.
    const target=roundGuidePriceToTick(pivot.price+(direction==='LONG'?-tickSize:tickSize),tickSize,direction==='LONG'?'DOWN':'UP');
    if(validLevels(direction,entry,stop,target))candidates.push({target,pivot:clone(pivot)});
  }
  candidates.sort((a,b)=>Math.abs(a.target-entry)-Math.abs(b.target-entry)||b.pivot.knownAt-a.pivot.knownAt);
  if(!candidates.length)return unavailable('NO_KNOWN_UNBROKEN_TARGET');
  const selected=candidates[0],riskPoints=Math.abs(stop-entry),rewardPoints=Math.abs(selected.target-entry);
  return {...base,status:'PLANNED',direction,entry,stop,target:selected.target,riskPoints,rewardPoints,rewardRisk:rewardPoints/riskPoints,
    riskPerContract:finite(pointValue)&&pointValue>0?riskPoints*pointValue:null,
    plannedAt:entryTime,stopBasis:'FROZEN_SIGNAL_INVALIDATION',targetBasis:'FIRST_UNBROKEN_CONFIRMED_PIVOT_ONE_TICK_BEFORE',
    targetEvidence:selected.pivot,parameters:{pivotLeft:2,pivotRight:2,equalToleranceTicks:0,targetBufferTicks:1,maxPivotAgeBars},reasonCodes:[]};
}

export function createTradeComparison({fill,signal,bars,metadata,costs={}}={}){
  const native=fill?.nativeFill,entry=native?.price,entryTime=native?.filledAt,direction=native?.direction;
  if(fill?.fillVerified!==true||native?.kind!=='NATIVE_EXECUTED_FILL_V1'||native.synthetic!==false||native.testOnly!==false||native.provider!=='TRADINGVIEW_PAPER'||native.environment!=='DEMO'||!finite(entry)||!finite(entryTime)||!['LONG','SHORT'].includes(direction)||!native.nativeOrderId)return null;
  const row=fill.nativePositionRow,order=native.orderRow,quantity=number(order?.qty),tickSize=metadata?.tickSize,pointValue=metadata?.pointValue;
  if(!Number.isSafeInteger(quantity)||quantity<=0||!finite(tickSize)||tickSize<=0||!finite(pointValue)||pointValue<=0||signal?.direction!==direction||typeof native.nativeAccountId!=='string'||!native.nativeAccountId||typeof order?.symbol!=='string'||!order.symbol)return null;
  const associatedClose=fill.latestClosedAt,signalClose=signal.confirmationBarCloseTime;
  if(!finite(signalClose)||associatedClose!==signalClose||signalClose>entryTime)return null;
  const id=[native.provider,native.nativeAccountId,order.symbol,native.nativeOrderId].join(':');
  const structural=planStructuralExit({signal,bars,entry,entryTime,tickSize,pointValue,sessionGaps:metadata.sessionGaps??[]});
  const baselineStop=number(row?.stopLoss),baselineTarget=number(row?.takeProfit);
  const rowMatches=row?.symbol===order.symbol&&number(row?.qty)===quantity&&number(row?.avgPrice)===entry&&row.side===(direction==='LONG'?'Long':'Short');
  const baseline=rowMatches&&validLevels(direction,entry,baselineStop,baselineTarget)?{status:'PLANNED',entry,stop:baselineStop,target:baselineTarget,
    riskPoints:Math.abs(entry-baselineStop),rewardPoints:Math.abs(baselineTarget-entry),rewardRisk:Math.abs(baselineTarget-entry)/Math.abs(entry-baselineStop),basis:'NATIVE_POSITION_LEVELS_OBSERVED_AFTER_FILL'}:{status:'UNAVAILABLE',reasonCodes:['NATIVE_BRACKET_NOT_OBSERVED']};
  const knownCosts=finite(costs.commissionPerContract)&&costs.commissionPerContract>=0&&finite(costs.slippageTicks)&&costs.slippageTicks>=0;
  const leg=plan=>({plan,outcome:{status:plan.status==='PLANNED'?'OPEN':'UNAVAILABLE',reasonCodes:plan.reasonCodes??[]},mfePoints:0,maePoints:0});
  return {...base,id,direction,entry,entryTime,quantity,tickSize,pointValue,accountId:native.nativeAccountId,contract:order.symbol,
    entryOrderId:native.nativeOrderId,entryUtcOffsetMinutes:finite(native.utcOffsetMinutes)?native.utcOffsetMinutes:null,
    sourceId:metadata.sourceId,instrument:metadata.instrument,timeframe:metadata.timeframe,signalEventId:signal.eventId,
    priceBasis:'CHART_STRUCTURE_WITH_NATIVE_CONTRACT_FILL',priceBasisAlignmentVerified:false,createdFrom:'VERIFIED_PAPER_FILL',
    entryTimestampPrecisionMs:finite(native.timestampPrecisionMs)&&native.timestampPrecisionMs>0?native.timestampPrecisionMs:1000,
    excursionBasis:'FULL_CLOSED_BARS_WITHOUT_EXIT_TOUCH_EXCLUDES_PARTIAL_ENTRY_AND_EXIT_BARS',
    costs:knownCosts?{commissionPerContract:costs.commissionPerContract,slippageTicks:costs.slippageTicks,basis:'USER_ASSUMPTION_ROUND_TRIP'}:null,
    baseline:leg(baseline),structural:leg(structural),lastBarCloseTime:null,observedBars:[],reasonCodes:[]};
}

function finish(record,leg,status,bar,exitPrice=null){
  const points=exitPrice===null?null:(record.direction==='LONG'?exitPrice-record.entry:record.entry-exitPrice);
  const grossPnl=points===null?null:points*record.pointValue*record.quantity;
  const allowance=record.costs?(record.costs.commissionPerContract+record.costs.slippageTicks*record.tickSize*record.pointValue)*record.quantity:null;
  leg.outcome={status,barTime:bar.time,barCloseTime:bar.closeTime,exitPrice,points,grossPnl,netPnl:grossPnl!==null&&allowance!==null?grossPnl-allowance:null,
    simulated:true,fillVerified:false,reasonCodes:status==='AMBIGUOUS'?['BOTH_LEVELS_TOUCHED_ORDER_UNKNOWN']:status==='ENTRY_BAR_UNCERTAIN'?['PARTIAL_ENTRY_BAR_PATH_UNKNOWN']:[]};
}

export function advanceTradeComparison(input,bars,{metadata,sessionGaps=[],asOfTime=null}={}){
  const record=clone(input);
  if(record?.version!==RESEARCH_EXIT_VERSION||!Array.isArray(bars)||asOfTime!==null&&!finite(asOfTime))return record;
  if(metadata&&['sourceId','instrument','timeframe'].some(k=>record[k]!==metadata[k]))return record;
  for(const bar of bars){
    if(!bar||typeof bar!=='object')continue;
    // Availability is separate from bar time. Future/unreceived suffix bars
    // must not resolve a comparison at an earlier decision cutoff.
    const knownAt=bar.knownAt??bar.closeTime;
    if(asOfTime!==null&&(bar.closeTime>asOfTime||knownAt>asOfTime))continue;
    if(bar.closed!==true||!finite(bar.closeTime)||bar.closeTime<=record.entryTime||record.lastBarCloseTime!==null&&bar.closeTime<=record.lastBarCloseTime)continue;
    if(!['time','open','high','low','close'].every(k=>finite(bar[k]))||!finite(knownAt)||knownAt<bar.closeTime||bar.closeTime<=bar.time||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||
      bar.chartType!==undefined&&!['standard','candles'].includes(bar.chartType)||record.lastBarCloseTime!==null&&bar.time<record.lastBarCloseTime){
      for(const name of ['baseline','structural'])if(record[name].outcome.status==='OPEN')finish(record,record[name],'INVALID_DATA',bar);
      break;
    }
    const gap=record.lastBarCloseTime!==null&&bar.time>record.lastBarCloseTime&&!sessionGaps.some(g=>g.kind==='market_closed'&&g.from===record.lastBarCloseTime&&g.to===bar.time);
    const initialGap=record.lastBarCloseTime===null&&bar.time>record.entryTime;
    record.lastBarCloseTime=bar.closeTime;
    record.observedBars.push({time:bar.time,closeTime:bar.closeTime,open:bar.open,high:bar.high,low:bar.low,close:bar.close});
    if(record.observedBars.length>480)record.observedBars.shift();
    for(const name of ['baseline','structural']){
      const leg=record[name];if(leg.outcome.status!=='OPEN')continue;
      if(gap||initialGap){finish(record,leg,'DATA_GAP',bar);continue;}
      const {stop,target}=leg.plan,long=record.direction==='LONG';
      const stopTouched=long?bar.low<=stop:bar.high>=stop,targetTouched=long?bar.high>=target:bar.low<=target;
      // Native fill seconds do not reveal which extremes preceded that fill.
      const partialEntryBar=bar.time<record.entryTime+(record.entryTimestampPrecisionMs??0);
      if(partialEntryBar&&(stopTouched||targetTouched)){finish(record,leg,'ENTRY_BAR_UNCERTAIN',bar);continue;}
      if(partialEntryBar)continue;
      if(long?bar.open<=stop:bar.open>=stop){finish(record,leg,'STOP_REACHED',bar,bar.open);continue;}
      if(long?bar.open>=target:bar.open<=target){finish(record,leg,'TARGET_REACHED',bar,target);continue;}
      if(stopTouched&&targetTouched){finish(record,leg,'AMBIGUOUS',bar);continue;}
      if(stopTouched)finish(record,leg,'STOP_REACHED',bar,stop);
      else if(targetTouched)finish(record,leg,'TARGET_REACHED',bar,target);
      else{
        // An exit candle's other extreme may occur after the simulated exit.
        // Report only definitely observed full-bar excursions before that exit.
        leg.mfePoints=Math.max(leg.mfePoints,long?bar.high-record.entry:record.entry-bar.low);
        leg.maePoints=Math.max(leg.maePoints,long?record.entry-bar.low:bar.high-record.entry);
        if(bar.closeTime-record.entryTime>=480*60000)finish(record,leg,'OBSERVATION_WINDOW_ENDED',bar);
      }
    }
  }
  return record;
}

export function summarizeTradeComparisons(records=[]){
  const resolved=leg=>['TARGET_REACHED','STOP_REACHED'].includes(leg.outcome.status);
  const paired=records.filter(r=>resolved(r.baseline)&&resolved(r.structural)).sort((a,b)=>a.entryTime-b.entryTime);
  const metrics=name=>{
    let cumulative=0,peak=0,maxDrawdown=0;
    const allCosts=paired.length>0&&paired.every(r=>r[name].outcome.netPnl!==null);
    for(const row of paired){cumulative+=allCosts?row[name].outcome.netPnl:row[name].outcome.grossPnl;peak=Math.max(peak,cumulative);maxDrawdown=Math.max(maxDrawdown,peak-cumulative);}
    const value=row=>allCosts?row[name].outcome.netPnl:row[name].outcome.grossPnl;
    const losses=paired.filter(r=>value(r)<0),wins=paired.filter(r=>value(r)>0);
    return {trades:paired.length,wins:wins.length,winRate:paired.length?wins.length/paired.length:null,grossPnl:paired.reduce((s,r)=>s+r[name].outcome.grossPnl,0),
      netPnl:allCosts?paired.reduce((s,r)=>s+r[name].outcome.netPnl,0):null,maxDrawdown:paired.length?maxDrawdown:null,drawdownBasis:allCosts?'NET':'GROSS',
      meanLoss:losses.length?losses.reduce((s,r)=>s+value(r),0)/losses.length:null,winLossBasis:allCosts?'NET':'GROSS'};
  };
  return {...base,sampleStatus:paired.length<30?'INSUFFICIENT_SAMPLE':'DESCRIPTIVE_ONLY',totalRecords:records.length,pairedResolved:paired.length,
    excluded:records.length-paired.length,baseline:metrics('baseline'),structural:metrics('structural'),
    actualUserPnlComputed:false,comparisonBasis:'PAIRED_FROZEN_EXIT_SIMULATIONS_SAME_NATIVE_PAPER_ENTRIES'};
}
