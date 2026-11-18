// Local, user-reviewed planning inputs. These profiles never authenticate a
// broker, identify an account, restore a feed, or authorize an order.
export const ACCOUNT_PROFILE_STORAGE_KEY='arrow.accountProfiles.v1';
export const ACCOUNT_PROFILE_LIMITS=Object.freeze({maxProfiles:12,maxStoredCharacters:32768,storageTimeoutMs:1500});
export const ACCOUNT_PROFILE_MODES=Object.freeze(['PAPER','LIVE','RESEARCH']);
const fields=['schemaVersion','id','label','brokerLabel','mode','instrument','currency','tickSize','pointValue','riskBudget','maxContracts','commissionPerContract','slippageTicks','rewardRisk','costBasis'];
const numericBounds={tickSize:[0,1e6,true],pointValue:[0,1e9,true],riskBudget:[0,1e12,true],maxContracts:[1,1e6,false],commissionPerContract:[0,1e9,false],slippageTicks:[0,1e6,false],rewardRisk:[0,1000,true]};
const numeric=/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const copy=value=>structuredClone(value);
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const validId=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/i.test(value);
const finitePositive=value=>Number.isFinite(value)&&value>0;
const equalNumber=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&(a===b||Math.abs(a-b)<=Math.max(Math.abs(a),Math.abs(b))*Number.EPSILON*8);
const canonicalInstrument=value=>typeof value==='string'&&/^[A-Z0-9_]{1,40}:[A-Z0-9][A-Z0-9._!/-]{0,99}$/.test(value);
const fail=(...reasonCodes)=>({ok:false,profile:null,reasonCodes});

function readNumber(value,key){
  if(typeof value==='string'){
    const text=value.trim();if(!text||text.length>80||!numeric.test(text))return null;value=Number(text);
  }
  const [minimum,maximum,exclusive]=numericBounds[key];
  return typeof value==='number'&&Number.isFinite(value)&&value>=minimum&&value<=maximum&&(!exclusive||value>minimum)&&(key!=='maxContracts'||Number.isSafeInteger(value))?value:null;
}

export function normalizeAccountProfile(value){
  if(!plain(value)||Object.keys(value).some(key=>!fields.includes(key))||value.schemaVersion!==1)return fail('INVALID_ACCOUNT_PROFILE');
  if(!validId(value.id))return fail('INVALID_PROFILE_ID');
  const profile={schemaVersion:1,id:value.id};
  for(const key of ['label','brokerLabel']){
    const text=value[key]??'';
    if(typeof text!=='string'||text.length>80||/[\u0000-\u001f\u007f]/.test(text))return fail('INVALID_PROFILE_LABEL');
    profile[key]=text.trim();
  }
  if(!ACCOUNT_PROFILE_MODES.includes(value.mode))return fail('ACCOUNT_MODE_REQUIRED');
  profile.mode=value.mode;
  // Require the exact standard exchange-qualified identity, not ticker suffix
  // matching or an implicit NQ/MNQ conversion.
  const instrument=typeof value.instrument==='string'?value.instrument.trim().toUpperCase():null;
  if(!canonicalInstrument(instrument))return fail('EXACT_INSTRUMENT_REQUIRED');
  profile.instrument=instrument;
  if(value.currency!=='USD')return fail('USD_CURRENCY_REQUIRED');
  profile.currency='USD';
  for(const key of Object.keys(numericBounds)){
    const number=readNumber(value[key],key);
    if(number===null)return fail(key==='commissionPerContract'?'EXPLICIT_COMMISSION_REQUIRED':key==='slippageTicks'?'EXPLICIT_SLIPPAGE_REQUIRED':'INVALID_PROFILE_'+key.toUpperCase());
    profile[key]=number;
  }
  if(value.costBasis!==undefined&&value.costBasis!=='USER_SPECIFIED')return fail('INVALID_COST_BASIS');
  profile.costBasis='USER_SPECIFIED';
  return {ok:true,profile,reasonCodes:[]};
}

