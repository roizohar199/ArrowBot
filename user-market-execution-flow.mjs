// Separate, explicitly armed research-Replay entry via the user's observed DOM
// quantity. No quantity setter, risk calculation, bracket creation or trade
// management exists here. Actual UI actions are injected and must revalidate.
import {analyzeGuideSignals,GUIDE_SIGNAL_VERSION} from './guide-signal-engine.mjs';
import {selectGuideTechnicalDecision,GUIDE_TECHNICAL_DECISION_VERSION} from './guide-technical-decision.mjs';
import {REPLAY_EXECUTION_INTENT_VERSION,REPLAY_EXECUTION_PUBLIC_FIELDS} from './replay-execution-intent.mjs';

export const USER_MARKET_EXECUTION_FLOW_VERSION='user-market-execution-flow-1';
export const USER_MARKET_INTENT_VERSION='user-market-intent-1';
const finite=Number.isFinite,integer=Number.isSafeInteger,clone=x=>structuredClone(x),minute=60000,origin=1577836800000,scalar=1e12;
const text=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const fresh=(at,now,max=2000)=>finite(at)&&at>=0&&at<=now&&now-at<=max;
function targetKey(t){try{const u=new URL(t.researchUrl);return t.instrument==='CME_MINI:NQ1!'&&t.timeframe==='1'&&integer(t.sourceTabId)&&t.sourceTabId>0&&u.protocol==='https:'&&['tradingview.com','www.tradingview.com'].includes(u.hostname)&&/^\/chart\/[A-Za-z0-9_-]+\/$/.test(u.pathname)&&!u.search&&!u.hash&&!u.username&&!u.password?JSON.stringify([t.researchUrl,t.sourceTabId,t.instrument,t.timeframe]):null;}catch{return null;}}
const signalKey=s=>s&&JSON.stringify([s.eventId,s.instrument,s.timeframe,s.direction,s.confirmedAt,s.confirmationBarCloseTime,s.confirmationClose,s.sourceEventIds]);
function rawNumber(raw){if(!text(raw,128))return NaN;const s=raw.replace(/[ ,\u00a0\u202f\u2009\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');return /^\d+(?:\.0+)?$/.test(s)?Number(s):NaN;}
function rawProof(w){
  const n=Object.fromEntries(REPLAY_EXECUTION_PUBLIC_FIELDS.map(key=>[key,rawNumber(w.fields?.[key])])),c=w.current,tag=w.sequence%4096;
  return Object.values(n).every(integer)&&n.ARROW2_RUN_EPOCH===w.runEpoch&&n.ARROW2_SEQ_BEGIN===w.sequence&&n.ARROW2_SEQ_END===w.sequence
    &&n.ARROW2_CHECKSUM_A>=0&&n.ARROW2_CHECKSUM_A<1000000007&&n.ARROW2_CHECKSUM_B>=0&&n.ARROW2_CHECKSUM_B<1000000009
    &&integer(c.providerBarIndex)&&c.providerBarIndex>=0&&typeof c.sessionFirst==='boolean'&&typeof c.sessionLast==='boolean'
    &&Math.floor(n.ARROW2_CURRENT_TIME/scalar)===tag&&n.ARROW2_CURRENT_TIME%scalar+origin===c.time
    &&Math.floor(n.ARROW2_CURRENT_CLOSE_TIME/scalar)===tag&&n.ARROW2_CURRENT_CLOSE_TIME%scalar===c.providerBarIndex*4+(c.sessionFirst?1:0)+(c.sessionLast?2:0);
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
/** getContext: {active,generation,target,sourceSessionId,sourceRunId}.
 * readSource({expected,reason}) returns {analysisInput,replayWitness}.
 * Native callbacks take one serializable command; submitMarket additionally
 * gets {isCurrent} for the outer wrapper only (never serialize that function).
 */
export function createUserMarketExecutionFlow({getContext,readSource,readPresetAndInventory,submitMarket,verifySubmission,disarmDriver,reserve,onChange=()=>{},now=Date.now,monotonic=()=>performance.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),recomputeAnalysis=analyzeGuideSignals,requireInheritedPreset=false}={}){
  if([getContext,readSource,readPresetAndInventory,submitMarket,verifySubmission,disarmDriver,reserve,onChange,now,monotonic,wait,recomputeAnalysis].some(f=>typeof f!=='function'))throw TypeError('USER_MARKET_CALLBACKS_REQUIRED');
  if(typeof requireInheritedPreset!=='boolean')throw TypeError('USER_MARKET_EXPLICIT_PRESET_POLICY_REQUIRED');
  let state='DISARMED',reason='USER_MARKET_NOT_ARMED',armed=false,busy=false,locked=false,epoch=0,target=null,generation=null,sessionId=null,runId=null;
  let intent=null,submission=null,result=null,attempted=false,verified=false;const used=new Set(),journal=[],timing={};
  const context=()=>getContext()??{};
  const snapshot=()=>({version:USER_MARKET_EXECUTION_FLOW_VERSION,state,reason,armed,busy,inFlight:busy,locked,target:target?clone(target):null,sourceSessionId:sessionId,sourceRunId:runId,
    intent:intent?clone(intent):null,submission:submission?clone(submission):null,result:result?clone(result):null,submissionAttempted:attempted,ordersCreated:verified?true:attempted?null:false,
    userManaged:true,riskManagement:'USER_MANAGED_NOT_CALCULATED',postFillManagement:false,presetProtectionRequired:requireInheritedPreset,protectionVerified:false,realBrokerOrdersAuthorized:false,timing:clone(timing),journal:clone(journal),engineMode:recomputeAnalysis===analyzeGuideSignals?'FULL_ENGINE_RECOMPUTED':'INJECTED_COMPONENT_TEST_ENGINE'});
  function publish(next,code){state=next;reason=code;journal.push({state,reason,at:now()});if(journal.length>100)journal.shift();try{onChange(snapshot());}catch{}return snapshot();}
  function pinned(){const c=context();return c.active===true&&c.generation===generation&&c.sourceSessionId===sessionId&&c.sourceRunId===runId&&targetKey(c.target)===targetKey(target);}
  const current=token=>token===epoch&&armed&&!locked&&pinned();
  function failure(code,unknown=attempted){if(unknown){armed=false;locked=true;return publish('UNKNOWNLOCK',code);}return publish(armed?'BLOCKED':'DISARMED',code);}
  function arm(requested){
    const c=context();if(busy||locked||attempted||intent)return {ok:false,...snapshot(),refusalReason:'USER_MARKET_EXISTING_ATTEMPT_REQUIRES_MANUAL_RECONCILIATION'};
    if(!targetKey(requested)||c.active!==true||!integer(c.generation)||targetKey(c.target)!==targetKey(requested)||!text(c.sourceSessionId)||!text(c.sourceRunId))return {ok:false,...failure('USER_MARKET_PINNED_RESEARCH_SESSION_REQUIRED',false)};
    target=clone(requested);generation=c.generation;sessionId=c.sourceSessionId;runId=c.sourceRunId;epoch++;armed=true;return {ok:true,...publish('ARMED','USER_MARKET_WAITING_FOR_ALL_SEVEN_TECHNICAL_CONFIRMATION')};
  }
  async function disarm(code='USER_MARKET_DISARMED'){
    epoch++;armed=false;if(attempted&&!verified)locked=true;publish(verified?'FILLED_USER_MANAGED':locked?'UNKNOWNLOCK':'DISARMED',code);
    try{if(target){const reply=await disarmDriver({expected:clone(target),reason:code,requireInheritedPreset});if(!['DISARMED','UNKNOWNLOCK'].includes(reply?.status))return {ok:false,...failure('USER_MARKET_NATIVE_INVALIDATION_UNVERIFIED',attempted)};}return {ok:true,...snapshot()};}
    catch{return {ok:false,...failure('USER_MARKET_NATIVE_INVALIDATION_UNVERIFIED',attempted)};}
  }
  function sourceBinding(bundle,{approval=null}={}){
    const w=bundle?.replayWitness,c=w?.current,p=w?.previous,at=now(),role=c?.closed===true?'current':'previous',closed=role==='current'?c:p;
    if(w?.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||w.mode!=='REPLAY'||w.replay!==true||w.liveEligible!==false||w.checksumsVerified!==true||w.synthetic===true||w.testOnly===true
      ||w.runId!==runId||!integer(w.runEpoch)||w.runId!=='CME_MINI:NQ1!|1|'+w.runEpoch||!integer(w.sequence)||w.sequence<0||!fresh(w.observedAt,at)
      ||!finite(w.sourceDocumentTimeOrigin)||!finite(w.sourceObservedEpochMs)||w.sourceObservedEpochMs<w.sourceDocumentTimeOrigin||!c||!rawProof(w)
      ||w.metadata?.instrument!=='CME_MINI:NQ1!'||w.metadata.timeframe!=='1'||w.metadata.source!=='ohlc'||w.metadata.chartType!=='standard'||w.metadata.synthetic===true||w.metadata.testOnly===true
      ||typeof c.closed!=='boolean'||c.sourceClosed!==c.closed||!integer(c.time)||c.closeTime-c.time!==minute||w.currentTime!==c.time||w.currentCloseTime!==c.closeTime
      ||closed?.closed!==true||closed.sourceClosed!==true||!integer(closed.closeTime)||role==='previous'&&closed.closeTime!==c.time)throw Error('USER_MARKET_FRESH_COHERENT_REPLAY_SOURCE_REQUIRED');
    if(approval&&(closed.closeTime<approval.asOfTime||w.sourceDocumentTimeOrigin!==intent.sourceDocumentTimeOrigin))throw Error('USER_MARKET_LIFECYCLE_SOURCE_CHANGED');
    return {sourceTabId:target.sourceTabId,runId:w.runId,runEpoch:w.runEpoch,sequence:w.sequence,currentTime:c.time,currentCloseTime:c.closeTime,asOfTime:closed.closeTime,
      eventId:approval?.eventId??null,...(approval?{approvalAsOfTime:approval.asOfTime}:{}),closedBarRole:role,fields:Object.fromEntries(REPLAY_EXECUTION_PUBLIC_FIELDS.map(key=>[key,w.fields[key]]))};
  }
  function nativeEvidence(e,binding){
    // The inherited native bracket schema is not yet supported. Required mode
    // fails closed even when a native reader itself reports BLOCKED/missing.
    if(requireInheritedPreset)throw Error('USER_MARKET_SAVED_BRACKET_PRESET_REQUIRED');
    const p=e?.preset,i=e?.inventory,lease=e?.lease,at=now(),sameFields=x=>REPLAY_EXECUTION_PUBLIC_FIELDS.every(key=>x?.[key]===binding.fields[key]);
    // Chrome transports dictionaries independently of JavaScript insertion
    // order. Preserve the exact schema and values without ordering its keys.
    const sameBinding=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===Object.keys(binding).length&&Object.keys(binding).every(key=>Object.hasOwn(x,key)&&(key==='fields'?x.fields&&typeof x.fields==='object'&&!Array.isArray(x.fields)&&Object.keys(x.fields).length===REPLAY_EXECUTION_PUBLIC_FIELDS.length&&sameFields(x.fields):x[key]===binding[key]));
    if(e?.status!=='USER_MARKET_NATIVE_READY'||e.provider!=='REPLAY_TRADING'||e.mode!=='USER_MARKET'||e.testOnly===true||e.synthetic===true||!fresh(e.observedAt,at,750)
      ||e.nativeSide!==(binding.direction==='LONG'?'BUY':'SELL'))throw Error('USER_MARKET_NATIVE_PRESET_EVIDENCE_REQUIRED');
    if(!i||i.kind!=='REPLAY_DOM_SYMBOL_INVENTORY_PUBLIC_V1'||i.status!=='FLAT_NO_PENDING'||i.provider!=='REPLAY_TRADING'||i.scope!=='CURRENT_REPLAY_SYMBOL_ONLY'||i.sourceTabId!==target.sourceTabId||i.researchUrl!==target.researchUrl||i.instrument!=='CME_MINI:NQ1!'||i.timeframe!=='1'
      ||!['flat','positionEmpty','pendingEmpty','positionsComplete','workingOrdersComplete','buyCancelDisabled','sellCancelDisabled'].every(key=>i[key]===true)
      ||i.positionMarker!=='—'||i.pnlMarker!=='—'||!Array.isArray(i.positions)||i.positions.length||!Array.isArray(i.workingOrders)||i.workingOrders.length||!sameFields(i.sourceFields)||!sameFields(e.sourceFields)
      ||!sameBinding(e.sourceBinding)||i.documentTimeOrigin!==e.documentTimeOrigin||!fresh(i.observedAt,at,750))throw Error('USER_MARKET_NATIVE_ZERO_INVENTORY_REQUIRED');
    if(p?.kind!=='NATIVE_REPLAY_DOM_MARKET_QUANTITY_V1'||p.symbol!=='NQ1!'||!integer(p.quantity)||p.quantity<1||p.quantity>1000000||!text(p.quantityRaw,40)||rawNumber(p.quantityRaw)!==p.quantity
      ||!text(p.fingerprint,2048)||p.scope!=='NATIVE_DOM_QUANTITY_ONLY_BRACKET_PRESET_UNVERIFIED'||p.bracketPresetVerified!==false||p.sourceControl!=='input#dom-quantity-input[data-qa-id~="qty-dom-input"]')throw Error('USER_MARKET_OBSERVED_QUANTITY_ONLY_PRESET_REQUIRED');
    if(p.fingerprint!==JSON.stringify(['native-replay-dom-market-quantity-1',p.symbol,p.quantity,p.quantityRaw,p.sourceControl]))throw Error('USER_MARKET_PRESET_FINGERPRINT_CHANGED');
    if(!text(lease?.id)||lease.maximumAgeMs!==750||!fresh(lease.observedAt,at,750)||!finite(lease.expiresAt)||lease.expiresAt<at||lease.expiresAt>lease.observedAt+750)throw Error('USER_MARKET_PRIVATE_FRESH_PRESET_LEASE_REQUIRED');
    return p;
  }
  function technicalEntryWitness(technical,analysis,quote){
    const ids=technical.signal.sourceEventIds,events=new Map(analysis.events.map(event=>[event.eventId,event]));
    const setups=ids.map(id=>{
      const e=events.get(id);
      if(!e||e.direction!==technical.direction||e.confirmationBarCloseTime!==technical.signal.confirmationBarCloseTime||![e.trigger,e.invalidation].every(level=>finite(level)&&level>0&&integer(level/.25)))throw Error('USER_MARKET_FROZEN_TECHNICAL_SETUP_MISSING');
      return {eventId:e.eventId,trigger:e.trigger,structuralInvalidation:e.invalidation};
    });
    if(!finite(quote)||quote<=0||!integer(quote/.25))throw Error('USER_MARKET_CURRENT_TECHNICAL_QUOTE_REQUIRED');
    const eligibleSetupIds=setups.filter(s=>technical.direction==='LONG'?quote>s.trigger&&quote>=s.structuralInvalidation:quote<s.trigger&&quote<=s.structuralInvalidation).map(s=>s.eventId);
    if(!eligibleSetupIds.length)throw Error('USER_MARKET_CURRENT_PRICE_INVALIDATES_ALL_CONFIRMED_SETUPS');
    return {kind:'CURRENT_REPLAY_QUOTE_PRESERVES_FROZEN_SETUP',direction:technical.direction,quote,asOfTime:technical.currentClosedBarCloseTime,sourceEventIds:[...ids],eligibleSetupIds,setups,pricesAdjusted:false};
  }
  // This optional measurement anchor never authorizes execution. Capture it
  // before readSource's await so later revalidation cannot erase first-analysis
  // time or mutate the caller's original observation into a fresher one.
  function originalSourceCapture(candidate){
    const unavailable=code=>freeze({status:'UNAVAILABLE',capture:null,reasonCodes:[code]});
    try{
      if(!candidate?.replayWitness)return unavailable('ORIGINAL_SOURCE_CAPTURE_NOT_PROVIDED');
      const w=clone(candidate.replayWitness),d=clone(candidate.technicalDecision),s=d?.signal,c=w.current,role=c?.closed===true?'current':'previous',closed=role==='current'?c:w.previous;
      if(w.kind!=='TRADINGVIEW_REPLAY_WINDOW_WITNESS'||w.mode!=='REPLAY'||w.replay!==true||w.liveEligible!==false||w.checksumsVerified!==true||w.synthetic===true||w.testOnly===true
        ||w.runId!==runId||!integer(w.runEpoch)||w.runId!=='CME_MINI:NQ1!|1|'+w.runEpoch||!integer(w.sequence)||w.sequence<0||!c||!rawProof(w)
        ||!finite(w.sourceDocumentTimeOrigin)||!finite(w.sourceObservedEpochMs)||w.sourceObservedEpochMs<w.sourceDocumentTimeOrigin||!finite(w.observedAt)||w.observedAt<0||w.observedAt>now()
        ||w.metadata?.source!=='ohlc'||w.metadata.instrument!=='CME_MINI:NQ1!'||w.metadata.timeframe!=='1'||w.metadata.timeframeMs!==minute||w.metadata.tickSize!==.25||w.metadata.pointValue!==20||w.metadata.currency!=='USD'||w.metadata.chartType!=='standard'||w.metadata.synthetic===true||w.metadata.testOnly===true
        ||typeof c.closed!=='boolean'||c.sourceClosed!==c.closed||!integer(c.time)||c.closeTime-c.time!==minute||w.currentTime!==c.time||w.currentCloseTime!==c.closeTime
        ||closed?.closed!==true||closed.sourceClosed!==true||!integer(closed.time)||closed.closeTime-closed.time!==minute||role==='previous'&&closed.closeTime!==c.time
        ||['open','high','low','close'].some(key=>!finite(closed[key])||closed[key]<=0||!integer(closed[key]/.25))||closed.high<Math.max(closed.open,closed.close,closed.low)||closed.low>Math.min(closed.open,closed.close,closed.high))return unavailable('ORIGINAL_SOURCE_CAPTURE_PROOF_INVALID');
      if(d?.kind!=='GUIDE_TECHNICAL_DIRECTION_DECISION'||d.definitionVersion!==GUIDE_TECHNICAL_DECISION_VERSION||d.engineVersion!==GUIDE_SIGNAL_VERSION||d.status!=='CONFIRMED'||d.direction!==s?.direction
        ||!['LONG','SHORT'].includes(s?.direction)||d.synthetic===true||d.testOnly===true||s.synthetic===true||s.testOnly===true||d.asOfTime!==closed.closeTime||d.currentClosedBarCloseTime!==closed.closeTime
        ||s.confirmationBarCloseTime!==closed.closeTime||s.confirmedAt!==closed.closeTime||s.confirmationClose!==closed.close||!text(s.eventId)
        ||candidate.sourceTabId!==undefined&&candidate.sourceTabId!==target.sourceTabId||candidate.sessionId!==undefined&&candidate.sessionId!==sessionId)return unavailable('ORIGINAL_CAPTURE_TECHNICAL_APPROVAL_MISMATCH');
      return freeze({status:'CAPTURED',reasonCodes:[],capture:{kind:'ORIGINAL_APPROVED_SOURCE_DOM_CAPTURE',researchUrl:target.researchUrl,sourceTabId:target.sourceTabId,sourceSessionId:sessionId,
        runId:w.runId,runEpoch:w.runEpoch,sequence:w.sequence,asOfTime:d.asOfTime,eventId:s.eventId,direction:s.direction,confirmationClose:s.confirmationClose,sourceDocumentTimeOrigin:w.sourceDocumentTimeOrigin,
        sourceObservedEpochMs:w.sourceObservedEpochMs,observedAt:w.observedAt,closedBarRole:role,closedBar:{time:closed.time,closeTime:closed.closeTime,open:closed.open,high:closed.high,low:closed.low,close:closed.close},fields:clone(w.fields)}});
    }catch{return unavailable('ORIGINAL_SOURCE_CAPTURE_PROOF_INVALID');}
  }
  function corroborateOriginalCapture(original,w,technical,binding){
    if(original.status!=='CAPTURED')return original;
    const c=original.capture;
    if(c.sourceDocumentTimeOrigin!==w.sourceDocumentTimeOrigin)return freeze({status:'UNAVAILABLE',capture:null,reasonCodes:['ORIGINAL_AND_REVALIDATION_SOURCE_CLOCK_DIFFER']});
    if(c.sourceObservedEpochMs>w.sourceObservedEpochMs)return freeze({status:'UNAVAILABLE',capture:null,reasonCodes:['ORIGINAL_CAPTURE_FOLLOWS_REVALIDATION_CAPTURE']});
    if(c.runId!==w.runId||c.runEpoch!==w.runEpoch||c.asOfTime!==binding.asOfTime||c.eventId!==technical.signal.eventId||c.direction!==technical.direction||c.confirmationClose!==technical.signal.confirmationClose)return freeze({status:'UNAVAILABLE',capture:null,reasonCodes:['ORIGINAL_CAPTURE_REVALIDATED_APPROVAL_MISMATCH']});
    const closed=binding.closedBarRole==='current'?w.current:w.previous;
    if(['time','closeTime','open','high','low','close'].some(key=>c.closedBar[key]!==closed?.[key]))return freeze({status:'UNAVAILABLE',capture:null,reasonCodes:['ORIGINAL_CAPTURE_CLOSED_OHLC_CHANGED']});
    return freeze({status:'VERIFIED',capture:c,reasonCodes:[]});
  }
  function initializeCaptureTiming(anchor){
    Object.assign(timing,{firstCaptureStatus:anchor.status,firstCaptureReasonCodes:[...anchor.reasonCodes],firstCaptureAvailable:anchor.status==='VERIFIED',firstCaptureSameSourceDocumentClockVerified:false,
      firstCaptureToClickMs:null,revalidationCaptureToClickMs:null,clickTimingStatus:'UNAVAILABLE',clickTimingReasonCodes:['NATIVE_CLICK_RECEIPT_NOT_AVAILABLE'],
      firstCaptureToFillVerificationMs:null,revalidationCaptureToFillVerificationMs:null,protectedFillMeasured:false,firstCaptureToProtectedFillVerificationMs:null,revalidationCaptureToProtectedFillVerificationMs:null,
      marketLatencyMeasured:false,physicalDisplayMeasured:false});
  }
  function recordClickTiming(reply){
    if(reply?.status!=='USER_MARKET_SUBMITTED_UNCONFIRMED'||reply.submitted!==true||reply.key!==intent.key||reply.provider!=='REPLAY_TRADING'||reply.mode!=='USER_MARKET')return;
    const clickEpoch=reply.documentTimeOrigin===intent.sourceDocumentTimeOrigin&&finite(reply.submittedPerformance)&&reply.submittedPerformance>=0?reply.documentTimeOrigin+reply.submittedPerformance:null;
    if(!finite(clickEpoch)||clickEpoch<intent.sourceObservedEpochMs||!finite(reply.verificationEpochMs)||reply.verificationEpochMs<clickEpoch){timing.clickTimingReasonCodes=['NATIVE_CLICK_SAME_DOCUMENT_RECEIPT_UNVERIFIED'];return;}
    timing.revalidationCaptureToClickMs=clickEpoch-intent.sourceObservedEpochMs;
    timing.firstCaptureToClickMs=intent.firstSourceCapture?clickEpoch-intent.firstSourceCapture.sourceObservedEpochMs:null;
    timing.clickTimingStatus='NATIVE_CLICK_DISPATCH_START_RECEIPT';timing.clickTimingReasonCodes=[];
    timing.clickTimingScope='SOURCE_DOCUMENT_CAPTURE_TO_NATIVE_CLICK_DISPATCH_START_NOT_EXCHANGE_ACK_OR_FILL';
  }
  function applyFill(reply,binding){
    const p=reply?.position,a=reply?.attribution;
    if(reply?.status!=='USER_MARKET_FILLED'||reply.provider!=='REPLAY_TRADING'||reply.mode!=='USER_MARKET'||reply.testOnly===true||reply.submitted!==true||reply.fillVerified!==true||reply.ordersCreated!==true||reply.userManaged!==true||reply.protectionVerified!==false
      ||a?.kind!=='OWN_USER_MARKET_SUBMISSION'||a.key!==intent.key||a.sourceTabId!==target.sourceTabId||a.runId!==runId||a.baselineFlatVerified!==true||a.submissionRecorded!==true
      ||p?.kind!=='NATIVE_REPLAY_DOM_USER_MARKET_POSITION_V1'||p.symbol!=='NQ1!'||p.direction!==intent.direction||p.quantity!==intent.quantity||!finite(p.entry)||p.entry<=0||!integer(p.entry/.25)||!fresh(p.observedAt,now())||p.documentTimeOrigin!==intent.sourceDocumentTimeOrigin
      ||REPLAY_EXECUTION_PUBLIC_FIELDS.some(key=>p.sourceFields?.[key]!==binding.fields[key]))return false;
    verified=true;armed=false;locked=true;result=clone(reply);timing.fillVerifiedAt??=now();
    const epoch=p.verificationEpochMs;timing.sameSourceDocumentClockVerified=finite(epoch)&&epoch>=intent.sourceObservedEpochMs;
    timing.revalidationCaptureToFillVerificationMs=timing.sameSourceDocumentClockVerified?epoch-intent.sourceObservedEpochMs:null;
    // Preserve the old field as an explicitly labeled revalidation-only alias.
    timing.sourceToFillVerificationMs=timing.revalidationCaptureToFillVerificationMs;timing.sourceToFillVerificationScope='REVALIDATION_CAPTURE_ONLY';
    timing.firstCaptureSameSourceDocumentClockVerified=timing.sameSourceDocumentClockVerified&&!!intent.firstSourceCapture&&intent.firstSourceCapture.sourceDocumentTimeOrigin===p.documentTimeOrigin&&epoch>=intent.firstSourceCapture.sourceObservedEpochMs;
    timing.firstCaptureToFillVerificationMs=timing.firstCaptureSameSourceDocumentClockVerified?epoch-intent.firstSourceCapture.sourceObservedEpochMs:null;
    timing.scope='ORIGINAL_AND_REVALIDATION_SOURCE_DOCUMENT_CAPTURE_TO_OWNED_FILL_PROOF_NOT_PROTECTED_FILL_MARKET_OR_PHYSICAL_DISPLAY';
    publish('FILLED_USER_MANAGED','USER_MARKET_OWN_FILL_VERIFIED_NO_POST_FILL_MANAGEMENT');return true;
  }
  async function checkFill(token){
    if(!pinned())return false;const source=await readSource({expected:clone(target),reason:'RECONCILE'});if(token!==epoch||!pinned())return false;
    const binding=sourceBinding(source,{approval:intent.sourceBinding}),reply=await verifySubmission({expected:clone(target),intent:clone(intent),submission:clone(submission),sourceBinding:binding,lifecycleSourceBinding:binding,requireInheritedPreset});
    if(token!==epoch||!pinned())return false;result=clone(reply??{status:'UNKNOWN'});return applyFill(reply,binding);
  }
  async function accept(candidate){
    if(busy||!armed||locked||attempted||intent)return {ok:false,...snapshot()};
    if([candidate,candidate?.technicalDecision,candidate?.technicalDecision?.signal].some(value=>value?.testOnly===true||value?.synthetic===true))return {ok:false,...failure('USER_MARKET_TEST_OR_SYNTHETIC_CANDIDATE_FORBIDDEN',false)};
    if(candidate?.technicalDecision?.status!=='CONFIRMED')return {ok:false,...publish('ARMED','USER_MARKET_WAITING_FOR_ALL_SEVEN_TECHNICAL_CONFIRMATION')};
    const token=epoch,originalCapture=originalSourceCapture(candidate);busy=true;
    try{
      if(!current(token))throw Error('USER_MARKET_ENTRY_CONTEXT_CHANGED');
      const source=await readSource({expected:clone(target),reason:'ENTRY'});if(!current(token))throw Error('USER_MARKET_ENTRY_CONTEXT_CHANGED');
      const input=clone(source?.analysisInput??source?.analysisInputs),w=source?.replayWitness,binding=sourceBinding(source);
      if(!input||source.testOnly===true||source.synthetic===true||input.options?.metadata?.synthetic===true||input.options?.metadata?.testOnly===true||input.options?.metadata?.instrument!=='CME_MINI:NQ1!'
        ||Object.values(input.options?.higherTimeframes??{}).some(h=>h.metadata?.testOnly===true||h.metadata?.synthetic===true))throw Error('USER_MARKET_REAL_ANALYSIS_INPUT_REQUIRED');
      const started=monotonic(),analysis=await recomputeAnalysis(input.bars,input.options);timing.recomputeMs=monotonic()-started;if(!current(token))throw Error('USER_MARKET_ENTRY_CONTEXT_CHANGED');
      const technical=selectGuideTechnicalDecision({analysis,bars:input.bars});
      if(technical.status!=='CONFIRMED'||technical.synthetic||technical.testOnly||technical.currentClosedBarCloseTime!==binding.asOfTime||input.options.asOfTime!==binding.asOfTime
        ||signalKey(technical.signal)!==signalKey(candidate.technicalDecision.signal))throw Error('USER_MARKET_FULL_ENGINE_TECHNICAL_CONFIRMATION_NOT_REPRODUCED');
      const closed=binding.closedBarRole==='current'?w.current:w.previous,last=input.bars.at(-1);
      if(['time','closeTime','open','high','low','close'].some(key=>last?.[key]!==closed[key]))throw Error('USER_MARKET_EXACT_CLOSED_SOURCE_OHLC_REQUIRED');
      const firstCapture=corroborateOriginalCapture(originalCapture,w,technical,binding);
      // This preserves the scenario's original directional validity at entry.
      // It neither creates an order stop nor evaluates the user's risk budget.
      const strategyWitness=technicalEntryWitness(technical,analysis,w.current.close);
      binding.eventId=technical.signal.eventId;binding.direction=technical.direction;
      publish('PREFLIGHT','USER_MARKET_READING_ACTUAL_QUANTITY_AND_EMPTY_NATIVE_SYMBOL');
      const native=await readPresetAndInventory({expected:clone(target),sourceBinding:clone(binding),direction:technical.direction,requireInheritedPreset});if(!current(token))throw Error('USER_MARKET_ENTRY_CONTEXT_CHANGED');
      const preset=nativeEvidence(native,binding);if(native.documentTimeOrigin!==w.sourceDocumentTimeOrigin)throw Error('USER_MARKET_SOURCE_DOCUMENT_CHANGED');
      if(native.inventory.quote!==w.current.close)throw Error('USER_MARKET_NATIVE_SOURCE_QUOTE_CHANGED');
      const canonicalEvent='CME_MINI:NQ1!:1:'+binding.asOfTime+':'+technical.direction,
        sharedReservationKey=[REPLAY_EXECUTION_INTENT_VERSION,target.researchUrl,target.sourceTabId,runId,binding.asOfTime,canonicalEvent].map(encodeURIComponent).join(':'),
        key=[USER_MARKET_INTENT_VERSION,target.researchUrl,target.sourceTabId,runId,binding.asOfTime,technical.signal.eventId].map(encodeURIComponent).join(':');
      if(used.has(key))throw Error('USER_MARKET_EVENT_ALREADY_CONSUMED');
      const reservation=await reserve(sharedReservationKey,{eventId:canonicalEvent,asOfTime:binding.asOfTime,sourceTabId:target.sourceTabId,runId,marketKey:key});if(!current(token))throw Error('USER_MARKET_ENTRY_CONTEXT_CHANGED');
      if(reservation?.ok!==true)throw Error(reservation?.reason??'USER_MARKET_EVENT_RESERVATION_REJECTED');used.add(key);
      intent={kind:'USER_PRESET_REPLAY_MARKET_INTENT',definitionVersion:USER_MARKET_INTENT_VERSION,key,sharedReservationKey,provider:'REPLAY_TRADING',mode:'USER_MARKET',researchUrl:target.researchUrl,sourceSessionId:sessionId,
        symbol:'NQ1!',instrument:'CME_MINI:NQ1!',timeframe:'1',orderType:'MARKET',direction:technical.direction,quantity:preset.quantity,preset:clone(preset),leaseId:native.lease.id,
        preparedAt:now(),expiresAt:Math.min(w.observedAt+2000,native.lease.expiresAt),sourceBinding:clone(binding),sourceDocumentTimeOrigin:w.sourceDocumentTimeOrigin,sourceObservedEpochMs:w.sourceObservedEpochMs,
        firstSourceCapture:firstCapture.capture,firstSourceCaptureStatus:firstCapture.status,firstSourceCaptureReasonCodes:[...firstCapture.reasonCodes],
        approvalProof:{engineDefinitionVersion:GUIDE_SIGNAL_VERSION,technicalDecisionVersion:GUIDE_TECHNICAL_DECISION_VERSION,eventId:technical.signal.eventId,asOfTime:binding.asOfTime,direction:technical.direction,confirmedAt:technical.signal.confirmedAt,confirmationBarCloseTime:technical.signal.confirmationBarCloseTime,
          confirmationPolicy:'later_close_beyond_setup',requiredChecks:clone(technical.signal.requiredChecks),...(technical.signal.approvalPolicy==='guide_scenarios_v1'?{approvalPolicy:technical.signal.approvalPolicy,strategyProofs:clone(technical.signal.strategyProofs)}:{requiredFlags:Object.fromEntries(['requireLocation','requireEma','requireFib','requireTrendline','requireSupplyDemand','requireHigherTimeframe'].map(key=>[key,true]))}),roleReversalEnabled:true,supplyDemandEnabled:true,sourceEventIds:[...technical.signal.sourceEventIds]},
        technicalEntryWitness:strategyWitness,technicalApproved:true,testOnly:false,userManaged:true,bracketPresetVerified:false,presetProtectionRequired:requireInheritedPreset,riskManagement:'USER_MANAGED_NOT_CALCULATED',realBrokerOrdersAuthorized:false};
      initializeCaptureTiming(firstCapture);
      attempted=true;publish('SUBMITTING','USER_MARKET_SINGLE_OBSERVED_PRESET_NATIVE_ATTEMPT');
      const reply=await submitMarket({expected:clone(target),intent:clone(intent),testOnly:recomputeAnalysis!==analyzeGuideSignals,requireInheritedPreset},{isCurrent:()=>current(token)&&now()<=intent.expiresAt});submission=clone(reply??{status:'UNKNOWN'});result=clone(submission);
      if(reply?.submitted===false){attempted=false;armed=false;locked=false;return {ok:false,...publish('DISARMED','USER_MARKET_CONSUMED_ATTEMPT_REJECTED_NO_RETRY')};}
      if(!current(token)||reply?.status!=='USER_MARKET_SUBMITTED_UNCONFIRMED'||reply.submitted!==true||reply.key!==intent.key)return {ok:false,...failure('USER_MARKET_NATIVE_SUBMISSION_UNCERTAIN',true)};
      recordClickTiming(reply);
      for(let n=0;n<6;n++){if(await checkFill(token))return {ok:true,...snapshot()};if(token!==epoch||!pinned())break;if(n<5)await wait(100);}
      return {ok:false,...failure('USER_MARKET_NATIVE_FILL_NOT_VERIFIED',true)};
    }catch(error){
      if(error?.message==='USER_MARKET_SAVED_BRACKET_PRESET_REQUIRED'&&!attempted){armed=false;return {ok:false,...publish('DISARMED',error.message)};}
      return {ok:false,...failure(error?.message??'USER_MARKET_FLOW_FAILED',attempted)};
    }
    finally{busy=false;try{onChange(snapshot());}catch{}}
  }
  async function reconcile(){
    if(busy||!intent||!attempted||verified)return {ok:false,...snapshot()};busy=true;const token=epoch;
    try{if(!await checkFill(token))return {ok:false,...failure('USER_MARKET_READ_ONLY_RECONCILIATION_UNVERIFIED',true)};return {ok:true,...snapshot()};}
    catch(error){return {ok:false,...failure(error?.message??'USER_MARKET_READ_ONLY_RECONCILIATION_FAILED',true)};}
    finally{busy=false;try{onChange(snapshot());}catch{}}
  }
  return Object.freeze({arm,disarm,accept,reconcile,snapshot});
}
