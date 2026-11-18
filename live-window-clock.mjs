// A bounded correlation of two clocks, never a network-latency measurement.
// Only the root Window adapter may supply its owned observer evidence. Grants
// are process-local capabilities: JSON/raw Pine fields cannot recreate them.
const grants=new WeakMap();
const metaKeys=['source','instrument','timeframe','timeframeMs','tickSize','pointValue','currency','timezone','session','chartType'];
const metadataKey=meta=>JSON.stringify(metaKeys.map(key=>meta?.[key]??null));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const finite=Number.isFinite;
const clone=value=>structuredClone(value);
export const LIVE_WINDOW_CLOCK_LIMITS=Object.freeze({maxLeadMs:5000,jitterMs:250,minPairSpanMs:50,maxPairSpanMs:15000,maxWitnessAgeMs:2000,maxLedger:30});
const slots={snapshot:[1],timeframe_snapshot:[2,3],update:[4],timeframe_update:[5,6]};

function chartScopeMatches(chart,meta,allowResearchLiveMultiChart,sourceUrl){
  if(chart?.visibleCharts===1)return true;
  let researchUrl=false,layoutName=null;try{const url=new URL(sourceUrl);layoutName=url.pathname==='/chart/ARROWRV1/'?'Arrow OHLC Live Verification':url.pathname==='/chart/ARROWFR1/'?'Full Screens Live':null;researchUrl=url.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&layoutName!==null&&!url.port&&!url.search&&!url.hash&&!url.username&&!url.password;}catch{}
  const selection=chart?.researchSelection,labels=chart?.chartLabels;
  return allowResearchLiveMultiChart===true&&researchUrl&&Number.isSafeInteger(chart?.visibleCharts)&&chart.visibleCharts>=2&&chart.visibleCharts<=3
    &&Array.isArray(labels)&&labels.length===chart.visibleCharts&&labels.every(label=>typeof label==='string'&&/^Chart for CME_MINI:NQ1!, [^,]+$/.test(label))
    &&labels.filter(label=>label==='Chart for CME_MINI:NQ1!, 1 minute').length===1
    &&selection?.kind==='UNIQUE_ACTIVE_RESEARCH_NQ_1M'&&selection.visibleCharts===chart.visibleCharts&&selection.targetCharts===1
    &&selection.interval==='1'&&selection.selectedChartLabel==='Chart for CME_MINI:NQ1!, 1 minute'&&selection.researchLayoutVerified===true
    &&selection.liveMultiChartExplicit===true&&selection.sourceMode==='LIVE'&&selection.statusLegendScoped===true
    &&(layoutName==='Full Screens Live'?selection.layoutName===layoutName:selection.layoutName===undefined||selection.layoutName===layoutName)
    &&chart.replay===false&&chart.interval==='1'&&meta?.instrument==='CME_MINI:NQ1!'&&meta.timeframe==='1'&&meta.timeframeMs===60000;
}

function validPacket(packet,owner){
  return packet&&packet.bootstrapOnly!==true&&packet.realtime===true&&packet.runId===owner.runId&&integer(packet.sequence)&&slots[packet.kind]?.includes(packet.sequence%8)&&Math.floor(packet.sequence/8)===owner.latest?.sequence&&packet.sourceEmittedAt===owner.latest.sourceEmittedAt&&metadataKey(packet.metadata)===owner.metadataKey;
}
function currentOwner(owner,receivedAt,at){
  return owner.status==='CORRELATED'&&!owner.locked&&!owner.transientFramePending&&owner.latest&&integer(receivedAt)&&finite(at)&&at>=receivedAt&&receivedAt>=owner.latest.observedAtWall&&at-owner.latest.observedAtWall<=LIVE_WINDOW_CLOCK_LIMITS.maxWitnessAgeMs&&owner.offsetMs>0&&owner.offsetMs<=LIVE_WINDOW_CLOCK_LIMITS.maxLeadMs;
}

