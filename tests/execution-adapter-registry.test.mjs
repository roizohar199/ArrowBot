import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionAdapterRegistry} from '../execution-adapter-registry.mjs';
import {createBrokerAccountRegistry} from '../broker-account-registry.mjs';

// Fake adapter contract tests only. No native UI, network, real broker, stored
// credentials or real order operation is used or installed by this fixture.
function fixture({environment='LIVE',readOnly=false,environments=[environment]}={}){
  let clock=2000000,submitResult={submitted:true,status:'SUBMITTED'},onInspect=null,onPreflight=null,onSubmit=null,onReconcile=null;
  const calls=[],ctx={selection:{profile:{id:'profile-1',provider:'EXAMPLE_BROKER',adapterId:'example',environment,nativeAccountId:'001-AbC',label:'My account',currency:'USD',enabled:true,userManagedRisk:true,revision:1},
    profileId:'profile-1',profileRevision:1,registryRevision:1,selectionGeneration:1,identityKey:'EXAMPLE_BROKER|'+environment+'|001-AbC',selectionKey:'selected-1',brokerAccountVerified:false,ordersAuthorized:false},
    symbol:'EXCHANGE:CONTRACT',source:{identityKey:'native-feed:session-1:run-1',observedAt:clock,sessionId:'session-1',runId:'run-1'},
    signal:{status:'CONFIRMED',eventId:'technical-event-1',instrument:'EXCHANGE:CONTRACT',direction:'LONG',confirmedAt:1500000,confirmationBarCloseTime:1500000,synthetic:false,testOnly:false}};
  const proof=()=>({kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',provider:ctx.selection.profile.provider,nativeAccountId:ctx.selection.profile.nativeAccountId,environment:ctx.selection.profile.environment,
    accountRevision:ctx.selection.profile.revision,selectionKey:ctx.selection.selectionKey,observedAt:clock,origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,environmentVerified:true,connected:true,synthetic:false,testOnly:false});
  const adapter={id:'example',provider:'EXAMPLE_BROKER',supportedEnvironments:environments,capabilities:{inspectAccount:true,preflight:!readOnly,submitMarket:!readOnly,reconcile:!readOnly},
    async inspectAccount(request){calls.push({op:'inspectAccount',request});return onInspect?onInspect(request):{status:'NATIVE_ACCOUNT_OBSERVED',evidence:proof()};},
    async preflight(request){calls.push({op:'preflight',request});return onPreflight?onPreflight(request):{status:'READY',accountEvidence:proof(),symbol:request.intent.symbol,orderType:'MARKET',quantity:request.intent.quantity,binding:structuredClone(request.intent.binding)};},
    async submitMarket(request){calls.push({op:'submitMarket',request});return onSubmit?onSubmit(request):structuredClone(submitResult);},
    async reconcile(request){calls.push({op:'reconcile',request});return onReconcile?onReconcile(request):{status:'FILLED',intentKey:request.intent.key,attributionVerified:true,accountEvidence:proof(),binding:structuredClone(request.intent.binding)};}};
  const registry=createExecutionAdapterRegistry({getContext:()=>ctx,now:()=>clock});
  return {ctx,calls,proof,adapter,registry,advance:ms=>{clock+=ms;},connect:()=>registry.register(adapter),
    inspect:fn=>{onInspect=fn;},preflight:fn=>{onPreflight=fn;},submit:fn=>{onSubmit=fn;},reconcile:fn=>{onReconcile=fn;},setSubmit:result=>{submitResult=result;}};
}
async function prepared(f,quantity=3){const result=await f.registry.preflight({signal:f.ctx.signal,quantity});assert.equal(result.status,'READY',JSON.stringify(result));return result.intent;}

