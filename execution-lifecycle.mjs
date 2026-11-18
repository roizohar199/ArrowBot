// Provider-neutral local execution lifecycle. Caller supplies evidence only
// after its trusted adapter/native-source validators. This module performs no
// broker I/O, authenticates no account, and never closes/cancels/manages risk.
import {buildExecutionAttemptKey,matchesNativeExecutionAccountEnvironment} from './execution-attempt-ledger.mjs';
export const EXECUTION_LIFECYCLE_VERSION='execution-lifecycle-1';
const clone=x=>structuredClone(x),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=4096)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const time=x=>Number.isFinite(x)&&x>=0&&x<=8640000000000000,closedTime=x=>Number.isSafeInteger(x)&&x>=0;
const accountValid=x=>plain(x)&&Object.keys(x).length===3&&['provider','environment','nativeAccountId'].every(k=>Object.hasOwn(x,k)&&text(x[k],512));
const accountKey=x=>accountValid(x)?JSON.stringify([x.provider,x.environment,x.nativeAccountId]):null;
const sameAccount=(a,b)=>accountKey(a)!==null&&accountKey(a)===accountKey(b);
const equal=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]))||plain(a)&&plain(b)&&Reflect.ownKeys(a).length===Reflect.ownKeys(b).length&&Reflect.ownKeys(a).every(k=>typeof k==='string'&&Object.hasOwn(b,k)&&Object.getOwnPropertyDescriptor(a,k)?.get===undefined&&Object.getOwnPropertyDescriptor(a,k)?.set===undefined&&equal(a[k],b[k]));
const identityFields=['accountIdentity','adapterId','accountRevision','selectionKey','sourceIdentity','sourceRunId','symbol','quantity'];
const bindingValid=b=>plain(b)&&Object.keys(b).length===identityFields.length&&identityFields.every(k=>Object.hasOwn(b,k))&&accountValid(b.accountIdentity)&&text(b.adapterId,160)&&Number.isSafeInteger(b.accountRevision)&&b.accountRevision>0&&text(b.selectionKey,16384)&&text(b.sourceIdentity)&&text(b.sourceRunId)&&text(b.symbol,200)&&Number.isSafeInteger(b.quantity)&&b.quantity>0;
const nonce=()=>{if(typeof globalThis.crypto?.randomUUID!=='function')throw Error('EXECUTION_LIFECYCLE_NONCE_UNAVAILABLE');return globalThis.crypto.randomUUID();};

