import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionSessionRunner} from '../execution-session-runner.mjs';
import {createExecutionAttemptLedger,EXECUTION_ATTEMPT_STORAGE_KEY} from '../execution-attempt-ledger.mjs';

// Synthetic connector integration only. All native/account/feed observations
// below are protocol fixtures; no brokerage account, request or click exists.
function fixture({provider='FIXTURE_CONNECTOR',environment='DEMO'}={}){
  let clock=Date.UTC(2026,10,16,14),cutoff=clock-60000,run='source-1',direction='LONG',signalEnabled=false,nativeStatus='FILLED',tail=Promise.resolve(),token=0,capture=0,data={},dispatchFailure=false,connected=true,adapterEligible=true,dropNextClosedWrite=false,prepareTransform=value=>value,ownedTransform=value=>value,ownedReadCount=0,storageWriteCount=0,dispatchTransform=value=>value;
  const accountIdentity={provider,environment,nativeAccountId:environment==='PA'?'fixture-pa-0001':'demo-0001'},binding=()=>({accountIdentity,adapterId:'fixture-adapter',accountRevision:1,selectionKey:'account-selection-1',sourceIdentity:'licensed-feed:NQ',sourceRunId:run,symbol:'NQZ2026',quantity:2});
  const verification=()=>({kind:'EXECUTION_LIFECYCLE_VERIFIED_CONTEXT_V1',...binding(),observedAt:clock,sampleId:'context-'+(++capture),connected:true,nativeAccountVerified:true,sourceVerified:true,adapterEligible,latestClosedAt:cutoff,synthetic:false,testOnly:false});
  const storage={async get(){return structuredClone(data);},async set(values){storageWriteCount++;if(dropNextClosedWrite&&values[EXECUTION_ATTEMPT_STORAGE_KEY]?.attempts.at(-1)?.status==='CLOSED'){dropNextClosedWrite=false;return;}data={...data,...structuredClone(values)};}},locks={request(_name,_options,fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
  const dispatches=[];
  function createWindow(ownerId='fixture-window',sessionId='explicit-session',resumeAfterVerifiedRecovery=false){
  const ledger=createExecutionAttemptLedger({storage,locks,now:()=>clock,ownerId,makeToken:()=> 'token-'+(++token)});
  const runner=createExecutionSessionRunner({ledger,now:()=>clock,resumeAfterVerifiedRecovery,makeSessionId:()=>sessionId,
    async readConnection(){if(!connected)throw Error('FIXTURE_DISCONNECTED');return {binding:binding(),verification:verification()};},
    async readSignal(){return signalEnabled?{status:'CONFIRMED',eventId:'event-'+cutoff,direction,symbol:'NQZ2026',sourceIdentity:'licensed-feed:NQ',sourceRunId:run,confirmedAt:cutoff,confirmationBarCloseTime:cutoff,observedAt:clock,synthetic:false,testOnly:false}:null;},
    async prepareEntry({permit}){return prepareTransform({kind:'EXECUTION_SESSION_NATIVE_PREPARATION_V1',status:'READY',binding:permit.binding,direction:permit.signal.direction,quantity:permit.binding.quantity,privateLeaseId:'fixture-private-lease',expiresAt:permit.expiresAt});},
    async dispatchEntry(value){assert.equal(data[EXECUTION_ATTEMPT_STORAGE_KEY].attempts.at(-1).status,'UNKNOWN');dispatches.push(value);if(dispatchFailure)throw Error('FIXTURE_UNCERTAIN_NETWORK_RESULT');return dispatchTransform({submitted:true},value);},
    async readOwnedState({record,lifecycle,binding:currentBinding}){
      ownedReadCount++;clock+=100;const original=record.intentBinding.binding,id='native-'+record.eventIdentity.eventId;
      const lifecycleProof={kind:'EXECUTION_LIFECYCLE_OWNED_STATE_V1',accountIdentity,adapterId:original.adapterId,sourceIdentity:original.sourceIdentity,sourceRunId:run,symbol:original.symbol,attemptKey:record.key,nativeOrderId:id,observedAt:clock,sampleId:'owned-'+(++capture),nativeAccountVerified:true,sourceVerified:true,ownershipVerified:true,accountScope:'EXACT_NATIVE_ACCOUNT',positionsComplete:true,workingOrdersComplete:true,positions:nativeStatus==='FILLED'?[{symbol:original.symbol,direction:record.eventIdentity.direction,quantity:original.quantity}]:[],workingOrders:[],status:nativeStatus,closedVerified:nativeStatus==='CLOSED',latestClosedAt:cutoff,synthetic:false,testOnly:false};
      const sample={sampleId:lifecycleProof.sampleId,observedAt:clock,latestClosedAt:cutoff,attemptKey:record.key,accountIdentity,sourceIdentity:original.sourceIdentity,sourceRunId:run,symbol:original.symbol,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],ownershipVerified:true};
      const closureSamples=[...lifecycle.closureSamples,sample];
      const ledgerProof={kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:record.key,status:nativeStatus,binding:record.intentBinding,attributionVerified:true,
        accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...accountIdentity,observedAt:clock,origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,environmentVerified:true,connected:true,synthetic:false,testOnly:false},
        nativeOrderId:id,direction:record.eventIdentity.direction,quantity:original.quantity,fillVerified:nativeStatus==='FILLED',closedVerified:nativeStatus==='CLOSED',accountInventory:sample,closureSamples,synthetic:false,testOnly:false};
      return ownedTransform({lifecycleProof,ledgerProof},{record,binding:currentBinding,lifecycle});
    }});
  return {runner,ledger};
  }
  function notSubmitted(record){return {kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:record.key,status:'NOT_SUBMITTED',binding:structuredClone(record.intentBinding),attributionVerified:true,submitted:false,noOrderVerified:true,accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...accountIdentity,observedAt:clock,origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,environmentVerified:true,connected:true,synthetic:false,testOnly:false},accountInventory:{accountIdentity,observedAt:clock,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],synthetic:false,testOnly:false}};}
  return {...createWindow(),createWindow,notSubmitted,setDispatchTransform:value=>{dispatchTransform=value;},dispatches,data:()=>structuredClone(data),ownedReads:()=>ownedReadCount,writes:()=>storageWriteCount,advance({newBar=false,newRun=false,wall=100}={}){clock+=wall;if(newBar)cutoff+=60000;if(newRun)run='source-'+(++capture);},setDirection:value=>{direction=value;},setSignal:value=>{signalEnabled=value;},setStatus:value=>{nativeStatus=value;},setConnected:value=>{connected=value;},setFailure:value=>{dispatchFailure=value;},setPrepare:value=>{prepareTransform=value;},setOwnedTransform:value=>{ownedTransform=value;},setEligible:value=>{adapterEligible=value;},dropClosedWrite:()=>{dropNextClosedWrite=true;}};
}
const pendingReconciliation=(value,{record,binding})=>({kind:'EXECUTION_SESSION_NATIVE_RECONCILIATION_PENDING_V1',pending:true,attemptKey:record.key,binding:structuredClone(binding),observedAt:value.lifecycleProof.observedAt});