export function accountProfileEngineOptions(raw){
  const normalized=normalizeAccountProfile(raw);
  if(!normalized.ok)return {ok:false,engineOptions:null,reasonCodes:normalized.reasonCodes};
  const profile=normalized.profile;
  return {ok:true,engineOptions:{risk:{riskBudget:profile.riskBudget,pointValue:profile.pointValue,maxContracts:profile.maxContracts,commissionPerContract:profile.commissionPerContract,slippageTicks:profile.slippageTicks,rewardRisk:profile.rewardRisk},config:{requireRisk:true}},reasonCodes:[]};
}

export function createAccountStartGate({now=Date.now}={}){
  if(typeof now!=='function')throw TypeError('ACCOUNT_REVIEW_CLOCK_REQUIRED');
  let accepted=null,reviewCounter=0,lastReason='ACCOUNT_REVIEW_REQUIRED';
  const result=(ok,reasonCodes=[],profile=null)=>({ok,profile:profile?copy(profile):null,review:accepted?copy(accepted):null,engineOptions:ok&&profile?accountProfileEngineOptions(profile).engineOptions:null,reasonCodes});
  function reset(reason='ACCOUNT_REVIEW_REQUIRED'){accepted=null;lastReason=String(reason).slice(0,120);return snapshot();}
  function confirm(raw,{costsReviewed=false,source='USER_CONFIRMED_SETUP',sourceTabId}={}){
    reset();const normalized=normalizeAccountProfile(raw);
    if(!normalized.ok){lastReason=normalized.reasonCodes[0];return result(false,normalized.reasonCodes);}
    if(costsReviewed!==true||source!=='USER_CONFIRMED_SETUP'){lastReason='EXPLICIT_COST_REVIEW_REQUIRED';return result(false,[lastReason]);}
    if(sourceTabId!==undefined&&(!Number.isSafeInteger(sourceTabId)||sourceTabId<1)){lastReason='INVALID_REVIEW_SOURCE_TAB';return result(false,[lastReason]);}
    const reviewedAt=now();if(!validTime(reviewedAt)){lastReason='INVALID_ACCOUNT_REVIEW_TIME';return result(false,[lastReason]);}
    const profile=normalized.profile;
    accepted={schemaVersion:1,reviewId:'local-review-'+reviewedAt+'-'+(++reviewCounter),reviewedAt,source,costBasis:'USER_SPECIFIED',sourceTabId:sourceTabId??null,profile:copy(profile),brokerAccountVerified:false,commissionVerified:false,slippageVerified:false,ordersAuthorized:false};
    lastReason='SOURCE_METADATA_REQUIRED';return result(true,[],profile);
  }
  function evaluate(raw,metadata,{sourceTabId}={}){
    if(!accepted)return result(false,[lastReason||'ACCOUNT_REVIEW_REQUIRED']);
    const normalized=normalizeAccountProfile(raw);
    if(!normalized.ok||JSON.stringify(normalized.profile)!==JSON.stringify(accepted.profile)){
      reset('ACCOUNT_PROFILE_CHANGED');return result(false,['ACCOUNT_PROFILE_CHANGED',...normalized.reasonCodes]);
    }
    const profile=normalized.profile,tab=sourceTabId??metadata?.tabId;
    if(accepted.sourceTabId!==null&&tab===undefined)return result(false,['SOURCE_METADATA_REQUIRED'],profile);
    if(accepted.sourceTabId!==null&&tab!==undefined&&tab!==accepted.sourceTabId){reset('ACCOUNT_REVIEW_SOURCE_CHANGED');return result(false,['ACCOUNT_REVIEW_SOURCE_CHANGED']);}
    if(!metadata||typeof metadata.instrument!=='string'||!finitePositive(metadata.tickSize)||!finitePositive(metadata.pointValue))return result(false,['SOURCE_METADATA_REQUIRED'],profile);
    const instrument=metadata.instrument.trim().toUpperCase(),reasons=[];
    if(instrument!==profile.instrument)reasons.push('ACCOUNT_INSTRUMENT_MISMATCH');
    if(!equalNumber(metadata.tickSize,profile.tickSize))reasons.push('ACCOUNT_TICK_SIZE_MISMATCH');
    if(!equalNumber(metadata.pointValue,profile.pointValue))reasons.push('ACCOUNT_POINT_VALUE_MISMATCH');
    if(metadata.currency!==undefined&&metadata.currency!==profile.currency)reasons.push('ACCOUNT_CURRENCY_MISMATCH');
    if(reasons.length){reset(reasons[0]);return result(false,reasons);}
    lastReason='ACCOUNT_REVIEW_ACCEPTED';return result(true,[],profile);
  }
  function snapshot(){return {review:accepted?copy(accepted):null,reviewAccepted:!!accepted,reason:lastReason,ordersAuthorized:false};}
  return {confirm,evaluate,reset,snapshot};
}

