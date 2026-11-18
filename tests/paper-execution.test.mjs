import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePaperExecutionIntent,createPaperExecutionController} from '../paper-execution.mjs';
import {makePaperExecutionFixture as fixture} from './fixtures/paper-execution.mjs';
const syncSignal=(f,fn)=>{fn(f.alert.signal);f.analysis.events=[structuredClone(f.alert.signal)];f.analysis.signals=[structuredClone(f.alert.signal)];};
function harness({verifyStatus='FILLED_PROTECTED',proofOverrides={}}={}){
  const f=fixture(),calls=[],ledger=new Set();let context={source:f.source,state:f.state,analysis:f.analysis},evidence=f.brokerEvidence,hook=null;
  const controller=createPaperExecutionController({now:()=>f.now,getContext:()=>context,
    readEvidence:async()=>{calls.push('read');if(hook)await hook('read');return structuredClone(evidence);},
    prepareTicket:async intent=>{calls.push('prepare');Object.assign(evidence.ticket,{entry:intent.entry,quantity:1,type:'LIMIT',stopTicks:intent.stopTicks,targetTicks:intent.targetTicks,stopEnabled:true,targetEnabled:true});if(hook)await hook('prepare');return {status:'TICKET_PREPARED',evidence:structuredClone(evidence)};},
    reserve:async key=>{calls.push('reserve');if(hook)await hook('reserve');if(ledger.has(key))return {ok:false,reason:'DUPLICATE'};ledger.add(key);return {ok:true,status:'RESERVED'};},
    submitTicket:async(intent,{isCurrent})=>{calls.push('submit');if(hook)await hook('submit');if(!isCurrent())return {status:'CANCELLED',submitted:false};return {status:'SUBMITTED_UNCONFIRMED',submittedAt:f.now};},
    verifyResult:async intent=>{calls.push('verify');if(hook)await hook('verify');const filled=verifyStatus==='FILLED_PROTECTED',working=verifyStatus==='WORKING';return {status:verifyStatus,provider:'TRADINGVIEW_PAPER',accountKey:intent.accountKey,quantity:1,entryVerified:true,stopVerified:true,targetVerified:true,positionStateVerified:true,fillVerified:filled,stopActive:filled,targetActive:filled,protectionState:filled?'ACTIVE_FILLED_POSITION':working?'PENDING_PARENT_FILL':'UNVERIFIED',...proofOverrides};}});
  return {f,calls,ledger,controller,setHook(fn){hook=fn;},setContext(value){context=value;},setVerification(value,overrides={}){verifyStatus=value;proofOverrides=overrides;},context:()=>context,evidence,
    arm(){return controller.arm({accountKey:evidence.accountKey});},accept(){return controller.accept(f.alert,f.analysis,f.state);}};
}
test('synthetic LONG/SHORT prepare onevirtualNQ198.10USD withmedium-risk37tickstop andunchangedengineobservationflags',()=>{
  for(const direction of ['LONG','SHORT']){const f=fixture({direction}),before=structuredClone(f),r=preparePaperExecutionIntent({...f,brokerEvidence:f.brokerEvidence});assert.equal(r.status,'PREPARED',JSON.stringify(r));assert.equal(r.intent.entry,20000);assert.equal(r.intent.stop,f.alert.signal.invalidation);assert.equal(r.intent.stopTicks,37);assert.equal(r.intent.targetTicks,74);assert.equal(r.intent.riskPlan.totalPlannedRisk,198.1);assert.equal(r.intent.quantity,1);assert.equal(r.ordersCreated,false);assert.equal(r.realBrokerOrdersAuthorized,false);assert.equal(f.alert.signal.orderEligible,false);assert.deepEqual(f,before);}
});
test('all7filters, closedfreshsource, explicitreview, allincosts andunchangedstructuralstop aremandatory',()=>{
  const edits=[f=>{f.source.active=false;},f=>{f.source.generation++;},f=>{f.state.metadata.replay=true;},f=>{f.state.liveEligible=false;},f=>{f.state.bootstrap=true;},f=>{f.state.bootstrapAsOfTime=f.alert.signal.formationStartTime+1;},f=>{f.state.eligibleCloseTimes=[];},f=>{f.state.newlyClosed=[];},f=>{f.alert.approvedAtReceiverEpoch=NaN;},f=>{f.alert.receivedAt=f.now-15001;},f=>{f.alert.accountReview.profile.mode='LIVE';},f=>{f.alert.accountReview.profile.maxContracts=2;},f=>{f.alert.accountReview.profile.riskBudget=201;},f=>{f.alert.accountReview.profile.commissionPerContract='';},f=>{f.alert.accountReview.profile.slippageTicks='';},f=>{syncSignal(f,s=>{s.riskPlan.initialStop+=.25;});},f=>{syncSignal(f,s=>{s.riskPlan.totalPlannedRisk=1;});}];
  for(const edit of edits){const f=fixture();edit(f);assert.equal(preparePaperExecutionIntent(f).status,'BLOCKED',edit.toString());}
  for(const flag of ['requireRisk','requireLocation','requireHigherTimeframe','requireEma','requireFib','requireTrendline','requireSupplyDemand']){const f=fixture();syncSignal(f,s=>{s.parameterSnapshot.config[flag]=false;});assert.equal(preparePaperExecutionIntent(f).status,'BLOCKED');}
  const f=fixture({stopTicks:38});syncSignal(f,s=>{s.riskPlan.status='PLANNED';s.riskPlan.quantity=1;});assert.deepEqual(preparePaperExecutionIntent(f).reasonCodes,['PAPER_TOTAL_PLANNED_RISK_EXCEEDS_200_USD']);
});
test('Tradovate/Apex/unknownbroker, 3chartlayout, positions/orders, unobservedmapping andwide/stalequotes blockPaper',()=>{
  for(const edit of [f=>{f.brokerEvidence.provider='TRADOVATE';},f=>{f.brokerEvidence.provider='APEX';},f=>{f.brokerEvidence.status='UNKNOWN';},f=>{f.brokerEvidence.chartCount=3;},f=>{f.brokerEvidence.replay=true;},f=>{f.brokerEvidence.positions=[{quantity:1}];},f=>{f.brokerEvidence.workingOrders=[{}];},f=>{f.brokerEvidence.flat=false;},f=>{f.brokerEvidence.observedAt=f.now-2001;},f=>{f.brokerEvidence.ticket.mappingNotice='';},f=>{f.brokerEvidence.ticket.symbol='MNQZ2026';},f=>{f.brokerEvidence.ticket.quantity=2;},f=>{f.brokerEvidence.ticket.bid=19000;},f=>{f.brokerEvidence.ticket.bid=20001;f.brokerEvidence.ticket.ask=20001.25;}]){const f=fixture();edit(f);assert.equal(preparePaperExecutionIntent(f).status,'BLOCKED',edit.toString());}
});
test('Paper controller reserves beforeexactlyonesubmit and reportsfilled onlywithprotectedtableproof',async()=>{
  const h=harness();assert.equal(h.arm().state,'ARMED');const r=await h.accept();assert.equal(r.state,'FILLED_PROTECTED');assert.equal(r.ok,true);assert.deepEqual(h.calls,['read','prepare','reserve','read','submit','verify']);assert.equal(h.ledger.size,1);await h.accept();assert.equal(h.calls.filter(x=>x==='submit').length,1);
});
test('ongoingcurrentupdates mayclearclosearrays withoutinvalidatingfrozenapproval',async()=>{
  const h=harness();h.arm();h.setHook(stage=>{if(stage==='prepare'){const c=structuredClone(h.context());c.state.newlyClosed=[];c.state.eligibleCloseTimes=[];h.setContext(c);}});assert.equal((await h.accept()).state,'FILLED_PROTECTED');
});
test('preparedcapabilityretainsidenticalintentJSON acrossfreshbrokerobservations',async()=>{
  const h=harness();h.arm();let preparedJson;
  h.setHook(stage=>{if(stage==='prepare'){preparedJson=JSON.stringify(h.controller.snapshot().lastIntent);h.evidence.observedAt+=25;}if(stage==='submit')assert.equal(JSON.stringify(h.controller.snapshot().lastIntent),preparedJson);});
  assert.equal((await h.accept()).state,'FILLED_PROTECTED');
});
test('disarmornewbaseline aftereachpre-submitawait preventsthefinalgesture',async()=>{
  for(const stage of ['read','prepare','reserve']){const h=harness();h.arm();h.setHook(at=>{if(at===stage)h.controller.disarm('TEST_STOP');});await h.accept();assert.equal(h.calls.includes('submit'),false,stage);assert.equal(h.controller.snapshot().armed,false);}
  const h=harness();h.arm();h.setHook(stage=>{if(stage==='prepare'){const c=structuredClone(h.context());c.state.generation++;c.source.generation++;h.setContext(c);}});await h.accept();assert.equal(h.calls.includes('submit'),false);
});
test('brokerflip/preparedstopmismatch/duplicates orstoragefailure neverexecute aneworder',async()=>{
  for(const cause of ['broker','stop','duplicate','storage']){const h=harness();h.arm();h.setHook(stage=>{if(stage==='prepare'&&cause==='broker')h.evidence.provider='TRADOVATE';if(stage==='prepare'&&cause==='stop')h.evidence.ticket.stopTicks--;if(stage==='reserve'&&cause==='duplicate'){const r=preparePaperExecutionIntent(h.f);h.ledger.add(r.intent.key);}if(stage==='reserve'&&cause==='storage')throw Error('STORAGE');});await h.accept();assert.equal(h.calls.includes('submit'),false,cause);}
});
test('unknownsubmission/verification lockswithoutretry and a finalguard catchesdisarm insidesubmitcallback',async()=>{
  const h=harness({verifyStatus:'UNKNOWN'});h.arm();const unknown=await h.accept();assert.equal(unknown.state,'UNKNOWNLOCK');assert.equal(unknown.ordersCreated,null);assert.equal(unknown.submissionAttempted,true);h.controller.arm({accountKey:h.evidence.accountKey});await h.accept();assert.equal(h.calls.filter(x=>x==='submit').length,1);
  const stopped=harness();stopped.arm();stopped.setHook(stage=>{if(stage==='submit')stopped.controller.disarm('JUST_BEFORE_GESTURE');});await stopped.accept();assert.equal(stopped.calls.includes('verify'),false);assert.equal(stopped.controller.snapshot().armed,false);assert.equal(stopped.controller.snapshot().ordersCreated,false);
});
test('workingparentrequiresprotectionproof and remainsheld against additionalentries',async()=>{
  const h=harness({verifyStatus:'WORKING'});h.arm();const r=await h.accept();assert.equal(r.state,'WORKING');assert.equal(r.reason,'PAPER_WORKING_PARENT_BRACKETS_REGISTERED');assert.equal(r.lastResult.fillVerified,false);assert.equal(r.lastResult.stopActive,false);assert.equal(r.lastResult.targetActive,false);await h.accept();assert.equal(h.calls.filter(x=>x==='submit').length,1);
});
test('genericworkingorfilledbooleanswithouttheactualpendingoractiveprotectionstate lockforreconciliation',async()=>{
  for(const proofOverrides of [{protectionState:undefined},{fillVerified:true},{stopActive:true},{targetActive:true}]){const h=harness({verifyStatus:'WORKING',proofOverrides});h.arm();assert.equal((await h.accept()).state,'UNKNOWNLOCK');}
  for(const proofOverrides of [{fillVerified:false},{positionStateVerified:false},{stopActive:false},{targetActive:false},{protectionState:'PENDING_PARENT_FILL'}]){const h=harness({verifyStatus:'FILLED_PROTECTED',proofOverrides});h.arm();assert.equal((await h.accept()).state,'UNKNOWNLOCK');}
});
test('readonlyreconciliationcanverifylaterfillafterstopreviewresetfeedrecoveryandexpiredleasewithoutresubmit',async()=>{
  const h=harness({verifyStatus:'WORKING'});h.arm();await h.accept();const initial=h.calls.length;
  h.controller.disarm('USER_STOPPED');h.f.now+=60000;const c=structuredClone(h.context());c.source.active=false;c.source.accountReviewId=null;c.source.runId='new-feed-run';c.source.generation++;c.state.generation++;c.state.liveEligible=false;c.state.stale=true;h.setContext(c);h.setVerification('FILLED_PROTECTED');
  const r=await h.controller.reconcile();assert.equal(r.state,'FILLED_PROTECTED');assert.equal(r.armed,false);assert.equal(r.locked,false);assert.deepEqual(h.calls.slice(initial),['verify']);assert.equal(h.calls.filter(x=>x==='submit').length,1);assert.equal(h.calls.filter(x=>x==='reserve').length,1);
});
test('UNKNOWNcanbereadonlyreconciledbutneverautomaticallyrearmed',async()=>{
  const h=harness({verifyStatus:'UNKNOWN'});h.arm();await h.accept();assert.equal(h.controller.snapshot().locked,true);h.setVerification('WORKING');const r=await h.controller.reconcile();assert.equal(r.state,'WORKING');assert.equal(r.armed,false);assert.equal(r.locked,false);await h.accept();assert.equal(h.calls.filter(x=>x==='submit').length,1);
});
test('readonlyreconciliationrefuseschangedtargetaccountorsymbolduringawaitandmakesnoordercalls',async()=>{
  for(const kind of ['tab','url','symbol','account']){const h=harness({verifyStatus:'WORKING'});h.arm();await h.accept();const start=h.calls.length;h.setHook(stage=>{if(stage==='verify'){const c=structuredClone(h.context());if(kind==='tab')c.source.sourceTabId++;if(kind==='url')c.source.researchUrl='https://www.tradingview.com/chart/other/';if(kind==='symbol')c.state.metadata.instrument='COINBASE:BTCUSD';h.setContext(c);}});if(kind==='account')h.setVerification('WORKING',{accountKey:'paper-ui:foreign-account'});const r=await h.controller.reconcile();assert.equal(r.state,'UNKNOWNLOCK',kind);assert.equal(r.armed,false);assert.deepEqual(h.calls.slice(start),['verify']);}
  const before=harness({verifyStatus:'WORKING'});before.arm();await before.accept();const count=before.calls.length,c=structuredClone(before.context());c.source.sourceTabId++;before.setContext(c);assert.equal((await before.controller.reconcile()).state,'UNKNOWNLOCK');assert.equal(before.calls.length,count);
});
