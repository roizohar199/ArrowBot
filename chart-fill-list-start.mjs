import {chartFillListCommand} from './chart-fill-list.mjs';
import {collectFillMarkerProofs,formatFillMarkerPayload} from './fill-marker-payload.mjs';
import {BROKER_ACCOUNT_REGISTRY_STORAGE_KEY,normalizeBrokerAccountRegistry} from './broker-account-registry.mjs';

// Reconnect just the display in an already-open session. Does not reload the
// extension/panel or change the execution runner, account, orders or preset.
async function start(){
  const keys=[BROKER_ACCOUNT_REGISTRY_STORAGE_KEY,'arrow.confirmed-candle-markers.v1','arrow.verified-fill-markers.v1'];
  const data=await chrome.storage.local.get(keys),registry=normalizeBrokerAccountRegistry(data[keys[0]]);
  if(!registry.ok)throw Error('יש לבחור חשבון שמור ב־Arrow.');
  const account=registry.registry.profiles.find(p=>p.id===registry.registry.selectedProfileId&&p.enabled);
  if(!account)throw Error('יש לבחור חשבון שמור ב־Arrow.');
  const accountKey=JSON.stringify([account.provider,account.environment,account.nativeAccountId]);
  const cached=data[keys[1]]?.recordsBySource?.['CME_MINI:NQ1!|1'];
  if(!cached)throw Error('יש לחבר תחילה את Arrow לגרף.');
  const proofs=collectFillMarkerProofs({account,stored:data[keys[2]]?.proofsByAccount?.[accountKey]??[]});
  const payload=formatFillMarkerPayload({status:'READY',schemaVersion:3,instrument:'CME_MINI:NQ1!',asOfTime:cached.asOfTime,records:cached.records},proofs);
  const targets=(await chrome.tabs.query({})).filter(t=>/^https:\/\/www\.tradingview\.com\/chart\/(ARROWFR1|ARROWRV1)\/$/.test(t.url??''));
  if(targets.length!==1)throw Error('נדרש גרף Arrow יחיד פתוח.');
  const tab=targets[0];await chrome.tabs.update(tab.id,{active:true});
  for(let attempt=0;attempt<10;attempt++){
    const read=(await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>{
      const nodes=[...document.querySelectorAll('[data-test-id-value-title]')].filter(n=>n.getAttribute('data-test-id-value-title')==='ARROW2_RUN_EPOCH'&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
      return {visible:document.visibilityState==='visible',runEpoch:nodes.length===1?Number(nodes[0].parentElement.children[1].textContent.trim().replaceAll(',','')):null};
    }}))[0]?.result;
    if(read?.visible&&Number.isSafeInteger(read.runEpoch)){
      const receipt=(await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:chartFillListCommand,args:[{expected:{researchUrl:tab.url,instrument:'CME_MINI:NQ1!',runEpoch:read.runEpoch},textPayload:payload.textPayload}]}))[0]?.result;
      if(receipt?.status!=='FILL_LIST_RENDERED')throw Error('הרשימה ממתינה לאימות סימוני העסקאות בגרף.');
      return 'הרשימה מוצגת בגרף. לחיצה על השורה העליונה מרחיבה ומכווצת.';
    }
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('יש לפתוח את חלון הנתונים בגרף ולחבר את Arrow.');
}
try{document.getElementById('status').textContent=await start();}catch(error){document.getElementById('status').textContent=error.message??'לא ניתן להציג כרגע את הרשימה.';}
