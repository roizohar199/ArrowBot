import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_PROFILE_STORAGE_KEY} from '../account-profile.mjs';
import {BROKER_ACCOUNT_REGISTRY_STORAGE_KEY as key,BROKER_ACCOUNT_ENVIRONMENTS,normalizeBrokerAccountProfile,normalizeBrokerAccountRegistry,makeEmptyBrokerAccountRegistry,brokerAccountIdentityKey,createBrokerAccountRegistry,loadBrokerAccountRegistry,saveBrokerAccountRegistry} from '../broker-account-registry.mjs';
const definition=(patch={})=>({id:'pa-001',provider:'custom-broker',adapterId:'custom-api-v1',environment:'PA',nativeAccountId:'000123Ab',label:'תיק אישי',currency:'USD',enabled:true,userManagedRisk:true,...patch});
const stored=(patch={})=>({...definition(),revision:1,...patch});
const collection=(profiles=[stored()],selectedProfileId=profiles[0]?.id??null)=>({schemaVersion:1,revision:1,selectedProfileId,profiles,updatedAt:1000});
function fixture(initialState){let clock=1000,counter=0;const model=createBrokerAccountRegistry({initialState,now:()=>clock,makeLeaseId:()=>`local-lease-${++counter}`});return {model,setClock:value=>{clock=value;}};}
const addSelect=f=>{assert.equal(f.model.upsert(definition()).ok,true);assert.equal(f.model.select('pa-001').ok,true);return f.model.createPreflightLease().lease;};
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;

test('provider-neutral PA, evaluation, demo, Replay and live settings normalize without credentials, a risk budget or implied verification',()=>{
  assert.deepEqual(BROKER_ACCOUNT_ENVIRONMENTS,['REPLAY','DEMO','EVALUATION','PA','LIVE']);assert.notEqual(key,ACCOUNT_PROFILE_STORAGE_KEY);
  for(const environment of BROKER_ACCOUNT_ENVIRONMENTS){const r=normalizeBrokerAccountProfile(stored({environment,provider:'my-new-provider',adapterId:'My-Plugin:Adapter',currency:'eur'}));assert.equal(r.ok,true);assert.equal(r.profile.provider,'MY-NEW-PROVIDER');assert.equal(r.profile.adapterId,'my-plugin:adapter');assert.equal(r.profile.nativeAccountId,'000123Ab');assert.equal(r.profile.currency,'EUR');assert.equal(r.profile.userManagedRisk,true);assert.equal(r.brokerAccountVerified,false);assert.equal(r.ordersAuthorized,false);assert.ok(!Object.hasOwn(r.profile,'riskBudget'));}
  assert.notEqual(brokerAccountIdentityKey(stored({nativeAccountId:'000123Ab'})),brokerAccountIdentityKey(stored({nativeAccountId:'000123ab'})));
});

test('strict stored schemas reject secrets, forged authorization, missing identity and unsupported structural fields',()=>{
  for(const extra of ['password','token','credentials','accessToken','apiKey','verified','connected','ordersAuthorized','riskBudget','stopLoss','target']){assert.equal(normalizeBrokerAccountProfile({...stored(),[extra]:'forbidden'}).ok,false);assert.equal(normalizeBrokerAccountRegistry({...collection(),[extra]:'forbidden'}).ok,false);}
  for(const patch of [{nativeAccountId:123},{nativeAccountId:''},{provider:' '},{adapterId:''},{environment:'UNKNOWN'},{currency:'USDT'},{enabled:'true'},{userManagedRisk:false},{revision:0},{revision:1.5}])assert.equal(normalizeBrokerAccountProfile(stored(patch)).ok,false,JSON.stringify(patch));
  const accessor=stored();Object.defineProperty(accessor,'nativeAccountId',{get(){throw Error('must not read accessor');},enumerable:true});assert.equal(normalizeBrokerAccountProfile(accessor).ok,false);
  const symbol=stored();symbol[Symbol('token')]='secret';assert.equal(normalizeBrokerAccountProfile(symbol).ok,false);
});

