import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePaperControls,createPaperReservationLedger,PAPER_RESERVATION_STORAGE_KEY,verifyLivePaperUiResult} from '../live-paper-controls.mjs';
import {makePaperExecutionFixture} from './fixtures/paper-execution.mjs';
import {makePaperOrderProofFixture} from './fixtures/paper-order-proof.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{await flush();await flush();await flush();};
function storageFixture(){
  const values={};return {values,async get(key){return {[key]:structuredClone(values[key])};},async set(next){Object.assign(values,structuredClone(next));}};
}
function locksFixture(){let tail=Promise.resolve();return {request(_key,_options,fn){const result=tail.then(fn);tail=result.catch(()=>{});return result;}};}

test('shared Paper ledger atomically claims once across concurrent pages and retains prior claims',async()=>{
  const storage=storageFixture(),locks=locksFixture(),first=createPaperReservationLedger({storage,locks,now:()=>1}),second=createPaperReservationLedger({storage,locks,now:()=>2});
  const results=await Promise.all([first('same-event',{eventId:'one',accountKey:'paper-one'}),second('same-event',{eventId:'one',accountKey:'paper-one'})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).reason,'PAPER_EVENT_ALREADY_RESERVED');
  assert.equal(Object.keys(storage.values[PAPER_RESERVATION_STORAGE_KEY].claims).length,1);
  assert.equal((await first('next-event',{eventId:'two'})).ok,true);assert.equal(Object.keys(storage.values[PAPER_RESERVATION_STORAGE_KEY].claims).length,2);
});
test('unavailable, corrupt, full or unverified Paper storage cannot grant a reservation',async()=>{
  assert.equal((await createPaperReservationLedger()('event')).ok,false);
  const storage=storageFixture(),locks=locksFixture(),reserve=createPaperReservationLedger({storage,locks});
  storage.values[PAPER_RESERVATION_STORAGE_KEY]={schemaVersion:2,claims:{}};assert.equal((await reserve('event')).reason,'INVALID_PAPER_LEDGER');
  storage.values[PAPER_RESERVATION_STORAGE_KEY]={schemaVersion:1,claims:Object.fromEntries(Array.from({length:1000},(_,i)=>['old-'+i,{}]))};
  assert.equal((await reserve('event')).reason,'PAPER_LEDGER_FULL_REVIEW_REQUIRED');assert.equal(Object.keys(storage.values[PAPER_RESERVATION_STORAGE_KEY].claims).length,1000);
  const unverified={async get(){return {};},async set(){}};assert.equal((await createPaperReservationLedger({storage:unverified,locks})('event')).reason,'PAPER_LEDGER_WRITE_UNVERIFIED');
});

