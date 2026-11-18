import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionAttemptLedger,buildExecutionAttemptKey,matchesNativeExecutionAccountEnvironment,EXECUTION_ATTEMPT_STORAGE_KEY as STORE,EXECUTION_ATTEMPT_LOCK_NAME as LOCK} from '../execution-attempt-ledger.mjs';

// Durable-storage component fixtures only. No native proof is obtained here,
// and no adapter, network, credentials or order submission is used.
const account={provider:'EXAMPLE_BROKER',environment:'DEMO',nativeAccountId:'001-AbC'};
const event=n=>({eventId:'technical-event-'+n,symbol:'EXCHANGE:NQ',direction:'LONG',confirmedAt:1000000+n});
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
function shared(initial){
  let data=initial===undefined?{}:{[STORE]:structuredClone(initial)},tail=Promise.resolve(),clock=2000000,writes=0,readTransform=x=>x,writeTransform=x=>x;
  const storage={async get(){await Promise.resolve();return readTransform(structuredClone(data));},async set(value){await Promise.resolve();writes++;data={...data,...writeTransform(structuredClone(value))};}};
  const locks={request(name,options,fn){assert.equal(name,LOCK);assert.deepEqual(options,{mode:'exclusive'});const operation=tail.then(fn);tail=operation.catch(()=>{});return operation;}};
  return {storage,locks,now:()=>clock,advance:ms=>{clock+=ms;},data:()=>structuredClone(data),writes:()=>writes,
    reader:fn=>{readTransform=fn;},writer:fn=>{writeTransform=fn;},
    instance(ownerId='window-A',options={}){let token=0;return createExecutionAttemptLedger({storage,locks,now:()=>clock,ownerId,makeToken:()=>ownerId+'-token-'+(++token),...options});}};
}
async function claim(ledger,a=account,sessionId='session-A',ttlMs=15000){const result=await ledger.claimSession({accountIdentity:a,sessionId,ttlMs});assert.equal(result.ok,true,JSON.stringify(result));return result.session;}
function request(session,n=1,a=account){const e=event(n);return {key:buildExecutionAttemptKey({accountIdentity:a,eventIdentity:e}),accountIdentity:a,eventIdentity:e,session,sourceIdentity:{identityKey:'authentic-source-binding-contract',runId:'source-run-1'},intentBinding:{quantity:3,symbol:e.symbol,direction:e.direction,eventId:e.eventId,accountIdentity:a}};}
function proof(f,r,status){
  const sample=id=>({accountIdentity:structuredClone(r.accountIdentity),sampleId:id,observedAt:f.now()-(id==='first'?2:1),positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[]}),samples=[sample('first'),sample('second')];
  return {kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:r.key,status,binding:structuredClone(r.intentBinding),attributionVerified:true,
    accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...r.accountIdentity,observedAt:f.now(),origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,environmentVerified:true,connected:true,synthetic:false,testOnly:false},
    nativeOrderId:'native-order-1',direction:r.eventIdentity.direction,quantity:r.intentBinding.quantity,fillVerified:true,closedVerified:true,cancelledVerified:true,submitted:false,noOrderVerified:true,accountInventory:samples[1],closureSamples:samples,synthetic:false,testOnly:false};
}

test('stable event keys retain exact native identity and ignore quantity, browser sessions and profile aliases',()=>{
  const e=event(1),base=buildExecutionAttemptKey({accountIdentity:account,eventIdentity:e});
  assert.equal(base,buildExecutionAttemptKey({accountIdentity:{...account,id:'alias',revision:2,quantity:9},eventIdentity:{...e,quantity:99,sessionId:'other'}}));
  for(const change of [{nativeAccountId:'1-AbC'},{nativeAccountId:'001-abc'},{provider:'OTHER'},{environment:'LIVE'}])assert.notEqual(base,buildExecutionAttemptKey({accountIdentity:{...account,...change},eventIdentity:e}));
  assert.notEqual(base,buildExecutionAttemptKey({accountIdentity:account,eventIdentity:event(2)}));
});

test('two windows cannot own one native account concurrently; a different account remains independent',async()=>{
  const f=shared(),one=f.instance(),two=f.instance('window-B'),first=await claim(one);
  assert.equal((await two.claimSession({accountIdentity:account,sessionId:'other'})).reason,'EXECUTION_LEDGER_ACCOUNT_SESSION_OWNED');
  assert.equal((await two.claimSession({accountIdentity:{...account,nativeAccountId:'002'},sessionId:'other'})).ok,true);
  assert.equal((await two.validateSession({session:first})).ok,false);
});

