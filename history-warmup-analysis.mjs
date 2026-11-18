import {createGuideAnalyzer} from './guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';
import {userManagedLiveAnalysisOptions} from './live-user-mode.mjs';
import {validateHistoryBar} from './history-24-core.mjs';
import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';

// Chronological causal reconstruction. This worker has no execution adapter.
// Each batch includes its entire preceding prefix, never only a memory load
// or independent 600-bar windows. Confirmation remains known at its own close.
export async function analyzeWarmupSequential(dataset,metadata,{batchSize=10,onProgress=()=>{},yieldControl=()=>new Promise(r=>setTimeout(r,5))}={}){
  const result={kind:'CHRONOLOGICAL_WARMUP_RESULT_V1',status:'BLOCKED',requestedBars:dataset?.requestedBars??3000,processedBars:0,signals:[],audit:[],ordersCreated:false,orderEligible:false,liveEligible:false,historicalResearch:true,availabilityPolicy:'HISTORICAL_CLOSE_RECONSTRUCTION_NOT_LIVE_APPROVAL',reasonCodes:[]};
  const count=dataset?.requestedBars;
  if(dataset?.complete!==true||!Number.isSafeInteger(count)||count<20||count>3000||metadata?.instrument!=='CME_MINI:NQ1!'||metadata.timeframe!=='1'||metadata.timeframeMs!==60000||metadata.tickSize!==.25||metadata.pointValue!==20||metadata.currency!=='USD')return {...result,reasonCodes:['VERIFIED_WARMUP_DATASET_REQUIRED']};
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw TypeError('INVALID_WARMUP_BATCH_SIZE');
  const original=dataset.series,base=original?.['1'];
  if(!Array.isArray(base)||base.length!==count||base.some(b=>!validateHistoryBar(b,60000)))return {...result,reasonCodes:['EXACT_CLOSED_WARMUP_COUNT_REQUIRED']};
  const gaps=deriveVerifiedSessionGaps(base);if(!gaps.valid)return {...result,reasonCodes:gaps.reasonCodes};
  const rows=input=>input.map(b=>({...structuredClone(b),originalKnownAt:b.knownAt??b.observedAt??null,knownAt:b.closeTime,closed:true,sourceClosed:true,finalOhlcVerified:true}));
  const bars=rows(base),higher={};
  for(const tf of ['5','15']){
    const source=original[tf];if(!Array.isArray(source)||source.length<20||source.some(b=>!validateHistoryBar(b,Number(tf)*60000)))return {...result,reasonCodes:['VERIFIED_WARMUP_HIGHER_TIMEFRAME_REQUIRED:'+tf]};
    const proof=deriveVerifiedSessionGaps(source);if(!proof.valid)return {...result,reasonCodes:proof.reasonCodes};
    higher[tf]={bars:rows(source),sessionGaps:proof.gaps,timeframe:tf,timeframeMs:Number(tf)*60000,instrument:metadata.instrument};
  }
  const analyzer=createGuideAnalyzer(),byClose=new Map(),conflicts=new Set(),options=userManagedLiveAnalysisOptions();
  options.config={...options.config,maxBars:3000};
  const horizon=Math.max(options.config.expiryBars,options.config.insideExpiryBars)+1;
  let previous=0;
  for(let end=Math.min(batchSize,count);;end=Math.min(count,end+batchSize)){
    const prefix=bars.slice(0,end),asOfTime=prefix.at(-1).closeTime;
    const analysis=analyzer.analyze(prefix,{...options,metadata:{...metadata,source:'ohlc',replay:false,realtime:false,historicalResearch:true,sessionGaps:gaps.gaps},higherTimeframes:higher,asOfTime,evaluationStartIndex:Math.max(0,previous-horizon)});
    if(analysis.status==='BLOCKED')return {...result,reasonCodes:analysis.reasonCodes};
    const technical=selectGuideTechnicalDecision({analysis,bars:prefix,asOfTime});
    // Fewer than three bars form a valid prefix, but no strict pattern ledger
    // can approve a trade yet. Progress still accounts for every prefix bar.
    if(technical.status==='BLOCKED'&&end>=3)return {...result,reasonCodes:technical.reasonCodes};
    const lower=previous?bars[previous-1].closeTime:-Infinity;
    for(const conflict of technical.conflicts??[])if(conflict.confirmationBarCloseTime>lower)conflicts.add(conflict.confirmationBarCloseTime);
    for(const signal of [...(technical.historicalSignals??[]),...(technical.signal?[technical.signal]:[])]){
      const close=signal.confirmationBarCloseTime;if(close<=lower||close>asOfTime)continue;
      const bar=prefix.find(b=>b.closeTime===close);if(!bar)continue;
      const item={eventId:signal.eventId,time:bar.time,closeTime:close,direction:signal.direction,price:bar.close,patternIds:structuredClone(signal.patternIds),strategyIds:(signal.strategyProofs??[]).map(p=>p.profileId),historicalResearch:true,liveApproved:false,ordersCreated:false};
      if(byClose.has(close)&&byClose.get(close).direction!==item.direction)conflicts.add(close);else byClose.set(close,item);
    }
    for(let index=previous;index<end;index++)result.audit.push({index,time:bars[index].time,closeTime:bars[index].closeTime,patternIds:[...(analysis.patterns?.byBar?.[index]?.patternIds??[])],candidateEvaluations:analysis.events.filter(e=>e.signalIndex===index).length});
    previous=end;result.processedBars=end;onProgress({processedBars:end,requestedBars:count,processedThrough:asOfTime,orderEligible:false});await yieldControl();
    if(end===count)break;
  }
  return {...result,status:'COMPLETE',reasonCodes:[],signals:[...byClose.values()].filter(s=>!conflicts.has(s.closeTime)).sort((a,b)=>a.closeTime-b.closeTime),excludedConflictingCandles:[...conflicts],start:bars[0].time,end:bars.at(-1).closeTime,parameterSnapshot:options,processingPolicy:'EVERY_BAR_IN_TIME_ORDER_FULL_PRECEDING_PREFIX_CAUSAL_CONFIRMATIONS',activeModelBars:3000};
}
