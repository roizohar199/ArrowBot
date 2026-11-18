import test from 'node:test';
import assert from 'node:assert/strict';
import {readTradingViewExecutionAccount,createTradingViewAccountInspectionAdapter} from '../tradingview-account-inspector.mjs';
const url='https://www.tradingview.com/chart/research/';
class Node{
  constructor(text='',attributes={}){this.textContent=text;this.attrs=attributes;this.isConnected=true;this.parentElement=null;this.nodes=new Map();}
  getClientRects(){return [{width:100,height:20}];}
  querySelectorAll(selector){return this.nodes.get(selector)??[];}
  getAttribute(name){return this.attrs[name]??null;}
  click(){throw Error('READ_ONLY_INSPECTOR_MUST_NOT_CLICK');}
}
function fixture({provider='Replay Trading',account='PA-001',visible=true,replay=true,manager=false}={}){
  const doc=new Node();doc.visibilityState=visible?'visible':'hidden';doc.hidden=!visible;
  const replayButton=new Node('Replay Trading'),brokerButton=new Node(provider),accountManager=new Node(),selector=new Node(),name=new Node(account);
  doc.nodes.set('button[data-qa-id="replay_trading"][aria-label="Collapse Replay Trading"]',replay?[replayButton]:[]);
  doc.nodes.set('button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]',replay?[]:[brokerButton]);
  doc.nodes.set('[aria-label="Account manager"]',manager?[accountManager]:[]);
  doc.nodes.set('#header-toolbar-replay',[new Node('',{'aria-pressed':String(replay)})]);
  accountManager.nodes.set('[data-qa-id="account-selector"]',[selector]);selector.nodes.set('[class*="accountName-"]',[name]);
  return {doc,accountManager,selector,name};
}
function inspect(f,command={tabId:7,url}){
  const before={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
  Object.assign(globalThis,{document:f.doc,location:{href:url},getComputedStyle:()=>({display:'block',visibility:'visible'})});
  try{return readTradingViewExecutionAccount(command);}finally{for(const [key,value]of Object.entries(before))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
}
test('native read identifies exact Replay simulator namespace without touching a control',()=>{const result=inspect(fixture());assert.equal(result.status,'OBSERVED');assert.equal(result.provider,'REPLAY_TRADING');assert.equal(result.nativeAccountId,'replay:7');assert.equal(result.environmentVerified,true);assert.equal(result.ordersCreated,false);});
test('read exact Paper account label without balance, and retain leading zeros',()=>{const f=fixture({provider:'Paper Trading',account:'Demo-000031',replay:false,manager:true});const result=inspect(f);assert.equal(result.provider,'TRADINGVIEW_PAPER');assert.equal(result.nativeAccountId,'Demo-000031');assert.equal(result.environment,'DEMO');assert.equal(result.environmentVerified,true);assert.equal('balance' in result,false);});
test('Tradovate label does not prove PA vs demo/live environment',()=>{const result=inspect(fixture({provider:'Tradovate',account:'PA-001',replay:false,manager:true}));assert.equal(result.status,'OBSERVED');assert.equal(result.provider,'TRADOVATE');assert.equal(result.environment,null);assert.equal(result.environmentVerified,false);});
test('unknown broker label needs an explicit adapter mapping, not a guessed ID',()=>{const result=inspect(fixture({provider:'Another Broker',replay:false,manager:true}));assert.equal(result.provider,null);assert.deepEqual(result.reasonCodes,['PROVIDER_ADAPTER_MAPPING_REQUIRED']);});
test('hidden, changed-source, modal and ambiguous provider never yield native verification',()=>{
  assert.equal(inspect(fixture({visible:false})).status,'UNAVAILABLE');
  assert.equal(inspect(fixture(),{tabId:7,url:'https://www.tradingview.com/chart/another/'}).status,'UNAVAILABLE');
  const f=fixture();f.doc.nodes.set('[role="dialog"]',[new Node()]);assert.equal(inspect(f).status,'UNAVAILABLE');
  assert.equal(inspect(fixture({manager:true})).reasonCodes[0],'ACCOUNT_PROVIDER_AMBIGUOUS');
});
test('duplicate native labels and account-manager not visible are rejected',()=>{
  const f=fixture({provider:'Tradovate',replay:false,manager:true});f.selector.nodes.set('[class*="accountName-"]',[new Node('001'),new Node('002')]);assert.equal(inspect(f).status,'UNAVAILABLE');
  assert.equal(inspect(fixture({replay:false})).status,'UNAVAILABLE');
});
test('actual provider duplicated consistently in footer and panel remains one identity; conflicting providers are ambiguous',()=>{const f=fixture({provider:'Tradovate',account:'PA-001',replay:false,manager:true});const selector='button[aria-label="Open account manager"],button[aria-label="Collapse account manager"]';f.doc.nodes.set(selector,[new Node('Tradovate'),new Node('Tradovate')]);assert.equal(inspect(f).provider,'TRADOVATE');f.doc.nodes.set(selector,[new Node('Tradovate'),new Node('Paper Trading')]);assert.equal(inspect(f).reasonCodes[0],'ACCOUNT_PROVIDER_AMBIGUOUS');});
const selection={profile:{provider:'TRADOVATE',nativeAccountId:'PA-001',environment:'PA',revision:2},selectionKey:'selection-2'};
const trustedObservation=()=>({kind:'TRADINGVIEW_ACCOUNT_IDENTITY_OBSERVATION_V1',status:'OBSERVED',provider:'TRADOVATE',nativeAccountId:'PA-001',environment:null,environmentVerified:false,observedAt:2000,nativeIdentityVerified:true,synthetic:false,testOnly:false,readOnly:true,ordersCreated:false,submitted:false,source:{tabId:7,url}});
test('UI adapter matching PA identity remains READ ONLY with environment unverified',async()=>{
  const adapter=createTradingViewAccountInspectionAdapter({now:()=>2000,readAccount:async()=>trustedObservation()});
  const result=await adapter.inspectAccount({selection,source:{tabId:7,url}});assert.equal(result.evidence.environment,'PA');assert.equal(result.evidence.environmentVerified,false);assert.equal(adapter.capabilities.submitMarket,false);assert.equal(adapter.capabilities.preflight,false);assert.equal('submitMarket' in adapter,false);
});
test('adapter refuses another account, wrong known environment and stale evidence',async()=>{
  const observation={...trustedObservation(),nativeAccountId:'another'};
  const adapter=createTradingViewAccountInspectionAdapter({now:()=>2000,readAccount:async()=>observation});
  assert.equal((await adapter.inspectAccount({selection,source:{tabId:7,url}})).status,'ACCOUNT_MISMATCH');
  observation.nativeAccountId='PA-001';observation.environment='DEMO';observation.environmentVerified=true;
  assert.equal((await adapter.inspectAccount({selection,source:{tabId:7,url}})).status,'ACCOUNT_MISMATCH');
  observation.environmentVerified=false;observation.observedAt=-1;
  assert.equal((await adapter.inspectAccount({selection,source:{tabId:7,url}})).status,'NOT_CONNECTED');
});
test('synthetic, false native identity, unknown schema and mismatched source cannot be laundered into proof',async()=>{for(const changed of [{synthetic:true},{testOnly:true},{nativeIdentityVerified:false},{kind:'TEST'},{source:{tabId:8,url}},{readOnly:false}]){const adapter=createTradingViewAccountInspectionAdapter({now:()=>2000,readAccount:async()=>({...trustedObservation(),...changed})});const result=await adapter.inspectAccount({selection,source:{tabId:7,url}});assert.equal(result.status,'NOT_CONNECTED');assert.equal(result.evidence,undefined);}});
