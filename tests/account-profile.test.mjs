import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_PROFILE_STORAGE_KEY,normalizeAccountProfile,accountProfileEngineOptions,createAccountStartGate,normalizeAccountProfileCollection,makeAccountProfileCollection,loadAccountProfiles,saveAccountProfiles} from '../account-profile.mjs';
import {planGuideRisk} from '../guide-risk.mjs';

const profile=patch=>({schemaVersion:1,id:'nq-local',label:'NQ local setup',brokerLabel:'',mode:'PAPER',instrument:'CME_MINI:NQ1!',currency:'USD',tickSize:.25,pointValue:20,riskBudget:200,maxContracts:1,commissionPerContract:6.6,slippageTicks:2,rewardRisk:2,costBasis:'USER_SPECIFIED',...patch});
const metadata={instrument:'CME_MINI:NQ1!',tickSize:.25,pointValue:20,tabId:17};
const approve=(gate,raw=profile())=>gate.confirm(raw,{costsReviewed:true,sourceTabId:17});

test('complete explicit account inputs normalize without guessing blank costs or an account identity',()=>{
  const p=normalizeAccountProfile(profile({riskBudget:'200',maxContracts:'1',commissionPerContract:'0',slippageTicks:'0'}));
  assert.equal(p.ok,true);assert.equal(p.profile.riskBudget,200);assert.equal(p.profile.maxContracts,1);assert.equal(p.profile.commissionPerContract,0);assert.equal(p.profile.slippageTicks,0);
  for(const patch of [{commissionPerContract:''},{slippageTicks:' '},{commissionPerContract:undefined},{slippageTicks:null},{riskBudget:0},{maxContracts:1.5},{pointValue:0},{tickSize:0},{commissionPerContract:-1},{slippageTicks:-1},{currency:'EUR'},{mode:'AUTO'},{instrument:'NQ1!'},{instrument:'={"symbol":"CME_MINI:NQ1!"}'}])assert.equal(normalizeAccountProfile(profile(patch)).ok,false,JSON.stringify(patch));
  for(const key of ['accountId','credentials','orders','sourceTabId','brokerToken'])assert.equal(normalizeAccountProfile({...profile(),[key]:'not allowed'}).ok,false);
  assert.equal(normalizeAccountProfile(profile({instrument:'cme_mini:nq1!'})).profile.instrument,'CME_MINI:NQ1!');
});

test('per-start review is explicit, local and never claims broker fees, slippage or orders are verified',()=>{
  const gate=createAccountStartGate({now:()=>1000});
  assert.equal(gate.evaluate(profile(),metadata).ok,false);
  assert.equal(gate.confirm(profile()).ok,false);
  const confirmed=approve(gate);assert.equal(confirmed.ok,true);assert.equal(confirmed.review.reviewedAt,1000);assert.equal(confirmed.review.source,'USER_CONFIRMED_SETUP');assert.equal(confirmed.review.costBasis,'USER_SPECIFIED');
  assert.equal(confirmed.review.brokerAccountVerified,false);assert.equal(confirmed.review.commissionVerified,false);assert.equal(confirmed.review.slippageVerified,false);assert.equal(confirmed.review.ordersAuthorized,false);
  assert.equal(gate.evaluate(profile(),null).ok,false);assert.equal(gate.snapshot().reviewAccepted,true,'missing first source metadata keeps only a pending review');
  assert.equal(gate.evaluate(profile(),{instrument:metadata.instrument,tickSize:.25,pointValue:20}).ok,false,'a review bound to a selected tab cannot silently accept a source without tab evidence');
  assert.equal(gate.snapshot().reviewAccepted,true);
  const ready=gate.evaluate(profile(),metadata,{sourceTabId:17});assert.equal(ready.ok,true);assert.equal(ready.engineOptions.config.requireRisk,true);
  ready.review.profile.riskBudget=999;assert.equal(gate.snapshot().review.profile.riskBudget,200);
});

test('stop, reload and any profile or cost modification require a fresh review even if values are later restored',()=>{
  const gate=createAccountStartGate({now:()=>1000});
  for(const patch of [{riskBudget:199},{commissionPerContract:6.61},{slippageTicks:3},{maxContracts:2},{mode:'LIVE'},{instrument:'CME_MINI:MNQ1!'},{label:'Different profile'}]){
    approve(gate);assert.equal(gate.evaluate(profile(patch),metadata).ok,false);assert.equal(gate.snapshot().reviewAccepted,false);assert.equal(gate.evaluate(profile(),metadata).ok,false);
  }
  approve(gate);gate.reset('STOPPED');assert.equal(gate.evaluate(profile(),metadata).ok,false);
  const fresh=createAccountStartGate();assert.equal(fresh.evaluate(profile(),metadata).ok,false);
  approve(gate);const id=gate.snapshot().review.reviewId;approve(gate);assert.notEqual(gate.snapshot().review.reviewId,id);
});

