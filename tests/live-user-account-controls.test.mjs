import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveUserAccountControls,createLiveAccountControls} from '../live-user-account-controls.mjs';
import {createBrokerAccountRegistry,BROKER_ACCOUNT_REGISTRY_STORAGE_KEY as KEY} from '../broker-account-registry.mjs';

// UI/native observation component contracts only, never broker authorization.
const meta={source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,chartType:'standard',currency:'USD',tickSize:.25,pointValue:20};
const profile={id:'pa-primary',provider:'TRADOVATE',adapterId:'tradingview-account-ui',environment:'PA',nativeAccountId:'PAAPEX001-AbC',label:'PA שלי',currency:'USD',enabled:true,userManagedRisk:true};
class Node{
  constructor(tag='DIV'){this.tagName=tag;this.textContent='';this.value='';this.children=[];this.dataset={};this.hidden=false;this.disabled=false;this.open=false;this.listeners=new Map();this.modalCalls=0;}
  replaceChildren(...children){this.children=children;}addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}emit(type){return this.listeners.get(type)?.();}
  showModal(){this.modalCalls++;throw Error('User-managed analysis cannot prompt for budget approval');}close(){this.open=false;}
  set innerHTML(_){throw Error('No HTML parsing');}
}
function fixture({empty=false,environment='PA'}={}){
  const nodes=new Map(['account-profile','account-summary','account-review-badge','edit-account','new-account','account-dialog','account-storage-note'].map(id=>[id,new Node()])),access=[];
  const opened=[],window=new Node('WINDOW');window.open=(...args)=>opened.push(args);const document={defaultView:window,getElementById(id){access.push(id);if(/risk-budget|commission|slippage|point-value|max-contracts|account-costs-reviewed/.test(id))throw Error('Legacy risk form accessed');return nodes.get(id);},createElement:tag=>new Node(tag)};
  let clock=2000000,transport=null,reads=0;const model=createBrokerAccountRegistry({now:()=>clock,makeLeaseId:()=> 'component-account-instance'});
  if(!empty){assert.equal(model.upsert({...profile,environment}).ok,true);assert.equal(model.select(profile.id).ok,true);}
  const data={[KEY]:model.snapshot().registry},storage={async get(key){return {[key]:structuredClone(data[key])};},async set(values){Object.assign(data,structuredClone(values));}},invalidations=[],applied=[],nativeCalls=[];
  const observation=()=>({kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',status:'OBSERVED',provider:'TRADOVATE',nativeAccountId:profile.nativeAccountId,environment:null,environmentVerified:false,nativeIdentityVerified:true,readOnly:true,ordersCreated:false,submitted:false,synthetic:false,testOnly:false,observedAt:clock,source:{tabId:17,url:'https://www.tradingview.com/chart/LiveContract1/'}});
  const controls=createLiveUserAccountControls({document,storage,now:()=>clock,onInvalidate:reason=>invalidations.push(reason),onProfileApplied:p=>applied.push(p),readNativeAccount:async args=>{reads++;nativeCalls.push(args);return transport?transport(args):observation();}});
  return {nodes,document,window,access,controls,storage,data,model,invalidations,applied,nativeCalls,opened,observation,setTransport:fn=>{transport=fn;},reads:()=>reads,advance:ms=>{clock+=ms;},persist:()=>{data[KEY]=model.snapshot().registry;}};
}

test('user-managed controller preserves the live-account API without accessing risk inputs or opening a confirmation dialog',async()=>{
  assert.equal(createLiveAccountControls,createLiveUserAccountControls);const f=fixture();await f.controls.initialize();const before=f.controls.snapshot();
  assert.equal(before.reviewAccepted,false);assert.equal(before.draftProfile.mode,'USER_MANAGED');assert.equal(before.draftProfile.risk,null);assert.equal(before.draftProfile.pointValue,null);assert.equal(before.draftProfile.tickSize,null);assert.equal(before.draftProfile.currency,null);
  assert.equal(f.nodes.get('account-profile').disabled,false);assert.equal(f.nodes.get('edit-account').hidden,false);assert.equal(f.nodes.get('edit-account').disabled,false);assert.equal(f.nodes.get('new-account').hidden,false);assert.equal(f.nodes.get('account-dialog').hidden,true);assert.equal(f.nodes.get('account-dialog').modalCalls,0);
  assert.equal(f.nodes.get('account-storage-note').children[0].href,'execution-accounts.html');assert.equal(f.reads(),0);assert.equal(before.ordersAuthorized,false);f.controls.dispose();
});

test('fresh native PA account identity enables analysis review while its environment and broker permission remain unverified',async()=>{
  const f=fixture();await f.controls.initialize();const accepted=await f.controls.requestReview(17),snapshot=f.controls.snapshot();
  assert.equal(accepted.ok,true);assert.equal(accepted.profile.mode,'USER_MANAGED');assert.deepEqual(snapshot.brokerProfile,f.model.getSelection().profile);assert.deepEqual(f.nativeCalls,[{tabId:17}]);
  assert.equal(snapshot.review.nativeIdentityVerified,true);assert.equal(snapshot.review.environmentVerified,false);assert.equal(snapshot.review.environmentBasis,'USER_DECLARED');assert.equal(snapshot.review.brokerPermissionsVerified,false);assert.equal(snapshot.review.brokerAccountVerified,false);
  assert.equal(snapshot.review.sourceTabId,17);assert.equal(snapshot.review.sourceUrl,'https://www.tradingview.com/chart/LiveContract1/');assert.equal(snapshot.review.risk,null);assert.equal(snapshot.review.ordersAuthorized,false);assert.equal(snapshot.review.executionCapabilities.submitMarket,false);
  assert.equal(f.nodes.get('account-dialog').modalCalls,0);assert.equal(f.applied.length,1);assert.equal(snapshot.reviewAccepted,true);f.controls.dispose();
});

test('contract USD tick and point fields come only from exact observed standard NQ one-minute metadata',async()=>{
  const f=fixture();await f.controls.initialize();const accepted=await f.controls.requestReview(17);assert.equal(accepted.profile.pointValue,null);
  const result=f.controls.evaluateMetadata(meta,17);assert.equal(result.ok,true);assert.equal(result.risk,null);assert.equal(result.profile.currency,'USD');assert.equal(result.profile.tickSize,.25);assert.equal(result.profile.pointValue,20);assert.equal(result.profile.mode,'USER_MANAGED');
  assert.equal(f.controls.snapshot().review.reviewId,accepted.review.reviewId);assert.deepEqual(f.controls.snapshot().currentMetadata,meta);
  for(const key of ['riskBudget','maxContracts','commissionPerContract','slippageTicks','rewardRisk','stopLoss','takeProfit'])assert.equal(Object.hasOwn(result.profile,key),false);
  assert.equal(result.ordersAuthorized,false);f.controls.dispose();
});

test('missing profile, storage failure or disabled selected profile cannot be turned into a review by account settings',async()=>{
  const empty=fixture({empty:true});await empty.controls.initialize();assert.equal(await empty.controls.requestReview(17),null);assert.equal(empty.reads(),0);assert.equal(empty.controls.snapshot().reviewAccepted,false);empty.controls.dispose();
  const disabled=fixture();disabled.model.upsert({...profile,enabled:false});disabled.persist();await disabled.controls.initialize();assert.equal(await disabled.controls.requestReview(17),null);assert.equal(disabled.reads(),0);assert.equal(disabled.controls.snapshot().reviewAccepted,false);disabled.controls.dispose();
  const f=fixture();f.storage.get=async()=>{throw Error('storage unavailable');};await f.controls.initialize();assert.equal(await f.controls.requestReview(17),null);assert.equal(f.controls.snapshot().reason,'USER_ACCOUNT_STORAGE_UNAVAILABLE');assert.equal(f.reads(),0);f.controls.dispose();
});

test('changed native ID, provider, source URL or stale/test/missing observations never accept user-configured verification flags',async()=>{
  for(const change of [p=>{p.nativeAccountId='PAAPEX1-AbC';},p=>{p.provider='TRADINGVIEW_PAPER';},p=>{p.source.tabId=18;},p=>{p.source.url='https://www.tradingview.com/chart/Other/?changed=1';},p=>{p.source.url='https://evil.example/chart/Other/';},p=>{p.observedAt-=2001;},p=>{p.observedAt++;},p=>{p.nativeIdentityVerified=false;},p=>{delete p.kind;},p=>{p.synthetic=true;},p=>{p.testOnly=true;},p=>{p.submitted=true;},p=>{p.readOnly=false;},p=>{delete p.ordersCreated;}]){
    const f=fixture();await f.controls.initialize();f.setTransport(()=>{const value=f.observation();change(value);return value;});assert.equal(await f.controls.requestReview(17),null,change.toString());assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().ordersAuthorized,false);f.controls.dispose();
  }
});

test('all declared environments support analysis identity but genuinely attested different environments block',async()=>{
  for(const environment of ['PA','EVALUATION','LIVE','DEMO','REPLAY']){const f=fixture({environment});await f.controls.initialize();assert.equal((await f.controls.requestReview(17)).ok,true);assert.equal(f.controls.snapshot().ordersAuthorized,false);f.controls.dispose();}
  const f=fixture();await f.controls.initialize();f.setTransport(()=>({...f.observation(),environment:'DEMO',environmentVerified:true}));assert.equal(await f.controls.requestReview(17),null);assert.equal(f.controls.snapshot().reason,'USER_ACCOUNT_ENVIRONMENT_MISMATCH');f.controls.dispose();
});

test('profile edits or switching selected account during native reading invalidate the pending review',async()=>{
  const f=fixture();await f.controls.initialize();f.setTransport(()=>{const value=f.observation();f.model.upsert({...profile,label:'Edited while observing'});f.persist();return value;});
  assert.equal(await f.controls.requestReview(17),null);assert.equal(f.controls.snapshot().reason,'USER_ACCOUNT_CHANGED_DURING_REVIEW');assert.equal(f.controls.snapshot().brokerProfile.label,'Edited while observing');assert.equal(f.controls.snapshot().reviewAccepted,false);f.controls.dispose();
});

test('source metadata mismatch revokes prior review without silently applying new instrument or numeric contract defaults',async()=>{
  for(const changed of [{instrument:'CME_MINI:MNQ1!'},{timeframe:'5',timeframeMs:300000},{currency:'EUR'},{tickSize:.5},{pointValue:2},{chartType:'heikin_ashi'},{synthetic:true},{sourceUrl:'https://www.tradingview.com/chart/Other/'}]){
    const f=fixture();await f.controls.initialize();await f.controls.requestReview(17);assert.equal(f.controls.evaluateMetadata({...meta,...changed},17).ok,false);assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().draftProfile.pointValue,null);assert.equal(f.controls.evaluateMetadata(meta,17).ok,false);f.controls.dispose();
  }
  const f=fixture();await f.controls.initialize();await f.controls.requestReview(17);assert.equal(f.controls.evaluateMetadata(meta,18).ok,false);assert.equal(f.controls.snapshot().reviewAccepted,false);f.controls.dispose();
});

