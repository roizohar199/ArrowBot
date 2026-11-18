import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramAlerts,telegramLiveSignal,telegramPaperFill} from '../telegram-alerts.mjs';

const token='123456789:'+'synthetic_test_token_0123456789012345';
const now=Date.parse('2026-11-18T12:20:00Z');
const pairingCode='controlled-pairing-code';
const privateChat={id:42,type:'private'};
const user={id:42,is_bot:false};
const response=(result,status=200)=>({ok:status===200,status,json:async()=>status===200?{ok:true,result}:{ok:false,error_code:status,description:token}});
function storage(){
  const state={};
  return {get:async key=>({[key]:structuredClone(state[key])}),set:async values=>Object.assign(state,structuredClone(values)),
    remove:async keys=>{for(const key of [keys].flat())delete state[key];}};
}
function fixture(){
  const calls=[], replies={}, local=storage(), session=storage();
  const defaults={getMe:response({is_bot:true,username:'ExampleArrowAlertsBot'}),getWebhookInfo:response({url:''}),getUpdates:response([]),sendMessage:response({message_id:1})};
  let time=now;
  const options={local,session,now:()=>time,nonce:()=>pairingCode,fetch:async(url,request)=>{
    assert.equal(new URL(url).origin,'https://api.telegram.org');
    assert.equal(request.redirect,'error');
    const method=url.split('/').at(-1);
    calls.push({method,body:JSON.parse(request.body)});
    return replies[method]??defaults[method];
  }};
  const handle=createTelegramAlerts(options);
  const pair=async()=>{
    assert.equal((await handle({action:'begin',token})).ok,true);
    replies.getUpdates=response([{message:{chat:privateChat,from:user,text:`/start ${pairingCode}`}}]);
    const result=await handle({action:'finish'});
    assert.equal(result.ok,true);
    return result;
  };
  return {handle,pair,calls,replies,restart:()=>createTelegramAlerts(options),advance:ms=>{time+=ms;}};
}

const signal={type:'signal',instrument:'CME_MINI:NQZ2026',timeframe:'1',direction:'LONG',price:26884,at:now};
const fill={type:'fill',instrument:signal.instrument,direction:signal.direction,price:26885.25,at:now,orderId:'3817983124'};

test('pairs the existing bot with one private chat using the new Start code',async()=>{
  const f=fixture();
  const begin=await f.handle({action:'begin',token});
  assert.equal(begin.pairing.url,`https://t.me/ExampleArrowAlertsBot?start=${pairingCode}`);
  f.replies.getUpdates=response([{message:{chat:privateChat,from:user,text:'/start old-code'}},{message:{chat:{...privateChat,type:'group'},from:user,text:`/start ${pairingCode}`}}]);
  assert.deepEqual(await f.handle({action:'finish'}),{ok:false,reason:'PAIRING_START_REQUIRED'});
  f.replies.getUpdates=response([{message:{chat:privateChat,from:user,text:`/start ${pairingCode}`}}]);
  const connected=await f.restart()({action:'finish'});
  assert.deepEqual(connected,{ok:true,settings:{bot:'ExampleArrowAlertsBot',signal:true,fill:true},pairing:null,delivery:null});
  assert.deepEqual(f.calls.filter(call=>call.method==='getUpdates').at(-1).body,{timeout:0,limit:100});
  await f.handle({action:'test'});
  assert.equal(f.calls.at(-1).body.chat_id,42);
  assert.match(f.calls.at(-1).body.text,/הודעת בדיקה/);
});

test('keeps an existing webhook and verifies the private chat through an explicit one-time message',async()=>{
  const f=fixture();
  f.replies.getWebhookInfo=response({url:'https://example.com/hook'});
  assert.deepEqual((await f.handle({action:'begin',token})).pairing,{mode:'chatId',url:'https://t.me/ExampleArrowAlertsBot',codeSent:false});
  assert.deepEqual(f.calls.map(call=>call.method),['getMe','getWebhookInfo']);
  assert.deepEqual(await f.handle({action:'sendVerificationCode',chatId:'-42'}),{ok:false,reason:'CHAT_ID_INVALID'});
  f.replies.getChat=response({...privateChat,type:'group'});
  assert.deepEqual(await f.handle({action:'sendVerificationCode',chatId:'42'}),{ok:false,reason:'CHAT_UNAVAILABLE'});
  assert.ok(!f.calls.some(call=>call.method==='sendMessage'));
  f.replies.getChat=response(privateChat);
  f.replies.sendMessage=response({message_id:1,chat:privateChat});
  const sent=await f.handle({action:'sendVerificationCode',chatId:'id: 42'});
  assert.equal(sent.pairing.codeSent,true);
  assert.equal(sent.settings,null);
  const code=f.calls.at(-1).body.text.split('\n')[1];
  assert.ok(!JSON.stringify(sent).includes(code));
  assert.equal(f.calls.at(-1).body.chat_id,42);
  assert.deepEqual(await f.handle({action:'verifyChat',code:'incorrect'}),{ok:false,reason:'PAIRING_CODE_INVALID'});
  const connected=await f.restart()({action:'verifyChat',code:code.toLowerCase()});
  assert.equal(connected.settings.bot,'ExampleArrowAlertsBot');
  assert.ok(f.calls.every(call=>['getMe','getWebhookInfo','getChat','sendMessage'].includes(call.method)));
});

