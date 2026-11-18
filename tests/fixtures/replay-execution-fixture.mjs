import {planGuideRisk} from '../../guide-risk.mjs';
import {GUIDE_SIGNAL_VERSION} from '../../guide-signal-engine.mjs';
// Synthetic component contracts only. These manually declared context PASS
// rows do not claim approval by the complete pattern engine, market provenance,
// actual UI reads, order registration or an actual Replay Trading fill.
const clone=value=>structuredClone(value),minute=60000,instrument='CME_MINI:NQ1!',origin=1577836800000,scalar=1e12;
const flagIds=['requireLocation','requireRisk','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand'];
const checks=['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME','EMA','FIB','TRENDLINE','SUPPLY_DEMAND'];
export function bindPublicProof(f){
  const w=f.replayWitness,tag=w.sequence%4096;
  w.fields={ARROW2_RUN_EPOCH:String(w.runEpoch),ARROW2_SEQ_BEGIN:String(w.sequence),ARROW2_SEQ_END:String(w.sequence),
    ARROW2_CURRENT_TIME:String(tag*scalar+w.current.time-origin),
    ARROW2_CURRENT_CLOSE_TIME:String(tag*scalar+w.current.providerBarIndex*4+(w.current.sessionFirst?1:0)+(w.current.sessionLast?2:0)),
    ARROW2_CHECKSUM_A:'424242',ARROW2_CHECKSUM_B:'656565'};
  w.currentTime=w.current.time;w.currentCloseTime=w.current.closeTime;
  f.uiEvidence.sourceBinding={runId:w.runId,runEpoch:w.runEpoch,sequence:w.sequence,currentTime:w.currentTime,
    currentCloseTime:w.currentCloseTime,asOfTime:f.decision.asOfTime,eventId:f.decision.signal.eventId,fields:clone(w.fields)};
  if(f.uiEvidence.inventory){f.uiEvidence.inventory.sourceBinding=clone(f.uiEvidence.sourceBinding);f.uiEvidence.inventory.sourceFields=clone(w.fields);}
}
export function synchronizeSignal(f){
  const signal=f.decision.signal;
  f.analysis.signals=[clone(signal)];
  const event=clone(signal);event.eventId=signal.setupEventIds[0];delete event.setupEventIds;delete event.setupFormations;
  f.analysis.events=[event];
}
export function fixture({direction='LONG',stopTicks=37,commission=3.1,slippage=2}={}){
  const asOf=Date.UTC(2026,10,13,18),now=Date.UTC(2026,10,15,6),entry=28000,long=direction==='LONG';
  const metadata={source:'ohlc',instrument,timeframe:'1',timeframeMs:minute,tickSize:.25,pointValue:20,
    currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard',replay:true,realtime:false,synthetic:false};
  const rows=(count,duration)=>Array.from({length:count},(_,index)=>({time:asOf-(count-index)*duration,
    closeTime:asOf-(count-index-1)*duration,open:entry,high:entry+.25,low:entry-.25,close:entry,
    volume:1,closed:true,knownAt:asOf-(count-index-1)*duration,chartType:'standard'}));
  const bars=rows(24,minute),stop=entry+(long?-1:1)*stopTicks*.25;
  Object.assign(bars[22],long?{open:entry-1,close:entry-.75,low:stop,high:entry-.5}
    :{open:entry+1,close:entry+.75,low:entry+.5,high:stop});
  const risk={riskBudget:200,maxContracts:1,pointValue:20,commissionPerContract:commission,slippageTicks:slippage,rewardRisk:2};
  const config=Object.fromEntries(flagIds.map(key=>[key,true])),contextConfig={roleReversalEnabled:true,supplyDemandEnabled:true};
  const parameterSnapshot={config,contextConfig,risk};
  const signal={eventId:instrument+':1:'+asOf+':'+direction,setupEventIds:['synthetic-component-setup'],
    definitionVersion:GUIDE_SIGNAL_VERSION,status:'CONFIRMED',instrument,timeframe:'1',direction,
    formationStartTime:bars[22].time,detectedAt:bars[22].knownAt,knownAt:bars[22].knownAt,
    signalStartIndex:22,signalIndex:22,confirmationIndex:23,confirmedAt:asOf,confirmationBarCloseTime:asOf,
    confirmationClose:entry,confirmationPolicy:'later_close_beyond_setup',trigger:entry+(long?-.25:.25),invalidation:stop,
    stopReference:{mode:'formation',low:bars[22].low,high:bars[22].high,bufferTicks:0},
    patternIds:[long?'BULLISH_ENGULFING':'BEARISH_ENGULFING'],execution:'OBSERVATION_ONLY',orderEligible:false,
    contextSnapshot:{passed:true,checks:checks.map(id=>({id,required:true,enabled:true,available:true,passed:true,state:'PASS'}))},
    parameterSnapshot:clone(parameterSnapshot),riskPlan:planGuideRisk({...risk,direction,entry,stop,tickSize:.25})};
  const quote=entry+(long?.25:-.25),current={...clone(bars[23]),time:asOf,closeTime:asOf+minute,open:entry,
    high:Math.max(entry,quote),low:Math.min(entry,quote),close:quote,closed:false,sourceClosed:false,providerBarIndex:124,sessionFirst:false,sessionLast:false},
    previous={...clone(bars[23]),sourceClosed:true,providerBarIndex:123,sessionFirst:false,sessionLast:false};
  const witnessMetadata=clone(metadata);delete witnessMetadata.replay;delete witnessMetadata.realtime;
  const f={fixtureScope:'SYNTHETIC_COMPONENT_CONTRACT_NOT_MARKET_OR_FULL_ENGINE_APPROVAL',now,
    decision:{status:'CONFIRMED',mode:'REPLAY',liveEligible:false,orderEligible:false,execution:'REPLAY_RESEARCH_ONLY',asOfTime:asOf,
      confirmedAtCurrentClose:1,signal},
    analysis:{definitionVersion:GUIDE_SIGNAL_VERSION,sourceKind:'original_research_definition',execution:'OBSERVATION_ONLY',
      orderEligible:false,dataQuality:{valid:true},metadata:clone(metadata),asOfTime:asOf,parameterSnapshot:clone(parameterSnapshot),signals:[],events:[]},
    analysisInput:{mode:'REPLAY',liveEligible:false,orderEligible:false,bars,options:{metadata:clone(metadata),asOfTime:asOf,
      config:clone(config),contextConfig:clone(contextConfig),risk:clone(risk),higherTimeframes:Object.fromEntries(['5','15'].map(timeframe=>[
        timeframe,{timeframe,timeframeMs:Number(timeframe)*minute,instrument,
          metadata:{...clone(metadata),timeframe,timeframeMs:Number(timeframe)*minute},bars:rows(24,Number(timeframe)*minute)}]))},
      cutoff:{asOfTime:asOf,selectedClosedBarRole:'previous',matchedClosedBarTime:previous.time,matchedClosedBarCloseTime:asOf,
        observedCurrentTime:current.time,observedCurrentCloseTime:current.closeTime,observedCurrentProviderFinal:false,
        openCurrentExcluded:true,exactTimeAndOhlcMatch:true}},
    replayWitness:{kind:'TRADINGVIEW_REPLAY_WINDOW_WITNESS',mode:'REPLAY',replay:true,liveEligible:false,
      checksumsVerified:true,pineRealtimeExecution:false,runEpoch:now-minute,runId:instrument+'|1|'+(now-minute),sequence:17,
      metadata:witnessMetadata,current,previous,observedAt:now-80,sourceObservedEpochMs:now-70.5,
      sourceDocumentTimeOrigin:now-400000,sourceEmittedAt:now-10},
    uiEvidence:{status:'REPLAY_TRADING_UI_VERIFIED',provider:'REPLAY_TRADING',mode:'REPLAY_TRADING',replay:true,chartCount:1,
      instrument,timeframe:'1',sourceTabId:17,researchUrl:'https://www.tradingview.com/chart/research-fixture/',
      observedAt:now-20,flat:true,positions:[],workingOrders:[],positionsComplete:true,workingOrdersComplete:true,
      inventory:{kind:'REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1',status:'FLAT_NO_PENDING',provider:'REPLAY_TRADING',scope:'CURRENT_REPLAY_SYMBOL_ONLY',
        instrument,timeframe:'1',researchUrl:'https://www.tradingview.com/chart/research-fixture/',sourceTabId:17,observedAt:now-20,
        documentTimeOrigin:now-400000,quote,positionMarker:'—',pnlMarker:'—',buyCancelDisabled:true,sellCancelDisabled:true,
        positionEmpty:true,pendingEmpty:true,flat:true,positions:[],workingOrders:[],positionsComplete:true,workingOrdersComplete:true},
      ticket:{stage:'NEW_ORDER_TICKET',symbol:'NQ1!',type:'LIMIT',quantity:1,tickValue:5,
        entry:quote,quote,bid:quote,ask:quote,stopMode:'PRICE',targetMode:'PRICE',stopEnabled:false,targetEnabled:false}}};
  synchronizeSignal(f);bindPublicProof(f);return f;
}

export {clone,minute,instrument,origin,scalar,flagIds,checks};
