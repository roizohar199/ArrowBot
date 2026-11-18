import {validNativeFill} from './fill-marker-payload.mjs';

export const TELEGRAM_ORIGIN='https://api.telegram.org/*';
export const TELEGRAM_CHANNEL='ARROW_TELEGRAM_ALERTS';
export const TELEGRAM_SETTINGS='arrowTelegramAlerts';
export const TELEGRAM_DELIVERY='arrowTelegramDelivery';
const PAIRING='arrowTelegramPairing', ATTEMPTS='arrowTelegramAttempts';
const PAIRING_AGE=15*60_000, LIVE_EVENT_AGE=2*60_000;
const botName=/^[a-z0-9_]{5,32}$/i;
const instrumentName=/^[A-Z0-9:_!./-]{1,48}$/i;
const dateFormat=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'medium'});
const failure=reason=>({ok:false,reason});
const directionLabel=direction=>({LONG:'לונג',SHORT:'שורט'}[direction]);

export function telegramLiveSignal(signal){
  if(signal?.status!=='CONFIRMED'||signal.liveEligibility?.policy!=='POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE')return null;
  return {type:'signal',direction:signal.direction,instrument:signal.instrument,timeframe:signal.timeframe,at:signal.confirmationBarCloseTime,price:signal.confirmationClose};
}

export function telegramPaperFill(fill){
  const native=fill?.nativeFill;
  if(fill?.provider!=='TRADINGVIEW_PAPER'||fill.fillVerified!==true||fill.ownershipVerified!==true||fill.testOnly===true||fill.synthetic===true||fill.restoredFromDurableFill===true||
    !['FILLED','CLOSED'].includes(fill.ownedStatus)||fill.nativeOrderId!==native?.nativeOrderId||!validNativeFill(native,fill,fill.direction))return null;
  return {type:'fill',direction:native.direction,instrument:native.orderRow.symbol,at:native.filledAt,price:native.price,orderId:native.nativeOrderId};
}

function validateDelivery(event,now){
  if(!event||!['signal','fill'].includes(event.type)||!['LONG','SHORT'].includes(event.direction)||!instrumentName.test(event.instrument??'')||
    !Number.isSafeInteger(event.at)||event.at>now+5_000||now-event.at>LIVE_EVENT_AGE||!Number.isFinite(event.price)||event.price<=0)return null;
  if(event.type==='fill'&&!/^\d{1,20}$/.test(event.orderId??'')||event.type==='signal'&&!/^[a-z0-9]{1,12}$/i.test(event.timeframe??''))return null;
  const [label,priceLabel]=event.type==='fill'?['כניסה מאומתת בפייפר','מחיר ביצוע']:['איתות כניסה חי','מחיר אישור'];
  const key=event.type==='fill'?`fill:${event.instrument}:${event.orderId}`:`signal:${event.instrument}:${event.timeframe}:${event.direction}:${event.at}`;
  return {key,text:`Arrow · ${label}\n${event.instrument} · ${directionLabel(event.direction)}\n${priceLabel} ${event.price}\n${dateFormat.format(event.at)} · שעון ישראל`};
}

function telegramError(httpStatus,body){
  const code=body?.error_code??httpStatus;
  if(code===401)return 'INVALID_TOKEN';
  if(code===403)return 'CHAT_UNAVAILABLE';
  if(code===409)return 'PAIRING_CONFLICT';
  if(code===429)return 'RATE_LIMITED';
  return 'TELEGRAM_REJECTED';
}

