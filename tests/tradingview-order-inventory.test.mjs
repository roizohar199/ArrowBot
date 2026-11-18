import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTradingViewOrderInventory,verifyTradingViewOwnedFill,verifyTradingViewOwnedClose} from '../tradingview-order-inventory.mjs';

// Synthetic decoder contracts only. Header labels below are explicit examples;
// these fixtures do not certify a current broker schema, connection or fill.
const copy=x=>structuredClone(x),origin=1000000;
const positionMap={symbol:{id:'symbol',text:'Symbol'},side:{id:'side',text:'Side'},quantity:{id:'qty',text:'Qty'},fillPrice:{id:'avgPrice',text:'Avg Fill Price'}};
const orderMap={...positionMap,orderId:{id:'id',text:'Order ID'},status:{id:'status',text:'Status'},filledQuantity:{id:'filledQty',text:'Filled Qty'}};
function capturedTable(rows=[],role='positions'){
  const columnMap=copy(role==='positions'?positionMap:orderMap);
  return {visible:true,loading:false,numberFormat:'EN_US_GROUPED_DECIMAL',headers:copy(Object.values(columnMap)),columnMap,
    sideMap:{Buy:'LONG',Sell:'SHORT',Long:'LONG',Short:'SHORT'},statusMap:{Filled:'FILLED',Working:'WORKING',Inactive:'INACTIVE',Cancelled:'CANCELLED',Pending:'PENDING','Partially Filled':'PARTIALLY_FILLED'},
    rows:copy(rows),empty:rows.length===0,completeness:{kind:'PUBLIC_ROWCOUNT_AND_PAGINATION_V1',scope:'SELECTED_ACCOUNT_ALL_SYMBOLS',filter:'ALL',filtersVerified:true,virtualized:false,virtualizationVerified:true,
      totalRows:rows.length,renderedRows:rows.length,pageIndex:1,pageCount:1,hasNext:false,hasPrevious:false,
      rowCountProof:{locator:'[data-test="synthetic-grid"][aria-rowcount]',raw:String(rows.length+1),headerRows:1},
      paginationProof:{locator:'[data-test="synthetic-pagination"]',pageIndexRaw:'1',pageCountRaw:'1',nextDisabled:true,previousDisabled:true}}};
}
function fixture({direction='LONG',quantity=2}={}){
  const expected={provider:'TRADOVATE',nativeAccountId:'PA-LOCAL-COMPONENT',environment:'PA',accountRevision:3,selectionKey:'profile-selection-3',source:{tabId:101,url:'https://www.tradingview.com/chart/ArrowResearch/',documentTimeOrigin:origin},symbol:'CME_MINI:NQZ2026',direction,quantity,intentKey:'component-only-event-1'};
  const snap=(captureId,observedAt,performanceOffset)=>({kind:'TRADINGVIEW_PUBLIC_ACCOUNT_TABLE_SNAPSHOT_V1',...copy(expected),environmentVerified:false,captureId,observedAt,verificationEpochMs:origin+performanceOffset,
    tables:{positions:capturedTable(),workingOrders:capturedTable([],'workingOrders'),orderHistory:capturedTable([],'orderHistory')},synthetic:true,testOnly:true});
  const baseline=snap('before',9800,100),snapshot=snap('after',10000,300),side=direction==='LONG'?'Buy':'Sell',nativeOrderId='00088172';
  const order={cells:{symbol:expected.symbol,side,qty:String(quantity),avgPrice:'28,840.50',id:nativeOrderId,status:'Filled',filledQty:String(quantity)}};
  const position={cells:{symbol:expected.symbol,side:direction==='LONG'?'Long':'Short',qty:String(quantity),avgPrice:'28,840.50'}};
  snapshot.tables.positions=capturedTable([position]);snapshot.tables.orderHistory=capturedTable([order],'orderHistory');
  const submission={kind:'PUBLIC_NATIVE_ORDER_SUBMISSION_RECEIPT_V1',...copy(expected),submitted:true,nativeOrderIdObserved:true,nativeOrderId,baselineCaptureId:'before',submittedAt:9900,submissionEpochMs:origin+200,testOnly:true};
  return {expected,baseline,snapshot,submission,now:10000,snap};
}
const decoded=(f,s=f.snapshot)=>decodeTradingViewOrderInventory(s,{expected:f.expected,now:f.now});
const filled=f=>verifyTradingViewOwnedFill(f);

test('complete selected-account inventory requires explicit total, pagination, filters and virtualization proof',()=>{
  const f=fixture(),result=decoded(f,f.baseline);assert.equal(result.status,'ACCOUNT_INVENTORY_COMPLETE');assert.equal(result.flatAndNoPendingVerified,true);
  assert.equal(result.environmentVerified,false);assert.equal(result.testOnly,true);assert.equal(result.executionCapabilityCreated,false);assert.equal(result.ordersCreated,false);assert.equal(result.protectionVerified,false);
  assert.equal(result.tables.positions.nativeSchemaObservedByDecoder,false);assert.equal(result.remoteVerificationPerformed,false);
});

