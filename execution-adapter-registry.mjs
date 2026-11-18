// Provider-neutral execution foundation. No adapter, broker connection or order
// gesture is installed here. A saved profile is never native account evidence.
export const EXECUTION_ADAPTER_REGISTRY_VERSION='execution-adapter-registry-1';
const OPERATIONS=['inspectAccount','preflight','submitMarket','reconcile'];
const clone=value=>structuredClone(value);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=512)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const canonical=value=>{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  throw Error('EXECUTION_BINDING_NOT_JSON');
};
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const failure=(status,reason,extra={})=>({status,reasonCodes:[reason],ordersAuthorized:false,...extra});

/**
 * getContext(): {selection: BrokerAccountRegistry.getSelection(), symbol,
 * source?: {identityKey,observedAt,...nativeSourceIdentity}, signal?: confirmedSignal}.
 * Adapter callbacks receive immutable snapshots, never the live selection.
 * submitMarket is one-shot; reconcile never invokes an entry operation.
 */
export function createExecutionAdapterRegistry({getContext,now=()=>Date.now(),maxEvidenceAgeMs=2000}={}){
  if(typeof getContext!=='function'||typeof now!=='function'||!Number.isFinite(maxEvidenceAgeMs)||maxEvidenceAgeMs<=0||maxEvidenceAgeMs>60000)throw Error('EXECUTION_REGISTRY_CONFIGURATION_REQUIRED');
  const adapters=new Map(),prepared=new Map(),attempts=new Map();
  let state={status:'NOT_CONNECTED',reasonCodes:['NO_ADAPTER_CONNECTED'],ordersAuthorized:false},busy=false,unknownKey=null,generation=0;
  const publish=result=>(state=clone(result),clone(result));
  const recent=observedAt=>Number.isFinite(observedAt)&&observedAt<=now()&&now()-observedAt<=maxEvidenceAgeMs;
  function context({entry=false}={}){
    const current=getContext(),selection=current?.selection,p=selection?.profile;
    if(!plain(selection)||!plain(p)||!text(p.id)||!text(p.provider)||!text(p.adapterId)||!text(p.environment)||!text(p.nativeAccountId)||p.enabled!==true||p.userManagedRisk!==true
      ||!Number.isSafeInteger(p.revision)||p.revision<1||selection.profileId!==p.id||selection.profileRevision!==p.revision||!text(selection.selectionKey,8192)||!text(selection.identityKey,2048)||!text(current.symbol))throw Error('EXECUTION_SELECTED_ACCOUNT_REQUIRED');
    const account={id:p.id,provider:p.provider,adapterId:p.adapterId,environment:p.environment,nativeAccountId:p.nativeAccountId,revision:p.revision};
    const source=plain(current.source)?clone(current.source):null,signal=plain(current.signal)?clone(current.signal):null;
    if(entry){
      if(!source||!text(source.identityKey)||!recent(source.observedAt)||source.synthetic===true||source.testOnly===true)throw Error('EXECUTION_FRESH_SOURCE_IDENTITY_REQUIRED');
      if(!signal||signal.status!=='CONFIRMED'||!text(signal.eventId)||!['LONG','SHORT'].includes(signal.direction)||signal.instrument!==current.symbol
        ||!Number.isSafeInteger(signal.confirmationBarCloseTime)||signal.confirmedAt!==signal.confirmationBarCloseTime||signal.synthetic===true||signal.testOnly===true)throw Error('EXECUTION_CONFIRMED_SIGNAL_REQUIRED');
    }
    const sourceIdentity=source?Object.fromEntries(Object.entries(source).filter(([key])=>key!=='observedAt')):null;
    const binding={account,selectionKey:selection.selectionKey,identityKey:selection.identityKey,symbol:current.symbol,source:sourceIdentity,signal};
    if(canonical(binding).length>65536)throw Error('EXECUTION_BINDING_SIZE_LIMIT');
    return {selection:clone(selection),account,symbol:current.symbol,source,signal,binding,fingerprint:canonical(binding),generation};
  }
  function continuity(original,{entry=false}={}){
    const current=context({entry});
    if(current.generation!==original.generation||current.fingerprint!==original.fingerprint)throw Error('EXECUTION_SELECTION_OR_SOURCE_CHANGED');
    if(entry&&!recent(original.source.observedAt))throw Error('EXECUTION_SOURCE_EXPIRED');
    return current;
  }
  function descriptor(adapter){return {id:adapter.id,provider:adapter.provider,...(adapter.supportedProviders?{supportedProviders:[...adapter.supportedProviders]}:{}),supportedEnvironments:[...adapter.supportedEnvironments],capabilities:{...adapter.capabilities}};}
  function resolve(selection){
    let selected=selection;try{selected??=getContext()?.selection;}catch{}
    const profile=selected?.profile,adapter=adapters.get(profile?.adapterId);
    if(!adapter)return failure('NOT_CONNECTED','EXECUTION_ADAPTER_NOT_REGISTERED');
    const providers=adapter.provider==='MULTI_PROVIDER'?adapter.supportedProviders:[adapter.provider];
    if(!providers.includes(profile?.provider)||!adapter.supportedEnvironments.includes(profile?.environment))return failure('UNSUPPORTED','EXECUTION_ADAPTER_ACCOUNT_UNSUPPORTED',{adapter:descriptor(adapter)});
    const writable=adapter.capabilities.preflight&&adapter.capabilities.submitMarket&&adapter.capabilities.reconcile;
    return {status:writable?'SUPPORTED':'READ_ONLY',reasonCodes:writable?[]:['EXECUTION_ADAPTER_READ_ONLY'],adapter:descriptor(adapter),ordersAuthorized:false};
  }
  function handler(c){const resolved=resolve(c.selection);if(!['SUPPORTED','READ_ONLY'].includes(resolved.status))return {resolved,adapter:null};return {resolved,adapter:adapters.get(c.account.adapterId)};}
  function nativeProof(evidence,c){
    const identityMatch=plain(evidence)&&evidence.kind==='NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1'&&evidence.provider===c.account.provider&&evidence.nativeAccountId===c.account.nativeAccountId
      &&evidence.accountRevision===c.account.revision&&evidence.selectionKey===c.selection.selectionKey;
    if(!identityMatch)return failure('NOT_CONNECTED','EXECUTION_NATIVE_ACCOUNT_IDENTITY_MISMATCH',{identityMatch:false,nativeAccountVerified:false});
    if(evidence.synthetic===true||evidence.testOnly===true||evidence.connected!==true||evidence.nativeIdentityVerified!==true||!['PUBLIC_NATIVE_UI','AUTHORIZED_CONNECTOR'].includes(evidence.origin)||!recent(evidence.observedAt))return failure('NOT_CONNECTED','EXECUTION_FRESH_NATIVE_ACCOUNT_PROOF_REQUIRED',{identityMatch:true,nativeAccountVerified:false});
    if(evidence.environment!==c.account.environment||evidence.environmentVerified!==true)return failure('READ_ONLY','EXECUTION_NATIVE_ENVIRONMENT_UNVERIFIED',{identityMatch:true,nativeAccountVerified:false,environmentVerified:false});
    return {status:'VERIFIED',reasonCodes:[],identityMatch:true,nativeAccountVerified:true,environmentVerified:true,ordersAuthorized:false,evidence:clone(evidence)};
  }
  const request=c=>freeze({selection:clone(c.selection),account:clone(c.account),symbol:c.symbol,source:clone(c.source)});
  async function inspect(c,adapter){
    if(!adapter.capabilities.inspectAccount)return failure('UNSUPPORTED','EXECUTION_ACCOUNT_INSPECTION_UNSUPPORTED');
    const observed=await adapter.inspectAccount(request(c));continuity(c);
    if(!plain(observed?.evidence))return failure('NOT_CONNECTED',text(observed?.reasonCodes?.[0])?observed.reasonCodes[0]:'EXECUTION_FRESH_NATIVE_ACCOUNT_PROOF_REQUIRED',{nativeAccountVerified:false,observation:clone(observed??null)});
    const verified=nativeProof(observed?.evidence,c);
    if(verified.status!=='VERIFIED')return {...verified,observation:clone(observed??null)};
    const writable=adapter.capabilities.preflight&&adapter.capabilities.submitMarket&&adapter.capabilities.reconcile;
    return {...verified,status:writable?'READY':'READ_ONLY',reasonCodes:writable?[]:['EXECUTION_ADAPTER_READ_ONLY'],adapter:descriptor(adapter),canPreflight:writable,ordersAuthorized:false};
  }
  function locked(){return unknownKey?failure('UNKNOWN','EXECUTION_UNRESOLVED_SUBMISSION',{locked:true,intentKey:unknownKey}):null;}
  function keyFor(c){return ['user-managed-market-1',c.account.provider,c.account.environment,c.account.nativeAccountId,c.symbol,c.source.identityKey,c.signal.eventId].map(encodeURIComponent).join(':');}
  function catchResult(error,extra={}){return failure('BLOCKED',text(error?.message)?error.message:'EXECUTION_ADAPTER_OPERATION_FAILED',extra);}
  function register(adapter){
    if(!plain(adapter)||!text(adapter.id)||!text(adapter.provider)||!Array.isArray(adapter.supportedEnvironments)||!adapter.supportedEnvironments.length||adapter.supportedEnvironments.some(env=>!text(env))
      ||new Set(adapter.supportedEnvironments).size!==adapter.supportedEnvironments.length||!plain(adapter.capabilities)||OPERATIONS.some(op=>typeof adapter.capabilities[op]!=='boolean'||adapter.capabilities[op]&&typeof adapter[op]!=='function'))throw Error('EXECUTION_ADAPTER_DEFINITION_INVALID');
    if(adapter.provider==='MULTI_PROVIDER'&&(!Array.isArray(adapter.supportedProviders)||!adapter.supportedProviders.length||adapter.supportedProviders.some(provider=>!text(provider,100)||!/^[A-Z][A-Z0-9_.-]*$/.test(provider)||provider==='MULTI_PROVIDER')||new Set(adapter.supportedProviders).size!==adapter.supportedProviders.length)
      ||adapter.provider!=='MULTI_PROVIDER'&&adapter.supportedProviders!==undefined)throw Error('EXECUTION_ADAPTER_PROVIDER_MEMBERSHIP_REQUIRED');
    if(adapters.has(adapter.id))throw Error('EXECUTION_ADAPTER_ALREADY_REGISTERED');
    const stored={...descriptor(adapter),...Object.fromEntries(OPERATIONS.filter(op=>adapter.capabilities[op]).map(op=>[op,adapter[op]]))};adapters.set(adapter.id,stored);return descriptor(stored);
  }
  async function inspectAccount(){
    if(busy)return failure('BUSY','EXECUTION_OPERATION_IN_FLIGHT');busy=true;
    try{const c=context(),{resolved,adapter}=handler(c);if(!adapter)return publish(resolved);return publish(await inspect(c,adapter));}
    catch(error){return publish(catchResult(error));}finally{busy=false;}
  }
  async function preflight({signal,quantity}={}){
    const pending=locked();if(pending)return publish(pending);if(busy)return failure('BUSY','EXECUTION_OPERATION_IN_FLIGHT');busy=true;
    try{
      const c=context({entry:true});if(signal!==undefined&&canonical(signal)!==canonical(c.signal))throw Error('EXECUTION_SIGNAL_BINDING_CHANGED');
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)throw Error('EXECUTION_USER_QUANTITY_REQUIRED');
      const {resolved,adapter}=handler(c);if(!adapter||resolved.status!=='SUPPORTED')return publish(resolved);
      const verified=await inspect(c,adapter);continuity(c,{entry:true});if(verified.status!=='READY')return publish(verified);
      const key=keyFor(c);if(attempts.has(key))return publish(failure('BLOCKED','EXECUTION_EVENT_ALREADY_ATTEMPTED',{intentKey:key}));
      const intent=freeze({kind:'USER_MANAGED_ADAPTER_MARKET_INTENT',definitionVersion:EXECUTION_ADAPTER_REGISTRY_VERSION,key,orderType:'MARKET',userManaged:true,quantity,
        direction:c.signal.direction,signal:clone(c.signal),symbol:c.symbol,account:clone(c.account),selectionKey:c.selection.selectionKey,source:clone(c.source),binding:clone(c.binding),preparedAt:now(),expiresAt:Math.min(now()+maxEvidenceAgeMs,c.source.observedAt+maxEvidenceAgeMs)});
      const result=await adapter.preflight(freeze({...request(c),intent}));continuity(c,{entry:true});
      const finalProof=nativeProof(result?.accountEvidence,c);
      if(finalProof.status!=='VERIFIED')return publish(finalProof);
      if(result?.status!=='READY'||result.orderType!=='MARKET'||result.quantity!==quantity||result.symbol!==c.symbol||canonical(result.binding)!==canonical(intent.binding))throw Error('EXECUTION_NATIVE_PREFLIGHT_BINDING_MISMATCH');
      prepared.set(key,{intent,c,adapter,evidence:finalProof.evidence,preflight:clone(result)});
      return publish({status:'READY',reasonCodes:[],nativeAccountVerified:true,ordersAuthorized:false,userManaged:true,intent:clone(intent)});
    }catch(error){return publish(catchResult(error));}finally{busy=false;}
  }
  async function submitMarket(intent){
    const pending=locked();if(pending)return publish(pending);if(busy)return failure('BUSY','EXECUTION_OPERATION_IN_FLIGHT');busy=true;
    let record=null,dispatched=false;
    try{
      record=prepared.get(intent?.key);if(!record)throw Error('EXECUTION_UNPREPARED_INTENT');
      if(attempts.has(intent.key))throw Error('EXECUTION_EVENT_ALREADY_ATTEMPTED');
      if(canonical(intent)!==canonical(record.intent))throw Error('EXECUTION_INTENT_BINDING_CHANGED');
      continuity(record.c,{entry:true});if(now()>record.intent.expiresAt||nativeProof(record.evidence,record.c).status!=='VERIFIED')throw Error('EXECUTION_PREFLIGHT_EXPIRED');
      // Consume before calling the adapter, including known no-click failures.
      // An adapter may not replay the same event under another profile alias.
      record={...record,result:null};attempts.set(intent.key,record);prepared.delete(intent.key);dispatched=true;unknownKey=intent.key;
      const result=await record.adapter.submitMarket(freeze({intent:clone(record.intent),preflight:clone(record.preflight)}));record.result=clone(result??null);
      try{continuity(record.c,{entry:true});}catch{ return publish(failure('UNKNOWN','EXECUTION_CONTEXT_CHANGED_AFTER_SUBMISSION',{locked:true,intentKey:intent.key,submissionAttempted:true,result:clone(result??null)}));}
      if(result?.submitted===false){unknownKey=null;return publish({status:'BLOCKED',reasonCodes:['EXECUTION_SUBMISSION_NOT_SENT'],ordersAuthorized:false,submissionAttempted:true,submitted:false,intentKey:intent.key,result:clone(result)});}
      return publish(failure('UNKNOWN','EXECUTION_SUBMISSION_REQUIRES_RECONCILIATION',{locked:true,intentKey:intent.key,submissionAttempted:true,result:clone(result??null)}));
    }catch(error){return publish(dispatched?failure('UNKNOWN','EXECUTION_SUBMISSION_RESULT_UNKNOWN',{locked:true,intentKey:record.intent.key,submissionAttempted:true}):catchResult(error));}finally{busy=false;}
  }
  async function reconcile(intentKey=unknownKey){
    if(busy)return failure('BUSY','EXECUTION_OPERATION_IN_FLIGHT');busy=true;
    try{
      const record=attempts.get(intentKey);if(!record)return publish(failure('BLOCKED','EXECUTION_ATTEMPT_NOT_FOUND'));
      const current=context();
      // Selection edits cancel entry authority. Read-only reconciliation can
      // still recover the SAME native account under a freshly selected profile.
      if(current.account.provider!==record.c.account.provider||current.account.environment!==record.c.account.environment||current.account.nativeAccountId!==record.c.account.nativeAccountId||current.symbol!==record.c.symbol)throw Error('EXECUTION_RECONCILIATION_ACCOUNT_CHANGED');
      const result=await record.adapter.reconcile(freeze({intent:clone(record.intent),submission:clone(record.result)}));
      const after=context();if(after.generation!==current.generation||canonical(after.account)!==canonical(current.account)||after.selection.selectionKey!==current.selection.selectionKey||after.symbol!==current.symbol)throw Error('EXECUTION_RECONCILIATION_ACCOUNT_CHANGED');
      const proof=nativeProof(result?.accountEvidence,current);
      if(proof.status!=='VERIFIED')return publish(failure('UNKNOWN','EXECUTION_RECONCILIATION_ACCOUNT_UNVERIFIED',{locked:!!unknownKey,intentKey}));
      if(!['FILLED','WORKING','NOT_SUBMITTED','CANCELLED'].includes(result?.status)||result.attributionVerified!==true||result.intentKey!==intentKey||canonical(result.binding)!==canonical(record.intent.binding))return publish(failure('UNKNOWN','EXECUTION_RECONCILIATION_UNPROVEN',{locked:!!unknownKey,intentKey}));
      if(unknownKey===intentKey)unknownKey=null;record.reconciled=clone(result);
      return publish({status:result.status,reasonCodes:[],ordersAuthorized:false,locked:false,intentKey,submissionAttempted:true,result:clone(result)});
    }catch(error){return publish(failure('UNKNOWN',text(error?.message)?error.message:'EXECUTION_RECONCILIATION_FAILED',{locked:!!unknownKey,intentKey}));}finally{busy=false;}
  }
  function invalidate(reason='EXECUTION_CONTEXT_INVALIDATED'){
    generation++;prepared.clear();
    return publish(failure(unknownKey?'UNKNOWN':'NOT_CONNECTED',text(reason,160)?reason:'EXECUTION_CONTEXT_INVALIDATED',{locked:!!unknownKey,intentKey:unknownKey}));
  }
  return {register,resolve,listAdapters:()=>[...adapters.values()].map(descriptor),inspectAccount,preflight,submitMarket,reconcile,invalidate,
    describe:()=>({version:EXECUTION_ADAPTER_REGISTRY_VERSION,adapters:[...adapters.values()].map(descriptor),defaultAdapterRegistered:false,attemptScope:'REGISTRY_INSTANCE_ADAPTER_REQUIRES_DURABLE_IDEMPOTENCY'}),
    snapshot:()=>clone({...state,busy,locked:!!unknownKey,unresolvedIntentKey:unknownKey,attemptCount:attempts.size,preparedCount:prepared.size,defaultAdapterRegistered:false,attemptScope:'REGISTRY_INSTANCE_ADAPTER_REQUIRES_DURABLE_IDEMPOTENCY'})};
}
