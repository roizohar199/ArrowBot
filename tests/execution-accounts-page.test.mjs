import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createExecutionAccountsPage} from '../execution-accounts.mjs';
import {BROKER_ACCOUNT_REGISTRY_STORAGE_KEY} from '../broker-account-registry.mjs';
import {watchBrokerAccountChanges} from '../broker-account-change-guard.mjs';
import {createExecutionAttemptLedger,buildExecutionAttemptKey,EXECUTION_ATTEMPT_STORAGE_KEY} from '../execution-attempt-ledger.mjs';
const html=fs.readFileSync(new URL('../execution-accounts.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
class Node{
  constructor(){this.value='';this.textContent='';this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.dataset={};this.listeners=new Map();}
  addEventListener(type,fn){const list=this.listeners.get(type)??[];list.push(fn);this.listeners.set(type,list);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(item=>item!==fn));}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  set innerHTML(_value){throw Error('HTML_FORBIDDEN');}
  async emit(type){for(const fn of this.listeners.get(type)??[])await fn({preventDefault(){}});}
}
function fixture({seed={},holdObservation=false,holdLedgerRead=false,locksAvailable=true}={}){
  const nodes=new Map(ids.map(id=>[id,new Node()])),doc={getElementById:id=>nodes.get(id),createElement:()=>new Node()},$=id=>nodes.get(id),data=structuredClone(seed),changes=new Set(),reads=[],storageReads=[],writes=[],lockRequests=[];
  let resolveObservation;const pending=new Promise(resolve=>{resolveObservation=resolve;});
  let resolveLedgerRead;const ledgerPending=new Promise(resolve=>{resolveLedgerRead=resolve;});
  const observation={kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',status:'OBSERVED',observedAt:10000,provider:'REPLAY_TRADING',providerLabel:'Replay Trading',nativeAccountId:'replay:77',environment:'REPLAY',environmentVerified:true,nativeIdentityVerified:true,ordersCreated:false,submitted:false,readOnly:true,synthetic:false,testOnly:false,source:{tabId:77,url:'https://www.tradingview.com/chart/Research/'}};
  const chrome={storage:{local:{async get(key){storageReads.push(key);const result={[key]:structuredClone(data[key])};if(key===EXECUTION_ATTEMPT_STORAGE_KEY&&holdLedgerRead)await ledgerPending;return result;},async set(value){writes.push(structuredClone(value));Object.assign(data,structuredClone(value));}},onChanged:{addListener(fn){changes.add(fn);},removeListener(fn){changes.delete(fn);}}},tabs:{async query(){return [{id:77,url:'https://www.tradingview.com/chart/Research/',title:'Arrow Research'}];},async get(){return {id:77,url:'https://www.tradingview.com/chart/Research/'};}},scripting:{async executeScript(command){reads.push(command);return [{result:holdObservation?await pending:structuredClone(observation)}];}}};
  const locks=locksAvailable?{request:async(name,options,operation)=>{lockRequests.push({name,options});return operation();}}:null;
  let n=0;const page=createExecutionAccountsPage({document:doc,chrome,locks,now:()=>10000,makeId:()=> 'account-'+(++n)});
  async function save({label='PA שלי',provider='TRADOVATE',environment='PA',nativeAccountId='PA-0001',adapterId='tradingview-account-ui',currency='USD',enabled=true}={}){
    for(const [id,value]of Object.entries({'execution-label':label,'execution-provider':provider,'execution-environment':environment,'execution-native-id':nativeAccountId,'execution-adapter':adapterId,'execution-currency':currency}))$(id).value=value;
    $('execution-enabled').checked=enabled;await $('execution-account-form').emit('submit');
  }
  return {page,$,data,reads,storageReads,writes,lockRequests,changes,save,observation,resolveObservation,resolveLedgerRead,async notify(value){data[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]=structuredClone(value);for(const fn of changes)fn({[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:{newValue:structuredClone(value)}},'local');await new Promise(resolve=>setImmediate(resolve));},notifyLedger(value){data[EXECUTION_ATTEMPT_STORAGE_KEY]=structuredClone(value);for(const fn of changes)fn({[EXECUTION_ATTEMPT_STORAGE_KEY]:{newValue:structuredClone(value)}},'local');}};
}

// Real ledger serialization with artificial account/order protocol observations.
// These seed records never represent a native account, request or order.
async function storedAttempts(specs){
  let data={},n=0;const storage={async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}},locks={request:async(_name,_options,operation)=>operation()},ledger=createExecutionAttemptLedger({storage,locks,now:()=>10000,ownerId:'fixture-execution-owner',makeToken:()=> 'fixture-session-token-'+(++n)});
  for(const [index,spec]of specs.entries()){
    const accountIdentity={provider:'TRADOVATE',environment:'PA',nativeAccountId:'PA-0001',...spec.accountIdentity},session=(await ledger.claimSession({accountIdentity,sessionId:'fixture-session-'+index})).session;
    const eventIdentity={eventId:spec.eventId??'event-'+index,symbol:'NQZ2026',direction:index%2?'SHORT':'LONG',confirmedAt:9000},key=buildExecutionAttemptKey({accountIdentity,eventIdentity});
    const reserved=await ledger.reserve({key,accountIdentity,eventIdentity,session,sourceIdentity:{identityKey:'public-feed:NQ',runId:'fixture-run',sensitiveExtra:'DO_NOT_RENDER_SOURCE_EXTRA'},intentBinding:{quantity:2,privateLeaseId:'DO_NOT_RENDER_PRIVATE_LEASE'}});assert.equal(reserved.ok,true);
    if(spec.filled){const proof={kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:key,status:'FILLED',binding:reserved.record.intentBinding,attributionVerified:true,nativeOrderId:'fixture-native-order-'+index,direction:eventIdentity.direction,quantity:2,fillVerified:true,
      accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...accountIdentity,observedAt:10000,origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,environmentVerified:true,connected:true,synthetic:false,testOnly:false}};assert.equal((await ledger.mark({key,session,status:'FILLED',proof})).ok,true);}
  }
  return data[EXECUTION_ATTEMPT_STORAGE_KEY];
}
test('account page opens without reading a chart, authenticating or placing orders',async()=>{assert.equal(new Set(ids).size,ids.length);const f=fixture();await f.page.initialize();assert.equal(f.reads.length,0);assert.equal(f.$('execution-source-tab').value,'');assert.equal(f.page.snapshot().selection,null);assert.equal(f.page.snapshot().ordersCreated,false);f.page.dispose();});
test('PA and new-provider account can be saved and selected without a budget or fabricated connection',async()=>{
  const f=fixture();await f.page.initialize();await f.save();let s=f.page.snapshot();assert.equal(s.selection.profile.environment,'PA');assert.equal(s.selection.profile.nativeAccountId,'PA-0001');assert.equal(s.selection.ordersAuthorized,false);assert.equal(s.inspection,null);assert.equal(s.registry.profiles[0].userManagedRisk,true);assert.equal('riskBudget' in s.registry.profiles[0],false);
  await f.$('execution-account-new').emit('click');await f.save({label:'חשבון נוסף',provider:'ANOTHER_PROVIDER',environment:'LIVE',nativeAccountId:'0002',adapterId:'another-authorized-connector'});s=f.page.snapshot();assert.equal(s.registry.profiles.length,2);assert.equal(s.selection.profile.provider,'ANOTHER_PROVIDER');assert.equal(f.reads.length,0);assert.equal(f.$('execution-connection-status').dataset.state,'NOT_CONNECTED');f.page.dispose();
});
test('explicit native account read then save then inspection remains READ_ONLY with no executable operation',async()=>{
  const f=fixture();await f.page.initialize();f.$('execution-source-tab').value='77';await f.$('execution-source-tab').emit('change');await f.$('execution-read-visible').emit('click');assert.equal(f.reads.length,1);assert.equal(f.reads[0].func.name,'readTradingViewExecutionAccount');assert.equal(f.$('execution-add-visible').disabled,false);
  await f.$('execution-add-visible').emit('click');assert.equal(f.$('execution-native-id').value,'replay:77');await f.save({label:'Replay מחקר',provider:'REPLAY_TRADING',environment:'REPLAY',nativeAccountId:'replay:77'});await f.$('execution-inspect-selected').emit('click');const s=f.page.snapshot();assert.equal(s.inspection.status,'READ_ONLY');assert.equal(s.inspection.nativeAccountVerified,true);assert.equal(s.inspection.ordersAuthorized,false);assert.equal(f.reads.length,2);assert.equal(s.ordersCreated,false);f.page.dispose();
});
test('Tradovate profile with no authorized connector is honestly NOT_CONNECTED and makes no network or UI read',async()=>{const f=fixture();await f.page.initialize();await f.save({adapterId:'tradovate-api'});f.$('execution-source-tab').value='77';await f.$('execution-source-tab').emit('change');await f.$('execution-inspect-selected').emit('click');assert.equal(f.page.snapshot().inspection.status,'NOT_CONNECTED');assert.ok(f.$('execution-account-message').textContent.includes('AUTH_CONNECTION_REQUIRED'));assert.equal(f.reads.length,0);f.page.dispose();});
test('account change while native read is pending discards old read evidence',async()=>{const f=fixture({holdObservation:true});await f.page.initialize();f.$('execution-source-tab').value='77';await f.$('execution-source-tab').emit('change');const pending=f.$('execution-read-visible').emit('click');await new Promise(resolve=>setImmediate(resolve));f.$('execution-source-tab').value='';await f.$('execution-source-tab').emit('change');f.resolveObservation(f.observation);await pending;assert.equal(f.page.snapshot().observation,null);assert.equal(f.$('execution-add-visible').disabled,true);f.page.dispose();});
test('restoring settings never restores native verification and cross-window edits revoke it',async()=>{const f=fixture();await f.page.initialize();await f.save();const saved=f.data[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY];const other=fixture({seed:{[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:saved}});await other.page.initialize();assert.equal(other.page.snapshot().selection.profile.environment,'PA');assert.equal(other.page.snapshot().inspection,null);assert.equal(other.$('execution-connection-status').dataset.state,'NOT_CONNECTED');const changed=structuredClone(saved);changed.profiles[0].label='עודכן בחלון אחר';changed.revision+=2;await other.notify(changed);assert.equal(other.page.snapshot().selection.profile.label,'עודכן בחלון אחר');assert.equal(other.page.snapshot().inspection,null);f.page.dispose();other.page.dispose();});
test('shared change guard revokes execution on account edits, selection or removal; unrelated storage changes do not revoke',()=>{const listeners=new Set(),storage={onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}},reasons=[],release=watchBrokerAccountChanges(storage,reason=>reasons.push(reason));const notify=[...listeners][0];notify({unrelated:{}},'local');notify({[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:{}},'sync');assert.equal(reasons.length,0);notify({[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:{newValue:{}}},'local');notify({[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]:{oldValue:{}}},'local');assert.deepEqual(reasons,['BROKER_ACCOUNT_SELECTION_CHANGED','BROKER_ACCOUNT_SELECTION_CHANGED']);release();assert.equal(listeners.size,0);});
test('disabled accounts persist without being selected or acquiring native proof',async()=>{const f=fixture();await f.page.initialize();await f.save({enabled:false});assert.equal(f.page.snapshot().registry.profiles.length,1);assert.equal(f.page.snapshot().registry.profiles[0].enabled,false);assert.equal(f.page.snapshot().selection,null);assert.equal(f.data[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY].profiles[0].enabled,false);f.page.dispose();});
test('removing persisted account state clears selection instead of retaining an obsolete account',async()=>{const f=fixture();await f.page.initialize();await f.save();await f.notify(undefined);assert.equal(f.page.snapshot().registry.profiles.length,0);assert.equal(f.page.snapshot().selection,null);f.page.dispose();});
test('a disabled profile can be reopened and enabled without implicitly selecting it first',async()=>{const f=fixture();await f.page.initialize();await f.save({enabled:false});const id=f.page.snapshot().registry.profiles[0].id;f.$('execution-account-select').value=id;await f.$('execution-account-select').emit('change');assert.equal(f.page.snapshot().selection,null);assert.equal(f.$('execution-account-editor').hidden,false);assert.equal(f.$('execution-enabled').checked,false);await f.save({enabled:true});assert.equal(f.page.snapshot().registry.profiles.length,1);assert.equal(f.page.snapshot().selection.profile.id,id);assert.equal(f.page.snapshot().inspection,null);f.page.dispose();});

test('saved-attempt inspection is explicit and filters exact provider, environment and native account without taking over a lease or writing storage',async()=>{
  const ledger=await storedAttempts([{}, {accountIdentity:{environment:'DEMO'}}, {accountIdentity:{provider:'OTHER_BROKER'}}, {accountIdentity:{nativeAccountId:'PA-001'}}]),f=fixture({seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:ledger}});
  await f.page.initialize();assert.equal(f.page.snapshot().savedAttempts,null);assert.equal(f.$('execution-read-saved-attempts').disabled,true);
  await f.save();assert.equal(f.storageReads.includes(EXECUTION_ATTEMPT_STORAGE_KEY),false);assert.equal(f.page.snapshot().savedAttempts,null);
  const before=structuredClone(f.data),writeCount=f.writes.length;await f.$('execution-read-saved-attempts').emit('click');
  const result=f.page.snapshot().savedAttempts;assert.equal(result.status,'RECOVERY_REQUIRED');assert.equal(result.unresolvedCount,1);assert.equal(result.totalRecords,1);
  assert.deepEqual(result.records[0].accountIdentity,{provider:'TRADOVATE',environment:'PA',nativeAccountId:'PA-0001'});assert.equal(result.records[0].status,'UNKNOWN');
  assert.equal(result.records[0].eventIdentity.eventId,'event-0');assert.deepEqual(result.records[0].sourceIdentity,{identityKey:'public-feed:NQ',runId:'fixture-run'});
  assert.equal(result.ordersInferred,false);assert.equal(result.ordersCreated,false);assert.equal(result.leaseAcquired,false);assert.equal(f.reads.length,0);
  assert.equal(f.writes.length,writeCount);assert.deepEqual(f.data,before);assert.equal(f.lockRequests.length,1);
  const exposed=JSON.stringify(result)+f.$('execution-account-evidence').textContent;for(const secret of ['DO_NOT_RENDER_SOURCE_EXTRA','DO_NOT_RENDER_PRIVATE_LEASE','fixture-session-token-'])assert.equal(exposed.includes(secret),false);
  assert.equal(f.$('execution-saved-attempt-list').children.length,1);f.page.dispose();
});

test('reopening the account page does not infer a fill or automatically read, clear or resend a durable UNKNOWN attempt',async()=>{
  const ledger=await storedAttempts([{}]),f=fixture({seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:ledger}});await f.page.initialize();await f.save();await f.$('execution-read-saved-attempts').emit('click');
  const saved=structuredClone(f.data);f.page.dispose();const reopened=fixture({seed:saved});await reopened.page.initialize();
  assert.equal(reopened.page.snapshot().savedAttempts,null);assert.equal(reopened.page.snapshot().inspection,null);assert.equal(reopened.storageReads.includes(EXECUTION_ATTEMPT_STORAGE_KEY),false);
  await reopened.$('execution-read-saved-attempts').emit('click');assert.equal(reopened.page.snapshot().savedAttempts.records[0].status,'UNKNOWN');
  assert.equal(reopened.page.snapshot().savedAttempts.ordersInferred,false);assert.equal(reopened.reads.length,0);assert.equal(reopened.writes.length,0);assert.deepEqual(reopened.data,saved);reopened.page.dispose();
});

test('historical FILLED and hostile event text remain literal stored observations without current fill or execution authorization',async()=>{
  const eventId='<img src=x onerror=submitMarket()>',ledger=await storedAttempts([{filled:true,eventId}]),f=fixture({seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:ledger}});await f.page.initialize();await f.save();await f.$('execution-read-saved-attempts').emit('click');
  const saved=f.page.snapshot().savedAttempts,card=f.$('execution-saved-attempt-list').children[0];assert.equal(saved.status,'RECOVERY_REQUIRED');assert.equal(saved.records[0].status,'FILLED');
  assert.ok(card.children[0].textContent.includes('מילוי נרשם בעבר'));assert.ok(card.children[2].textContent.includes(eventId));assert.equal(saved.records[0].nativeOrderId,'fixture-native-order-0');
  assert.equal(saved.ordersInferred,false);assert.equal(f.page.snapshot().inspection,null);assert.equal(f.page.snapshot().selection.ordersAuthorized,false);
  assert.match(f.$('execution-saved-attempt-status').textContent,/אינו אישור/);assert.equal(f.reads.length,0);f.page.dispose();
});

