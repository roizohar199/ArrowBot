// Provider-neutral local account settings. This registry stores no credentials
// and never authenticates an account or authorizes an order. Native adapter
// verification and execution remain separate, including for PA/EVALUATION.
export const BROKER_ACCOUNT_REGISTRY_STORAGE_KEY='arrow.brokerAccountRegistry.v1';
export const BROKER_ACCOUNT_REGISTRY_SCHEMA_VERSION=1;
export const BROKER_ACCOUNT_ENVIRONMENTS=Object.freeze(['REPLAY','DEMO','EVALUATION','PA','LIVE']);
const definitionFields=['id','provider','adapterId','environment','nativeAccountId','label','currency','enabled','userManagedRisk'];
const profileFields=[...definitionFields,'revision'],registryFields=['schemaVersion','revision','selectedProfileId','profiles','updatedAt'];
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Reflect.ownKeys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k)&&Object.getOwnPropertyDescriptor(x,k)?.get===undefined&&Object.getOwnPropertyDescriptor(x,k)?.set===undefined);
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x)&&x.trim().length>0;
const time=x=>Number.isSafeInteger(x)&&x>=0&&x<=8640000000000000,revision=x=>Number.isSafeInteger(x)&&x>=0;
const clone=x=>structuredClone(x),fail=(code,key='profile')=>({ok:false,[key]:null,reasonCodes:[code],brokerAccountVerified:false,ordersAuthorized:false});
function normalizeDefinition(raw){
  if(!exact(raw,definitionFields))return fail('BROKER_ACCOUNT_EXACT_SETTINGS_REQUIRED');
  if(!text(raw.id,160)||!/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(raw.id))return fail('BROKER_ACCOUNT_PROFILE_ID_REQUIRED');
  if(!text(raw.provider,100)||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(raw.provider.trim()))return fail('BROKER_ACCOUNT_PROVIDER_REQUIRED');
  if(!text(raw.adapterId,160)||!/^[A-Za-z][A-Za-z0-9._:-]*$/.test(raw.adapterId.trim()))return fail('BROKER_ACCOUNT_ADAPTER_ID_REQUIRED');
  if(!BROKER_ACCOUNT_ENVIRONMENTS.includes(raw.environment))return fail('BROKER_ACCOUNT_ENVIRONMENT_REQUIRED');
  if(!text(raw.nativeAccountId,512)||!text(raw.label,200))return fail('BROKER_ACCOUNT_NATIVE_ID_AND_LABEL_REQUIRED');
  if(typeof raw.currency!=='string'||!/^[A-Za-z]{3}$/.test(raw.currency.trim()))return fail('BROKER_ACCOUNT_CURRENCY_REQUIRED');
  if(typeof raw.enabled!=='boolean'||raw.userManagedRisk!==true)return fail('BROKER_ACCOUNT_USER_MANAGED_SETTINGS_REQUIRED');
  return {ok:true,profile:{id:raw.id,provider:raw.provider.trim().toUpperCase(),adapterId:raw.adapterId.trim().toLowerCase(),environment:raw.environment,nativeAccountId:raw.nativeAccountId.trim(),label:raw.label.trim(),currency:raw.currency.trim().toUpperCase(),enabled:raw.enabled,userManagedRisk:true},reasonCodes:[],brokerAccountVerified:false,ordersAuthorized:false};
}
export function normalizeBrokerAccountProfile(raw){
  if(!exact(raw,profileFields)||!revision(raw.revision)||raw.revision<1)return fail('BROKER_ACCOUNT_EXACT_STORED_PROFILE_REQUIRED');
  const definition=Object.fromEntries(definitionFields.map(k=>[k,raw[k]])),result=normalizeDefinition(definition);
  return result.ok?{...result,profile:{...result.profile,revision:raw.revision}}:result;
}
export function brokerAccountIdentityKey(profile){
  const normalized=normalizeBrokerAccountProfile(profile);if(!normalized.ok)return null;
  const p=normalized.profile;return JSON.stringify([p.provider,p.environment,p.nativeAccountId]);
}
export function normalizeBrokerAccountRegistry(raw){
  const bad=code=>fail(code,'registry');
  if(!exact(raw,registryFields)||raw.schemaVersion!==1||!revision(raw.revision)||!time(raw.updatedAt)||!Array.isArray(raw.profiles))return bad('BROKER_ACCOUNT_EXACT_REGISTRY_REQUIRED');
  // No arbitrary account-count cap. Each record still has a strict schema and
  // bounded text fields; physical storage capacity is reported by its adapter.
  const profiles=[],ids=new Set(),identities=new Set();
  for(const item of raw.profiles){const r=normalizeBrokerAccountProfile(item);if(!r.ok||r.profile.revision>raw.revision)return bad('BROKER_ACCOUNT_INVALID_STORED_PROFILE');const identity=brokerAccountIdentityKey(r.profile);
    if(ids.has(r.profile.id)||identities.has(identity))return bad('BROKER_ACCOUNT_DUPLICATE_IDENTITY');ids.add(r.profile.id);identities.add(identity);profiles.push(r.profile);}
  if(raw.selectedProfileId!==null&&(!ids.has(raw.selectedProfileId)||profiles.find(p=>p.id===raw.selectedProfileId)?.enabled!==true))return bad('BROKER_ACCOUNT_INVALID_SELECTION');
  return {ok:true,registry:{schemaVersion:1,revision:raw.revision,selectedProfileId:raw.selectedProfileId,profiles,updatedAt:raw.updatedAt},reasonCodes:[],brokerAccountVerified:false,ordersAuthorized:false};
}
export function makeEmptyBrokerAccountRegistry(updatedAt=Date.now()){
  const r=normalizeBrokerAccountRegistry({schemaVersion:1,revision:0,selectedProfileId:null,profiles:[],updatedAt});if(!r.ok)throw TypeError(r.reasonCodes[0]);return r.registry;
}
// Order-independent equality is required across Chrome storage/RPC boundaries.
const same=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]))||plain(a)&&plain(b)&&Reflect.ownKeys(a).length===Reflect.ownKeys(b).length&&Reflect.ownKeys(a).every(k=>typeof k==='string'&&Object.hasOwn(b,k)&&Object.getOwnPropertyDescriptor(a,k)?.get===undefined&&Object.getOwnPropertyDescriptor(a,k)?.set===undefined&&same(a[k],b[k]));
const defaultLeaseId=()=>{if(typeof globalThis.crypto?.randomUUID!=='function')throw Error('BROKER_ACCOUNT_LEASE_ID_UNAVAILABLE');return globalThis.crypto.randomUUID();};

