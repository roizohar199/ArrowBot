// Pure state-machine contracts with artificial trusted-adapter observations.
// These tests create no native account verification, actual orders or fills.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionLifecycle} from '../execution-lifecycle.mjs';
import {createExecutionAttemptLedger,buildExecutionAttemptKey} from '../execution-attempt-ledger.mjs';
const wallStart=Date.UTC(2026,10,16,14),marketStart=wallStart-60000;
const baseBinding=(patch={})=>({accountIdentity:{provider:'CUSTOM_FUTURES',environment:'DEMO',nativeAccountId:'000ABC'},adapterId:'authorized-adapter',accountRevision:1,selectionKey:'selected-account-revision-1',sourceIdentity:'market-feed:NQ:1m',sourceRunId:'feed-run-1',symbol:'NQZ2026',quantity:3,...patch});
function fixture(binding=baseBinding()){
  let clock=wallStart,close=marketStart,counter=0,run=binding.sourceRunId;
  const model=createExecutionLifecycle({now:()=>clock,makePermitId:()=>`permit-${++counter}`});
  const verification=(patch={})=>({kind:'EXECUTION_LIFECYCLE_VERIFIED_CONTEXT_V1',accountIdentity:structuredClone(binding.accountIdentity),adapterId:binding.adapterId,accountRevision:binding.accountRevision,selectionKey:binding.selectionKey,sourceIdentity:binding.sourceIdentity,sourceRunId:run,symbol:binding.symbol,observedAt:clock,sampleId:`context-${++counter}`,connected:true,nativeAccountVerified:true,sourceVerified:true,adapterEligible:true,latestClosedAt:close,synthetic:false,testOnly:false,...patch});
  const enable=(patch={})=>model.enableSession({sessionId:'explicit-user-session',enabled:true,binding,verification:verification(),...patch});
  const signal=(patch={})=>({status:'CONFIRMED',eventId:`signal-${close}`,direction:'LONG',symbol:binding.symbol,sourceIdentity:binding.sourceIdentity,sourceRunId:run,confirmedAt:close,confirmationBarCloseTime:close,observedAt:clock,synthetic:false,testOnly:false,...patch});
  const advance=(delta=60000)=>{clock+=100;close+=delta;return model.observeConnection(verification());};
  const prepare=(patch={})=>model.considerSignal(signal(patch));
  const commit=(direction='LONG')=>{advance();const result=prepare({direction});assert.equal(result.ok,true);const key='durable:'+result.permit.signal.eventId;assert.equal(model.commitAttempt(result.permit,{attemptKey:key}).ok,true);return {permit:result.permit,key};};
  const ownedProof=(status,patch={})=>{clock+=100;const own=model.snapshot().ownedAttempt;return {kind:'EXECUTION_LIFECYCLE_OWNED_STATE_V1',accountIdentity:structuredClone(binding.accountIdentity),adapterId:binding.adapterId,sourceIdentity:binding.sourceIdentity,sourceRunId:run,symbol:binding.symbol,attemptKey:own.attemptKey,nativeOrderId:'native-parent-1',observedAt:clock,sampleId:`native-${++counter}`,nativeAccountVerified:true,sourceVerified:true,ownershipVerified:true,accountScope:'EXACT_NATIVE_ACCOUNT',positionsComplete:true,workingOrdersComplete:true,positions:status==='FILLED'?[{symbol:binding.symbol,direction:own.signal.direction,quantity:binding.quantity}]:[],workingOrders:status==='WORKING'?[{symbol:binding.symbol,orderId:'native-parent-1',attemptKey:own.attemptKey}]:[],status,closedVerified:status==='CLOSED',latestClosedAt:close,synthetic:false,testOnly:false,...patch};};
  return {model,verification,enable,signal,advance,prepare,commit,ownedProof,tick:ms=>{clock+=ms;},setClock:v=>{clock=v;},setClose:v=>{close=v;},setRun:v=>{run=v;},get clock(){return clock;},get close(){return close;}};
}

