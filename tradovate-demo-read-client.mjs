// Staged, read-only Tradovate DEMO client. Not imported by the live extension.
// A DEMO endpoint does not prove that an account is independent of a prop firm.
// This module never requests/stores credentials or places/modifies/cancels orders.
export const TRADOVATE_DEMO_API='https://demo.tradovateapi.com/v1';
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>Number.isSafeInteger(value)&&value>0;
const error=code=>Object.assign(new Error(code),{code});
const tokenValid=value=>typeof value==='string'&&value.length>=16&&value.length<=8192&&!/[\s\u0000-\u001f\u007f]/.test(value);
const safeTransportErrors=new Set(['CLIENT_CLOSED','UNEXPECTED_API_DESTINATION','AUTHENTICATION_REQUIRED','API_ACCESS_DENIED',
  'API_RATE_LIMITED','API_HTTP_FAILURE','API_CAPTCHA_REQUIRES_USER','API_BUSINESS_FAILURE','API_READ_TIMEOUT']);

export function createTradovateDemoReadClient({fetchImpl=globalThis.fetch,getAccessToken,timeoutMs=5000}={}){
  if(typeof fetchImpl!=='function'||typeof getAccessToken!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw error('INVALID_DEMO_CLIENT_CONFIGURATION');
  let closed=false;
  async function get(path,query={}){
    if(closed)throw error('CLIENT_CLOSED');
    let token;try{token=await getAccessToken();}catch{throw error('ACCESS_TOKEN_UNAVAILABLE');}
    if(!tokenValid(token))throw error('ACCESS_TOKEN_REQUIRED');
    if(closed)throw error('CLIENT_CLOSED');
    const url=new URL(TRADOVATE_DEMO_API+path);
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
    const controller=new AbortController();let timer;
    try{
      const operation=(async()=>{
        const response=await fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+token},
          signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
        if(closed)throw error('CLIENT_CLOSED');
        if(response.url){const actual=new URL(response.url);if(actual.origin!==url.origin||actual.pathname!==url.pathname)throw error('UNEXPECTED_API_DESTINATION');}
        if(response.status===401)throw error('AUTHENTICATION_REQUIRED');
        if(response.status===403)throw error('API_ACCESS_DENIED');
        if(response.status===429)throw error('API_RATE_LIMITED');
        if(!response.ok)throw error('API_HTTP_FAILURE');
        const data=await response.json();
        if(closed)throw error('CLIENT_CLOSED');
        if(plain(data)&&(own(data,'p-ticket')||own(data,'p-time')||own(data,'p-captcha')))throw error(own(data,'p-captcha')?'API_CAPTCHA_REQUIRES_USER':'API_RATE_LIMITED');
        if(plain(data)&&(data.errorText||data.failureReason||data.failureText))throw error('API_BUSINESS_FAILURE');
        return data;
      })();
      // Bound the complete read, including response-body parsing. No auto retries.
      return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(error('API_READ_TIMEOUT'));},timeoutMs);})]);
    }catch(e){
      // Do not propagate transport bodies/messages that may contain a token.
      if(safeTransportErrors.has(e?.code))throw error(e.code);
      throw error('API_READ_FAILED');
    }finally{clearTimeout(timer);}
  }
  async function accounts(){
    const data=await get('/account/list');
    if(!Array.isArray(data)||data.length>1000||data.some(row=>!plain(row)||!id(row.id)||typeof row.name!=='string'||row.name.length>120))throw error('INVALID_ACCOUNT_LIST');
    if(new Set(data.map(row=>row.id)).size!==data.length)throw error('DUPLICATE_ACCOUNT_ID');
    return data.map(row=>({id:row.id,name:row.name,active:row.active===true,readOnly:row.readOnly!==false,
      environment:'DEMO',independentAccountVerified:false,automationAuthorized:false}));
  }
  async function snapshot(accountId){
    if(!id(accountId))throw error('EXACT_ACCOUNT_REQUIRED');
    const listed=await accounts(),account=listed.find(row=>row.id===accountId);
    if(!account)throw error('ACCOUNT_NOT_IN_AUTHENTICATED_LIST');
    const results=await Promise.allSettled([get('/position/list'),get('/order/list')]);
    const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    const [positions,orders]=results.map(result=>result.value);
    for(const rows of [positions,orders])if(!Array.isArray(rows)||rows.length>100000||rows.some(row=>!plain(row)||!id(row.accountId)))throw error('INVALID_ACCOUNT_SNAPSHOT');
    return {environment:'DEMO',account,positions:positions.filter(row=>row.accountId===accountId),orders:orders.filter(row=>row.accountId===accountId),
      independentAccountVerified:false,automationAuthorized:false,ordersCreated:false};
  }
  async function findNqContract(name){
    // Resolve an explicit dated name; never infer a front month from NQ1!.
    if(typeof name!=='string'||!/^NQ[HMUZ](?:\d|\d{2}|\d{4})$/.test(name))throw error('DATED_NQ_CONTRACT_REQUIRED');
    const data=await get('/contract/find',{name});
    if(!plain(data)||!id(data.id)||data.name!==name||!id(data.contractMaturityId))throw error('CONTRACT_IDENTITY_UNVERIFIED');
    return {id:data.id,name:data.name,contractMaturityId:data.contractMaturityId,environment:'DEMO',
      specificationVerified:false,continuousMappingVerified:false,automationAuthorized:false};
  }
  return Object.freeze({accounts,snapshot,findNqContract,close(){closed=true;}});
}