export function createBrokerAccountRegistry({initialState,now=Date.now,makeLeaseId=defaultLeaseId}={}){
  if(typeof now!=='function'||typeof makeLeaseId!=='function')throw TypeError('BROKER_ACCOUNT_REGISTRY_DEPENDENCIES_REQUIRED');
  const parsed=initialState===undefined?{ok:true,registry:makeEmptyBrokerAccountRegistry(now())}:normalizeBrokerAccountRegistry(initialState);
  if(!parsed.ok)throw TypeError(parsed.reasonCodes[0]);let state=clone(parsed.registry),generation=0,lastReason='BROKER_ACCOUNT_SELECTION_REQUIRED';
  const instanceId=makeLeaseId();if(!text(instanceId,512))throw TypeError('BROKER_ACCOUNT_LEASE_ID_REQUIRED');
  const issued=new Map(),usedLeaseIds=new Set([instanceId]);
  const selected=()=>state.profiles.find(p=>p.id===state.selectedProfileId&&p.enabled)??null;
  function getSelection(){const p=selected();if(!p)return null;const identityKey=brokerAccountIdentityKey(p),selectionKey=JSON.stringify([instanceId,generation,state.revision,p.id,p.revision,identityKey,p.adapterId,p.currency,p.enabled]);
    return {profile:clone(p),profileId:p.id,profileRevision:p.revision,registryRevision:state.revision,selectionGeneration:generation,identityKey,selectionKey,brokerAccountVerified:false,ordersAuthorized:false};}
  const result=(ok,reasonCodes=[],extra={})=>({ok,registry:clone(state),selection:getSelection(),reasonCodes,brokerAccountVerified:false,ordersAuthorized:false,...extra});
  function invalidate(reason='BROKER_ACCOUNT_SELECTION_CONTEXT_INVALIDATED'){
    if(generation===Number.MAX_SAFE_INTEGER)throw Error('BROKER_ACCOUNT_REVISION_EXHAUSTED');generation++;issued.clear();lastReason=typeof reason==='string'&&/^[A-Z0-9_]{1,160}$/.test(reason)?reason:'BROKER_ACCOUNT_SELECTION_CONTEXT_INVALIDATED';return result(true);
  }
  function mutationStart(expectedRevision){invalidate('BROKER_ACCOUNT_SETTINGS_CHANGED');if(expectedRevision!==undefined&&expectedRevision!==state.revision)return 'BROKER_ACCOUNT_STALE_REGISTRY_REVISION';if(state.revision===Number.MAX_SAFE_INTEGER)return 'BROKER_ACCOUNT_REVISION_EXHAUSTED';if(!time(now()))return 'BROKER_ACCOUNT_VALID_CLOCK_REQUIRED';return null;}
  function upsert(raw,{expectedRevision}={}){
    const error=mutationStart(expectedRevision);if(error)return result(false,[error]);const normalized=normalizeDefinition(raw);if(!normalized.ok)return result(false,normalized.reasonCodes);
    const before=state.profiles.find(p=>p.id===normalized.profile.id),profile={...normalized.profile,revision:(before?.revision??0)+1};
    if(!Number.isSafeInteger(profile.revision))return result(false,['BROKER_ACCOUNT_REVISION_EXHAUSTED']);
    if(state.profiles.some(p=>p.id!==profile.id&&brokerAccountIdentityKey(p)===brokerAccountIdentityKey(profile)))return result(false,['BROKER_ACCOUNT_DUPLICATE_IDENTITY']);
    const profiles=before?state.profiles.map(p=>p.id===profile.id?profile:p):[...state.profiles,profile];
    state={...state,revision:state.revision+1,profiles,selectedProfileId:state.selectedProfileId===profile.id&&!profile.enabled?null:state.selectedProfileId,updatedAt:now()};return result(true);
  }
  function select(id,{expectedRevision}={}){
    const error=mutationStart(expectedRevision);if(error)return result(false,[error]);if(id!==null&&!state.profiles.some(p=>p.id===id&&p.enabled))return result(false,['BROKER_ACCOUNT_ENABLED_SELECTION_REQUIRED']);
    state={...state,revision:state.revision+1,selectedProfileId:id,updatedAt:now()};lastReason=id===null?'BROKER_ACCOUNT_SELECTION_REQUIRED':'BROKER_ACCOUNT_NATIVE_VERIFICATION_REQUIRED';return result(true);
  }
  function remove(id,{expectedRevision}={}){
    const error=mutationStart(expectedRevision);if(error)return result(false,[error]);if(!state.profiles.some(p=>p.id===id))return result(false,['BROKER_ACCOUNT_PROFILE_NOT_FOUND']);
    state={...state,revision:state.revision+1,selectedProfileId:state.selectedProfileId===id?null:state.selectedProfileId,profiles:state.profiles.filter(p=>p.id!==id),updatedAt:now()};return result(true);
  }
  function replace(raw,{expectedRevision}={}){
    const error=mutationStart(expectedRevision);if(error)return result(false,[error]);const normalized=normalizeBrokerAccountRegistry(raw);if(!normalized.ok)return result(false,normalized.reasonCodes);
    const next=Math.max(state.revision,normalized.registry.revision)+1;if(!Number.isSafeInteger(next))return result(false,['BROKER_ACCOUNT_REVISION_EXHAUSTED']);state={...clone(normalized.registry),revision:next,updatedAt:now()};return result(true);
  }
  function createPreflightLease({ttlMs=2000}={}){
    const selection=getSelection(),at=now();issued.clear();
    if(!selection)return result(false,['BROKER_ACCOUNT_ENABLED_SELECTION_REQUIRED'],{lease:null});
    if(!time(at)||!Number.isSafeInteger(ttlMs)||ttlMs<1||!time(at+ttlMs))return result(false,['BROKER_ACCOUNT_VALID_LEASE_TIME_REQUIRED'],{lease:null});
    let id;try{id=makeLeaseId();}catch{return result(false,['BROKER_ACCOUNT_LEASE_ID_UNAVAILABLE'],{lease:null});}
    if(!text(id,512)||usedLeaseIds.has(id))return result(false,['BROKER_ACCOUNT_UNIQUE_LEASE_ID_REQUIRED'],{lease:null});usedLeaseIds.add(id);
    const lease={schemaVersion:1,kind:'BROKER_ACCOUNT_SELECTION_LEASE',id,issuedAt:at,expiresAt:at+ttlMs,selectionKey:selection.selectionKey,registryRevision:selection.registryRevision,profileRevision:selection.profileRevision,selectionGeneration:selection.selectionGeneration,identityKey:selection.identityKey,scope:'SELECTION_CONTEXT_ONLY_NOT_NATIVE_VERIFICATION',brokerAccountVerified:false,ordersAuthorized:false};
    issued.set(id,clone(lease));return result(true,[],{lease:clone(lease)});
  }
  function validatePreflightLease(lease){
    const expected=plain(lease)?issued.get(lease.id):null,selection=getSelection(),at=now();
    if(!expected||!same(lease,expected))return result(false,['BROKER_ACCOUNT_UNKNOWN_OR_CHANGED_LEASE'],{lease:null});
    if(!selection||selection.selectionKey!==expected.selectionKey)return result(false,['BROKER_ACCOUNT_SELECTION_CHANGED'],{lease:null});
    if(!time(at)||at<expected.issuedAt||at>expected.expiresAt)return result(false,['BROKER_ACCOUNT_SELECTION_LEASE_EXPIRED'],{lease:null});
    return result(true,[],{lease:clone(expected)});
  }
  return Object.freeze({upsert,select,remove,replace,getSelection,createPreflightLease,validatePreflightLease,invalidate,snapshot:()=>result(true,[],{lastInvalidationReason:lastReason})});
}
async function bounded(operation,timeoutMs){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw TypeError('BROKER_ACCOUNT_STORAGE_TIMEOUT_REQUIRED');let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BROKER_ACCOUNT_STORAGE_TIMEOUT')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
export async function loadBrokerAccountRegistry(storage,{timeoutMs=1500}={}){
  const result=(status,registry=null,reasonCodes=[])=>({status,registry,reasonCodes,brokerAccountVerified:false,ordersAuthorized:false});
  if(typeof storage?.get!=='function')return result('UNAVAILABLE',null,['BROKER_ACCOUNT_STORAGE_REQUIRED']);
  try{const raw=(await bounded(()=>storage.get(BROKER_ACCOUNT_REGISTRY_STORAGE_KEY),timeoutMs))?.[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY];if(raw===undefined)return result('EMPTY');const normalized=normalizeBrokerAccountRegistry(raw);return result(normalized.ok?'RESTORED':'INVALID',normalized.registry,normalized.reasonCodes);}catch{return result('UNAVAILABLE',null,['BROKER_ACCOUNT_STORAGE_UNAVAILABLE']);}
}
export async function saveBrokerAccountRegistry(storage,value,{timeoutMs=1500}={}){
  const normalized=normalizeBrokerAccountRegistry(value),result=(status,reasonCodes=[])=>({status,reasonCodes,brokerAccountVerified:false,ordersAuthorized:false});if(!normalized.ok)return result('INVALID',normalized.reasonCodes);
  if(typeof storage?.set!=='function'||typeof storage?.get!=='function')return result('UNAVAILABLE',['BROKER_ACCOUNT_STORAGE_REQUIRED']);
  try{await bounded(()=>storage.set({[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:normalized.registry}),timeoutMs);const saved=await bounded(()=>storage.get(BROKER_ACCOUNT_REGISTRY_STORAGE_KEY),timeoutMs),readback=normalizeBrokerAccountRegistry(saved?.[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]);return readback.ok&&same(readback.registry,normalized.registry)?result('SAVED'):result('UNAVAILABLE',['BROKER_ACCOUNT_STORAGE_READBACK_MISMATCH']);}catch{return result('UNAVAILABLE',['BROKER_ACCOUNT_STORAGE_UNAVAILABLE']);}
}
