import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradovateAccountReadClient,createTradovateAccountInspectionAdapter,TRADOVATE_ACCOUNT_API} from '../tradovate-account-connector.mjs';

// All transports and credentials below are local synthetic component fixtures.
// Passing tests do not establish a real connection or authorized paid account.
const token='synthetic-component-only-access-token',at=10000;
const account={id:17,name:'PAAPEX-display-label-is-not-origin-proof',active:true,readOnly:false};
const response=(data,extra={})=>({ok:true,status:200,url:'',json:async()=>data,...extra});
const make=(fetchImpl,options={})=>createTradovateAccountReadClient({environment:'DEMO',getAccessToken:()=>token,fetchImpl,now:()=>at,...options});
const selection=(environment='DEMO',nativeAccountId='17')=>({profile:{id:'account-local',provider:'TRADOVATE',adapterId:'tradovate-api',environment,nativeAccountId,label:'User label',currency:'USD',enabled:true,userManagedRisk:true,revision:2},selectionKey:'pinned-selection-2'});

for(const environment of ['DEMO','LIVE'])test(environment+' discovery pins its explicit origin and preserves numeric API identity separately from labels',async()=>{
  const calls=[];const client=make(async(url,options)=>{calls.push({url,options});return response([account]);},{environment});
  assert.equal(calls.length,0);
  const rows=await client.accounts();
  assert.equal(calls.length,1);assert.equal(calls[0].url,TRADOVATE_ACCOUNT_API[environment]+'/account/list');
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(rows[0].accountIdString,'17');assert.equal(rows[0].nativeAccountId,'17');assert.equal(rows[0].name,account.name);
  assert.equal(rows[0].accountOrigin,'UNVERIFIED');assert.equal(rows[0].independentAccountVerified,false);assert.equal(rows[0].automationAuthorized,false);
  assert.equal(rows[0].source.origin,TRADOVATE_ACCOUNT_API[environment]);assert.equal(rows[0].source.accountIdString,'17');
  for(const operation of ['submit','placeOrder','cancelOrder','modifyOrder','login','getAccessToken','get'])assert.equal(operation in client,false);
  assert.equal(JSON.stringify(client).includes(token),false);assert.ok(Object.isFrozen(client));
});

test('unrecognized or inferred environments cannot choose a network destination',()=>{
  for(const environment of [undefined,'PA','EVALUATION','REPLAY','live','https://evil.invalid','__proto__'])assert.throws(()=>make(()=>assert.fail('no network'),{environment}),{code:'INVALID_TRADOVATE_READ_CLIENT_CONFIGURATION'});
});

test('snapshot first authenticates exact selected id, filters other accounts and does not certify atomic or complete inventory',async()=>{
  const calls=[];const client=make(async url=>{calls.push(url);return response(url.endsWith('/account/list')?[account]:url.endsWith('/position/list')?[{accountId:17,netPos:0},{accountId:18,netPos:2}]:[{accountId:17,ordStatus:'Working'},{accountId:18,ordStatus:'Filled'}]);});
  const view=await client.snapshot(17);assert.equal(view.accountIdString,'17');assert.equal(view.positions.length,1);assert.equal(view.orders.length,1);
  assert.equal(view.completeInventoryVerified,false);assert.equal(view.automationAuthorized,false);assert.equal(view.ordersCreated,false);assert.equal(view.readOnly,true);
  assert.equal(calls[0],TRADOVATE_ACCOUNT_API.DEMO+'/account/list');
});

test('unknown and noncanonical snapshot ids cannot read someone else’s inventory',async()=>{
  let count=0;const client=make(async()=>{count++;return response([account]);});
  await assert.rejects(client.snapshot('17'),{code:'EXACT_ACCOUNT_REQUIRED'});assert.equal(count,0);
  await assert.rejects(client.snapshot(99),{code:'ACCOUNT_NOT_IN_AUTHENTICATED_LIST'});assert.equal(count,1);
});

