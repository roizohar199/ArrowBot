import {GUIDE_SIGNAL_DEFAULTS,GUIDE_ALL_SCENARIO_CONTEXT} from './guide-signal-engine.mjs';
import {GUIDE_STRATEGY_POLICY} from './guide-strategy-policy.mjs';
// User requested measured leniency in context thresholds. These bounded
// research choices do not change candle definitions or mandatory evidence.
export const GUIDE_USER_CONTEXT_BALANCED=Object.freeze({zoneToleranceTicks:4,emaProximityMode:'ticks',emaProximityTicks:6,rangeEdgeFraction:.25});
export function isUserManagedLiveMode(search=''){
  if(typeof search!=='string')return false;
  const parameters=new URLSearchParams(search);
  return parameters.getAll('execution').length===1&&parameters.get('execution')==='user-managed';
}
export function userManagedLiveAnalysisOptions(){
  return {risk:null,config:{...GUIDE_SIGNAL_DEFAULTS,strategyPolicy:GUIDE_STRATEGY_POLICY,requireRisk:false,
    requireLocation:true,requireEma:true,requireFib:true,requireHigherTimeframe:true,requireTrendline:true,requireSupplyDemand:true},
    contextConfig:{...GUIDE_ALL_SCENARIO_CONTEXT,supplyDemandEnabled:true,...GUIDE_USER_CONTEXT_BALANCED}};
}