test('registry supports many accounts with exact unique native identities and no twelve-account limit',()=>{
  const profiles=Array.from({length:256},(_,i)=>stored({id:`account-${i}`,nativeAccountId:String(i).padStart(12,'0'),environment:BROKER_ACCOUNT_ENVIRONMENTS[i%5]})),r=normalizeBrokerAccountRegistry(collection(profiles));assert.equal(r.ok,true);assert.equal(r.registry.profiles.length,256);
  for(const bad of [collection([stored(),stored({id:'different-label-same-account'})]),collection([stored(),stored({nativeAccountId:'other'})]),collection([stored({enabled:false})]),{...collection(),selectedProfileId:'absent'},{...collection(),profiles:[stored({revision:2})]}])assert.equal(normalizeBrokerAccountRegistry(bad).ok,false);
  assert.equal(normalizeBrokerAccountRegistry(collection([stored(),stored({id:'demo-same-number',environment:'DEMO'})])).ok,true);
});

test('saving and selecting any environment never authenticates an account or grants execution authority',()=>{
  for(const environment of BROKER_ACCOUNT_ENVIRONMENTS){const f=fixture();assert.equal(f.model.upsert(definition({environment})).ok,true);assert.equal(f.model.select('pa-001').ok,true);const selection=f.model.getSelection();assert.equal(selection.profile.environment,environment);assert.equal(selection.profileRevision,1);assert.equal(selection.registryRevision,2);assert.equal(selection.brokerAccountVerified,false);assert.equal(selection.ordersAuthorized,false);const r=f.model.createPreflightLease();assert.equal(r.ok,true);assert.equal(r.lease.scope,'SELECTION_CONTEXT_ONLY_NOT_NATIVE_VERIFICATION');assert.equal(f.model.validatePreflightLease(r.lease).ok,true);assert.equal(r.ordersAuthorized,false);assert.equal(r.brokerAccountVerified,false);}
});

test('profile edits and value restoration invalidate leases and advance profile revisions without mutating returned snapshots',()=>{
  for(const patch of [{label:'עריכה'},{nativeAccountId:'000456Ab'},{provider:'another-provider'},{adapterId:'another-adapter'},{currency:'EUR'},{environment:'LIVE'}]){
    const f=fixture(),lease=addSelect(f),before=f.model.getSelection();assert.equal(f.model.upsert(definition(patch)).ok,true);assert.equal(f.model.validatePreflightLease(lease).ok,false);assert.equal(f.model.getSelection().profileRevision,2);assert.notEqual(f.model.getSelection().selectionKey,before.selectionKey);assert.equal(f.model.upsert(definition()).ok,true);assert.equal(f.model.getSelection().profileRevision,3);assert.equal(f.model.validatePreflightLease(lease).ok,false);
    const view=f.model.snapshot();view.registry.profiles[0].nativeAccountId='forged';view.selection.profile.enabled=false;assert.equal(f.model.getSelection().profile.nativeAccountId,'000123Ab');assert.equal(f.model.getSelection().profile.enabled,true);
  }
});

test('switching away and back, disabling, deletion, replacement and failed edits cannot preserve a prior selection lease',()=>{
  for(const action of ['switch','disable','remove','replace','invalid']){const f=fixture(),lease=addSelect(f),old=f.model.getSelection().selectionKey;
    if(action==='switch'){f.model.upsert(definition({id:'second',nativeAccountId:'other'}));f.model.select('second');f.model.select('pa-001');}
    if(action==='disable'){f.model.upsert(definition({enabled:false}));assert.equal(f.model.getSelection(),null);assert.equal(f.model.select('pa-001').ok,false);}
    if(action==='remove'){f.model.remove('pa-001');assert.equal(f.model.getSelection(),null);}
    if(action==='replace'){assert.equal(f.model.replace(collection()).ok,true);assert.ok(f.model.snapshot().registry.revision>2);}
    if(action==='invalid'){assert.equal(f.model.upsert({...definition(),token:'no'}).ok,false);assert.notEqual(f.model.getSelection().selectionKey,old);}
    assert.equal(f.model.validatePreflightLease(lease).ok,false,action);
  }
});

test('a stale expected revision refuses account writes and invalidates pending preflight context',()=>{
  const f=fixture(),lease=addSelect(f),before=f.model.snapshot().registry;
  assert.equal(f.model.upsert(definition({nativeAccountId:'different'}),{expectedRevision:1}).ok,false);assert.deepEqual(f.model.snapshot().registry,before);assert.equal(f.model.validatePreflightLease(lease).ok,false);
  assert.equal(f.model.select(null,{expectedRevision:before.revision}).ok,true);assert.equal(f.model.getSelection(),null);
});