test('lifecycle is inactive until an explicitly enabled session has an eligible, freshly verified account and source',()=>{
  const f=fixture();assert.equal(f.model.snapshot().state,'INACTIVE');assert.equal(f.prepare().ok,false);
  for(const patch of [{enabled:false},{verification:f.verification({adapterEligible:false})},{verification:f.verification({nativeAccountVerified:false})},{verification:f.verification({sourceVerified:false})},{verification:f.verification({observedAt:wallStart-2001})},{verification:f.verification({synthetic:true})}]){assert.equal(f.enable(patch).ok,false);assert.equal(f.model.snapshot().entryAllowed,false);}
  assert.equal(f.enable().ok,true);assert.equal(f.model.snapshot().state,'READY');assert.equal(f.model.snapshot().brokerActionsPerformed,false);assert.equal(f.model.snapshot().orderAuthorizationGranted,false);
});

test('provider and environment are not a blanket Replay restriction or a substitute for verified adapter eligibility',()=>{
  for(const environment of ['REPLAY','DEMO','EVALUATION','PA','LIVE']){const f=fixture(baseBinding({accountIdentity:{provider:'ANY_NEW_PROVIDER',environment,nativeAccountId:'00123'}}));assert.equal(f.enable().ok,true);assert.equal(f.model.snapshot().sessionEnabled,true);assert.equal(f.model.snapshot().binding.accountIdentity.environment,environment);}
});

test('only a new closed confirmed source-bound signal can obtain a one-shot quantity and exact-futures-symbol snapshot',()=>{
  const f=fixture();f.enable();assert.equal(f.prepare().reasonCodes[0],'EXECUTION_HISTORICAL_OR_BASELINE_SIGNAL_FORBIDDEN');f.advance();
  for(const patch of [{status:'FORMING'},{confirmedAt:f.close-60000,confirmationBarCloseTime:f.close-60000},{symbol:'NQH2027'},{sourceRunId:'different'},{sourceIdentity:'another-feed'},{synthetic:true},{testOnly:true},{direction:'WAIT'},{observedAt:f.clock+1}])assert.equal(f.prepare(patch).ok,false);
  const r=f.prepare();assert.equal(r.ok,true);assert.equal(r.permit.binding.quantity,3);assert.equal(r.permit.binding.symbol,'NQZ2026');assert.deepEqual(r.permit.binding.accountIdentity,baseBinding().accountIdentity);assert.equal(r.permit.orderAuthorizationGranted,false);
  assert.equal(f.prepare().ok,false);const altered=structuredClone(r.permit);altered.binding.quantity=4;assert.equal(f.model.commitAttempt(altered,{attemptKey:'durable-key'}).ok,false);
  assert.equal(f.model.commitAttempt(r.permit,{attemptKey:'durable-key'}).ok,true);assert.equal(f.model.snapshot().state,'UNKNOWN');assert.equal(f.model.commitAttempt(r.permit,{attemptKey:'retry-key'}).ok,false);assert.equal(f.prepare().ok,false);assert.equal(f.model.snapshot().attemptCount,1);
});

test('disconnect cancels permits, retains the enabled-session intent, and recovery never enters the recovered historical close',()=>{
  const f=fixture();f.enable();f.advance();const p=f.prepare().permit;f.model.disconnect();assert.equal(f.model.snapshot().sessionEnabled,true);assert.equal(f.model.snapshot().state,'DISCONNECTED');assert.equal(f.model.commitAttempt(p,{attemptKey:'never-dispatched'}).ok,false);
  assert.equal(f.model.observeConnection(f.verification({accountIdentity:{...baseBinding().accountIdentity,nativeAccountId:'other'}})).ok,false);
  f.setRun('feed-run-2');assert.equal(f.model.observeConnection(f.verification()).ok,true);assert.equal(f.prepare().reasonCodes[0],'EXECUTION_HISTORICAL_OR_BASELINE_SIGNAL_FORBIDDEN');f.advance();assert.equal(f.prepare().ok,true);assert.equal(f.model.snapshot().attemptCount,0);
});