export function validateWindowClockGrant(grant,{packet,receivedAt,now=receivedAt}={}){
  const record=grant&&typeof grant==='object'?grants.get(grant):null;
  if(!record||!packet||record.receivedAt!==receivedAt||record.sequence!==packet.sequence||record.sourceEmittedAt!==packet.sourceEmittedAt||record.runId!==packet.runId)return {ok:false,reasonCode:'WINDOW_CLOCK_GRANT_REQUIRED'};
  const owner=record.owner;
  // A snapshot has only historical closed rows. Its last close can be older
  // than the live-currentness bound midway through the CURRENT candle. The
  // private grant already proves that exact source frame's visible CURRENT
  // observation. Admit this baseline with realtime=false preserved; only a
  // subsequent normally verified CURRENT update can make the store live.
  const nonLiveHistoricalBaseline=packet.kind==='snapshot'&&packet.metadata?.realtime===false&&packet.metadata?.chartIdentityVerified===true;
  if(record.generation!==owner.generation||!currentOwner(owner,receivedAt,now)||!validPacket(packet,owner)||packet.metadata?.tabId!==owner.tabId||packet.metadata?.provider!=='TradingView public Data Window v2'||packet.metadata?.replay!==false||packet.metadata?.realtime!==true&&!nonLiveHistoricalBaseline)return {ok:false,reasonCode:'WINDOW_CLOCK_GRANT_INVALID'};
  const rawLeadMs=packet.sourceEmittedAt-receivedAt,correlatedAgeMs=receivedAt-(packet.sourceEmittedAt-owner.offsetMs);
  if(rawLeadMs<0||rawLeadMs>LIVE_WINDOW_CLOCK_LIMITS.maxLeadMs||correlatedAgeMs < -LIVE_WINDOW_CLOCK_LIMITS.jitterMs||correlatedAgeMs>LIVE_WINDOW_CLOCK_LIMITS.maxWitnessAgeMs)return {ok:false,reasonCode:'WINDOW_CLOCK_CORRELATION_BOUND_EXCEEDED'};
  return {ok:true,policy:'TWO_OWNED_OBSERVER_FRAMES_FROZEN_BOUNDED_LEAD',sessionId:owner.sessionId,runId:owner.runId,sourceSequence:owner.latest.sequence,offsetMs:owner.offsetMs,rawLeadMs,correlatedAgeMs,observerAgeMs:now-owner.latest.observedAtWall,nonLiveHistoricalBaseline,scope:'Clock-domain correlation only; raw timestamps and latency evidence are unchanged.'};
}