test('partial or malformed account snapshots fail without a fabricated empty result',async()=>{
  const partial=make(async url=>{if(url.endsWith('/order/list'))throw Error(token);return response(url.endsWith('/account/list')?[account]:[]);});
  await assert.rejects(partial.snapshot(17),e=>e.code==='API_READ_FAILED'&&!e.message.includes(token));
  const malformed=make(async url=>response(url.endsWith('/account/list')?[account]:[{netPos:0}]));
  await assert.rejects(malformed.snapshot(17),{code:'INVALID_ACCOUNT_SNAPSHOT'});
});

test('exact dated NQ resolution never invents a continuous-contract mapping or specification',async()=>{
  let called;const client=make(async url=>{called=url;return response({id:81,name:'NQZ6',contractMaturityId:77});});
  const contract=await client.findNqContract('NQZ6');assert.equal(called,TRADOVATE_ACCOUNT_API.DEMO+'/contract/find?name=NQZ6');
  assert.equal(contract.continuousMappingVerified,false);assert.equal(contract.specificationVerified,false);
  for(const name of ['NQ1!','MNQZ6','NQZ6&name=ESZ6','NQF6'])await assert.rejects(client.findNqContract(name),{code:'DATED_NQ_CONTRACT_REQUIRED'});
  await assert.rejects(make(async()=>response({id:81,name:'MNQZ6',contractMaturityId:77})).findNqContract('NQZ6'),{code:'CONTRACT_IDENTITY_UNVERIFIED'});
});

for(const [status,code]of [[401,'AUTHENTICATION_REQUIRED'],[403,'API_ACCESS_DENIED'],[429,'API_RATE_LIMITED'],[423,'API_RATE_LIMITED'],[500,'API_HTTP_FAILURE']])test('HTTP '+status+' is redacted and never automatically retried',async()=>{
  let calls=0;const client=make(async()=>{calls++;return response({secret:token},{ok:false,status});});
  await assert.rejects(client.accounts(),e=>e.code===code&&!e.message.includes(token));assert.equal(calls,1);
});

for(const [data,code]of [[{'p-ticket':'synthetic-ticket','p-time':2},'API_RATE_LIMITED'],[{'p-captcha':true},'API_CAPTCHA_REQUIRES_USER'],[{errorText:token},'API_BUSINESS_FAILURE'],[{failureReason:token},'API_BUSINESS_FAILURE']])test('HTTP200 '+code+' cannot masquerade as authorized account data',async()=>{
  await assert.rejects(make(async()=>response(data)).accounts(),e=>e.code===code&&!e.message.includes(token)&&!e.message.includes('synthetic-ticket'));
});

test('credential failures, header injection and arbitrary transport errors never leak a secret',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return response([account]);};
  await assert.rejects(make(fetchImpl,{getAccessToken:()=>{throw Error(token);}}).accounts(),{code:'ACCESS_TOKEN_UNAVAILABLE'});
  await assert.rejects(make(fetchImpl,{getAccessToken:()=>token+'\r\nx:y'}).accounts(),{code:'ACCESS_TOKEN_REQUIRED'});assert.equal(calls,0);
  await assert.rejects(make(async()=>{throw Object.assign(Error(token),{code:'API_'+token});}).accounts(),e=>e.code==='API_READ_FAILED'&&!e.message.includes(token));
});

test('returned URLs cannot redirect identity to another host, path, or account query',async()=>{
  for(const url of ['https://live.tradovateapi.com/v1/account/list','https://evil.invalid/v1/account/list',TRADOVATE_ACCOUNT_API.DEMO+'/order/list',TRADOVATE_ACCOUNT_API.DEMO+'/account/list?other=1'])await assert.rejects(make(async()=>response([account],{url})).accounts(),{code:'UNEXPECTED_API_DESTINATION'});
});