test('passive pending native reconciliation retains one unresolved dispatch without inventory claims or ledger writes',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();f.setOwnedTransform(pendingReconciliation);
  const before=f.runner.snapshot(),writes=f.writes(),stored=f.data();
  for(let i=0;i<5;i++){
    f.advance({newBar:true,wall:500});const observed=await f.runner.tick();
    assert.equal(observed.status,'RECONCILIATION_REQUIRED');assert.equal(observed.reason,'NATIVE_RECONCILIATION_PENDING_NO_NEW_EVIDENCE');assert.equal(observed.running,true);
    assert.deepEqual(observed.ownedRecord,before.ownedRecord);assert.deepEqual(observed.lifecycle.ownedAttempt,before.lifecycle.ownedAttempt);assert.deepEqual(observed.lifecycle.closureSamples,[]);
    assert.equal(observed.lifecycle.entryAllowed,false);assert.equal(observed.dispatchCount,1);assert.equal(f.dispatches.length,1);assert.equal(f.writes(),writes);assert.deepEqual(f.data(),stored);
  }
  f.setConnected(false);assert.equal((await f.runner.tick()).status,'DISCONNECTED');assert.equal(f.dispatches.length,1);assert.equal(f.writes(),writes);
});

test('pending after a known fill preserves FILLED and cannot count as another closure sample',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();
  const filled=f.runner.snapshot(),writes=f.writes();f.setOwnedTransform(pendingReconciliation);f.setStatus('CLOSED');
  for(let i=0;i<3;i++){
    f.advance({wall:500});const observed=await f.runner.tick();assert.equal(observed.status,'FILLED');assert.deepEqual(observed.lifecycle.ownedAttempt,filled.lifecycle.ownedAttempt);assert.deepEqual(observed.ownedRecord,filled.ownedRecord);assert.deepEqual(observed.lifecycle.closureSamples,[]);assert.equal(f.writes(),writes);assert.equal(f.dispatches.length,1);
  }
  f.setOwnedTransform(value=>value);const first=await f.runner.tick();assert.equal(first.status,'CLOSED_VERIFYING');assert.equal(first.lifecycle.closureSamples.length,1);const closureWrites=f.writes();
  f.setOwnedTransform(pendingReconciliation);const pending=await f.runner.tick();assert.equal(pending.status,'RECONCILIATION_REQUIRED');assert.deepEqual(pending.lifecycle.closureSamples,first.lifecycle.closureSamples);assert.deepEqual(pending.lifecycle.ownedAttempt,first.lifecycle.ownedAttempt);assert.equal(f.writes(),closureWrites);assert.equal(pending.lifecycle.entryAllowed,false);
  f.setOwnedTransform(value=>value);assert.equal((await f.runner.tick()).status,'WAITING_NEXT_SIGNAL');assert.equal(f.dispatches.length,1);
});