test('reconnect cannot forget the latest observed source cutoff even if the first recovered source is older',()=>{
  const f=fixture();f.enable();f.advance();f.advance();const latest=f.close;f.model.disconnect();f.setRun('feed-run-2');assert.equal(f.model.observeConnection(f.verification({latestClosedAt:latest-60000})).ok,true);
  assert.equal(f.model.considerSignal(f.signal({confirmedAt:latest-60000,confirmationBarCloseTime:latest-60000})).ok,false);assert.equal(f.model.snapshot().baselineClosedAt,latest);
  f.advance();assert.equal(f.prepare().ok,true);
});

test('an expired or reordered-context permit cannot dispatch and a source regression invalidates entry readiness',()=>{
  const f=fixture();f.enable();f.advance();const permit=f.prepare().permit;f.tick(2001);assert.equal(f.model.commitAttempt(permit,{attemptKey:'expired'}).ok,false);assert.equal(f.model.snapshot().entryAllowed,false);
  f.model.observeConnection(f.verification());f.advance();const p=f.prepare().permit;assert.equal(f.model.observeConnection(f.verification({latestClosedAt:f.close-60000})).ok,false);assert.equal(f.model.commitAttempt(p,{attemptKey:'regressed'}).ok,false);
});

test('WORKING and FILLED stay owned and block overlap without changing order size, stop, target or any broker state',()=>{
  for(const direction of ['LONG','SHORT']){const f=fixture();f.enable();const {key}=f.commit(direction);assert.equal(f.model.observeOwnedState(f.ownedProof('WORKING')).state,'WORKING');assert.equal(f.model.observeOwnedState(f.ownedProof('FILLED')).state,'FILLED');assert.equal(f.model.snapshot().ownedAttempt.attemptKey,key);assert.equal(f.model.snapshot().ownedAttempt.nativeOrderId,'native-parent-1');assert.equal(f.model.snapshot().binding.quantity,3);assert.equal(f.model.snapshot().postFillManagement,false);assert.equal(f.prepare().ok,false);
    for(const forbidden of ['submit','submitMarket','cancel','closePosition','flatten','moveStop','setRisk','setQuantity'])assert.equal(f.model[forbidden],undefined);
  }
});

test('wrong account, symbol, quantity, source, ownership and native order ID evidence never unlocks an uncertain attempt',()=>{
  const edits=[p=>{p.accountIdentity.nativeAccountId='other';},p=>{p.symbol='NQH2027';},p=>{p.positions[0].quantity=2;},p=>{p.sourceIdentity='wrong';},p=>{p.ownershipVerified=false;},p=>{p.nativeAccountVerified=false;},p=>{p.sourceVerified=false;},p=>{p.accountScope='VISIBLE_SYMBOL_ONLY';},p=>{p.nativeOrderId='another-order';},p=>{p.synthetic=true;},p=>{p.testOnly=true;}];
  for(const edit of edits){const f=fixture();f.enable();f.commit();f.model.observeOwnedState(f.ownedProof('FILLED'));const proof=f.ownedProof('FILLED');edit(proof);assert.equal(f.model.observeOwnedState(proof).ok,false);assert.equal(f.model.snapshot().ownedAttempt.status,'UNKNOWN');assert.equal(f.model.snapshot().ownedAttempt.nativeOrderId,'native-parent-1');assert.equal(f.model.snapshot().entryAllowed,false);assert.equal(f.model.snapshot().attemptCount,1);}
});

