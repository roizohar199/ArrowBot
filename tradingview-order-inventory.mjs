// Pure decoding of supplied public table captures. Column maps are explicit
// contracts, not a claim that any current Tradovate UI schema was observed.
// No browser, requests, events, orders, sizing or SL/TP management.
export const TRADINGVIEW_ORDER_INVENTORY_VERSION='tradingview-public-order-inventory-1';
const snapshotKind='TRADINGVIEW_PUBLIC_ACCOUNT_TABLE_SNAPSHOT_V1';
const evidenceTrust='SUPPLIED_PUBLIC_SNAPSHOT_NOT_AUTHENTICATED_BY_DECODER';
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=Number.isFinite,integer=Number.isSafeInteger;
const text=(x,max=240)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const id=(x,max=240)=>text(x,max)&&!/[\s]/.test(x);
const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
const clone=x=>structuredClone(x);
const equal=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const directions=new Set(['LONG','SHORT']);
const environments=new Set(['REPLAY','DEMO','EVALUATION','PA','LIVE']);
const statuses=new Set(['WORKING','PENDING','INACTIVE','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED','EXPIRED']);
const terminal=new Set(['FILLED','CANCELLED','REJECTED','EXPIRED']);
const numeric=raw=>{
  const value=norm(raw).replace(/^\u2212/,'-');
  if(!value)return null;
  return /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)?Number(value.replaceAll(',','')):NaN;
};
const validSource=source=>{
  if(!plain(source)||!integer(source.tabId)||source.tabId<1||!finite(source.documentTimeOrigin)||source.documentTimeOrigin<0||!text(source.url,2048))return false;
  try{const url=new URL(source.url);return url.protocol==='https:'&&['www.tradingview.com','tradingview.com'].includes(url.hostname)&&/^\/chart\/[A-Za-z0-9_-]+\/$/.test(url.pathname)&&!url.username&&!url.password;}catch{return false;}
};
const binding=x=>({provider:x.provider,nativeAccountId:x.nativeAccountId,environment:x.environment,accountRevision:x.accountRevision,selectionKey:x.selectionKey,source:clone(x.source)});
const sameBinding=(a,b)=>plain(a)&&plain(b)&&['provider','nativeAccountId','environment','accountRevision','selectionKey'].every(k=>a[k]===b[k])&&['tabId','url','documentTimeOrigin'].every(k=>a.source?.[k]===b.source?.[k]);
function validateContext(snapshot,expected,{now,maxAgeMs}){
  if(!plain(expected)||!id(expected.provider,80)||!text(expected.nativeAccountId)||!environments.has(expected.environment)||!integer(expected.accountRevision)||expected.accountRevision<1||!text(expected.selectionKey,2048)||!validSource(expected.source))return 'EXACT_NATIVE_ACCOUNT_BINDING_REQUIRED';
  if(!plain(snapshot)||snapshot.kind!==snapshotKind||!sameBinding(snapshot,expected)||typeof snapshot.environmentVerified!=='boolean')return 'PUBLIC_SNAPSHOT_ACCOUNT_SOURCE_MISMATCH';
  if(!id(snapshot.captureId,512)||!integer(now)||now<0||!integer(maxAgeMs)||maxAgeMs<=0||maxAgeMs>15000||!integer(snapshot.observedAt)||snapshot.observedAt<0||snapshot.observedAt>now||now-snapshot.observedAt>maxAgeMs
    ||!finite(snapshot.verificationEpochMs)||snapshot.verificationEpochMs<snapshot.source.documentTimeOrigin)return 'FRESH_PUBLIC_TABLE_CAPTURE_REQUIRED';
  return null;
}
function table(table,role){
  const needed=role==='positions'?['symbol','side','quantity']:['orderId','symbol','side','quantity','status'];
  if(!plain(table)||table.visible!==true||table.loading!==false||table.numberFormat!=='EN_US_GROUPED_DECIMAL'||!Array.isArray(table.headers)||!Array.isArray(table.rows)||table.headers.length>100||table.rows.length>10000||!plain(table.columnMap)||!plain(table.sideMap))return {error:'EXPLICIT_PUBLIC_TABLE_SCHEMA_REQUIRED'};
  if(table.headers.some(h=>!plain(h)||!id(h.id,120)||typeof h.text!=='string'||h.text.length>240)||new Set(table.headers.map(h=>h.id)).size!==table.headers.length)return {error:'PUBLIC_TABLE_HEADER_SCHEMA_UNVERIFIED'};
  const mapped=Object.entries(table.columnMap),allowed=new Set(['orderId','symbol','side','quantity','status','fillPrice','filledQuantity']);
  if(needed.some(key=>!Object.hasOwn(table.columnMap,key))||mapped.length>allowed.size||mapped.some(([key,value])=>!allowed.has(key)||!plain(value)||!id(value.id,120)||typeof value.text!=='string'||table.headers.filter(h=>h.id===value.id&&norm(h.text)===norm(value.text)).length!==1)||new Set(mapped.map(([,value])=>value.id)).size!==mapped.length)return {error:'PUBLIC_TABLE_COLUMN_MAP_UNVERIFIED'};
  if(Object.entries(table.sideMap).length>20||Object.entries(table.sideMap).some(([label,value])=>!text(label)||!directions.has(value)))return {error:'PUBLIC_TABLE_SIDE_MAP_UNVERIFIED'};
  if(role!=='positions'&&(!plain(table.statusMap)||Object.entries(table.statusMap).length>30||Object.entries(table.statusMap).some(([label,value])=>!text(label)||!statuses.has(value))))return {error:'PUBLIC_TABLE_STATUS_MAP_UNVERIFIED'};
  const rows=[];
  for(const row of table.rows){
    if(!plain(row)||!plain(row.cells)||mapped.some(([,col])=>typeof row.cells[col.id]!=='string'||row.cells[col.id].length>1024))return {error:'PUBLIC_TABLE_CELL_SCHEMA_UNVERIFIED'};
    const values=Object.fromEntries(mapped.map(([key,col])=>[key,row.cells[col.id]]));
    const quantity=numeric(values.quantity),side=table.sideMap[norm(values.side)],orderStatus=role==='positions'?null:table.statusMap[norm(values.status)];
    if(!id(values.symbol,240)||!directions.has(side)||!integer(quantity)||quantity<=0||role!=='positions'&&(!id(values.orderId,128)||!statuses.has(orderStatus)))return {error:'PUBLIC_TABLE_ID_SIDE_QUANTITY_OR_STATUS_UNVERIFIED'};
    const fillPrice=values.fillPrice===undefined?null:numeric(values.fillPrice),filledQuantity=values.filledQuantity===undefined?null:numeric(values.filledQuantity);
    if(fillPrice!==null&&!finite(fillPrice)||filledQuantity!==null&&(!integer(filledQuantity)||filledQuantity<0||filledQuantity>quantity))return {error:'PUBLIC_TABLE_FILL_VALUE_UNVERIFIED'};
    rows.push({...(values.orderId===undefined?{}:{orderId:values.orderId}),symbol:values.symbol,direction:side,quantity,status:orderStatus,fillPrice,filledQuantity,
      rawCells:clone(row.cells),...(row.rowId===undefined?{}:{rowId:row.rowId})});
  }
  if(role!=='positions'&&new Set(rows.map(row=>row.orderId)).size!==rows.length)return {error:'DUPLICATE_PUBLIC_NATIVE_ORDER_IDS'};
  if(table.empty===true&&rows.length)return {error:'PUBLIC_EMPTY_TABLE_CONTRADICTION'};
  const c=table.completeness,r=c?.rowCountProof,p=c?.paginationProof;
  const count=r&&numeric(r.raw),page=p&&numeric(p.pageIndexRaw),pages=p&&numeric(p.pageCountRaw);
  const complete=plain(c)&&c.kind==='PUBLIC_ROWCOUNT_AND_PAGINATION_V1'&&c.scope==='SELECTED_ACCOUNT_ALL_SYMBOLS'
    &&c.filter==='ALL'&&c.filtersVerified===true&&c.virtualized===false&&c.virtualizationVerified===true
    &&integer(c.totalRows)&&c.totalRows>=0&&c.totalRows===rows.length&&c.renderedRows===rows.length&&c.pageIndex===1&&c.pageCount===1&&c.hasNext===false&&c.hasPrevious===false
    &&plain(r)&&text(r.locator,1024)&&typeof r.raw==='string'&&integer(r.headerRows)&&r.headerRows>=0&&r.headerRows<=10&&integer(count)&&count-r.headerRows===c.totalRows
    &&plain(p)&&text(p.locator,1024)&&page===1&&pages===1&&p.nextDisabled===true&&p.previousDisabled===true;
  const workingScopeConsistent=role!=='workingOrders'||rows.every(row=>!terminal.has(row.status));
  return {rows,complete:complete&&workingScopeConsistent,scope:complete&&workingScopeConsistent?'SELECTED_ACCOUNT_ALL_SYMBOLS':'VISIBLE_ROWS_ONLY',
    reasonCodes:[...(!complete?['PUBLIC_ROWCOUNT_PAGINATION_FILTER_OR_VIRTUALIZATION_PROOF_MISSING']:[]),...(!workingScopeConsistent?['WORKING_TABLE_CONTAINS_TERMINAL_ORDER']:[])],
    schemaVerifiedByDecoder:true,nativeSchemaObservedByDecoder:false};
}

