// Durable, provider-neutral execution claims. This module never contacts a
// broker or submits an order. UNKNOWN is persisted before dispatch; expiry of
// a window/session lease never erases an unresolved attempt.
export const EXECUTION_ATTEMPT_STORAGE_KEY='arrow.executionAttemptLedger.v1';
export const EXECUTION_ATTEMPT_LOCK_NAME='arrow-execution-attempt-ledger-v1';
const clone=x=>structuredClone(x),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const json=x=>{
  if(x===null||typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
  if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);
  if(Array.isArray(x))return '['+x.map(json).join(',')+']';
  if(plain(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+json(x[k])).join(',')+'}';
  throw Error('EXECUTION_LEDGER_JSON_REQUIRED');
};
function account(value){
  if(!plain(value)||!text(value.provider,100)||!text(value.environment,100)||!text(value.nativeAccountId))throw Error('EXECUTION_LEDGER_ACCOUNT_IDENTITY_REQUIRED');
  // Profile labels, aliases, revisions and sizing never change native identity.
  return {provider:value.provider,environment:value.environment,nativeAccountId:value.nativeAccountId};
}
const accountKey=value=>json(Object.values(account(value)));
const USER_DECLARED_ENVIRONMENT_BASIS='USER_DECLARED_PROFILE_NOT_BROKER_ATTESTED';
/** Exact selected account environment, without turning a profile label into a
 * broker attestation. Tradovate's public UI identifies the native account but
 * does not attest PA/LIVE/DEMO/EVALUATION, so that limited evidence stays explicit.
 */
export function matchesNativeExecutionAccountEnvironment(evidence,expected){
  if(!plain(evidence)||!plain(expected)||!['provider','environment','nativeAccountId'].every(key=>text(expected[key])&&evidence[key]===expected[key]))return false;
  if(evidence.environmentVerified===true)return evidence.environmentBasis!==USER_DECLARED_ENVIRONMENT_BASIS;
  return expected.provider==='TRADOVATE'&&['DEMO','EVALUATION','PA','LIVE'].includes(expected.environment)
    &&evidence.environmentVerified===false&&evidence.environmentBasis===USER_DECLARED_ENVIRONMENT_BASIS
    &&evidence.origin==='PUBLIC_NATIVE_UI'&&evidence.nativeIdentityVerified===true;
}
function event(value){
  if(!plain(value)||!text(value.eventId,4096)||!text(value.symbol)||!['LONG','SHORT'].includes(value.direction)||!time(value.confirmedAt))throw Error('EXECUTION_LEDGER_EVENT_IDENTITY_REQUIRED');
  return {eventId:value.eventId,symbol:value.symbol,direction:value.direction,confirmedAt:value.confirmedAt};
}
export function buildExecutionAttemptKey({accountIdentity,eventIdentity}={}){
  const a=account(accountIdentity),e=event(eventIdentity);
  return ['execution-attempt-1',a.provider,a.environment,a.nativeAccountId,e.symbol,e.eventId].map(encodeURIComponent).join(':');
}
const TERMINAL=new Set(['CLOSED','CANCELLED','NOT_SUBMITTED']);
const STATES=new Set(['UNKNOWN','WORKING','FILLED',...TERMINAL]);
const fail=reason=>({ok:false,reason});
const token=()=>{if(typeof globalThis.crypto?.randomUUID!=='function')throw Error('EXECUTION_LEDGER_TOKEN_REQUIRED');return crypto.randomUUID();};

/** Storage and Web Locks must be shared by all execution windows. Successful
 * reserve is a consumed event, not permission to retry. Recovered UNKNOWN,
 * WORKING or FILLED claims block new entries for the whole native account.
 */
export function createExecutionAttemptLedger({storage,locks,now=Date.now,ownerId,makeToken=token,maxAttempts=2048}={}){
  if(typeof now!=='function'||typeof makeToken!=='function'||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>4096)throw Error('EXECUTION_LEDGER_CONFIGURATION_REQUIRED');
  const owner=ownerId??makeToken();if(!text(owner))throw Error('EXECUTION_LEDGER_OWNER_REQUIRED');
  const at=()=>{const value=now();if(!time(value))throw Error('EXECUTION_LEDGER_CLOCK_REQUIRED');return value;};
  const ttl=value=>{const duration=value??15000;if(!Number.isSafeInteger(duration)||duration<1000||duration>60000)throw Error('EXECUTION_LEDGER_SESSION_TTL_REQUIRED');return duration;};
  function validSession(s){
    return exact(s,['kind','accountIdentity','accountKey','sessionId','ownerId','token','issuedAt','expiresAt'])&&s.kind==='EXECUTION_ACCOUNT_SESSION_LEASE'
      &&text(s.sessionId)&&text(s.ownerId)&&text(s.token)&&time(s.issuedAt)&&time(s.expiresAt)&&s.expiresAt>s.issuedAt&&s.accountKey===accountKey(s.accountIdentity)&&json(s.accountIdentity)===json(account(s.accountIdentity));
  }
  function validate(raw){
    if(!exact(raw,['schemaVersion','revision','updatedAt','sessions','attempts'])||raw.schemaVersion!==1||!time(raw.revision)||!time(raw.updatedAt)||!Array.isArray(raw.sessions)||raw.sessions.length>128||!Array.isArray(raw.attempts)||raw.attempts.length>maxAttempts)throw Error('EXECUTION_LEDGER_INVALID_STORAGE');
    const sessionKeys=new Set(),attemptKeys=new Set();
    for(const s of raw.sessions){if(!validSession(s)||sessionKeys.has(s.accountKey))throw Error('EXECUTION_LEDGER_INVALID_SESSION');sessionKeys.add(s.accountKey);}
    for(const r of raw.attempts){
      if(!exact(r,['key','accountKey','accountIdentity','eventIdentity','sourceIdentity','intentBinding','sessionId','ownerId','reservedAt','updatedAt','status','history'])||r.key!==buildExecutionAttemptKey(r)||r.accountKey!==accountKey(r.accountIdentity)
        ||json(r.accountIdentity)!==json(account(r.accountIdentity))||json(r.eventIdentity)!==json(event(r.eventIdentity))||!plain(r.sourceIdentity)||!plain(r.intentBinding)||json(r.sourceIdentity).length>8192||json(r.intentBinding).length>65536
        ||!text(r.sessionId)||!text(r.ownerId)||!time(r.reservedAt)||!time(r.updatedAt)||r.updatedAt<r.reservedAt||!STATES.has(r.status)||!Array.isArray(r.history)||!r.history.length||r.history.length>128||attemptKeys.has(r.key))throw Error('EXECUTION_LEDGER_INVALID_ATTEMPT');
      let previous=r.reservedAt,previousStatus='UNKNOWN',nativeOrderId=null;
      for(let i=0;i<r.history.length;i++){
        const h=r.history[i];if(!exact(h,['status','at','phase','proof'])||!STATES.has(h.status)||!time(h.at)||h.at<previous||!text(h.phase,160)||h.proof!==null&&(!plain(h.proof)||json(h.proof).length>131072))throw Error('EXECUTION_LEDGER_INVALID_HISTORY');
        if(i>0){
          if(TERMINAL.has(previousStatus)||previousStatus==='FILLED'&&['UNKNOWN','WORKING','NOT_SUBMITTED','CANCELLED'].includes(h.status)||previousStatus==='WORKING'&&['UNKNOWN','NOT_SUBMITTED'].includes(h.status))throw Error('EXECUTION_LEDGER_INVALID_HISTORY');
          if(h.status==='UNKNOWN'){if(h.proof!==null||h.phase!=='DISPATCH_RESULT_UNCERTAIN')throw Error('EXECUTION_LEDGER_INVALID_HISTORY');}
          else{if(h.phase!=='ATTRIBUTED_NATIVE_RECONCILIATION')throw Error('EXECUTION_LEDGER_INVALID_HISTORY');proofFor(r,h.status,h.proof,h.at);if(nativeOrderId&&h.proof.nativeOrderId!==nativeOrderId)throw Error('EXECUTION_LEDGER_ORDER_ID_CHANGED');nativeOrderId??=h.proof.nativeOrderId??null;}
        }
        previous=h.at;previousStatus=h.status;
      }
      if(r.history[0].status!=='UNKNOWN'||r.history[0].at!==r.reservedAt||r.history[0].phase!=='RESERVED_BEFORE_DISPATCH'||r.history[0].proof!==null||r.history.at(-1).status!==r.status||r.history.at(-1).at!==r.updatedAt||r.updatedAt>raw.updatedAt)throw Error('EXECUTION_LEDGER_INVALID_HISTORY');
      attemptKeys.add(r.key);
    }
    return raw;
  }
  async function load(){
    const raw=(await storage.get(EXECUTION_ATTEMPT_STORAGE_KEY))?.[EXECUTION_ATTEMPT_STORAGE_KEY],t=at();
    const value=raw===undefined?{schemaVersion:1,revision:0,updatedAt:t,sessions:[],attempts:[]}:validate(raw);
    if(value.updatedAt>t)throw Error('EXECUTION_LEDGER_CLOCK_REVERSED');return clone(value);
  }
  async function save(state){
    if(state.revision>=Number.MAX_SAFE_INTEGER)throw Error('EXECUTION_LEDGER_REVISION_EXHAUSTED');state.revision++;state.updatedAt=at();validate(state);
    await storage.set({[EXECUTION_ATTEMPT_STORAGE_KEY]:state});
    const saved=(await storage.get(EXECUTION_ATTEMPT_STORAGE_KEY))?.[EXECUTION_ATTEMPT_STORAGE_KEY];
    try{validate(saved);if(json(saved)!==json(state))throw Error();}catch{throw Error('EXECUTION_LEDGER_WRITE_NOT_VERIFIED');}
  }
  async function atomic(operation){
    if(typeof storage?.get!=='function'||typeof storage?.set!=='function'||typeof locks?.request!=='function')return fail('EXECUTION_DURABLE_LEDGER_REQUIRED');
    try{return await locks.request(EXECUTION_ATTEMPT_LOCK_NAME,{mode:'exclusive'},async()=>operation(await load()));}
    catch(error){return fail(text(error?.message,160)?error.message:'EXECUTION_LEDGER_OPERATION_FAILED');}
  }
  const unresolved=(state,key)=>state.attempts.filter(r=>r.accountKey===key&&!TERMINAL.has(r.status));
  function held(state,session){
    if(!validSession(session)||session.ownerId!==owner)throw Error('EXECUTION_LEDGER_SESSION_REQUIRED');
    const saved=state.sessions.find(s=>s.accountKey===session.accountKey);
    if(!saved||json(saved)!==json(session)||saved.expiresAt<=at())throw Error('EXECUTION_LEDGER_SESSION_EXPIRED_OR_CHANGED');return saved;
  }
  async function claimSession({accountIdentity,sessionId,ttlMs}={}){return atomic(async state=>{
    const identity=account(accountIdentity),key=accountKey(identity),t=at(),duration=ttl(ttlMs);
    if(!text(sessionId))throw Error('EXECUTION_LEDGER_SESSION_REQUIRED');
    const current=state.sessions.find(s=>s.accountKey===key);
    if(current&&current.expiresAt>t){
      if(current.ownerId!==owner||current.sessionId!==sessionId)return fail('EXECUTION_LEDGER_ACCOUNT_SESSION_OWNED');
      return {ok:true,status:'SESSION_HELD',session:clone(current),entryBlocked:unresolved(state,key).length>0};
    }
    state.sessions=state.sessions.filter(s=>s.expiresAt>t&&s.accountKey!==key);if(state.sessions.length>=128)throw Error('EXECUTION_LEDGER_SESSION_CAPACITY_REACHED');
    const leaseToken=makeToken();if(!text(leaseToken)||state.sessions.some(s=>s.token===leaseToken))throw Error('EXECUTION_LEDGER_UNIQUE_TOKEN_REQUIRED');
    const session={kind:'EXECUTION_ACCOUNT_SESSION_LEASE',accountIdentity:identity,accountKey:key,sessionId,ownerId:owner,token:leaseToken,issuedAt:t,expiresAt:t+duration};
    state.sessions.push(session);await save(state);held(state,session);return {ok:true,status:'SESSION_HELD',session:clone(session),entryBlocked:unresolved(state,key).length>0};
  });}
  async function renewSession({session,ttlMs}={}){return atomic(async state=>{
    const current=held(state,session);current.expiresAt=at()+ttl(ttlMs);await save(state);held(state,current);return {ok:true,status:'SESSION_HELD',session:clone(current),entryBlocked:unresolved(state,current.accountKey).length>0};
  });}
  async function validateSession({session}={}){return atomic(state=>{const current=held(state,session);return {ok:true,status:'SESSION_HELD',session:clone(current),entryBlocked:unresolved(state,current.accountKey).length>0};});}
  async function releaseSession({session}={}){return atomic(async state=>{
    const current=held(state,session);state.sessions=state.sessions.filter(s=>s!==current);await save(state);return {ok:true,status:'SESSION_RELEASED',unresolvedAttempts:unresolved(state,current.accountKey).length};
  });}
  async function reserve({key,accountIdentity,eventIdentity,session,sourceIdentity,intentBinding}={}){return atomic(async state=>{
    const a=account(accountIdentity),e=event(eventIdentity),current=held(state,session),computed=buildExecutionAttemptKey({accountIdentity:a,eventIdentity:e});
    if(key!==computed||current.accountKey!==accountKey(a))throw Error('EXECUTION_LEDGER_EXACT_EVENT_KEY_REQUIRED');
    if(state.attempts.some(r=>r.key===key))return fail('EXECUTION_EVENT_ALREADY_CONSUMED');
    if(unresolved(state,current.accountKey).length)return fail('EXECUTION_ACCOUNT_RECONCILIATION_REQUIRED');
    if(state.attempts.length>=maxAttempts)return fail('EXECUTION_LEDGER_CAPACITY_REACHED');
    if(!plain(sourceIdentity)||!text(sourceIdentity.identityKey,4096)||json(sourceIdentity).length>8192||!plain(intentBinding)||json(intentBinding).length>65536)throw Error('EXECUTION_LEDGER_IMMUTABLE_BINDING_REQUIRED');
    const t=at(),record={key,accountKey:current.accountKey,accountIdentity:a,eventIdentity:e,sourceIdentity:clone(sourceIdentity),intentBinding:clone(intentBinding),sessionId:current.sessionId,ownerId:owner,reservedAt:t,updatedAt:t,status:'UNKNOWN',history:[{status:'UNKNOWN',at:t,phase:'RESERVED_BEFORE_DISPATCH',proof:null}]};
    state.attempts.push(record);await save(state);held(state,session);return {ok:true,status:'RESERVED',record:clone(record),dispatchMayProceed:true};
  });}
  function proofFor(record,status,proof,referenceAt=at()){
    if(!plain(proof)||proof.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||proof.intentKey!==record.key||proof.status!==status||proof.attributionVerified!==true||json(proof.binding)!==json(record.intentBinding))throw Error('EXECUTION_LEDGER_ATTRIBUTED_PROOF_REQUIRED');
    const p=proof.accountEvidence,t=referenceAt;
    if(!plain(p)||p.kind!=='NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1'||accountKey(p)!==record.accountKey||!['PUBLIC_NATIVE_UI','AUTHORIZED_CONNECTOR'].includes(p.origin)||p.nativeIdentityVerified!==true||!matchesNativeExecutionAccountEnvironment(p,record.accountIdentity)||p.connected!==true||p.synthetic===true||p.testOnly===true||!time(p.observedAt)||p.observedAt>t||t-p.observedAt>2000||proof.synthetic===true||proof.testOnly===true)throw Error('EXECUTION_LEDGER_NATIVE_ACCOUNT_PROOF_REQUIRED');
    if(status==='FILLED'||status==='WORKING'){
      if(!text(proof.nativeOrderId)||proof.direction!==record.eventIdentity.direction||!Number.isSafeInteger(proof.quantity)||proof.quantity<1||Number.isSafeInteger(record.intentBinding.quantity)&&proof.quantity!==record.intentBinding.quantity||status==='FILLED'&&proof.fillVerified!==true)throw Error('EXECUTION_LEDGER_ORDER_ATTRIBUTION_REQUIRED');
    }else{
      const inv=proof.accountInventory;
      if(!plain(inv)||accountKey(inv.accountIdentity)!==record.accountKey||inv.positionsComplete!==true||inv.workingOrdersComplete!==true||inv.synthetic===true||inv.testOnly===true||!Array.isArray(inv.positions)||inv.positions.length||!Array.isArray(inv.workingOrders)||inv.workingOrders.length||!time(inv.observedAt)||inv.observedAt>t||t-inv.observedAt>2000)throw Error('EXECUTION_LEDGER_COMPLETE_FLAT_PROOF_REQUIRED');
      if(status==='CLOSED'&&(proof.closedVerified!==true||!text(proof.nativeOrderId))||status==='CANCELLED'&&(proof.cancelledVerified!==true||!text(proof.nativeOrderId))||status==='NOT_SUBMITTED'&&(proof.submitted!==false||proof.noOrderVerified!==true))throw Error('EXECUTION_LEDGER_TERMINAL_PROOF_REQUIRED');
      if(status==='CLOSED'){
        const samples=proof.closureSamples;
        if(!Array.isArray(samples)||samples.length!==2||samples.some(s=>!plain(s)||!text(s.sampleId)||accountKey(s.accountIdentity)!==record.accountKey||s.positionsComplete!==true||s.workingOrdersComplete!==true||s.synthetic===true||s.testOnly===true||!Array.isArray(s.positions)||s.positions.length||!Array.isArray(s.workingOrders)||s.workingOrders.length||!time(s.observedAt)||s.observedAt>t||t-s.observedAt>2000)
          ||samples[0].sampleId===samples[1].sampleId||samples[0].observedAt>=samples[1].observedAt||json(inv)!==json(samples[1]))throw Error('EXECUTION_LEDGER_TWO_DISTINCT_FLAT_SAMPLES_REQUIRED');
      }
    }
    if(json(proof).length>131072)throw Error('EXECUTION_LEDGER_PROOF_SIZE_LIMIT');return clone(proof);
  }
  async function mark({key,session,status,proof=null}={}){return atomic(async state=>{
    const current=held(state,session),record=state.attempts.find(r=>r.key===key);if(!record||record.accountKey!==current.accountKey)throw Error('EXECUTION_LEDGER_ATTEMPT_NOT_FOUND');
    if(!STATES.has(status))throw Error('EXECUTION_LEDGER_STATUS_REQUIRED');
    if(TERMINAL.has(record.status)){if(record.status===status)return {ok:true,status:record.status,record:clone(record),alreadyTerminal:true};throw Error('EXECUTION_LEDGER_TERMINAL_ATTEMPT_RETAINED');}
    if(record.status==='FILLED'&&['UNKNOWN','WORKING','NOT_SUBMITTED','CANCELLED'].includes(status)||record.status==='WORKING'&&['UNKNOWN','NOT_SUBMITTED'].includes(status))throw Error('EXECUTION_LEDGER_NONMONOTONIC_TRANSITION');
    const existingOrderId=record.history.find(h=>text(h.proof?.nativeOrderId))?.proof.nativeOrderId;
    if(existingOrderId&&status!=='UNKNOWN'&&proof?.nativeOrderId!==existingOrderId)throw Error('EXECUTION_LEDGER_ORDER_ID_CHANGED');
    const evidence=status==='UNKNOWN'?null:proofFor(record,status,proof);if(record.history.length>=128)throw Error('EXECUTION_LEDGER_HISTORY_CAPACITY_REACHED');
    record.status=status;record.updatedAt=at();record.history.push({status,at:record.updatedAt,phase:status==='UNKNOWN'?'DISPATCH_RESULT_UNCERTAIN':'ATTRIBUTED_NATIVE_RECONCILIATION',proof:evidence});
    await save(state);return {ok:true,status,record:clone(record),entryBlocked:!TERMINAL.has(status)};
  });}
  async function list({accountIdentity}={}){return atomic(state=>{const key=accountIdentity===undefined?null:accountKey(accountIdentity);return {ok:true,status:'LEDGER_READ',revision:state.revision,records:clone(key===null?state.attempts:state.attempts.filter(r=>r.accountKey===key))};});}
  async function recover({accountIdentity}={}){return atomic(state=>{
    const key=accountIdentity===undefined?null:accountKey(accountIdentity),records=state.attempts.filter(r=>key===null||r.accountKey===key),pending=records.filter(r=>!TERMINAL.has(r.status));
    return {ok:true,status:pending.length?'RECOVERY_REQUIRED':'NO_UNRESOLVED_ATTEMPTS',entryBlocked:pending.length>0,unresolved:clone(pending),records:clone(records),ordersInferred:false};
  });}
  return Object.freeze({claimSession,renewSession,validateSession,releaseSession,reserve,mark,recover,list,ownerId:owner});
}