test('malformed or mismatched pending context cannot release ownership, write ledger evidence or dispatch again',async()=>{
  const changes=[p=>{p.kind='WRONG';},p=>{p.pending=false;},p=>{p.attemptKey+='wrong';},p=>{p.binding.quantity++;},p=>{p.binding.accountIdentity.nativeAccountId='other';},p=>{p.binding.accountIdentity.extra=undefined;},p=>{p.observedAt-=2001;},p=>{p.observedAt++;},p=>{p.observedAt=NaN;},p=>{delete p.observedAt;},p=>{p.lifecycleProof={status:'CLOSED'};},p=>{p.flat=true;}];
  for(const change of changes){
    const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();const original=f.runner.snapshot().ownedRecord.key,writes=f.writes();
    f.setOwnedTransform((value,args)=>{const p=pendingReconciliation(value,args);change(p);return p;});
    const observed=await f.runner.tick();assert.equal(observed.status,'DISCONNECTED',change.toString());assert.equal(observed.reason,'EXECUTION_NATIVE_PENDING_CONTEXT_MISMATCH');assert.equal(observed.ownedRecord.key,original);assert.equal(observed.lifecycle.ownedAttempt.attemptKey,original);assert.equal(observed.lifecycle.entryAllowed,false);assert.deepEqual(observed.lifecycle.closureSamples,[]);assert.equal(f.writes(),writes);assert.equal(f.dispatches.length,1);
    assert.equal((await f.ledger.recover()).unresolved[0].status,'UNKNOWN');
  }
});

test('pending recovery uses the current binding and never restores session entry authority or renews a lease',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();f.runner.stop();f.advance({wall:16001,newRun:true,newBar:true});
  const resumed=f.createWindow('pending-recovery-window','pending-recovery-session');assert.equal((await resumed.runner.start()).status,'RECOVERY_REQUIRED');f.setOwnedTransform(pendingReconciliation);
  const writes=f.writes(),before=resumed.runner.snapshot();f.advance({wall:16001});
  const observed=await resumed.runner.tick();assert.equal(observed.status,'RECOVERY_REQUIRED');assert.equal(observed.running,true);assert.deepEqual(observed.ownedRecord,before.ownedRecord);
  // Refreshing the expired connection records the prior UNKNOWN status; the
  // passive response supplies no new owned observation or closure evidence.
  assert.deepEqual(observed.lifecycle.ownedAttempt,{...before.lifecycle.ownedAttempt,lastKnownStatus:'UNKNOWN'});assert.equal(observed.lifecycle.sessionEnabled,false);assert.equal(observed.lifecycle.entryAllowed,false);assert.equal(observed.dispatchCount,0);assert.equal(f.dispatches.length,1);assert.equal(f.writes(),writes);
});