test('whole-response and credential acquisition timeouts prevent late new dispatch',async()=>{
  await assert.rejects(make(async()=>response(null,{json:()=>new Promise(()=>{})}),{timeoutMs:5}).accounts(),{code:'API_READ_TIMEOUT'});
  let release,calls=0;const pendingToken=new Promise(resolve=>{release=resolve;});
  const client=make(async()=>{calls++;return response([account]);},{timeoutMs:5,getAccessToken:()=>pendingToken});
  await assert.rejects(client.accounts(),{code:'API_READ_TIMEOUT'});release(token);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,0);
});

test('closing a client before pending token resolution invalidates that read and every later read',async()=>{
  let release,calls=0;const client=make(async()=>{calls++;return response([account]);},{getAccessToken:()=>new Promise(resolve=>{release=resolve;})});
  const pending=client.accounts();await new Promise(resolve=>setTimeout(resolve,0));client.close();release(token);
  await assert.rejects(pending,{code:'CLIENT_CLOSED'});await assert.rejects(client.accounts(),{code:'CLIENT_CLOSED'});assert.equal(calls,0);
});

test('duplicate, malformed, or missing-permission account rows never gain execution authority',async()=>{
  await assert.rejects(make(async()=>response([account,account])).accounts(),{code:'DUPLICATE_ACCOUNT_ID'});
  await assert.rejects(make(async()=>response([{...account,id:'17'}])).accounts(),{code:'INVALID_ACCOUNT_LIST'});
  await assert.rejects(make(async()=>response([{...account,name:'bad\nlabel'}])).accounts(),{code:'INVALID_ACCOUNT_LIST'});
  const [row]=await make(async()=>response([{id:17,name:'missing permissions'}])).accounts();assert.equal(row.active,false);assert.equal(row.readOnly,true);assert.equal(row.automationAuthorized,false);
});

test('registered default adapter honestly remains disconnected for every declared account environment',async()=>{
  const adapter=createTradovateAccountInspectionAdapter();assert.equal(adapter.id,'tradovate-api');assert.equal(adapter.provider,'TRADOVATE');
  assert.deepEqual(adapter.capabilities,{inspectAccount:true,preflight:false,submitMarket:false,reconcile:false});assert.ok(Object.isFrozen(adapter.capabilities));
  for(const environment of adapter.supportedEnvironments){const value=await adapter.inspectAccount({selection:selection(environment)});assert.equal(value.status,'NOT_CONNECTED');assert.deepEqual(value.reasonCodes,['AUTH_CONNECTION_REQUIRED']);assert.equal(value.environmentVerified,false);assert.equal(value.submitCapabilityCreated,false);assert.equal(value.ordersCreated,false);assert.equal('evidence'in value,false);}
  for(const operation of ['submit','submitMarket','preflight','reconcile'])assert.equal(operation in adapter,false);
});

for(const environment of ['DEMO','LIVE'])test('authorized '+environment+' identity read echoes pinned registry proof but never authorizes an order',async()=>{
  const client=make(async()=>response([account]),{environment});const picked=selection(environment);
  const adapter=createTradovateAccountInspectionAdapter({getClient:async()=>client,now:()=>at});
  const result=await adapter.inspectAccount({selection:picked});assert.equal(result.status,'NATIVE_ACCOUNT_OBSERVED');
  assert.equal(result.evidence.kind,'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1');assert.equal(result.evidence.environmentVerified,true);assert.equal(result.evidence.nativeAccountId,'17');assert.equal(result.evidence.accountIdString,'17');
  assert.equal(result.evidence.accountRevision,2);assert.equal(result.evidence.selectionKey,picked.selectionKey);assert.equal(result.evidence.origin,'AUTHORIZED_CONNECTOR');assert.equal(result.evidence.connected,true);assert.equal(result.evidence.synthetic,false);assert.equal(result.evidence.testOnly,false);assert.equal(result.evidence.ordersAuthorized,false);assert.equal(result.evidence.readOnly,true);
  assert.equal(result.observation.accountOrigin,'UNVERIFIED');assert.equal(result.observation.source.accountIdString,'17');assert.equal(result.submitCapabilityCreated,false);
});

