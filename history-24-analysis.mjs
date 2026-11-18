import {analyzeGuideSignals} from './guide-signal-engine.mjs';
import {selectGuideTechnicalDecision} from './guide-technical-decision.mjs';
import {userManagedLiveAnalysisOptions} from './live-user-mode.mjs';
import {deriveVerifiedSessionGaps} from './session-gap-proof.mjs';

// Research clock only. Original receipt/availability stays in the archive and
// is never changed in the live store or used to grant a historical order.
function researchRows(rows){return rows.map(b=>({...structuredClone(b),originalKnownAt:b.knownAt??null,knownAt:b.closeTime,availabilityPolicy:'HISTORICAL_PROVIDER_CLOSE_RECONSTRUCTION',closed:true,sourceClosed:true,finalOhlcVerified:true}));}
export async function analyzeHistory24(dataset,metadata,{yieldControl=()=>new Promise(resolve=>setTimeout(resolve,10)),onProgress=()=>{}}={}){
  const base={kind:'HISTORY24_RESEARCH_RESULT_V1',status:'BLOCKED',start:dataset?.start,end:dataset?.end,signals:[],strategyCounts:{},parameterSnapshot:userManagedLiveAnalysisOptions(),ordersCreated:false,orderEligible:false,fillInferred:false,profitabilityVerified:false,availabilityPolicy:'HISTORICAL_PROVIDER_CLOSE_RECONSTRUCTION_NOT_LIVE_AVAILABILITY',reasonCodes:[]};
  if(dataset?.complete!==true||!metadata||metadata.instrument!=='CME_MINI:NQ1!'||metadata.timeframe!=='1')return {...base,reasonCodes:['COMPLETE_VERIFIED_HISTORY24_REQUIRED']};
  const bars=researchRows(dataset.series['1']),higher={};
  for(const tf of ['5','15']){const rows=researchRows(dataset.series[tf]),gaps=deriveVerifiedSessionGaps(rows);if(!gaps.valid)return {...base,reasonCodes:gaps.reasonCodes};higher[tf]={bars:rows,sessionGaps:gaps.gaps,timeframe:tf,timeframeMs:Number(tf)*60000,instrument:metadata.instrument};}
  const byClose=new Map(),conflicts=new Set(),counts={},diagnostics=[];let used=0,reportedThrough=-1;
  // Overlapping600-bar causal windows. Every reported candle has up to400
  // preceding bars, including the separately retained warmup before24h.
  const ends=[];for(let end=Math.min(600,bars.length);end<bars.length;end+=200)ends.push(end);if(bars.length)ends.push(bars.length);
  for(let index=0;index<ends.length;index++){
    const end=ends[index],chunk=bars.slice(Math.max(0,end-600),end),cutoff=chunk.at(-1).closeTime,gaps=deriveVerifiedSessionGaps(chunk);if(!gaps.valid)return {...base,reasonCodes:gaps.reasonCodes};
    const options={...userManagedLiveAnalysisOptions(),metadata:{...metadata,replay:false,realtime:false,sessionGaps:gaps.gaps,historicalResearch:true},higherTimeframes:higher,asOfTime:cutoff};
    const analysis=analyzeGuideSignals(chunk,options),technical=selectGuideTechnicalDecision({analysis,bars:chunk,asOfTime:cutoff});
    if(technical.status==='BLOCKED')return {...base,reasonCodes:technical.reasonCodes};
    diagnostics.push({from:chunk[0].time,to:cutoff,bars:chunk.length,candidates:analysis.events.length,confirmed:technical.historicalSignals.length+(technical.signal?1:0),contextUsable:analysis.events.filter(e=>(e.contextSnapshot?.context?.barsUsed??0)>0).length});
    const from=reportedThrough;
    for(const c of technical.conflicts)if(c.confirmationBarCloseTime>from)conflicts.add(c.confirmationBarCloseTime);
    for(const signal of [...technical.historicalSignals,...(technical.signal?[technical.signal]:[])]){
      if(signal.confirmationBarCloseTime<=Math.max(dataset.start,from)||signal.confirmationBarCloseTime>dataset.end)continue;
      // Keep each confirmation from a window with the largest preceding prefix.
      const bar=chunk.find(b=>b.closeTime===signal.confirmationBarCloseTime);if(!bar)continue;const preceding=chunk.indexOf(bar),prior=byClose.get(bar.closeTime);if(prior&&prior.preceding>=preceding)continue;
      const strategies=signal.strategyProofs?.map(p=>p.profileId)??[];
      const record={approvalKind:'TECHNICAL',eventId:signal.eventId,sourceEventIds:structuredClone(signal.sourceEventIds),time:bar.time,closeTime:bar.closeTime,confirmedAt:bar.closeTime,openTicks:bar.open/.25,highTicks:bar.high/.25,lowTicks:bar.low/.25,closeTicks:bar.close/.25,price:bar.close,priceTicks:bar.close/.25,direction:signal.direction,directionCode:signal.direction==='LONG'?1:-1,sourceMode:'LIVE',liveApproved:false,patternIds:structuredClone(signal.patternIds),setupIds:structuredClone(signal.setupIds),strategyIds:strategies,historicalResearch:true};
      if(prior&&prior.record.direction!==record.direction){conflicts.add(bar.closeTime);continue;}byClose.set(bar.closeTime,{record,preceding});
    }
    reportedThrough=cutoff;used++;onProgress({chunksCompleted:used,totalChunks:ends.length});await yieldControl();
  }
  const signals=[...byClose.values()].map(x=>x.record).filter(r=>!conflicts.has(r.closeTime)).sort((a,b)=>a.time-b.time);
  for(const r of signals)for(const strategy of r.strategyIds)counts[strategy]=(counts[strategy]??0)+1;
  return {...base,status:'COMPLETE',signals,strategyCounts:counts,reasonCodes:[],diagnostics,analysisWindow:{bars:600,stride:200,policy:'CAUSAL_OVERLAPPING_WINDOWS_LAST_200_CONFIRMATIONS_WITH_UP_TO_400_PLUS_CONTEXT_NOT_A_LIVE_EXECUTION_REPLAY'},coverage:structuredClone(dataset.coverage),sourceBars:bars.length,confirmedCandles:signals.length,excludedConflictingCandles:[...conflicts]};
}
