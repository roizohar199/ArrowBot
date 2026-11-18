import test from 'node:test';
import assert from 'node:assert/strict';
import {canPreserveWindowClosedContext} from '../live-ohlc.mjs';

function fixture(){
  const metadata={source:'ohlc',sourceId:'run-1',sourceUrl:'https://www.tradingview.com/chart/ARROWFR1/',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'};
  const preserveChecks=Object.fromEntries(['inactivityOnly','forwardBoundedSequence','clockNotRegressed','sourceStrictlyAdvanced','currentNotRegressed','onlyBenignReprimePending','noInvalidSeries','currentAdjacent','historyRowsPresent','observedClosedUnchanged'].map(key=>[key,true]));
  return {state:{metadata,availabilityClock:'pine_source_execution_unverified_sync',bars:[{closed:true,finalOhlcVerified:true}]},evidence:{resetRequired:true,reasonCodes:['WINDOW_COHERENCE_REPRIMING'],sourceUrl:metadata.sourceUrl,bootstrapMetadata:{runId:'run-1',metadata:{...metadata}},chart:{replay:false,documentVisible:true},windowFrame:{coherent:true,checksumsVerified:true,realtime:true,sequence:101,sourceEmittedAt:10000},continuityDecisions:[{action:'COHERENCE_REPRIME',runId:'run-1',preserve:true,inactive:true,delta:1,sequence:101,sourceEmittedAt:10000,failedPreserveChecks:[],preserveChecks}]}};
}

test('only exact same-source verified benign reader continuity preserves closed knowledge, without granting readiness',()=>{
  const f=fixture();assert.equal(canPreserveWindowClosedContext(f.evidence,f.state),true);assert.equal('ready' in f.state,false);assert.equal('liveEligible' in f.state,false);
  f.evidence.reasonCodes.push('NO_FRESH_SOURCE_PACKET');assert.equal(canPreserveWindowClosedContext(f.evidence,f.state),true);
  f.evidence.windowFrame.sequence+=2;f.evidence.windowFrame.sourceEmittedAt+=200;assert.equal(canPreserveWindowClosedContext(f.evidence,f.state),true);
});

test('correction, sequence wrap, source or clock changes cannot borrow previous availability',()=>{
  for(const mutate of [f=>f.evidence.continuityDecisions[0].preserve=false,f=>f.evidence.continuityDecisions[0].delta=4096,f=>f.evidence.continuityDecisions[0].failedPreserveChecks=['observedClosedUnchanged'],f=>f.evidence.continuityDecisions[0].preserveChecks.observedClosedUnchanged=false,f=>f.evidence.bootstrapMetadata.runId='another-run',f=>f.evidence.sourceUrl+='?other=1',f=>f.evidence.bootstrapMetadata.metadata.tickSize=1,f=>f.state.availabilityClock='receiver_wall',f=>f.state.bars[0].finalOhlcVerified=false]){
    const f=fixture();mutate(f);assert.equal(canPreserveWindowClosedContext(f.evidence,f.state),false);
  }
});

test('stale continuity, mixed faults, Replay and unverified frames take the hard reset path',()=>{
  for(const mutate of [f=>f.evidence.continuityDecisions[0].sequence-=4096,f=>f.evidence.continuityDecisions[0].sourceEmittedAt++,f=>f.evidence.windowFrame.sequence++,f=>{f.evidence.windowFrame.sequence++;f.evidence.windowFrame.sourceEmittedAt+=15001;},f=>f.evidence.continuityDecisions.push({action:'CLOSED_BAR_CORRECTION'}),f=>f.evidence.reasonCodes.push('WINDOW_CLOSED_BAR_CORRECTION'),f=>f.evidence.chart.replay=true,f=>f.evidence.chart.documentVisible=false,f=>f.evidence.windowFrame.checksumsVerified=false,f=>f.evidence.windowFrame.realtime=false]){
    const f=fixture();mutate(f);assert.equal(canPreserveWindowClosedContext(f.evidence,f.state),false);
  }
});
