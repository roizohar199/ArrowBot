import {normalizeAccountProfile,makeAccountProfileCollection,loadAccountProfiles,saveAccountProfiles,createAccountStartGate} from './account-profile.mjs';

const inputMap={label:'account-label',brokerLabel:'account-broker',mode:'account-mode',instrument:'account-instrument',currency:'account-currency',tickSize:'account-tick-size',riskBudget:'risk-budget',pointValue:'point-value',maxContracts:'max-contracts',commissionPerContract:'commission',slippageTicks:'slippage',rewardRisk:'reward-risk'};
const modeNames={PAPER:'דמו',LIVE:'חשבון אמיתי · הגדרה ידנית',RESEARCH:'מחקר'};
const copy=value=>structuredClone(value);
const number=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('he-IL',{maximumFractionDigits:8}).format(Number(value)):'—';
const reasonText=reason=>({ACCOUNT_PROFILE_REQUIRED:'יש להשלים פרופיל חשבון תקין.',ACCOUNT_INSTRUMENT_MISMATCH:'הנכס בגרף אינו תואם לפרופיל החשבון. נדרשת הגדרה מחדש.',ACCOUNT_POINT_VALUE_MISMATCH:'ערך הנקודה בגרף אינו תואם לפרופיל החשבון.',ACCOUNT_TICK_SIZE_MISMATCH:'גודל הטיק בגרף אינו תואם לפרופיל החשבון.',ACCOUNT_REVIEW_REQUIRED:'יש לבדוק את הגדרת החשבון לפני ההפעלה הזו.',COST_REVIEW_REQUIRED:'סמנו שבדקתם את החשבון ואת העלויות להפעלה הזו.'}[reason]??reason);