test('reservation is atomically persisted/read back as UNKNOWN before any dispatch and concurrent event claims never duplicate',async()=>{
  const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session),results=await Promise.all([ledger.reserve(r),ledger.reserve(r)]);
  assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.filter(x=>x.reason==='EXECUTION_EVENT_ALREADY_CONSUMED').length,1);
  assert.equal(results.find(x=>x.ok).dispatchMayProceed,true);assert.equal(f.data()[STORE].attempts[0].status,'UNKNOWN');assert.equal(f.data()[STORE].attempts[0].history[0].phase,'RESERVED_BEFORE_DISPATCH');
  assert.equal((await ledger.reserve(request(session,2))).reason,'EXECUTION_ACCOUNT_RECONCILIATION_REQUIRED');
});

test('restart and lease expiry preserve consumed UNKNOWN and permit only account recovery under a new session',async()=>{
  const f=shared(),old=f.instance(),session=await claim(old,account,'old',1000),r=request(session);await old.reserve(r);f.advance(1001);
  const restarted=f.instance('window-restarted'),recovery=await restarted.recover({accountIdentity:account});assert.equal(recovery.status,'RECOVERY_REQUIRED');assert.equal(recovery.entryBlocked,true);assert.equal(recovery.unresolved[0].key,r.key);
  const replacement=await restarted.claimSession({accountIdentity:account,sessionId:'fresh'});assert.equal(replacement.ok,true);assert.equal(replacement.entryBlocked,true);
  assert.equal((await restarted.reserve(request(replacement.session,2))).reason,'EXECUTION_ACCOUNT_RECONCILIATION_REQUIRED');assert.equal((await old.reserve(request(session,2))).ok,false);
  assert.equal((await restarted.reserve({...r,session:replacement.session})).reason,'EXECUTION_EVENT_ALREADY_CONSUMED');
});

test('renewal and release never clear consumed attempts and stale session tokens cannot reserve',async()=>{
  const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);f.advance(100);
  const renewed=await ledger.renewSession({session,ttlMs:20000});assert.equal(renewed.ok,true);assert.equal((await ledger.validateSession({session})).ok,false);
  assert.equal((await ledger.releaseSession({session:renewed.session})).unresolvedAttempts,1);assert.equal((await ledger.recover()).entryBlocked,true);
  const replacement=await claim(f.instance('new-window'));assert.equal((await ledger.reserve({...r,session:replacement})).ok,false);
});

test('attributed fill remains an account block until two distinct complete native-flat closure samples are persisted',async()=>{
  const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);
  assert.equal((await ledger.mark({key:r.key,session,status:'FILLED',proof:proof(f,r,'FILLED')})).ok,true);
  assert.equal((await ledger.reserve(request(session,2))).reason,'EXECUTION_ACCOUNT_RECONCILIATION_REQUIRED');
  const single=proof(f,r,'CLOSED');single.closureSamples=[single.closureSamples[1]];
  assert.equal((await ledger.mark({key:r.key,session,status:'CLOSED',proof:single})).reason,'EXECUTION_LEDGER_TWO_DISTINCT_FLAT_SAMPLES_REQUIRED');
  assert.equal((await ledger.mark({key:r.key,session,status:'CLOSED',proof:proof(f,r,'CLOSED')})).status,'CLOSED');
  assert.equal((await ledger.reserve(request(session,2))).ok,true);assert.equal((await ledger.reserve(r)).reason,'EXECUTION_EVENT_ALREADY_CONSUMED');
  assert.equal((await ledger.list()).records[0].history.length,3);
});