test('Stop, invalidation, concurrent reads and disposal cannot reuse or resurrect a former account review',async()=>{
  const f=fixture();await f.controls.initialize();const first=await f.controls.requestReview(17);f.controls.invalidate('OPERATOR_STOPPED',{notify:false});assert.equal(f.invalidations.length,0);assert.equal(f.controls.snapshot().reviewAccepted,false);
  const second=await f.controls.requestReview(17);assert.notEqual(first.review.reviewId,second.review.reviewId);f.controls.invalidate('SOURCE_CHANGED');assert.deepEqual(f.invalidations,['SOURCE_CHANGED']);
  let release;f.setTransport(()=>new Promise(resolve=>{release=resolve;}));const pending=f.controls.requestReview(17);while(!release)await Promise.resolve();assert.equal(await f.controls.requestReview(17),null);
  f.controls.dispose();release(f.observation());assert.equal(await pending,null);assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.evaluateMetadata(meta,17).ok,false);assert.equal(f.nodes.get('account-profile').listeners.size,0);
});

test('restoration never restores native verification, and hostile profile labels stay literal text',async()=>{
  const f=fixture(),hostile='<img src=x onerror=alert(1)>';f.model.upsert({...profile,label:hostile});f.persist();await f.controls.initialize();assert.equal(f.controls.snapshot().reviewAccepted,false);assert.ok(f.nodes.get('account-summary').textContent.includes(hostile));assert.equal(f.nodes.get('account-profile').children[0].textContent,hostile);
  const accepted=await f.controls.requestReview(17);accepted.review.brokerProfile.nativeAccountId='caller mutation';const s=f.controls.snapshot();s.review.profile.mode='LIVE';assert.equal(f.controls.snapshot().review.profile.mode,'USER_MANAGED');assert.equal(f.controls.snapshot().brokerProfile.nativeAccountId,profile.nativeAccountId);f.controls.dispose();
});