class Node{
  constructor(){Object.assign(this,{textContent:'',disabled:false,checked:false,dataset:{},listeners:new Map()});}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  async emit(name){if(this.disabled&&name==='click')return;this.listeners.get(name)?.({target:this});await settle();}
}
function controlsFixture({allowExecution=false}={}){
  const f=makePaperExecutionFixture(),nodes=new Map(),ids=['paper-read','paper-arm','paper-disarm','paper-test-draft','paper-consent','paper-status','paper-account-status','paper-test-status','paper-journal'];
  ids.forEach(id=>nodes.set(id,new Node()));const doc={getElementById:id=>nodes.get(id)},$=id=>nodes.get(id),calls=[],storage=storageFixture();
  let context={source:f.source,state:f.state,analysis:f.analysis,profile:f.alert.accountReview.profile},evidence=structuredClone(f.brokerEvidence),readHook=null,verifyHook=null;
  const chrome={storage:{local:storage},tabs:{async get(id){return {id,url:evidence.researchUrl};}},scripting:{async executeScript({args}){
    const command=args[0];calls.push(structuredClone(command));if(command.action==='read'){if(readHook)await readHook();return [{result:structuredClone(evidence)}];}
    if(command.action==='prepare'){
      if(allowExecution)Object.assign(evidence.ticket,{entry:command.intent.entry,quantity:1,type:'LIMIT',stopTicks:command.intent.stopTicks,targetTicks:command.intent.targetTicks,stopEnabled:true,targetEnabled:true});
      return [{result:{status:'TICKET_PREPARED',evidence:structuredClone(evidence),ordersCreated:false}}];
    }
    if(command.action==='submit'&&allowExecution)return [{result:{status:'SUBMITTED_UNCONFIRMED',submittedAt:f.now,baselineOrderIds:[]}}];
    if(command.action==='verify'&&allowExecution){
      if(verifyHook)await verifyHook();
      const proof=makePaperOrderProofFixture().evidence;proof.accountKey=command.intent.accountKey;proof.observedAt=f.now;
      const rows=proof.tables.orders.rows;
      Object.assign(rows[0].cells,{limitPrice:String(command.intent.entry),takeProfit:String(command.intent.target),stopLoss:String(command.intent.stop)});
      rows[1].cells.stopPrice=String(command.intent.stop);rows[2].cells.limitPrice=String(command.intent.target);
      return [{result:{status:'UNKNOWN',evidence:{...evidence,...proof,flat:false}}}];
    }
    if(command.action==='disarm')return [{result:{status:'DISARMED',ordersCreated:false}}];
    throw Error('UNEXPECTED_SUBMISSION_IN_CONTROLS_TEST');
  }}};
  const controls=createLivePaperControls({document:doc,chrome,extension:true,locks:locksFixture(),now:()=>f.now,getContext:()=>context});
  return {f,$,controls,calls,setContext(next){context=next;},context:()=>context,setEvidence(next){evidence=next;},setReadHook(fn){readHook=fn;},setVerifyHook(fn){verifyHook=fn;}};
}
test('Paper UI starts disarmed, never auto reads, and rechecks the selected account before arming',async()=>{
  const h=controlsFixture();assert.equal(h.controls.snapshot().status,'DISARMED');assert.equal(h.calls.length,0);assert.equal(h.$('paper-arm').disabled,true);
  await h.$('paper-read').emit('click');assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'read');
  h.$('paper-consent').checked=true;await h.$('paper-consent').emit('change');assert.equal(h.$('paper-arm').disabled,false);
  await h.$('paper-arm').emit('click');assert.equal(h.calls.filter(c=>c.action==='read').length,2);assert.equal(h.controls.snapshot().status,'ARMED');
  assert.equal(h.calls.some(c=>c.action==='submit'),false);
  h.controls.disarm('TEST_STOP');assert.equal(h.controls.snapshot().status,'DISARMED');assert.equal(h.$('paper-consent').checked,false);
  const fakeReply={status:'FILLED_PROTECTED',fillVerified:true,protectionVerified:true};
  const proof=verifyLivePaperUiResult({quantity:1,accountKey:'paper-test'},fakeReply,{now:h.f.now});
  assert.notEqual(proof.status,'FILLED_PROTECTED');assert.deepEqual(proof.rawUiVerification,fakeReply);assert.equal(proof.verificationScope,'TYPED_PUBLIC_PAPER_TABLES_NOT_CLICK_ACKNOWLEDGEMENT');
  const headers=Object.entries({symbol:'Symbol',side:'Side',type:'Type',qty:'Quantity',limitPrice:'Limit price',stopPrice:'Stop price',avgPrice:'Fill price',takeProfit:'Take profit',stopLoss:'Stop loss',status:'Status',placingTime:'Placing time',id:'Order ID'}).map(([id,text])=>({id,text}));
  const row=(id,values)=>({rowId:id,cells:Object.fromEntries(headers.map(header=>[header.id,({symbol:'CME_MINI:NQZ2026',qty:'1',placingTime:'2026-11-16 15:31:01',id,...values})[header.id]??'']))});
  const evidence={status:'PAPER_UI_VERIFIED',provider:'TRADINGVIEW_PAPER',accountKey:'paper-test',observedAt:h.f.now,tables:{positions:{empty:true,rows:[]},orders:{headers,empty:false,rows:[
    row('31',{side:'Buy',type:'Limit',limitPrice:'20000',takeProfit:'20018.5',stopLoss:'19990.75',status:'Working'}),
    row('32',{side:'Sell',type:'Stop Loss',stopPrice:'19990.75',status:'Inactive'}),
    row('33',{side:'Sell',type:'Take Profit',limitPrice:'20018.5',status:'Inactive'}),
  ]}}};
  const expected={quantity:1,accountKey:'paper-test',direction:'LONG',expectedSymbol:'NQZ2026',entry:20000,stop:19990.75,target:20018.5};
  const typed=verifyLivePaperUiResult(expected,{status:'UNKNOWN',evidence},{now:h.f.now,baselineOrderIds:[]});
  assert.equal(typed.status,'WORKING');assert.equal(typed.fillVerified,false);assert.equal(typed.stopActive,false);assert.equal(typed.protectionState,'PENDING_PARENT_FILL');
  assert.notEqual(verifyLivePaperUiResult(expected,{status:'UNKNOWN',evidence},{now:h.f.now,baselineOrderIds:['31']}).status,'WORKING');
});
test('Paper account flip while arm validation awaits cannot arm or submit',async()=>{
  const h=controlsFixture();await h.$('paper-read').emit('click');h.$('paper-consent').checked=true;await h.$('paper-consent').emit('change');
  h.setReadHook(()=>{const evidence=structuredClone(h.f.brokerEvidence);evidence.accountKey='paper-other-account';h.setEvidence(evidence);});
  await h.$('paper-arm').emit('click');assert.equal(h.controls.snapshot().status,'DISARMED');assert.equal(h.calls.some(c=>c.action==='submit'),false);
  const occupied=controlsFixture(),evidence=structuredClone(occupied.f.brokerEvidence);evidence.flat=false;evidence.positions=[{quantity:1}];occupied.setEvidence(evidence);
  await occupied.$('paper-read').emit('click');occupied.$('paper-consent').checked=true;await occupied.$('paper-consent').emit('change');
  assert.equal(occupied.$('paper-arm').disabled,true);assert.match(occupied.$('paper-account-status').textContent,/חוסמים/);assert.doesNotMatch(occupied.$('paper-account-status').textContent,/אין פוזיציה/);
});
test('inactive RESEARCH profile can prepare explicit TEST draft but cannot arm or create a submission',async()=>{
  const h=controlsFixture(),ctx=structuredClone(h.context());ctx.source.active=false;ctx.state.liveEligible=false;ctx.profile.mode='RESEARCH';h.setContext(ctx);h.controls.refresh();
  h.$('paper-consent').checked=true;await h.$('paper-consent').emit('change');assert.equal(h.$('paper-arm').disabled,true);assert.equal(h.$('paper-test-draft').disabled,false);
  await h.$('paper-test-draft').emit('click');const prepare=h.calls.find(c=>c.action==='prepare');assert.equal(prepare.mode,'TEST_DRAFT');assert.equal(prepare.intent.quantity,1);assert.equal(prepare.intent.stopTicks,37);assert.equal(prepare.intent.targetTicks,74);assert.equal(prepare.intent.testOnly,true);
  assert.equal(h.controls.snapshot().testDraft.ordersCreated,false);assert.equal(h.controls.snapshot().status,'DISARMED');assert.equal(h.calls.some(c=>c.action==='submit'),false);
});
test('source invalidation disarms pending work and revokes consent without inspecting another tab',async()=>{
  const h=controlsFixture();await h.$('paper-read').emit('click');h.$('paper-consent').checked=true;await h.$('paper-consent').emit('change');await h.$('paper-arm').emit('click');
  h.context().state.stale=true;h.controls.refresh();assert.equal(h.controls.snapshot().status,'DISARMED');assert.equal(h.$('paper-consent').checked,false);assert.equal(h.calls.some(c=>c.action==='submit'),false);
});
test('working Paper follow-up is read-only, throttled and single-inflight; disarmed refresh never polls',async()=>{
  const h=controlsFixture({allowExecution:true});
  for(let i=0;i<10;i++)h.controls.refresh();assert.equal(h.calls.length,0);
  await h.$('paper-read').emit('click');h.$('paper-consent').checked=true;await h.$('paper-consent').emit('change');await h.$('paper-arm').emit('click');
  await h.controls.accept(h.f.alert,h.f.analysis,h.f.state);assert.equal(h.controls.snapshot().status,'WORKING');assert.equal(h.calls.filter(c=>c.action==='submit').length,1);
  const before=h.calls.filter(c=>c.action==='verify').length;
  h.controls.refresh();await settle();assert.equal(h.calls.filter(c=>c.action==='verify').length,before,'no extra read before one second');
  h.f.now+=1000;let release;const held=new Promise(resolve=>{release=resolve;});h.setVerifyHook(()=>held);
  for(let i=0;i<20;i++)h.controls.refresh();await settle();assert.equal(h.calls.filter(c=>c.action==='verify').length,before+1,'one in-flight verification despite repeated refreshes');
  release();await settle();assert.equal(h.controls.snapshot().status,'WORKING');assert.equal(h.controls.snapshot().armed,false);assert.equal(h.calls.filter(c=>c.action==='submit').length,1);
  h.setVerifyHook(null);await h.$('paper-read').emit('click');assert.equal(h.calls.filter(c=>c.action==='verify').length,before+2,'manual check reconciles the existing order');assert.equal(h.calls.filter(c=>c.action==='submit').length,1);
  h.controls.disarm('TEST_DISARMED');const count=h.calls.length;h.f.now+=1000;for(let i=0;i<10;i++)h.controls.refresh();await settle();assert.equal(h.calls.length,count,'no background check while disarmed');
});
