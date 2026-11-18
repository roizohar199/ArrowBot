// Serialized into the chart's isolated world. Own DOM only: no chart internals,
// Settings gestures, broker controls or orders. Data must match native Pine proof.
export function chartFillListCommand({action='show',expected={},textPayload}={}){
  const key='__arrowChartFillListV1',id='arrow-chart-fill-list-v1',pref='arrow.fill-list.expanded.v1';
  const result=(status)=>({status,ordersCreated:false,orderEligible:false,fillInferred:false});
  let state=globalThis[key];
  if(action==='clear'){state?.dispose();return result('CLEARED');}
  if(action!=='show')return result('INVALID_ACTION');
  const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
  const number=x=>Number(norm(x).replaceAll(',','').replace(/^−/,'-'));
  const visible=node=>{const r=node?.getBoundingClientRect();if(!r||r.width<=0||r.height<=0)return false;const s=getComputedStyle(node);return s.display!=='none'&&!['hidden','collapse'].includes(s.visibility);};
  function field(name){
    const nodes=[...document.querySelectorAll('[data-test-id-value-title]')].filter(n=>n.getAttribute('data-test-id-value-title')===name&&visible(n));
    if(nodes.length!==1||nodes[0].parentElement?.children.length!==2)return NaN;
    return number(nodes[0].parentElement.children[1].textContent);
  }
  function chart(){
    if(document.hidden||document.visibilityState!=='visible')return null;
    if(location.href!==expected.researchUrl||location.protocol!=='https:'||!/(^|\.)tradingview\.com$/.test(location.hostname))return null;
    const layout={'/chart/ARROWFR1/':'Full Screens Live','/chart/ARROWRV1/':'Arrow OHLC Live Verification'}[location.pathname];
    const layouts=[...document.querySelectorAll('[aria-label^="Logged in as"]')].filter(visible);
    if(!layout||layouts.length!==1||!norm(layouts[0].getAttribute('aria-label')).endsWith('Active layout: '+layout))return null;
    const charts=[...document.querySelectorAll('canvas[aria-label^="Chart for "]')].filter(visible);
    const targets=charts.filter(n=>n.getAttribute('aria-label')===`Chart for ${expected.instrument}, 1 minute`);
    if(charts.length>3||targets.length!==1||charts.some(n=>!/^Chart for CME_MINI:NQ(?:1!|[HMUZ]20\d\d), [^,]+$/.test(n.getAttribute('aria-label')??'')))return null;
    if(document.querySelector('#header-toolbar-intervals [aria-checked="true"]')?.getAttribute('data-value')!=='1')return null;
    const replay=document.querySelector('#header-toolbar-replay');
    if((replay?.getAttribute('aria-pressed')??replay?.getAttribute('aria-checked'))!=='false'||field('ARROW2_RUN_EPOCH')!==expected.runEpoch)return null;
    return targets[0];
  }
  function parse(text){
    if(typeof text!=='string'||text.length>32768)return null;
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_!:.|-/\n';let signature=17;
    for(const c of text){const i=alphabet.indexOf(c);if(i<0)return null;signature=(signature*31+i+1)%1000000007;}
    const lines=text.split('\n'),head=lines.shift().split('|');
    if(head.length!==5||head[0]!=='ARROW_FILL_MARKERS_V1'||head[1]!==expected.instrument||head[2]!=='1'||head[3]!=='LIVE'||!/^\d+$/.test(head[4])||!Number.isSafeInteger(Number(head[4]))||lines.length>100)return null;
    const rows=[];
    for(const line of lines){
      const p=line.split('|');if(p.length!==13||!/^m\d+_\d+$/.test(p[0])||p.slice(1).some(v=>! /^-?\d+$/.test(v)||!Number.isSafeInteger(Number(v))))return null;
      const n=p.map(Number),flag=n[9];
      if(![1,-1].includes(n[7])||![0,1].includes(flag)||n[2]-n[1]!==60000||n[2]>Number(head[4])||n[3]<=0||n[5]<=0||n[4]<Math.max(n[3],n[5],n[6])||n[5]>Math.min(n[3],n[4],n[6])||n[8]!==n[6])return null;
      if(flag===1){
        if(n[10]<n[2]-5000||n[10]>Number(head[4])+65000||n[11]<=0||Math.abs(n[12])>840)return null;
        rows.push({time:n[10],price:n[11]*.25,side:n[7]===1?'LONG':'SHORT',offset:n[12]});
      }else if(n[10]!==0||n[11]!==0||n[12]!==0)return null;
    }
    return {text,signature,count:lines.length,cutoff:Number(head[4]),rows:rows.sort((a,b)=>b.time-a.time).slice(0,20)};
  }
  const model=parse(textPayload);
  if(!model||!Number.isSafeInteger(expected.runEpoch)||expected.runEpoch<1577836800000||!chart())return result('FILL_LIST_SOURCE_UNAVAILABLE');
  function proven(m){return m&&field('ARROW_MARKER_SCHEMA')===5&&field('ARROW_MARKER_MODE')===1&&field('ARROW_MARKER_SIGNATURE')===m.signature&&field('ARROW_MARKER_EXPECTED_COUNT')===m.count&&field('ARROW_MARKER_MATCHED_COUNT')===m.count&&field('ARROW_MARKER_DRAWN_COUNT')===m.count&&field('ARROW_MARKER_CUTOFF')===m.cutoff&&field('ARROW_MARKER_CONTEXT_VALID')===1;}
  if(!proven(model))return result('FILL_LIST_NATIVE_PROOF_MISMATCH');
  const collision=document.getElementById(id);if(collision&&collision!==state?.root)return result('FILL_LIST_ROOT_COLLISION');
  const binding=JSON.stringify(expected);
  if(state&&state.binding!==binding){state.dispose();state=null;}
  if(!state){
    const root=document.createElement('div');root.id=id;root.setAttribute('data-arrow-fill-list-owned','v1');root.setAttribute('dir','ltr');
    Object.assign(root.style,{position:'fixed',zIndex:'100',background:'#0f172a',color:'#fff',border:'1px solid #334155',borderRadius:'3px',boxSizing:'border-box',overflow:'hidden',font:'11px Arial,sans-serif',pointerEvents:'auto'});
    const button=document.createElement('button'),body=document.createElement('div');body.id=id+'-rows';button.type='button';button.setAttribute('aria-controls',body.id);
    Object.assign(button.style,{display:'block',width:'100%',margin:'0',padding:'4px 6px',border:'0',background:'#0f172a',color:'#e2e8f0',font:'bold 11px Arial,sans-serif',cursor:'pointer',textAlign:'left',whiteSpace:'nowrap',lineHeight:'16px'});
    Object.assign(body.style,{overflowY:'auto',overscrollBehavior:'contain'});root.append(button,body);
    let expanded=false;try{expanded=localStorage.getItem(pref)==='true';}catch{}
    state={binding,root,button,body,expanded,model,pending:null};globalThis[key]=state;
    const clock=r=>{const d=new Date(r.time+r.offset*60000),pad=n=>String(n).padStart(2,'0');return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds());};
    state.draw=()=>{
      const rows=state.model.rows,last=rows[0];body.replaceChildren();root.hidden=!last;
      button.setAttribute('aria-expanded',String(state.expanded));button.setAttribute('aria-label',state.expanded?'כיווץ רשימת העסקאות':'הרחבת רשימת העסקאות — עד 20 אחרונות');
      button.title=state.expanded?'לחיצה לכיווץ לשורה אחת':'לחיצה להצגת עד 20 העסקאות האחרונות';
      button.style.color=state.expanded?'#e2e8f0':last?.side==='LONG'?'#7dd3fc':'#fb923c';
      button.textContent=state.expanded?'▴  צמצום · '+rows.length+' עסקאות אחרונות':'▾  '+(last?clock(last)+'  '+last.side+'  '+last.price.toFixed(2):'');
      body.hidden=!state.expanded;
      if(state.expanded){
        const table=document.createElement('table');table.setAttribute('aria-label','20 העסקאות האחרונות');Object.assign(table.style,{width:'100%',borderCollapse:'collapse',font:'11px Arial,sans-serif',textAlign:'center'});
        const header=document.createElement('tr');for(const title of ['FILL TIME','SIDE','FILL PRICE']){const cell=document.createElement('th');cell.textContent=title;cell.style.padding='4px';header.append(cell);}table.append(header);
        for(const r of rows){const row=document.createElement('tr');row.style.color=r.side==='LONG'?'#7dd3fc':'#fb923c';for(const value of [clock(r),r.side,r.price.toFixed(2)]){const cell=document.createElement('td');cell.textContent=value;Object.assign(cell.style,{padding:'4px',borderTop:'1px solid #1e293b',whiteSpace:'nowrap'});row.append(cell);}table.append(row);}body.append(table);
      }
    };
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();state.expanded=!state.expanded;try{localStorage.setItem(pref,String(state.expanded));}catch{}state.draw();state.refresh();});
    for(const name of ['pointerdown','mousedown','dblclick'])root.addEventListener(name,event=>event.stopPropagation());
    // Follow public marker-input deliveries even in a panel opened before this
    // feature was installed. Never display typed/proposed data before Pine proof.
    state.input=event=>{
      const area=event.target;if(area?.tagName!=='TEXTAREA')return;
      const dialog=area.closest('[role="dialog"]');if(!dialog)return;
      const labelled=(dialog.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ');
      if(norm(dialog.getAttribute('aria-label')||labelled)!=='Arrow Approved Candle Markers')return;
      const next=parse(area.value);if(next)state.pending=next;
    };
    state.refresh=()=>{
      const target=chart();if(!target){root.hidden=true;return;}
      if(state.pending&&proven(state.pending)){state.model=state.pending;state.pending=null;state.draw();}
      if(!proven(state.model)||!state.model.rows.length){root.hidden=true;return;}
      const box=target.getBoundingClientRect(),left=Math.max(0,box.left),top=Math.max(0,box.top),right=Math.min(innerWidth,box.right),bottom=Math.min(innerHeight,box.bottom),width=Math.min(260,right-left-8);
      if(width<220||bottom-top<80){root.hidden=true;return;}
      root.hidden=false;Object.assign(root.style,{left:(right-width)+'px',top:top+'px',width:width+'px',maxHeight:(bottom-top-8)+'px'});body.style.maxHeight=Math.max(40,bottom-top-40)+'px';
    };
    state.dispose=()=>{clearInterval(state.timer);document.removeEventListener('input',state.input,true);removeEventListener('resize',state.refresh);removeEventListener('pagehide',state.dispose);root.remove();if(globalThis[key]===state)delete globalThis[key];};
    document.body.append(root);document.addEventListener('input',state.input,true);addEventListener('resize',state.refresh);addEventListener('pagehide',state.dispose,{once:true});state.timer=setInterval(state.refresh,1000);
  }
  state.model=model;state.draw();state.refresh();return result('FILL_LIST_RENDERED');
}