test('synthetic Tradovate DEMO, EVALUATION, PA and LIVE dispatch approved LONG and SHORT without SL/TP or prior fill/protection proof',async()=>{
  for(const environment of ['DEMO','EVALUATION','PA','LIVE'])for(const direction of ['LONG','SHORT']){
    const f=fixture({provider:'TRADOVATE',environment});
    f.setPrepare(value=>({...value,protectionVerified:false,fillVerified:false,presetInheritanceVerified:false}));
    f.setStatus('UNKNOWN');f.setDirection(direction);
    const start=await f.runner.start();
    assert.equal(start.status,'WAITING_NEW_SIGNAL');assert.equal(start.riskManagement,'USER_MANAGED');assert.equal(start.postFillManagement,false);
    assert.equal(f.ownedReads(),0);f.setSignal(true);f.advance({newBar:true});
    const dispatched=await f.runner.tick();
    assert.equal(dispatched.status,'RECONCILIATION_REQUIRED');assert.equal(dispatched.dispatchCount,1);assert.equal(f.dispatches.length,1);assert.equal(f.ownedReads(),0);
    const command=f.dispatches[0];
    assert.equal(command.permit.binding.accountIdentity.provider,'TRADOVATE');assert.equal(command.permit.binding.accountIdentity.environment,environment);
    assert.equal(command.permit.signal.direction,direction);assert.equal(command.permit.binding.quantity,2);assert.equal(command.nativePrepared.quantity,2);
    assert.equal(command.nativePrepared.protectionVerified,false);assert.equal(command.nativePrepared.fillVerified,false);assert.equal(command.nativePrepared.presetInheritanceVerified,false);
    for(const field of ['stop','stopLoss','target','takeProfit','riskBudget','commission','slippage']){
      assert.equal(Object.hasOwn(command.permit.binding,field),false);assert.equal(Object.hasOwn(command.permit,field),false);
    }
  }
});

test('synthetic user-managed uncertain result stays owned without fill/protection proof and cannot dispatch another signal',async()=>{
  const f=fixture({provider:'TRADOVATE',environment:'PA'});f.setStatus('UNKNOWN');
  await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();
  const original=f.runner.snapshot().ownedRecord.key;
  for(let i=0;i<3;i++){
    f.advance({newBar:true});f.setDirection(i%2?'LONG':'SHORT');
    const observed=await f.runner.tick();
    assert.equal(observed.status,'UNKNOWN');assert.equal(observed.ownedRecord.key,original);
    assert.equal(observed.lifecycle.ownedAttempt.attemptKey,original);assert.equal(observed.lifecycle.entryAllowed,false);
    assert.equal(f.dispatches.length,1);assert.equal(observed.dispatchCount,1);
  }
  assert.equal(f.ownedReads(),3);assert.equal((await f.ledger.recover()).unresolved[0].status,'UNKNOWN');
  assert.equal(f.runner.snapshot().postFillManagement,false);
});

