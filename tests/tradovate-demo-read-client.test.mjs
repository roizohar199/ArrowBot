import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradovateDemoReadClient,TRADOVATE_DEMO_API} from '../tradovate-demo-read-client.mjs';
const token='test-only-not-a-real-access-token';
const response=data=>({ok:true,status:200,url:'',json:async()=>data});
const account={id:17,name:'SIM-LOCAL-TEST',active:true,readOnly:false};
const make=(fetchImpl,options={})=>createTradovateDemoReadClient({getAccessToken:()=>token,fetchImpl,...options});

test('demo reader pins DEMO GET destination, keeps authorization ephemeral and never grants order authority',async()=>{
  const calls=[];const client=make(async(url,options)=>{calls.push({url,options});return response([account]);});
  const rows=await client.accounts();assert.equal(rows[0].independentAccountVerified,false);assert.equal(rows[0].automationAuthorized,false);
  assert.equal(calls[0].url,TRADOVATE_DEMO_API+'/account/list');assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.credentials,'omit');assert.equal('submit' in client,false);assert.equal('placeOrder' in client,false);
});
test('Apex-like SIM label is not proof of independent or automation-eligible account',async()=>{
  const client=make(async()=>response([{...account,name:'PAAPEX-TEST'}]));
  const [row]=await client.accounts();assert.equal(row.environment,'DEMO');assert.equal(row.independentAccountVerified,false);assert.equal(row.automationAuthorized,false);
});
test('account snapshot authorizes exact selected account before reading positions/orders and filters other accounts',async()=>{
  const client=make(async url=>response(url.endsWith('/account/list')?[account]:url.endsWith('/position/list')?[{accountId:17,netPos:0},{accountId:18,netPos:3}]:[{accountId:17,ordStatus:'Working'},{accountId:18,ordStatus:'Filled'}]));
  const view=await client.snapshot(17);assert.equal(view.positions.length,1);assert.equal(view.orders.length,1);assert.equal(view.ordersCreated,false);assert.equal(view.automationAuthorized,false);
});
test('missing selected account fails before positions/orders network reads',async()=>{
  let count=0;const client=make(async()=>{count++;return response([account]);});
  await assert.rejects(client.snapshot(99),{code:'ACCOUNT_NOT_IN_AUTHENTICATED_LIST'});assert.equal(count,1);
});
test('incomplete parallel snapshot fails closed, without retry',async()=>{
  let count=0;const client=make(async url=>{count++;if(url.endsWith('/order/list'))throw Error('Bearer '+token);return response(url.endsWith('/account/list')?[account]:[]);});
  await assert.rejects(client.snapshot(17),e=>e.code==='API_READ_FAILED'&&!e.message.includes(token));assert.equal(count,3);
});
test('contract resolution requires exact dated NQ identity and leaves specifications/mapping unverified',async()=>{
  let url;const client=make(async value=>{url=value;return response({id:81,name:'NQZ6',contractMaturityId:77});});
  const contract=await client.findNqContract('NQZ6');assert.equal(url,TRADOVATE_DEMO_API+'/contract/find?name=NQZ6');
  assert.equal(contract.specificationVerified,false);assert.equal(contract.continuousMappingVerified,false);
  for(const name of ['NQ1!','MNQZ6','CME_MINI:NQZ2026','NQZ6&name=ESZ6'])await assert.rejects(client.findNqContract(name),{code:'DATED_NQ_CONTRACT_REQUIRED'});
});
test('wrong contract returned by broker is rejected',async()=>{
  await assert.rejects(make(async()=>response({id:81,name:'MNQZ6',contractMaturityId:77})).findNqContract('NQZ6'),{code:'CONTRACT_IDENTITY_UNVERIFIED'});
});
for(const [status,code] of [[401,'AUTHENTICATION_REQUIRED'],[403,'API_ACCESS_DENIED'],[429,'API_RATE_LIMITED'],[500,'API_HTTP_FAILURE']])test('HTTP '+status+' is explicit and not retried',async()=>{
  let count=0;const client=make(async()=>{count++;return {ok:false,status,json:async()=>({token})};});await assert.rejects(client.accounts(),{code});assert.equal(count,1);
});
for(const [body,code] of [[{'p-ticket':'secret-ticket','p-time':2},'API_RATE_LIMITED'],[{'p-captcha':true},'API_CAPTCHA_REQUIRES_USER'],[{failureReason:'Rejected'},'API_BUSINESS_FAILURE']])test('HTTP200 '+code+' does not masquerade as success',async()=>{
  await assert.rejects(make(async()=>response(body)).accounts(),e=>e.code===code&&!e.message.includes('secret-ticket'));
});
test('tokens with header injection fail without any request',async()=>{
  let count=0;const client=make(async()=>{count++;return response([]);},{getAccessToken:()=>token+'\r\nx: y'});await assert.rejects(client.accounts(),{code:'ACCESS_TOKEN_REQUIRED'});assert.equal(count,0);
});
test('credential provider failures and untrusted transport codes cannot leak secrets',async()=>{
  const client=make(async()=>response([]),{getAccessToken:()=>{throw Error(token);}});
  await assert.rejects(client.accounts(),e=>e.code==='ACCESS_TOKEN_UNAVAILABLE'&&!e.message.includes(token));
  await assert.rejects(make(async()=>{throw Object.assign(Error(token),{code:'API_'+token});}).accounts(),e=>e.code==='API_READ_FAILED'&&!e.message.includes(token));
});
test('redirected live destination is rejected',async()=>{
  await assert.rejects(make(async()=>({...response([account]),url:'https://live.tradovateapi.com/v1/account/list'})).accounts(),{code:'UNEXPECTED_API_DESTINATION'});
});
test('whole response-body read has bounded timeout and no retry',async()=>{
  let count=0;const client=make(async()=>{count++;return {...response(null),json:()=>new Promise(()=>{})};},{timeoutMs:10});await assert.rejects(client.accounts(),{code:'API_READ_TIMEOUT'});assert.equal(count,1);
});
test('closing during an inflight read prevents use of its result',async()=>{
  let release;const client=make(()=>new Promise(resolve=>{release=resolve;}));const pending=client.accounts();await new Promise(resolve=>setTimeout(resolve,0));client.close();release(response([account]));await assert.rejects(pending,{code:'CLIENT_CLOSED'});await assert.rejects(client.accounts(),{code:'CLIENT_CLOSED'});
});
test('duplicate accounts, missing permission fields and malformed snapshots fail closed',async()=>{
  await assert.rejects(make(async()=>response([account,account])).accounts(),{code:'DUPLICATE_ACCOUNT_ID'});
  const [row]=await make(async()=>response([{id:17,name:'missing fields'}])).accounts();assert.equal(row.active,false);assert.equal(row.readOnly,true);
  const client=make(async url=>response(url.endsWith('/account/list')?[account]:[{netPos:0}]));await assert.rejects(client.snapshot(17),{code:'INVALID_ACCOUNT_SNAPSHOT'});
});
