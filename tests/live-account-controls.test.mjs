import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLiveAccountControls} from '../live-account-controls.mjs';
import {ACCOUNT_PROFILE_STORAGE_KEY} from '../account-profile.mjs';
import {LIVE_RULE_SETTINGS_KEY} from '../live-ohlc-settings.mjs';

const html=fs.readFileSync(new URL('../live-ohlc.html',import.meta.url),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
class Node{
  constructor(id='',doc){Object.assign(this,{id,doc,ownerDocument:doc,value:'',textContent:'',disabled:false,hidden:false,checked:false,open:false,dataset:{},children:[],listeners:new Map()});}
  addEventListener(name,fn){const list=this.listeners.get(name)??[];list.push(fn);this.listeners.set(name,list);}
  removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)??[]).filter(item=>item!==fn));}
  async emit(name,extra={}){const event={type:name,target:this,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners.get(name)??[])await fn(event);return event;}
  append(...nodes){this.children.push(...nodes);}
  after(node){this.doc.created.push(node);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this[name]=String(value);}
  removeAttribute(name){delete this[name];}
  focus(){this.doc.activeElement=this;}
  scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;void this.emit('close');}
  getBoundingClientRect(){return {top:0,left:0,right:300,bottom:300,width:300,height:300};}
  click(){if(!this.disabled)return this.emit('click');}
  remove(){}
}
function documentFixture(){
  const doc={nodes:new Map(),created:[],hidden:false,visibilityState:'visible',activeElement:null,getElementById(id){return this.nodes.get(id);},createElement(tag){const node=new Node('',this);node.tagName=tag.toUpperCase();return node;}};
  for(const id of ids)doc.nodes.set(id,new Node(id,doc));doc.body=new Node('body',doc);
  const $=id=>doc.getElementById(id);
  for(const [id,value] of Object.entries({'risk-budget':'200','point-value':'20','max-contracts':'1','reward-risk':'2','account-mode':'PAPER','account-currency':'USD','account-instrument':'CME_MINI:NQ1!','account-tick-size':'0.25'}))$(id).value=value;
  $('require-risk').checked=true;$('require-location').checked=true;$('account-form-error').hidden=true;$('stop-live').disabled=true;$('export-live').disabled=true;
  return {doc,$};
}
function storageFixture(seed={}){const data=structuredClone(seed),writes=[];return {data,writes,async get(key){return {[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));writes.push(structuredClone(value));}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function reviewedFields($,{commission='4.5',slippage='2'}={}){$('commission').value=commission;await $('commission').emit('input');$('slippage').value=slippage;await $('slippage').emit('input');$('account-costs-reviewed').checked=true;await $('account-costs-reviewed').emit('change');}

test('account setup has one copy of each risk input and starts with explicit costs, not a silent zero',async()=>{
  assert.equal(new Set(ids).size,ids.length);
  const f=documentFixture(),storage=storageFixture(),controls=createLiveAccountControls({document:f.doc,storage});await controls.initialize();
  assert.equal(f.$('commission').value,'');assert.equal(f.$('slippage').value,'');assert.equal(controls.snapshot().reviewAccepted,false);
  const request=controls.requestReview(17);assert.equal(f.$('account-dialog').open,true);assert.equal(f.$('account-costs-reviewed').checked,false);assert.equal(f.$('start-account-session').disabled,true);
  f.$('account-costs-reviewed').checked=true;await f.$('account-costs-reviewed').emit('change');assert.equal(f.$('start-account-session').disabled,true);
  await f.$('cancel-account').emit('click');assert.equal(await request,null);assert.equal(storage.writes.length,0);controls.dispose();
});

test('cancel restores unsaved values, never saves or confirms, and each restart requires a new review',async()=>{
  const f=documentFixture(),storage=storageFixture(),controls=createLiveAccountControls({document:f.doc,storage});await controls.initialize();
  const first=controls.requestReview(17);f.$('commission').value='12';await f.$('commission').emit('input');await f.$('cancel-account').emit('click');assert.equal(await first,null);assert.equal(f.$('commission').value,'');assert.equal(storage.writes.length,0);
  const second=controls.requestReview(17);await reviewedFields(f.$);assert.equal(f.$('start-account-session').disabled,false);await f.$('account-form').emit('submit');await flush();const accepted=await second;
  assert.equal(accepted.ok,true);assert.equal(accepted.profile.commissionPerContract,4.5);assert.equal(accepted.profile.slippageTicks,2);assert.equal(accepted.review.ordersAuthorized,false);assert.equal(controls.evaluateMetadata({instrument:'CME_MINI:NQ1!',tickSize:.25,pointValue:20},17).ok,true);
  controls.invalidate('STOPPED');const third=controls.requestReview(17);assert.equal(f.$('account-costs-reviewed').checked,false);assert.equal(f.$('start-account-session').disabled,true);await f.$('cancel-account').emit('click');assert.equal(await third,null);controls.dispose();
});

test('save-only persists a profile without resolving a pending start or restoring a reviewed session',async()=>{
  const f=documentFixture(),storage=storageFixture(),controls=createLiveAccountControls({document:f.doc,storage});await controls.initialize();const request=controls.requestReview(17);let resolved=false;void request.then(()=>{resolved=true;});await reviewedFields(f.$);await f.$('save-account-profile').emit('click');await flush();
  assert.equal(resolved,false);assert.equal(controls.snapshot().reviewAccepted,false);assert.equal(f.$('account-costs-reviewed').checked,false);assert.equal(storage.data[ACCOUNT_PROFILE_STORAGE_KEY].profiles[0].commissionPerContract,4.5);
  f.$('commission').value='99';await f.$('commission').emit('input');await f.$('cancel-account').emit('click');assert.equal(await request,null);assert.equal(f.$('commission').value,'4.5');
  const next=documentFixture(),restored=createLiveAccountControls({document:next.doc,storage});await restored.initialize();assert.equal(next.$('commission').value,'4.5');assert.equal(restored.snapshot().reviewAccepted,false);assert.equal(next.$('account-dialog').open,false);controls.dispose();restored.dispose();
});

test('editor Enter saves only and changing a reviewed cost revokes the accepted profile before a new start',async()=>{
  const f=documentFixture(),storage=storageFixture(),invalidations=[],controls=createLiveAccountControls({document:f.doc,storage,onInvalidate:reason=>invalidations.push(reason)});await controls.initialize();
  await f.$('edit-account').emit('click');await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();assert.equal(controls.snapshot().reviewAccepted,false);assert.equal(storage.data[ACCOUNT_PROFILE_STORAGE_KEY].profiles.length,1);await f.$('cancel-account').emit('click');
  const request=controls.requestReview(17);await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();await request;assert.equal(controls.snapshot().reviewAccepted,true);
  f.$('commission').value='8';await f.$('commission').emit('input');assert.equal(controls.snapshot().reviewAccepted,false);assert.ok(invalidations.includes('ACCOUNT_SETTINGS_CHANGED'));controls.dispose();
});

async function mainFixture({holdRuleSave=false}={}){
  const f=documentFixture(),legacy={schemaVersion:1,fields:{'risk-budget':'200','point-value':'20',commission:'0',slippage:'0','max-contracts':'1','reward-risk':'2'},checks:{'require-risk':false,'require-location':true,'require-ema':false,'require-fib':false},savedAt:1},storage=storageFixture({[LIVE_RULE_SETTINGS_KEY]:legacy});
  let releaseStorage=()=>{},waitingRuleSave=false;
  if(holdRuleSave){const original=storage.set.bind(storage),deferred=new Promise(resolve=>{releaseStorage=resolve;});storage.set=async value=>{if(value[LIVE_RULE_SETTINGS_KEY]){waitingRuleSave=true;await deferred;}return original(value);};}
  const events=new Map(),win={innerWidth:400,innerHeight:900,scrollTo(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(name,fn){events.set(name,fn);}};
  let reads=0,observerInstalls=0,sourcePreparations=0;const chrome={storage:{local:storage},tabs:{async query(){return [{id:17,title:'NQ chart',url:'https://www.tradingview.com/chart/test/'}];}},scripting:{async executeScript(command){if(command.func.name==='sourceDomTimingCommand'){if(command.args[0].action==='install')observerInstalls++;return [{result:{status:'OK'}}];}if(command.func.name==='prepareTradingViewWindowUi'){sourcePreparations++;return [{result:{status:'READY'}}];}if(command.func.name==='chartSignalOverlayCommand'||command.func.name==='windowWakeSourceCommand')return [{result:{status:command.args?.[0]?.action==='clear'?'CLEARED':'STOPPED'}}];if(command.args?.[0]?.stop)return [{result:{status:'STOPPED'}}];reads++;return [{result:{status:'UNAVAILABLE',reasonCodes:['PINE_LOGS_NOT_VISIBLE'],chart:null,messages:[]}}];}}};
  const before={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};globalThis.document=f.doc;globalThis.window=win;globalThis.chrome=chrome;
  await import('../live-ohlc.mjs?account-ui-test='+Math.random());await flush();f.$('live-tab').value='17';
  return {...f,storage,reads:()=>reads,observerInstalls:()=>observerInstalls,sourcePreparations:()=>sourcePreparations,releaseStorage,waitingRuleSave:()=>waitingRuleSave,async cleanup(){releaseStorage();events.get('pagehide')?.();await flush();for(const [key,value] of Object.entries(before))if(value===undefined)delete globalThis[key];else globalThis[key]=value;await flush();}};
}

test('live page does not read the chart on Connect or Cancel, forces risk on, and reads only after per-start account review',async()=>{
  const f=await mainFixture();try{
    assert.equal(f.$('require-risk').checked,true);assert.equal(f.$('require-risk').disabled,true);assert.equal(f.reads(),0);
    assert.equal(f.observerInstalls(),0);
    assert.equal(f.sourcePreparations(),0);
    await f.$('connect-live').emit('click');await flush();assert.equal(f.$('account-dialog').open,true);assert.equal(f.reads(),0);await f.$('cancel-account').emit('click');await flush();assert.equal(f.reads(),0);assert.equal(f.$('stop-live').disabled,true);
    await f.$('connect-live').emit('click');await flush();await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();await flush();assert.equal(f.reads(),1);assert.equal(f.$('stop-live').disabled,false);const evidence=JSON.parse(f.$('live-evidence').textContent);assert.equal(evidence.active,true);assert.equal(evidence.account.reviewAccepted,true);assert.equal(evidence.account.review.profile.commissionPerContract,4.5);
    await f.$('stop-live').emit('click');await f.$('connect-live').emit('click');await flush();assert.equal(f.$('account-dialog').open,true);assert.equal(f.$('account-costs-reviewed').checked,false);assert.equal(f.$('start-account-session').disabled,true);assert.equal(f.reads(),1);await f.$('cancel-account').emit('click');
  }finally{await f.cleanup();}
});

test('opening account setup during an active observation stops its feed and filter changes cannot resume it',async()=>{
  const f=await mainFixture();try{
    await f.$('connect-live').emit('click');await flush();await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();await flush();assert.equal(f.$('stop-live').disabled,false);
    await f.$('edit-account').emit('click');assert.equal(f.$('stop-live').disabled,true);assert.equal(JSON.parse(f.$('live-evidence').textContent).account.reviewAccepted,false);
    await f.$('cancel-account').emit('click');f.$('require-ema').checked=true;await f.$('require-ema').emit('input');await f.$('apply-live-rules').emit('click');await flush();assert.equal(f.$('stop-live').disabled,true);assert.equal(f.reads(),1);assert.equal(JSON.parse(f.$('live-evidence').textContent).account.reviewAccepted,false);
  }finally{await f.cleanup();}
});

test('a source or profile change while the accepted setup is being committed cannot start an unreviewed session',async()=>{
  for(const change of ['source','profile']){
    const f=await mainFixture({holdRuleSave:true});try{
      await f.$('connect-live').emit('click');await flush();await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();assert.equal(f.waitingRuleSave(),true);assert.equal(f.$('account-dialog').open,false);assert.equal(f.reads(),0);
      if(change==='source'){f.$('live-tab').value='18';await f.$('live-tab').emit('change');}
      else await f.$('edit-account').emit('click');
      f.releaseStorage();await flush();await flush();assert.equal(f.reads(),0);assert.equal(f.$('stop-live').disabled,true);assert.equal(JSON.parse(f.$('live-evidence').textContent).active,false);
      if(f.$('account-dialog').open)await f.$('cancel-account').emit('click');
    }finally{await f.cleanup();}
  }
});

test('focused measurement view can stop the feed and revokes the per-start review',async()=>{
  const f=await mainFixture();try{
    await f.$('connect-live').emit('click');await flush();await reviewedFields(f.$);await f.$('account-form').emit('submit');await flush();await flush();
    assert.equal(f.$('stop-focus-live').disabled,false);await f.$('focus-live').emit('click');assert.equal(f.doc.body.dataset.focus,'true');
    await f.$('stop-focus-live').emit('click');const evidence=JSON.parse(f.$('live-evidence').textContent);
    assert.equal(evidence.active,false);assert.equal(evidence.account.reviewAccepted,false);assert.equal(f.$('stop-focus-live').disabled,true);
  }finally{await f.cleanup();}
});