test('missing ledger is reported only after explicit read and cannot certify that the native account is flat or ready',async()=>{
  const f=fixture();await f.page.initialize();await f.save();assert.equal(f.page.snapshot().savedAttempts,null);await f.$('execution-read-saved-attempts').emit('click');
  const result=f.page.snapshot().savedAttempts;assert.equal(result.status,'NO_UNRESOLVED_ATTEMPTS');assert.equal(result.totalRecords,0);assert.equal(result.entryBlocked,false);
  assert.equal(result.ordersInferred,false);assert.equal(result.leaseAcquired,false);assert.equal(f.page.snapshot().selection.ordersAuthorized,false);
  assert.match(f.$('execution-saved-attempt-status').textContent,/אינה בדיקה של מצב החשבון כעת/);assert.equal(f.writes.some(value=>Object.hasOwn(value,EXECUTION_ATTEMPT_STORAGE_KEY)),false);f.page.dispose();
});

test('invalid storage and unavailable Web Locks never turn into an empty or entry-ready saved-attempt result',async()=>{
  for(const options of [{seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:{schemaVersion:1,attempts:[]}}},{locksAvailable:false}]){
    const f=fixture(options);await f.page.initialize();await f.save();const before=structuredClone(f.data);await f.$('execution-read-saved-attempts').emit('click');
    assert.equal(f.page.snapshot().savedAttempts.status,'UNAVAILABLE');assert.equal(f.page.snapshot().savedAttempts.entryBlocked,null);assert.equal(f.$('execution-saved-attempt-list').children.length,0);
    assert.deepEqual(f.data,before);assert.equal(f.reads.length,0);f.page.dispose();
  }
});