test('Tradovate user-declared environment remains explicitly unattested through attributed persistence and recovery',async()=>{
  for(const environment of ['DEMO','EVALUATION','PA','LIVE']){
    const identity={provider:'TRADOVATE',environment,nativeAccountId:'fixture-native-account'},f=shared(),ledger=f.instance(),session=await claim(ledger,identity),r=request(session,1,identity);
    await ledger.reserve(r);
    for(const status of ['FILLED','CLOSED']){
      const p=proof(f,r,status);Object.assign(p.accountEvidence,{origin:'PUBLIC_NATIVE_UI',environmentVerified:false,environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'});
      assert.equal((await ledger.mark({key:r.key,session,status,proof:p})).ok,true);
      const stored=(await ledger.list()).records[0].history.at(-1).proof.accountEvidence;
      assert.equal(stored.environmentVerified,false);assert.equal(stored.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');assert.equal(stored.nativeIdentityVerified,true);
    }
    const recovered=await f.instance('restart-observer').recover({accountIdentity:identity});
    assert.equal(recovered.ok,true);assert.equal(recovered.entryBlocked,false);assert.equal(recovered.records[0].status,'CLOSED');
    assert.equal(recovered.records[0].history[1].proof.accountEvidence.environmentVerified,false);
  }
});

test('unattested environment evidence is restricted to exact native Tradovate UI identity and explicit profile basis',async()=>{
  const identity={provider:'TRADOVATE',environment:'PA',nativeAccountId:'fixture-native-account'},native={...identity,origin:'PUBLIC_NATIVE_UI',nativeIdentityVerified:true,environmentVerified:false,environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'};
  assert.equal(matchesNativeExecutionAccountEnvironment(native,identity),true);
  for(const patch of [{provider:'TRADINGVIEW_PAPER'},{environment:'DEMO'},{nativeAccountId:'other'},{origin:'AUTHORIZED_CONNECTOR'},{nativeIdentityVerified:false},{environmentBasis:undefined},{environmentBasis:'BROKER_ATTESTED'},{environmentVerified:true}]){
    assert.equal(matchesNativeExecutionAccountEnvironment({...native,...patch},identity),false,JSON.stringify(patch));
  }
  for(const provider of ['TRADINGVIEW_PAPER','OTHER_BROKER']){
    const accountIdentity={...identity,provider};assert.equal(matchesNativeExecutionAccountEnvironment({...native,...accountIdentity},accountIdentity),false);
  }
  assert.equal(matchesNativeExecutionAccountEnvironment({...account,environmentVerified:true},account),true);
  assert.equal(matchesNativeExecutionAccountEnvironment({...account,environmentVerified:false},account),false);
  for(const patch of [{environmentBasis:undefined},{environmentBasis:'BROKER_ATTESTED'},{environmentVerified:true},{nativeIdentityVerified:false},{origin:'AUTHORIZED_CONNECTOR'}]){
    const f=shared(),ledger=f.instance(),session=await claim(ledger,identity),r=request(session,1,identity);await ledger.reserve(r);
    const p=proof(f,r,'FILLED');Object.assign(p.accountEvidence,native,patch);
    assert.equal((await ledger.mark({key:r.key,session,status:'FILLED',proof:p})).reason,'EXECUTION_LEDGER_NATIVE_ACCOUNT_PROOF_REQUIRED');
    assert.equal((await ledger.recover()).unresolved[0].status,'UNKNOWN');
  }
});

test('wrong attribution, account, quantity, incomplete inventory and stale native evidence cannot close or fill an attempt',async()=>{
  for(const [status,change] of [['FILLED',p=>{p.quantity=4;}],['FILLED',p=>{p.fillVerified=false;}],['FILLED',p=>{p.nativeOrderId='';}],['CLOSED',p=>{p.attributionVerified=false;}],['CLOSED',p=>{p.intentKey='other';}],['CLOSED',p=>{p.binding.quantity=7;}],['CLOSED',p=>{p.accountEvidence.nativeAccountId='OTHER';}],['CLOSED',p=>{p.accountEvidence.environmentVerified=false;}],['CLOSED',p=>{p.accountEvidence.observedAt-=2001;}],['CLOSED',p=>{p.accountInventory.workingOrders.push({id:'still-working'});}],[ 'CLOSED',p=>{p.accountInventory.positionsComplete=false;}],['CLOSED',p=>{p.closureSamples[1].sampleId=p.closureSamples[0].sampleId;}],['CLOSED',p=>{p.closureSamples[0].observedAt=p.closureSamples[1].observedAt;}],['CLOSED',p=>{p.synthetic=true;}]]){
    const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);const p=proof(f,r,status);change(p);assert.equal((await ledger.mark({key:r.key,session,status,proof:p})).ok,false,change.toString());assert.equal((await ledger.recover()).entryBlocked,true);
  }
});

test('CANCELLED and proven NOT_SUBMITTED release the account but retain their event forever; status cannot move backwards',async()=>{
  for(const status of ['CANCELLED','NOT_SUBMITTED']){
    const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);
    assert.equal((await ledger.mark({key:r.key,session,status,proof:proof(f,r,status)})).ok,true);assert.equal((await ledger.recover()).entryBlocked,false);
    assert.equal((await ledger.reserve(r)).reason,'EXECUTION_EVENT_ALREADY_CONSUMED');assert.equal((await ledger.mark({key:r.key,session,status:'UNKNOWN'})).reason,'EXECUTION_LEDGER_TERMINAL_ATTEMPT_RETAINED');
  }
  const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);await ledger.mark({key:r.key,session,status:'FILLED',proof:proof(f,r,'FILLED')});assert.equal((await ledger.mark({key:r.key,session,status:'UNKNOWN'})).reason,'EXECUTION_LEDGER_NONMONOTONIC_TRANSITION');
});

test('Chrome key reordering preserves exact persisted bindings; changed or missing readback never permits dispatch',async()=>{
  const f=shared();f.reader(sorted);const ledger=f.instance(),session=await claim(ledger),r=request(session);assert.equal((await ledger.reserve(r)).ok,true);
  assert.equal((await ledger.mark({key:r.key,session,status:'CLOSED',proof:proof(f,r,'CLOSED')})).ok,true);f.advance(5000);assert.equal((await ledger.list()).ok,true,'historical proof is validated at its original observation time');
  for(const change of [s=>{s.attempts[0].intentBinding.quantity=9;},s=>{delete s.attempts[0].sourceIdentity;},s=>{s.attempts[0].extra=true;},s=>{s.attempts[0].status='CLOSED';}]){
    const broken=shared(),l=broken.instance(),lease=await claim(l);broken.reader(value=>{if(value[STORE]?.attempts.length)change(value[STORE]);return value;});
    const result=await l.reserve(request(lease));assert.equal(result.ok,false);assert.equal(broken.data()[STORE].attempts[0].status,'UNKNOWN');
  }
});

test('unavailable locks, dropped storage writes, malformed history and a full ledger fail closed without deletion',async()=>{
  const absent=shared(),missing=createExecutionAttemptLedger({storage:absent.storage,ownerId:'window',makeToken:()=> 'token'});assert.equal((await missing.recover()).reason,'EXECUTION_DURABLE_LEDGER_REQUIRED');
  const dropped=shared(),l=dropped.instance(),session=await claim(l);dropped.writer(()=>({}));assert.equal((await l.reserve(request(session))).reason,'EXECUTION_LEDGER_WRITE_NOT_VERIFIED');
  const f=shared(),ledger=f.instance('window',{maxAttempts:1}),lease=await claim(ledger),r=request(lease);await ledger.reserve(r);await ledger.mark({key:r.key,session:lease,status:'CLOSED',proof:proof(f,r,'CLOSED')});assert.equal((await ledger.reserve(request(lease,2))).reason,'EXECUTION_LEDGER_CAPACITY_REACHED');
  const damaged=f.data()[STORE];damaged.attempts[0].history.at(-1).proof=null;assert.equal((await shared(damaged).instance('new',{maxAttempts:1}).recover()).ok,false);
});

test('a new owner can reconcile a recovered claim but cannot use another account flat proof or erase its identity',async()=>{
  const f=shared(),first=f.instance(),lease=await claim(first,account,'one',1000),r=request(lease);await first.reserve(r);f.advance(1001);
  const second=f.instance('window-B'),next=await claim(second),p=proof(f,r,'CLOSED');
  assert.equal((await second.mark({key:r.key,session:next,status:'CLOSED',proof:p})).ok,true);assert.equal((await second.recover()).entryBlocked,false);
  const records=(await second.list()).records;records[0].accountIdentity.nativeAccountId='mutated-copy';assert.equal((await second.list()).records[0].accountIdentity.nativeAccountId,account.nativeAccountId);
});

test('a lease expiring during reservation write cannot return dispatch authority and its durable unknown claim remains',async()=>{
  const f=shared(),ledger=f.instance(),session=await claim(ledger,account,'short',1000),original=f.storage.set;
  f.storage.set=async value=>{await original(value);f.advance(1001);};
  const result=await ledger.reserve(request(session));assert.equal(result.ok,false);assert.equal(result.reason,'EXECUTION_LEDGER_SESSION_EXPIRED_OR_CHANGED');assert.equal(f.data()[STORE].attempts[0].status,'UNKNOWN');
  assert.equal((await ledger.recover()).entryBlocked,true);
});

test('native order attribution cannot change after a working or filled proof or return to not-submitted',async()=>{
  const f=shared(),ledger=f.instance(),session=await claim(ledger),r=request(session);await ledger.reserve(r);
  assert.equal((await ledger.mark({key:r.key,session,status:'WORKING',proof:proof(f,r,'WORKING')})).ok,true);
  assert.equal((await ledger.mark({key:r.key,session,status:'NOT_SUBMITTED',proof:proof(f,r,'NOT_SUBMITTED')})).reason,'EXECUTION_LEDGER_NONMONOTONIC_TRANSITION');
  const wrong=proof(f,r,'CLOSED');wrong.nativeOrderId='unrelated-native-order';assert.equal((await ledger.mark({key:r.key,session,status:'CLOSED',proof:wrong})).reason,'EXECUTION_LEDGER_ORDER_ID_CHANGED');assert.equal((await ledger.recover()).entryBlocked,true);
});
