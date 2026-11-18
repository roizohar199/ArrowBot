import {createExecutionLifecycle} from './execution-lifecycle.mjs';
import {buildExecutionAttemptKey} from './execution-attempt-ledger.mjs';

// Connects a trusted, account-specific adapter to lifecycle + durable claims.
// There is no default broker, source, auto-start, order gesture or risk plan.
const clone=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b)=>canonical(a)===canonical(b);
const reason=value=>value?.reason??value?.reasonCodes?.[0]??value?.message??'EXECUTION_SESSION_OPERATION_FAILED';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function createExecutionSessionRunner({ledger,readConnection,readSignal,prepareEntry,dispatchEntry,readOwnedState,now=Date.now,resumeAfterVerifiedRecovery=false,onChange=()=>{},makeSessionId=()=>crypto.randomUUID()}={}){
  if(typeof resumeAfterVerifiedRecovery!=='boolean')throw TypeError('EXECUTION_RECOVERY_RESUME_BOOLEAN_REQUIRED');
  if(!ledger||['claimSession','renewSession','validateSession','reserve','mark','recover'].some(key=>typeof ledger[key]!=='function')||[readConnection,readSignal,prepareEntry,dispatchEntry,readOwnedState,now,onChange,makeSessionId].some(fn=>typeof fn!=='function'))throw TypeError('EXECUTION_SESSION_TRUSTED_ADAPTER_DEPENDENCIES_REQUIRED');
  let lifecycle=createExecutionLifecycle({now});
  let status='INACTIVE',lastReason='USER_START_REQUIRED',running=false,busy=false,generation=0,session=null,record=null,lastConnection=null,dispatchCount=0,recovered=false;
  const connectionHistory=[];
  const snapshot=()=>({version:'execution-session-runner-1',status,reason:lastReason,running,busy,generation,session:clone(session),ownedRecord:clone(record),lifecycle:lifecycle.snapshot(),connectionHistory:clone(connectionHistory),dispatchCount,riskManagement:'USER_MANAGED',postFillManagement:false,orderAuthorizationGranted:false});
  function publish(next,code){if(next!==status||code!==lastReason){connectionHistory.push({at:now(),status:next,reason:code,baselineClosedAt:lifecycle.snapshot().baselineClosedAt});if(connectionHistory.length>30)connectionHistory.shift();}status=next;lastReason=code;const result=snapshot();onChange(clone(result));return result;}
  function valid(token){return running&&generation===token;}
  async function connection(token){
    const observed=await readConnection();
    if(!valid(token))throw Error('EXECUTION_SESSION_CONTEXT_CHANGED');
    if(observed?.kind==='EXECUTION_SESSION_CONNECTION_PENDING_V1'){
      if(!exactKeys(observed,['kind','binding','observedAt','reason'])||!lastConnection||!same(observed.binding,lastConnection.binding)
        ||observed.reason!=='NATIVE_COHERENT_SOURCE_FRAME_PENDING'||!Number.isSafeInteger(observed.observedAt)||observed.observedAt>now()||now()-observed.observedAt>2000
        ||now()-lastConnection.verification.observedAt<0||now()-lastConnection.verification.observedAt>2000)throw Error('EXECUTION_PENDING_CONNECTION_EXPIRED_OR_CHANGED');
      return observed;
    }
    if(!observed?.binding||!observed?.verification)throw Error('EXECUTION_AUTHORIZED_CONNECTION_REQUIRED');
    lastConnection=clone(observed);return observed;
  }
  async function start(){
    if(busy)return snapshot();
    if(running)return snapshot();
    running=true;busy=true;const token=++generation;
    try{
      const current=await connection(token),sessionId=session&&same(session.accountIdentity,current.binding.accountIdentity)?session.sessionId:makeSessionId();
      const held=await ledger.claimSession({accountIdentity:current.binding.accountIdentity,sessionId,ttlMs:15000});
      if(!valid(token))return snapshot();
      if(!held.ok)throw Error(reason(held));session=held.session;
      const recoveredState=await ledger.recover({accountIdentity:current.binding.accountIdentity});
      if(!valid(token))return snapshot();
      if(!recoveredState.ok)throw Error(reason(recoveredState));
      if(recoveredState.unresolved.length){
        if(recoveredState.unresolved.length!==1)throw Error('EXECUTION_MULTIPLE_UNRESOLVED_ATTEMPTS_REQUIRE_REVIEW');
        record=recoveredState.unresolved[0];recovered=true;lifecycle=createExecutionLifecycle({now});
        const restored=lifecycle.restoreAttempt({sessionId,binding:current.binding,verification:current.verification,record});
        if(!restored.ok)throw Error(reason(restored));
        return publish('RECOVERY_REQUIRED','RESTART_REQUIRES_READ_ONLY_NATIVE_RECONCILIATION');
      }
      const enabled=lifecycle.enableSession({sessionId,enabled:true,binding:current.binding,verification:current.verification});
      if(!enabled.ok)throw Error(reason(enabled));recovered=false;record=null;
      return publish('WAITING_NEW_SIGNAL','CURRENT_SOURCE_BASELINE_ESTABLISHED');
    }catch(error){running=false;lifecycle.disableSession(reason(error));return publish('NOT_READY',String(reason(error)).slice(0,180));}
    finally{busy=false;onChange(snapshot());}
  }
  function disconnect(code='EXECUTION_CONNECTION_LOST'){generation++;lifecycle.disconnect(code);return publish('DISCONNECTED',code);}
  async function renewForWork(token,current){
    let renewed=await ledger.renewSession({session,ttlMs:15000});
    if(!renewed.ok&&renewed.reason==='EXECUTION_LEDGER_SESSION_EXPIRED_OR_CHANGED')renewed=await ledger.claimSession({accountIdentity:current.binding.accountIdentity,sessionId:session.sessionId,ttlMs:15000});
    if(!valid(token))return false;if(!renewed.ok)throw Error(reason(renewed));session=renewed.session;return true;
  }
  async function reconcileOwned(token,current){
    const native=await readOwnedState({record:clone(record),binding:clone(current.binding),verification:clone(current.verification),lifecycle:lifecycle.snapshot()});
    if(!valid(token))return snapshot();
    if(native?.kind==='EXECUTION_SESSION_NATIVE_RECONCILIATION_PENDING_V1'||plain(native)&&Object.hasOwn(native,'pending')){
      const at=now(),binding=current.binding;
      if(!exactKeys(native,['kind','pending','attemptKey','binding','observedAt'])||native.kind!=='EXECUTION_SESSION_NATIVE_RECONCILIATION_PENDING_V1'||native.pending!==true||native.attemptKey!==record.key
        ||!exactKeys(native.binding,Object.keys(binding))||!exactKeys(native.binding.accountIdentity,Object.keys(binding.accountIdentity))||!same(native.binding,binding)
        ||!Number.isSafeInteger(native.observedAt)||native.observedAt<0||native.observedAt>at||at-native.observedAt>2000)throw Error('EXECUTION_NATIVE_PENDING_CONTEXT_MISMATCH');
      // A passive observation is neither a new inventory sample nor a fill or
      // closure proof. Keep ownership untouched and do not write the ledger.
      const owned=lifecycle.snapshot().ownedAttempt,next=owned?.status==='FILLED'?'FILLED':recovered||['RECOVERY_REQUIRED','DISCONNECTED'].includes(status)?'RECOVERY_REQUIRED':'RECONCILIATION_REQUIRED';
      return publish(next,'NATIVE_RECONCILIATION_PENDING_NO_NEW_EVIDENCE');
    }
    if(!await renewForWork(token,current))return snapshot();
    const observed=lifecycle.observeOwnedState(native?.lifecycleProof);
    if(!observed.ok)return publish('RECOVERY_REQUIRED',reason(observed));
    const closed=observed.ownedAttempt===null&&observed.lastClosedAttempt?.attemptKey===record.key;
    const next=closed?'CLOSED':observed.ownedAttempt?.status;
    if(closed||['FILLED','WORKING'].includes(next)&&record.status!==next){
      const proof=native?.ledgerProof;
      if(closed&&!same(proof?.closureSamples,observed.lastClosedAttempt.closureSamples)){restoreForFinalization(current);return publish('RECOVERY_REQUIRED','CLOSURE_RECEIPTS_DO_NOT_MATCH_OBSERVED_SAMPLES');}
      const marked=await ledger.mark({key:record.key,session,status:next,proof});
      if(!valid(token))return snapshot();
      if(!marked.ok){if(closed)restoreForFinalization(current);else lifecycle.disableSession(reason(marked));return publish('RECOVERY_REQUIRED',reason(marked));}
      record=marked.record;
    }
    if(closed){
      record=null;
      if(recovered&&!resumeAfterVerifiedRecovery){running=false;recovered=false;return publish('CLOSED_REVIEW_REQUIRED','RECOVERED_CLOSURE_NEEDS_EXPLICIT_NEW_START');}
      recovered=false;
      if(!lifecycle.snapshot().sessionEnabled){const enabled=lifecycle.enableSession({sessionId:session.sessionId,enabled:true,binding:current.binding,verification:current.verification});if(!enabled.ok){running=false;return publish('NOT_READY',reason(enabled));}}
      return publish('WAITING_NEXT_SIGNAL','OWNED_POSITION_CLOSED_NO_WORKING_ORDERS_TWO_DISTINCT_READS');
    }
    return publish(observed.state,observed.reason);
  }
  function restoreForFinalization(current){
    lifecycle=createExecutionLifecycle({now});
    const restored=lifecycle.restoreAttempt({sessionId:session.sessionId,binding:current.binding,verification:current.verification,record});
    if(!restored.ok){running=false;publish('RECOVERY_REQUIRED',reason(restored));}
  }
  async function finishNotSubmitted(current,proof,token){
    if(!record||record.status!=='UNKNOWN'||proof?.status!=='NOT_SUBMITTED'||proof.intentKey!==record.key)throw Error('EXECUTION_EXACT_NOT_SUBMITTED_PROOF_REQUIRED');
    if(!await renewForWork(token,current))return snapshot();const marked=await ledger.mark({key:record.key,session,status:'NOT_SUBMITTED',proof});if(!valid(token))return snapshot();if(!marked.ok)throw Error(reason(marked));
    record=null;recovered=false;lifecycle=createExecutionLifecycle({now});const enabled=lifecycle.enableSession({sessionId:session.sessionId,enabled:true,binding:current.binding,verification:current.verification});if(!enabled.ok){running=false;return publish('NOT_READY',reason(enabled));}
    return publish('WAITING_NEW_SIGNAL','NATIVE_NON_SUBMISSION_PROVEN_OLD_EVENT_RETAINED');
  }
  async function resolveNotSubmitted(proof){if(!running||busy)return snapshot();busy=true;const token=generation;try{const current=await connection(token);return await finishNotSubmitted(current,proof,token);}catch(error){return publish('RECOVERY_REQUIRED',String(reason(error)).slice(0,180));}finally{busy=false;onChange(snapshot());}}
  async function tick(){
    if(!running||busy)return snapshot();busy=true;const token=generation;
    try{
      const current=await connection(token);
      if(!session)throw Error('EXECUTION_ACCOUNT_SESSION_REQUIRED');
      if(current.kind==='EXECUTION_SESSION_CONNECTION_PENDING_V1')return publish('WAITING_SOURCE_FRAME','NATIVE_COHERENT_SOURCE_FRAME_PENDING');
      const observed=lifecycle.observeConnection(current.verification);
      if(!observed.ok)throw Error(reason(observed));
      if(!same(lifecycle.snapshot().binding,current.binding)){
        lifecycle.disableSession('EXECUTION_ACCOUNT_OR_QUANTITY_CONTEXT_CHANGED');running=false;return publish('NOT_READY','EXECUTION_ACCOUNT_OR_QUANTITY_CONTEXT_CHANGED');
      }
      if(record)return await reconcileOwned(token,current);
      if(!await renewForWork(token,current))return snapshot();
      const signal=await readSignal({binding:clone(current.binding),verification:clone(current.verification)});
      if(!valid(token))return snapshot();
      if(!signal)return publish('WAITING_NEW_SIGNAL','NO_NEW_CONFIRMED_STRATEGY');
      const prepared=lifecycle.considerSignal(signal);
      if(!prepared.ok)return publish('WAITING_NEW_SIGNAL',reason(prepared));
      const permit=prepared.permit,eventIdentity={eventId:permit.signal.eventId,symbol:permit.binding.symbol,direction:permit.signal.direction,confirmedAt:permit.signal.confirmedAt};
      const key=buildExecutionAttemptKey({accountIdentity:permit.binding.accountIdentity,eventIdentity});
      const nativePrepared=await prepareEntry({permit:clone(permit),attemptKey:key});
      if(!valid(token))return snapshot();
      if(nativePrepared?.status!=='READY')throw Error(reason(nativePrepared));
      if(nativePrepared.kind!=='EXECUTION_SESSION_NATIVE_PREPARATION_V1'||!same(nativePrepared.binding,permit.binding)||nativePrepared.direction!==permit.signal.direction||nativePrepared.quantity!==permit.binding.quantity||typeof nativePrepared.privateLeaseId!=='string'||!nativePrepared.privateLeaseId||!Number.isFinite(nativePrepared.expiresAt)||nativePrepared.expiresAt>permit.expiresAt||nativePrepared.expiresAt<now())throw Error('EXECUTION_NATIVE_PREPARATION_MISMATCH');
      const revalidated=await connection(token);
      const refreshed=lifecycle.observeConnection(revalidated.verification);
      if(!refreshed.ok||!same(revalidated.binding,permit.binding)||revalidated.verification.latestClosedAt!==permit.signal.confirmedAt)throw Error('EXECUTION_ACCOUNT_SOURCE_CHANGED_BEFORE_RESERVATION');
      const reserved=await ledger.reserve({key,accountIdentity:permit.binding.accountIdentity,eventIdentity,session,
        sourceIdentity:{identityKey:permit.binding.sourceIdentity,runId:permit.binding.sourceRunId},
        intentBinding:{quantity:permit.binding.quantity,binding:clone(permit.binding),signal:clone(permit.signal)}});
      if(!valid(token))return snapshot();
      if(!reserved.ok)throw Error(reason(reserved));record=reserved.record;
      const committed=lifecycle.commitAttempt(permit,{attemptKey:key});
      if(!committed.ok){running=false;return publish('RECOVERY_REQUIRED','DURABLE_EVENT_CONSUMED_WITHOUT_DISPATCH_PERMISSION');}
      const held=await ledger.validateSession({session});
      if(!valid(token))return snapshot();
      if(!held.ok)throw Error(reason(held));
      if(now()>permit.expiresAt||now()>nativePrepared.expiresAt||!lifecycle.snapshot().connected){lifecycle.disconnect('EXECUTION_NATIVE_DISPATCH_LEASE_EXPIRED');return publish('RECOVERY_REQUIRED','DURABLE_EVENT_CONSUMED_WITHOUT_DISPATCH_PERMISSION');}
      // The adapter must recheck its native account/source lease at dispatch.
      // UNKNOWN is already durable and locally owned before this single call.
      dispatchCount++;
      const dispatched=await dispatchEntry({permit:clone(permit),attemptKey:key,nativePrepared:clone(nativePrepared),record:clone(record)});
      if(!valid(token))return snapshot();
      if(dispatched?.notSubmittedProof)return await finishNotSubmitted(revalidated,dispatched.notSubmittedProof,token);
      return publish('RECONCILIATION_REQUIRED','DISPATCH_ACK_IS_NOT_A_FILL');
    }catch(error){if(valid(token)){lifecycle.disconnect(reason(error));return publish('DISCONNECTED',String(reason(error)).slice(0,180));}return snapshot();}
    finally{busy=false;onChange(snapshot());}
  }
  function stop(code='USER_SESSION_STOPPED'){running=false;generation++;lifecycle.disableSession(code);return publish(record?'RECOVERY_REQUIRED':'INACTIVE',code);}
  return Object.freeze({start,tick,disconnect,stop,resolveNotSubmitted,snapshot});
}