test('all saved profiles are selectable, disabled profiles stay unavailable, and selection persists without native verification or orders',async()=>{
  const f=fixture(),paper={...profile,id:'paper-owned',provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'Paper 000AbC',label:'פייפר שלי'},disabled={...profile,id:'disabled',nativeAccountId:'PAAPEX002',label:'לא פעיל',enabled:false};
  f.model.upsert(paper);f.model.upsert(disabled);f.persist();await f.controls.initialize();await f.controls.requestReview(17);
  const selector=f.nodes.get('account-profile');assert.equal(selector.disabled,false);assert.deepEqual(selector.children.map(n=>n.value),[profile.id,paper.id,disabled.id]);assert.equal(selector.children[2].disabled,true);
  const before=f.data[KEY].revision;selector.value=paper.id;const change=selector.emit('change');assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.invalidations.at(-1),'USER_ACCOUNT_SELECTION_CHANGED');assert.equal(selector.disabled,true);await change;
  const s=f.controls.snapshot();assert.equal(s.selectedProfileId,paper.id);assert.equal(s.brokerProfile.nativeAccountId,'Paper 000AbC');assert.equal(f.data[KEY].selectedProfileId,paper.id);assert.equal(f.data[KEY].revision,before+1);assert.equal(s.ordersAuthorized,false);assert.equal(s.reviewAccepted,false);assert.equal(s.risk,null);assert.equal(f.reads(),1);assert.equal(f.applied.at(-1).id,paper.id);assert.equal(f.applied.at(-1).risk,null);
  assert.equal(await f.controls.requestReview(17),null);assert.equal(f.controls.snapshot().reason,'USER_ACCOUNT_NATIVE_MISMATCH');f.setTransport(()=>({...f.observation(),provider:'TRADINGVIEW_PAPER',nativeAccountId:paper.nativeAccountId,environment:'DEMO',environmentVerified:true}));assert.equal((await f.controls.requestReview(17)).ok,true);assert.equal(f.controls.snapshot().ordersAuthorized,false);f.controls.dispose();
});