test('account id strings preserve exact case/leading zeros and cannot match a UI display label',async()=>{
  const client=make(async()=>response([account])),adapter=createTradovateAccountInspectionAdapter({getClient:async()=>client,now:()=>at});
  for(const nativeAccountId of ['017','17 ','PAAPEX-display-label-is-not-origin-proof','PAAPEX']){const result=await adapter.inspectAccount({selection:selection('DEMO',nativeAccountId)});assert.equal(result.status,'ACCOUNT_MISMATCH');assert.equal('evidence'in result,false);}
});

test('client environment mismatch is blocked before an authenticated network read',async()=>{
  let calls=0;const client=make(async()=>{calls++;return response([account]);});
  const adapter=createTradovateAccountInspectionAdapter({getClient:async()=>client,now:()=>at});
  assert.equal((await adapter.inspectAccount({selection:selection('LIVE')})).status,'ACCOUNT_MISMATCH');assert.equal(calls,0);
});

for(const environment of ['PA','EVALUATION','REPLAY'])test('DEMO transport never certifies declared '+environment+' account origin or automation permission',async()=>{
  const client=make(async()=>response([account])),adapter=createTradovateAccountInspectionAdapter({getClient:async()=>client,now:()=>at});
  const result=await adapter.inspectAccount({selection:selection(environment)});assert.equal(result.status,'READ_ONLY');assert.equal(result.environmentVerified,false);assert.equal(result.evidence.environmentVerified,false);assert.equal(result.evidence.environment,environment);assert.equal(result.observation.apiEnvironment,'DEMO');assert.equal(result.observation.accountOrigin,'UNVERIFIED');
  if(environment!=='REPLAY')assert.ok(result.reasonCodes.includes('PERSONAL_API_PROP_EVALUATION_ACCESS_NOT_AVAILABLE'));
  assert.equal(result.evidence.ordersAuthorized,false);assert.equal(result.submitCapabilityCreated,false);
});

test('caller-invented client flags do not create authenticated broker evidence',async()=>{
  let calls=0;const adapter=createTradovateAccountInspectionAdapter({getClient:async()=>({environment:'LIVE',verified:true,accounts:async()=>{calls++;return[account];}}),now:()=>at});
  const value=await adapter.inspectAccount({selection:selection('LIVE')});assert.equal(value.status,'NOT_CONNECTED');assert.deepEqual(value.reasonCodes,['AUTHORIZED_TRADOVATE_READ_CLIENT_REQUIRED']);assert.equal(calls,0);
});

test('missing selection, changed account profile, stale clock and connector errors never become connection evidence',async()=>{
  const client=make(async()=>response([account])),adapter=createTradovateAccountInspectionAdapter({getClient:async()=>client,now:()=>at+2001});
  assert.equal((await adapter.inspectAccount()).status,'NOT_CONNECTED');
  const picked=selection();assert.equal((await adapter.inspectAccount({selection:picked,account:{...picked.profile,revision:3}})).status,'ACCOUNT_MISMATCH');
  assert.equal((await adapter.inspectAccount({selection:picked})).reasonCodes[0],'ACCOUNT_OBSERVATION_STALE');
  const bad=createTradovateAccountInspectionAdapter({getClient:()=>{throw Error(token);}});
  const value=await bad.inspectAccount({selection:picked});assert.equal(value.reasonCodes[0],'AUTH_CONNECTION_UNAVAILABLE');assert.equal(JSON.stringify(value).includes(token),false);
});

test('inspection freezes its selection receipt across asynchronous client acquisition',async()=>{
  const picked=selection(),client=make(async()=>response([account]));
  const adapter=createTradovateAccountInspectionAdapter({getClient:async input=>{input.selection.profile.nativeAccountId='999';input.account.revision=99;picked.selectionKey='new-current-selection';picked.profile.revision=3;return client;},now:()=>at});
  const value=await adapter.inspectAccount({selection:picked});assert.equal(value.status,'NATIVE_ACCOUNT_OBSERVED');assert.equal(value.evidence.selectionKey,'pinned-selection-2');assert.equal(value.evidence.accountRevision,2);
});