export function createExecutionLifecycle({now=Date.now,maxEvidenceAgeMs=2000,makePermitId=nonce}={}){
  if(typeof now!=='function'||typeof makePermitId!=='function'||!Number.isFinite(maxEvidenceAgeMs)||maxEvidenceAgeMs<=0)throw TypeError('EXECUTION_LIFECYCLE_DEPENDENCIES_REQUIRED');
  let enabled=false,sessionId=null,binding=null,connection=null,connected=false,owned=null,lastClosed=null,permit=null,baseline=null,lastSourceClosedAt=null,generation=0,reason='EXECUTION_SESSION_DISABLED';
  const consumedSignals=new Set(),attemptKeys=new Set(),issuedIds=new Set(),flatSamples=[],history=[];
  const fresh=at=>time(at)&&time(now())&&now()>=at&&now()-at<=maxEvidenceAgeMs;
  const contextMatches=(p,b,{run=true,selection=true}={})=>sameAccount(p?.accountIdentity,b?.accountIdentity)&&p?.adapterId===b?.adapterId&&p?.sourceIdentity===b?.sourceIdentity&&p?.symbol===b?.symbol&&(!run||p?.sourceRunId===b?.sourceRunId)&&(!selection||p?.accountRevision===b?.accountRevision&&p?.selectionKey===b?.selectionKey);
  const verificationValid=(p,b,{eligible=true}={})=>p?.kind==='EXECUTION_LIFECYCLE_VERIFIED_CONTEXT_V1'&&contextMatches(p,b,{run:false})&&text(p.sourceRunId)&&text(p.sampleId,512)&&fresh(p.observedAt)&&closedTime(p.latestClosedAt)&&p.connected===true&&p.nativeAccountVerified===true&&p.sourceVerified===true&&(eligible?p.adapterEligible===true:typeof p.adapterEligible==='boolean')&&p.synthetic===false&&p.testOnly===false;
  // An explicitly disabled session may continue observing an owned attempt
  // through a read-only adapter. This is not entry eligibility: enableSession
  // still requires an eligible writer, and every permit requires enabled=true.
  const connectionNeedsWriter=()=>enabled||!owned;
  const connectedFresh=()=>!!binding&&connected&&verificationValid(connection,binding,{eligible:connectionNeedsWriter()})&&connection.sourceRunId===binding.sourceRunId;
  const localSignalKey=s=>JSON.stringify([accountKey(binding.accountIdentity),binding.symbol,s.eventId]);
  const revoke=()=>{generation++;permit=null;};
  function state(){if(owned)return flatSamples.length?'CLOSED_VERIFYING':owned.status;if(!enabled)return 'INACTIVE';if(!connectedFresh())return 'DISCONNECTED';return permit&&now()<=permit.expiresAt?'ENTRY_PREPARED':'READY';}
  function snapshot(){return {version:EXECUTION_LIFECYCLE_VERSION,state:state(),reason,sessionEnabled:enabled,sessionId,connected:connectedFresh(),entryAllowed:enabled&&connectedFresh()&&!owned&&!permit,
    binding:binding?clone(binding):null,baselineClosedAt:baseline,lastSourceClosedAt,permit:permit?clone(permit):null,ownedAttempt:owned?clone(owned):null,lastClosedAttempt:lastClosed?clone(lastClosed):null,
    closureSamples:clone(flatSamples),generation,consumedSignalCount:consumedSignals.size,attemptCount:attemptKeys.size,history:clone(history),brokerActionsPerformed:false,orderAuthorizationGranted:false,riskManagement:'USER_MANAGED',postFillManagement:false};}
  const result=(ok,codes=[],extra={})=>({ok,...snapshot(),reasonCodes:codes,...extra});
  const reject=code=>{reason=code;return result(false,[code]);};
  function enableSession(value={}){
    revoke();if(owned){enabled=false;return reject('EXECUTION_OWNED_ATTEMPT_REQUIRES_RECONCILIATION');}
    if(value.enabled!==true||!text(value.sessionId,512)||!bindingValid(value.binding)){enabled=false;connected=false;return reject('EXECUTION_EXPLICIT_VALID_SESSION_REQUIRED');}
    if(!verificationValid(value.verification,value.binding)||value.verification.sourceRunId!==value.binding.sourceRunId){enabled=false;connected=false;return reject('EXECUTION_ELIGIBLE_VERIFIED_ADAPTER_CONTEXT_REQUIRED');}
    sessionId=value.sessionId;binding=clone(value.binding);connection=clone(value.verification);connected=true;enabled=true;flatSamples.length=0;baseline=connection.latestClosedAt;lastSourceClosedAt=baseline;reason='EXECUTION_WAITING_NEW_CONFIRMED_SIGNAL';return result(true);
  }
  function restoreAttempt(value={}){
    revoke();enabled=false;if(owned)return reject('EXECUTION_OWNED_ATTEMPT_REQUIRES_RECONCILIATION');
    const current=value.binding,p=value.verification,r=value.record,recordKeys=['key','accountKey','accountIdentity','eventIdentity','sourceIdentity','intentBinding','sessionId','ownerId','reservedAt','updatedAt','status','history'];
    const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k)&&Object.getOwnPropertyDescriptor(x,k)?.get===undefined&&Object.getOwnPropertyDescriptor(x,k)?.set===undefined);
    if(!text(value.sessionId,512)||!bindingValid(current)||!verificationValid(p,current,{eligible:false})||p.sourceRunId!==current.sourceRunId)return reject('EXECUTION_RECOVERY_FRESH_SELECTED_CONTEXT_REQUIRED');
    if(!exact(r,recordKeys)||!accountValid(r.accountIdentity)||r.accountKey!==accountKey(r.accountIdentity)||!['UNKNOWN','WORKING','FILLED'].includes(r.status)||!text(r.sessionId,512)||!text(r.ownerId,512)||!closedTime(r.reservedAt)||!closedTime(r.updatedAt)||r.updatedAt<r.reservedAt||r.updatedAt>now()
      ||!exact(r.eventIdentity,['eventId','symbol','direction','confirmedAt'])||!exact(r.sourceIdentity,['identityKey','runId'])||!exact(r.intentBinding,['quantity','binding','signal']))return reject('EXECUTION_RECOVERY_RECORDED_ATTEMPT_REQUIRED');
    const original=r.intentBinding.binding,s=r.intentBinding.signal,signalKeys=['eventId','direction','symbol','sourceIdentity','sourceRunId','confirmedAt','confirmationBarCloseTime','observedAt','status','synthetic','testOnly'];
    if(!bindingValid(original)||!sameAccount(original.accountIdentity,r.accountIdentity)||!sameAccount(current.accountIdentity,r.accountIdentity)||current.adapterId!==original.adapterId||current.sourceIdentity!==original.sourceIdentity||current.symbol!==original.symbol
      ||r.intentBinding.quantity!==original.quantity||r.sourceIdentity.identityKey!==original.sourceIdentity||r.sourceIdentity.runId!==original.sourceRunId||!exact(s,signalKeys)||s.status!=='CONFIRMED'||s.synthetic!==false||s.testOnly!==false||!['LONG','SHORT'].includes(s.direction)||!text(s.eventId,1024)||!closedTime(s.confirmedAt)||s.confirmationBarCloseTime!==s.confirmedAt||!time(s.observedAt)||s.observedAt>r.reservedAt||s.sourceIdentity!==original.sourceIdentity||s.sourceRunId!==original.sourceRunId||s.symbol!==original.symbol
      ||r.eventIdentity.eventId!==s.eventId||r.eventIdentity.direction!==s.direction||r.eventIdentity.symbol!==s.symbol||r.eventIdentity.confirmedAt!==s.confirmedAt)return reject('EXECUTION_RECOVERY_IMMUTABLE_BINDING_MISMATCH');
    let expectedKey;try{expectedKey=buildExecutionAttemptKey(r);}catch{return reject('EXECUTION_RECOVERY_IMMUTABLE_BINDING_MISMATCH');}if(r.key!==expectedKey)return reject('EXECUTION_RECOVERY_DURABLE_KEY_MISMATCH');
    if(!Array.isArray(r.history)||r.history.length<1||r.history.length>128||r.history[0]?.status!=='UNKNOWN'||r.history[0]?.phase!=='RESERVED_BEFORE_DISPATCH'||r.history[0]?.at!==r.reservedAt||r.history[0]?.proof!==null||r.history.at(-1)?.status!==r.status||r.history.at(-1)?.at!==r.updatedAt)return reject('EXECUTION_RECOVERY_LEDGER_HISTORY_REQUIRED');
    let lastAt=r.reservedAt,lastStatus='UNKNOWN',nativeOrderId=null;
    for(let i=0;i<r.history.length;i++){
      const h=r.history[i];if(!exact(h,['status','at','phase','proof'])||!['UNKNOWN','WORKING','FILLED'].includes(h.status)||!closedTime(h.at)||h.at<lastAt||h.at>r.updatedAt||i>0&&(lastStatus==='FILLED'&&h.status!=='FILLED'||lastStatus==='WORKING'&&h.status==='UNKNOWN'))return reject('EXECUTION_RECOVERY_LEDGER_HISTORY_REQUIRED');lastAt=h.at;lastStatus=h.status;
      if(i===0)continue;
      if(h.status==='UNKNOWN'){if(h.phase!=='DISPATCH_RESULT_UNCERTAIN'||h.proof!==null)return reject('EXECUTION_RECOVERY_LEDGER_HISTORY_REQUIRED');continue;}
      const proof=h.proof,evidence=proof?.accountEvidence;
      if(h.phase!=='ATTRIBUTED_NATIVE_RECONCILIATION'||proof?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||proof.status!==h.status||proof.intentKey!==r.key||proof.attributionVerified!==true||!equal(proof.binding,r.intentBinding)||!text(proof.nativeOrderId,512)||nativeOrderId!==null&&proof.nativeOrderId!==nativeOrderId||proof.direction!==s.direction||proof.quantity!==original.quantity||proof.synthetic===true||proof.testOnly===true
        ||!sameAccount(evidence&&Object.fromEntries(['provider','environment','nativeAccountId'].map(k=>[k,evidence[k]])),r.accountIdentity)||evidence?.kind!=='NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1'||!['PUBLIC_NATIVE_UI','AUTHORIZED_CONNECTOR'].includes(evidence.origin)||evidence.nativeIdentityVerified!==true||!matchesNativeExecutionAccountEnvironment(evidence,r.accountIdentity)||evidence.connected!==true||!closedTime(evidence.observedAt)||evidence.observedAt>h.at||h.at-evidence.observedAt>2000||evidence.synthetic===true||evidence.testOnly===true||h.status==='FILLED'&&proof.fillVerified!==true)return reject('EXECUTION_RECOVERY_LEDGER_ATTRIBUTION_REQUIRED');nativeOrderId=proof.nativeOrderId;
    }
    sessionId=value.sessionId;binding=clone(current);connection=clone(p);connected=true;baseline=Math.max(p.latestClosedAt,s.confirmedAt);lastSourceClosedAt=baseline;flatSamples.length=0;
    owned={attemptKey:r.key,status:'UNKNOWN',lastKnownStatus:null,nativeOrderId,binding:clone(original),signal:clone(s),committedAt:r.reservedAt,lastObservedAt:null,lastSampleId:null,lastProvenClosedAt:s.confirmedAt,restoredFromLedger:true,storedStatus:r.status};
    attemptKeys.add(r.key);consumedSignals.add(localSignalKey(s));reason='EXECUTION_RESTORED_UNKNOWN_READ_ONLY_RECONCILIATION_REQUIRED';return result(true);
  }
  function disconnect(code='EXECUTION_CONNECTION_LOST'){
    revoke();connected=false;connection=null;flatSamples.length=0;if(owned){owned.lastKnownStatus=owned.status;owned.status='UNKNOWN';}reason=text(code,160)?code:'EXECUTION_CONNECTION_LOST';return result(true);
  }
  function disableSession(code='EXECUTION_SESSION_DISABLED'){
    revoke();enabled=false;reason=text(code,160)?code:'EXECUTION_SESSION_DISABLED';return result(true);
  }
  function observeConnection(proof){
    if(!binding)return reject('EXECUTION_EXPLICIT_VALID_SESSION_REQUIRED');
    if(!verificationValid(proof,binding,{eligible:connectionNeedsWriter()})){
      disconnect('EXECUTION_CONNECTION_CONTEXT_UNVERIFIED');return result(false,['EXECUTION_CONNECTION_CONTEXT_UNVERIFIED']);
    }
    const recovering=!connectedFresh()||proof.sourceRunId!==binding.sourceRunId;
    if(connection&&proof.observedAt<connection.observedAt)return reject('EXECUTION_CONNECTION_EVIDENCE_REGRESSED');
    if(!recovering&&connection&&proof.latestClosedAt<connection.latestClosedAt){disconnect('EXECUTION_SOURCE_CUTOFF_REGRESSED');return result(false,['EXECUTION_SOURCE_CUTOFF_REGRESSED']);}
    if(recovering){revoke();baseline=Math.max(baseline??0,lastSourceClosedAt??0,proof.latestClosedAt);binding={...binding,sourceRunId:proof.sourceRunId};flatSamples.length=0;if(owned){owned.lastKnownStatus=owned.status;owned.status='UNKNOWN';}}
    else if(permit&&proof.latestClosedAt!==permit.signal.confirmedAt)revoke();
    connection=clone(proof);lastSourceClosedAt=Math.max(lastSourceClosedAt??0,proof.latestClosedAt);connected=true;reason=owned?'EXECUTION_OWNED_ATTEMPT_REQUIRES_RECONCILIATION':enabled?'EXECUTION_WAITING_NEW_CONFIRMED_SIGNAL':'EXECUTION_SESSION_DISABLED';return result(true);
  }
  function considerSignal(signal){
    if(!enabled)return reject('EXECUTION_SESSION_DISABLED');
    if(owned)return reject('EXECUTION_OWNED_ATTEMPT_REQUIRES_RECONCILIATION');
    if(!connectedFresh()){disconnect('EXECUTION_CONNECTION_FRESHNESS_REQUIRED');return result(false,['EXECUTION_CONNECTION_FRESHNESS_REQUIRED']);}
    if(permit)return reject('EXECUTION_ENTRY_PERMIT_ALREADY_OUTSTANDING');
    if(!plain(signal)||signal.status!=='CONFIRMED'||!text(signal.eventId,1024)||!['LONG','SHORT'].includes(signal.direction)||signal.symbol!==binding.symbol||signal.sourceIdentity!==binding.sourceIdentity||signal.sourceRunId!==binding.sourceRunId
      ||!closedTime(signal.confirmedAt)||signal.confirmationBarCloseTime!==signal.confirmedAt||signal.confirmedAt!==connection.latestClosedAt||!fresh(signal.observedAt)||signal.synthetic!==false||signal.testOnly!==false)return reject('EXECUTION_FRESH_SOURCE_BOUND_CONFIRMED_SIGNAL_REQUIRED');
    if(signal.confirmedAt<=baseline)return reject('EXECUTION_HISTORICAL_OR_BASELINE_SIGNAL_FORBIDDEN');
    const signalKey=localSignalKey(signal);if(consumedSignals.has(signalKey))return reject('EXECUTION_SIGNAL_ALREADY_CONSUMED');
    let id;try{id=makePermitId();}catch{return reject('EXECUTION_PERMIT_NONCE_REQUIRED');}if(!text(id,512)||issuedIds.has(id))return reject('EXECUTION_UNIQUE_PERMIT_REQUIRED');issuedIds.add(id);
    const at=now(),expiresAt=Math.min(at+maxEvidenceAgeMs,signal.observedAt+maxEvidenceAgeMs,connection.observedAt+maxEvidenceAgeMs);
    if(!time(at)||!time(expiresAt)||expiresAt<at)return reject('EXECUTION_PERMIT_TIME_INVALID');
    permit={kind:'EXECUTION_LIFECYCLE_ENTRY_PERMIT',version:EXECUTION_LIFECYCLE_VERSION,id,generation,sessionId,binding:clone(binding),signal:{eventId:signal.eventId,direction:signal.direction,symbol:signal.symbol,sourceIdentity:signal.sourceIdentity,sourceRunId:signal.sourceRunId,confirmedAt:signal.confirmedAt,confirmationBarCloseTime:signal.confirmationBarCloseTime,observedAt:signal.observedAt,status:'CONFIRMED',synthetic:false,testOnly:false},issuedAt:at,expiresAt,scope:'ONE_LOCAL_ATTEMPT_CONTEXT_NOT_BROKER_AUTHORIZATION',orderAuthorizationGranted:false};
    reason='EXECUTION_ENTRY_CONTEXT_PREPARED';return result(true,[],{permit:clone(permit)});
  }
  function commitAttempt(candidate,{attemptKey}={}){
    if(!enabled||!connectedFresh()||owned||!permit||!equal(candidate,permit)||candidate.generation!==generation||!text(attemptKey,8192)||attemptKeys.has(attemptKey)||now()<permit.issuedAt||now()>permit.expiresAt||permit.signal.confirmedAt!==connection.latestClosedAt||!equal(permit.binding,binding))return reject('EXECUTION_ENTRY_PERMIT_INVALID_OR_CONSUMED');
    const signalKey=localSignalKey(permit.signal);if(consumedSignals.has(signalKey))return reject('EXECUTION_SIGNAL_ALREADY_CONSUMED');
    consumedSignals.add(signalKey);attemptKeys.add(attemptKey);
    owned={attemptKey,status:'UNKNOWN',lastKnownStatus:null,nativeOrderId:null,binding:clone(binding),signal:clone(permit.signal),committedAt:now(),lastObservedAt:null,lastSampleId:null,lastProvenClosedAt:permit.signal.confirmedAt};
    revoke();flatSamples.length=0;reason='EXECUTION_ATTEMPT_COMMITTED_RECONCILIATION_REQUIRED';return result(true);
  }
  function observeOwnedState(proof){
    if(!owned)return reject('EXECUTION_OWNED_ATTEMPT_REQUIRED');
    const b=owned.binding;
    const baseValid=proof?.kind==='EXECUTION_LIFECYCLE_OWNED_STATE_V1'&&contextMatches(proof,b,{run:false,selection:false})&&text(proof.sourceRunId)&&proof.attemptKey===owned.attemptKey&&text(proof.sampleId,512)&&fresh(proof.observedAt)&&closedTime(proof.latestClosedAt)
      &&proof.latestClosedAt>=owned.lastProvenClosedAt&&proof.nativeAccountVerified===true&&proof.sourceVerified===true&&proof.ownershipVerified===true&&proof.accountScope==='EXACT_NATIVE_ACCOUNT'&&proof.positionsComplete===true&&proof.workingOrdersComplete===true&&Array.isArray(proof.positions)&&Array.isArray(proof.workingOrders)&&proof.synthetic===false&&proof.testOnly===false;
    if(!baseValid){revoke();flatSamples.length=0;owned.lastKnownStatus=owned.status;owned.status='UNKNOWN';return reject('EXECUTION_FRESH_OWNED_ACCOUNT_SCOPE_PROOF_REQUIRED');}
    if(owned.lastObservedAt!==null&&(proof.observedAt<=owned.lastObservedAt||proof.sampleId===owned.lastSampleId))return reject('EXECUTION_DISTINCT_INCREASING_NATIVE_SAMPLE_REQUIRED');
    if(connectedFresh()&&proof.sourceRunId!==binding.sourceRunId)return reject('EXECUTION_RECONCILIATION_SOURCE_RUN_CHANGED');
    let valid=false;
    const sameOrder=text(proof.nativeOrderId,512)&&(owned.nativeOrderId===null||owned.nativeOrderId===proof.nativeOrderId);
    if(proof.status==='FILLED')valid=sameOrder&&proof.positions.length===1&&proof.positions[0]?.symbol===b.symbol&&proof.positions[0]?.direction===owned.signal.direction&&proof.positions[0]?.quantity===b.quantity;
    else if(proof.status==='WORKING')valid=sameOrder&&proof.positions.length===0&&proof.workingOrders.length>0&&proof.workingOrders.some(o=>o?.symbol===b.symbol&&o?.attemptKey===owned.attemptKey&&o.orderId===proof.nativeOrderId);
    else if(proof.status==='CLOSED')valid=sameOrder&&proof.closedVerified===true&&proof.positions.length===0&&proof.workingOrders.length===0;
    else if(proof.status==='UNKNOWN')valid=true;
    if(!valid){revoke();flatSamples.length=0;owned.lastKnownStatus=owned.status;owned.status='UNKNOWN';return reject('EXECUTION_OWNED_STATE_NOT_PROVEN');}
    owned.lastObservedAt=proof.observedAt;owned.lastSampleId=proof.sampleId;owned.lastProvenClosedAt=proof.latestClosedAt;owned.lastKnownStatus=owned.status;owned.status=proof.status;if(proof.status!=='UNKNOWN')owned.nativeOrderId=proof.nativeOrderId;
    if(proof.status==='CLOSED'){
      const sample={sampleId:proof.sampleId,observedAt:proof.observedAt,latestClosedAt:proof.latestClosedAt,attemptKey:proof.attemptKey,accountIdentity:clone(proof.accountIdentity),sourceIdentity:proof.sourceIdentity,sourceRunId:proof.sourceRunId,symbol:proof.symbol,positionsComplete:true,workingOrdersComplete:true,positions:[],workingOrders:[],ownershipVerified:true};
      flatSamples.push(sample);
      if(flatSamples.length<2){reason='EXECUTION_SECOND_COMPLETE_CLOSURE_SAMPLE_REQUIRED';return result(true);}
      baseline=Math.max(baseline??0,proof.latestClosedAt,connection?.latestClosedAt??0,owned.signal.confirmedAt);
      lastClosed={...clone(owned),status:'CLOSED',closureSamples:clone(flatSamples),closedVerifiedAt:proof.observedAt};history.push({attemptKey:owned.attemptKey,status:'CLOSED',signalEventId:owned.signal.eventId,closedVerifiedAt:proof.observedAt});owned=null;flatSamples.length=0;revoke();reason=enabled?'EXECUTION_WAITING_NEXT_NEW_CONFIRMED_SIGNAL':'EXECUTION_SESSION_DISABLED';return result(true);
    }
    flatSamples.length=0;reason=proof.status==='UNKNOWN'?'EXECUTION_UNRESOLVED_NATIVE_ATTEMPT':'EXECUTION_OWNED_'+proof.status;return result(true);
  }
  return Object.freeze({enableSession,restoreAttempt,observeConnection,considerSignal,commitAttempt,observeOwnedState,disconnect,disableSession,snapshot});
}