test('no adapter is registered by default and configured account flags cannot create a broker connection',async()=>{
  const f=fixture();Object.assign(f.ctx.selection.profile,{brokerAccountVerified:true,ordersAuthorized:true,verified:true});
  assert.equal(f.registry.describe().defaultAdapterRegistered,false);assert.deepEqual(f.registry.listAdapters(),[]);
  assert.equal(f.registry.resolve().status,'NOT_CONNECTED');assert.equal((await f.registry.inspectAccount()).status,'NOT_CONNECTED');
  assert.equal((await f.registry.preflight({quantity:1})).status,'NOT_CONNECTED');assert.equal(f.calls.length,0);
});

test('registration explicitly advertises actual operations and supports eligible environments without a Replay-only rule',async()=>{
  for(const environment of ['LIVE','DEMO','PA','EVALUATION','REPLAY']){
    const f=fixture({environment});f.connect();assert.equal(f.registry.resolve().status,'SUPPORTED');
    const result=await f.registry.inspectAccount();assert.equal(result.status,'READY');assert.equal(result.nativeAccountVerified,true);assert.equal(result.ordersAuthorized,false);
    assert.equal(f.registry.listAdapters()[0].supportedEnvironments[0],environment);assert.equal(f.calls[0].request.account.nativeAccountId,'001-AbC');
  }
  const f=fixture({environment:'LIVE',environments:['DEMO']});f.connect();assert.equal((await f.registry.inspectAccount()).status,'UNSUPPORTED');assert.equal(f.calls.length,0);
  assert.throws(()=>f.registry.register(f.adapter),/ALREADY_REGISTERED/);
  assert.throws(()=>f.registry.register({...f.adapter,id:'broken',submitMarket:null}),/DEFINITION_INVALID/);
});

test('a genuine observed account remains READ_ONLY when adapter cannot submit or native environment is not attested',async()=>{
  const f=fixture({readOnly:true});f.connect();const observed=await f.registry.inspectAccount();
  assert.equal(observed.status,'READ_ONLY');assert.equal(observed.nativeAccountVerified,true);assert.equal((await f.registry.preflight({quantity:1})).status,'READ_ONLY');assert.equal(f.calls.filter(c=>c.op==='preflight').length,0);
  const unproven=fixture();unproven.connect();unproven.inspect(()=>({evidence:{...unproven.proof(),environmentVerified:false}}));
  const result=await unproven.registry.inspectAccount();assert.equal(result.status,'READ_ONLY');assert.equal(result.identityMatch,true);assert.equal(result.nativeAccountVerified,false);assert.equal(result.environmentVerified,false);
  assert.equal((await unproven.registry.preflight({quantity:1})).status,'READ_ONLY');assert.equal(unproven.calls.filter(c=>c.op==='preflight').length,0);
});

test('disconnected, stale, synthetic and mismatched native evidence cannot make account READY',async()=>{
  const changes=[p=>({...p,nativeAccountId:'1-AbC'}),p=>({...p,provider:'OTHER'}),p=>({...p,accountRevision:2}),p=>({...p,selectionKey:'other'}),p=>({...p,connected:false}),p=>({...p,nativeIdentityVerified:false}),p=>({...p,synthetic:true}),p=>({...p,testOnly:true}),p=>({...p,origin:'USER_CONFIG'}),p=>({...p,observedAt:p.observedAt-2001}),p=>({...p,observedAt:p.observedAt+1})];
  for(const change of changes){const f=fixture();f.connect();f.inspect(()=>({evidence:change(f.proof())}));assert.equal((await f.registry.inspectAccount()).status,'NOT_CONNECTED');assert.equal(f.registry.snapshot().ordersAuthorized,false);}
  const missing=fixture();missing.connect();missing.inspect(()=>({status:'NOT_CONNECTED',reasonCodes:['AUTHORIZED_CONNECTION_REQUIRED']}));assert.deepEqual((await missing.registry.inspectAccount()).reasonCodes,['AUTHORIZED_CONNECTION_REQUIRED']);
});

