import {TELEGRAM_ORIGIN,TELEGRAM_CHANNEL,TELEGRAM_SETTINGS,TELEGRAM_DELIVERY,telegramLiveSignal,telegramPaperFill} from './telegram-alerts.mjs';

const errors={
  INVALID_TOKEN:'הטוקן אינו תקין. בדקו את הטוקן הקיים ב־BotFather.',
  PERMISSION_REQUIRED:'כדי להתחבר, יש לאפשר ל־Arrow גישה ל־Telegram בחלון ההרשאה של Chrome.',
  PAIRING_START_REQUIRED:'טרם התקבל Start. פתחו את קישור החיבור ולחצו Start בצ׳אט הפרטי, ואז נסו שוב.',
  PAIRING_EXPIRED:'תוקף קישור החיבור פג. הזינו שוב את הטוקן כדי לקבל קישור חדש.',
  PAIRING_AMBIGUOUS:'קישור החיבור נפתח ביותר מצ׳אט אחד. צרו קישור חדש ופתחו אותו רק בחשבון שלכם.',
  CHAT_UNAVAILABLE:'לא ניתן לשלוח לצ׳אט הזה. בדקו את המזהה ולחצו Start בצ׳אט הפרטי עם הבוט.',
  CHAT_ID_INVALID:'הזינו את המזהה המספרי של החשבון הפרטי שלכם בטלגרם.',
  PAIRING_CODE_INVALID:'הקוד אינו תואם. הזינו את הקוד האחרון שהתקבל בצ׳אט הפרטי.',
  RATE_LIMITED:'טלגרם הגבילה את קצב השליחה. נסו שוב בעוד רגע.',
  TELEGRAM_NETWORK:'לא התקבלה תשובה מטלגרם. בדקו אם ההודעה הגיעה לצ׳אט ואת חיבור הרשת.',
  ALREADY_LINKED:'כבר קיים חיבור לטלגרם בלוח.',
  NOT_LINKED:'יש לחבר צ׳אט פרטי לפני השימוש.',
};
const errorText=reason=>errors[reason]??'פעולת הטלגרם לא הושלמה.';
const kindLabels={signal:'איתות כניסה',fill:'כניסה מאומתת בפייפר',test:'הודעת בדיקה'};