test('an absent selection still lists saved accounts and manager buttons open the existing page after revoking review',async()=>{
  const f=fixture();f.model.select(null);f.persist();await f.controls.initialize();assert.equal(f.nodes.get('account-profile').disabled,false);assert.deepEqual(f.nodes.get('account-profile').children.map(n=>n.value),['',profile.id]);assert.equal(f.nodes.get('edit-account').disabled,true);assert.equal(f.nodes.get('new-account').disabled,false);
  f.nodes.get('new-account').emit('click');assert.deepEqual(f.opened,[['execution-accounts.html','_blank','noopener,noreferrer']]);assert.equal(f.reads(),0);assert.equal(f.controls.snapshot().reviewAccepted,false);
  const link=f.nodes.get('account-storage-note').children[0];assert.equal(link.href,'execution-accounts.html');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');f.controls.dispose();
});

test('selection storage failure or a disabled/unknown choice never grants review or applies a replacement profile',async()=>{
  for(const mode of ['write-failure','disabled','unknown']){const f=fixture(),second={...profile,id:'other',nativeAccountId:'PAAPEX002',label:'אחר',enabled:mode!=='disabled'};f.model.upsert(second);f.persist();await f.controls.initialize();await f.controls.requestReview(17);const appliedCount=f.applied.length;if(mode==='write-failure')f.storage.set=async()=>{throw Error('unavailable');};const selector=f.nodes.get('account-profile');selector.value=mode==='unknown'?'not-saved':second.id;await selector.emit('change');assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().ordersAuthorized,false);assert.equal(f.applied.length,appliedCount);assert.equal(f.data[KEY].selectedProfileId,profile.id);assert.equal(f.reads(),1);f.controls.dispose();}
});

test('returning from the existing manager reloads saved profiles and selection but never restores native review',async()=>{
  const f=fixture();await f.controls.initialize();await f.controls.requestReview(17);const before=f.controls.snapshot().review.reviewId;await f.window.emit('focus');assert.equal(f.controls.snapshot().review.reviewId,before);assert.equal(f.invalidations.length,0);
  const next={...profile,id:'new-live',nativeAccountId:'000NewAccount',environment:'LIVE',label:'חדש'};f.model.upsert(next);f.model.select(next.id);f.persist();await f.window.emit('focus');assert.equal(f.controls.snapshot().selectedProfileId,next.id);assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().ordersAuthorized,false);assert.equal(f.nodes.get('account-profile').children.length,2);assert.equal(f.invalidations.at(-1),'USER_ACCOUNT_SELECTION_CHANGED');assert.equal(f.reads(),1);f.controls.dispose();assert.equal(f.window.listeners.size,0);
});

