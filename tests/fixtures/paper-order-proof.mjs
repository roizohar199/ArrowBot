// Exact LONG order rows transcribed from the actual manual Paper mechanical
// test. Account binding/time are synthetic unit-test context, not live proof.
import {planGuideRisk} from '../../guide-risk.mjs';
export function makePaperOrderProofFixture(){
  const headers=[['symbol','Symbol'],['side','Side'],['type','Type'],['qty','Quantity'],['limitPrice','Limit price'],['stopPrice','Stop price'],['avgPrice','Fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['instruction','Instruction'],['status','Status'],['placingTime','Placing time'],['id','Order ID'],['exitLevelId','Level ID'],['expiry','Expiry'],['leverage','Leverage'],['usedMargin','Margin'],['settings','']].map(([id,text])=>({id,text}));
  const rows=[
    ['CME_MINI:NQZ2026','Buy','Limit','1','27,958.00','','','27,976.50','27,948.75','','working','2026-11-15 06:48:22','3806121023','','2026-11-22 06:48:21','50x','11,183.20 USD','Modify Order… Cancel'],
    ['CME_MINI:NQZ2026','Sell','Stop Loss','1','','27,948.75','','','','','inactive','2026-11-15 06:48:22','3806121024','','2027-01-22 06:48:21','','','Modify Order… Cancel'],
    ['CME_MINI:NQZ2026','Sell','Take Profit','1','27,976.50','','','','','','inactive','2026-11-15 06:48:22','3806121025','','2027-01-22 06:48:21','','','Modify Order… Cancel'],
  ].map(values=>({rowId:values[12],cells:Object.fromEntries(headers.map((h,i)=>[h.id,values[i]]))}));
  const now=Date.UTC(2026,10,15,4,48,25),accountKey='paper-ui:component-fixture-account';
  return {now,intent:{accountKey,expectedSymbol:'NQZ2026',direction:'LONG',quantity:1,entry:27958,stop:27948.75,target:27976.5,key:'MECHANICAL_COMPONENT_RECORD_NOT_SIGNAL',signalApproved:false,testOnly:true},evidence:{status:'PAPER_UI_VERIFIED',provider:'TRADINGVIEW_PAPER',accountKey,observedAt:now,tables:{positions:{headers:[],rows:[],empty:true},orders:{headers,rows,empty:false}}},scope:'OBSERVED_MANUAL_MECHANICAL_ORDER_ROWS_WITH_SYNTHETIC_TEST_BINDING'};
}

// NO FILLED POSITION WAS OBSERVED. These values are a synthetic component
// contract using only the column ids/text actually read from the empty table.
export function makeSyntheticFilledPaperProofFixture({direction='LONG',actualEntry=27958}={}){
  const f=makePaperOrderProofFixture(),entry=27958,stop=entry+(direction==='LONG'?-1:1)*9.25,target=entry+(direction==='LONG'?1:-1)*18.5,fmt=x=>x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const positionHeaders=[['symbol','Symbol'],['side','Side'],['qty','Quantity'],['avgPrice','Avg fill price'],['takeProfit','Take profit'],['stopLoss','Stop loss'],['lastPrice','Last price'],['pl','Unrealized PnL'],['plPercent','Unrealized PnL %'],['tradeValue','Trade value'],['marketValue','Market value'],['leverage','Leverage'],['usedMargin','Margin'],['expirationDate','Expiration date'],['settings','']].map(([id,text])=>({id,text}));
  Object.assign(f.intent,{direction,stop,target,riskPlan:planGuideRisk({direction,entry,stop,target,tickSize:.25,pointValue:20,riskBudget:200,maxContracts:1,commissionPerContract:3.1,slippageTicks:2,rewardRisk:2})});
  const [parent,sl,tp]=f.evidence.tables.orders.rows.map(r=>r.cells),side=direction==='LONG'?'Buy':'Sell',exit=side==='Buy'?'Sell':'Buy';
  Object.assign(parent,{side,status:'filled',avgPrice:fmt(actualEntry),takeProfit:fmt(target),stopLoss:fmt(stop)});
  Object.assign(sl,{side:exit,status:'working',stopPrice:fmt(stop)});Object.assign(tp,{side:exit,status:'working',limitPrice:fmt(target)});
  f.evidence.tables.positions={headers:positionHeaders,empty:false,rows:[{cells:{...Object.fromEntries(positionHeaders.map(h=>[h.id,''])),symbol:'CME_MINI:NQZ2026',side:direction==='LONG'?'Long':'Short',qty:'1',avgPrice:fmt(actualEntry),takeProfit:fmt(target),stopLoss:fmt(stop)}}]};
  f.scope='SYNTHETIC_FILLED_POSITION_ROWS_USING_OBSERVED_EMPTY_POSITION_HEADER_SCHEMA_NOT_ACTUAL_FILL';
  return f;
}