export function createTelegramAlerts({local,session,fetch=globalThis.fetch,now=Date.now,nonce=()=>crypto.randomUUID()}={}){
  let work=Promise.resolve();
  const read=async(area,key)=>(await area.get(key))[key];
  async function api(token,method,params={}){
    try{
      const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),
        signal:AbortSignal.timeout(6_000),redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
      });
      const body=await response.json();
      return response.ok&&body?.ok===true?{ok:true,value:body.result}:failure(telegramError(response.status,body));
    }catch{return failure('TELEGRAM_NETWORK');}
  }
  async function pairing(){
    const value=await read(session,PAIRING);
    if(value&&now()<value.expiresAt)return value;
    if(value)await session.remove(PAIRING);
    return null;
  }
  async function status(){
    const settings=await read(local,TELEGRAM_SETTINGS);
    const delivery=await read(local,TELEGRAM_DELIVERY);
    const pending=settings?null:await pairing();
    const botUrl=pending?`https://t.me/${pending.bot}`:null;
    const connection=pending?.manual===true?{mode:'chatId',url:botUrl,codeSent:!!pending.chatId}:pending?{url:`${botUrl}?start=${pending.code}`}:null;
    return {ok:true,settings:settings?{bot:settings.bot,signal:settings.signal,fill:settings.fill}:null,
      pairing:connection,delivery:delivery??null};
  }
  async function begin(token){
    if(await read(local,TELEGRAM_SETTINGS))return failure('ALREADY_LINKED');
    if(typeof token!=='string'||!/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/.test(token))return failure('INVALID_TOKEN');
    const bot=await api(token,'getMe');
    if(!bot.ok)return bot;
    if(bot.value?.is_bot!==true||!botName.test(bot.value.username??''))return failure('INVALID_TOKEN');
    const webhook=await api(token,'getWebhookInfo');
    if(!webhook.ok)return webhook;
    const manual=!!webhook.value?.url;
    await session.set({[PAIRING]:{token,bot:bot.value.username,manual,code:manual?null:nonce(),expiresAt:now()+PAIRING_AGE}});
    return status();
  }
  async function connect(pending,chatId){
    await local.set({[TELEGRAM_SETTINGS]:{token:pending.token,bot:pending.bot,chatId,signal:true,fill:true,linkedAt:now()},
      [TELEGRAM_DELIVERY]:null,[ATTEMPTS]:[]});
    await session.remove(PAIRING);
    return status();
  }
  async function finish(){
    if(await read(local,TELEGRAM_SETTINGS))return failure('ALREADY_LINKED');
    const pending=await pairing();
    if(!pending)return failure('PAIRING_EXPIRED');
    if(pending.manual)return status();
    const updates=await api(pending.token,'getUpdates',{timeout:0,limit:100});
    if(updates.reason==='PAIRING_CONFLICT'){
      await session.set({[PAIRING]:{...pending,manual:true,code:null}});
      return status();
    }
    if(!updates.ok)return updates;
    const chats=new Set((Array.isArray(updates.value)?updates.value:[]).map(update=>update.message)
      .filter(message=>message?.text===`/start ${pending.code}`&&message.chat?.type==='private'&&message.chat.id===message.from?.id&&
        Number.isSafeInteger(message.chat.id)&&message.chat.id>0&&message.from.is_bot===false).map(message=>message.chat.id));
    if(!chats.size)return failure('PAIRING_START_REQUIRED');
    if(chats.size!==1)return failure('PAIRING_AMBIGUOUS');
    return connect(pending,[...chats][0]);
  }
  async function sendVerificationCode(rawId){
    if(await read(local,TELEGRAM_SETTINGS))return failure('ALREADY_LINKED');
    const pending=await pairing();
    if(!pending?.manual)return failure('PAIRING_EXPIRED');
    const id=typeof rawId==='string'?rawId.trim().replace(/^id:\s*/i,'').replaceAll(',',''):'';
    const chatId=Number(id);
    if(!/^[1-9]\d{0,15}$/.test(id)||chatId>=2**52)return failure('CHAT_ID_INVALID');
    const chat=await api(pending.token,'getChat',{chat_id:chatId});
    if(!chat.ok)return chat.reason==='TELEGRAM_REJECTED'?failure('CHAT_UNAVAILABLE'):chat;
    if(chat.value?.id!==chatId||chat.value?.type!=='private')return failure('CHAT_UNAVAILABLE');
    const code=nonce().slice(0,8).toUpperCase();
    const message=await api(pending.token,'sendMessage',{chat_id:chatId,text:`Arrow · קוד אימות לחיבור התראות\n${code}\nהזינו את הקוד בלוח Arrow כדי לאשר שההודעות מגיעות לצ׳אט שלכם.`});
    if(!message.ok)return message.reason==='TELEGRAM_REJECTED'?failure('CHAT_UNAVAILABLE'):message;
    if(message.value?.chat?.id!==chatId||message.value?.chat?.type!=='private')return failure('CHAT_UNAVAILABLE');
    await session.set({[PAIRING]:{...pending,chatId,code,expiresAt:now()+PAIRING_AGE}});
    return status();
  }
  async function verifyChat(code){
    if(await read(local,TELEGRAM_SETTINGS))return failure('ALREADY_LINKED');
    const pending=await pairing();
    if(!pending?.manual||!pending.chatId)return failure('PAIRING_EXPIRED');
    if(typeof code!=='string'||code.trim().toUpperCase()!==pending.code)return failure('PAIRING_CODE_INVALID');
    return connect(pending,pending.chatId);
  }
  async function send(settings,type,text){
    const result=await api(settings.token,'sendMessage',{chat_id:settings.chatId,text,link_preview_options:{is_disabled:true}});
    await local.set({[TELEGRAM_DELIVERY]:{type,at:now(),ok:result.ok,reason:result.reason??null}});
    return result.ok?{ok:true}:result;
  }
  async function deliver(event){
    const settings=await read(local,TELEGRAM_SETTINGS);
    const notice=validateDelivery(event,now());
    if(!notice||!settings||settings[event.type]!==true||event.at<settings.linkedAt)return {ok:true,skipped:true};
    const previous=(await read(local,ATTEMPTS)??[]).filter(record=>now()-record.at<10*60_000);
    if(previous.some(record=>record.key===notice.key))return {ok:true,skipped:true};
    // Reserve before sending. Telegram may accept a message even if its reply is lost.
    await local.set({[ATTEMPTS]:[...previous.slice(-199),{key:notice.key,at:now()}]});
    return send(settings,event.type,notice.text);
  }
  async function handle(message){
    switch(message.action){
      case 'status':return status();
      case 'begin':return begin(message.token);
      case 'finish':return finish();
      case 'sendVerificationCode':return sendVerificationCode(message.chatId);
      case 'verifyChat':return verifyChat(message.code);
      case 'deliver':return deliver(message.event);
      case 'configure':{
        const settings=await read(local,TELEGRAM_SETTINGS);
        if(!settings)return failure('NOT_LINKED');
        await local.set({[TELEGRAM_SETTINGS]:{...settings,signal:message.signal===true,fill:message.fill===true}});
        return status();
      }
      case 'test':{
        const settings=await read(local,TELEGRAM_SETTINGS);
        return settings?send(settings,'test','Arrow · הודעת בדיקה. החיבור לטלגרם פעיל.'):failure('NOT_LINKED');
      }
      case 'disconnect':
        await local.remove([TELEGRAM_SETTINGS,TELEGRAM_DELIVERY,ATTEMPTS]);
        await session.remove(PAIRING);
        return status();
      default:return failure('INVALID_ACTION');
    }
  }
  return message=>{
    const next=work.then(()=>handle(message)).catch(()=>failure('TELEGRAM_LOCAL'));
    work=next;
    return next;
  };
}

export function listenForTelegramAlerts(chrome){
  const handle=createTelegramAlerts({local:chrome.storage.local,session:chrome.storage.session});
  const dashboard=chrome.runtime.getURL('live-ohlc.html');
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!==TELEGRAM_CHANNEL||sender.id!==chrome.runtime.id||sender.url?.split(/[?#]/,1)[0]!==dashboard)return false;
    void handle(message).then(reply);
    return true;
  });
}