export function normalizeAccountProfileCollection(value){
  const blocked=reason=>({ok:false,collection:null,reasonCodes:[reason]});
  if(!plain(value)||Object.keys(value).length!==4||!['schemaVersion','profiles','selectedProfileId','updatedAt'].every(key=>own(value,key))||value.schemaVersion!==1||!Array.isArray(value.profiles)||value.profiles.length>ACCOUNT_PROFILE_LIMITS.maxProfiles||!validTime(value.updatedAt))return blocked('INVALID_ACCOUNT_PROFILE_COLLECTION');
  let serialized;try{serialized=JSON.stringify(value);}catch{return blocked('INVALID_ACCOUNT_PROFILE_COLLECTION');}
  if(serialized.length>ACCOUNT_PROFILE_LIMITS.maxStoredCharacters)return blocked('ACCOUNT_PROFILE_STORAGE_LIMIT');
  const profiles=[],ids=new Set();
  for(const raw of value.profiles){const normalized=normalizeAccountProfile(raw);if(!normalized.ok)return blocked('INVALID_STORED_ACCOUNT_PROFILE');if(ids.has(normalized.profile.id))return blocked('DUPLICATE_ACCOUNT_PROFILE_ID');ids.add(normalized.profile.id);profiles.push(normalized.profile);}
  if(value.selectedProfileId!==null&&(!validId(value.selectedProfileId)||!ids.has(value.selectedProfileId)))return blocked('INVALID_SELECTED_ACCOUNT_PROFILE');
  return {ok:true,collection:{schemaVersion:1,profiles,selectedProfileId:value.selectedProfileId,updatedAt:value.updatedAt},reasonCodes:[]};
}

export function makeAccountProfileCollection(profiles,selectedProfileId=null,updatedAt=Date.now()){
  const result=normalizeAccountProfileCollection({schemaVersion:1,profiles,selectedProfileId,updatedAt});
  if(!result.ok)throw TypeError(result.reasonCodes[0]);return result.collection;
}

async function bounded(operation,timeoutMs){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw TypeError('INVALID_ACCOUNT_STORAGE_TIMEOUT');
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ACCOUNT_PROFILE_STORAGE_TIMEOUT')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

export async function loadAccountProfiles(storage,{timeoutMs=ACCOUNT_PROFILE_LIMITS.storageTimeoutMs}={}){
  if(typeof storage?.get!=='function')return {status:'UNAVAILABLE',collection:null};
  try{
    const values=await bounded(()=>storage.get(ACCOUNT_PROFILE_STORAGE_KEY),timeoutMs),raw=values?.[ACCOUNT_PROFILE_STORAGE_KEY];
    if(raw===undefined)return {status:'EMPTY',collection:null};
    const result=normalizeAccountProfileCollection(raw);return {status:result.ok?'RESTORED':'INVALID',collection:result.collection};
  }catch{return {status:'UNAVAILABLE',collection:null};}
}

export async function saveAccountProfiles(storage,value,{timeoutMs=ACCOUNT_PROFILE_LIMITS.storageTimeoutMs}={}){
  const result=normalizeAccountProfileCollection(value);if(!result.ok)throw TypeError(result.reasonCodes[0]);
  if(typeof storage?.set!=='function')return {status:'UNAVAILABLE'};
  try{await bounded(()=>storage.set({[ACCOUNT_PROFILE_STORAGE_KEY]:result.collection}),timeoutMs);return {status:'SAVED'};}
  catch{return {status:'UNAVAILABLE'};}
}