export function createLiveTelegramControls({document,chrome}={}){
  const panel=document?.getElementById('telegram-alerts');
  if(!panel||typeof chrome?.permissions?.request!=='function'||typeof chrome.runtime?.sendMessage!=='function')return null;
  const $=name=>document.getElementById('telegram-'+name);
  const status=$('status'),delivery=$('delivery'),token=$('token'),begin=$('begin'),finish=$('finish'),link=$('link');
  const manualLink=$('manual-link'),chatId=$('chat-id'),sendCode=$('send-code'),code=$('code'),verify=$('verify-code');
  const signal=$('signal'),fill=$('fill'),save=$('save'),test=$('test'),disconnect=$('disconnect');
  const buttons=[begin,finish,sendCode,verify,save,test,disconnect];
  let busy=false,ready=false,disposed=false,refreshId=0;
  const send=(action,options={})=>chrome.runtime.sendMessage({type:TELEGRAM_CHANNEL,action,...options});
  const setDisabled=()=>buttons.forEach(button=>{button.disabled=busy||!ready;});

  function render(state){
    const connected=!!state.settings;
    const manual=state.pairing?.mode==='chatId';
    $('pair-form').hidden=connected;
    $('pair-step').hidden=connected||!state.pairing||manual;
    $('manual-step').hidden=connected||!manual;
    $('verify-step').hidden=connected||!manual||!state.pairing.codeSent;
    $('options').hidden=!connected;
    link.removeAttribute('href');
    manualLink.removeAttribute('href');
    if(state.pairing)(manual?manualLink:link).href=state.pairing.url;
    signal.checked=state.settings?.signal===true;
    fill.checked=state.settings?.fill===true;
    if(connected)status.textContent=`מחובר ל־@${state.settings.bot}`;
    else if(manual)status.textContent=state.pairing.codeSent?'קוד אימות נשלח לצ׳אט הפרטי. הזינו אותו כאן.':'לבוט כבר יש חיבור שמקבל הודעות. אפשר לשייך את הצ׳אט לשליחה באמצעות Chat ID.';
    else status.textContent=state.pairing?'קישור החיבור מוכן. פתחו אותו בטלגרם, לחצו Start וחזרו ללוח.':'התראות טלגרם כבויות. הזינו את הטוקן של הבוט שתרצו לחבר.';
    renderDelivery(state.delivery);
  }

  function renderDelivery(last){
    delivery.textContent=last?`${kindLabels[last.type]} · ${last.ok?'טלגרם אישרה את השליחה':errorText(last.reason)} · ${new Date(last.at).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem'})}`:'';
  }

  async function refresh(){
    if(disposed||busy)return;
    const current=++refreshId;
    try{
      const state=await send('status');
      if(disposed||busy||current!==refreshId)return;
      if(!state?.ok)throw Error('TELEGRAM_STATUS_UNAVAILABLE');
      ready=true;render(state);setDisabled();
    }catch{
      if(!disposed&&!busy&&current===refreshId)status.textContent='חיבור הטלגרם של ההרחבה אינו זמין כרגע.';
    }
  }

  async function perform(action,request,success){
    if(busy||!ready)return;
    busy=true;refreshId++;setDisabled();
    status.textContent='מעדכן את חיבור הטלגרם…';
    try{
      const result=await request();
      if(disposed)return;
      if(action==='test'){
        const state=await send('status');
        if(state?.ok&&!disposed)render(state);
      }else if(result?.ok)render(result);
      if(!result?.ok){status.textContent=errorText(result?.reason);return;}
      if(success)status.textContent=success+status.textContent;
      if(action==='begin')token.value='';
      if(action==='sendVerificationCode'||action==='verifyChat')code.value='';
      if(action==='verifyChat')chatId.value='';
    }catch{
      if(!disposed)status.textContent=errorText();
    }finally{
      busy=false;setDisabled();
    }
  }

  begin.addEventListener('click',()=>{void perform('begin',async()=>{
    if(!token.reportValidity())return {ok:false,reason:'INVALID_TOKEN'};
    const granted=await chrome.permissions.request({origins:[TELEGRAM_ORIGIN]});
    return granted?send('begin',{token:token.value.trim()}):{ok:false,reason:'PERMISSION_REQUIRED'};
  });});
  finish.addEventListener('click',()=>{void perform('finish',()=>send('finish'));});
  sendCode.addEventListener('click',()=>{void perform('sendVerificationCode',()=>send('sendVerificationCode',{chatId:chatId.value}));});
  verify.addEventListener('click',()=>{void perform('verifyChat',()=>send('verifyChat',{code:code.value}));});
  save.addEventListener('click',()=>{void perform('configure',()=>send('configure',{signal:signal.checked,fill:fill.checked}),'העדפות נשמרו. ');});
  test.addEventListener('click',()=>{void perform('test',()=>send('test'),'הודעת בדיקה נשלחה. ');});
  disconnect.addEventListener('click',()=>{void perform('disconnect',()=>send('disconnect'),'החיבור נותק. ');});
  const storageChanged=(changes,area)=>{
    if(area!=='local')return;
    if(Object.hasOwn(changes,TELEGRAM_SETTINGS))void refresh();
    else if(Object.hasOwn(changes,TELEGRAM_DELIVERY)&&!disposed)renderDelivery(changes[TELEGRAM_DELIVERY].newValue);
  };
  chrome.storage?.onChanged?.addListener(storageChanged);
  panel.hidden=false;
  setDisabled();
  void refresh();

  function deliver(event){if(event&&!disposed)void send('deliver',{event}).catch(()=>{});}
  return {
    signal:signal=>deliver(telegramLiveSignal(signal)),
    fill:fill=>deliver(telegramPaperFill(fill)),
    dispose(){disposed=true;chrome.storage?.onChanged?.removeListener(storageChanged);},
  };
}