export function createLiveWindowClock({sessionId,tabId,now=Date.now,allowResearchLiveMultiChart=false,allowOrdinaryClockJitter=false}={}){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>200||!Number.isSafeInteger(tabId)||tabId<1||typeof now!=='function'||typeof allowResearchLiveMultiChart!=='boolean'||typeof allowOrdinaryClockJitter!=='boolean')throw TypeError('WINDOW_CLOCK_OWNER_REQUIRED');
  const owner={sessionId,tabId,runId:null,runEpoch:null,metadataKey:null,sourceScopeKey:null,sourceDocumentTimeOrigin:null,status:'WAITING_OBSERVER_PAIR',reasonCode:'WINDOW_CLOCK_OBSERVER_PAIR_REQUIRED',locked:false,everCorrelated:false,offsetMs:null,candidate:null,latest:null,lastProcessed:null,lastIgnoredSequence:null,minObservedAt:0,generation:0,quarantine:null,quarantineSerial:0,ledger:[],lastReceipt:null,verifiedFrames:0,grantsIssued:0,sawExtendedLead:false};
  const record=(action,details={})=>{owner.ledger.push({action,at:now(),runId:owner.runId,generation:owner.generation,...details});owner.ledger=owner.ledger.slice(-LIVE_WINDOW_CLOCK_LIMITS.maxLedger);};
  function clear(reason,{lock=false,minObservedAt=0}={}){owner.transientFramePending=false;owner.generation++;owner.status=lock?'BLOCKED':'WAITING_OBSERVER_PAIR';owner.reasonCode=reason;owner.locked=lock;owner.offsetMs=null;owner.candidate=null;owner.latest=null;owner.lastProcessed=null;owner.lastIgnoredSequence=null;owner.minObservedAt=minObservedAt;owner.sourceDocumentTimeOrigin=null;if(owner.quarantine)owner.quarantine.ready=false;}
  function quarantine(reason,witness,{observedAtWall=witness.observedAtWall,...details}={}){
    clear(reason,{minObservedAt:observedAtWall+1});
    owner.quarantine={id:++owner.quarantineSerial,faultSequence:witness.sequence,faultSourceEmittedAt:witness.sourceEmittedAt,faultObservedAtWall:observedAtWall,faultObservedAtPerfEpoch:witness.observedAtPerfEpoch,sourceDocumentTimeOrigin:witness.sourceDocumentTimeOrigin,requiredFreshFrames:2,ready:false};
    owner.status='QUARANTINED';record('CLOCK_QUARANTINED',{quarantineId:owner.quarantine.id,reason,faultSequence:witness.sequence,faultSourceEmittedAt:witness.sourceEmittedAt,faultObservedAtWall:observedAtWall,...details});
  }
  const blocked=()=>owner.locked&&owner.everCorrelated||!!owner.quarantine&&!owner.quarantine.ready;
  const snapshot=()=>({schemaVersion:1,kind:'OWNED_WINDOW_CLOCK_CORRELATION',sessionId,tabId,allowResearchLiveMultiChart,allowOrdinaryClockJitter,runId:owner.runId,runEpoch:owner.runEpoch,status:owner.status,reasonCode:owner.reasonCode,offsetMs:owner.offsetMs,locked:owner.locked,transientFramePending:owner.transientFramePending===true,everCorrelated:owner.everCorrelated,blockIntake:blocked(),requiresRebaseline:!!owner.quarantine,quarantineId:owner.quarantine?.id??null,rebaselineReady:owner.quarantine?.ready===true,quarantine:clone(owner.quarantine),verifiedFrames:owner.verifiedFrames,grantsIssued:owner.grantsIssued,generation:owner.generation,limits:LIVE_WINDOW_CLOCK_LIMITS,latestObserver:owner.latest?{sequence:owner.latest.sequence,sourceEmittedAt:owner.latest.sourceEmittedAt,observedAtWall:owner.latest.observedAtWall,observedAtPerfEpoch:owner.latest.observedAtPerfEpoch,sourceDocumentTimeOrigin:owner.latest.sourceDocumentTimeOrigin}:null,ledger:clone(owner.ledger),meaning:'Bounded source-minus-owned-DOM-observation clock lead; not exchange/network latency or verified clock synchronization.'});
  function observeEvidence(evidence,{sessionId:actualSession=sessionId,tabId:actualTab=tabId,receivedAt=now()}={}){
    if(!integer(receivedAt)||actualSession!==sessionId||actualTab!==tabId){clear('WINDOW_CLOCK_OWNER_MISMATCH',{lock:true});record('OWNER_REJECTED');return snapshot();}
    if(owner.lastReceipt!==null&&receivedAt<owner.lastReceipt){clear('WINDOW_CLOCK_RECEIVER_REGRESSION',{lock:true});record('RECEIVER_CLOCK_REJECTED');return snapshot();}owner.lastReceipt=receivedAt;
    const wasPending=owner.transientFramePending;owner.transientFramePending=false;
    const frame=evidence?.windowFrame,meta=evidence?.bootstrapMetadata?.metadata,runId=evidence?.bootstrapMetadata?.runId,chart=evidence?.chart;
    const valid=evidence?.transport==='PUBLIC_DATA_WINDOW_V2'&&['OK','WAITING'].includes(evidence.status)&&evidence.contextOnly!==true&&frame?.coherent===true&&frame.checksumsVerified===true&&frame.realtime===true&&integer(frame.sequence)&&integer(frame.runEpoch)&&integer(frame.sourceEmittedAt)&&typeof runId==='string'&&runId.endsWith('|'+frame.runEpoch)&&meta?.source==='ohlc'&&meta.chartType==='standard'&&integer(meta.timeframeMs)&&meta.timeframeMs>=1000&&finite(meta.tickSize)&&meta.tickSize>0&&finite(meta.pointValue)&&meta.pointValue>0&&chartScopeMatches(chart,meta,allowResearchLiveMultiChart,evidence?.sourceUrl)&&chart.documentVisible===true&&chart.replay===false&&chart.marketOpen===true&&chart.realtime!==false&&chart.interval===meta.timeframe&&Array.isArray(chart.symbols)&&chart.symbols.length===1&&chart.symbols[0]===meta.instrument;
    if(!valid){
      const benign=['WINDOW_MIXED_FRAME','WINDOW_FRAME_CHECKSUM_MISMATCH','WINDOW_PAYLOAD_TAG_MISMATCH','WINDOW_LAST_BAR_REQUIRED','WINDOW_STUDY_NOT_VISIBLE'],known=owner.metadataKey?Object.fromEntries(metaKeys.map((key,index)=>[key,JSON.parse(owner.metadataKey)[index]])):null;
      const transient=allowOrdinaryClockJitter&&!owner.sawExtendedLead&&owner.offsetMs>0&&owner.offsetMs<=3000&&owner.everCorrelated&&!owner.locked&&!owner.quarantine&&owner.latest&&receivedAt-owner.latest.observedAtWall>=0&&receivedAt-owner.latest.observedAtWall<=LIVE_WINDOW_CLOCK_LIMITS.maxWitnessAgeMs
        &&evidence?.transport==='PUBLIC_DATA_WINDOW_V2'&&evidence.status==='UNAVAILABLE'&&!frame&&evidence.contextOnly!==true&&evidence.resetRequired!==true
        &&Array.isArray(evidence.reasonCodes)&&evidence.reasonCodes.length>0&&evidence.reasonCodes.every(reason=>benign.includes(reason))
        &&known&&chartScopeMatches(chart,known,allowResearchLiveMultiChart,evidence.sourceUrl)&&chart?.documentVisible===true&&chart.replay===false&&chart.marketOpen===true&&chart.realtime!==false&&chart.interval===known.timeframe&&chart.symbols?.length===1&&chart.symbols[0]===known.instrument;
      if(transient){owner.transientFramePending=true;if(!wasPending)record('COHERENT_FRAME_PENDING',{sourceReasons:clone(evidence.reasonCodes),lastVerifiedSequence:owner.latest.sequence});return snapshot();}
      if(owner.latest||owner.candidate){const prior=owner.latest??owner.candidate;if(owner.everCorrelated&&!owner.locked)quarantine('WINDOW_CLOCK_SOURCE_NOT_ELIGIBLE',prior,{observedAtWall:receivedAt});else clear('WINDOW_CLOCK_SOURCE_NOT_ELIGIBLE',{minObservedAt:receivedAt+1});record('SOURCE_EVIDENCE_REJECTED',{sourceReasons:clone(evidence?.reasonCodes??[]),sourceStatus:evidence?.status??null,framePresent:!!frame});}return snapshot();
    }
    if(wasPending)record('COHERENT_FRAME_RESUMED_WITHOUT_REBASELINE');
    // Both layouts are allowed, but one clock session can belong to only one
    // exact URL/name pair. A same-run navigation cannot borrow its old grants.
    const sourceScopeKey=chart.visibleCharts>1?JSON.stringify([evidence.sourceUrl,chart.researchSelection.layoutName??'Arrow OHLC Live Verification']):null;
    if(owner.sourceScopeKey!==null&&owner.sourceScopeKey!==sourceScopeKey){clear('WINDOW_CLOCK_OWNER_MISMATCH',{lock:true});record('SOURCE_SCOPE_REJECTED');return snapshot();}
    if(sourceScopeKey!==null)owner.sourceScopeKey=sourceScopeKey;
    const key=metadataKey(meta);
    if(owner.runId!==runId||owner.runEpoch!==frame.runEpoch||owner.metadataKey!==key){const minObservedAt=owner.minObservedAt;owner.quarantine=null;clear('WINDOW_CLOCK_OBSERVER_PAIR_REQUIRED',{minObservedAt});owner.everCorrelated=false;owner.sawExtendedLead=false;owner.runId=runId;owner.runEpoch=frame.runEpoch;owner.metadataKey=key;record('IDENTITY_REPRIMED');}
    if(owner.locked)return snapshot();
    const witnesses=Array.isArray(evidence.clockWitnesses)?evidence.clockWitnesses.slice(-8):[];
    for(const witness of witnesses){
      if(witness?.sessionId!==sessionId||witness.runId!==runId||witness.runEpoch!==frame.runEpoch||metadataKey(witness.metadata)!==key||witness.kind!=='OWNED_WINDOW_CLOCK_OBSERVATION_V1'||witness.observedByMutationObserver!==true||witness.checksumsVerified!==true||witness.documentVisible!==true||witness.replay!==false||witness.marketOpen!==true||witness.realtime!==true||!integer(witness.sequence)||witness.sequence>frame.sequence||!integer(witness.sourceEmittedAt)||witness.sourceEmittedAt>frame.sourceEmittedAt||!integer(witness.observedAtWall)||witness.observedAtWall>receivedAt||witness.observedAtWall<owner.minObservedAt||!finite(witness.observedAtPerfEpoch)||!finite(witness.sourceDocumentTimeOrigin)||witness.observedAtPerfEpoch<witness.sourceDocumentTimeOrigin||!integer(witness.currentTime)||!integer(witness.currentCloseTime)||witness.currentCloseTime-witness.currentTime!==meta.timeframeMs||witness.sourceEmittedAt<witness.currentTime||witness.sourceEmittedAt-witness.currentCloseTime>15000)continue;
      if(owner.quarantine){
        const q=owner.quarantine;
        if(witness.sourceDocumentTimeOrigin!==q.sourceDocumentTimeOrigin||witness.observedAtPerfEpoch<q.faultObservedAtPerfEpoch){clear('WINDOW_CLOCK_OBSERVER_REGRESSION',{lock:true});record('POST_FAULT_OBSERVER_REJECTED');break;}
        // Data Window can report an older painted/historical frame again.
        // Both source cursors at or behind the revoked boundary identify
        // stale evidence, never a new clock sample. Do not poison recovery
        // with it, and do not let it renew freshness or acknowledge baseline.
        if(witness.sequence<=q.faultSequence&&witness.sourceEmittedAt<=q.faultSourceEmittedAt){
          if(owner.lastIgnoredSequence!==witness.sequence)record('POST_FAULT_STALE_SOURCE_OBSERVATION_IGNORED',{sequence:witness.sequence,sourceEmittedAt:witness.sourceEmittedAt,faultSequence:q.faultSequence});
          owner.lastIgnoredSequence=witness.sequence;continue;
        }
        if(witness.sequence<=q.faultSequence||witness.sourceEmittedAt<q.faultSourceEmittedAt||witness.observedAtWall<=q.faultObservedAtWall){clear('WINDOW_CLOCK_POST_FAULT_REGRESSION',{lock:true});record('POST_FAULT_REGRESSION_REJECTED',{sequence:witness.sequence,sourceEmittedAt:witness.sourceEmittedAt,observedAtWall:witness.observedAtWall,observedAtPerfEpoch:witness.observedAtPerfEpoch,faultSequence:q.faultSequence,faultSourceEmittedAt:q.faultSourceEmittedAt});break;}
        if(witness.sourceEmittedAt===q.faultSourceEmittedAt)continue;
      }
      if(owner.lastProcessed&&witness.sequence===owner.lastProcessed.sequence&&witness.sourceEmittedAt===owner.lastProcessed.sourceEmittedAt&&witness.observedAtWall===owner.lastProcessed.observedAtWall)continue;
      // The retained ring repeats old observations on every RPC. Those older
      // observations must neither re-prime nor count as a regression.
      if(owner.lastProcessed&&witness.observedAtWall<owner.lastProcessed.observedAtWall){
        if(witness.sequence>owner.lastProcessed.sequence||witness.sourceEmittedAt>owner.lastProcessed.sourceEmittedAt){clear('WINDOW_CLOCK_OBSERVER_REGRESSION',{lock:true});record('OBSERVER_CLOCK_REJECTED');break;}
        continue;
      }
      const lead=witness.sourceEmittedAt-witness.observedAtWall;
      if(lead>3000)owner.sawExtendedLead=true;
      const previous=owner.lastProcessed;
      // Near-zero ordinary clocks straddle zero as public DOM callbacks arrive
      // a few milliseconds after Pine's stamp. These bounded monotonic samples
      // use the ordinary source-age checks, not the extended-clock capability.
      // Ignore them for clock ownership: no offset change, freshness renewal,
      // grant, or history reset. A real regression, extended lead or a delay
      // outside the existing 250ms jitter bound still takes the fault path.
      if(allowOrdinaryClockJitter&&!owner.sawExtendedLead&&!owner.quarantine&&owner.status==='CORRELATED'&&!owner.locked&&owner.offsetMs>0&&owner.offsetMs<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&lead<=0&&lead>=-LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&Math.abs(lead-owner.offsetMs)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&previous){
        const sourceDelta=witness.sourceEmittedAt-previous.sourceEmittedAt,wallDelta=witness.observedAtWall-previous.observedAtWall,perfDelta=witness.observedAtPerfEpoch-previous.observedAtPerfEpoch,seqDelta=witness.sequence-previous.sequence;
        if(sourceDelta>0&&wallDelta>0&&wallDelta<=LIVE_WINDOW_CLOCK_LIMITS.maxWitnessAgeMs&&perfDelta>0&&seqDelta>0&&seqDelta<4096&&witness.sourceDocumentTimeOrigin===owner.sourceDocumentTimeOrigin&&Math.abs(perfDelta-wallDelta)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&Math.abs(sourceDelta-wallDelta)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs){
          if(owner.lastIgnoredSequence!==witness.sequence)record('ORDINARY_ZERO_CROSSING_OBSERVATION_IGNORED',{sequence:witness.sequence,observedLeadMs:lead});owner.lastIgnoredSequence=witness.sequence;continue;
        }
      }
      // A foreground transition can deliver a stale painted frame before
      // fresh source updates arrive. Once quarantined, this is unusable
      // evidence, not evidence of a permanent clock fault. Post-fault owner,
      // sequence, source and monotonic-clock checks above still apply. Do not
      // make it a candidate, renew freshness or issue a grant; two subsequent
      // fresh frames and an accepted store baseline remain mandatory.
      if(owner.quarantine&&owner.offsetMs===null&&lead<=0){
        if(owner.lastIgnoredSequence!==witness.sequence)record('POST_FAULT_DELAYED_OBSERVATION_IGNORED',{sequence:witness.sequence,observedLeadMs:lead});
        owner.lastIgnoredSequence=witness.sequence;continue;
      }
      // The ordinary producer guard already admits a raw lead up to 3s.
      // Positive, monotonic DOM observation jitter inside that same bound
      // does not require the extended-clock capability or a new baseline.
      // Keep the frozen offset unchanged; shifted frames get no clock grant.
      const ordinaryJitter=allowOrdinaryClockJitter&&!owner.sawExtendedLead&&!owner.quarantine&&owner.offsetMs>0&&owner.offsetMs<=3000&&lead>0&&lead<=3000;
      if(lead<=0||lead>LIVE_WINDOW_CLOCK_LIMITS.maxLeadMs){
        // A delayed DOM callback can arrive well after its source stamp.
        // It cannot renew a grant, but it is not a clock regression when all
        // three clocks and the sequence still advance on the same document.
        // Revoke the frozen pair and require a wholly post-fault pair/baseline.
        const sourceDelta=previous?witness.sourceEmittedAt-previous.sourceEmittedAt:null,wallDelta=previous?witness.observedAtWall-previous.observedAtWall:null,perfDelta=previous?witness.observedAtPerfEpoch-previous.observedAtPerfEpoch:null,seqDelta=previous?witness.sequence-previous.sequence:null;
        if(owner.everCorrelated&&previous&&lead<=0&&sourceDelta>0&&wallDelta>0&&perfDelta>0&&seqDelta>0&&seqDelta<4096&&witness.sourceDocumentTimeOrigin===owner.sourceDocumentTimeOrigin&&Math.abs(perfDelta-wallDelta)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs){
          quarantine('WINDOW_CLOCK_OBSERVER_DELAY',witness,{observedLeadMs:lead,sourceDelta,wallDelta,perfDelta,seqDelta});continue;
        }
        clear('WINDOW_CLOCK_LEAD_OUT_OF_BOUNDS',{lock:true});record('LEAD_REJECTED',{observedLeadMs:lead});break;
      }
      if(previous){
        const sourceDelta=witness.sourceEmittedAt-previous.sourceEmittedAt,wallDelta=witness.observedAtWall-previous.observedAtWall,perfDelta=witness.observedAtPerfEpoch-previous.observedAtPerfEpoch,seqDelta=witness.sequence-previous.sequence;
        // Different Pine executions can share timenow and be observed in
        // different DOM callbacks. Receiver time advancing does not turn a
        // repeated producer timestamp into regression OR fresh clock proof.
        // Retain the last strictly advancing witness; this sequence gets no
        // grant and cannot renew freshness. Regressing clocks still lock.
        if(sourceDelta===0&&wallDelta>=0&&perfDelta>=0&&Math.abs(perfDelta-wallDelta)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&seqDelta>0&&seqDelta<4096&&witness.sourceDocumentTimeOrigin===owner.sourceDocumentTimeOrigin){
          if(owner.lastIgnoredSequence!==witness.sequence){record(wallDelta===0?'SAME_MILLISECOND_EXECUTION_IGNORED':'REPEATED_SOURCE_TIMESTAMP_IGNORED',{sequence:witness.sequence,sourceEmittedAt:witness.sourceEmittedAt,observedAtWall:witness.observedAtWall,wallDelta,perfDelta});owner.lastIgnoredSequence=witness.sequence;}
          owner.reasonCode='WINDOW_CLOCK_ADVANCING_OBSERVATION_REQUIRED';continue;
        }
        // After a source pane becomes eligible again, its first callback may
        // describe a frame painted during a foreground/background transition.
        // Its observation delay is not a frozen clock discontinuity: there is
        // no correlation to trust yet. Discard that candidate, require a new
        // stable pair, and never grant this mismatched pair. A previously
        // frozen correlation or any regressing clock still takes the lock path.
        if(owner.offsetMs===null&&sourceDelta>0&&wallDelta>0&&perfDelta>0&&seqDelta>0&&seqDelta<4096&&witness.sourceDocumentTimeOrigin===owner.sourceDocumentTimeOrigin&&Math.abs(perfDelta-wallDelta)<=LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&Math.abs(sourceDelta-wallDelta)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs){
          const minObservedAt=owner.minObservedAt;clear('WINDOW_CLOCK_OBSERVER_PAIR_REQUIRED',{minObservedAt});owner.lastProcessed=clone(witness);owner.latest=clone(witness);owner.candidate=clone(witness);owner.sourceDocumentTimeOrigin=witness.sourceDocumentTimeOrigin;owner.verifiedFrames++;
          record('PAIR_REPRIMED_AFTER_OBSERVER_DELAY',{sourceDelta,wallDelta,perfDelta,seqDelta,observedLeadMs:lead,sequence:witness.sequence});continue;
        }
        if(sourceDelta<=0||wallDelta<=0||perfDelta<=0||seqDelta<=0||seqDelta>=4096||witness.sourceDocumentTimeOrigin!==owner.sourceDocumentTimeOrigin||Math.abs(perfDelta-wallDelta)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs){clear('WINDOW_CLOCK_OBSERVATION_DISCONTINUITY',{lock:true});record('CLOCK_DISCONTINUITY_REJECTED',{sourceDelta,wallDelta,perfDelta,seqDelta});break;}
        if(wallDelta>LIVE_WINDOW_CLOCK_LIMITS.maxPairSpanMs){
          if(owner.everCorrelated){quarantine('WINDOW_CLOCK_OBSERVER_GAP',witness,{sourceDelta,wallDelta,perfDelta,seqDelta});continue;}
          clear('WINDOW_CLOCK_OBSERVER_PAIR_REQUIRED');record('QUIET_REPRIMED',{quietMs:wallDelta});
        }else if(Math.abs(sourceDelta-wallDelta)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&!ordinaryJitter){quarantine('WINDOW_CLOCK_OBSERVER_DELAY',witness,{sourceDelta,wallDelta,perfDelta,seqDelta});continue;}
      }
      if(owner.offsetMs!==null&&Math.abs(lead-owner.offsetMs)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs&&!ordinaryJitter){quarantine('WINDOW_CLOCK_OBSERVER_DELAY',witness,{observedLeadMs:lead});continue;}
      owner.lastProcessed=clone(witness);owner.latest=clone(witness);owner.lastIgnoredSequence=null;owner.sourceDocumentTimeOrigin=witness.sourceDocumentTimeOrigin;owner.verifiedFrames++;if(owner.offsetMs!==null)owner.reasonCode='WINDOW_CLOCK_BOUNDED_CORRELATION';
      if(!owner.candidate){owner.candidate=clone(witness);continue;}
      if(owner.offsetMs===null){
        const span=witness.observedAtWall-owner.candidate.observedAtWall;
        if(span<LIVE_WINDOW_CLOCK_LIMITS.minPairSpanMs)continue;
        if(span>LIVE_WINDOW_CLOCK_LIMITS.maxPairSpanMs){owner.candidate=clone(witness);continue;}
        const firstLead=owner.candidate.sourceEmittedAt-owner.candidate.observedAtWall;
        if(Math.abs(firstLead-lead)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs){clear('WINDOW_CLOCK_PAIR_UNSTABLE',{lock:true});record('PAIR_REJECTED');break;}
        owner.offsetMs=(firstLead+lead)/2;owner.everCorrelated=true;owner.status='CORRELATED';owner.reasonCode='WINDOW_CLOCK_BOUNDED_CORRELATION';if(owner.quarantine)owner.quarantine.ready=true;record('PAIR_FROZEN',{offsetMs:owner.offsetMs,firstSequence:owner.candidate.sequence,secondSequence:witness.sequence,pairSpanMs:span,...(owner.quarantine?{quarantineId:owner.quarantine.id,requiresFreshStoreBaseline:true}:{})});
      }
    }
    if(owner.latest&&receivedAt-owner.latest.observedAtWall>LIVE_WINDOW_CLOCK_LIMITS.maxWitnessAgeMs){owner.reasonCode='WINDOW_CLOCK_OBSERVER_STALE';}
    return snapshot();
  }
  function permitsFrame(frame,receivedAt=now()){
    return currentOwner(owner,receivedAt,now())&&frame?.coherent===true&&frame.checksumsVerified===true&&frame.realtime===true&&frame.runEpoch===owner.runEpoch&&frame.sequence===owner.latest.sequence&&frame.sourceEmittedAt===owner.latest.sourceEmittedAt&&frame.sourceEmittedAt-receivedAt<=LIVE_WINDOW_CLOCK_LIMITS.maxLeadMs&&frame.sourceEmittedAt-receivedAt>=0;
  }
  function grantFor(packet,receivedAt=now()){
    if(!currentOwner(owner,receivedAt,now())||!validPacket(packet,owner))return null;
    if(allowOrdinaryClockJitter&&Math.abs(owner.latest.sourceEmittedAt-owner.latest.observedAtWall-owner.offsetMs)>LIVE_WINDOW_CLOCK_LIMITS.jitterMs)return null;
    const rawLead=packet.sourceEmittedAt-receivedAt;if(rawLead<0||rawLead>LIVE_WINDOW_CLOCK_LIMITS.maxLeadMs)return null;
    const token=Object.freeze({kind:'OWNED_WINDOW_CLOCK_GRANT'});grants.set(token,{owner,generation:owner.generation,sequence:packet.sequence,sourceEmittedAt:packet.sourceEmittedAt,runId:packet.runId,receivedAt});owner.grantsIssued++;return token;
  }
  function acknowledgeBaseline(packet,{receivedAt=now(),storeState}={}){
    const q=owner.quarantine;if(!q?.ready||packet?.kind!=='snapshot'||!validPacket(packet,owner)||!currentOwner(owner,receivedAt,now())||packet.sourceEmittedAt<=q.faultSourceEmittedAt||Math.floor(packet.sequence/8)<=q.faultSequence||storeState?.accepted!==true||storeState.bootstrap!==true||storeState.contextOnly===true||storeState.bootstrapAsOfTime!==packet.sourceEmittedAt||storeState.lastReceivedAt!==receivedAt||storeState.metadata?.sourceId!==owner.runId||storeState.metadata?.tabId!==tabId||storeState.metadata?.provider!=='TradingView public Data Window v2')return false;
    record('QUARANTINE_BASELINE_ACCEPTED',{quarantineId:q.id,sourceSequence:Math.floor(packet.sequence/8),sourceEmittedAt:packet.sourceEmittedAt,storeGeneration:storeState.generation});owner.quarantine=null;return true;
  }
  return {observeEvidence,permitsFrame,grantFor,acknowledgeBaseline,snapshot,shouldBlockIntake:blocked,reset(reason='WINDOW_CLOCK_RESET'){owner.quarantine=null;clear(reason,{minObservedAt:now()+1});owner.everCorrelated=false;owner.sawExtendedLead=false;owner.lastReceipt=null;owner.runId=null;owner.runEpoch=null;owner.metadataKey=null;owner.sourceScopeKey=null;record('RESET');return snapshot();}};
}