test('exact source symbol, point value, tick size, currency and selected tab cannot be substituted after review',()=>{
  for(const [patch,reason] of [[{instrument:'CME_MINI:MNQ1!'},'ACCOUNT_INSTRUMENT_MISMATCH'],[{instrument:'OTHER:NQ1!'},'ACCOUNT_INSTRUMENT_MISMATCH'],[{pointValue:2},'ACCOUNT_POINT_VALUE_MISMATCH'],[{tickSize:.5},'ACCOUNT_TICK_SIZE_MISMATCH'],[{currency:'EUR'},'ACCOUNT_CURRENCY_MISMATCH'],[{tabId:18},'ACCOUNT_REVIEW_SOURCE_CHANGED']]){
    const gate=createAccountStartGate();approve(gate);const result=gate.evaluate(profile(),{...metadata,...patch});assert.equal(result.ok,false);assert.ok(result.reasonCodes.includes(reason));assert.equal(gate.snapshot().reviewAccepted,false);
  }
  const tiny=profile({tickSize:1e-15}),gate=createAccountStartGate();approve(gate,tiny);
  assert.equal(gate.evaluate(tiny,{...metadata,tickSize:2e-15}).ok,false,'small tick magnitudes cannot turn a relative mismatch into absolute float tolerance');
});

test('reviewed round-trip costs fit inside the one-contract budget and one additional structural tick is rejected',()=>{
  const raw=profile(),options=accountProfileEngineOptions(raw);assert.equal(options.ok,true);assert.equal(options.engineOptions.config.requireRisk,true);
  const base={...options.engineOptions.risk,tickSize:raw.tickSize,direction:'LONG',entry:28000,stop:27991};
  const fit=planGuideRisk(base);assert.equal(fit.quantity,1);assert.equal(fit.perContractRisk,196.6);assert.equal(fit.commissionAllowance,6.6);assert.equal(fit.slippageAllowance,10);assert.equal(fit.totalPlannedRisk,196.6);
  const over=planGuideRisk({...base,stop:27990.75});assert.equal(over.quantity,0);assert.ok(over.reasonCodes.includes('RISK_BUDGET_BELOW_ONE_CONTRACT'));assert.equal(over.initialStop,27990.75);
  const short=planGuideRisk({...base,direction:'SHORT',stop:28009});assert.equal(short.quantity,1);assert.equal(short.totalPlannedRisk,196.6);
  const shortOver=planGuideRisk({...base,direction:'SHORT',stop:28009.25});assert.equal(shortOver.quantity,0);
  assert.equal(planGuideRisk({...base,commissionPerContract:200,slippageTicks:0,stop:27999.75}).quantity,0);
});

test('bounded local profile collection round-trips settings only and never restores an accepted start review',async()=>{
  const collection=makeAccountProfileCollection([profile()],profile().id,1000);let state;
  const storage={async get(key){assert.equal(key,ACCOUNT_PROFILE_STORAGE_KEY);return state;},async set(value){state=structuredClone(value);}};
  assert.equal((await loadAccountProfiles(storage)).status,'EMPTY');
  assert.equal((await saveAccountProfiles(storage,collection)).status,'SAVED');const loaded=await loadAccountProfiles(storage);assert.equal(loaded.status,'RESTORED');assert.deepEqual(loaded.collection,collection);
  assert.deepEqual(Object.keys(state),['arrow.accountProfiles.v1']);assert.equal(createAccountStartGate().evaluate(loaded.collection.profiles[0],metadata).ok,false);
  loaded.collection.profiles[0].riskBudget=999;assert.equal(state[ACCOUNT_PROFILE_STORAGE_KEY].profiles[0].riskBudget,200);
  for(const bad of [{...collection,review:{accepted:true}},{...collection,profiles:Array.from({length:13},(_,i)=>profile({id:'profile-'+i}))},{...collection,profiles:[profile(),profile()]},{...collection,selectedProfileId:'absent'},{...collection,profiles:[{...profile(),accountId:'private'}]},{...collection,schemaVersion:2}])assert.equal(normalizeAccountProfileCollection(bad).ok,false);
});

test('unavailable or invalid profile storage cannot fabricate a confirmed setup or hang the start UI',async()=>{
  assert.deepEqual(await loadAccountProfiles(undefined),{status:'UNAVAILABLE',collection:null});
  assert.equal((await loadAccountProfiles({get:async()=>({[ACCOUNT_PROFILE_STORAGE_KEY]:{schemaVersion:99}})})).status,'INVALID');
  const pending={get:()=>new Promise(()=>{}),set:()=>new Promise(()=>{})};
  assert.equal((await loadAccountProfiles(pending,{timeoutMs:5})).status,'UNAVAILABLE');
  assert.equal((await saveAccountProfiles(pending,makeAccountProfileCollection([profile()],profile().id),{timeoutMs:5})).status,'UNAVAILABLE');
  let changed=false;await assert.rejects(saveAccountProfiles({set:async()=>{changed=true;}},{schemaVersion:99}));assert.equal(changed,false);
});