test('synthetic Tradovate native account with user-declared PA environment can reconcile and find the next signal without inventing broker attestation',async()=>{
  const f=fixture({provider:'TRADOVATE',environment:'PA'});
  f.setOwnedTransform(value=>({...value,ledgerProof:{...value.ledgerProof,accountEvidence:{...value.ledgerProof.accountEvidence,origin:'PUBLIC_NATIVE_UI',environmentVerified:false,environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'}}}));
  await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();
  assert.equal((await f.runner.tick()).status,'FILLED');
  const persisted=(await f.ledger.recover()).unresolved[0].history.at(-1).proof.accountEvidence;
  assert.equal(persisted.environmentVerified,false);assert.equal(persisted.environmentBasis,'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED');
  f.setStatus('CLOSED');assert.equal((await f.runner.tick()).status,'CLOSED_VERIFYING');assert.equal((await f.runner.tick()).status,'WAITING_NEXT_SIGNAL');
  f.advance({newBar:true});f.setDirection('SHORT');f.setStatus('FILLED');assert.equal((await f.runner.tick()).status,'RECONCILIATION_REQUIRED');
  assert.equal(f.dispatches.length,2);assert.equal(f.dispatches[1].permit.signal.direction,'SHORT');
});

test('synthetic session starts with a baseline, dispatches a new LONG once, and returns to next-signal search only after two closed observations',async()=>{
  const f=fixture();assert.equal((await f.runner.tick()).status,'INACTIVE');assert.equal((await f.runner.start()).status,'WAITING_NEW_SIGNAL');
  f.setSignal(true);await f.runner.tick();assert.equal(f.dispatches.length,0);
  f.advance({newBar:true});assert.equal((await f.runner.tick()).status,'RECONCILIATION_REQUIRED');assert.equal(f.dispatches.length,1);assert.equal(f.dispatches[0].permit.binding.quantity,2);
  assert.equal((await f.runner.tick()).status,'FILLED');f.setStatus('CLOSED');assert.equal((await f.runner.tick()).status,'CLOSED_VERIFYING');assert.equal((await f.runner.tick()).status,'WAITING_NEXT_SIGNAL');
  assert.equal((await f.ledger.recover()).entryBlocked,false);await f.runner.tick();assert.equal(f.dispatches.length,1);
  f.advance({newBar:true});f.setDirection('SHORT');f.setStatus('FILLED');assert.equal((await f.runner.tick()).status,'RECONCILIATION_REQUIRED');assert.equal(f.dispatches.length,2);assert.equal(f.dispatches[1].permit.signal.direction,'SHORT');
});
test('synthetic disconnect/reconnect retains the owned attempt and never resends an uncertain Market dispatch',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});f.setFailure(true);assert.equal((await f.runner.tick()).status,'DISCONNECTED');assert.equal(f.dispatches.length,1);
  f.setConnected(false);await f.runner.tick();f.advance({wall:16000,newRun:true,newBar:true});f.setConnected(true);f.setFailure(false);
  assert.equal((await f.runner.tick()).status,'FILLED');assert.equal(f.dispatches.length,1);assert.equal(f.runner.snapshot().lifecycle.ownedAttempt.signal.direction,'LONG');
});
test('synthetic read-only/unverified connection cannot start a session or consume an event',async()=>{
  const f=fixture();f.setConnected(false);assert.equal((await f.runner.start()).status,'NOT_READY');f.setSignal(true);f.advance({newBar:true});await f.runner.tick();assert.equal(f.dispatches.length,0);assert.equal((await f.ledger.recover()).unresolved.length,0);
});
test('synthetic wrong prepared quantity, account or lease cannot reach durable reserve or dispatch',async()=>{
  for(const mutate of [value=>({...value,quantity:99}),value=>({...value,binding:{...value.binding,selectionKey:'other-account'}}),value=>({...value,privateLeaseId:''}),value=>({...value,expiresAt:0})]){
    const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});f.setPrepare(mutate);assert.equal((await f.runner.tick()).status,'DISCONNECTED');assert.equal(f.dispatches.length,0);assert.equal((await f.ledger.recover()).unresolved.length,0);
  }
});
test('synthetic user stop preserves unresolved durable attempts and does not manage the position',async()=>{const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();f.runner.stop();assert.equal(f.runner.snapshot().running,false);assert.equal((await f.ledger.recover()).entryBlocked,true);await f.runner.tick();assert.equal(f.dispatches.length,1);assert.equal(f.runner.snapshot().postFillManagement,false);});

