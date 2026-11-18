// Pure observation of the recorded public TradingView Paper order-table schema.
// A registered inactive bracket is not active position protection or a fill.
import {planGuideRisk} from './guide-risk.mjs';
export const PAPER_ORDER_PROOF_VERSION='paper-public-order-table-proof-2';
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
const finite=Number.isFinite,same=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-8;
const labels={symbol:'Symbol',side:'Side',type:'Type',qty:'Quantity',limitPrice:'Limit price',stopPrice:'Stop price',avgPrice:'Fill price',takeProfit:'Take profit',stopLoss:'Stop loss',status:'Status',placingTime:'Placing time',id:'Order ID'};
const knownStatus=new Set(['working','inactive','filled','cancelled','canceled','rejected']);
const terminal=new Set(['filled','cancelled','canceled','rejected']);
const number=value=>{
  const s=norm(value);if(!s)return null;
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)?Number(s.replace(/,/g,'')):NaN;
};
function tableRows(table){
  if(!plain(table)||!Array.isArray(table.headers)||!Array.isArray(table.rows)||table.rows.length>10000)return {error:'PAPER_TYPED_ORDER_TABLE_REQUIRED'};
  const ids=table.headers.map(h=>h?.id);
  if(new Set(ids).size!==ids.length||Object.entries(labels).some(([id,text])=>table.headers.filter(h=>h?.id===id&&norm(h.text)===text).length!==1))return {error:'PAPER_ORDER_HEADER_SCHEMA_UNVERIFIED'};
  const rows=[];
  for(const row of table.rows){
    if(!plain(row)||!plain(row.cells)||Object.keys(labels).some(k=>!Object.hasOwn(row.cells,k)||typeof row.cells[k]!=='string'||row.cells[k].length>1024))return {error:'PAPER_ORDER_CELL_SCHEMA_UNVERIFIED'};
    const c=Object.fromEntries(Object.keys(labels).map(k=>[k,norm(row.cells[k])]));
    if(!/^\d{1,20}$/.test(c.id)||c.id==='0'||row.rowId!==undefined&&norm(row.rowId)!==c.id||!knownStatus.has(c.status.toLowerCase()))return {error:'PAPER_ORDER_ID_OR_STATUS_UNVERIFIED'};
    rows.push({...c,status:c.status.toLowerCase(),quantity:number(c.qty),limit:number(c.limitPrice),stop:number(c.stopPrice),fill:number(c.avgPrice),target:number(c.takeProfit),parentStop:number(c.stopLoss)});
  }
  if(new Set(rows.map(r=>r.id)).size!==rows.length)return {error:'PAPER_DUPLICATE_ORDER_IDS'};
  if(table.empty===true&&rows.length)return {error:'PAPER_EMPTY_ORDER_TABLE_CONTRADICTION'};
  return {rows};
}
function positionRow(table){
  if(!plain(table)||!Array.isArray(table.rows))return {error:'PAPER_POSITION_TABLE_REQUIRED'};
  if(table.empty===true&&table.rows.length===0)return {empty:true,row:null};
  const required={symbol:'Symbol',side:'Side',qty:'Quantity',avgPrice:'Avg fill price',takeProfit:'Take profit',stopLoss:'Stop loss'};
  if(table.empty!==false||table.rows.length!==1||!Array.isArray(table.headers)||new Set(table.headers.map(h=>h?.id)).size!==table.headers.length||Object.entries(required).some(([id,text])=>table.headers.filter(h=>h?.id===id&&norm(h.text)===text).length!==1))return {error:'PAPER_FILLED_POSITION_SCHEMA_UNVERIFIED'};
  const cells=table.rows[0]?.cells;
  if(!plain(cells)||Object.keys(required).some(k=>typeof cells[k]!=='string'||cells[k].length>1024))return {error:'PAPER_FILLED_POSITION_SCHEMA_UNVERIFIED'};
  const row=Object.fromEntries(Object.keys(required).map(k=>[k,norm(cells[k])]));
  return {empty:false,row:{...row,quantity:number(row.qty),fill:number(row.avgPrice),stop:number(row.stopLoss),target:number(row.takeProfit)}};
}
const placing=value=>{
  const m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);if(!m)return false;
  const parts=m.slice(1).map(Number),d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]));
  return [d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds()].every((v,i)=>v===parts[i]);
};
const onTick=value=>finite(value)&&value>0&&Number.isSafeInteger(value/.25);

/** WORKING proves an exact parent order and registered inactive bracket rows.
 * FILLED_PROTECTED additionally requires the observed typed Positions header
 * schema, one exact filled position, matching filled parent and active exits.
 * Actual filled rows have not been recorded; positive filled tests are clearly
 * labeled synthetic component contracts based on the observed empty schema.
 */
