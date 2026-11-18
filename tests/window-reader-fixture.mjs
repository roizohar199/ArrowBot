import vm from 'node:vm';
import {readTradingViewWindowEvidence,readWindowMetadataEvidence} from '../tradingview-window-reader.mjs';

export const TIME_ORIGIN=1577836800000,SCALAR_BASE=1e12,PRICE_BASE=2e10,PRICE_BIAS=1e10;
export const suffixes=['TIME','CLOSE_TIME','OPEN','HIGH','LOW','CLOSE','VOLUME'];
export const taggedFields=[];
const add=(name,kind='scalar')=>taggedFields.push({name:'ARROW2_'+name,kind});
for(const [name,kind] of [['SOURCE_EPOCH','time'],['BASE_MS'],['TICK','price'],['POINT','price'],['HIGHER1_MS'],['HIGHER2_MS'],['SUPPORTED'],['HISTORY_STATE']])add(name,kind);
for(const suffix of [...suffixes,'CLOSED'])add('CURRENT_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':suffix==='VOLUME'?'volume':'scalar');
for(const group of ['PREVIOUS','HIGHER1','HIGHER2','HISTORY_BASE','HISTORY_HIGHER1','HISTORY_HIGHER2'])for(const suffix of suffixes)add(group+'_'+suffix,['TIME','CLOSE_TIME'].includes(suffix)?'time':['OPEN','HIGH','LOW','CLOSE'].includes(suffix)?'price':'volume');
export const fieldNames=['ARROW2_PROTOCOL','ARROW2_RUN_EPOCH','ARROW2_SEQ_BEGIN',...taggedFields.map(item=>item.name),'ARROW2_CHECKSUM_A','ARROW2_CHECKSUM_B','ARROW2_SEQ_END'];
export const makeBootstrap=()=>({schemaVersion:2,runEpoch:Date.UTC(2026,10,14,12)-10000,runId:'CME_MINI:NQ1!|1|'+(Date.UTC(2026,10,14,12)-10000),metadata:{source:'ohlc',instrument:'CME_MINI:NQ1!',timeframe:'1',timeframeMs:60000,tickSize:.25,pointValue:20,currency:'USD',timezone:'America/Chicago',session:'regular',chartType:'standard'},higherTimeframes:[{timeframe:'5',timeframeMs:300000},{timeframe:'15',timeframeMs:900000}],encoding:{priceDecimals:4,volumeDecimals:6,volumeQuantized:true,volumeMaxAbsoluteError:.0000005,volumeMissing:999999999999,tagModulo:4096,timeOrigin:TIME_ORIGIN,historyHoldMs:500,historyOrder:'newest_first',checksumPrimes:[1000000007,1000000009],checksumMultipliers:[65599,131071]}});
export const rows=(count,duration,end=Date.UTC(2026,10,14,12))=>Array.from({length:count},(_,index)=>({time:end-(count-index)*duration,closeTime:end-(count-index-1)*duration,open:20000+index*.25,high:20001+index*.25,low:19999+index*.25,close:20000.5+index*.25,volume:100+index/10,closed:true,sourceClosed:true}));
export function recalculateChecksums(raw){let a=0,b=0;for(const value of [raw.ARROW2_RUN_EPOCH,raw.ARROW2_SEQ_BEGIN,...taggedFields.map(item=>raw[item.name]??-1)]){a=(a*65599+((value%1000000007)+1000000007)%1000000007)%1000000007;b=(b*131071+((value%1000000009)+1000000009)%1000000009)%1000000009;}raw.ARROW2_CHECKSUM_A=a;raw.ARROW2_CHECKSUM_B=b;return raw;}
export function encodeFrame({bootstrap=makeBootstrap(),sequence=1,slot=0,sourceAt=Date.UTC(2026,10,14,12)+1000,counts=[20,20,20],base=rows(counts[0],60000),higher=[rows(counts[1],300000),rows(counts[2],900000)],current,flags=3}={}){
  const tag=sequence%4096,meta=bootstrap.metadata,last=base.at(-1),openedAt=last?.closeTime??Math.floor(sourceAt/meta.timeframeMs)*meta.timeframeMs;
  const active=current??{time:openedAt,closeTime:openedAt+meta.timeframeMs,open:20010,high:20011,low:20009,close:20010.25,volume:120.123456,closed:false,sourceClosed:false};
  const values={ARROW2_SOURCE_EPOCH:sourceAt,ARROW2_BASE_MS:meta.timeframeMs,ARROW2_TICK:meta.tickSize,ARROW2_POINT:meta.pointValue,ARROW2_HIGHER1_MS:bootstrap.higherTimeframes[0].timeframeMs??0,ARROW2_HIGHER2_MS:bootstrap.higherTimeframes[1].timeframeMs??0,ARROW2_SUPPORTED:flags,ARROW2_HISTORY_STATE:((counts[0]*101+counts[1])*101+counts[2])*100+slot};
  const setRow=(group,row,active=false)=>{const keys={TIME:'time',CLOSE_TIME:'closeTime',OPEN:'open',HIGH:'high',LOW:'low',CLOSE:'close',VOLUME:'volume',CLOSED:'closed'};for(const suffix of active?[...suffixes,'CLOSED']:suffixes)values['ARROW2_'+group+'_'+suffix]=row?suffix==='CLOSED'?row.closed?1:0:row[keys[suffix]]:undefined;};
  setRow('CURRENT',active,true);setRow('PREVIOUS',last);setRow('HIGHER1',higher[0].at(-1));setRow('HIGHER2',higher[1].at(-1));setRow('HISTORY_BASE',base.at(-1-slot));setRow('HISTORY_HIGHER1',higher[0].at(-1-slot));setRow('HISTORY_HIGHER2',higher[1].at(-1-slot));
  const raw={ARROW2_PROTOCOL:2,ARROW2_RUN_EPOCH:bootstrap.runEpoch,ARROW2_SEQ_BEGIN:sequence,ARROW2_SEQ_END:sequence};
  for(const item of taggedFields){const value=values[item.name];raw[item.name]=value===undefined||value===null&&item.kind!=='volume'?null:item.kind==='price'?tag*PRICE_BASE+Math.round(value*1e4)+PRICE_BIAS:item.kind==='time'?tag*SCALAR_BASE+value-TIME_ORIGIN:item.kind==='volume'?tag*SCALAR_BASE+(value===null?SCALAR_BASE-1:Math.round(value*1e6)):tag*SCALAR_BASE+value;}
  return recalculateChecksums(raw);
}
export function encodeMetadataFrame(options={}){
  const bootstrap=options.bootstrap??makeBootstrap(),sequence=options.sequence??1,raw=encodeFrame({...options,bootstrap}),tag=sequence%4096;
  raw.ARROW2_HISTORY_STATE+=134217728;
  const text=['2',bootstrap.metadata.instrument,bootstrap.metadata.timeframe,bootstrap.metadata.timezone,bootstrap.metadata.session,bootstrap.metadata.currency].join('|'),bytes=Array.from(text,char=>char.charCodeAt(0));
  if(bytes.length>84)throw Error('Fixture metadata exceeds84bytes');while(bytes.length<84)bytes.push(0);
  taggedFields.slice(37).forEach((field,index)=>{const offset=index*4,word=bytes[offset]*16777216+bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3];raw[field.name]=tag*(field.kind==='price'?PRICE_BASE:SCALAR_BASE)+word;});
  return recalculateChecksums(raw);
}
class Element{
  constructor(attrs={},text=''){this.attrs=attrs;this.textContent=text;this.parentElement=null;this.children=[];this.visible=true;this.style={};}
  getAttribute(key){return this.attrs[key]??null;}
  getBoundingClientRect(){return {width:this.visible?100:0,height:this.visible?20:0,top:0,left:0,right:100,bottom:20,...this.rect};}
  querySelectorAll(){return [];}
  querySelector(){return null;}
  closest(){return this.excluded?this:null;}
}
export function makeWindowFixture({bootstrap=makeBootstrap(),raw=encodeFrame({bootstrap}),wallTime=Date.UTC(2026,10,14,12)+1000}={}){
  const fieldNodes=new Map(),labelNodes=[],header=new Element({title:'Arrow OHLC Window v2 (100, 5, 15)'}),study=new Element(),canvas=new Element({'aria-label':'Chart for '+bootstrap.metadata.instrument+', 1 minute'}),tab=new Element({'aria-label':'Data window','aria-selected':'true'}),interval=new Element({'data-value':bootstrap.metadata.timeframe}),replay=new Element({'aria-pressed':'false'}),statuses=new Element({},'Real-time data');statuses.outerHTML='<span class="marketStatusOpen-x dataStatusRealtime"></span>';
  const panel=new Element();header.parentElement=study;study.parentElement=panel;
  for(const name of fieldNames){const label=new Element({'data-test-id-value-title':name},name),value=new Element(),parent=new Element();parent.children=[label,value];label.parentElement=parent;value.parentElement=parent;labelNodes.push(label);fieldNodes.set(name,value);}
  study.querySelectorAll=selector=>selector==='span[title]'?(header.attrs.title?[header]:[]):selector===':scope > div[class*="header-"] > span[class*="headerTitle-"]'?[header]:selector==='[data-test-id-value-title]'?labelNodes:[];
  const legend=new Element();legend.querySelector=selector=>selector==='[data-qa-id="legend-statuses-wrapper"]'?statuses:null;
  const document={body:new Element(),visibilityState:'visible',texts:[],querySelectorAll(selector){if(selector==='canvas[aria-label^="Chart for "]')return this.canvases;if(selector==='[data-qa-id="legend-series-item"]')return [legend];if(selector==='[role="tab"][aria-selected="true"]')return this.tabs;if(selector==='[role="treegrid"] [role="row"][data-role="menuitem"]')return this.studies;return [];},querySelector(selector){return selector.startsWith('#header-toolbar-intervals')?interval:selector==='#header-toolbar-replay'?replay:null;},createTreeWalker(){let index=0;return {nextNode:()=>this.texts[index++]??null};},canvases:[canvas],tabs:[tab],studies:[study]};
  let wall=wallTime,counter=0,timerId=0,sourceTimingReads=0;const timers=new Map(),observers=[];
  class FixtureObserver{constructor(callback){this.callback=callback;this.active=false;observers.push(this);}observe(target){this.target=target;this.active=true;}disconnect(){this.active=false;}}
  class FixtureDate extends Date{static now(){return wall;}}
  const performanceOrigin=wall-100;
  const fixtureLocation={protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/test/',port:'',search:'',hash:'',username:'',password:'',
    get href(){return this.protocol+'//'+(this.username?this.username+(this.password?':'+this.password:'')+'@':'')+this.hostname+(this.port?':'+this.port:'')+this.pathname+this.search+this.hash;},
    set href(value){const parsed=new URL(value);for(const key of ['protocol','hostname','pathname','port','search','hash','username','password'])this[key]=parsed[key];}
  };
  const timings=[],context=vm.createContext({document,location:fixtureLocation,getComputedStyle:node=>({display:node.visible?'block':'none',visibility:'visible',opacity:'',overflowX:'visible',overflowY:'visible',...node.style}),innerWidth:1280,innerHeight:900,performance:{timeOrigin:performanceOrigin,now:()=>wall-performanceOrigin+(counter+=.01)},Date:FixtureDate,Intl,URL,NodeFilter:{SHOW_TEXT:4},structuredClone,console,MutationObserver:FixtureObserver,setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,due:wall+ms});return id;},clearTimeout(id){timers.delete(id);}});
  context.__arrowSourceDomTimingV1={recordWindowPacket:(id,details)=>timings.push({id,details}),read:()=>{sourceTimingReads++;return {samples:timings.length};}};
  const setRaw=(values,{grouped=false}={})=>{for(const name of fieldNames)fieldNodes.get(name).textContent=values[name]===null?'∅':grouped?Number(values[name]).toLocaleString('en-US',{maximumFractionDigits:0}):String(values[name]);};
  setRaw(raw);
  return {bootstrap,document,fieldNodes,labelNodes,header,study,panel,canvas,tab,replay,statuses,context,timings,observers,get sourceTimingReads(){return sourceTimingReads;},setRaw,advance(ms=500){wall+=ms;for(const [id,timer]of [...timers])if(timer.due<=wall){timers.delete(id);timer.callback();}},mutate(){for(const observer of observers)if(observer.active)observer.callback([{target:study}]);},read(options={}){context.__args={bootstrap,sessionId:'fixture',...options};return JSON.parse(JSON.stringify(vm.runInContext('('+readTradingViewWindowEvidence.toString()+')(__args)',context)));},readMetadata(){return JSON.parse(JSON.stringify(vm.runInContext('('+readWindowMetadataEvidence.toString()+')()',context)));},metadataNode(text,{visible=true,excluded=false}={}){const parent=new Element();parent.visible=visible;parent.excluded=excluded;const node={nodeValue:text,parentElement:parent};document.texts.push(node);return node;}};
}
