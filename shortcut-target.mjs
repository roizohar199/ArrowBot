/** Only normal HTTPS TradingView chart tabs can receive a shortcut. */
export function isShortcutTargetUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'tradingview.com' || url.hostname.endsWith('.tradingview.com')) &&
      url.pathname.startsWith('/chart/');
  } catch { return false; }
}

function chartTabs(candidates) {
  if (!Array.isArray(candidates)) return [];
  const tabs = new Map();
  for (const candidate of candidates) {
    if (!candidate || !Number.isSafeInteger(candidate.id) || candidate.id <= 0 ||
        !Number.isSafeInteger(candidate.windowId) || candidate.windowId < 0 ||
        !isShortcutTargetUrl(candidate.url)) continue;
    if (!tabs.has(candidate.id)) tabs.set(candidate.id, {
      id: candidate.id,
      url: candidate.url,
      title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : 'TradingView',
      windowId: candidate.windowId,
    });
  }
  return [...tabs.values()];
}

export async function listShortcutTargets(api) {
  const tabs = await api.tabs.query({
    url: ['https://*.tradingview.com/chart/*', 'https://tradingview.com/chart/*'],
  });
  return chartTabs(tabs);
}

/** A saved selection never falls through to another chart if it disappears. */
export function resolveShortcutTarget(candidates, selectedId) {
  const tabs = chartTabs(candidates);
  if (selectedId !== null && selectedId !== undefined) {
    const tab = Number.isSafeInteger(selectedId) && selectedId > 0 ? tabs.find(item => item.id === selectedId) : null;
    return tab ? {ok: true, tab} : {ok: false, code: 'TARGET_UNAVAILABLE'};
  }
  if (tabs.length === 1) return {ok: true, tab: tabs[0]};
  return {ok: false, code: tabs.length ? 'TARGET_SELECTION_REQUIRED' : 'TARGET_UNAVAILABLE'};
}
