import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayReservationLedger,REPLAY_RESERVATION_STORAGE_KEY as key} from '../replay-execution-ledger.mjs';
function fixture(initial){
  let data=initial===undefined?{}:{[key]:structuredClone(initial)},writes=0,tail=Promise.resolve();
  const storage={async get(){await Promise.resolve();return structuredClone(data);},async set(value){await Promise.resolve();writes++;data={...data,...structuredClone(value)};}};
  const locks={request(name,options,callback){assert.equal(name,'arrow-replay-execution-ledger-v2');assert.deepEqual(options,{mode:'exclusive'});const run=tail.then(callback);tail=run.catch(()=>{});return run;}};
  return {storage,locks,writes:()=>writes,data:()=>data};
}
test('two Replay pages sharing the extension origin cannot both reserve the same event',async()=>{
  const f=fixture(),one=createReplayReservationLedger(f),two=createReplayReservationLedger(f);
  const replies=await Promise.all([one('same-event',{eventId:'NQ:LONG'}),two('same-event',{eventId:'NQ:LONG'})]);
  assert.equal(replies.filter(r=>r.ok).length,1);assert.equal(replies.filter(r=>r.reason==='REPLAY_EVENT_ALREADY_RESERVED').length,1);assert.equal(f.writes(),1);
  assert.equal((await createReplayReservationLedger(f)('same-event')).ok,false);
});
test('distinct events serialize without losing an earlier claim',async()=>{
  const f=fixture(),one=createReplayReservationLedger(f),two=createReplayReservationLedger(f);
  assert.deepEqual((await Promise.all([one('one'),two('two')])).map(r=>r.ok),[true,true]);assert.deepEqual(Object.keys(f.data()[key].claims),['one','two']);
});
test('missing locks, malformed storage and a full ledger refuse new reservations without writes',async()=>{
  const absent=fixture();assert.equal((await createReplayReservationLedger({storage:absent.storage})('one')).ok,false);assert.equal(absent.writes(),0);
  for(const state of [{schemaVersion:1,claims:{}},{schemaVersion:2,claims:[]},{schemaVersion:2,claims:Object.fromEntries(Array.from({length:512},(_,i)=>[String(i),{}]))}]){
    const f=fixture(state);assert.equal((await createReplayReservationLedger(f)('new')).ok,false);assert.equal(f.writes(),0);
  }
});
test('a failed storage readback never authorizes a native attempt',async()=>{
  const f=fixture();f.storage.set=async()=>{};
  assert.deepEqual(await createReplayReservationLedger(f)('one'),{ok:false,reason:'REPLAY_EVENT_RESERVATION_NOT_PERSISTED'});
});
const sortedReadback=value=>Array.isArray(value)?value.map(sortedReadback):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortedReadback(value[key])])):value;
test('lexicographically reordered Chrome-style dictionary readback verifies the same exact primitive claim and retains all prior reservations',async()=>{
  const f=fixture(),originalGet=f.storage.get;f.storage.get=async()=>sortedReadback(await originalGet());
  const reserve=createReplayReservationLedger({...f,now:()=>1794750000123}),record={eventId:'NQ:SHORT',asOfTime:1793355420000,sourceTabId:17,runId:'native-replay-run'};
  assert.deepEqual(await reserve('earlier',record),{ok:true,status:'RESERVED'});assert.deepEqual(await reserve('current',record),{ok:true,status:'RESERVED'});
  const claim=f.data()[key].claims.current,saved=(await f.storage.get())[key].claims.current;
  assert.notDeepEqual(Object.keys(saved),Object.keys(claim));assert.notEqual(JSON.stringify(saved),JSON.stringify(claim));assert.deepEqual(saved,claim);
  assert.equal(f.data()[key].claims.earlier.eventId,record.eventId);assert.equal(f.writes(),2);
  assert.deepEqual(await reserve('current',record),{ok:false,reason:'REPLAY_EVENT_ALREADY_RESERVED'});assert.equal(f.writes(),2);
});
test('extra, missing, changed and nonprimitive readback values cannot verify a consumed claim or enable a retry',async()=>{
  for(const change of [c=>{c.extra='unexpected';},c=>{delete c.sourceTabId;},c=>{c.sourceTabId=18;},c=>{c.reservedAt=String(c.reservedAt);},c=>{c.eventId={value:c.eventId};},c=>{c.state='AVAILABLE';}]){
    const f=fixture(),originalGet=f.storage.get;f.storage.get=async()=>{const result=sortedReadback(await originalGet());if(f.writes())change(result[key].claims.current);return result;};
    const reserve=createReplayReservationLedger({...f,now:()=>1794750000123}),record={eventId:'NQ:SHORT',asOfTime:1793355420000,sourceTabId:17,runId:'native-replay-run'};
    assert.deepEqual(await reserve('current',record),{ok:false,reason:'REPLAY_EVENT_RESERVATION_NOT_PERSISTED'},change.toString());
    assert.equal(f.writes(),1);assert.ok(Object.hasOwn(f.data()[key].claims,'current'),'uncertain readback never removes the written reservation');
    assert.deepEqual(await reserve('current',record),{ok:false,reason:'REPLAY_EVENT_ALREADY_RESERVED'});assert.equal(f.writes(),1);
  }
});
test('omitted optional metadata has an explicit JSON-compatible key set across storage serialization',async()=>{
  const f=fixture(),originalGet=f.storage.get;f.storage.get=async()=>JSON.parse(JSON.stringify(sortedReadback(await originalGet())));
  assert.deepEqual(await createReplayReservationLedger({...f,now:()=>1794750000123})('minimal'),{ok:true,status:'RESERVED'});
  assert.deepEqual(Object.keys(f.data()[key].claims.minimal).sort(),['eventId','reservedAt','runId','state']);
});
