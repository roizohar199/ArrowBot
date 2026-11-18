import {formatFillMarkerPayload} from '../fill-marker-payload.mjs';
import {formatEntryMarkerPayload} from '../entry-marker-payload.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {nativeCandleMarkerUiCommand} from '../candle-marker-ui.mjs';
import {buildApprovedCandleMarkerPayload,candleMarkerPayloadSignature,CANDLE_MARKER_NATIVE_FIELDS,formatLiveDirectionMarkerPayload} from '../candle-marker-payload.mjs';
import {makePaperExecutionFixture} from './fixtures/paper-execution.mjs';
import {GUIDE_SIGNAL_VERSION} from '../guide-signal-engine.mjs';
function payloadFixture({empty=false}={}){
  const f=makePaperExecutionFixture(),metadata={...f.state.metadata,replay:true,realtime:false,synthetic:false};
  Object.assign(f.analysis,{definitionVersion:GUIDE_SIGNAL_VERSION,sourceKind:'original_research_definition',metadata,parameterSnapshot:structuredClone(f.alert.signal.parameterSnapshot),status:'SIGNALS'});
  if(empty){f.analysis.signals=[];f.analysis.events=[];}
  return buildApprovedCandleMarkerPayload({analysis:f.analysis,bars:f.state.bars,metadata,sourceMode:'REPLAY'});
}
function native(payload){const last=payload.records.at(-1);return {ARROW_MARKER_SCHEMA:payload.approvalKind==='TECHNICAL'?payload.schemaVersion:1,ARROW_MARKER_SIGNATURE:payload.payloadSignature,ARROW_MARKER_EXPECTED_COUNT:payload.records.length,ARROW_MARKER_MATCHED_COUNT:payload.records.length,ARROW_MARKER_DRAWN_COUNT:payload.records.length,ARROW_MARKER_MODE:payload.sourceMode==='LIVE'?1:2,ARROW_MARKER_LAST_TIME:payload.schemaVersion===5&&last?.entryFilled?last.fillTime:last?.time??0,ARROW_MARKER_LAST_PRICE_TICKS:payload.schemaVersion===5&&last?.entryFilled?last.fillPriceTicks:last?.priceTicks??0,ARROW_MARKER_LAST_DIRECTION:last?.directionCode??0,ARROW_MARKER_CUTOFF:payload.asOfTime,ARROW_MARKER_CONTEXT_VALID:1};}
class Node{
  constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.innerText=text;this.children=[];this.parentElement=null;this.queries=new Map();this.disabled=false;this.readOnly=false;this.actions=[];}
  getAttribute(key){return this.attrs[key]??null;}getBoundingClientRect(){return {width:100,height:20,top:0,left:0,right:100,bottom:20};}
  querySelectorAll(selector){return this.queries.get(selector)??[];}closest(){return this.toolbar??null;}click(){this.actions.push('click');this.onClick?.();}
  dispatchEvent(event){this.actions.push(event.type);this.onDispatch?.(event);return true;}
}
class Textarea extends Node{get value(){return this.stored??'';}set value(value){this.stored=value;this.actions.push('set');}}
function uiFixture(payload){
  const markerTitle='Arrow Approved Candle Markers',rowSelector='[role="treegrid"] [role="row"][data-role="menuitem"],[role="treegrid"] > div[role="row"]';
  const layout=new Node({'aria-label':'Logged in as test Active layout: Arrow OHLC Live Verification'}),canvas=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),interval=new Node({'data-value':'1'}),replay=new Node({'aria-pressed':'true'});
  const markerHeader=new Node({title:markerTitle}),sourceHeader=new Node({title:'Arrow OHLC Window v2'}),markerStudy=new Node(),sourceStudy=new Node(),toolbar=new Node(),settings=new Node({'aria-label':'Settings'}),legendTitle=new Node({title:markerTitle},markerTitle),dialog=new Node({'role':'dialog','aria-label':markerTitle},markerTitle),area=new Textarea({'aria-label':'Approved marker payload'}),ok=new Node({},'Ok'),inputs=new Node({'aria-selected':'true'},'Inputs');
  settings.toolbar=toolbar;legendTitle.toolbar=toolbar;toolbar.queries.set('button,[role="button"],[role="tab"]',[settings]);toolbar.queries.set('[title],[aria-label],span,div',[legendTitle]);
  markerStudy.queries.set('span[title]',[markerHeader]);sourceStudy.queries.set('span[title]',[sourceHeader]);
  const markerValues=new Map(),sourceValues=new Map();
  function plots(values,storage){return Object.entries(values).map(([name,value])=>{const label=new Node({'data-test-id-value-title':name},name),number=new Node({},String(value)),parent=new Node();parent.children=[label,number];label.parentElement=parent;number.parentElement=parent;storage.set(name,number);return label;});}
  markerStudy.queries.set('[data-test-id-value-title]',plots(native(payload),markerValues));
  sourceStudy.queries.set('[data-test-id-value-title]',plots({ARROW2_RUN_EPOCH:1794696402010,ARROW2_CHECKSUM_A:777},sourceValues));
  dialog.queries.set('textarea',[area]);dialog.queries.set('button,[role="button"],[role="tab"]',[inputs,ok]);dialog.queries.set('button,[role="button"]',[ok]);
  const doc={visibilityState:'visible',hidden:false,dialogs:[],charts:[canvas],toolbars:[toolbar],querySelectorAll(selector){
    if(selector==='[aria-label^="Logged in as"]')return [layout];if(selector==='canvas[aria-label^="Chart for "]')return this.charts;if(selector==='[role="dialog"],[aria-modal="true"]')return this.dialogs;
    if(selector===rowSelector)return [sourceStudy,markerStudy];if(selector==='[title],[aria-label]')return [legendTitle];if(selector==='[role="toolbar"]')return this.toolbars;return [];
  },querySelector(selector){return selector.startsWith('#header-toolbar-intervals')?interval:selector==='#header-toolbar-replay'?replay:null;},getElementById(){return null;}};
  settings.onDispatch=event=>{if(event.type==='mousedown')doc.dialogs=[dialog];};ok.onClick=()=>{doc.dialogs=[];for(const [name,value] of Object.entries(native(payload)))markerValues.get(name).textContent=String(value);};
  const origin=Date.now()-1000,sandbox=vm.createContext({document:doc,location:{origin:'https://www.tradingview.com',protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/Research123/'},performance:{timeOrigin:origin,now:()=>Date.now()-origin},getComputedStyle:()=>({display:'block',visibility:'visible'}),URL,Date,HTMLTextAreaElement:Textarea,Event:class{constructor(type){this.type=type;}},MouseEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},PointerEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
  const expected={researchUrl:'https://www.tradingview.com/chart/Research123/',instrument:'CME_MINI:NQ1!',timeframe:'1',sourceMode:'REPLAY',runEpoch:1794696402010,fields:{ARROW2_CHECKSUM_A:'777'}};
  return {sandbox,doc,layout,canvas,interval,replay,markerStudy,sourceStudy,settings,dialog,area,ok,legendTitle,toolbar,markerValues,sourceValues,expected,origin,
    async run(command={}){sandbox.command={action:'deliver',expected,payload,...command};return JSON.parse(JSON.stringify(await vm.runInContext('('+nativeCandleMarkerUiCommand.toString()+')(command)',sandbox)));}};
}

function liveUiFixture(){
  const seed=payloadFixture(),record={...seed.records[0],approvalKind:'TECHNICAL',sourceMode:'LIVE',liveApproved:false};for(const k of ['quantity','riskMicros','totalPlannedRisk'])delete record[k];
  const p=formatLiveDirectionMarkerPayload({...seed,kind:'TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD',approvalKind:'TECHNICAL',riskApprovalGranted:false},[record]),f=uiFixture(p);
  f.expected={...f.expected,researchUrl:'https://www.tradingview.com/chart/ARROWFR1/',sourceMode:'LIVE',allowResearchLiveMultiChart:true};delete f.expected.fields;f.sandbox.location.pathname='/chart/ARROWFR1/';f.sandbox.location.href=f.expected.researchUrl;f.layout.attrs['aria-label']='Logged in as test Active layout: Full Screens Live';f.replay.attrs['aria-pressed']='false';f.doc.charts=[new Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];return {f,p};
}

test('LIVE directions update only the owned study on exact FULL SCREENS while source ticks advance',async()=>{
  const {f,p}=liveUiFixture();f.markerValues.get('ARROW_MARKER_SIGNATURE').textContent='17';f.settings.onDispatch=event=>{if(event.type==='mousedown'){f.sourceValues.get('ARROW2_CHECKSUM_A').textContent='888';f.doc.dialogs=[f.dialog];}};
  const r=await f.run({expected:f.expected,payload:p});assert.equal(r.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(r));assert.equal(f.area.value,p.textPayload);assert.equal(f.doc.charts.length,3);assert.equal(f.interval.attrs['data-value'],'1');assert.equal(r.ordersCreated,false);assert.equal(r.fields.ARROW_MARKER_SCHEMA,'3');
});

test('unchanged LIVE marker proof is idempotent and does not open Settings or rewrite inputs',async()=>{
  const {f,p}=liveUiFixture();const r=await f.run({expected:f.expected,payload:p});assert.equal(r.status,'NATIVE_MARKERS_VERIFIED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);
});

test('LIVE marker multi-chart policy never inherits a Replay opt-in or unrelated layout',async()=>{
  for(const edit of [f=>delete f.expected.allowResearchLiveMultiChart,f=>f.layout.attrs['aria-label']='Active layout: Other FULL SCREENS',f=>f.expected.researchUrl+='?different=1']){
    const {f,p}=liveUiFixture();edit(f);assert.equal((await f.run({expected:f.expected,payload:p})).status,'BLOCKED');assert.equal(f.area.actions.length,0);
  }
});

test('serialized marker delivery uses only owned Settings input and verifies exact native field receipt',async()=>{
  const payload=payloadFixture(),f=uiFixture(payload),result=await f.run();
  assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.equal(f.area.value,payload.textPayload);assert.deepEqual(f.area.actions,['set','input','change']);assert.equal(f.settings.actions.at(-1),'mousedown');assert.equal(f.settings.actions.includes('click'),false,'no preceding click-only attempt');assert.equal(result.settingsRequestedEpoch,result.settingsGestureRequestedEpoch,'no fixed wait before the proven gesture');assert.equal(f.ok.actions.length,1);assert.equal(result.fields.ARROW_MARKER_SIGNATURE,String(payload.payloadSignature));assert.ok(result.secondPaintEpoch>=result.firstPaintEpoch);assert.equal(result.physicalDisplayMeasured,false);assert.equal(result.ordersCreated,false);
  assert.equal(result.documentTimeOrigin,f.origin);
});
test('native rendered-text legend fallback selects only one complete marker title with Settings',async()=>{
  const payload=payloadFixture(),f=uiFixture(payload);f.legendTitle.attrs={};f.toolbar.innerText='Arrow Approved Candle Markers (700)';
  const dataWindowToolbar=new Node({},'Arrow Approved Candle Markers Hide data');dataWindowToolbar.queries.set('button,[role="button"],[role="tab"]',[new Node({'aria-label':'Hide data'})]);f.doc.toolbars.push(dataWindowToolbar);
  const result=await f.run();assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.equal(f.settings.actions.at(-1),'mousedown');assert.equal(f.ok.actions.length,1);
  const ambiguous=uiFixture(payload);ambiguous.legendTitle.attrs={};ambiguous.toolbar.innerText='Arrow Approved Candle Markers (700)';const duplicate=new Node({},'Arrow Approved Candle Markers (700)');duplicate.queries.set('button,[role="button"],[role="tab"]',[new Node({'aria-label':'Settings'})]);ambiguous.doc.toolbars.push(duplicate);
  assert.equal((await ambiguous.run()).reasonCodes[0],'NATIVE_MARKER_TOOLBAR_AMBIGUOUS');assert.equal(ambiguous.area.actions.length,0);
  const prefix=uiFixture(payload);prefix.legendTitle.attrs={};prefix.toolbar.innerText='Arrow Approved Candle MarkersImposter';assert.equal((await prefix.run()).reasonCodes[0],'NATIVE_MARKER_SETTINGS_NOT_FOUND');assert.equal(prefix.settings.actions.length,0);
});
test('an owned Settings gesture that does not open a dialog falls back only to the exact owned legend double-click',async()=>{
  const f=uiFixture(payloadFixture());f.settings.onDispatch=()=>{};f.legendTitle.onDispatch=event=>{if(event.type==='dblclick')f.doc.dialogs=[f.dialog];};
  const result=await f.run();assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.deepEqual(f.legendTitle.actions,['pointerover','mouseover','pointerenter','mouseenter','pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click','pointerdown','mousedown','pointerup','mouseup','click','dblclick']);assert.equal(f.area.actions.filter(action=>action==='set').length,1);assert.ok(result.legendDoubleClickRequestedEpoch>=result.settingsRequestedEpoch);assert.deepEqual(result.gestureAttempts.map(attempt=>attempt.kind),['OWNED_SETTINGS_POINTER_MOUSE','OWNED_LEGEND_DOUBLE_POINTER_MOUSE']);assert.ok(result.gestureAttempts.every(attempt=>attempt.synthetic&&attempt.events.every(event=>event.isTrusted===false)));
});
test('Settings native mousedown semantics opens first without a click-only attempt or legend fallback',async()=>{
  const f=uiFixture(payloadFixture());f.settings.onDispatch=event=>{if(event.type==='mousedown'){assert.equal(event.button,0);assert.equal(event.buttons,1);assert.equal(event.clientX,50);assert.equal(event.clientY,10);f.doc.dialogs=[f.dialog];}};
  const result=await f.run();assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.equal(f.legendTitle.actions.length,0);assert.equal(result.gestureAttempts.length,1);assert.equal(result.gestureAttempts[0].opened,true);assert.equal(f.settings.actions.at(-1),'mousedown');
});
test('read-only control inspection is bounded to the owned legend and never dispatches gestures',async()=>{
  const f=uiFixture(payloadFixture()),result=await f.run({action:'inspect',payload:undefined});assert.equal(result.status,'NATIVE_MARKER_CONTROLS_INSPECTED');assert.equal(result.controls.settings.attrs['aria-label'],'Settings');assert.equal(result.controls.legend.text,'Arrow Approved Candle Markers');assert.equal(result.gestureAttempts.length,0);assert.equal(f.settings.actions.length,0);assert.equal(f.legendTitle.actions.length,0);assert.equal(f.area.actions.length,0);
});
test('a source change or disconnected control during the gesture prevents all marker input',async()=>{
  for(const edit of [f=>{f.sourceValues.get('ARROW2_RUN_EPOCH').textContent='1794696402011';},f=>{f.settings.isConnected=false;}]){
    const f=uiFixture(payloadFixture());f.settings.onClick=()=>{};f.settings.onDispatch=event=>{if(event.type==='mousedown')edit(f);};const result=await f.run();assert.equal(result.status,'BLOCKED');assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);assert.equal(f.legendTitle.actions.length,0);
  }
});
test('delivery can resume an already-open exact owned dialog, while checking source identity before its input',async()=>{
  const f=uiFixture(payloadFixture());f.doc.dialogs=[f.dialog];const result=await f.run();assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.equal(f.settings.actions.length,0);assert.equal(f.legendTitle.actions.length,0);assert.equal(f.ok.actions.length,1);assert.ok(Number.isFinite(result.settingsResumedEpoch));
  const changed=uiFixture(payloadFixture());changed.doc.dialogs=[changed.dialog];changed.expected.runEpoch++;assert.equal((await changed.run()).status,'BLOCKED');assert.equal(changed.area.actions.length,0);assert.equal(changed.ok.actions.length,0);
});
test('strict empty payload clears native count without inventing a positive signal',async()=>{
  const payload=payloadFixture({empty:true}),f=uiFixture(payload),result=await f.run();assert.equal(result.status,'NATIVE_EMPTY_MARKERS_VERIFIED');assert.equal(result.fields.ARROW_MARKER_DRAWN_COUNT,'0');assert.equal(payload.records.length,0);
});
test('marker read alone never opens a Settings dialog or mutates a textarea',async()=>{
  const payload=payloadFixture(),f=uiFixture(payload);assert.equal((await f.run({action:'read',payload:undefined})).status,'NATIVE_MARKER_FIELDS_READ');assert.equal((await f.run({action:'read'})).status,'NATIVE_MARKERS_VERIFIED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);
});
test('original layouts, multiple charts, mismatched timeframe/mode/symbol and hidden documents block all mutations',async()=>{
  for(const edit of [f=>{f.layout.attrs['aria-label']='Logged in as test Active layout: Full Screens Live';},f=>{f.doc.charts.push(new Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}));},f=>{f.interval.attrs['data-value']='5';},f=>{f.replay.attrs['aria-pressed']='false';},f=>{f.canvas.attrs['aria-label']='Chart for CME_MINI:MNQ1!, 1 minute';},f=>{f.doc.hidden=true;}]){
    const f=uiFixture(payloadFixture());edit(f);assert.equal((await f.run()).status,'BLOCKED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);
  }
});
test('unrelated dialogs and forged TEST/text records never reach the marker input',async()=>{
  for(const edit of [f=>{f.doc.dialogs=[new Node({'role':'dialog','aria-label':'Unrelated settings'},'Other')];},f=>{f.expected.runEpoch++;}]){const f=uiFixture(payloadFixture());edit(f);assert.equal((await f.run()).status,'BLOCKED');assert.equal(f.settings.actions.length,0);}
  for(const edit of [p=>{p.testOnly=true;},p=>{p.payloadSignature++;},p=>{p.textPayload+='0';},p=>{p.records[0].quantity=2;}]){const p=payloadFixture();edit(p);const f=uiFixture(p);assert.equal((await f.run()).status,'BLOCKED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);}
});
test('a source run change while the owned dialog opens prevents setting or applying any marker text',async()=>{
  const f=uiFixture(payloadFixture());f.settings.onDispatch=event=>{if(event.type==='mousedown'){f.doc.dialogs=[f.dialog];f.sourceValues.get('ARROW2_RUN_EPOCH').textContent='1794696402011';}};const result=await f.run();assert.equal(result.status,'BLOCKED');assert.deepEqual(result.reasonCodes,['MARKER_SOURCE_WITNESS_CHANGED']);assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);
});
test('wrong or ambiguous input labels cannot update another setting, and stale native proof is not accepted',async()=>{
  const f=uiFixture(payloadFixture());f.area.attrs['aria-label']='Other payload';const result=await f.run();assert.equal(result.status,'BLOCKED');assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);
  const fresh=uiFixture(payloadFixture());fresh.markerValues.get(CANDLE_MARKER_NATIVE_FIELDS[1]).textContent='0';assert.equal((await fresh.run({action:'read'})).status,'BLOCKED');assert.equal(fresh.settings.actions.length,0);
});

function technicalPayloadFixture({empty=false}={}){
  // Serialized driver contract only, not an engine or native market proof.
  const p=payloadFixture({empty});p.kind='TECHNICAL_NATIVE_CANDLE_MARKER_PAYLOAD';p.approvalKind='TECHNICAL';p.schemaVersion=2;p.riskApprovalGranted=false;
  p.records=p.records.map(record=>{const copy={...record,approvalKind:'TECHNICAL'};for(const key of ['riskMicros','totalPlannedRisk','quantity'])delete copy[key];return copy;});
  p.textPayload=[['ARROW_TECHNICAL_MARKERS_V1',p.instrument,'1',p.sourceMode,p.asOfTime].join('|'),...p.records.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.priceTicks].join('|'))].join('\n');
  p.payloadSignature=candleMarkerPayloadSignature(p.textPayload);return p;
}