test('offers Chat ID if Telegram returns a polling conflict after a successful start',async()=>{
  const f=fixture();
  await f.handle({action:'begin',token});
  f.replies.getUpdates=response(null,409);
  const result=await f.handle({action:'finish'});
  assert.deepEqual(result.pairing,{mode:'chatId',url:'https://t.me/ExampleArrowAlertsBot',codeSent:false});
  assert.equal((await f.handle({action:'finish'})).pairing.mode,'chatId');
  assert.equal(f.calls.filter(call=>call.method==='getUpdates').length,1);
});

test('expires unfinished pairing',async()=>{
  const f=fixture();
  await f.handle({action:'begin',token});
  f.advance(15*60_000);
  assert.deepEqual(await f.handle({action:'finish'}),{ok:false,reason:'PAIRING_EXPIRED'});
});

test('delivers distinct messages for new signals and verified fills, once across concurrent panels and restarts',async()=>{
  const f=fixture();
  await f.handle({action:'deliver',event:signal});
  assert.equal(f.calls.length,0);
  await f.pair();
  await Promise.all([f.handle({action:'deliver',event:signal}),f.handle({action:'deliver',event:signal}),f.handle({action:'deliver',event:fill})]);
  await f.restart()({action:'deliver',event:fill});
  const sent=f.calls.filter(call=>call.method==='sendMessage');
  assert.equal(sent.length,2);
  assert.match(sent[0].body.text,/איתות כניסה חי.*\n.*לונג\nמחיר אישור 26884/);
  assert.match(sent[1].body.text,/כניסה מאומתת בפייפר.*\n.*לונג\nמחיר ביצוע 26885\.25/);
  await f.handle({action:'configure',signal:false,fill:true});
  f.advance(60_000);
  assert.equal((await f.handle({action:'deliver',event:{...signal,at:now+60_000}})).skipped,true);
  assert.equal((await f.handle({action:'deliver',event:{...fill,at:now-1}})).skipped,true);
  await f.handle({action:'disconnect'});
  assert.equal((await f.restart()({action:'status'})).settings,null);
});

test('reports a Telegram rejection without returning the API response or leaking the token',async()=>{
  const f=fixture();
  await f.pair();
  f.replies.sendMessage=response(null,403);
  assert.deepEqual(await f.handle({action:'test'}),{ok:false,reason:'CHAT_UNAVAILABLE'});
  const status=await f.handle({action:'status'});
  assert.deepEqual(status.delivery,{type:'test',at:now,ok:false,reason:'CHAT_UNAVAILABLE'});
  assert.ok(!JSON.stringify(status).includes(token));
});

test('projects only a post-warmup signal or a native Paper fill with verified ownership and timestamp',()=>{
  const raw={status:'CONFIRMED',instrument:signal.instrument,timeframe:signal.timeframe,direction:signal.direction,confirmationBarCloseTime:now,confirmationClose:signal.price};
  assert.equal(telegramLiveSignal(raw),null);
  assert.deepEqual(telegramLiveSignal({...raw,liveEligibility:{policy:'POST_BOOTSTRAP_FORMATION_AND_ELIGIBLE_SOURCE_CLOSE'}}),signal);
  const account={provider:'TRADINGVIEW_PAPER',environment:'DEMO',nativeAccountId:'fixture'};
  const native={kind:'NATIVE_EXECUTED_FILL_V1',origin:'PUBLIC_NATIVE_UI',...account,nativeOrderId:fill.orderId,direction:'LONG',price:fill.price,filledAt:now,
    timeText:'2026-11-18 14:20:00',timestampField:'closeDate',timestampPrecisionMs:1000,utcOffsetMinutes:120,timezoneBasis:'VISIBLE_CHART_TIMEZONE_MENU',
    orderRow:{id:fill.orderId,symbol:fill.instrument,side:'Buy',type:'Market',status:'filled',avgPrice:'26,885.25',closeDate:'2026-11-18 14:20:00'}};
  const verified={...account,nativeOrderId:fill.orderId,ownedStatus:'FILLED',direction:'LONG',fillVerified:true,ownershipVerified:true,nativeFill:native};
  assert.deepEqual(telegramPaperFill(verified),fill);
  for(const unproven of [{...verified,fillVerified:false},{...verified,ownershipVerified:false},{...verified,provider:'TRADOVATE'},
    {...verified,restoredFromDurableFill:true},{...verified,testOnly:true},{...verified,nativeFill:{...native,timestampField:'placingTime'}}]){
    assert.equal(telegramPaperFill(unproven),null);
  }
});