test('visible Nothing-to-show, empty:true or a zero array never independently certifies flat inventory',()=>{
  const f=fixture(),snapshot=copy(f.baseline);
  for(const role of ['positions','workingOrders']){delete snapshot.tables[role].completeness;snapshot.tables[role].emptyText='Nothing to show yet. Your account activity will appear here.';}
  const result=decoded(f,snapshot);assert.equal(result.status,'VISIBLE_EMPTY_NOT_COMPLETE');assert.equal(result.visibleEmpty,true);assert.equal(result.inventoryComplete,false);assert.equal(result.flatVerified,false);assert.equal(result.pendingEmptyVerified,false);
});

test('empty native PA header captures remain visible-only without count/paging proof',()=>{
  // Exact common labels transcribed from .24.0 actual PA empty-table captures.
  // This is still synthetic binding context, not an actual inventory certificate.
  const f=fixture(),snapshot=copy(f.baseline);
  snapshot.tables.positions.headers.push({id:'id',text:'Position ID'},{id:'updateTime',text:'Update Time'});
  snapshot.tables.workingOrders.headers.push({id:'remainingQty',text:'Remaining Qty'},{id:'updateTime',text:'Update Time'});
  delete snapshot.tables.positions.completeness;delete snapshot.tables.workingOrders.completeness;
  const result=decoded(f,snapshot);assert.equal(result.status,'VISIBLE_EMPTY_NOT_COMPLETE');assert.equal(result.flatAndNoPendingVerified,false);
});

for(const [name,mutate]of [
  ['viewport subset',t=>{t.completeness.totalRows=7;}],['hidden filter',t=>{t.completeness.filtersVerified=false;}],
  ['symbol filter',t=>{t.completeness.scope='CURRENT_SYMBOL_ONLY';}],['virtualized rows',t=>{t.completeness.virtualized=true;}],
  ['unknown virtualization',t=>{delete t.completeness.virtualizationVerified;}],['next page',t=>{t.completeness.hasNext=true;}],
  ['other page',t=>{t.completeness.pageCount=2;}],['missing native count',t=>{delete t.completeness.rowCountProof;}],
  ['contradictory raw count',t=>{t.completeness.rowCountProof.raw='4';}],['missing native pagination',t=>{delete t.completeness.paginationProof;}],
  ['enabled next button',t=>{t.completeness.paginationProof.nextDisabled=false;}]
])test(name+' cannot become complete/flat',()=>{
  const f=fixture(),s=copy(f.baseline);mutate(s.tables.positions);const r=decoded(f,s);assert.notEqual(r.status,'UNKNOWN');assert.equal(r.inventoryComplete,false);assert.equal(r.flatVerified,false);
});

test('unknown headers, cell values, unsupported numeric locale and hidden/loading tables fail closed',()=>{
  const changes=[s=>{s.tables.positions.headers[0].text='Different label';},s=>{s.tables.positions.visible=false;},s=>{s.tables.positions.loading=true;},s=>{s.tables.positions.numberFormat='UNVERIFIED';},s=>{s.tables.positions.rows[0].cells.qty='1,5';},s=>{s.tables.positions.rows[0].cells.side='Unmapped side';},s=>{s.tables.orderHistory.rows[0].cells.status='Unknown';}];
  for(const mutate of changes){const f=fixture();mutate(f.snapshot);assert.equal(decoded(f).status,'UNKNOWN');}
});

test('exact account, provider, environment, revision, selection and document source binding are preserved',()=>{
  const changes=[s=>{s.nativeAccountId='pa-local-component';},s=>{s.nativeAccountId='0'+s.nativeAccountId;},s=>{s.provider='TRADINGVIEW_PAPER';},s=>{s.environment='DEMO';},s=>{s.accountRevision++;},s=>{s.selectionKey+='changed';},s=>{s.source.tabId++;},s=>{s.source.url='https://www.tradingview.com/chart/Other/';},s=>{s.source.documentTimeOrigin++;}];
  for(const mutate of changes){const f=fixture();mutate(f.snapshot);assert.equal(decoded(f).status,'UNKNOWN');}
});

test('wall-clock freshness uses observedAt without comparing separate performance-clock epochs',()=>{
  const f=fixture();assert.equal(decoded(f).status,'ACCOUNT_INVENTORY_COMPLETE');
  f.snapshot.observedAt=f.now+1;assert.equal(decoded(f).status,'UNKNOWN');
  f.snapshot.observedAt=f.now-5001;assert.equal(decoded(f).status,'UNKNOWN');
});

for(const direction of ['LONG','SHORT'])test(direction+' owned fill binds actual receipt id, complete baseline and exact position without bot sizing or protection claims',()=>{
  const f=fixture({direction,quantity:3}),before=copy({expected:f.expected,baseline:f.baseline,snapshot:f.snapshot,submission:f.submission});const result=filled(f);
  assert.equal(result.status,'OWNED_FILL_VERIFIED');assert.equal(result.nativeOrderId,'00088172');assert.equal(result.fillVerified,true);assert.equal(result.quantity,3);assert.equal(result.direction,direction);assert.equal(result.entry,28840.5);
  assert.equal(result.protectionVerified,false);assert.equal(result.userManaged,true);assert.equal(result.executionCapabilityCreated,false);assert.equal(result.testOnly,true);assert.equal('riskPlan'in result,false);assert.equal('stop'in result,false);assert.equal('target'in result,false);assert.deepEqual({expected:f.expected,baseline:f.baseline,snapshot:f.snapshot,submission:f.submission},before);
});

