// Serialized read-only public Data Window reader. Separate from live intake:
// no chart controls, source-clock grants, execution state or account actions.
export function readHistory24Window({sourceUrl,instrument='CME_MINI:NQ1!',tickSize=.25,pointValue=20,currency='USD'}={}){
  const result=(status,extra={})=>({kind:'VERIFIED_HISTORY24_PUBLIC_FRAME_V1',status,ordersCreated:false,liveEligible:false,...extra});
  try{
    if(document.visibilityState!=='visible'||document.hidden===true)return result('WAITING_VISIBLE_SOURCE');
    const allowed={'https://www.tradingview.com/chart/ARROWFR1/':'Full Screens Live','https://www.tradingview.com/chart/ARROWRV1/':'Arrow OHLC Live Verification'};
    if(!allowed[sourceUrl]||location.href!==sourceUrl||instrument!=='CME_MINI:NQ1!'||tickSize!==.25||pointValue!==20||currency!=='USD')return result('ARCHIVE_SOURCE_IDENTITY_REQUIRED');
    const visible=n=>{const r=n?.getBoundingClientRect?.();if(!r||r.width<=0||r.height<=0)return false;for(let p=n,d=0;p&&d<64;p=p.parentElement,d++){const s=getComputedStyle(p);if(s.display==='none'||['hidden','collapse'].includes(s.visibility))return false;}return true;};
    const all=(s,root=document)=>Array.from(root.querySelectorAll(s)).filter(visible),norm=s=>String(s??'').replace(/\s+/g,' ').trim();
    const charts=all('canvas[aria-label^="Chart for "]'),layouts=all('[aria-label^="Logged in as"]');
    if(charts.length<1||charts.length>3||charts.filter(n=>n.getAttribute('aria-label')==='Chart for CME_MINI:NQ1!, 1 minute').length!==1||charts.some(n=>!/^Chart for CME_MINI:NQ1!, /.test(n.getAttribute('aria-label')??''))||layouts.length!==1||!norm(layouts[0].getAttribute('aria-label')).endsWith('Active layout: '+allowed[sourceUrl])||document.querySelector('#header-toolbar-intervals [aria-checked="true"]')?.getAttribute('data-value')!=='1')return result('ARCHIVE_ACTIVE_MINUTE_REQUIRED');
    const tab=all('[role="tab"][aria-selected="true"]').filter(n=>/data\s*window/i.test(n.getAttribute('aria-label')??n.textContent));if(tab.length!==1)return result('WAITING_DATA_WINDOW');
    const rows=all('[role="treegrid"] [role="row"][data-role="menuitem"]'),own=rows.filter(row=>all('span[title]',row).some(n=>(n.getAttribute('title')??'').startsWith('Arrow Approved Candle Markers'))||all(':scope > div[class*="header-"] > span[class*="headerTitle-"]',row).some(n=>/^Arrow Approved Candle Markers(?:\s|\(|$)/.test(norm(n.textContent))));
    if(own.length!==1)return result('ARCHIVE_SOURCE_NOT_INSTALLED');
    const headers=['PROTOCOL','RUN_EPOCH','SEQ_BEGIN','EMITTED_AT','WINDOW_END','TF_MS','TOTAL_ROWS','PAGE_INDEX','META_ID'],names=[...headers,...Array.from({length:35},(_,i)=>'DATA_'+i),'CHECKSUM_A','CHECKSUM_B','SEQ_END'];
    const plots=all('[data-test-id-value-title]',own[0]);if(plots.length>100)return result('ARCHIVE_FIELD_LIMIT');const nodes=new Map();
    for(const n of plots){const title=n.getAttribute('data-test-id-value-title');if(!title?.startsWith('ARROW24_'))continue;if(nodes.has(title)||n.parentElement?.children.length!==2||n.parentElement.children[0]!==n)return result('ARCHIVE_FIELD_STRUCTURE_CHANGED');nodes.set(title,n.parentElement.children[1]);}
    if(nodes.size!==47)return result('ARCHIVE_SOURCE_NOT_INSTALLED');
    const number=n=>{const t=norm(n?.textContent).replace(/^\u2212/,'-');return /^-?[\d,]+$/.test(t)&&Number.isSafeInteger(Number(t.replaceAll(',','')))?Number(t.replaceAll(',','')):null;};
    const before=number(nodes.get('ARROW24_SEQ_BEGIN')),values=names.map(k=>number(nodes.get('ARROW24_'+k)));if(values.some(v=>v===null)||before!==values[2]||before!==values[46]||before!==number(nodes.get('ARROW24_SEQ_BEGIN')))return result('WAITING_ARCHIVE_COHERENCE');
    let a=0,b=0;for(const v of values.slice(0,44)){a=(a*65599+((v%1000000007)+1000000007)%1000000007)%1000000007;b=(b*131071+((v%1000000009)+1000000009)%1000000009)%1000000009;}
    if(a!==values[44]||b!==values[45])return result('WAITING_ARCHIVE_COHERENCE');
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_!:.|-/\n';let signature=17;for(const c of instrument+'|1|'+tickSize+'|'+pointValue+'|'+currency){const index=alphabet.indexOf(c);if(index<0)return result('ARCHIVE_METADATA_MISMATCH');signature=(signature*31+index+1)%1000000007;}
    const [protocol,runEpoch,sequence,emittedAt,windowEnd,timeframeMs,totalRows,pageIndex,metaId]=values;
    const rowsPerFrame=protocol>=2?11:5,rowStart=protocol===3?pageIndex:pageIndex*rowsPerFrame;
    if(![1,2,3].includes(protocol)||runEpoch<1577836800000||sequence<1||emittedAt<runEpoch||windowEnd>emittedAt||![60000,300000,900000].includes(timeframeMs)||totalRows<1||totalRows>4999||pageIndex<0||pageIndex>=(protocol===3?totalRows:Math.ceil(totalRows/rowsPerFrame))||metaId!==signature)return result('ARCHIVE_METADATA_MISMATCH');
    if(protocol>=2&&values.slice(42,44).some(v=>v!==-1))return result('ARCHIVE_PADDING_INVALID');
    const bars=[];for(let i=0;i<rowsPerFrame;i++){
      const row=protocol>=2?values.slice(9+i*3,12+i*3):values.slice(9+i*7,16+i*7);
      if(rowStart+i>=totalRows){if(row.some(v=>v!==-1))return result('ARCHIVE_PADDING_INVALID');continue;}
      let time,o,h,l,c,volumeUnits=-1,proof;
      if(protocol>=2){
        const [a,b,d]=row;if(a<0||a>=9007199254740992||b<0||b>=4503599627370496||d<0||d>=4503599627370496)return result('ARCHIVE_BAR_INVALID');
        time=Math.floor(a/134217728)*60000;proof=a%134217728;o=Math.floor(b/67108864);h=b%67108864;l=Math.floor(d/67108864);c=d%67108864;
      }else [time,o,h,l,c,volumeUnits,proof]=row;
      const closeTime=time+timeframeMs;if(time<1577836800000||closeTime>windowEnd||time%60000!==0||o<=0||l<=0||h<Math.max(o,c,l)||l>Math.min(o,c,h)||proof<0||volumeUnits< -1||volumeUnits>=1e12)return result('ARCHIVE_BAR_INVALID');
      bars.push({time,closeTime,open:o*tickSize,high:h*tickSize,low:l*tickSize,close:c*tickSize,volume:volumeUnits===-1?null:volumeUnits/1e6,closed:true,sourceClosed:true,finalOhlcVerified:true,providerBarIndex:Math.floor(proof/4),sessionFirst:(proof%4&1)===1,sessionLast:(proof%4&2)===2,observedAt:Date.now(),providerRunEpoch:runEpoch});
    }
    return result('OK',{protocol,rowsPerFrame,repairFrame:protocol===3,rowStart,instrument,timeframe:String(timeframeMs/60000),timeframeMs,runEpoch,sequence,emittedAt,windowEnd,totalRows,pageIndex:protocol===3?null:pageIndex,pageCount:Math.ceil(totalRows/rowsPerFrame),bars,checksumsVerified:true,sourceUrl,observedAt:Date.now(),sourceKind:'PUBLIC_PINE_CLOSED_HISTORY_NOT_LIVE_APPROVAL'});
  }catch{return result('WAITING_ARCHIVE_FRAME');}
}
