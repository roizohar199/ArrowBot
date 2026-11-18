import {BROKER_ACCOUNT_REGISTRY_STORAGE_KEY} from './broker-account-registry.mjs';
// Only revokes prior execution permission. It never switches the broker or
// closes, opens or modifies an existing position.
export function watchBrokerAccountChanges(storage,onChange){
  if(typeof onChange!=='function')throw TypeError('BROKER_ACCOUNT_CHANGE_HANDLER_REQUIRED');
  const changed=(items,area)=>{if(area==='local'&&Object.hasOwn(items??{},BROKER_ACCOUNT_REGISTRY_STORAGE_KEY))onChange('BROKER_ACCOUNT_SELECTION_CHANGED');};
  storage?.onChanged?.addListener(changed);
  return ()=>storage?.onChanged?.removeListener(changed);
}