test('SHORT native Data Window leading Unicode minus verifies without rewriting the payload or inventing a marker',async()=>{
  // Isolated serialized-DOM regression for TradingView's actual signed format.
  const payload=technicalPayloadFixture();for(const record of payload.records){record.direction='SHORT';record.directionCode=-1;}
  payload.textPayload=[['ARROW_TECHNICAL_MARKERS_V1',payload.instrument,'1',payload.sourceMode,payload.asOfTime].join('|'),...payload.records.map(r=>[r.markerId,r.time,r.closeTime,r.openTicks,r.highTicks,r.lowTicks,r.closeTicks,r.directionCode,r.priceTicks].join('|'))].join('\n');
  payload.payloadSignature=candleMarkerPayloadSignature(payload.textPayload);
  for(const action of ['read','deliver']){
    const f=uiFixture(payload);f.markerValues.get('ARROW_MARKER_LAST_DIRECTION').textContent='\u22121';
    const apply=f.ok.onClick;f.ok.onClick=()=>{apply();f.markerValues.get('ARROW_MARKER_LAST_DIRECTION').textContent='\u22121';};
    const result=await f.run({action});assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));
    assert.equal(result.fields.ARROW_MARKER_LAST_DIRECTION,'\u22121');assert.equal(payload.records.at(-1).directionCode,-1);assert.equal(result.ordersCreated,false);
    assert.equal(f.settings.actions.length>0,action==='deliver');
  }
});