test('two complete distinct closure samples release the owned slot but retain the session and allow only the next new signal',()=>{
  const f=fixture();f.enable();f.commit('SHORT');f.model.observeOwnedState(f.ownedProof('FILLED'));const first=f.ownedProof('CLOSED');assert.equal(f.model.observeOwnedState(first).state,'CLOSED_VERIFYING');assert.equal(f.model.snapshot().entryAllowed,false);
  assert.equal(f.model.observeOwnedState(first).ok,false);assert.equal(f.model.snapshot().closureSamples.length,1);
  const second=f.ownedProof('CLOSED');assert.equal(f.model.observeOwnedState(second).ok,true);const s=f.model.snapshot();assert.equal(s.state,'READY');assert.equal(s.sessionEnabled,true);assert.equal(s.ownedAttempt,null);assert.equal(s.lastClosedAttempt.closureSamples.length,2);assert.equal(s.lastClosedAttempt.nativeOrderId,'native-parent-1');assert.equal(s.lastClosedAttempt.closureSamples[1].sampleId,second.sampleId);
  assert.equal(f.prepare().ok,false);f.advance();const next=f.prepare();assert.equal(next.ok,true);assert.notEqual(next.permit.signal.eventId,s.lastClosedAttempt.signal.eventId);assert.equal(f.model.commitAttempt(next.permit,{attemptKey:'next-durable-key'}).ok,true);assert.equal(f.model.snapshot().attemptCount,2);
});

test('empty arrays alone, incomplete account inventory, lingering orders and an unproven close do not release an UNKNOWN attempt',()=>{
  const changes=[p=>{p.status='EMPTY';},p=>{p.closedVerified=false;},p=>{delete p.nativeOrderId;},p=>{p.positionsComplete=false;},p=>{p.workingOrdersComplete=false;},p=>{p.workingOrders=[{orderId:'still-open'}];},p=>{p.positions=[{symbol:'ESZ2026',direction:'LONG',quantity:1}];},p=>{p.latestClosedAt-=60000;}];
  for(const edit of changes){const f=fixture();f.enable();f.commit();const proof=f.ownedProof('CLOSED');edit(proof);assert.equal(f.model.observeOwnedState(proof).ok,false);assert.equal(f.model.snapshot().ownedAttempt.status,'UNKNOWN');assert.equal(f.model.snapshot().closureSamples.length,0);assert.equal(f.model.snapshot().entryAllowed,false);}
});

test('an uncertain sample or disconnect between flat observations resets the two-sample closure requirement',()=>{
  for(const interrupted of ['unknown','disconnect']){const f=fixture();f.enable();f.commit();f.model.observeOwnedState(f.ownedProof('CLOSED'));
    if(interrupted==='unknown')f.model.observeOwnedState(f.ownedProof('UNKNOWN'));else{f.model.disconnect();f.setRun('feed-run-2');f.model.observeConnection(f.verification());}
    assert.equal(f.model.snapshot().closureSamples.length,0);assert.equal(f.model.observeOwnedState(f.ownedProof('CLOSED')).state,'CLOSED_VERIFYING');assert.ok(f.model.snapshot().ownedAttempt);assert.equal(f.model.observeOwnedState(f.ownedProof('CLOSED')).ownedAttempt,null);
  }
});

test('disconnect after a fill keeps the owned attempt unknown until read-only same-account reconciliation proves it again',()=>{
  const f=fixture();f.enable();const {key}=f.commit();f.model.observeOwnedState(f.ownedProof('FILLED'));f.model.disconnect();assert.equal(f.model.snapshot().ownedAttempt.status,'UNKNOWN');assert.equal(f.model.snapshot().ownedAttempt.attemptKey,key);assert.equal(f.model.snapshot().ownedAttempt.lastKnownStatus,'FILLED');
  f.setRun('feed-run-2');f.model.observeConnection(f.verification());assert.equal(f.model.snapshot().ownedAttempt.status,'UNKNOWN');assert.equal(f.model.observeOwnedState(f.ownedProof('FILLED')).state,'FILLED');assert.equal(f.model.snapshot().entryAllowed,false);assert.equal(f.model.snapshot().attemptCount,1);
});