test('synthetic browser restart restores a durable uncertain dispatch as UNKNOWN, reconciles without resending, and requires explicit start after two native closure samples',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});f.setFailure(true);
  assert.equal((await f.runner.tick()).status,'DISCONNECTED');assert.equal(f.dispatches.length,1);
  const original=(await f.ledger.recover()).unresolved[0];assert.equal(original.status,'UNKNOWN');f.runner.stop();
  f.advance({wall:16001,newRun:true,newBar:true});f.setFailure(false);
  const restored=f.createWindow('restart-window','restart-session');
  const start=await restored.runner.start();assert.equal(start.status,'RECOVERY_REQUIRED');assert.equal(start.running,true);
  assert.equal(start.lifecycle.sessionEnabled,false);assert.equal(start.lifecycle.ownedAttempt.status,'UNKNOWN');
  assert.equal(start.lifecycle.ownedAttempt.restoredFromLedger,true);assert.equal(start.lifecycle.ownedAttempt.attemptKey,original.key);
  assert.equal(start.lifecycle.ownedAttempt.binding.sourceRunId,original.intentBinding.binding.sourceRunId);
  assert.notEqual(start.lifecycle.binding.sourceRunId,start.lifecycle.ownedAttempt.binding.sourceRunId);
  assert.equal(start.lifecycle.permit,null);assert.equal(start.dispatchCount,0);assert.equal(f.dispatches.length,1);
  assert.equal((await restored.runner.tick()).status,'FILLED');assert.equal(f.dispatches.length,1);
  f.setStatus('CLOSED');assert.equal((await restored.runner.tick()).status,'CLOSED_VERIFYING');
  const closed=await restored.runner.tick();assert.equal(closed.status,'CLOSED_REVIEW_REQUIRED');assert.equal(closed.running,false);
  assert.equal(closed.lifecycle.sessionEnabled,false);assert.equal(closed.lifecycle.lastClosedAttempt.closureSamples.length,2);
  assert.equal((await restored.ledger.recover()).unresolved.length,0);assert.equal(f.dispatches.length,1);
  await restored.runner.tick();assert.equal(f.dispatches.length,1);
  assert.equal((await restored.runner.start()).status,'WAITING_NEW_SIGNAL');await restored.runner.tick();assert.equal(f.dispatches.length,1);
  f.advance({newBar:true});f.setDirection('SHORT');f.setStatus('FILLED');
  assert.equal((await restored.runner.tick()).status,'RECONCILIATION_REQUIRED');assert.equal(f.dispatches.length,2);
  assert.equal(f.dispatches[1].permit.signal.direction,'SHORT');assert.notEqual(f.dispatches[1].attemptKey,original.key);
});

test('synthetic persisted FILLED remains unverified after restart until a fresh attributed native read and cannot produce a repeat entry',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();
  assert.equal((await f.runner.tick()).status,'FILLED');const original=(await f.ledger.recover()).unresolved[0];
  assert.equal(original.status,'FILLED');f.runner.stop();f.advance({wall:16001,newRun:true});
  const restored=f.createWindow('restart-filled-window','restart-filled-session');
  const start=await restored.runner.start();assert.equal(start.status,'RECOVERY_REQUIRED');
  assert.equal(start.lifecycle.ownedAttempt.status,'UNKNOWN');assert.equal(start.lifecycle.ownedAttempt.storedStatus,'FILLED');
  assert.equal(start.lifecycle.ownedAttempt.lastObservedAt,null);assert.equal(start.lifecycle.ownedAttempt.nativeOrderId,original.history.at(-1).proof.nativeOrderId);
  assert.equal(start.lifecycle.sessionEnabled,false);assert.equal(f.dispatches.length,1);
  const fresh=await restored.runner.tick();assert.equal(fresh.status,'FILLED');assert.notEqual(fresh.lifecycle.ownedAttempt.lastObservedAt,null);
  assert.equal(fresh.lifecycle.sessionEnabled,false);assert.equal(fresh.lifecycle.permit,null);assert.equal(f.dispatches.length,1);
});

test('synthetic explicit start after user stop restores the same instance read-only, preserves closure samples across refresh, and never rearms a read-only adapter',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();
  f.runner.stop();f.setEligible(false);f.advance({newRun:true});
  const resumed=await f.runner.start();assert.equal(resumed.status,'RECOVERY_REQUIRED');assert.equal(resumed.running,true);
  assert.equal(resumed.lifecycle.ownedAttempt.status,'UNKNOWN');assert.equal(resumed.lifecycle.sessionEnabled,false);
  assert.equal((await f.runner.start()).generation,resumed.generation);assert.equal(f.dispatches.length,1);
  assert.equal((await f.runner.tick()).status,'FILLED');f.setStatus('CLOSED');
  const first=await f.runner.tick();assert.equal(first.status,'CLOSED_VERIFYING');assert.equal(first.lifecycle.closureSamples.length,1);
  assert.equal((await f.runner.start()).lifecycle.closureSamples.length,1);
  const closed=await f.runner.tick();assert.equal(closed.status,'CLOSED_REVIEW_REQUIRED');assert.equal(closed.running,false);
  assert.equal(closed.lifecycle.sessionEnabled,false);assert.equal((await f.ledger.recover()).entryBlocked,false);assert.equal(f.dispatches.length,1);
  f.advance({newBar:true});assert.equal((await f.runner.start()).status,'NOT_READY');await f.runner.tick();assert.equal(f.dispatches.length,1);
  f.setEligible(true);assert.equal((await f.runner.start()).status,'WAITING_NEW_SIGNAL');await f.runner.tick();assert.equal(f.dispatches.length,1);
});