export function decodeTradingViewOrderInventory(snapshot,options={}){
  const {expected,now=Date.now(),maxAgeMs=5000}=options;
  const base={kind:'TRADINGVIEW_PUBLIC_ACCOUNT_INVENTORY_V1',definitionVersion:TRADINGVIEW_ORDER_INVENTORY_VERSION,status:'UNKNOWN',evidenceTrust,
    remoteVerificationPerformed:false,executionCapabilityCreated:false,ordersCreated:false,protectionVerified:false,inventoryComplete:false,flatVerified:false,pendingEmptyVerified:false,
    testOnly:snapshot?.testOnly===true||snapshot?.synthetic===true,reasonCodes:[]};
  const fail=code=>({...base,reasonCodes:[code]});
  try{
    const invalid=validateContext(snapshot,expected,{now,maxAgeMs});if(invalid)return fail(invalid);
    const parsed={};
    for(const role of ['positions','workingOrders','orderHistory']){
      if(role==='orderHistory'&&snapshot.tables?.[role]===undefined){parsed[role]=null;continue;}
      const decoded=table(snapshot.tables?.[role],role);if(decoded.error)return fail(role.toUpperCase()+'_'+decoded.error);parsed[role]=decoded;
    }
    const inventoryComplete=parsed.positions.complete&&parsed.workingOrders.complete,flatVerified=parsed.positions.complete&&parsed.positions.rows.length===0,pendingEmptyVerified=parsed.workingOrders.complete&&parsed.workingOrders.rows.length===0;
    const visibleEmpty=parsed.positions.rows.length===0&&parsed.workingOrders.rows.length===0;
    return {...base,status:inventoryComplete?'ACCOUNT_INVENTORY_COMPLETE':visibleEmpty?'VISIBLE_EMPTY_NOT_COMPLETE':'ACCOUNT_VISIBLE_ROWS_OBSERVED',...binding(snapshot),environmentVerified:snapshot.environmentVerified,
      captureId:snapshot.captureId,observedAt:snapshot.observedAt,verificationEpochMs:snapshot.verificationEpochMs,tables:parsed,
      positions:parsed.positions.rows,workingOrders:parsed.workingOrders.rows,orderHistory:parsed.orderHistory?.rows??[],
      observedOrderIds:[...new Set([...parsed.workingOrders.rows,...(parsed.orderHistory?.rows??[])].map(row=>row.orderId))],
      inventoryComplete,visibleEmpty,positionsComplete:parsed.positions.complete,workingOrdersComplete:parsed.workingOrders.complete,
      flatVerified,pendingEmptyVerified,flatAndNoPendingVerified:inventoryComplete&&flatVerified&&pendingEmptyVerified,
      reasonCodes:[...new Set(Object.values(parsed).filter(Boolean).flatMap(t=>t.reasonCodes))]};
  }catch{return fail('PUBLIC_SNAPSHOT_DECODING_FAILED');}
}