test('explicit disable stays disabled after read-only closure and cannot erase an unresolved attempt by switching accounts',()=>{
  const f=fixture();f.enable();f.commit();f.model.disableSession();assert.equal(f.model.snapshot().sessionEnabled,false);assert.equal(f.enable({binding:baseBinding({accountIdentity:{provider:'OTHER',environment:'LIVE',nativeAccountId:'other'}})}).ok,false);assert.ok(f.model.snapshot().ownedAttempt);
  f.model.observeOwnedState(f.ownedProof('CLOSED'));f.model.observeOwnedState(f.ownedProof('CLOSED'));assert.equal(f.model.snapshot().state,'INACTIVE');assert.equal(f.model.snapshot().sessionEnabled,false);assert.equal(f.prepare().ok,false);assert.equal(f.enable().ok,true);assert.equal(f.prepare().ok,false);
});

test('an attempted account rebind with an owned order disables the old armed intent without discarding its native attribution',()=>{
  const f=fixture();f.enable();const {key}=f.commit();f.model.observeOwnedState(f.ownedProof('FILLED'));
  const other=baseBinding({accountIdentity:{provider:'OTHER',environment:'PA',nativeAccountId:'new-account'}});
  assert.equal(f.enable({binding:other}).ok,false);assert.equal(f.model.snapshot().sessionEnabled,false);assert.equal(f.model.snapshot().ownedAttempt.attemptKey,key);assert.deepEqual(f.model.snapshot().ownedAttempt.binding.accountIdentity,baseBinding().accountIdentity);
  f.model.observeOwnedState(f.ownedProof('CLOSED'));f.model.observeOwnedState(f.ownedProof('CLOSED'));assert.equal(f.model.snapshot().state,'INACTIVE');assert.equal(f.prepare().ok,false);
});

test('caller mutations, reordered dictionary keys and expired native samples cannot forge a lifecycle transition',()=>{
  const f=fixture();f.enable();f.advance();const r=f.prepare(),p=r.permit;r.binding.quantity=99;assert.equal(f.model.snapshot().binding.quantity,3);
  const reordered=Object.fromEntries(Object.entries(p).reverse());assert.equal(f.model.commitAttempt(reordered,{attemptKey:'native-once'}).ok,true);const old=f.ownedProof('CLOSED');f.tick(2001);assert.equal(f.model.observeOwnedState(old).ok,false);assert.ok(f.model.snapshot().ownedAttempt);assert.equal(f.model.snapshot().brokerActionsPerformed,false);
});

