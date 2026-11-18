// Local user-entered rules only. No feed, broker, position, order, source tab
// or connection state may enter this storage contract.
export const LIVE_RULE_SETTINGS_KEY='arrow.liveOhlcRules.v1';
export const LIVE_RULE_FIELD_IDS=Object.freeze(['risk-budget','point-value','commission','slippage','max-contracts','reward-risk']);
const LEGACY_CHECK_IDS=['require-risk','require-location','require-ema','require-fib'];
export const LIVE_RULE_CHECK_IDS=Object.freeze([...LEGACY_CHECK_IDS,'require-higher-timeframe','require-trendline','enable-supply-demand','require-supply-demand']);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const numeric=/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const bounds={'risk-budget':[0,1e12,false],'point-value':[0,1e9,true],commission:[0,1e9,false],slippage:[0,1e6,false],'max-contracts':[1,1e6,false],'reward-risk':[0,1000,true]};
function exactKeys(value,keys){return plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
export function normalizeLiveRuleSettings(value){
  if(!exactKeys(value,['schemaVersion','fields','checks','savedAt'])||value.schemaVersion!==1||!Number.isSafeInteger(value.savedAt)||value.savedAt<0||!exactKeys(value.fields,LIVE_RULE_FIELD_IDS)||!(exactKeys(value.checks,LIVE_RULE_CHECK_IDS)||exactKeys(value.checks,LEGACY_CHECK_IDS)))return null;
  const fields={},checks={};
  for(const id of LIVE_RULE_FIELD_IDS){
    if(typeof value.fields[id]!=='string'||value.fields[id].length>80)return null;
    const text=value.fields[id].trim();let normalized=text;
    if(text){const number=Number(text),[min,max,exclusive]=bounds[id];if(!numeric.test(text)||!Number.isFinite(number)||number<min||number>max||exclusive&&number===min||id==='max-contracts'&&!Number.isSafeInteger(number))return null;normalized=String(number);}
    fields[id]=normalized;
  }
  for(const id of Object.keys(value.checks)){if(typeof value.checks[id]!=='boolean')return null;checks[id]=value.checks[id];}
  return {schemaVersion:1,fields,checks,savedAt:value.savedAt};
}
export function makeLiveRuleSettings(fields,checks,savedAt=Date.now()){
  const settings=normalizeLiveRuleSettings({schemaVersion:1,fields,checks,savedAt});
  if(!settings)throw TypeError('INVALID_LIVE_RULE_SETTINGS');return settings;
}
async function bounded(operation,timeoutMs){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw TypeError('INVALID_STORAGE_TIMEOUT');
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LOCAL_SETTINGS_TIMEOUT')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
export async function loadLiveRuleSettings(storage,{timeoutMs=1500}={}){
  if(typeof storage?.get!=='function')return {status:'UNAVAILABLE',settings:null};
  try{
    const values=await bounded(()=>storage.get(LIVE_RULE_SETTINGS_KEY),timeoutMs),raw=values?.[LIVE_RULE_SETTINGS_KEY];
    if(raw===undefined)return {status:'EMPTY',settings:null};
    const settings=normalizeLiveRuleSettings(raw);return {status:settings?'RESTORED':'INVALID',settings};
  }catch{return {status:'UNAVAILABLE',settings:null};}
}
export async function saveLiveRuleSettings(storage,value,{timeoutMs=1500}={}){
  const settings=normalizeLiveRuleSettings(value);if(!settings)throw TypeError('INVALID_LIVE_RULE_SETTINGS');
  if(typeof storage?.set!=='function')return {status:'UNAVAILABLE'};
  try{await bounded(()=>storage.set({[LIVE_RULE_SETTINGS_KEY]:settings}),timeoutMs);return {status:'SAVED'};}
  catch{return {status:'UNAVAILABLE'};}
}
