import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {chartFillListCommand} from '../chart-fill-list.mjs';
import {candleMarkerPayloadSignature} from '../candle-marker-payload.mjs';

// Simulated DOM and fills only. No real account, market data or broker actions.
function surface(count=25){
  const fields={},docListeners=new Map(),pageListeners=new Map(),timers=new Map(),preferences=new Map();let serial=0;
  class Element{
    constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.style={};this.children=[];this.parentElement=null;this.listeners=new Map();this._text='';this.rect={left:100,top:80,right:900,bottom:580,width:800,height:500};}
    getAttribute(k){return this.attrs[k]??null;}setAttribute(k,v){this.attrs[k]=String(v);}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set textContent(v){this._text=String(v);this.children=[];}
    append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
    addEventListener(k,fn){this.listeners.set(k,fn);}getBoundingClientRect(){return this.rect;}
    click(){this.listeners.get('click')?.({preventDefault(){},stopPropagation(){}});}
    set innerHTML(_v){throw Error('Unsafe HTML');}
  }
  const body=new Element('body'),canvas=new Element('canvas',{'aria-label':'Chart for CME_MINI:NQ1!, 1 minute'}),interval=new Element('button',{'data-value':'1'}),replay=new Element('button',{'aria-pressed':'false'}),layout=new Element('button',{'aria-label':'Logged in as simulated Active layout: Full Screens Live'});
  body.append(canvas);const all=n=>[n,...n.children.flatMap(all)];
  const document={body,hidden:false,visibilityState:'visible',createElement:t=>new Element(t),getElementById:id=>all(body).find(n=>n.id===id),
    querySelectorAll(selector){if(selector==='canvas[aria-label^="Chart for "]')return [canvas];if(selector==='[aria-label^="Logged in as"]')return [layout];if(selector==='[data-test-id-value-title]')return Object.entries(fields).map(([k,v])=>{const p=new Element(),label=new Element('span',{'data-test-id-value-title':k}),value=new Element();value.textContent=v;p.append(label,value);return label;});return [];},
    querySelector:s=>s.includes('intervals')?interval:s==='#header-toolbar-replay'?replay:null,
    addEventListener:(k,fn)=>docListeners.set(k,fn),removeEventListener:k=>docListeners.delete(k),
  };
  const expected={researchUrl:'https://www.tradingview.com/chart/ARROWFR1/',instrument:'CME_MINI:NQ1!',runEpoch:1794835000000};
  const context=vm.createContext({document,location:{href:expected.researchUrl,protocol:'https:',hostname:'www.tradingview.com',pathname:'/chart/ARROWFR1/'},innerWidth:1200,innerHeight:800,getComputedStyle:n=>({display:'block',visibility:'visible',...n.style}),localStorage:{getItem:k=>preferences.get(k),setItem:(k,v)=>preferences.set(k,v)},setInterval:fn=>{timers.set(++serial,fn);return serial;},clearInterval:id=>timers.delete(id),addEventListener:(k,fn)=>pageListeners.set(k,fn),removeEventListener:k=>pageListeners.delete(k)});
  function payload(n=count){const cutoff=1794900000000,rows=Array.from({length:n},(_,i)=>['m'+i+'_1',cutoff-(i+1)*60000,cutoff-i*60000,100000,100004,99996,100000,i%2?1:-1,100000,1,cutoff-i*60000+1000,100000+i,120].join('|'));return ['ARROW_FILL_MARKERS_V1|CME_MINI:NQ1!|1|LIVE|'+cutoff,...rows].join('\n');}
  function prove(text){const lines=text.split('\n');Object.assign(fields,{ARROW2_RUN_EPOCH:expected.runEpoch,ARROW_MARKER_SCHEMA:5,ARROW_MARKER_MODE:1,ARROW_MARKER_SIGNATURE:candleMarkerPayloadSignature(text),ARROW_MARKER_EXPECTED_COUNT:lines.length-1,ARROW_MARKER_MATCHED_COUNT:lines.length-1,ARROW_MARKER_DRAWN_COUNT:lines.length-1,ARROW_MARKER_CUTOFF:Number(lines[0].split('|')[4]),ARROW_MARKER_CONTEXT_VALID:1});}
  const textPayload=payload();prove(textPayload);
  const run=(options={})=>{context.args={expected,textPayload,...options};return vm.runInContext('('+chartFillListCommand.toString()+')(args)',context);};
  return {run,context,document,canvas,interval,replay,fields,expected,timers,docListeners,pageListeners,preferences,payload,prove,get state(){return context.__arrowChartFillListV1;}};
}

