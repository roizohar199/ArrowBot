// The rightmost visible triangle is a visual approximation, not bar time or an order signal.
export function createLatestVisible() {
  let pending = null, count = 0, shown = null;
  return {
    reset() { pending = null; count = 0; shown = null; },
    observe(candidates) {
      const sorted = [...candidates].sort((a,b) => b.x-a.x);
      const first = sorted[0] ?? null;
      const ambiguous = !!first && sorted.some((c,i) => i > 0 && Math.abs(c.x-first.x) <= 4);
      const next = ambiguous ? null : first;
      const same = (!next && !pending) || (next && pending && next.visualId === pending.visualId && next.direction === pending.direction && Math.abs(next.x-pending.x) <= 4 && Math.abs(next.y-pending.y) <= 4);
      count = same ? count+1 : 1; pending = next ? {...next} : null;
      if (count >= 2) shown = next ? {...next} : null;
      // Do not display an old ID when the current candidate is uncertain.
      const current = shown && next && shown.direction === next.direction && shown.visualId === next.visualId ? next : null;
      return { arrow: current, ambiguous };
    }
  };
}