test('synthetic mismatched closure receipts restore durable ownership and require two new native samples before normal-session search resumes',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();f.setStatus('CLOSED');
  await f.runner.tick();f.setOwnedTransform(value=>({...value,ledgerProof:{...value.ledgerProof,closureSamples:[]}}));
  const rejected=await f.runner.tick();assert.equal(rejected.status,'RECOVERY_REQUIRED');assert.equal(rejected.reason,'CLOSURE_RECEIPTS_DO_NOT_MATCH_OBSERVED_SAMPLES');
  assert.equal(rejected.lifecycle.ownedAttempt.status,'UNKNOWN');assert.equal(rejected.lifecycle.closureSamples.length,0);assert.equal(rejected.lifecycle.sessionEnabled,false);
  assert.equal((await f.ledger.recover()).unresolved[0].status,'FILLED');assert.equal(f.dispatches.length,1);
  f.setOwnedTransform(value=>value);const first=await f.runner.tick();assert.equal(first.status,'CLOSED_VERIFYING');assert.equal(first.lifecycle.closureSamples.length,1);
  assert.equal((await f.ledger.recover()).entryBlocked,true);assert.equal(f.dispatches.length,1);
  const closed=await f.runner.tick();assert.equal(closed.status,'WAITING_NEXT_SIGNAL');assert.equal(closed.lifecycle.sessionEnabled,true);
  assert.equal((await f.ledger.recover()).entryBlocked,false);await f.runner.tick();assert.equal(f.dispatches.length,1);
  f.advance({newBar:true});f.setDirection('SHORT');f.setStatus('FILLED');await f.runner.tick();assert.equal(f.dispatches.length,2);
});

test('synthetic dropped durable CLOSED write cannot unlock or resend and a new pair of native reads can finalize the same owned event',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();f.setStatus('CLOSED');
  await f.runner.tick();f.dropClosedWrite();const failed=await f.runner.tick();
  assert.equal(failed.status,'RECOVERY_REQUIRED');assert.equal(failed.reason,'EXECUTION_LEDGER_WRITE_NOT_VERIFIED');
  assert.equal(failed.lifecycle.ownedAttempt.status,'UNKNOWN');assert.equal(failed.lifecycle.sessionEnabled,false);assert.equal(failed.lifecycle.closureSamples.length,0);
  const durable=(await f.ledger.recover()).unresolved[0];assert.equal(durable.status,'FILLED');assert.equal(durable.history.some(entry=>entry.status==='CLOSED'),false);
  const first=await f.runner.tick();assert.equal(first.status,'CLOSED_VERIFYING');assert.equal((await f.ledger.recover()).entryBlocked,true);assert.equal(f.dispatches.length,1);
  const finalized=await f.runner.tick();assert.equal(finalized.status,'WAITING_NEXT_SIGNAL');assert.equal(finalized.lifecycle.sessionEnabled,true);
  assert.equal(finalized.ownedRecord,null);assert.equal((await f.ledger.recover()).entryBlocked,false);
  const persisted=f.data()[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0];assert.equal(persisted.key,durable.key);assert.equal(persisted.status,'CLOSED');
  const finalProof=persisted.history.at(-1).proof;assert.equal(finalProof.closureSamples.length,2);
  assert.deepEqual(finalProof.closureSamples[0],first.lifecycle.closureSamples[0]);assert.notEqual(finalProof.closureSamples[0].sampleId,finalProof.closureSamples[1].sampleId);
  assert.ok(finalProof.closureSamples[1].observedAt>finalProof.closureSamples[0].observedAt);
  await f.runner.tick();assert.equal(f.dispatches.length,1);
});