test('an account storage change during saved-attempt read discards the former account result and leaves the new selection uninspected',async()=>{
  const ledger=await storedAttempts([{}]),f=fixture({seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:ledger},holdLedgerRead:true});await f.page.initialize();await f.save();
  const pending=f.$('execution-read-saved-attempts').emit('click');await new Promise(resolve=>setImmediate(resolve));
  const changed=structuredClone(f.data[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY]);changed.profiles[0].nativeAccountId='PA-OTHER';changed.profiles[0].revision++;changed.revision++;
  await f.notify(changed);f.resolveLedgerRead();await pending;
  assert.equal(f.page.snapshot().selection.profile.nativeAccountId,'PA-OTHER');assert.equal(f.page.snapshot().savedAttempts,null);assert.equal(f.$('execution-saved-attempt-list').children.length,0);
  assert.equal(f.$('execution-saved-attempt-status').dataset.state,'NOT_CHECKED');assert.equal(f.reads.length,0);f.page.dispose();
});

test('a changed durable ledger invalidates displayed observations and waits for another explicit read without modifying claims',async()=>{
  const ledger=await storedAttempts([{}]),f=fixture({seed:{[EXECUTION_ATTEMPT_STORAGE_KEY]:ledger}});await f.page.initialize();await f.save();await f.$('execution-read-saved-attempts').emit('click');
  const readsBefore=f.storageReads.filter(key=>key===EXECUTION_ATTEMPT_STORAGE_KEY).length,writesBefore=f.writes.length;f.notifyLedger(ledger);
  assert.equal(f.page.snapshot().savedAttempts,null);assert.equal(f.$('execution-saved-attempt-list').children.length,0);
  assert.equal(f.storageReads.filter(key=>key===EXECUTION_ATTEMPT_STORAGE_KEY).length,readsBefore);assert.equal(f.writes.length,writesBefore);
  assert.deepEqual(f.data[EXECUTION_ATTEMPT_STORAGE_KEY],ledger);f.page.dispose();
});
