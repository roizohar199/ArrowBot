import {createLiveOhlcStore} from './live-ohlc-store.mjs';
import {createLiveTimeframes} from './live-timeframes.mjs';
import {analyzeGuideSignals,GUIDE_SIGNAL_DEFAULTS} from './guide-signal-engine.mjs';
import {selectFreshLiveSignal} from './live-signal-eligibility.mjs';

export const DELIVERY_PROBE_VERSION='controlled-delivery-probe-1';
const minute=60000;
const closes=Object.freeze([105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105,108,110,108,105,102,100,102,105]);
const higherCloses=Object.freeze([100,102,104,102,101,103,105,103,102,104,106,104,103,105,107,105,104,106,108,106,105,107,109,107,106]);
const clone=value=>structuredClone(value);

// This isolated fixture exercises the production intake, context, confirmation,
// risk and freshness functions. It does not inspect a chart or claim its prices
// came from a market. The receiving UI must keep this result in TEST mode and
// out of its live alert ledger. No browser, storage, account or order API exists
// in this module.
export function createApprovedDeliveryProbe({now=Date.now}={}){
  if(typeof now!=='function')throw TypeError('INVALID_DELIVERY_PROBE_CLOCK');
  const createdAt=now();
  if(!Number.isSafeInteger(createdAt)||createdAt<402*minute)throw TypeError('INVALID_DELIVERY_PROBE_TIME');
  const start=createdAt-27*minute,runId='CONTROLLED_DELIVERY_PROBE|'+createdAt;
  const metadata={source:'ohlc',provider:'CONTROLLED_NON_MARKET_TEST',sourceId:runId,tabId:0,instrument:'SYNTHETIC_TEST:NQ',timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,currency:'USD',timezone:'UTC',session:'controlled_test',chartType:'standard',realtime:true,replay:false,testOnly:true};
  const risk={riskBudget:200,pointValue:20,commissionPerContract:4,slippageTicks:2,maxContracts:1,rewardRisk:2};
  const signalConfig={...GUIDE_SIGNAL_DEFAULTS,requireRisk:true,requireLocation:true,requireHigherTimeframe:true};
  const bar=(index,open,high,low,close)=>({time:start+index*minute,closeTime:start+(index+1)*minute,open,high,low,close,closed:true,sourceClosed:true});
  const bars=[...closes.map((value,index)=>bar(index,value,value+1,value-1,value)),bar(25,100.5,101.25,98.75,101),bar(26,101.25,102.5,101,102)];
  const bootstrapAt=bars[23].closeTime;
  let virtualNow=bootstrapAt,sequence=0;
  // Preserve the production stale-after15s guard. Synthetic open observations
  // advance the isolated clock every10s; no relaxed freshness setting is used.
  const store=createLiveOhlcStore({now:()=>virtualNow}),timeframes=createLiveTimeframes();
  const sourcePackets=[],stages=[];
  function packet(kind,rows,at,extra={}){
    const value={kind,runId,sequence:++sequence,sourceEmittedAt:at,receivedAt:at,realtime:true,metadata:clone(metadata),bars:clone(rows),...extra};
    sourcePackets.push({testOnly:true,kind,sequence:value.sequence,sourceEmittedAt:at,receivedAt:at,barCount:rows.length,closedBars:rows.filter(row=>row.closed).length,openBars:rows.filter(row=>!row.closed).length,higherTimeframes:(value.higherTimeframes??[]).map(entry=>({timeframe:entry.timeframe,closedBars:entry.bars.length}))});
    return value;
  }
  const initial=packet('snapshot',bars.slice(0,24),bootstrapAt);
  const seeded=store.ingest(initial,{sourceAsOfTime:bootstrapAt});
  if(!seeded.accepted||!seeded.bootstrap||seeded.eligibleCloseTimes.length)throw Error('DELIVERY_PROBE_BOOTSTRAP_FAILED');
  timeframes.ingest(initial,{observedAsOfTime:bootstrapAt,includeBars:false});
  for(const timeframe of ['5','15']){
    const duration=Number(timeframe)*minute,rows=higherCloses.map((value,index)=>({time:start-(25-index)*duration,closeTime:start-(24-index)*duration,open:value,high:value+1,low:value-1,close:value,closed:true,sourceClosed:true}));
    const incoming=packet('timeframe_snapshot',[],bootstrapAt,{higherTimeframes:[{timeframe,timeframeMs:duration,bars:rows,reasonCodes:[]}]});
    const accepted=timeframes.ingest(incoming,{observedAsOfTime:bootstrapAt,includeBars:false});
    if(!accepted.ok)throw Error('DELIVERY_PROBE_HIGHER_INTAKE_FAILED');
  }
  let state=seeded,analysis=null,options=null;
  for(let index=24;index<=26;index++){
    const complete=bars[index];
    for(let elapsed=10000;elapsed<minute;elapsed+=10000){
      const close=Math.round((complete.open+(complete.close-complete.open)*elapsed/minute)/metadata.tickSize)*metadata.tickSize;
      const observed={...complete,high:Math.max(complete.open,close),low:Math.min(complete.open,close),close,closed:false,sourceClosed:false};
      virtualNow=complete.time+elapsed;
      const incoming=packet('update',[observed],virtualNow);
      state=store.ingest(incoming,{sourceAsOfTime:virtualNow});timeframes.ingest(incoming,{observedAsOfTime:virtualNow,includeBars:false});
      if(!state.accepted||!state.ready||state.eligibleCloseTimes.length)throw Error('DELIVERY_PROBE_OPEN_INTAKE_FAILED');
    }
    virtualNow=complete.closeTime;
    const incoming=packet('update',[complete],virtualNow);
    state=store.ingest(incoming,{sourceAsOfTime:virtualNow});timeframes.ingest(incoming,{observedAsOfTime:virtualNow,includeBars:false});
    if(!state.accepted||!state.ready||!state.liveEligible)throw Error('DELIVERY_PROBE_FINAL_INTAKE_FAILED');
    options={metadata:state.metadata,risk:clone(risk),config:clone(signalConfig),higherTimeframes:timeframes.snapshot({asOfTime:virtualNow}).higherTimeframes,asOfTime:virtualNow};
    analysis=analyzeGuideSignals(state.bars,options);
    const setup=analysis.events.find(event=>event.signalIndex===25&&event.direction==='LONG');
    stages.push({sourceSequence:incoming.sequence,sourceEmittedAt:virtualNow,closedBarIndex:index,closedBars:state.bars.length,status:analysis.status,signalCount:analysis.signals.length,setupStatus:setup?.status??null,eligibleCloseTimes:clone(state.eligibleCloseTimes)});
  }
  const selected=analysis.signals.map(signal=>selectFreshLiveSignal(signal,analysis,{bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:state.eligibleCloseTimes,bars:state.bars})).filter(Boolean);
  if(selected.length!==1||selected[0].riskPlan?.status!=='PLANNED'||selected[0].riskPlan.quantity!==1)throw Error('DELIVERY_PROBE_POSITIVE_APPROVAL_FAILED');
  const signal=selected[0],requiredChecks=signal.contextSnapshot.checks.filter(check=>check.required);
  if(requiredChecks.some(check=>!check.passed)||signal.orderEligible!==false||signal.execution!=='OBSERVATION_ONLY')throw Error('DELIVERY_PROBE_APPROVAL_CONTRACT_FAILED');
  return {kind:'CONTROLLED_DELIVERY_PROBE',definitionVersion:DELIVERY_PROBE_VERSION,testOnly:true,live:false,marketData:false,createdAt,label:'בדיקת מסירה מבוקרת בלבד · נתונים סינתטיים · אינו איתות שוק',
    source:{kind:'SYNTHETIC_TEST',instrument:metadata.instrument,runId,marketData:false,live:false,connectedToTradingView:false,accountReviewPerformed:false},signal:clone(signal),
    analysisSummary:{definitionVersion:analysis.definitionVersion,status:analysis.status,closedBars:state.bars.length,eventCount:analysis.events.length,signalCount:analysis.signals.length,freshApprovedCount:selected.length,beforeConfirmation:clone(stages[1]),stages,requiredChecks:requiredChecks.map(check=>({id:check.id,state:check.state,passed:check.passed})),conditionsMet:signal.contextSnapshot.conditionsMet},
    approvalProof:{testOnly:true,sourceSynthetic:true,marketData:false,live:false,simulatedRealtimeIntake:true,actualLiveAlert:false,sourceIntakeAccepted:state.accepted,allBarsProviderFinalWithinSyntheticFixture:state.bars.every(item=>item.closed&&item.finalOhlcVerified),postBootstrapFormation:signal.formationStartTime>=state.bootstrapAsOfTime,bootstrapAsOfTime:state.bootstrapAsOfTime,formationStartTime:signal.formationStartTime,confirmationAt:signal.confirmedAt,confirmationCloseTime:signal.confirmationBarCloseTime,eligibleConfirmation:state.eligibleCloseTimes.includes(signal.confirmationBarCloseTime),confirmationPolicy:signal.confirmationPolicy,higherTimeframesReady:timeframes.summary().ready,requiredChecksPassed:requiredChecks.every(check=>check.passed),riskPlanStatus:signal.riskPlan.status,riskBudget:risk.riskBudget,maxContracts:risk.maxContracts,quantity:signal.riskPlan.quantity,commissionAllowance:signal.riskPlan.commissionAllowance,slippageAllowance:signal.riskPlan.slippageAllowance,totalPlannedRisk:signal.riskPlan.totalPlannedRisk,maximumSyntheticReceiptGapMs:10000,ordersCreated:false,brokerAccountVerified:false},
    config:{risk:clone(risk),signal:clone(signalConfig)},sourcePackets,
    replayInputs:{testOnly:true,scope:'SYNTHETIC_INPUTS_ONLY_NOT_MARKET_DATA',bars:clone(state.bars),options:clone(options),bootstrapAsOfTime:state.bootstrapAsOfTime,eligibleCloseTimes:clone(state.eligibleCloseTimes)},
  };
}