export function verifyPaperOrderTableProof(intent,evidence,{now=Date.now(),maxEvidenceAgeMs=5000,baselineOrderIds}={}){
  const base={definitionVersion:PAPER_ORDER_PROOF_VERSION,status:'UNKNOWN',provider:'TRADINGVIEW_PAPER',accountKey:evidence?.accountKey??null,quantity:null,entryVerified:false,stopVerified:false,targetVerified:false,fillVerified:false,positionStateVerified:false,stopActive:false,targetActive:false,protectionState:'UNVERIFIED',ordersCreated:null,realBrokerOrdersAuthorized:false,reasonCodes:[]};
  const fail=reason=>({...base,reasonCodes:[reason]});
  if(!plain(intent)||intent.quantity!==1||!['LONG','SHORT'].includes(intent.direction)||!/^NQ[HMUZ]20\d\d$/.test(intent.expectedSymbol)||![intent.entry,intent.stop,intent.target].every(p=>finite(p)&&Number.isSafeInteger(p/.25))||typeof intent.accountKey!=='string'||!intent.accountKey)return fail('PAPER_EXACT_EXPECTED_ORDER_REQUIRED');
  if(intent.direction==='LONG'?(intent.stop>=intent.entry||intent.target<=intent.entry):(intent.stop<=intent.entry||intent.target>=intent.entry))return fail('PAPER_PROTECTIVE_PRICE_SIDES_REQUIRED');
  if(!plain(evidence)||evidence.status!=='PAPER_UI_VERIFIED'||evidence.provider!=='TRADINGVIEW_PAPER'||evidence.accountKey!==intent.accountKey||!finite(now)||!finite(evidence.observedAt)||!finite(maxEvidenceAgeMs)||maxEvidenceAgeMs<=0||maxEvidenceAgeMs>15000||evidence.observedAt>now||now-evidence.observedAt>maxEvidenceAgeMs)return fail('PAPER_BOUND_FRESH_ACCOUNT_EVIDENCE_REQUIRED');
  const baseline=baselineOrderIds!==undefined?baselineOrderIds:evidence.baselineOrderIds;
  const validBaseline=value=>Array.isArray(value)&&value.length<=10000&&value.every(id=>/^\d{1,20}$/.test(String(id))&&String(id)!=='0')&&new Set(value.map(String)).size===value.length;
  if(baselineOrderIds!==undefined&&!validBaseline(baselineOrderIds)||evidence.baselineOrderIds!==undefined&&!validBaseline(evidence.baselineOrderIds))return fail('PAPER_BASELINE_ORDER_IDS_UNVERIFIED');
  if(baselineOrderIds!==undefined&&evidence.baselineOrderIds!==undefined&&JSON.stringify(baselineOrderIds.map(String).sort())!==JSON.stringify(evidence.baselineOrderIds.map(String).sort()))return fail('PAPER_BASELINE_ORDER_IDS_UNVERIFIED');
  const parsed=tableRows(evidence.tables?.orders);if(parsed.error)return fail(parsed.error);
  const all=parsed.rows,active=all.filter(r=>!terminal.has(r.status));
  const positions=evidence.tables?.positions;
  const position=positionRow(positions);if(position.error)return fail(position.error);
  const symbol='CME_MINI:'+intent.expectedSymbol,side=intent.direction==='LONG'?'Buy':'Sell',exitSide=side==='Buy'?'Sell':'Buy';
  const filled=!position.empty;
  if(filled){
    const row=position.row,validSides=intent.direction==='LONG'?['Buy','Long']:['Sell','Short'];
    if(row.symbol!==symbol||!validSides.includes(row.side)||row.quantity!==1||!onTick(row.fill)||!same(row.stop,intent.stop)||!same(row.target,intent.target))return fail('PAPER_EXACT_FILLED_POSITION_REQUIRED');
  }
  const matchingParents=(filled?all:active).filter(r=>r.symbol===symbol&&r.side===side&&r.type==='Limit'&&r.quantity===1&&same(r.limit,intent.entry)&&r.status===(filled?'filled':'working'));
  const parentCandidates=matchingParents.filter(r=>!baseline?.some(id=>String(id)===r.id));
  if(!parentCandidates.length&&matchingParents.some(r=>baseline?.some(id=>String(id)===r.id)))return fail('PAPER_PARENT_PREEXISTED_SUBMISSION');
  if(parentCandidates.length!==1)return fail(all.some(r=>r.symbol===symbol&&r.side===side&&r.type==='Limit'&&r.status==='filled')?'PAPER_FILLED_POSITION_SCHEMA_UNVERIFIED':'PAPER_UNIQUE_WORKING_PARENT_REQUIRED');
  const parent=parentCandidates[0];
  const parentPricesMatch=filled
    ?onTick(parent.fill)&&same(parent.fill,position.row.fill)&&(parent.target===null||same(parent.target,intent.target))&&(parent.parentStop===null||same(parent.parentStop,intent.stop))
    :parent.fill===null&&same(parent.target,intent.target)&&same(parent.parentStop,intent.stop);
  if(parent.stop!==null||!placing(parent.placingTime)||!parentPricesMatch)return fail('PAPER_PARENT_BRACKET_FIELDS_MISMATCH');
  if(filled&&(intent.direction==='LONG'?parent.fill>intent.entry:parent.fill<intent.entry))return fail('PAPER_FILL_EXCEEDS_PARENT_LIMIT_BOUND');
  if(evidence.parentOrderId!==undefined&&String(evidence.parentOrderId)!==parent.id)return fail('PAPER_PARENT_ORDER_ID_MISMATCH');
  if(baseline?.some(id=>String(id)===parent.id))return fail('PAPER_PARENT_PREEXISTED_SUBMISSION');
  const group=active.filter(r=>r.symbol===symbol&&r.side===exitSide&&r.quantity===1&&placing(r.placingTime)&&(filled?r.placingTime>=parent.placingTime:r.placingTime===parent.placingTime));
  const stops=group.filter(r=>r.type==='Stop Loss'&&r.status===(filled?'working':'inactive')&&same(r.stop,intent.stop)&&r.limit===null&&r.fill===null);
  const targets=group.filter(r=>r.type==='Take Profit'&&r.status===(filled?'working':'inactive')&&same(r.limit,intent.target)&&r.stop===null&&r.fill===null);
  if(stops.length!==1||targets.length!==1)return fail('PAPER_UNIQUE_REGISTERED_BRACKETS_REQUIRED');
  if(stops[0].placingTime!==targets[0].placingTime)return fail('PAPER_BRACKET_PLACING_TIME_AMBIGUOUS');
  const ids=[parent.id,stops[0].id,targets[0].id];
  if(new Set(ids).size!==3||active.length!==(filled?2:3)||active.some(r=>!ids.includes(r.id)))return fail('PAPER_UNEXPECTED_ADDITIONAL_ACTIVE_ORDER');
  if(baseline?.some(id=>ids.includes(String(id))))return fail('PAPER_BRACKETS_PREEXISTED_SUBMISSION');
  let riskAtFill=null;
  if(filled){
    const plan=intent.riskPlan,p=plan?.parameterSnapshot;
    if(plan?.status!=='PLANNED'||plan?.quantity!==1||!plain(p)||p.tickSize!==.25||p.pointValue!==20||p.maxContracts!==1||!finite(p.riskBudget)||p.riskBudget<=0||p.riskBudget>200||!finite(p.commissionPerContract)||p.commissionPerContract<0||!finite(p.slippageTicks)||p.slippageTicks<0||!finite(p.rewardRisk)||p.rewardRisk<=0||plan.initialStop!==intent.stop||plan.plannedEntry!==intent.entry||plan.target!==intent.target)return fail('PAPER_ACTUAL_FILL_RISK_PARAMETERS_REQUIRED');
    riskAtFill=planGuideRisk({direction:intent.direction,entry:intent.entry,actualEntry:parent.fill,stop:intent.stop,target:intent.target,tickSize:.25,pointValue:20,riskBudget:p.riskBudget,maxContracts:1,commissionPerContract:p.commissionPerContract,slippageTicks:p.slippageTicks,rewardRisk:p.rewardRisk,stopBufferTicks:0});
    if(riskAtFill.status!=='PLANNED'||riskAtFill.quantity!==1||riskAtFill.totalPlannedRisk>200||riskAtFill.initialStop!==intent.stop)return fail('PAPER_ACTUAL_FILL_RISK_EXCEEDS_200_USD');
  }
  return {...base,status:filled?'FILLED_PROTECTED':'WORKING',quantity:1,entryVerified:true,stopVerified:true,targetVerified:true,entryOrderStatus:filled?'filled':'working',ordersCreated:true,
    parentOrderId:parent.id,stopOrderId:stops[0].id,targetOrderId:targets[0].id,placingTime:parent.placingTime,
    positionStateVerified:true,fillVerified:filled,stopActive:filled,targetActive:filled,protectionState:filled?'ACTIVE_FILLED_POSITION':'PENDING_PARENT_FILL',
    ...(filled?{actualEntry:parent.fill,riskAtFill,riskScope:'ACTUAL_ENTRY_PLUS_STOP_DISTANCE_AND_CONFIGURED_COST_ALLOWANCES_NOT_REALIZED_LOSS_GUARANTEE'}:{}),
    registeredPrices:{entry:parent.limit,stop:stops[0].stop,target:targets[0].limit},
    linkageBasis:filled?'UNIQUE_POSITION_FILLED_PARENT_PRICES_AND_CAUSALLY_PLACED_WORKING_EXITS':'UNIQUE_SYMBOL_SIDE_QUANTITY_PARENT_BRACKET_PRICES_AND_EXACT_PLACING_TIME',serverParentLinkProven:false,
    scope:filled?'PUBLIC_TYPED_UI_POSITION_FILLED_PARENT_AND_WORKING_EXIT_PROOF':'PUBLIC_UI_WORKING_PARENT_AND_REGISTERED_INACTIVE_BRACKETS_ONLY',reasonCodes:[]};
}
