// Authorized account discovery only. No login, token persistence, order writes,
// UI automation or execution capability. A simulation host does not identify PA.
export const TRADOVATE_ACCOUNT_API=Object.freeze({
  DEMO:'https://demo.tradovateapi.com/v1',
  LIVE:'https://live.tradovateapi.com/v1'
});
const clients=new WeakMap();
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const positiveId=value=>Number.isSafeInteger(value)&&value>0;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const fail=code=>Object.assign(new Error(code),{code});
const safeCodes=new Set(['CLIENT_CLOSED','ACCESS_TOKEN_UNAVAILABLE','ACCESS_TOKEN_REQUIRED','UNEXPECTED_API_DESTINATION',
  'AUTHENTICATION_REQUIRED','API_ACCESS_DENIED','API_RATE_LIMITED','API_HTTP_FAILURE','API_CAPTCHA_REQUIRES_USER',
  'API_BUSINESS_FAILURE','API_READ_TIMEOUT']);
const readonly=Object.freeze({inspectAccount:true,preflight:false,submitMarket:false,reconcile:false});
const profileEnvironments=Object.freeze(['REPLAY','DEMO','EVALUATION','PA','LIVE']);

export function createTradovateAccountReadClient({environment,getAccessToken,fetchImpl=globalThis.fetch,timeoutMs=5000,now=Date.now}={}){
  if(!Object.hasOwn(TRADOVATE_ACCOUNT_API,environment)||typeof getAccessToken!=='function'||typeof fetchImpl!=='function'
    ||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw fail('INVALID_TRADOVATE_READ_CLIENT_CONFIGURATION');
  const base=TRADOVATE_ACCOUNT_API[environment],inflight=new Set();let closed=false;
  async function get(path,query={}){
    if(closed)throw fail('CLIENT_CLOSED');
    const controller=new AbortController();inflight.add(controller);let timer;
    const url=new URL(base+path);
    for(const [key,value]of Object.entries(query))url.searchParams.set(key,String(value));
    try{
      const operation=(async()=>{
        let token;try{token=await getAccessToken();}catch{throw fail('ACCESS_TOKEN_UNAVAILABLE');}
        if(closed)throw fail('CLIENT_CLOSED');
        if(controller.signal.aborted)throw fail('API_READ_TIMEOUT');
        if(typeof token!=='string'||token.length<16||token.length>8192||/[\s\u0000-\u001f\u007f]/.test(token))throw fail('ACCESS_TOKEN_REQUIRED');
        const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+token},
          signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
        token=undefined;
        if(closed)throw fail('CLIENT_CLOSED');
        if(response.url&&response.url!==url.href)throw fail('UNEXPECTED_API_DESTINATION');
        if(response.status===401)throw fail('AUTHENTICATION_REQUIRED');
        if(response.status===403)throw fail('API_ACCESS_DENIED');
        if(response.status===429||response.status===423)throw fail('API_RATE_LIMITED');
        if(!response.ok)throw fail('API_HTTP_FAILURE');
        const value=await response.json();
        if(closed)throw fail('CLIENT_CLOSED');
        if(plain(value)&&['p-ticket','p-time','p-captcha'].some(key=>Object.hasOwn(value,key)))throw fail(Object.hasOwn(value,'p-captcha')?'API_CAPTCHA_REQUIRES_USER':'API_RATE_LIMITED');
        if(plain(value)&&(value.errorText||value.failureReason||value.failureText))throw fail('API_BUSINESS_FAILURE');
        return value;
      })();
      return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('API_READ_TIMEOUT'));},timeoutMs);})]);
    }catch(error){throw fail(safeCodes.has(error?.code)?error.code:'API_READ_FAILED');}
    finally{clearTimeout(timer);inflight.delete(controller);}
  }
  async function accounts(){
    const rows=await get('/account/list');
    if(!Array.isArray(rows)||rows.length>1000||rows.some(row=>!plain(row)||!positiveId(row.id)||!text(row.name,120)))throw fail('INVALID_ACCOUNT_LIST');
    if(new Set(rows.map(row=>row.id)).size!==rows.length)throw fail('DUPLICATE_ACCOUNT_ID');
    const observedAt=now();
    return rows.map(row=>({id:row.id,accountIdString:String(row.id),nativeAccountId:String(row.id),name:row.name,
      active:row.active===true,readOnly:row.readOnly!==false,provider:'TRADOVATE',environment,observedAt,
      source:{origin:base,endpoint:'/account/list',accountIdString:String(row.id)},
      accountOrigin:'UNVERIFIED',independentAccountVerified:false,automationAuthorized:false,ordersCreated:false}));
  }
  async function snapshot(accountId){
    if(!positiveId(accountId))throw fail('EXACT_ACCOUNT_REQUIRED');
    const listed=await accounts(),account=listed.find(row=>row.id===accountId);
    if(!account)throw fail('ACCOUNT_NOT_IN_AUTHENTICATED_LIST');
    const settled=await Promise.allSettled([get('/position/list'),get('/order/list')]);
    const rejected=settled.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
    const [positions,orders]=settled.map(result=>result.value);
    for(const rows of [positions,orders])if(!Array.isArray(rows)||rows.length>100000||rows.some(row=>!plain(row)||!positiveId(row.accountId)))throw fail('INVALID_ACCOUNT_SNAPSHOT');
    return {kind:'TRADOVATE_READ_ONLY_ACCOUNT_SNAPSHOT_V1',provider:'TRADOVATE',environment,account,accountIdString:account.accountIdString,
      positions:positions.filter(row=>row.accountId===accountId),orders:orders.filter(row=>row.accountId===accountId),observedAt:now(),
      // Separate REST reads are not an atomic, certified complete inventory.
      completeInventoryVerified:false,accountOrigin:'UNVERIFIED',readOnly:true,automationAuthorized:false,ordersCreated:false};
  }
  async function findNqContract(name){
    if(typeof name!=='string'||!/^NQ[HMUZ](?:\d|\d{2}|\d{4})$/.test(name))throw fail('DATED_NQ_CONTRACT_REQUIRED');
    const value=await get('/contract/find',{name});
    if(!plain(value)||!positiveId(value.id)||value.name!==name||!positiveId(value.contractMaturityId))throw fail('CONTRACT_IDENTITY_UNVERIFIED');
    return {id:value.id,name:value.name,contractMaturityId:value.contractMaturityId,provider:'TRADOVATE',environment,observedAt:now(),
      specificationVerified:false,continuousMappingVerified:false,automationAuthorized:false};
  }
  const client=Object.freeze({environment,apiOrigin:base,readOnly:true,accounts,snapshot,findNqContract,
    close(){closed=true;for(const controller of inflight)controller.abort();}});
  clients.set(client,{environment,base,isClosed:()=>closed});
  return client;
}