test('native marker numeric proof rejects missing-value dashes and embedded or repeated minus signs',async()=>{
  for(const text of ['—','–','\u2212','1\u2212','\u2212\u22121','-\u22121']){
    const f=uiFixture(technicalPayloadFixture());f.markerValues.get('ARROW_MARKER_LAST_DIRECTION').textContent=text;
    const result=await f.run({action:'read'});assert.equal(result.status,'BLOCKED',text);assert.deepEqual(result.reasonCodes,['NATIVE_MARKER_PROOF_MISMATCH']);assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);
  }
});

test('serialized technical delivery uses nine columns and requires actual schema2 native reflection',async()=>{
  for(const empty of [false,true]){
    const payload=technicalPayloadFixture({empty}),f=uiFixture(payload),result=await f.run();
    assert.equal(result.status,empty?'NATIVE_EMPTY_MARKERS_VERIFIED':'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));
    assert.equal(result.fields.ARROW_MARKER_SCHEMA,'2');assert.equal(f.area.value,payload.textPayload);assert.equal(result.ordersCreated,false);assert.equal(result.orderEligible,false);
    const old=uiFixture(payload);old.markerValues.get('ARROW_MARKER_SCHEMA').textContent='1';const stale=await old.run({action:'read'});assert.equal(stale.status,'BLOCKED');assert.deepEqual(stale.reasonCodes,['NATIVE_MARKER_PROOF_MISMATCH']);assert.equal(old.settings.actions.length,0);
  }
});

test('technical driver cannot mix risk fields, strict schema, TEST claims or extra wire columns into a direction-only payload',async()=>{
  for(const edit of [p=>{p.records[0].quantity=1;},p=>{p.records[0].riskMicros=1;},p=>{p.records[0].totalPlannedRisk=1;},p=>{p.records[0].riskPlan={};},p=>{p.riskApprovalGranted=true;},p=>{p.schemaVersion=1;},p=>{p.testOnly=true;},p=>{p.textPayload+='|1';p.payloadSignature=candleMarkerPayloadSignature(p.textPayload);}]){
    const payload=technicalPayloadFixture();edit(payload);const f=uiFixture(payload),result=await f.run();assert.equal(result.status,'BLOCKED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);
  }
});

test('native marker settings support an explicitly scoped three-chart Arrow research layout with one NQ one-minute target',async()=>{
  const f=uiFixture(technicalPayloadFixture());f.expected.allowResearchMultiChart=true;
  const first=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),third=new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'});f.doc.charts=[first,f.canvas,third];
  const r=await f.run();assert.equal(r.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(r));assert.equal(r.researchSelection.visibleCharts,3);assert.equal(r.researchSelection.targetCharts,1);assert.equal(r.researchSelection.selectedChartLabel,'Chart for CME_MINI:NQ1!, 1 minute');assert.equal(f.ok.actions.length,1);
  assert.equal(first.actions.length,0);assert.equal(third.actions.length,0);assert.equal(first.getAttribute('aria-label'),'Chart for CME_MINI:NQ1!, 5 minutes');
});

test('marker multichart policy blocks ambiguous targets, non-NQ charts, personal layout and invalid consent without opening settings',async()=>{
  for(const edit of [f=>{delete f.expected.allowResearchMultiChart;},f=>{f.expected.allowResearchMultiChart='true';},f=>{f.layout.attrs['aria-label']='Logged in as test Active layout: PERSONAL';},f=>{f.interval.attrs['data-value']='5';},f=>{f.doc.charts[0].attrs['aria-label']='Chart for CME_MINI:MNQ1!, 5 minutes';},f=>{f.doc.charts[0].attrs['aria-label']='Chart for CME_MINI:NQ1!, 1 minute';},f=>{f.doc.charts.push(new Node({'aria-label':'Chart for CME_MINI:NQ1!, 15 minutes'}));}]){
    const f=uiFixture(technicalPayloadFixture());f.expected.allowResearchMultiChart=true;f.doc.charts=[new Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas,new Node({'aria-label':'Chart for CME_MINI:NQ1!, 1 second'})];edit(f);
    assert.equal((await f.run()).status,'BLOCKED',edit.toString());assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);assert.equal(f.ok.actions.length,0);
  }
});

