import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';
import {captureCandleFeatures,matchCandleMotion} from './chart-motion.mjs';

export function createChartMotionReader({maxGapMs=MAX_CAPTURE_GAP_MS,maxShift=16,maxSamples=96}={}){
 let previous=null;
 const reset=()=>{previous=null;};
 return {
  reset,
  inspect(image,region,{context,geometry,capturedAt,needed=true}={}){
   const fail=reason=>({motion:null,reason,comparisons:0,samples:0});
   if(typeof context!=='string'||!context||typeof geometry!=='string'||!geometry||!Number.isFinite(capturedAt)){reset();return fail('INVALID_CONTEXT');}
   if(previous&&capturedAt<=previous.capturedAt)return fail('DUPLICATE_FRAME');
   const features=captureCandleFeatures(image,region,{maxShift,maxSamples});
   if(!features){reset();return fail('INVALID_IMAGE');}
   const regionKey=JSON.stringify([region.x,region.y,region.width,region.height]);
   const old=previous;previous={features,context,geometry,capturedAt,regionKey};
   if(!old)return {...fail('BASELINE'),samples:features.count};
   if(old.context!==context||old.geometry!==geometry||old.regionKey!==regionKey||old.features.width!==features.width||old.features.height!==features.height)return {...fail('CONTEXT_CHANGED'),samples:features.count};
   if(capturedAt-old.capturedAt>maxGapMs)return {...fail('CAPTURE_GAP'),samples:features.count};
   if(!needed)return {...fail('NOT_NEEDED'),samples:features.count};
   return matchCandleMotion(old.features,image,{maxShift});
  },
 };
}