test('a selection edit, account switch or source change during native inspection invalidates that response',async()=>{
  for(const change of [f=>{f.ctx.selection.selectionKey='selected-2';},f=>{f.ctx.selection.profile.nativeAccountId='another';},f=>{f.ctx.selection.profile.revision=2;f.ctx.selection.profileRevision=2;},f=>{f.ctx.source.runId='run-2';}]){
    const f=fixture();f.connect();f.inspect(()=>{const evidence=f.proof();change(f);return {evidence};});const result=await f.registry.inspectAccount();assert.equal(result.status,'BLOCKED');assert.deepEqual(result.reasonCodes,['EXECUTION_SELECTION_OR_SOURCE_CHANGED']);
  }
});

test('preflight binds exact user quantity, complete signal, source and selected account without risk budget or SLTP fields',async()=>{
  const f=fixture();f.connect();const intent=await prepared(f,7);
  assert.equal(intent.quantity,7);assert.equal(intent.userManaged,true);assert.equal(intent.account.nativeAccountId,'001-AbC');assert.equal(intent.account.revision,1);assert.equal(intent.selectionKey,'selected-1');assert.deepEqual(intent.signal,f.ctx.signal);assert.deepEqual(intent.source,f.ctx.source);
  for(const field of ['riskBudget','riskPlan','stopLoss','takeProfit','commission'])assert.equal(Object.hasOwn(intent,field),false);
  assert.equal(f.registry.snapshot().attemptCount,0);assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,0);
  const invalid=await f.registry.preflight({signal:{...f.ctx.signal,direction:'SHORT'},quantity:7});assert.deepEqual(invalid.reasonCodes,['EXECUTION_SIGNAL_BINDING_CHANGED']);
});

test('native preflight must reprove account and echo the exact immutable order binding',async()=>{
  for(const change of [r=>{r.quantity=4;},r=>{r.symbol='OTHER';},r=>{r.binding.account.nativeAccountId='other';},r=>{r.binding.extra=true;},r=>{r.accountEvidence.environmentVerified=false;}]){
    const f=fixture();f.connect();f.preflight(({intent})=>{const result={status:'READY',accountEvidence:f.proof(),orderType:'MARKET',symbol:intent.symbol,quantity:intent.quantity,binding:structuredClone(intent.binding)};change(result);return result;});
    assert.notEqual((await f.registry.preflight({quantity:3})).status,'READY');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,0);
  }
});

test('one immutable prepared intent permits one adapter submission then requires attributed read-only reconciliation',async()=>{
  for(const direction of ['LONG','SHORT']){
    const f=fixture();f.ctx.signal.direction=direction;f.connect();const intent=await prepared(f);
    const submitted=await f.registry.submitMarket(intent);assert.equal(submitted.status,'UNKNOWN');assert.equal(submitted.locked,true);assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
    assert.equal((await f.registry.submitMarket(intent)).status,'UNKNOWN');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
    const reconciled=await f.registry.reconcile(intent.key);assert.equal(reconciled.status,'FILLED');assert.equal(reconciled.locked,false);assert.equal(f.calls.filter(c=>c.op==='reconcile').length,1);assert.equal(f.calls.filter(c=>c.op==='preflight').length,1);
    assert.equal((await f.registry.preflight({quantity:9})).status,'BLOCKED');assert.equal((await f.registry.submitMarket(intent)).status,'BLOCKED');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
  }
});

test('changed preset quantity, account, symbol, signal or stale source cannot dispatch a prepared intent',async()=>{
  for(const change of [(f,i)=>{i.quantity=4;},(f,i)=>{i.account.revision=2;},(f,i)=>{i.signal.direction='SHORT';},f=>{f.ctx.symbol='OTHER';},f=>{f.ctx.selection.selectionKey='changed';},f=>{f.ctx.source.identityKey='new-run';},f=>{f.advance(2001);}]){
    const f=fixture();f.connect();const intent=await prepared(f);change(f,intent);assert.equal((await f.registry.submitMarket(intent)).status,'BLOCKED');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,0);
  }
});

