import {createShortcutWorker} from './shortcut-worker.mjs';
import {isShortcutTargetUrl} from './shortcut-target.mjs';
import {listenForTelegramAlerts} from './telegram-alerts.mjs';

createShortcutWorker(chrome).listen();
listenForTelegramAlerts(chrome);
function openObservationTab(){
  return chrome.tabs.create({url:chrome.runtime.getURL('experiment.html')});
}
function sidePanelFallback(){
  // A failed companion UI never changes shortcuts or starts trading actions.
  console.warn('ARROW_SIDE_PANEL_UNAVAILABLE_FALLBACK');
  void openObservationTab().catch(()=>console.warn('ARROW_OBSERVATION_TAB_UNAVAILABLE'));
}
chrome.action.onClicked.addListener(tab=>{
  if(isShortcutTargetUrl(tab?.url)&&Number.isSafeInteger(tab?.windowId)&&typeof chrome.sidePanel?.open==='function'){
    try{
      // Call synchronously inside the action's user gesture. Opening a tab or
      // awaiting a query first can lose the gesture required by Chrome 116+.
      void chrome.sidePanel.open({windowId:tab.windowId}).catch(sidePanelFallback);
    }catch{sidePanelFallback();}
    return;
  }
  if(isShortcutTargetUrl(tab?.url))sidePanelFallback();
  else void openObservationTab().catch(()=>console.warn('ARROW_OBSERVATION_TAB_UNAVAILABLE'));
});
