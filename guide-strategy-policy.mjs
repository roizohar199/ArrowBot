// Source-specific research profiles. These are explicit operational choices,
// not extracted application rules, backtest results or order authorizations.
export const GUIDE_STRATEGY_POLICY='guide_scenarios_v1';
export const GUIDE_STRATEGY_POLICY_VERSION='guide-strategy-policy-1';
export const GUIDE_CONTEXT_CHECK_IDS=Object.freeze(['STRUCTURE','KNOWN_LOCATION','EMA','FIB','TRENDLINE','SUPPLY_DEMAND','HIGHER_TIMEFRAME']);
const ordinary=['TREND_CONTINUATION','REVERSAL_AT_ZONE','RANGE_EDGE'];
const shapes=['DRAGONFLY_DOJI','GRAVESTONE_DOJI','HAMMER_SHAPE','SHOOTING_STAR_SHAPE','BULLISH_PIN_SHAPE','BEARISH_PIN_SHAPE','BULLISH_ENGULFING','BEARISH_ENGULFING','BULLISH_HARAMI','BEARISH_HARAMI','HARAMI_CROSS','TWEEZER_BOTTOM','TWEEZER_TOP','MORNING_STAR','EVENING_STAR'];
const pin=['BULLISH_PIN_SHAPE','BEARISH_PIN_SHAPE'],engulf=['BULLISH_ENGULFING','BEARISH_ENGULFING'];
const profile=(id,requiredCheckIds,sourceLines,patterns,kinds=ordinary,family=null,assumptions=[])=>({id,policy:GUIDE_STRATEGY_POLICY,definitionVersion:GUIDE_STRATEGY_POLICY_VERSION,requiredCheckIds,sourceLines,sourceKind:'original_research_definition',patterns,applicableSetupKinds:kinds,family,assumptions});
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export const GUIDE_STRATEGY_PROFILES=freeze([
  profile('CANDLE_TREND_AT_ZONE',['STRUCTURE','KNOWN_LOCATION'],[249,257],shapes,['TREND_CONTINUATION']),
  profile('CANDLE_REVERSAL_AT_ZONE',['STRUCTURE','KNOWN_LOCATION'],[111,127],shapes,['REVERSAL_AT_ZONE']),
  profile('CANDLE_RANGE_EDGE',['STRUCTURE','KNOWN_LOCATION'],[281,291],shapes,['RANGE_EDGE']),
  profile('PIN_TREND_AT_ZONE',['STRUCTURE','KNOWN_LOCATION'],[329,337],pin,['TREND_CONTINUATION']),
  profile('PIN_CONFLUENCE',['STRUCTURE','KNOWN_LOCATION','HIGHER_TIMEFRAME'],[349,357],pin,ordinary,null,['Confluence variant explicitly combines an established location with higher-timeframe context; correlated shape labels are not independent votes.']),
  profile('PIN_RANGE_EDGE',['STRUCTURE','KNOWN_LOCATION'],[369,377],pin,['RANGE_EDGE']),
  profile('ENGULFING_EMA',['STRUCTURE','EMA'],[403,411],engulf,['TREND_CONTINUATION'],null,['EMA period/slope use recorded context parameters. If proximity is disabled, this profile explicitly uses the existing tick-distance parameters with range intersection as configured.']),
  profile('ENGULFING_FIB',['STRUCTURE','FIB'],[413,421],engulf,['TREND_CONTINUATION']),
  profile('ENGULFING_TRENDLINE',['STRUCTURE','TRENDLINE'],[423,431],engulf,['TREND_CONTINUATION']),
  profile('ENGULFING_RANGE',['STRUCTURE','KNOWN_LOCATION'],[433,441],engulf,['RANGE_EDGE']),
  profile('ENGULFING_SUPPLY_DEMAND',['STRUCTURE','SUPPLY_DEMAND'],[443,453],engulf),
  profile('ENGULFING_RANGE_RECLAIM',['STRUCTURE','KNOWN_LOCATION'],[383,391],engulf,['ENGULFING_RANGE_RECLAIM'],'ENGULFING_RANGE_RECLAIM'),
  profile('HANGING_MAN_REVERSAL',['STRUCTURE','KNOWN_LOCATION'],[183,193],['HANGING_MAN_SHAPE'],['REVERSAL_AT_ZONE'],'HANGING_MAN_REVERSAL'),
  profile('INVERTED_HAMMER_REVERSAL',['STRUCTURE','KNOWN_LOCATION'],[195,203],['INVERTED_HAMMER_SHAPE'],['REVERSAL_AT_ZONE'],'INVERTED_HAMMER_REVERSAL'),
  profile('INSIDE_BREAKOUT',['STRUCTURE','KNOWN_LOCATION'],[489,507],['INSIDE_BREAKOUT'],['TREND_CONTINUATION']),
  profile('INSIDE_FALSE_BREAK',['STRUCTURE','KNOWN_LOCATION'],[509,527],['INSIDE_FALSE_BREAK']),
  profile('INSIDE_FALSE_BREAK_FIB',['STRUCTURE','FIB'],[529,537],['INSIDE_FALSE_BREAK']),
  profile('ROLE_REVERSAL_RETEST',['STRUCTURE','KNOWN_LOCATION'],[259,269],[...shapes,'HANGING_MAN_SHAPE','INVERTED_HAMMER_SHAPE'],['ROLE_REVERSAL_RETEST'],'ROLE_REVERSAL_RETEST',['One closed break of an established zone followed by a retest is the recorded original research definition.'])
]);
const byId=new Map(GUIDE_STRATEGY_PROFILES.map(p=>[p.id,p]));
const flagByCheck={KNOWN_LOCATION:'requireLocation',EMA:'requireEma',FIB:'requireFib',TRENDLINE:'requireTrendline',SUPPLY_DEMAND:'requireSupplyDemand',HIGHER_TIMEFRAME:'requireHigherTimeframe'};
export function getGuideStrategyProfile(id){return byId.get(id)??null;}
export function guideStrategyProfilesForCandidate({family=null,patternIds=[]}={}){
  return GUIDE_STRATEGY_PROFILES.filter(p=>p.family===family&&p.patterns.some(id=>patternIds.includes(id)));
}
export function guideStrategyConfig(profile,config){
  if(getGuideStrategyProfile(profile?.id)!==profile)throw TypeError('KNOWN_GUIDE_STRATEGY_PROFILE_REQUIRED');
  return {...config,...Object.fromEntries(Object.entries(flagByCheck).map(([check,flag])=>[flag,profile.requiredCheckIds.includes(check)])),minConditions:profile.requiredCheckIds.length};
}
export function describeGuideStrategyProfiles(){return GUIDE_STRATEGY_PROFILES.map(({patterns,applicableSetupKinds,family,...p})=>structuredClone(p));}
export function createGuideStrategyProof(profile,checks,{eventId,applicable}={}){
  return {policy:GUIDE_STRATEGY_POLICY,definitionVersion:GUIDE_STRATEGY_POLICY_VERSION,profileId:profile.id,requiredCheckIds:[...profile.requiredCheckIds],requiredChecks:structuredClone(checks.filter(c=>profile.requiredCheckIds.includes(c.id))),sourceEventIds:[eventId],sourceLines:[...profile.sourceLines],sourceKind:profile.sourceKind,applicable:applicable===true,assumptions:[...profile.assumptions]};
}
export function validateGuideStrategyProof(proof,{eventId,checks,patternIds,setupKind}={}){
  const profile=getGuideStrategyProfile(proof?.profileId);
  if(!profile||proof.policy!==GUIDE_STRATEGY_POLICY||proof.definitionVersion!==GUIDE_STRATEGY_POLICY_VERSION||proof.applicable!==true||proof.sourceKind!==profile.sourceKind
    ||JSON.stringify(proof.requiredCheckIds)!==JSON.stringify(profile.requiredCheckIds)||JSON.stringify(proof.sourceLines)!==JSON.stringify(profile.sourceLines)
    ||JSON.stringify(proof.sourceEventIds)!==JSON.stringify([eventId])||!Array.isArray(patternIds)||!profile.patterns.some(id=>patternIds.includes(id))||!profile.applicableSetupKinds.includes(setupKind)
    ||!Array.isArray(checks)||checks.length!==7||!Array.isArray(proof.requiredChecks)||proof.requiredChecks.length!==profile.requiredCheckIds.length)return false;
  for(const id of GUIDE_CONTEXT_CHECK_IDS){const matching=checks.filter(c=>c?.id===id);if(matching.length!==1||matching[0].required!==profile.requiredCheckIds.includes(id))return false;}
  return profile.requiredCheckIds.every(id=>{const actual=checks.find(c=>c.id===id),rows=proof.requiredChecks.filter(c=>c?.id===id);return rows.length===1&&JSON.stringify(rows[0])===JSON.stringify(actual)&&['required','enabled','available','passed'].every(k=>actual[k]===true)&&actual.state==='PASS'&&actual.pendingConfirmation!==true;});
}