test('unknown submit exceptions lock all accounts and reconciliation cannot accidentally route to a newly selected account',async()=>{
  const f=fixture();f.connect();f.submit(()=>{throw Error('connection lost after request');});const intent=await prepared(f);assert.equal((await f.registry.submitMarket(intent)).status,'UNKNOWN');
  const original=structuredClone(f.ctx.selection);f.ctx.selection.profile.nativeAccountId='OTHER-ACCOUNT';f.ctx.selection.selectionKey='selected-2';f.ctx.selection.identityKey='other';
  assert.equal((await f.registry.preflight({quantity:1})).status,'UNKNOWN');assert.equal((await f.registry.reconcile(intent.key)).status,'UNKNOWN');assert.equal(f.calls.filter(c=>c.op==='reconcile').length,0);assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
  f.ctx.selection=original;assert.equal((await f.registry.reconcile(intent.key)).status,'FILLED');assert.equal(f.registry.snapshot().locked,false);
});

test('deduplication includes native account identity and cannot be bypassed by profile aliases, revisions or quantity changes',async()=>{
  const f=fixture();f.connect();f.setSubmit({submitted:false,status:'BLOCKED'});const first=await prepared(f);assert.equal((await f.registry.submitMarket(first)).submitted,false);
  Object.assign(f.ctx.selection.profile,{id:'alias',revision:2});Object.assign(f.ctx.selection,{profileId:'alias',profileRevision:2,selectionKey:'selected-alias'});
  assert.deepEqual((await f.registry.preflight({quantity:8})).reasonCodes,['EXECUTION_EVENT_ALREADY_ATTEMPTED']);
  f.ctx.selection.profile.nativeAccountId='002-AbC';f.ctx.selection.identityKey='EXAMPLE_BROKER|LIVE|002-AbC';f.ctx.selection.selectionKey='selected-other';const other=await prepared(f,8);assert.notEqual(first.key,other.key);
  assert.ok(other.key.includes('002-AbC'));assert.equal(other.quantity,8);
});

test('unproven reconciliation and context changes after submission never clear the uncertainty lock or resubmit',async()=>{
  const f=fixture();f.connect();const intent=await prepared(f);f.submit(()=>{f.ctx.source.runId='run-next';return {submitted:true};});
  assert.deepEqual((await f.registry.submitMarket(intent)).reasonCodes,['EXECUTION_CONTEXT_CHANGED_AFTER_SUBMISSION']);
  f.reconcile(({intent})=>({status:'FILLED',intentKey:intent.key,attributionVerified:false,accountEvidence:f.proof(),binding:intent.binding}));
  assert.equal((await f.registry.reconcile()).status,'UNKNOWN');assert.equal(f.registry.snapshot().locked,true);assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
});

test('a concurrent operation cannot reserve or submit twice while an adapter promise is pending',async()=>{
  const f=fixture();f.connect();let release;f.submit(()=>new Promise(resolve=>{release=resolve;}));const intent=await prepared(f),first=f.registry.submitMarket(intent);
  assert.equal((await f.registry.inspectAccount()).status,'BUSY');assert.equal((await f.registry.submitMarket(intent)).status,'UNKNOWN');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
  release({submitted:true});await first;assert.equal(f.registry.snapshot().locked,true);
});

test('actual account-registry selections interoperate and a changed selection cancels entries while same-account reconciliation stays read-only',async()=>{
  const f=fixture(),profiles=createBrokerAccountRegistry({now:()=>2000000,makeLeaseId:()=> 'account-registry-component-instance'}),{revision,...definition}=f.ctx.selection.profile;
  assert.equal(profiles.upsert(definition).ok,true);assert.equal(profiles.select(definition.id).ok,true);f.ctx.selection=profiles.getSelection();f.connect();
  assert.equal((await f.registry.inspectAccount()).status,'READY');const intent=await prepared(f);
  assert.equal((await f.registry.submitMarket(intent)).status,'UNKNOWN');
  profiles.invalidate('USER_RESELECTED_ACCOUNT');f.ctx.selection=profiles.getSelection();assert.notEqual(f.ctx.selection.selectionKey,intent.selectionKey);
  const result=await f.registry.reconcile(intent.key);assert.equal(result.status,'FILLED');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);assert.equal(f.calls.filter(c=>c.op==='reconcile').length,1);
  assert.deepEqual((await f.registry.preflight({quantity:2})).reasonCodes,['EXECUTION_EVENT_ALREADY_ATTEMPTED']);
});

