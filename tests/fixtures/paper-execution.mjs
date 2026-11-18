// Synthetic component contract only. No market/complete-engine approval claim,
// actual public UI evidence, real broker, browser or order exists in this file.
import {makeTradovateDemoIntentFixture} from './tradovate-demo-intent.mjs';
export function makePaperExecutionFixture(options={}){
  const f=makeTradovateDemoIntentFixture({...options,continuous:true});
  delete f.brokerBinding;delete f.brokerSnapshot;delete f.contract;delete f.quote;
  f.fixtureScope='SYNTHETIC_PAPER_COMPONENT_CONTRACT_NOT_MARKET_OR_FULL_ENGINE_APPROVAL';
  f.alert.accountReview.profile.mode='PAPER';
  Object.assign(f.analysis,{execution:'OBSERVATION_ONLY',orderEligible:false,dataQuality:{valid:true}});
  f.brokerEvidence={status:'PAPER_UI_VERIFIED',provider:'TRADINGVIEW_PAPER',accountKey:'paper-ui:synthetic-account',observedAt:f.now-50,researchUrl:'https://www.tradingview.com/chart/research-fixture/',chartCount:1,instrument:'CME_MINI:NQ1!',timeframe:'1',replay:false,positions:[],workingOrders:[],flat:true,ticket:{symbol:'NQZ2026',mappingNotice:'Continuous futures is used for charting, but the NQZ2026 contract will be used for order placement.',quantity:1,type:'LIMIT',entry:20000,stopTicks:0,targetTicks:0,stopEnabled:false,targetEnabled:false,bid:19999.75,ask:20000,tickValue:5},ordersCreated:false};
  f.source.researchUrl=f.brokerEvidence.researchUrl;
  return f;
}
