// Stronger visual evidence for automatic recovery after an uncertain entry.
// This proves only that the validated chart has no visible entry marker.
const RECOVERABLE=new Set(['ENTRY_UNCONFIRMED','LEGACY_UNCONFIRMED_ENTRY','POSITION_QUANTITY_MISMATCH','POSITION_VIEW_CHANGED']);
export const isAutoFlatRecoveryReason=reason=>RECOVERABLE.has(reason);
export function hasAutoFlatProof(position,{chartValidated=false,viewChanged=false}={}){
 return chartValidated===true&&viewChanged!==true&&position?.state==='FLAT'&&position.flatProof===true&&position.scan==='FULL'&&position.reason==='NO_VISIBLE_POSITION_MARKER';
}
