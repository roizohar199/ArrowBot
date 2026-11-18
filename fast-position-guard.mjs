import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';
import {isAutoFlatRecoveryReason} from './auto-flat-proof.mjs';

const OPEN=new Set(['LONG','SHORT']);
const STATES=new Set(['LONG','SHORT','FLAT','UNKNOWN']);

// Positive entry evidence acts immediately. Releasing a known entry requires
// distinct, fresh, full-chart clear frames; loss of sight is never a close.
export function createFastPositionGuard({now=Date.now,minFlatFrames=3,minFlatMs=60,maxAgeMs=MAX_CAPTURE_GAP_MS,pendingSettleMs=1200,pendingFlatMs=200,autoFlatMs=2000,autoFlatFrames=12,autoFlatMaxGapMs=250}={}){
 let latest=null,held=null,pending=null,acceptAfter=-Infinity,flatFrames=0,flatSince=null,barrierAt=0,lastResolution=null,syncRequired=null,quantity=null,autoFrames=0,autoSince=null,autoLastAt=null;
 const fresh=()=>!!latest&&now()>=latest.capturedAt&&now()-latest.capturedAt<=maxAgeMs;
 const flatStable=()=>fresh()&&latest.state==='FLAT'&&latest.flatProof&&flatFrames>=minFlatFrames&&latest.capturedAt-flatSince>=minFlatMs;
 const resetProof=()=>{flatFrames=0;flatSince=null;};
 const resetAutoProof=()=>{autoFrames=0;autoSince=null;autoLastAt=null;};
 const lockSync=reason=>{if(!syncRequired||['ENTRY_UNCONFIRMED','LEGACY_UNCONFIRMED_ENTRY','POSITION_VIEW_CHANGED'].includes(syncRequired))syncRequired=reason;};
 function check(){
  const observedState=latest?.state??'UNKNOWN',stable=flatStable();
  const state=held??(pending?'PENDING':syncRequired?'UNKNOWN':stable?'FLAT':'UNKNOWN');
  const reason=syncRequired??(held?'POSITION_OPEN':pending?'AWAITING_POSITION_MARKER':!fresh()?latest?'POSITION_STALE':'POSITION_UNKNOWN':observedState==='UNKNOWN'?latest.reason||'POSITION_UNKNOWN':stable?'POSITION_FLAT':'POSITION_STABILIZING');
  const canReset=!!syncRequired&&stable&&(!pending||Number.isFinite(pending.transportSettledAt))&&(!pending||pending.openSeen||latest.capturedAt-flatSince>=pendingFlatMs);
  return {state,held,observedState,canEnter:!syncRequired&&!held&&!pending&&stable,reason,quantity,quantityVerified:Number.isSafeInteger(quantity),syncRequired,capturedAt:latest?.capturedAt??null,context:latest?.context??null,flatFrames,flatStable:stable,barrierAt,canReset,autoFlatFrames:autoFrames,autoFlatElapsedMs:autoSince===null?0:Math.max(0,(latest?.capturedAt??autoSince)-autoSince),pendingId:pending?.id??null,pendingAt:pending?.at??null,attemptedAt:pending?.attemptedAt??null,transportSettledAt:pending?.transportSettledAt??null,lastResolution};
 }
 function clearSource(){latest=null;resetProof();resetAutoProof();acceptAfter=Math.max(acceptAfter,now());}
 return {
  check,
  observe(sample){
   if(!sample||!STATES.has(sample.state)||!Number.isFinite(sample.capturedAt)||sample.capturedAt>now()||sample.capturedAt<=acceptAfter||now()-sample.capturedAt>maxAgeMs||typeof sample.context!=='string'||!sample.context||!['number','string'].includes(typeof sample.frameId)||(typeof sample.frameId==='number'&&!Number.isFinite(sample.frameId)))return check();
   if(latest&&(sample.capturedAt<=latest.capturedAt||(sample.context===latest.context&&sample.frameId===latest.frameId)))return check();
   const continuous=!!latest&&sample.context===latest.context&&sample.capturedAt-latest.capturedAt<=maxAgeMs;
   const provenFlat=sample.state==='FLAT'&&sample.flatProof===true;
   if(!continuous||!provenFlat||latest.state!=='FLAT'||!latest.flatProof)resetProof();
   if(!continuous||!provenFlat||sample.autoFlatProof!==true||sample.viewChanged===true||autoLastAt!==null&&sample.capturedAt-autoLastAt>autoFlatMaxGapMs)resetAutoProof();
   latest={state:sample.state,capturedAt:sample.capturedAt,frameId:sample.frameId,context:sample.context,flatProof:provenFlat,reason:String(sample.reason??'POSITION_UNKNOWN').slice(0,100)};
   if(sample.viewChanged===true&&(held||pending))syncRequired??='POSITION_VIEW_CHANGED';
   if(OPEN.has(sample.state)){
    resetAutoProof();
    held=sample.state;
    if(['ENTRY_UNCONFIRMED','LEGACY_UNCONFIRMED_ENTRY','POSITION_VIEW_CHANGED'].includes(syncRequired))syncRequired=null;
    quantity=sample.quantityVerified===true&&Number.isSafeInteger(sample.quantity)&&sample.quantity>0?sample.quantity:null;
    if(quantity!==null&&quantity!==1)syncRequired='POSITION_QUANTITY_MISMATCH';
    if(pending)pending.openSeen=true;
   }
   if(provenFlat){
    // Early pre-entry clear frames cannot establish that a submitted key failed.
    const earlyPending=pending&&(!Number.isFinite(pending.transportSettledAt)||!pending.openSeen&&sample.capturedAt<pending.transportSettledAt+pendingSettleMs);
    if(earlyPending){resetProof();resetAutoProof();}
    else{
     if(flatSince===null)flatSince=sample.capturedAt;
     flatFrames++;
     if(flatStable()){
      const unconfirmed=pending&&!pending.openSeen;
      if(unconfirmed&&sample.capturedAt-flatSince>=pendingFlatMs){syncRequired??='ENTRY_UNCONFIRMED';lastResolution='ENTRY_UNCONFIRMED_BLOCKED';}
      if(!unconfirmed&&!syncRequired){
       if(held||pending){barrierAt=sample.capturedAt;lastResolution='POSITION_CLOSED';}
       held=null;pending=null;quantity=null;
      }
      // This is an automatic VISUAL recovery, never an account/fill claim.
      // A timer alone, ordinary empty frames or a new chart cannot unlock it.
      const recoverable=isAutoFlatRecoveryReason(syncRequired);
      if(recoverable&&sample.autoFlatProof===true&&sample.viewChanged!==true){
       if(autoSince===null)autoSince=sample.capturedAt;
       autoFrames++;autoLastAt=sample.capturedAt;
       if(autoFrames>=autoFlatFrames&&sample.capturedAt-autoSince>=autoFlatMs){
        held=null;pending=null;syncRequired=null;quantity=null;barrierAt=sample.capturedAt;lastResolution='POSITION_FLAT_RECONFIRMED';resetAutoProof();
       }
      }else resetAutoProof();
     }
    }
   }
   return check();
  },
  submitted({id,at=now(),tabId=null,attempted=true}={}){
   if(typeof id!=='string'||!id||!Number.isFinite(at)||at>now())return check();
   pending={id,at,tabId,openSeen:!!held,attemptedAt:attempted?at:null,transportSettledAt:null};lastResolution=null;resetProof();resetAutoProof();return check();
  },
  markAttempted(id,at=now()){
   if(pending?.id===id&&!Number.isFinite(pending.attemptedAt)&&Number.isFinite(at)&&at<=now()){
    pending.at=at;pending.attemptedAt=at;resetProof();
   }
   return check();
  },
  settleAttempt(id,at=now()){
   if(pending?.id===id&&Number.isFinite(pending.attemptedAt)&&!Number.isFinite(pending.transportSettledAt)&&Number.isFinite(at)&&at>=pending.attemptedAt&&at<=now()){
    pending.transportSettledAt=at;resetProof();
   }
   return check();
  },
  releaseUnattempted(id){if(pending?.id===id&&!pending.openSeen&&pending.attemptedAt===null){pending=null;lastResolution='ENTRY_NOT_ATTEMPTED';resetProof();}return check();},
  suspend(){clearSource();return check();},
  // Only for a different execution target/chart, never for a resize or pause.
  requireSync(reason='POSITION_CONTEXT_CHANGED'){if(held||pending||syncRequired)lockSync(reason);clearSource();return check();},
  clearContext(reason='POSITION_CONTEXT_CHANGED'){if(held||pending||syncRequired)lockSync(reason);quantity=null;barrierAt=now();lastResolution=reason;clearSource();return check();},
  snapshot(){return {held,pending:pending?{...pending}:null,barrierAt,lastResolution,syncRequired,quantity};},
  restore(saved){
   held=OPEN.has(saved?.held)?saved.held:null;
   // A crash can occur between the durable reservation and rawKeyDown. Start a
   // new settle interval even if the saved reservation had not recorded input.
   pending=saved?.pending&&typeof saved.pending.id==='string'&&saved.pending.id&&Number.isFinite(saved.pending.at)?{id:saved.pending.id,at:now(),attemptedAt:now(),transportSettledAt:now(),tabId:saved.pending.tabId??null,openSeen:saved.pending.openSeen===true}:null;
   barrierAt=Number.isFinite(saved?.barrierAt)?saved.barrierAt:0;lastResolution=typeof saved?.lastResolution==='string'?saved.lastResolution:null;
   syncRequired=typeof saved?.syncRequired==='string'?saved.syncRequired:saved?.lastResolution==='ENTRY_UNCONFIRMED_FLAT'?'LEGACY_UNCONFIRMED_ENTRY':null;
   quantity=Number.isSafeInteger(saved?.quantity)&&saved.quantity>0?saved.quantity:null;
   clearSource();return check();
  },
  resetPending({confirmedFlat=false,expectedPendingId,expectedContext}={}){
   const p=check();
   if(confirmedFlat!==true)return {ok:false,code:'MANUAL_FLAT_CONFIRMATION_REQUIRED',position:p};
   if(!p.canReset)return {ok:false,code:'VISIBLE_FLAT_REQUIRED',position:p};
   if(expectedPendingId!==(pending?.id??null)||expectedContext!==latest?.context)return {ok:false,code:'POSITION_CONFIRMATION_CHANGED',position:p};
   held=null;pending=null;syncRequired=null;quantity=null;barrierAt=now();lastResolution='MANUAL_FLAT_CONFIRMED';clearSource();
   return {ok:true,code:'POSITION_RESET',position:check()};
  },
 };
}
