// Visual OCR estimates for the current NQ/MNQ experiment only.
export function parseObservedPrice(text) {
  if (typeof text !== 'string') return null;
  const clean = text.trim().replace(/\s/g, '');
  if (!/^(?:\d{1,3},\d{3}|\d{4,6})\.\d{2}$/.test(clean)) return null;
  const value = Number(clean.replace(',', ''));
  if (!Number.isFinite(value) || value < 1000 || value > 999999 || Math.abs(value*4 - Math.round(value*4)) > 1e-6) return null;
  return value;
}
export function agreeOnPrice(raw, variants) {
  const value = parseObservedPrice(raw?.text);
  if (value === null || !Number.isFinite(raw?.confidence) || raw.confidence < 85 || !Array.isArray(variants)) return null;
  return variants.filter(text => parseObservedPrice(text) === value).length >= 2 ? value : null;
}
// A single-pass estimate, never an assertion of correctness. Low-confidence
// but syntactically valid text remains reviewable in this observation-only
// experiment; the caller must visibly label it as low confidence.
export function singlePassPrice(raw, { allowLowConfidence = false } = {}) {
  return raw && Number.isFinite(raw.confidence) && raw.confidence >= (allowLowConfidence ? 0 : 85) ? parseObservedPrice(raw.text) : null;
}

// Explain the reliability of a single OCR result without claiming certainty.
export function priceConfidenceLabel(confidence) {
  return Number.isFinite(confidence) && confidence < 85 ? 'ביטחון נמוך — ייתכן שהמחיר שגוי' : 'קריאה חזותית — לא מאומתת';
}