test('research multichart marker consent cannot be repurposed for a LIVE chart inspection',async()=>{
  const f=uiFixture(technicalPayloadFixture());f.expected.allowResearchMultiChart=true;f.expected.sourceMode='LIVE';f.replay.attrs['aria-pressed']='false';f.doc.charts=[new Node({'aria-label':'Chart for CME_MINI:NQ1!, 5 minutes'}),f.canvas];
  assert.equal((await f.run({action:'inspect',payload:undefined})).status,'BLOCKED');assert.equal(f.settings.actions.length,0);assert.equal(f.area.actions.length,0);
});


test('targeted archive repair writes only its own labeled input and never changes markers, account or order controls',async()=>{
  const {f}=liveUiFixture(),markerArea=f.area,area=new Textarea({'aria-label':'History archive repair request'});f.dialog.queries.set('textarea',[markerArea,area]);const repair={requestedAt:Date.now(),requests:[{timeframe:'1',time:1794556320000}]};
  const r=await f.run({action:'repair_archive',expected:f.expected,payload:undefined,repair});assert.equal(r.status,'NATIVE_ARCHIVE_REPAIR_REQUEST_ACCEPTED',JSON.stringify(r));assert.equal(area.value,'ARROW_ARCHIVE_REPAIR_V1|'+repair.requestedAt+'\n1|1794556320000');assert.equal(markerArea.actions.length,0);assert.deepEqual(area.actions,['set','input','change']);assert.equal(r.ordersCreated,false);assert.equal(r.orderEligible,false);assert.equal(r.fields,null);assert.equal(r.proofKind,'OWNED_ARCHIVE_SETTINGS_REQUEST_NOT_DATA_COVERAGE_PROOF');assert.equal(f.interval.attrs['data-value'],'1');
});

