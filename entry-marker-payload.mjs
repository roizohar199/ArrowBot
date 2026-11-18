import {candleMarkerPayloadSignature,LIVE_DIRECTION_MARKER_LIMITS} from './candle-marker-payload.mjs';

const copy=x=>structuredClone(x),same=(a,b)=>['provider','environment','nativeAccountId'].every(k=>typeof a?.[k]==='string'&&a[k]===b?.[k]);
const text=x=>typeof x==='string'&&x.length>0&&x.length<4096;
const validRecord=r=>r?.approvalKind==='TECHNICAL'&&r.sourceMode==='LIVE'&&text(r.eventId)&&['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','priceTicks','directionCode'].every(k=>Number.isSafeInteger(r[k]))&&r.closeTime-r.time===60000&&r.priceTicks===r.closeTicks&&r.priceTicks>0&&r.highTicks>=Math.max(r.openTicks,r.closeTicks)&&r.lowTicks<=Math.min(r.openTicks,r.closeTicks)&&r.directionCode===(r.direction==='LONG'?1:r.direction==='SHORT'?-1:0)&&['LONG','SHORT'].includes(r.direction);

// Read-only projection of native dispatch/closure receipts. It cannot issue an
// execution permit, change a technical decision, or trigger an order.
export function collectEntryMarkerProofs({execution,records=[],account,stored=[]}={}){
  const byEvent=new Map(records.filter(validRecord).map(r=>[r.eventId,r])),proofs=new Map();
  for(const p of stored){if(same(p.account,account)&&text(p.attemptKey)&&validRecord(p.record)&&['NATIVE_MARKET_DISPATCH','CLOSED_ATTRIBUTED_NATIVE_FILL'].includes(p.basis))proofs.set(p.record.eventId,copy(p));}
  for(const j of execution?.journal??[]){
    const r=j?.result,record=byEvent.get(j?.eventId);
    if(j?.phase!=='NATIVE_SUBMISSION_REPLY'||!record||!text(j.attemptKey)||r?.attemptKey!==j.attemptKey||r.kind!=='NATIVE_USER_MARKET_RESULT_V1'||r.submitted!==true||r.submissionAttempted!==true||r.nativeIdentityVerified!==true||r.synthetic===true||r.testOnly===true||!same(j.accountIdentity??r,account)||r.provider!==account.provider||r.environment!==account.environment||!/^((PAPER|TRADOVATE)_USER_|NATIVE_USER_)SUBMITTED_UNCONFIRMED$/.test(r.status??''))continue;
    if(j.confirmationBar&&['time','closeTime','open','high','low','close'].some(k=>j.confirmationBar[k]!==(['time','closeTime'].includes(k)?record[k]:record[k+'Ticks']*.25)))continue;
    proofs.set(record.eventId,{account:copy(account),attemptKey:j.attemptKey,basis:'NATIVE_MARKET_DISPATCH',record:copy(record)});
  }
  for(const saved of execution?.entryMarkerLedger??[]){
    const record=byEvent.get(saved?.eventIdentity?.eventId),filled=saved?.history?.find(h=>h.status==='FILLED'&&h.phase==='ATTRIBUTED_NATIVE_RECONCILIATION'),p=filled?.proof;
    if(!record||!['FILLED','CLOSED'].includes(saved.status)||!same(saved.accountIdentity,account)||!text(saved.key)||saved.eventIdentity.direction!==record.direction||saved.eventIdentity.confirmedAt!==record.closeTime||p?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||p.intentKey!==saved.key||p.status!=='FILLED'||p.attributionVerified!==true||p.fillVerified!==true||!text(p.nativeOrderId)||!same(p.accountEvidence,account)||p.accountEvidence.nativeIdentityVerified!==true||p.accountEvidence.origin!=='PUBLIC_NATIVE_UI'||p.synthetic===true||p.testOnly===true)continue;
    proofs.set(record.eventId,{account:copy(account),attemptKey:saved.key,nativeOrderId:p.nativeOrderId,basis:'CLOSED_ATTRIBUTED_NATIVE_FILL',record:copy(record)});
  }
  const closed=execution?.lifecycle?.lastClosedAttempt,record=byEvent.get(closed?.signal?.eventId);
  if(record&&closed.status==='CLOSED'&&text(closed.nativeOrderId)&&text(closed.attemptKey)&&same(closed.binding?.accountIdentity,account)&&closed.signal.direction===record.direction&&closed.signal.confirmationBarCloseTime===record.closeTime&&closed.closureSamples?.length===2&&closed.closureSamples.every(s=>s.ownershipVerified===true&&same(s.accountIdentity,account)&&s.positionsComplete===true&&s.workingOrdersComplete===true&&s.positions?.length===0&&s.workingOrders?.length===0)){
    proofs.set(record.eventId,{account:copy(account),attemptKey:closed.attemptKey,nativeOrderId:closed.nativeOrderId,basis:'CLOSED_ATTRIBUTED_NATIVE_FILL',record:copy(record)});
  }
  // An explicit native non-submission proof must never retain an entry arrow.
  for(const j of execution?.journal??[])if(j?.phase==='NATIVE_NON_SUBMISSION_VERIFIED')for(const [id,p] of proofs)if(p.attemptKey===j.attemptKey)proofs.delete(id);
  return [...proofs.values()];
}

export function formatEntryMarkerPayload(payload,proofs=[]){
  if(!['READY','EMPTY'].includes(payload?.status)||payload.schemaVersion!==3)return payload;
  const horizon=payload.asOfTime-86400000,byEvent=new Map(payload.records.filter(validRecord).map(r=>[r.eventId,{...copy(r),entrySubmitted:false}]));
  for(const p of proofs){const r=p.record;if(!validRecord(r)||r.time<horizon||r.closeTime>payload.asOfTime)continue;const known=byEvent.get(r.eventId);if(known&&['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','directionCode'].some(k=>known[k]!==r[k]))continue;byEvent.set(r.eventId,{...copy(r),entrySubmitted:true,entryProofBasis:p.basis,attemptKey:p.attemptKey});}
  const records=[...byEvent.values()].sort((a,b)=>a.time-b.time||a.eventId.localeCompare(b.eventId)).slice(-LIVE_DIRECTION_MARKER_LIMITS.maxMarkers).map((r,i)=>{let hash=17;for(const c of r.eventId)hash=(hash*31+c.charCodeAt(0)+1)%1000000007;return {...r,markerId:'m'+i+'_'+hash};});
  const textPayload=[['ARROW_ENTRY_MARKERS_V1',payload.instrument,'1','LIVE',payload.asOfTime].join('|'),...records.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.priceTicks,r.entrySubmitted?1:0].join('|'))].join('\n');
  if(textPayload.length>LIVE_DIRECTION_MARKER_LIMITS.maxCharacters)return {...payload,status:'BLOCKED',reasonCodes:['NATIVE_MARKER_TEXT_LIMIT']};
  return {...payload,schemaVersion:4,records,textPayload,payloadSignature:candleMarkerPayloadSignature(textPayload),status:records.length?'READY':'EMPTY',reasonCodes:records.length?[]:['NO_ENTRY_OR_RESEARCH_MARKERS'],entryArrowCount:records.filter(r=>r.entrySubmitted).length,researchCircleCount:records.filter(r=>!r.entrySubmitted).length,markerMeaning:'COLORED_ARROW_NATIVE_MARKET_DISPATCH_GRAY_CIRCLE_RESEARCH',markerPlacement:'CONFIRMATION_CLOSE_TIME_AND_PRICE',fillInferred:false,orderEligible:false,ordersCreated:false};
}