test('direct button expands latest20 native fills, collapses to one row and remembers preference',()=>{
  const s=surface();assert.equal(s.run().status,'FILL_LIST_RENDERED');const state=s.state;
  assert.equal(state.button.getAttribute('aria-expanded'),'false');assert.equal(state.body.hidden,true);assert.match(state.button.textContent,/SHORT/);
  state.button.click();assert.equal(state.button.getAttribute('aria-expanded'),'true');assert.equal(state.body.hidden,false);
  const rows=state.body.children[0].children;assert.equal(rows.length,21);assert.match(rows[1].textContent,/25000.00/);assert.match(rows.at(-1).textContent,/25004.75/);assert.doesNotMatch(state.body.textContent,/25005.00/);
  s.run();assert.equal(s.state,state);assert.equal(state.expanded,true);assert.equal(s.timers.size,1);
  s.run({action:'clear'});assert.equal(s.timers.size,0);assert.equal(s.docListeners.size,0);s.run();assert.equal(s.state.expanded,true);
  s.state.button.click();assert.equal(s.state.expanded,false);assert.equal(s.state.body.hidden,true);
});

test('mismatched native proof, Replay or changed chart cannot display a fill list',()=>{
  for(const change of [s=>{s.fields.ARROW_MARKER_SIGNATURE++;},s=>{s.fields.ARROW_MARKER_DRAWN_COUNT=0;},s=>{s.fields.ARROW_MARKER_CONTEXT_VALID=0;},s=>{s.replay.attrs['aria-pressed']='true';},s=>{s.interval.attrs['data-value']='5';},s=>{s.document.hidden=true;}]){const s=surface();change(s);assert.notEqual(s.run().status,'FILL_LIST_RENDERED');assert.equal(s.state,undefined);}
  const s=surface();s.run();s.fields.ARROW_MARKER_SIGNATURE++;s.state.refresh();assert.equal(s.state.root.hidden,true);
});

test('proposed input waits for native reflection; updates preserve expansion and remove obsolete fills',()=>{
  const s=surface();s.run();s.state.button.click();const next=s.payload(2),dialog={getAttribute:k=>k==='aria-label'?'Arrow Approved Candle Markers':null};
  s.docListeners.get('input')({target:{tagName:'TEXTAREA',value:next,closest:()=>dialog}});s.state.refresh();assert.equal(s.state.model.rows.length,20);
  s.prove(next);s.state.refresh();assert.equal(s.state.model.rows.length,2);assert.equal(s.state.expanded,true);assert.equal(s.state.body.children[0].children.length,3);
  const empty=s.payload(0);s.prove(empty);s.run({textPayload:empty});assert.equal(s.state.root.hidden,true);
});

test('list follows chart resize and pagehide cleans timers and owned DOM',()=>{
  const s=surface();s.run();assert.equal(s.state.root.style.left,'640px');assert.equal(s.state.root.style.top,'80px');
  s.canvas.rect.right=700;s.canvas.rect.bottom=300;s.state.refresh();assert.equal(s.state.root.style.left,'440px');assert.equal(s.state.body.style.maxHeight,'180px');
  const root=s.state.root;s.pageListeners.get('pagehide')();assert.equal(s.state,undefined);assert.equal(s.timers.size,0);assert.equal(s.document.body.children.includes(root),false);
});