export function verifyTradingViewOwnedFill({baseline,snapshot,submission,expected,now=Date.now(),maxAgeMs=5000}={}){
  const base={kind:'TRADINGVIEW_PUBLIC_OWNED_FILL_PROOF_V1',definitionVersion:TRADINGVIEW_ORDER_INVENTORY_VERSION,status:'UNKNOWN',evidenceTrust,
    remoteVerificationPerformed:false,executionCapabilityCreated:false,ordersCreated:null,fillVerified:false,protectionVerified:false,userManaged:true,reasonCodes:[]};
  const fail=code=>({...base,reasonCodes:[code]});
  try{
    if(!plain(expected)||!id(expected.symbol,240)||!directions.has(expected.direction)||!integer(expected.quantity)||expected.quantity<=0||!text(expected.intentKey,4096))return fail('EXACT_USER_MANAGED_EXPECTED_ORDER_REQUIRED');
    const after=decodeTradingViewOrderInventory(snapshot,{expected,now,maxAgeMs});
    if(after.status==='UNKNOWN')return fail(after.reasonCodes[0]);
    // Baseline has to precede submission; its historic age is checked against
    // submission time, not the later current wall clock.
    if(!plain(submission)||submission.kind!=='PUBLIC_NATIVE_ORDER_SUBMISSION_RECEIPT_V1'||submission.submitted!==true||submission.nativeOrderIdObserved!==true||!id(submission.nativeOrderId,128)||submission.intentKey!==expected.intentKey||!sameBinding(submission,expected)
      ||!integer(submission.submittedAt)||!finite(submission.submissionEpochMs)||submission.submissionEpochMs<expected.source.documentTimeOrigin)return fail('EXACT_NATIVE_SUBMISSION_RECEIPT_REQUIRED');
    const before=decodeTradingViewOrderInventory(baseline,{expected,now:submission.submittedAt,maxAgeMs});
    if(before.status==='UNKNOWN'||before.flatAndNoPendingVerified!==true||submission.baselineCaptureId!==before.captureId||before.captureId===after.captureId||before.verificationEpochMs>submission.submissionEpochMs||submission.submissionEpochMs>after.verificationEpochMs||submission.submittedAt>after.observedAt)return fail('COMPLETE_CAUSAL_EMPTY_ACCOUNT_BASELINE_REQUIRED');
    if(before.observedOrderIds.includes(submission.nativeOrderId))return fail('NATIVE_ORDER_ID_PREEXISTED_SUBMISSION');
    const matching=[...after.workingOrders,...after.orderHistory].filter(row=>row.orderId===submission.nativeOrderId);
    if(matching.length!==1)return fail('EXACT_UNIQUE_SUBMITTED_NATIVE_ORDER_REQUIRED');
    const order=matching[0];
    if(order.status!=='FILLED'||order.symbol!==expected.symbol||order.direction!==expected.direction||order.quantity!==expected.quantity||order.filledQuantity!==null&&order.filledQuantity!==expected.quantity||!finite(order.fillPrice))return fail('EXACT_NATIVE_FILLED_ORDER_REQUIRED');
    if(!after.positionsComplete||after.positions.length!==1)return fail('COMPLETE_UNIQUE_FILLED_POSITION_REQUIRED');
    const position=after.positions[0];
    if(position.symbol!==expected.symbol||position.direction!==expected.direction||position.quantity!==expected.quantity||!equal(position.fillPrice,order.fillPrice))return fail('EXACT_MATCHING_FILLED_POSITION_REQUIRED');
    return {...base,status:'OWNED_FILL_VERIFIED',...binding(after),environmentVerified:after.environmentVerified,
      captureId:after.captureId,observedAt:after.observedAt,verificationEpochMs:after.verificationEpochMs,
      intentKey:expected.intentKey,nativeOrderId:submission.nativeOrderId,direction:expected.direction,symbol:expected.symbol,quantity:expected.quantity,entry:order.fillPrice,
      fillVerified:true,ordersCreated:true,baselineFlatVerified:true,nativeOrderIdNewInObservedBaseline:true,
      attributionScope:'SUPPLIED_NATIVE_ORDER_RECEIPT_AND_CAUSAL_BASELINE_CONSISTENCY',testOnly:before.testOnly||after.testOnly||submission.testOnly===true,
      order,position,reasonCodes:[]};
  }catch{return fail('PUBLIC_OWNED_FILL_DECODING_FAILED');}
}