test('a fresh exact pre-gesture non-submission proof releases ownership while the old event remains durably consumed',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();const old=f.runner.snapshot().ownedRecord;assert.equal((await f.runner.resolveNotSubmitted(f.notSubmitted(old))).status,'WAITING_NEW_SIGNAL');assert.equal(f.data()[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'NOT_SUBMITTED');assert.equal(f.runner.snapshot().lifecycle.ownedAttempt,null);await f.runner.tick();assert.equal(f.dispatches.length,1);f.advance({newBar:true});await f.runner.tick();assert.equal(f.dispatches.length,2);
});

test('automatic exact rejection proof resumes only future events; wrong-key or nonflat recovery cannot release ownership',async()=>{
  const f=fixture();f.setDispatchTransform((reply,args)=>({...reply,notSubmittedProof:f.notSubmitted(args.record)}));await f.runner.start();f.setSignal(true);f.advance({newBar:true});assert.equal((await f.runner.tick()).status,'WAITING_NEW_SIGNAL');assert.equal(f.data()[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'NOT_SUBMITTED');await f.runner.tick();assert.equal(f.dispatches.length,1);
  for(const mutate of [p=>p.intentKey+='other',p=>p.accountInventory.positions.push({symbol:'NQZ2026',quantity:1}),p=>p.accountEvidence.observedAt-=2001]){const x=fixture();await x.runner.start();x.setSignal(true);x.advance({newBar:true});await x.runner.tick();const old=x.runner.snapshot().ownedRecord,proof=x.notSubmitted(old);mutate(proof);assert.equal((await x.runner.resolveNotSubmitted(proof)).status,'RECOVERY_REQUIRED');assert.equal(x.runner.snapshot().ownedRecord.key,old.key);assert.equal(x.data()[EXECUTION_ATTEMPT_STORAGE_KEY].attempts[0].status,'UNKNOWN');assert.equal(x.dispatches.length,1);}
});


test('explicitly started recovery automatically resumes after two fresh verified closure reads, without reusing its old signal',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();f.runner.stop();f.advance({wall:16001,newRun:true});
  const resumed=f.createWindow('auto-recovery','auto-session',true);assert.equal((await resumed.runner.start()).status,'RECOVERY_REQUIRED');
  f.setStatus('CLOSED');assert.equal((await resumed.runner.tick()).status,'CLOSED_VERIFYING');
  const closed=await resumed.runner.tick();assert.equal(closed.status,'WAITING_NEXT_SIGNAL');assert.equal(closed.running,true);assert.equal(closed.lifecycle.sessionEnabled,true);assert.equal(closed.ownedRecord,null);
  assert.equal((await resumed.ledger.recover()).unresolved.length,0);await resumed.runner.tick();assert.equal(f.dispatches.length,1);
  f.advance({newBar:true});f.setStatus('FILLED');f.setDirection('SHORT');await resumed.runner.tick();assert.equal(f.dispatches.length,2);assert.equal(f.dispatches[1].permit.signal.direction,'SHORT');
});

test('connection loss between closure samples clears the pair and resumes only after two fresh reads',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();f.setStatus('CLOSED');
  const old=(await f.runner.tick()).lifecycle.closureSamples[0];f.setConnected(false);assert.equal((await f.runner.tick()).status,'DISCONNECTED');
  f.setConnected(true);const first=await f.runner.tick();assert.equal(first.status,'CLOSED_VERIFYING');assert.equal(first.lifecycle.closureSamples.length,1);assert.notEqual(first.lifecycle.closureSamples[0].sampleId,old.sampleId);
  assert.equal((await f.runner.tick()).status,'WAITING_NEXT_SIGNAL');assert.equal(f.dispatches.length,1);
});

test('Stop during resumed closure verification never rearms execution',async()=>{
  const f=fixture();await f.runner.start();f.setSignal(true);f.advance({newBar:true});await f.runner.tick();await f.runner.tick();f.runner.stop();f.advance({wall:16001});
  const resumed=f.createWindow('stop-recovery','stop-session',true);await resumed.runner.start();f.setStatus('CLOSED');await resumed.runner.tick();
  f.setOwnedTransform(value=>{resumed.runner.stop();return value;});const stopped=await resumed.runner.tick();assert.equal(stopped.running,false);assert.equal(stopped.lifecycle.sessionEnabled,false);assert.equal((await resumed.ledger.recover()).entryBlocked,true);
  await resumed.runner.tick();assert.equal(f.dispatches.length,1);
});
