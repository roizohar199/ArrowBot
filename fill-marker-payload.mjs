import {candleMarkerPayloadSignature,LIVE_DIRECTION_MARKER_LIMITS} from './candle-marker-payload.mjs';

const copy=x=>structuredClone(x),integer=Number.isSafeInteger;
const same=(a,b)=>['provider','environment','nativeAccountId'].every(k=>typeof a?.[k]==='string'&&a[k]===b?.[k]);
const text=x=>typeof x==='string'&&x.length>0&&x.length<4096;
const number=x=>typeof x==='string'&&/^\d[\d,]*(?:\.\d+)?$/.test(x)?Number(x.replaceAll(',','')):NaN;
const validRecord=r=>r?.approvalKind==='TECHNICAL'&&r.sourceMode==='LIVE'&&text(r.eventId)&&['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','directionCode'].every(k=>integer(r[k]))&&r.closeTime-r.time===60000&&r.lowTicks>0&&r.highTicks>=Math.max(r.openTicks,r.closeTicks)&&r.lowTicks<=Math.min(r.openTicks,r.closeTicks)&&r.directionCode===(r.direction==='LONG'?1:r.direction==='SHORT'?-1:0)&&['LONG','SHORT'].includes(r.direction);

export function validNativeFill(f,account,direction){
  const r=f?.orderRow,m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(f?.timeText??'');
  if(f?.kind!=='NATIVE_EXECUTED_FILL_V1'||f.origin!=='PUBLIC_NATIVE_UI'||!same(f,account)||f.direction!==direction||f.timestampField!=='closeDate'||f.timezoneBasis!=='VISIBLE_CHART_TIMEZONE_MENU'||f.timestampPrecisionMs!==1000||!integer(f.utcOffsetMinutes)||Math.abs(f.utcOffsetMinutes)>840||!integer(f.filledAt)||f.filledAt<=0||!Number.isFinite(f.price)||f.price<=0||!integer(f.price/.25)||!/^\d{1,20}$/.test(f.nativeOrderId??'')||!m||f.synthetic===true||f.testOnly===true)return false;
  const [y,mo,d,h,mi,s]=m.slice(1).map(Number),wall=Date.UTC(y,mo-1,d,h,mi,s),date=new Date(wall);
  return y>=2020&&mo>=1&&mo<=12&&d>=1&&d<=31&&h<24&&mi<60&&s<60&&date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d&&wall-f.utcOffsetMinutes*60000===f.filledAt
    &&r?.id===f.nativeOrderId&&r.type==='Market'&&r.status?.toLowerCase()==='filled'&&r.closeDate===f.timeText&&r.side===(direction==='LONG'?'Buy':'Sell')&&/^CME_MINI:NQ[HMUZ]20\d\d$/.test(r.symbol??'')&&number(r.avgPrice)===f.price;
}

// Display-only: a dispatch, confirmation or observation timestamp is never
// promoted to a fill. Missing native fill price/time leaves a research circle.
export function collectFillMarkerProofs({execution,records=[],account,stored=[]}={}){
  const byEvent=new Map(records.filter(validRecord).map(r=>[r.eventId,r])),proofs=new Map();
  const accept=(record,attemptKey,nativeFill)=>{if(!validRecord(record)||!text(attemptKey)||!validNativeFill(nativeFill,account,record.direction)||nativeFill.filledAt<record.closeTime-5000||nativeFill.filledAt>record.closeTime+900000)return;proofs.set(record.eventId,{account:copy(account),attemptKey,basis:'ATTRIBUTED_NATIVE_FILL_PRICE_AND_TIME',nativeOrderId:nativeFill.nativeOrderId,nativeFill:copy(nativeFill),record:copy(record)});};
  for(const p of stored)if(same(p.account,account)&&p.basis==='ATTRIBUTED_NATIVE_FILL_PRICE_AND_TIME')accept(p.record,p.attemptKey,p.nativeFill);
  const ledger=[...(execution?.entryMarkerLedger??[]),...(execution?.ownedRecord?[execution.ownedRecord]:[])],byAttempt=new Map(ledger.map(r=>[r.key,r.eventIdentity?.eventId]));
  for(const j of execution?.journal??[])if(j.phase==='NATIVE_SUBMISSION_REPLY')byAttempt.set(j.attemptKey,j.eventId);
  for(const j of execution?.journal??[]){const f=j?.result,record=byEvent.get(j.eventId??byAttempt.get(j.attemptKey));if(j.phase!=='NATIVE_FILLED_VERIFIED'||f?.intentKey!==j.attemptKey||f.fillVerified!==true||f.ownershipVerified!==true||!['FILLED','CLOSED'].includes(f.ownedStatus)||f.ownedStatus==='CLOSED'&&f.closedVerified!==true||f.nativeOrderId!==f.nativeFill?.nativeOrderId||!same(f,account)||f.synthetic===true||f.testOnly===true)continue;accept(record,j.attemptKey,f.nativeFill);}
  const facts=new Map((execution?.entryMarkerFillFacts??[]).filter(p=>same(p.account,account)).map(p=>[p.nativeFill?.nativeOrderId,p.nativeFill]));
  for(const saved of ledger){
    const record=byEvent.get(saved?.eventIdentity?.eventId),filled=saved?.history?.find(h=>['FILLED','CLOSED'].includes(h.status)&&h.phase==='ATTRIBUTED_NATIVE_RECONCILIATION'&&h.proof?.fillVerified===true),p=filled?.proof;
    if(!record||!['FILLED','CLOSED'].includes(saved.status)||!same(saved.accountIdentity,account)||saved.eventIdentity.direction!==record.direction||saved.eventIdentity.confirmedAt!==record.closeTime||p?.kind!=='EXECUTION_ATTEMPT_NATIVE_RECONCILIATION_V1'||p.intentKey!==saved.key||!['FILLED','CLOSED'].includes(p.status)||p.status==='CLOSED'&&(p.closedVerified!==true||p.closureSamples?.length!==2)||p.attributionVerified!==true||p.fillVerified!==true||!same(p.accountEvidence,account)||p.accountEvidence.nativeIdentityVerified!==true||p.accountEvidence.origin!=='PUBLIC_NATIVE_UI'||p.synthetic===true||p.testOnly===true)continue;
    const f=p.nativeFill??facts.get(p.nativeOrderId);if(f?.nativeOrderId===p.nativeOrderId)accept(record,saved.key,f);
  }
  for(const j of execution?.journal??[])if(j.phase==='NATIVE_NON_SUBMISSION_VERIFIED')for(const [id,p]of proofs)if(p.attemptKey===j.attemptKey)proofs.delete(id);
  return [...proofs.values()];
}