async function durableRecord({filled=false,binding=baseBinding(),accountEvidence={}}={}){
  const f=fixture(binding);f.enable();f.advance();const permit=f.prepare().permit,a=permit.binding.accountIdentity,eventIdentity={eventId:permit.signal.eventId,symbol:permit.binding.symbol,direction:permit.signal.direction,confirmedAt:permit.signal.confirmedAt};
  let data={},counter=0;const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{data={...data,...structuredClone(value)};}},locks={request:async(_name,_options,operation)=>operation()},ledger=createExecutionAttemptLedger({storage,locks,now:()=>f.clock,ownerId:'old-window',makeToken:()=>`durable-token-${++counter}`});
  const session=(await ledger.claimSession({accountIdentity:a,sessionId:'old-explicit-session'})).session,key=buildExecutionAttemptKey({accountIdentity:a,eventIdentity}),intentBinding={quantity:permit.binding.quantity,binding:permit.binding,signal:permit.signal};
  assert.equal((await ledger.reserve({key,accountIdentity:a,eventIdentity,session,sourceIdentity:{identityKey:permit.binding.sourceIdentity,runId:permit.binding.sourceRunId},intentBinding})).ok,true);
  if(filled){const proof={kind:'EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1',intentKey:key,status:'FILLED',binding:intentBinding,attributionVerified:true,nativeOrderId:'persisted-native-order',direction:permit.signal.direction,quantity:permit.binding.quantity,fillVerified:true,accountEvidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',...a,origin:'PUBLIC_NATIVE_UI',nativeIdentityVerified:true,environmentVerified:true,connected:true,observedAt:f.clock,synthetic:false,testOnly:false,...accountEvidence}};assert.equal((await ledger.mark({key,session,status:'FILLED',proof})).ok,true);}
  const recovered=await ledger.recover({accountIdentity:a});assert.equal(recovered.ok,true);assert.equal(recovered.unresolved.length,1);return {record:recovered.unresolved[0],key,original:permit.binding};
}
function restarted(original,record){const current=baseBinding({...original,accountRevision:original.accountRevision+1,selectionKey:'fresh-selection-after-restart',sourceRunId:'fresh-feed-after-restart',quantity:7}),f=fixture(current);f.setClock(record.updatedAt+120000);f.setClose(record.eventIdentity.confirmedAt+60000);return {f,current};}

test('a real durable reservation restores only UNKNOWN read-only ownership with original size and no restored session authorization',async()=>{
  const {record,original,key}=await durableRecord(),{f,current}=restarted(original,record);
  const restored=f.model.restoreAttempt({sessionId:'new-window-session',binding:current,verification:f.verification({adapterEligible:false}),record});assert.equal(restored.ok,true);assert.equal(restored.state,'UNKNOWN');assert.equal(restored.sessionEnabled,false);assert.equal(restored.ownedAttempt.attemptKey,key);assert.equal(restored.ownedAttempt.binding.quantity,3);assert.equal(restored.binding.quantity,7);assert.equal(restored.ownedAttempt.restoredFromLedger,true);assert.equal(restored.ownedAttempt.nativeOrderId,null);assert.equal(restored.attemptCount,1);assert.equal(f.prepare().ok,false);
  const first=f.ownedProof('CLOSED',{nativeOrderId:'native-reservation-closed'});assert.equal(f.model.observeOwnedState(first).state,'CLOSED_VERIFYING');assert.equal(f.model.observeOwnedState(f.ownedProof('CLOSED',{nativeOrderId:'native-reservation-closed'})).state,'INACTIVE');assert.equal(f.model.snapshot().sessionEnabled,false);assert.equal(f.prepare().ok,false);
  assert.equal(f.enable().ok,true);f.advance();assert.equal(f.prepare({eventId:record.eventIdentity.eventId}).reasonCodes[0],'EXECUTION_SIGNAL_ALREADY_CONSUMED');assert.equal(f.prepare().ok,true);
});

test('persisted FILLED is never a current fill proof, though its validated native ID remains pinned for fresh reconciliation',async()=>{
  const {record,original}=await durableRecord({filled:true}),{f,current}=restarted(original,record),r=f.model.restoreAttempt({sessionId:'new-session',binding:current,verification:f.verification(),record});assert.equal(r.ok,true);assert.equal(r.state,'UNKNOWN');assert.equal(r.ownedAttempt.storedStatus,'FILLED');assert.equal(r.ownedAttempt.nativeOrderId,'persisted-native-order');assert.equal(r.sessionEnabled,false);
  const bad=f.ownedProof('FILLED',{nativeOrderId:'different-order',positions:[{symbol:original.symbol,direction:'LONG',quantity:3}]});assert.equal(f.model.observeOwnedState(bad).ok,false);
  const fresh=f.ownedProof('FILLED',{nativeOrderId:'persisted-native-order',positions:[{symbol:original.symbol,direction:'LONG',quantity:3}]});assert.equal(f.model.observeOwnedState(fresh).state,'FILLED');assert.equal(f.model.snapshot().sessionEnabled,false);assert.equal(f.model.snapshot().entryAllowed,false);
});

test('read-only lifecycle restoration retains explicitly unattested Tradovate profile environment without restoring entry authority',async()=>{
  for(const environment of ['DEMO','EVALUATION','PA','LIVE']){
    const binding=baseBinding({accountIdentity:{provider:'TRADOVATE',environment,nativeAccountId:'fixture-native-account'}});
    const {record,original}=await durableRecord({filled:true,binding,accountEvidence:{environmentVerified:false,environmentBasis:'USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED'}}),{f,current}=restarted(original,record);
    const restored=f.model.restoreAttempt({sessionId:'read-only-restart',binding:current,verification:f.verification(),record});
    assert.equal(restored.ok,true);assert.equal(restored.state,'UNKNOWN');assert.equal(restored.sessionEnabled,false);assert.equal(restored.entryAllowed,false);
    assert.equal(restored.ownedAttempt.nativeOrderId,'persisted-native-order');assert.equal(record.history[1].proof.accountEvidence.environmentVerified,false);
    for(const change of [p=>{delete p.environmentBasis;},p=>{p.environmentVerified=true;},p=>{p.provider='TRADINGVIEW_PAPER';},p=>{p.origin='AUTHORIZED_CONNECTOR';},p=>{p.nativeIdentityVerified=false;}]){
      const altered=structuredClone(record);change(altered.history[1].proof.accountEvidence);const restart=restarted(original,record);
      assert.equal(restart.f.model.restoreAttempt({sessionId:'rejected-restart',binding:restart.current,verification:restart.f.verification(),record:altered}).ok,false);
      assert.equal(restart.f.model.snapshot().ownedAttempt,null);assert.equal(restart.f.model.snapshot().entryAllowed,false);
    }
  }
});

test('forged durable account, event, source, immutable intent, key, terminal state or history cannot restore ownership',async()=>{
  const {record,original}=await durableRecord({filled:true});
  const changes=[r=>{r.accountIdentity.nativeAccountId='other';},r=>{r.eventIdentity.direction='SHORT';},r=>{r.sourceIdentity.identityKey='other-source';},r=>{r.sourceIdentity.runId='other-run';},r=>{r.intentBinding.quantity=4;},r=>{r.intentBinding.binding.quantity=4;},r=>{r.intentBinding.signal.eventId+='changed';},r=>{r.intentBinding.signal.synthetic=true;},r=>{r.key+='wrong';},r=>{r.status='CLOSED';},r=>{r.history=[];},r=>{r.history[1].proof.attributionVerified=false;},r=>{r.history[1].proof.accountEvidence.nativeAccountId='foreign';},r=>{r.history[1].proof.nativeOrderId='';},r=>{r.history[1].proof.accountEvidence.synthetic=true;},r=>{r.credentials='never-restored';}];
  for(const change of changes){const altered=structuredClone(record);change(altered);const {f,current}=restarted(original,record),result=f.model.restoreAttempt({sessionId:'new-session',binding:current,verification:f.verification(),record:altered});assert.equal(result.ok,false,change.toString());assert.equal(f.model.snapshot().ownedAttempt,null);assert.equal(f.model.snapshot().sessionEnabled,false);}
});

test('restoration requires a fresh verified same native account, adapter, stable source and future contract, without replacing an existing owned attempt',async()=>{
  const {record,original}=await durableRecord();
  for(const patch of [{accountIdentity:{...original.accountIdentity,nativeAccountId:'other'}},{adapterId:'different-adapter'},{sourceIdentity:'another-market-feed'},{symbol:'NQH2027'}]){const {f,current}=restarted(original,record),binding={...current,...patch},proof=f.verification({...binding});assert.equal(f.model.restoreAttempt({sessionId:'new-session',binding,verification:proof,record}).ok,false);assert.equal(f.model.snapshot().ownedAttempt,null);}
  for(const patch of [{observedAt:record.updatedAt},{nativeAccountVerified:false},{sourceVerified:false},{synthetic:true},{testOnly:true}]){const {f,current}=restarted(original,record);assert.equal(f.model.restoreAttempt({sessionId:'new-session',binding:current,verification:f.verification(patch),record}).ok,false);}
  const {f,current}=restarted(original,record);assert.equal(f.model.restoreAttempt({sessionId:'new-session',binding:current,verification:f.verification(),record}).ok,true);assert.equal(f.model.restoreAttempt({sessionId:'another-session',binding:current,verification:f.verification(),record}).ok,false);assert.equal(f.model.snapshot().ownedAttempt.attemptKey,record.key);
});

test('fresh read-only recovery connection refreshes preserve the first verified closure sample and permit the second distinct closure proof',async()=>{
  const {record,original}=await durableRecord(),{f,current}=restarted(original,record);
  assert.equal(f.model.restoreAttempt({sessionId:'read-only-recovery',binding:current,verification:f.verification({adapterEligible:false}),record}).ok,true);
  const first=f.ownedProof('CLOSED',{nativeOrderId:'native-closed-after-restart'});
  assert.equal(f.model.observeOwnedState(first).state,'CLOSED_VERIFYING');assert.equal(f.model.snapshot().closureSamples.length,1);
  for(let i=0;i<3;i++){
    f.tick(100);const refreshed=f.model.observeConnection(f.verification({adapterEligible:false}));
    assert.equal(refreshed.ok,true);assert.equal(refreshed.connected,true);assert.equal(refreshed.state,'CLOSED_VERIFYING');
    assert.equal(refreshed.closureSamples.length,1);assert.equal(refreshed.closureSamples[0].sampleId,first.sampleId);
    assert.equal(refreshed.sessionEnabled,false);assert.equal(refreshed.entryAllowed,false);assert.equal(refreshed.permit,null);
  }
  const finished=f.model.observeOwnedState(f.ownedProof('CLOSED',{nativeOrderId:'native-closed-after-restart'}));
  assert.equal(finished.ok,true);assert.equal(finished.state,'INACTIVE');assert.equal(finished.ownedAttempt,null);
  assert.equal(finished.lastClosedAttempt.closureSamples.length,2);assert.equal(finished.sessionEnabled,false);assert.equal(finished.entryAllowed,false);
});

test('read-only owned recovery never authorizes entry, resumes a session or bypasses exact account and source verification',async()=>{
  const {record,original}=await durableRecord();
  for(const patch of [{accountIdentity:{...original.accountIdentity,nativeAccountId:'foreign'}},{sourceIdentity:'foreign-source'},{sourceVerified:false},{nativeAccountVerified:false},{adapterId:'foreign-adapter'},{observedAt:record.updatedAt},{synthetic:true},{testOnly:true}]){
    const {f,current}=restarted(original,record);
    f.model.restoreAttempt({sessionId:'read-only-recovery',binding:current,verification:f.verification({adapterEligible:false}),record});
    f.model.observeOwnedState(f.ownedProof('CLOSED'));
    const rejected=f.model.observeConnection(f.verification({adapterEligible:false,...patch}));
    assert.equal(rejected.ok,false);assert.equal(rejected.sessionEnabled,false);assert.equal(rejected.entryAllowed,false);
    assert.equal(rejected.closureSamples.length,0);assert.equal(rejected.ownedAttempt.status,'UNKNOWN');assert.equal(f.prepare().ok,false);
  }
  const {f,current}=restarted(original,record);
  f.model.restoreAttempt({sessionId:'read-only-recovery',binding:current,verification:f.verification({adapterEligible:false}),record});
  f.setClose(f.close+60000);assert.equal(f.model.observeConnection(f.verification({adapterEligible:false})).ok,true);assert.equal(f.prepare().ok,false);
  f.model.observeOwnedState(f.ownedProof('CLOSED'));f.model.observeConnection(f.verification({adapterEligible:false}));f.model.observeOwnedState(f.ownedProof('CLOSED'));
  assert.equal(f.model.snapshot().ownedAttempt,null);assert.equal(f.model.snapshot().sessionEnabled,false);
  assert.equal(f.enable({verification:f.verification({adapterEligible:false})}).ok,false);assert.equal(f.prepare().ok,false);
  assert.equal(f.model.observeConnection(f.verification({adapterEligible:false})).ok,false);assert.equal(f.model.snapshot().entryAllowed,false);
  assert.equal(f.enable().ok,true);assert.equal(f.prepare().ok,false);f.advance();assert.equal(f.prepare().ok,true);
});