// This controller configures a local calculation profile. It does not connect
// an account, inspect credentials, place an order or enable trading shortcuts.
export function createLiveAccountControls({document:doc,storage,onInvalidate=()=>{},onProfileApplied=()=>{},now=Date.now}={}){
  if(!doc||typeof onInvalidate!=='function'||typeof onProfileApplied!=='function')throw TypeError('Account setup requires DOM and callbacks');
  const $=id=>doc.getElementById(id),dialog=$('account-dialog'),form=$('account-form'),selector=$('account-profile'),gate=createAccountStartGate({now});
  if(!dialog||!form||!selector)throw TypeError('Account setup markup is required');
  let profiles=[],selectedId=null,draftId='nq-default',pending=null,busy=false,initialized=false,disposed=false,lastMetadata=null,editSnapshot=null;
  const listeners=[];
  const listen=(node,event,handler)=>{node.addEventListener(event,handler);listeners.push([node,event,handler]);};
  function rawProfile(){return {schemaVersion:1,id:draftId,...Object.fromEntries(Object.entries(inputMap).map(([key,id])=>[key,$(id).value.trim()])),costBasis:'USER_SPECIFIED'};}
  function writeProfile(profile){draftId=profile.id;for(const [key,id] of Object.entries(inputMap))$(id).value=profile[key]===undefined?'':String(profile[key]);$('require-risk').checked=true;$('require-risk').disabled=true;}
  function freshDraft(){return {schemaVersion:1,id:'account-'+now().toString(36)+'-'+Math.random().toString(36).slice(2,7),label:'',brokerLabel:'',mode:'PAPER',instrument:'CME_MINI:NQ1!',currency:'USD',tickSize:'0.25',riskBudget:'200',pointValue:'20',maxContracts:'1',commissionPerContract:'',slippageTicks:'',rewardRisk:'2',costBasis:'USER_SPECIFIED'};}
  function normalizeDraft(){
    if(!$('account-label').value.trim())return {ok:false,profile:null,reasonCodes:['שם הפרופיל נדרש כדי לזהות את החשבון לפני התחלה.']};
    const result=normalizeAccountProfile(rawProfile());
    if(!result.ok)return {...result,reasonCodes:['יש להשלים נכס מדויק, תקציב חיובי, מספר חוזים שלם, גודל טיק וערך נקודה חיוביים ועמלה והחלקה לא שליליות. שדה עלות ריק אינו נחשב לאפס.']};
    return result;
  }
  function showError(messages){$('account-form-error').textContent=messages.map(reasonText).join('\n');$('account-form-error').hidden=false;$('account-form-error').scrollIntoView?.({block:'nearest'});}
  function clearError(){$('account-form-error').hidden=true;$('account-form-error').textContent='';}
  function renderBudget(){
    const result=normalizeDraft();
    $('start-account-session').disabled=busy||!pending||!$('account-costs-reviewed').checked||!result.ok;
    if(!result.ok){$('account-budget-summary').textContent='השלימו את פרטי החשבון ואת שתי העלויות. יש להזין 0 במפורש אם בחרתם הנחת עלות אפס.';return;}
    const p=result.profile,tickValue=p.tickSize*p.pointValue,cost=p.commissionPerContract+p.slippageTicks*tickValue,remaining=p.riskBudget-cost,maxTicks=Math.max(0,Math.floor((remaining+1e-9)/tickValue));
    $('account-budget-summary').textContent=`${p.label} · ${p.instrument} · ${modeNames[p.mode]}\nתקציב ${number(p.riskBudget)} דולר · עד ${number(p.maxContracts)} חוזים. עמלה והחלקה מתוכננות לחוזה: ${number(cost)} דולר. לחוזה אחד נותרים עד ${number(Math.max(0,remaining))} דולר למרחק הסטופ (${number(maxTicks)} טיקים).`;
    if(remaining<tickValue)$('account-budget-summary').textContent+=' התקציב אינו מאפשר סיכון של טיק אחד לחוזה; לא יאושר מערך כזה.';
  }
  function renderSummary(){
    const r=normalizeAccountProfile(rawProfile()),review=gate.snapshot().review;
    $('account-review-badge').textContent=review?'ההגדרות נבדקו להפעלה הזו':'נדרשת בדיקה בכל התחלה';$('account-review-badge').dataset.state=review?'reviewed':'pending';
    $('account-summary').textContent=r.ok?`${r.profile.label||r.profile.instrument} · ${modeNames[r.profile.mode]} · ${r.profile.instrument} · תקציב ${number(r.profile.riskBudget)} דולר · עד ${number(r.profile.maxContracts)} חוזים · עמלה ${number(r.profile.commissionPerContract)} דולר + החלקה ${number(r.profile.slippageTicks)} טיקים לסיבוב.`:'השלימו את פרופיל החשבון ואת העלויות לפני הפעלת המעקב והאיתותים.';
    renderBudget();
  }
  function renderProfiles(){
    const entries=profiles.map(p=>({id:p.id,text:p.label||p.instrument}));if(!entries.some(p=>p.id===draftId))entries.unshift({id:draftId,text:$('account-label').value.trim()||'פרופיל חדש · טרם נשמר'});
    selector.replaceChildren(...entries.map(item=>{const option=doc.createElement('option');option.value=item.id;option.textContent=item.text;return option;}));selector.value=draftId;
  }
  function invalidate(reason='ACCOUNT_SETTINGS_CHANGED',{notify=true}={}){
    gate.reset(reason);lastMetadata=null;$('account-costs-reviewed').checked=false;renderSummary();
    if(notify)onInvalidate(reason);
  }
  function setBusy(value){busy=value;for(const id of [...Object.values(inputMap),'account-costs-reviewed','start-account-session','save-account-profile','cancel-account','cancel-account-top'])$(id).disabled=value;$('require-risk').disabled=true;renderBudget();}
  function cancel(){if(busy)return;const resolve=pending?.resolve;pending=null;if(editSnapshot){selectedId=editSnapshot.selectedId;writeProfile(editSnapshot.profile);renderProfiles();renderSummary();}editSnapshot=null;dialog.close();clearError();$('account-dialog-status').textContent='';resolve?.(null);}
  function show({start=false,sourceTabId=null,fresh=false}={}){
    if(!initialized||disposed||busy)return null;
    editSnapshot={profile:copy(rawProfile()),selectedId};invalidate('ACCOUNT_SETUP_OPENED');if(fresh){selectedId=null;writeProfile(freshDraft());renderProfiles();}
    clearError();$('account-costs-reviewed').checked=false;$('start-account-session').hidden=!start;$('account-dialog-title').textContent=start?'הגדרת החשבון לפני התחלת המעקב':'הגדרת פרופיל חשבון';$('account-dialog-status').textContent=start?'המעקב יתחיל רק לאחר בדיקת הערכים להפעלה הזו.':'שמירת פרופיל אינה מפעילה מעקב. לפני כל התחלה תידרש בדיקה נוספת.';renderSummary();
    if(!dialog.open)dialog.showModal();$('account-label').focus();
    if(!start)return null;
    return new Promise(resolve=>{pending={resolve,sourceTabId};});
  }
  async function save({start=false}={}){
    if(disposed||busy)return;clearError();const normalized=normalizeDraft();if(!normalized.ok){showError(normalized.reasonCodes);return;}
    if(start&&(!pending||!$('account-costs-reviewed').checked)){showError(['COST_REVIEW_REQUIRED']);return;}
    const profile=normalized.profile,nextProfiles=profiles.filter(p=>p.id!==profile.id);nextProfiles.push(profile);
    if(nextProfiles.length>12){showError(['אפשר לשמור עד 12 פרופילים. ערכו פרופיל קיים.']);return;}
    const collection=makeAccountProfileCollection(nextProfiles,profile.id,now());setBusy(true);
    try{
      const result=await saveAccountProfiles(storage,collection);profiles=collection.profiles;selectedId=profile.id;writeProfile(profile);editSnapshot={profile:copy(profile),selectedId};renderProfiles();
      $('account-storage-note').textContent=result.status==='SAVED'?'פרופילי החשבונות נשמרו במחשב. לפני כל הפעלה נדרשת בדיקה חדשה.':'הפרופיל זמין בהפעלה הזו, אך השמירה המקומית אינה זמינה; יש להזין אותו שוב בפתיחה הבאה.';
      onProfileApplied(copy(profile));
      if(start){
        const accepted=gate.confirm(profile,{costsReviewed:true,source:'USER_CONFIRMED_SETUP',sourceTabId:pending.sourceTabId});
        if(!accepted.ok){showError(accepted.reasonCodes);return;}
        const resolve=pending.resolve;pending=null;editSnapshot=null;dialog.close();renderSummary();resolve({...copy(accepted),storageStatus:result.status});
      }else{invalidate('PROFILE_SAVED_REVIEW_REQUIRED');$('account-dialog-status').textContent=result.status==='SAVED'?'הפרופיל נשמר. אפשר לסגור; התחלת מעקב תדרוש בדיקה נפרדת.':'הפרופיל הוחל בזיכרון בלבד. התחלת מעקב תדרוש בדיקה נפרדת.';renderSummary();}
    }catch(error){showError(['שמירת הפרופיל נכשלה: '+String(error?.message??error).slice(0,160)]);}
    finally{setBusy(false);}
  }
  async function initialize(){
    const loaded=await loadAccountProfiles(storage);if(disposed)return;
    if(loaded.collection){profiles=loaded.collection.profiles;selectedId=loaded.collection.selectedProfileId;const selected=profiles.find(p=>p.id===selectedId)??profiles[0];if(selected){selectedId=selected.id;writeProfile(selected);}}
    if(!profiles.length){const legacy=freshDraft();legacy.id='nq-default';legacy.label='חשבון NQ';for(const [key,id] of Object.entries(inputMap))if(['riskBudget','pointValue','maxContracts','commissionPerContract','slippageTicks','rewardRisk'].includes(key)){legacy[key]=$(id).value.trim()||(key==='riskBudget'?'200':key==='pointValue'?'20':key==='maxContracts'?'1':key==='rewardRisk'?'2':'');}writeProfile(legacy);}
    initialized=true;gate.reset('ACCOUNT_REVIEW_REQUIRED');renderProfiles();renderSummary();$('account-storage-note').textContent=loaded.status==='RESTORED'?'הפרופילים נשמרו במחשב ונטענו. לפני ההתחלה הקרובה יש לבדוק את ההגדרות שוב.':loaded.status==='INVALID'?'פרופילים שמורים לא תקינים לא נטענו. הגדירו פרופיל תקין.':loaded.status==='UNAVAILABLE'?'שמירת פרופילים אינה זמינה כרגע. ניתן להגדיר פרופיל להפעלה הזו.':'הזינו פרופיל חשבון ושמרו אותו לשימוש חוזר.';
  }
  listen(form,'submit',event=>{event.preventDefault();void save({start:!!pending});});listen($('save-account-profile'),'click',()=>{void save();});listen($('cancel-account'),'click',cancel);listen($('cancel-account-top'),'click',cancel);listen(dialog,'cancel',event=>{event.preventDefault();cancel();});listen(dialog,'close',()=>{if(pending){const resolve=pending.resolve;pending=null;resolve(null);}});
  listen($('edit-account'),'click',()=>{show();});listen($('new-account'),'click',()=>{show({fresh:true});});
  listen($('account-costs-reviewed'),'input',renderBudget);listen($('account-costs-reviewed'),'change',renderBudget);
  listen(selector,'change',()=>{const profile=profiles.find(p=>p.id===selector.value);if(!profile)return;invalidate('ACCOUNT_PROFILE_CHANGED');selectedId=profile.id;writeProfile(profile);renderProfiles();renderSummary();onProfileApplied(copy(profile));});
  for(const id of Object.values(inputMap))listen($(id),'input',()=>{invalidate('ACCOUNT_SETTINGS_CHANGED');clearError();renderSummary();});
  return {initialize,requestReview:sourceTabId=>show({start:true,sourceTabId}),invalidate,
    evaluateMetadata(metadata,sourceTabId){const before=gate.snapshot().review?.reviewId,result=gate.evaluate(rawProfile(),metadata,{sourceTabId});lastMetadata=metadata?{instrument:metadata.instrument,tickSize:metadata.tickSize,pointValue:metadata.pointValue}:null;if(before!==gate.snapshot().review?.reviewId)renderSummary();return result;},
    profile:()=>normalizeAccountProfile(rawProfile()),snapshot:()=>({...gate.snapshot(),selectedProfileId:selectedId,draftProfile:normalizeAccountProfile(rawProfile()).profile,currentMetadata:lastMetadata,ordersAuthorized:false}),
    dispose(){disposed=true;const resolve=pending?.resolve;pending=null;resolve?.(null);gate.reset('PAGE_CLOSED');if(dialog.open)dialog.close();for(const [node,event,handler] of listeners)node.removeEventListener(event,handler);},
  };
}