export function formatFillMarkerPayload(payload,proofs=[]){
  if(!['READY','EMPTY'].includes(payload?.status)||payload.schemaVersion!==3)return payload;
  const horizon=payload.asOfTime-86400000,byEvent=new Map(payload.records.filter(validRecord).map(r=>[r.eventId,{...copy(r),entryFilled:false,fillTime:0,fillPriceTicks:0,fillUtcOffsetMinutes:0}]));
  for(const p of proofs){const r=p.record,f=p.nativeFill;if(!validRecord(r)||!validNativeFill(f,p.account,r.direction)||r.time<horizon||r.closeTime>payload.asOfTime||f.filledAt>payload.asOfTime+65000)continue;const known=byEvent.get(r.eventId);if(known&&['time','closeTime','openTicks','highTicks','lowTicks','closeTicks','directionCode'].some(k=>known[k]!==r[k]))continue;byEvent.set(r.eventId,{...copy(r),entryFilled:true,entryProofBasis:p.basis,nativeOrderId:f.nativeOrderId,attemptKey:p.attemptKey,confirmationPrice:r.closeTicks*.25,price:f.price,priceTicks:f.price/.25,fillTime:f.filledAt,fillPriceTicks:f.price/.25,fillUtcOffsetMinutes:f.utcOffsetMinutes,fillTimestampPrecisionMs:1000});}
  // Keep filled records last so the native last-time/price fields explicitly
  // verify the latest actual fill even when later research circles exist.
  const records=[...byEvent.values()].sort((a,b)=>Number(a.entryFilled)-Number(b.entryFilled)||(a.entryFilled?a.fillTime-b.fillTime:a.time-b.time)||a.eventId.localeCompare(b.eventId)).slice(-LIVE_DIRECTION_MARKER_LIMITS.maxMarkers).map((r,i)=>{let h=17;for(const c of r.eventId)h=(h*31+c.charCodeAt(0)+1)%1000000007;return {...r,markerId:'m'+i+'_'+h};});
  const textPayload=[['ARROW_FILL_MARKERS_V1',payload.instrument,'1','LIVE',payload.asOfTime].join('|'),...records.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.closeTicks,r.entryFilled?1:0,r.fillTime,r.fillPriceTicks,r.fillUtcOffsetMinutes].join('|'))].join('\n');
  if(textPayload.length>LIVE_DIRECTION_MARKER_LIMITS.maxCharacters)return {...payload,status:'BLOCKED',reasonCodes:['NATIVE_MARKER_TEXT_LIMIT']};
  return {...payload,schemaVersion:5,records,textPayload,payloadSignature:candleMarkerPayloadSignature(textPayload),status:records.length?'READY':'EMPTY',reasonCodes:records.length?[]:['NO_FILL_OR_RESEARCH_MARKERS'],entryArrowCount:records.filter(r=>r.entryFilled).length,researchCircleCount:records.filter(r=>!r.entryFilled).length,markerMeaning:'COLORED_ARROW_VERIFIED_NATIVE_FILL_GRAY_CIRCLE_RESEARCH',markerPlacement:'NATIVE_FILL_TIME_AND_PRICE',fillInferred:false,orderEligible:false,ordersCreated:false};
}