test('a synchronous registry-change event from the selector own storage save revokes authority without cancelling the verified selection commit',async()=>{
  const f=fixture(),paper={...profile,id:'paper-owned',provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'Paper 000AbC',label:'פייפר שלי'};
  f.model.upsert(paper);f.persist();await f.controls.initialize();await f.controls.requestReview(17);const beforeApplied=f.applied.length;let events=0;
  f.storage.set=async values=>{Object.assign(f.data,structuredClone(values));events++;f.controls.handleRegistryChange('BROKER_ACCOUNT_SELECTION_CHANGED');assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().ordersAuthorized,false);assert.equal(f.nodes.get('account-profile').value,paper.id,'pending native selector keeps its explicitly chosen value');};
  const selector=f.nodes.get('account-profile');selector.value=paper.id;await selector.emit('change');const s=f.controls.snapshot();
  assert.equal(events,1);assert.equal(s.selectedProfileId,paper.id);assert.equal(selector.value,paper.id);assert.equal(selector.disabled,false);assert.equal(s.brokerProfile.nativeAccountId,paper.nativeAccountId);assert.equal(f.data[KEY].selectedProfileId,paper.id);assert.equal(s.reviewAccepted,false);assert.equal(s.ordersAuthorized,false);assert.equal(s.executionCapabilities.submitMarket,false);assert.equal(f.applied.length,beforeApplied+1);assert.equal(f.applied.at(-1).id,paper.id);assert.equal(f.reads(),1);assert.ok(f.invalidations.includes('BROKER_ACCOUNT_SELECTION_CHANGED'));f.controls.dispose();
});

test('a competing external registry write during a local selector save cannot be accepted as its committed selection',async()=>{
  for(const stage of ['during-set','after-save-readback']){
    const f=fixture(),second={...profile,id:'other-pa',nativeAccountId:'PAAPEX002',label:'חשבון אחר'};f.model.upsert(second);f.persist();await f.controls.initialize();await f.controls.requestReview(17);const beforeApplied=f.applied.length,originalGet=f.storage.get;let wrote=false,readsAfterWrite=0;
    const externalChange=()=>{const changed=structuredClone(f.data[KEY]);changed.revision++;changed.profiles=changed.profiles.map(p=>p.id===second.id?{...p,nativeAccountId:'EXTERNALLY-CHANGED',revision:p.revision+1}:p);f.data[KEY]=changed;f.controls.handleRegistryChange('BROKER_ACCOUNT_SELECTION_CHANGED');};
    f.storage.set=async values=>{Object.assign(f.data,structuredClone(values));wrote=true;f.controls.handleRegistryChange('BROKER_ACCOUNT_SELECTION_CHANGED');if(stage==='during-set')externalChange();};
    f.storage.get=async key=>{if(wrote&&++readsAfterWrite===2&&stage==='after-save-readback')externalChange();return originalGet(key);};
    f.nodes.get('account-profile').value=second.id;await f.nodes.get('account-profile').emit('change');const s=f.controls.snapshot();
    assert.equal(s.reviewAccepted,false);assert.equal(s.ordersAuthorized,false);assert.equal(s.executionCapabilities.submitMarket,false);assert.equal(s.brokerProfile,null);assert.equal(f.applied.length,beforeApplied);assert.equal(f.reads(),1);assert.equal(f.data[KEY].profiles.find(p=>p.id===second.id).nativeAccountId,'EXTERNALLY-CHANGED');assert.match(s.reason,/USER_ACCOUNT_SELECTION_SAVE_FAILED|USER_ACCOUNT_CHANGED_DURING_REVIEW/);f.controls.dispose();
  }
});

test('registry changes outside the own selection commit still invalidate accepted and pending native reviews',async()=>{
  const f=fixture();await f.controls.initialize();await f.controls.requestReview(17);f.controls.handleRegistryChange('BROKER_ACCOUNT_SELECTION_CHANGED');assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().reason,'BROKER_ACCOUNT_SELECTION_CHANGED');
  let release;f.setTransport(()=>new Promise(resolve=>{release=resolve;}));const pending=f.controls.requestReview(17);while(!release)await Promise.resolve();f.controls.handleRegistryChange('BROKER_ACCOUNT_SELECTION_CHANGED');release(f.observation());assert.equal(await pending,null);assert.equal(f.controls.snapshot().reviewAccepted,false);assert.equal(f.controls.snapshot().ordersAuthorized,false);assert.equal(f.controls.snapshot().executionCapabilities.submitMarket,false);f.controls.dispose();
});