test('archive repair rejects unrelated or ambiguous input, invalid timeframe, future time and mixed marker payload before applying',async()=>{
  for(const mode of ['wrong-label','duplicate','bad-tf','future','payload']){const {f,p}=liveUiFixture();const area=new Textarea({'aria-label':mode==='wrong-label'?'Other study setting':'History archive repair request'});f.dialog.queries.set('textarea',[f.area,area,...(mode==='duplicate'?[new Textarea({'aria-label':'History archive repair request'})]:[])]);const repair={requestedAt:Date.now(),requests:[{timeframe:mode==='bad-tf'?'60':'1',time:mode==='future'?Math.ceil(Date.now()/60000)*60000+60000:1794556320000}]};const r=await f.run({action:'repair_archive',expected:f.expected,payload:mode==='payload'?p:undefined,repair});assert.equal(r.status,'BLOCKED',mode);assert.equal(area.actions.length,0);assert.equal(f.ok.actions.length,0);}
});


test('schema4 entry arrows and research circles synchronize exact native proof without touching chart layout or order inputs',async()=>{
 const {f,p:old}=liveUiFixture(),p=formatEntryMarkerPayload(old,[{record:old.records[0],attemptKey:'submitted-native',basis:'NATIVE_MARKET_DISPATCH'}]);
 f.ok.onClick=()=>{f.doc.dialogs=[];for(const [name,value]of Object.entries(native(p)))f.markerValues.get(name).textContent=String(value);};
 const r=await f.run({expected:f.expected,payload:p});assert.equal(r.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(r));assert.equal(r.fields.ARROW_MARKER_SCHEMA,'4');assert.equal(f.area.value,p.textPayload);assert.equal(f.doc.charts.length,3);assert.equal(f.interval.attrs['data-value'],'1');const n=f.settings.actions.length;const second=await f.run({expected:f.expected,payload:p});assert.equal(second.status,'NATIVE_MARKERS_VERIFIED');assert.equal(f.settings.actions.length,n,'unchanged native proof causes no flicker');
});


