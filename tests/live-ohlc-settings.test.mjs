import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_RULE_SETTINGS_KEY,makeLiveRuleSettings,normalizeLiveRuleSettings,loadLiveRuleSettings,saveLiveRuleSettings} from '../live-ohlc-settings.mjs';
const fields={'risk-budget':'200','point-value':'20',commission:'',slippage:'','max-contracts':'1','reward-risk':'2'};
const checks={'require-risk':true,'require-location':true,'require-ema':false,'require-fib':false};
const setting=()=>makeLiveRuleSettings({...fields},{...checks},100);

test('authorized 200 budget and one-contract rule round-trip while pending costs stay blank and no connection is restored',async()=>{
  const writes=[];let saved;
  const storage={async set(value){writes.push(value);saved=structuredClone(value);},async get(key){assert.equal(key,LIVE_RULE_SETTINGS_KEY);return saved;}};
  assert.equal((await saveLiveRuleSettings(storage,setting())).status,'SAVED');
  assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0]),['arrow.liveOhlcRules.v1']);
  const result=await loadLiveRuleSettings(storage);assert.equal(result.status,'RESTORED');assert.deepEqual(result.settings.fields,fields);assert.deepEqual(result.settings.checks,checks);
  assert.equal(result.settings.fields.commission,'');assert.equal(result.settings.fields.slippage,'');
  assert.deepEqual(Object.keys(result.settings).sort(),['checks','fields','savedAt','schemaVersion']);
  result.settings.fields['risk-budget']='999';assert.equal(saved[LIVE_RULE_SETTINGS_KEY].fields['risk-budget'],'200');
});

test('invalid numeric settings, fractional contracts, extreme values, unknown fields and checkbox coercion never restore',()=>{
  for(const patch of [{'risk-budget':'NaN'},{'risk-budget':'-1'},{'risk-budget':'1e99'},{'point-value':'0'},{commission:'-0.1'},{slippage:'Infinity'},{'max-contracts':'1.5'},{'max-contracts':'0'},{'reward-risk':'0'},{'reward-risk':'1001'}]){
    const value=setting();Object.assign(value.fields,patch);assert.equal(normalizeLiveRuleSettings(value),null);
  }
  for(const change of [value=>{value.feed={tabId:41};},value=>{value.fields.broker='account';},value=>{delete value.fields.commission;},value=>{value.checks['require-risk']='false';},value=>{value.schemaVersion=2;}]){
    const value=setting();change(value);assert.equal(normalizeLiveRuleSettings(value),null);
  }
});

test('absence or invalid stored state returns no settings and never invents account risk defaults',async()=>{
  assert.deepEqual(await loadLiveRuleSettings({get:async()=>({})}),{status:'EMPTY',settings:null});
  const wrong={...setting(),schemaVersion:99};
  assert.deepEqual(await loadLiveRuleSettings({get:async()=>({[LIVE_RULE_SETTINGS_KEY]:wrong})}),{status:'INVALID',settings:null});
  assert.deepEqual(await loadLiveRuleSettings(undefined),{status:'UNAVAILABLE',settings:null});
});

test('storage rejection and bounded timeout leave the caller free to use in-memory settings',async()=>{
  const broken={get:async()=>{throw Error('storage unavailable');},set:async()=>{throw Error('quota');}};
  assert.deepEqual(await loadLiveRuleSettings(broken),{status:'UNAVAILABLE',settings:null});
  assert.deepEqual(await saveLiveRuleSettings(broken,setting()),{status:'UNAVAILABLE'});
  const pending={get:()=>new Promise(()=>{}),set:()=>new Promise(()=>{})};
  assert.deepEqual(await loadLiveRuleSettings(pending,{timeoutMs:5}),{status:'UNAVAILABLE',settings:null});
  assert.deepEqual(await saveLiveRuleSettings(pending,setting(),{timeoutMs:5}),{status:'UNAVAILABLE'});
});

test('research-mode checkbox is an explicit persisted preference and invalid payloads cause no storage mutation',async()=>{
  const value=setting();value.checks['require-risk']=false;
  assert.equal(normalizeLiveRuleSettings(value).checks['require-risk'],false);
  let written=false;value.positions=[];
  await assert.rejects(saveLiveRuleSettings({set:async()=>{written=true;}},value),/INVALID_LIVE_RULE_SETTINGS/);assert.equal(written,false);
});

test('restored numbers use HTML-compatible canonical strings while zero costs remain an explicit assumption',()=>{
  const value=setting();value.fields['risk-budget']=' +2e2 ';value.fields.commission='0.00';value.fields.slippage='0';
  const normalized=normalizeLiveRuleSettings(value);assert.equal(normalized.fields['risk-budget'],'200');assert.equal(normalized.fields.commission,'0');assert.equal(normalized.fields.slippage,'0');assert.equal(normalized.checks['require-risk'],true);
});
