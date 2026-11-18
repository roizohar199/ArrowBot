import test from 'node:test';
import assert from 'node:assert/strict';
import {planGuideRisk,roundGuidePriceToTick,evaluateSignalExcursions,evaluateBarExitAmbiguity} from '../guide-risk.mjs';

// Explicit synthetic contract metadata from the guide's arithmetic exercise;
// these values are fixture inputs, not fetched or universally assumed specs.
const risk=extra=>({direction:'LONG',entry:20004.25,stop:19997.75,tickSize:.25,pointValue:20,riskBudget:260,
  commissionPerContract:0,slippageTicks:0,maxContracts:10,...extra});

test('guide exercise gives 130 risk per contract, 5 tick value and zero quantity for insufficient budget',()=>{
  const p=planGuideRisk(risk());assert.equal(p.kind,'RESEARCH_PLAN');assert.equal(p.status,'PLANNED');assert.equal(p.riskPoints,6.5);
  assert.equal(p.riskTicks,26);assert.equal(p.tickValue,5);assert.equal(p.perContractRisk,130);assert.equal(p.quantity,2);assert.equal(p.target,20017.25);
  const small=planGuideRisk(risk({riskBudget:100}));assert.equal(small.quantity,0);assert.ok(small.reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'));
  assert.equal(small.initialStop,19997.75,'budget cannot narrow the structural stop');
});

test('commission, round-trip slippage, daily allowance and contract cap all affect floored quantity',()=>{
  const cost=planGuideRisk(risk({commissionPerContract:4,slippageTicks:2,riskBudget:432}));assert.equal(cost.perContractRisk,144);assert.equal(cost.quantity,3);
  assert.equal(planGuideRisk(risk({dailyRiskRemaining:200})).quantity,1);
  assert.equal(planGuideRisk(risk({riskBudget:2000,maxContracts:2})).quantity,2);
  assert.equal(planGuideRisk(risk({dailyRiskRemaining:0})).reasonCodes[0],'DAILY_RISK_EXHAUSTED');
  assert.equal(planGuideRisk(risk({consecutiveLosses:3,maxConsecutiveLosses:3})).reasonCodes[0],'CONSECUTIVE_LOSS_LIMIT');
});

test('directional tick rounding preserves stop protection and does not inflate explicit target reward',()=>{
  const long=planGuideRisk(risk({entry:100.1,stop:98.1,target:105.1,pointValue:1,riskBudget:100,stopBufferTicks:1}));
  assert.equal(long.plannedEntry,100.25);assert.equal(long.initialStop,97.75);assert.equal(long.target,105);
  const short=planGuideRisk(risk({direction:'SHORT',entry:100.1,stop:102.1,target:95.1,pointValue:1,riskBudget:100,stopBufferTicks:1}));
  assert.equal(short.plannedEntry,100);assert.equal(short.initialStop,102.5);assert.equal(short.target,95.25);
  assert.equal(roundGuidePriceToTick(.3,.1,'UP'),.3,'float noise must not add a tick');
  assert.equal(roundGuidePriceToTick(-.11,.1,'DOWN'),-.2,'negative prices still round directionally');
  assert.ok(roundGuidePriceToTick(1000000000.000001,.000001,'UP')>1000000000,'normalization must not erase a trigger tick on a large quote');
});

test('provided gap entry recomputes risk and quantity with frozen target and never an ideal old fill',()=>{
  const common=risk({entry:100,stop:98,pointValue:20,riskBudget:500,maxContracts:20});
  const p=planGuideRisk({...common,actualEntry:101});assert.equal(p.effectiveEntry,101);assert.equal(p.riskPoints,3);assert.equal(p.perContractRisk,60);
  assert.equal(p.quantity,8);assert.equal(p.initialStop,98);assert.equal(p.target,104);assert.ok(p.reasonCodes.includes('ENTRY_REPRICED'));assert.equal(p.fillInferred,false);
  const late=planGuideRisk({...common,actualEntry:103});assert.equal(late.status,'BLOCKED');assert.equal(late.quantity,0);assert.equal(late.affordableQuantity,5);
  assert.equal(late.target,104);assert.ok(late.reasonCodes.includes('INSUFFICIENT_REWARD_RISK'));
  assert.equal(late.totalPlannedRisk,0,'a blocked plan has no allocated contracts');
});

test('structural obstacle and reward requirements reject attractive-looking but blocked plans',()=>{
  const p=planGuideRisk(risk({entry:100,stop:95,pointValue:1,riskBudget:100,obstaclePrice:108}));
  assert.equal(p.target,110);assert.equal(p.status,'BLOCKED');assert.equal(p.reasonCodes.at(-1),'OBSTACLE_BEFORE_TARGET');
  assert.equal(planGuideRisk(risk({entry:100,stop:95,pointValue:1,obstaclePrice:104})).reasonCodes.at(-1),'STRUCTURAL_ROOM_INSUFFICIENT');
  assert.equal(planGuideRisk(risk({target:20005,minRewardRisk:2})).reasonCodes.at(-1),'INSUFFICIENT_REWARD_RISK');
});

test('missing instrument specs or invalid risk configuration cannot create a usable plan',()=>{
  for(const change of [{tickSize:undefined},{pointValue:undefined},{tickSize:0},{pointValue:Infinity}])assert.equal(planGuideRisk(risk(change)).reasonCodes[0],'INSTRUMENT_METADATA_REQUIRED');
  for(const change of [{commissionPerContract:undefined},{slippageTicks:-1},{maxContracts:0},{riskBudget:NaN}])assert.equal(planGuideRisk(risk(change)).reasonCodes[0],'EXPLICIT_RISK_CONFIGURATION_REQUIRED');
  assert.equal(planGuideRisk(risk({actualEntry:20004.3})).reasonCodes[0],'ACTUAL_ENTRY_OFF_TICK');
  assert.equal(planGuideRisk(risk({stop:20005})).reasonCodes[0],'STOP_NOT_ON_PROTECTIVE_SIDE');
  assert.equal(planGuideRisk(risk({consecutiveLosses:1})).reasonCodes[0],'INVALID_CONSECUTIVE_LOSS_CONFIGURATION');
});

const bar=(index,values={})=>({openTime:index*1000,closeTime:(index+1)*1000,availableAt:(index+1)*1000,
  open:100,high:103,low:98,close:101,closed:true,...values});
const event={direction:'LONG',confirmedAt:1000,referencePrice:100};

test('excursions wait for complete available closed-bar horizon and do not use earlier bars',()=>{
  const bars=[bar(0,{high:200,low:1}),bar(1,{high:105,low:99}),bar(2,{high:104,low:97})];
  assert.equal(evaluateSignalExcursions(bars.slice(0,2),event,{horizonBars:2}).status,'PENDING');
  assert.equal(evaluateSignalExcursions(bars,event,{horizonBars:2,asOf:2500}).status,'PENDING');
  const r=evaluateSignalExcursions(bars,event,{horizonBars:2,asOf:3000});assert.equal(r.status,'AVAILABLE');assert.equal(r.mfe,5);assert.equal(r.mae,3);
  assert.equal(r.realizedPnl,null);assert.equal(r.intrabarOrderKnown,false);assert.equal(r.availableAt,3000);
  assert.equal(evaluateSignalExcursions([...bars.slice(0,2),bar(2,{closed:false})],event,{horizonBars:2}).status,'PENDING');
});

test('short excursion signs and next-open/confirmation-close references are explicit',()=>{
  const bars=[bar(0,{close:102,high:104}),bar(1,{open:103,high:106,low:99}),bar(2,{high:104,low:97})];
  const short=evaluateSignalExcursions(bars,{...event,direction:'SHORT'},{horizonBars:2,reference:'next_open'});
  assert.equal(short.referencePrice,103);assert.equal(short.mfe,6);assert.equal(short.mae,3);
  const close=evaluateSignalExcursions(bars,event,{horizonBars:2,reference:'confirmation_close'});assert.equal(close.referencePrice,102);assert.equal(close.mfe,4);assert.equal(close.mae,5);
});

test('missing intervals, malformed or reordered bars and straddling confirmation cannot silently score',()=>{
  assert.equal(evaluateSignalExcursions([bar(0),bar(2)],event,{horizonBars:1}).reasonCodes[0],'UNACKNOWLEDGED_DATA_GAP');
  assert.equal(evaluateSignalExcursions([bar(0),bar(2)],event,{horizonBars:1,allowSessionGaps:true}).status,'AVAILABLE');
  assert.equal(evaluateSignalExcursions([bar(1),bar(0)],event,{horizonBars:1}).reasonCodes[0],'INVALID_OR_UNORDERED_BARS');
  assert.equal(evaluateSignalExcursions([bar(0),bar(1,{high:99})],event,{horizonBars:1}).reasonCodes[0],'INVALID_OR_UNORDERED_BARS');
  assert.equal(evaluateSignalExcursions([bar(0),bar(1)],{...event,confirmedAt:1500},{horizonBars:1}).reasonCodes[0],'BAR_STRADDLES_CONFIRMATION');
});

test('OHLC reaching stop and target is ambiguous reachability, never a manufactured winning fill',()=>{
  const r=evaluateBarExitAmbiguity({high:105,low:97},{direction:'LONG',stop:98,target:104});
  assert.equal(r.status,'AMBIGUOUS');assert.equal(r.fillInferred,false);assert.equal(r.intrabarOrderKnown,false);
  assert.equal(evaluateBarExitAmbiguity({high:103,low:97},{direction:'LONG',stop:98,target:104}).status,'STOP_REACHED');
  assert.equal(evaluateBarExitAmbiguity({high:105,low:99},{direction:'SHORT',stop:104,target:98}).status,'STOP_REACHED');
});