test('schema5 reflects actual fill time/price including a fill in the still-forming next candle',async()=>{
 const {f,p:base}=liveUiFixture(),r=base.records[0],account={provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'test'},timeText=new Date(r.closeTime+1000).toISOString().slice(0,19).replace('T',' '),nativeFill={kind:'NATIVE_EXECUTED_FILL_V1',origin:'PUBLIC_NATIVE_UI',...account,nativeOrderId:'101',direction:r.direction,price:r.closeTicks*.25+.75,filledAt:r.closeTime+1000,timeText,timestampField:'closeDate',timestampPrecisionMs:1000,utcOffsetMinutes:0,timezoneBasis:'VISIBLE_CHART_TIMEZONE_MENU',orderRow:{id:'101',type:'Market',status:'filled',side:r.direction==='LONG'?'Buy':'Sell',symbol:'CME_MINI:NQZ2026',avgPrice:String(r.closeTicks*.25+.75),closeDate:timeText}},p=formatFillMarkerPayload(base,[{record:r,account,nativeFill,attemptKey:'a',basis:'ATTRIBUTED_NATIVE_FILL_PRICE_AND_TIME'}]);
 assert.equal(p.entryArrowCount,1);f.ok.onClick=()=>{f.doc.dialogs=[];for(const [name,value]of Object.entries(native(p)))f.markerValues.get(name).textContent=String(value);};const result=await f.run({expected:f.expected,payload:p});assert.equal(result.status,'NATIVE_MARKERS_VERIFIED',JSON.stringify(result));assert.equal(result.fields.ARROW_MARKER_SCHEMA,'5');assert.equal(Number(result.fields.ARROW_MARKER_LAST_TIME),r.closeTime+1000);assert.equal(Number(result.fields.ARROW_MARKER_LAST_PRICE_TICKS),r.closeTicks+3);assert.equal(f.doc.charts.length,3);assert.equal(f.interval.attrs['data-value'],'1');
});
