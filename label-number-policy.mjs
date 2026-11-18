export function verifiedLabelNumber(first, second, minConfidence=65) {
  const value=x=>typeof x?.text==='string' && /^\d{2}$/.test(x.text.trim()) && x.text.trim()!=='00' && Number.isFinite(x.confidence) && x.confidence>=minConfidence ? x.text.trim() : null;
  const a=value(first),b=value(second);return a && a===b ? a : null;
}
export function canApplyLabelResult(result,current) {
 return current.running===true && result.session===current.session && result.generation===current.generation && result.key===current.key;
}