export function verifyTradingViewOwnedClose({ownedFill,firstSnapshot,secondSnapshot,expected,now=Date.now(),maxAgeMs=5000,minimumSampleIntervalMs=100}={}){
  const base={kind:'TRADINGVIEW_PUBLIC_OWNED_CLOSE_PROOF_V1',definitionVersion:TRADINGVIEW_ORDER_INVENTORY_VERSION,status:'UNKNOWN',evidenceTrust,
    remoteVerificationPerformed:false,executionCapabilityCreated:false,ordersCreated:false,closedVerified:false,exitFillVerified:false,realizedPnlVerified:false,protectionVerified:false,userManaged:true,reasonCodes:[]};
  const fail=code=>({...base,reasonCodes:[code]});
  try{
    if(!plain(ownedFill)||ownedFill.kind!=='TRADINGVIEW_PUBLIC_OWNED_FILL_PROOF_V1'||ownedFill.status!=='OWNED_FILL_VERIFIED'||ownedFill.fillVerified!==true||!sameBinding(ownedFill,expected)
      ||ownedFill.intentKey!==expected.intentKey||ownedFill.symbol!==expected.symbol||ownedFill.direction!==expected.direction||ownedFill.quantity!==expected.quantity||!id(ownedFill.nativeOrderId,128)||!finite(ownedFill.verificationEpochMs)||ownedFill.verificationEpochMs<expected.source?.documentTimeOrigin||!integer(minimumSampleIntervalMs)||minimumSampleIntervalMs<1||minimumSampleIntervalMs>5000)return fail('BOUND_OWNED_FILL_PROOF_REQUIRED');
    const first=decodeTradingViewOrderInventory(firstSnapshot,{expected,now,maxAgeMs}),second=decodeTradingViewOrderInventory(secondSnapshot,{expected,now,maxAgeMs});
    if(first.status==='UNKNOWN'||second.status==='UNKNOWN'||first.flatAndNoPendingVerified!==true||second.flatAndNoPendingVerified!==true)return fail('TWO_COMPLETE_FLAT_ACCOUNT_SAMPLES_REQUIRED');
    if(first.captureId===second.captureId||first.captureId===ownedFill.captureId||second.captureId===ownedFill.captureId||first.verificationEpochMs<=ownedFill.verificationEpochMs||second.verificationEpochMs-first.verificationEpochMs<minimumSampleIntervalMs||second.observedAt<first.observedAt)return fail('DISTINCT_CAUSAL_FLAT_SAMPLES_REQUIRED');
    return {...base,status:'OWNED_FILL_ACCOUNT_FLAT_VERIFIED',...binding(second),environmentVerified:second.environmentVerified,
      intentKey:ownedFill.intentKey,nativeOrderId:ownedFill.nativeOrderId,closedVerified:true,
      firstCaptureId:first.captureId,secondCaptureId:second.captureId,firstVerificationEpochMs:first.verificationEpochMs,verificationEpochMs:second.verificationEpochMs,
      observedAt:second.observedAt,testOnly:ownedFill.testOnly||first.testOnly||second.testOnly,
      scope:'TWO_COMPLETE_ACCOUNT_FLAT_SAMPLES_AFTER_OWN_FILL_NOT_EXIT_EXECUTION_REPORT',reasonCodes:[]};
  }catch{return fail('PUBLIC_OWNED_CLOSE_DECODING_FAILED');}
}