test('a matching position or caller order key alone never proves an owned fill',()=>{
  for(const mutate of [f=>{delete f.submission.nativeOrderId;},f=>{f.submission.nativeOrderId='different';},f=>{f.submission.nativeOrderIdObserved=false;},f=>{f.submission.intentKey='different';},f=>{f.submission.baselineCaptureId='different';},f=>{delete f.baseline.tables.positions.completeness;},f=>{f.submission.submissionEpochMs=f.baseline.verificationEpochMs-1;}]){
    const f=fixture();mutate(f);assert.equal(filled(f).fillVerified,false);
  }
});

test('pre-existing or duplicate native order IDs cannot be attributed to the new submission',()=>{
  const f=fixture();f.baseline.tables.orderHistory=copy(f.snapshot.tables.orderHistory);assert.equal(filled(f).reasonCodes[0],'NATIVE_ORDER_ID_PREEXISTED_SUBMISSION');
  const g=fixture();g.snapshot.tables.orderHistory=capturedTable([g.snapshot.tables.orderHistory.rows[0],g.snapshot.tables.orderHistory.rows[0]],'orderHistory');assert.equal(filled(g).fillVerified,false);
});

test('unfilled, partial, wrong side, wrong symbol, wrong quantity and mismatched fill prices remain unverified',()=>{
  const mutations=[f=>{f.snapshot.tables.orderHistory.rows[0].cells.status='Working';},f=>{f.snapshot.tables.orderHistory.rows[0].cells.status='Partially Filled';},f=>{f.snapshot.tables.orderHistory.rows[0].cells.filledQty='1';},f=>{f.snapshot.tables.orderHistory.rows[0].cells.side='Sell';},f=>{f.snapshot.tables.orderHistory.rows[0].cells.symbol='CME_MINI:NQ1!';},f=>{f.snapshot.tables.orderHistory.rows[0].cells.qty='4';},f=>{f.snapshot.tables.positions.rows[0].cells.avgPrice='28,841.00';}];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(filled(f).fillVerified,false);}
});

test('a terminal row in the supposed working-only table cannot certify complete active-order inventory',()=>{
  const f=fixture();f.snapshot.tables.workingOrders=copy(f.snapshot.tables.orderHistory);
  const result=decoded(f);assert.equal(result.workingOrdersComplete,false);assert.equal(result.inventoryComplete,false);assert.ok(result.reasonCodes.includes('WORKING_TABLE_CONTAINS_TERMINAL_ORDER'));
});

test('two distinct complete flat samples after the owned fill prove disappearance but no exit price, profit or automatic management',()=>{
  const f=fixture(),ownedFill=filled(f),firstSnapshot=f.snap('flat-1',10050,400),secondSnapshot=f.snap('flat-2',10200,550);
  const result=verifyTradingViewOwnedClose({ownedFill,firstSnapshot,secondSnapshot,expected:f.expected,now:10200});
  assert.equal(result.status,'OWNED_FILL_ACCOUNT_FLAT_VERIFIED');assert.equal(result.closedVerified,true);assert.equal(result.exitFillVerified,false);assert.equal(result.realizedPnlVerified,false);assert.equal(result.ordersCreated,false);assert.equal(result.protectionVerified,false);assert.equal(result.testOnly,true);
});

test('one sample, stale/reused captures, insufficient interval and missing counts cannot prove closure',()=>{
  const mutations=[v=>{v.secondSnapshot=copy(v.firstSnapshot);},v=>{v.firstSnapshot.captureId=v.ownedFill.captureId;},v=>{v.secondSnapshot.verificationEpochMs=v.firstSnapshot.verificationEpochMs+1;},v=>{delete v.secondSnapshot.tables.workingOrders.completeness;},v=>{v.firstSnapshot.verificationEpochMs=v.ownedFill.verificationEpochMs;},v=>{v.secondSnapshot.source.documentTimeOrigin++;},v=>{v.ownedFill.quantity++;}];
  for(const mutate of mutations){const f=fixture(),value={ownedFill:filled(f),firstSnapshot:f.snap('flat-1',10050,400),secondSnapshot:f.snap('flat-2',10200,550),expected:f.expected,now:10200};mutate(value);assert.equal(verifyTradingViewOwnedClose(value).closedVerified,false);}
});

test('empty row arrays with schema/identity missing never become a private execution capability',()=>{
  for(const snapshot of [null,{}, {tables:{positions:{rows:[],empty:true},workingOrders:{rows:[],empty:true}}}]){
    const result=decodeTradingViewOrderInventory(snapshot);assert.equal(result.status,'UNKNOWN');assert.equal(result.inventoryComplete,false);assert.equal(result.executionCapabilityCreated,false);
  }
});
