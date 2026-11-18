// Holds the last observed price while marking it stale whenever its source changes.
export function createRetainedPrice(){
 let value=null,observedAt=null,fresh=false;
 return {
  accept(v,at){if(!Number.isFinite(v)||!Number.isFinite(at))return;value=v;observedAt=at;fresh=true;},
  stale(){fresh=false;},
  clear(){value=null;observedAt=null;fresh=false;},
  snapshot(){return {value,observedAt,fresh};}
 };
}