/** Profiles are declarations; only an authenticated exact API account read can
 * attest numeric broker identity. PA/EVALUATION names or DEMO hosts never prove
 * personal-API eligibility or permission to automate. The current consumer API
 * documentation excludes prop/evaluation accounts; Apex automation permission
 * has not been verified. This adapter has no execution operations in any mode.
 */
export function createTradovateAccountInspectionAdapter({getClient=async()=>null,now=Date.now}={}){
  if(typeof getClient!=='function'||typeof now!=='function')throw fail('INVALID_TRADOVATE_INSPECTION_ADAPTER_CONFIGURATION');
  return Object.freeze({id:'tradovate-api',provider:'TRADOVATE',label:'Tradovate API · קריאת חשבון בלבד',
    supportedEnvironments:profileEnvironments,capabilities:readonly,
    async inspectAccount({selection,account}={}){
      const declared=selection?.profile??account,profile=plain(declared)?{...declared}:declared,selectionKey=selection?.selectionKey;
      const base={readOnly:true,submitCapabilityCreated:false,ordersCreated:false,ordersAuthorized:false,environmentVerified:false};
      const blocked=(status,code)=>({...base,status,reasonCodes:[code]});
      if(!plain(profile)||profile.provider!=='TRADOVATE'||profile.adapterId!=='tradovate-api'||!text(profile.nativeAccountId,240)
        ||!profileEnvironments.includes(profile.environment)||!Number.isSafeInteger(profile.revision)||profile.revision<1||!text(selectionKey,2048))return blocked('NOT_CONNECTED','EXPLICIT_TRADOVATE_ACCOUNT_SELECTION_REQUIRED');
      if(account&&selection?.profile&&['provider','adapterId','nativeAccountId','environment','revision'].some(key=>account[key]!==profile[key]))return blocked('ACCOUNT_MISMATCH','SELECTED_ACCOUNT_PROFILE_CHANGED');
      let client;try{client=await getClient({selection:structuredClone(selection),account:{...profile}});}catch{return blocked('NOT_CONNECTED','AUTH_CONNECTION_UNAVAILABLE');}
      if(client==null)return blocked('NOT_CONNECTED','AUTH_CONNECTION_REQUIRED');
      const descriptor=clients.get(client);
      if(!descriptor||descriptor.isClosed())return blocked('NOT_CONNECTED','AUTHORIZED_TRADOVATE_READ_CLIENT_REQUIRED');
      if(['DEMO','LIVE'].includes(profile.environment)&&profile.environment!==descriptor.environment)return blocked('ACCOUNT_MISMATCH','SELECTED_AND_API_ENVIRONMENT_DIFFER');
      let listed;try{listed=await client.accounts();}catch(error){return blocked('NOT_CONNECTED',safeCodes.has(error?.code)?error.code:'AUTHORIZED_ACCOUNT_READ_FAILED');}
      // No number conversion: e.g. declared "017" is not authenticated id "17".
      const native=listed.find(row=>row.accountIdString===profile.nativeAccountId);
      if(!native)return blocked('ACCOUNT_MISMATCH','SELECTED_ACCOUNT_NOT_IN_AUTHENTICATED_LIST');
      const at=now();
      if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(native.observedAt)||native.observedAt<0||native.observedAt>at||at-native.observedAt>2000)return blocked('NOT_CONNECTED','ACCOUNT_OBSERVATION_STALE');
      const verified=['DEMO','LIVE'].includes(profile.environment)&&profile.environment===descriptor.environment;
      const reasonCodes=verified?[]:['ACCOUNT_ENVIRONMENT_NOT_BROKER_ATTESTED',...(['PA','EVALUATION'].includes(profile.environment)?['PERSONAL_API_PROP_EVALUATION_ACCESS_NOT_AVAILABLE','APEX_AUTOMATION_PERMISSION_NOT_VERIFIED']:[])];
      return {...base,status:verified?'NATIVE_ACCOUNT_OBSERVED':'READ_ONLY',environmentVerified:verified,reasonCodes,
        observation:{kind:'TRADOVATE_AUTHORIZED_ACCOUNT_OBSERVATION_V1',provider:'TRADOVATE',nativeAccountId:native.accountIdString,accountIdString:native.accountIdString,
          name:native.name,apiEnvironment:descriptor.environment,accountOrigin:'UNVERIFIED',active:native.active,readOnly:native.readOnly,
          source:{origin:descriptor.base,endpoint:'/account/list',accountIdString:native.accountIdString},observedAt:native.observedAt,
          automationAuthorized:false,ordersCreated:false},
        evidence:{kind:'NATIVE_EXECUTION_ACCOUNT_EVIDENCE_V1',provider:'TRADOVATE',nativeAccountId:native.accountIdString,accountIdString:native.accountIdString,
          environment:profile.environment,environmentVerified:verified,accountRevision:profile.revision,selectionKey,
          observedAt:native.observedAt,origin:'AUTHORIZED_CONNECTOR',nativeIdentityVerified:true,connected:true,synthetic:false,testOnly:false,
          automationAuthorized:false,ordersAuthorized:false,readOnly:true}};
    }
  });
}
