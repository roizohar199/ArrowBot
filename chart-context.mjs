// Heuristics for observation only. No chart timestamp or broker data is read.
export function within(rect, x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
export function validRecentRegion(chart, recent) {
  return !!chart && !!recent && recent.width >= 30 && recent.height >= 30 &&
    recent.x >= chart.x && recent.y >= chart.y && recent.x + recent.width <= chart.x + chart.width &&
    recent.y + recent.height <= chart.y + chart.height;
}
export function candleEvidence(image, chart, arrow) {
  const { data, width, height } = image;
  if (!data || data.length !== width * height * 4 || !within(chart, arrow.x, arrow.y)) return false;
  function candlePixel(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height || !within(chart, x, y)) return false;
    const p = (y * width + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    return (r > 125 && r > g * 1.5 && r > b * 1.25) || (g > 85 && b > 55 && g > r * 1.3 && b > r * 1.15);
  }
  // Search above an up triangle or below a down triangle for a small vertical
  // stroke near the same horizontal position. This is evidence, not proof of
  // bar identity: overlays and price lines can still match the heuristic.
  const sign = arrow.direction === 'UP' ? -1 : 1;
  for (let x = Math.floor(arrow.x - 12); x <= Math.ceil(arrow.x + 12); x++) {
    let run = 0;
    for (let distance = 11; distance <= 75; distance++) {
      const y = Math.round(arrow.y + sign * distance);
      if (candlePixel(x, y)) { if (++run >= 4) return true; } else run = 0;
    }
  }
  return false;
}
export function classifyObservation(image, chart, recent, event) {
  if (!validRecentRegion(chart, recent)) return 'OUTSIDE_RECENT';
  if (!within(recent, event.firstX, event.firstY) || !within(recent, event.x, event.y)) return 'OUTSIDE_RECENT';
  // The detector has already matched the colored triangle and the tracker has
  // seen it in two frames. A tiny/occluded candle must not veto that observation.
  return ['UP', 'DOWN'].includes(event.direction) ? 'CANDIDATE' : 'UNVERIFIED';
}