test('forged, expired, time-reversed, superseded and foreign-instance leases fail while dictionary order is irrelevant',()=>{
  const f=fixture(),lease=addSelect(f);assert.equal(f.model.validatePreflightLease(sorted(lease)).ok,true);
  for(const mutate of [x=>{x.id+='fake';},x=>{x.identityKey+='fake';},x=>{x.profileRevision++;},x=>{x.selectionKey+='fake';},x=>{x.ordersAuthorized=true;},x=>{x.extra='unknown';},x=>{delete x.expiresAt;}]){const forged=structuredClone(lease);mutate(forged);assert.equal(f.model.validatePreflightLease(forged).ok,false);}
  f.setClock(lease.issuedAt-1);assert.equal(f.model.validatePreflightLease(lease).ok,false);f.setClock(lease.expiresAt+1);assert.equal(f.model.validatePreflightLease(lease).ok,false);f.setClock(1000);
  const next=f.model.createPreflightLease().lease;assert.equal(f.model.validatePreflightLease(lease).ok,false);assert.equal(f.model.validatePreflightLease(next).ok,true);
  const restored=fixture(f.model.snapshot().registry);assert.equal(restored.model.validatePreflightLease(next).ok,false);
});

test('invalid or repeated lease IDs and exhausted revisions cannot wrap into reusable authority',()=>{
  const f=fixture();addSelect(f);for(const ttlMs of [0,-1,NaN,1.5])assert.equal(f.model.createPreflightLease({ttlMs}).ok,false);
  const g=createBrokerAccountRegistry({initialState:collection(),now:()=>1000,makeLeaseId:()=> 'same-id'});assert.equal(g.createPreflightLease().ok,false);
  const exhausted=fixture({...collection(),revision:Number.MAX_SAFE_INTEGER});assert.equal(exhausted.model.upsert(definition()).ok,false);assert.equal(exhausted.model.select(null).ok,false);
});

test('persistent settings round-trip through lexicographic Chrome-style storage without restoring a lease or native proof',async()=>{
  let saved={},writes=0;const storage={get:async requested=>{assert.equal(requested,key);return sorted(structuredClone(saved));},set:async value=>{writes++;saved={...saved,...JSON.parse(JSON.stringify(value))};}};
  assert.equal((await loadBrokerAccountRegistry(storage)).status,'EMPTY');const f=fixture(),lease=addSelect(f),registry=f.model.snapshot().registry;
  const result=await saveBrokerAccountRegistry(storage,registry);assert.equal(result.status,'SAVED');assert.equal(result.ordersAuthorized,false);assert.equal(writes,1);assert.deepEqual(Object.keys(saved),[key]);
  const loaded=await loadBrokerAccountRegistry(storage);assert.equal(loaded.status,'RESTORED');assert.deepEqual(loaded.registry,registry);assert.equal(loaded.brokerAccountVerified,false);
  const restored=fixture(loaded.registry);assert.equal(restored.model.getSelection().profile.nativeAccountId,'000123Ab');assert.equal(restored.model.validatePreflightLease(lease).ok,false);
  for(const field of ['password','token','accessToken','credentials']){const invalid=structuredClone(registry);invalid.profiles[0][field]='do not save';assert.equal((await saveBrokerAccountRegistry(storage,invalid)).status,'INVALID');}assert.equal(writes,1);
});

test('invalid, unavailable or tampered persistent state stays unverified and bounded',async()=>{
  assert.equal((await loadBrokerAccountRegistry(undefined)).status,'UNAVAILABLE');assert.equal((await saveBrokerAccountRegistry(undefined,makeEmptyBrokerAccountRegistry(1000))).status,'UNAVAILABLE');
  assert.equal((await loadBrokerAccountRegistry({get:async()=>({[key]:{...collection(),verified:true}})})).status,'INVALID');
  const pending={get:()=>new Promise(()=>{}),set:()=>new Promise(()=>{})};assert.equal((await loadBrokerAccountRegistry(pending,{timeoutMs:5})).status,'UNAVAILABLE');assert.equal((await saveBrokerAccountRegistry(pending,collection(),{timeoutMs:5})).status,'UNAVAILABLE');
  let raw;const tampered={set:async value=>{raw=structuredClone(value);raw[key].profiles[0].nativeAccountId='switched';},get:async()=>raw};assert.equal((await saveBrokerAccountRegistry(tampered,collection())).status,'UNAVAILABLE');
});