test('account-registry maximum-length native identifiers remain exact across native verification and adapter inspection',async()=>{
  const f=fixture(),profiles=createBrokerAccountRegistry({now:()=>2000000,makeLeaseId:()=> 'i'.repeat(512)}),{revision,...definition}=f.ctx.selection.profile;
  definition.nativeAccountId='00'+ 'N'.repeat(510);definition.id='P'.repeat(160);assert.equal(profiles.upsert(definition).ok,true);assert.equal(profiles.select(definition.id).ok,true);
  f.ctx.selection=profiles.getSelection();f.connect();assert.ok(f.ctx.selection.selectionKey.length>512);assert.ok(f.ctx.selection.identityKey.length>512);
  const result=await f.registry.inspectAccount();assert.equal(result.status,'READY');assert.equal(f.calls[0].request.account.nativeAccountId,definition.nativeAccountId);
});

test('a shared read-only adapter supports only its explicit provider membership across advertised environments',async()=>{
  const f=fixture({readOnly:true,environments:['LIVE','DEMO','REPLAY']}),adapter={...f.adapter,provider:'MULTI_PROVIDER',supportedProviders:['EXAMPLE_BROKER','OTHER_BROKER']};f.registry.register(adapter);
  for(const provider of adapter.supportedProviders)for(const environment of adapter.supportedEnvironments){
    Object.assign(f.ctx.selection.profile,{provider,environment});const result=await f.registry.inspectAccount();assert.equal(result.status,'READ_ONLY');assert.equal(result.nativeAccountVerified,true);assert.equal(result.ordersAuthorized,false);
    assert.equal((await f.registry.preflight({quantity:1})).status,'READ_ONLY');
  }
  f.ctx.selection.profile.provider='UNLISTED_BROKER';const calls=f.calls.length;assert.equal((await f.registry.inspectAccount()).status,'UNSUPPORTED');assert.equal(f.calls.length,calls);assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,0);
  assert.deepEqual(f.registry.listAdapters()[0].supportedProviders,adapter.supportedProviders);
  for(const supportedProviders of [[],['*'],['EXAMPLE_BROKER','EXAMPLE_BROKER'],['MULTI_PROVIDER'],undefined])assert.throws(()=>f.registry.register({...adapter,id:'bad-'+String(supportedProviders),supportedProviders}),/PROVIDER_MEMBERSHIP_REQUIRED/);
});

test('explicit invalidation removes prepared entry authority and aborts in-flight inspection without losing attempts or uncertainty',async()=>{
  const f=fixture();f.connect();const intent=await prepared(f);f.registry.invalidate('USER_SETTINGS_CHANGED');assert.equal(f.registry.snapshot().preparedCount,0);assert.equal((await f.registry.submitMarket(intent)).status,'BLOCKED');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,0);
  let release;f.inspect(()=>new Promise(resolve=>{release=resolve;}));const pending=f.registry.inspectAccount();f.registry.invalidate('USER_SELECTED_ACCOUNT');release({evidence:f.proof()});const read=await pending;assert.equal(read.status,'BLOCKED');assert.deepEqual(read.reasonCodes,['EXECUTION_SELECTION_OR_SOURCE_CHANGED']);
  f.inspect(null);const next=await prepared(f);await f.registry.submitMarket(next);f.registry.invalidate('USER_STOPPED_ENTRIES');
  assert.equal(f.registry.snapshot().locked,true);assert.equal(f.registry.snapshot().attemptCount,1);assert.equal((await f.registry.preflight({quantity:1})).status,'UNKNOWN');assert.equal((await f.registry.reconcile()).status,'FILLED');assert.equal(f.calls.filter(c=>c.op==='submitMarket').length,1);
});
