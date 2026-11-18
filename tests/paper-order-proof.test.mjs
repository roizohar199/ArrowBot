import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPaperOrderTableProof as verify} from '../paper-order-proof.mjs';
import {makePaperOrderProofFixture as fixture,makeSyntheticFilledPaperProofFixture as filledFixture} from './fixtures/paper-order-proof.mjs';
const run=f=>verify(f.intent,f.evidence,{now:f.now,baselineOrderIds:[]});
test('observedmanualPaperrowsproveworkingparentandregisteredINACTIVEbrackets, neverafilloractiveprotection',()=>{
  const f=fixture(),before=structuredClone(f),r=run(f);assert.equal(r.status,'WORKING');assert.equal(r.parentOrderId,'3806121023');assert.equal(r.stopOrderId,'3806121024');assert.equal(r.targetOrderId,'3806121025');assert.equal(r.quantity,1);assert.equal(r.entryVerified,true);assert.equal(r.stopVerified,true);assert.equal(r.targetVerified,true);assert.equal(r.fillVerified,false);assert.equal(r.stopActive,false);assert.equal(r.targetActive,false);assert.equal(r.protectionState,'PENDING_PARENT_FILL');assert.equal(r.serverParentLinkProven,false);assert.equal(r.ordersCreated,true);assert.deepEqual(f,before);
});
test('cancelledparentandchildrenneitherproveWORKINGnorFILLED',()=>{
  const f=fixture();for(const row of f.evidence.tables.orders.rows)row.cells.status='cancelled';f.evidence.tables.orders.rows[0].cells.takeProfit='';f.evidence.tables.orders.rows[0].cells.stopLoss='';assert.equal(run(f).status,'UNKNOWN');assert.equal(run(f).fillVerified,false);
});
test('filledparentandworkingchildrenwithguessedpositioncolumnsremainUNKNOWN',()=>{
  const f=fixture();f.evidence.tables.orders.rows[0].cells.status='filled';f.evidence.tables.orders.rows[0].cells.avgPrice='27,958.00';for(const row of f.evidence.tables.orders.rows.slice(1))row.cells.status='working';assert.equal(run(f).status,'UNKNOWN');f.evidence.tables.positions={headers:[{id:'madeUpQty',text:'Quantity'}],rows:[{cells:{madeUpQty:'1'}}],empty:false};assert.deepEqual(run(f).reasonCodes,['PAPER_FILLED_POSITION_SCHEMA_UNVERIFIED']);assert.equal(run(f).fillVerified,false);
});
test('exactheaderidsandobservedlabelsrequired;implicitDOMroleabsencecannotbecomeanemptytable',()=>{
  for(const edit of [f=>{f.evidence.tables.orders.headers=[];},f=>{f.evidence.tables.orders.headers[3].text='Unknown';},f=>{f.evidence.tables.orders.headers.push({...f.evidence.tables.orders.headers[0]});},f=>{delete f.evidence.tables.orders.rows[0].cells.qty;},f=>{f.evidence.tables.orders.empty=true;}]){const f=fixture();edit(f);assert.equal(run(f).status,'UNKNOWN');}
});
test('differentbroker/account/staleobservationscannotproveourorder',()=>{
  for(const edit of [f=>{f.evidence.provider='TRADOVATE';},f=>{f.evidence.accountKey='other-account';},f=>{f.evidence.observedAt=f.now-5001;},f=>{f.evidence.observedAt=f.now+1;},f=>{f.intent.quantity=2;}]){const f=fixture();edit(f);assert.equal(run(f).status,'UNKNOWN');}
});
test('parentandbracketsrequireexactsymbolsidequantitypriceandplacingtime',()=>{
  const changes=[['symbol','CME_MINI:MNQZ2026'],['side','Buy'],['qty','2'],['stopPrice','27,949.00'],['placingTime','2026-11-15 06:48:23'],['status','working']];
  for(const [key,value] of changes){const f=fixture();f.evidence.tables.orders.rows[1].cells[key]=value;assert.equal(run(f).status,'UNKNOWN',key);}
  for(const edit of [f=>{f.evidence.tables.orders.rows[0].cells.takeProfit='';},f=>{f.evidence.tables.orders.rows[0].cells.avgPrice='27,958.00';},f=>{f.evidence.tables.orders.rows[2].cells.limitPrice='27,977.00';}]){const f=fixture();edit(f);assert.equal(run(f).status,'UNKNOWN');}
});
test('duplicateIDs,additionalactiveordersandambiguousparentsfailclosedwhileterminalhistoryisignored',()=>{
  const duplicate=fixture();duplicate.evidence.tables.orders.rows.push(structuredClone(duplicate.evidence.tables.orders.rows[0]));assert.deepEqual(run(duplicate).reasonCodes,['PAPER_DUPLICATE_ORDER_IDS']);
  for(const status of ['working','inactive']){const f=fixture(),extra=structuredClone(f.evidence.tables.orders.rows[0]);extra.cells.id=extra.rowId='99999';extra.cells.status=status;f.evidence.tables.orders.rows.push(extra);assert.equal(run(f).status,'UNKNOWN');}
  const old=fixture(),history=structuredClone(old.evidence.tables.orders.rows[0]);history.cells.id=history.rowId='99999';history.cells.status='cancelled';old.evidence.tables.orders.rows.push(history);assert.equal(run(old).status,'WORKING');
});
test('childIDsneednotbeconsecutiveandarelinkedonlybyuniqueobservedfields',()=>{
  const f=fixture();f.evidence.tables.orders.rows[1].cells.id=f.evidence.tables.orders.rows[1].rowId='42';f.evidence.tables.orders.rows[2].cells.id=f.evidence.tables.orders.rows[2].rowId='987654321';const r=run(f);assert.equal(r.status,'WORKING');assert.equal(r.stopOrderId,'42');assert.equal(r.serverParentLinkProven,false);
});
test('submissionbaselineandexplicitparentIDexcludeoldorconflictingorders',()=>{
  const f=fixture();assert.deepEqual(verify(f.intent,f.evidence,{now:f.now,baselineOrderIds:['3806121023']}).reasonCodes,['PAPER_PARENT_PREEXISTED_SUBMISSION']);assert.deepEqual(verify(f.intent,f.evidence,{now:f.now,baselineOrderIds:['3806121024']}).reasonCodes,['PAPER_BRACKETS_PREEXISTED_SUBMISSION']);
  f.evidence.parentOrderId='123';assert.deepEqual(run(f).reasonCodes,['PAPER_PARENT_ORDER_ID_MISMATCH']);delete f.evidence.parentOrderId;f.evidence.baselineOrderIds=['5'];assert.deepEqual(run(f).reasonCodes,['PAPER_BASELINE_ORDER_IDS_UNVERIFIED']);
  for(const baselineOrderIds of [null,'123',[0],['4','4']])assert.deepEqual(verify(f.intent,{...f.evidence,baselineOrderIds:undefined},{now:f.now,baselineOrderIds}).reasonCodes,['PAPER_BASELINE_ORDER_IDS_UNVERIFIED']);
  const missing=fixture();delete missing.evidence.tables.positions;assert.equal(run(missing).status,'UNKNOWN');
});
test('SYNTHETICfilledLONGandSHORTcontractsneedtypedpositionfilledparentandtwoworkingexits',()=>{
  for(const direction of ['LONG','SHORT']){
    const f=filledFixture({direction}),r=run(f);assert.equal(r.status,'FILLED_PROTECTED',JSON.stringify(r));assert.equal(r.fillVerified,true);assert.equal(r.positionStateVerified,true);assert.equal(r.stopActive,true);assert.equal(r.targetActive,true);assert.equal(r.protectionState,'ACTIVE_FILLED_POSITION');assert.equal(r.actualEntry,27958);assert.equal(r.riskAtFill.totalPlannedRisk,198.1);assert.equal(r.riskAtFill.riskAfterProvidedEntry,true);assert.equal(r.serverParentLinkProven,false);
    const better=filledFixture({direction,actualEntry:27958+(direction==='LONG'?-.25:.25)}),proof=run(better);assert.equal(proof.status,'FILLED_PROTECTED');assert.equal(proof.riskAtFill.totalPlannedRisk,193.1);
  }
});
test('filledpositionunknowncolumns/side/quantity/averagebracketsorunmatchedparentnevergrantfilledproof',()=>{
  for(const edit of [f=>{f.evidence.tables.positions.headers.find(h=>h.id==='avgPrice').text='Guessed average';},f=>{f.evidence.tables.positions.rows[0].cells.side='Bullish';},f=>{f.evidence.tables.positions.rows[0].cells.qty='2';},f=>{f.evidence.tables.positions.rows[0].cells.avgPrice='27,958.10';},f=>{f.evidence.tables.positions.rows[0].cells.stopLoss='27,948.50';},f=>{f.evidence.tables.positions.rows[0].cells.takeProfit='';},f=>{f.evidence.tables.orders.rows.shift();},f=>{f.evidence.tables.orders.rows[0].cells.avgPrice='27,957.75';},f=>{f.evidence.tables.positions.rows.push(structuredClone(f.evidence.tables.positions.rows[0]));},f=>{f.evidence.tables.orders.rows[1].cells.status='inactive';},f=>{f.evidence.tables.orders.rows[1].cells.placingTime='2026-11-15 06:48:21';}]){const f=filledFixture();edit(f);assert.equal(run(f).status,'UNKNOWN',edit.toString());}
});
test('actualfillmustrespectlimitentryand200USDexplicitcostriskwithoutmovingstructuralstop',()=>{
  for(const direction of ['LONG','SHORT']){const f=filledFixture({direction,actualEntry:27958+(direction==='LONG'?.25:-.25)});assert.deepEqual(run(f).reasonCodes,['PAPER_FILL_EXCEEDS_PARENT_LIMIT_BOUND']);}
  const costly=filledFixture();costly.intent.riskPlan.parameterSnapshot.commissionPerContract=30;assert.deepEqual(run(costly).reasonCodes,['PAPER_ACTUAL_FILL_RISK_EXCEEDS_200_USD']);
  const missing=filledFixture();delete missing.intent.riskPlan;assert.deepEqual(run(missing).reasonCodes,['PAPER_ACTUAL_FILL_RISK_PARAMETERS_REQUIRED']);
  const changed=filledFixture();changed.intent.riskPlan.initialStop-=.25;assert.deepEqual(run(changed).reasonCodes,['PAPER_ACTUAL_FILL_RISK_PARAMETERS_REQUIRED']);
  const invalidTime=filledFixture();invalidTime.evidence.tables.orders.rows[0].cells.placingTime='2026-99-15 06:48:22';assert.equal(run(invalidTime).status,'UNKNOWN');
});
