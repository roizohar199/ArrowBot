export function quantityFromRead(read){
 const values=[read?.first,read?.second].map(r=>r&&Number.isFinite(r.confidence)&&r.confidence>=85&&/^\s*[+-]?\s*[1-9]\d{0,2}\s*$/.test(r.text??'')?Math.abs(Number(r.text.replaceAll(/\s/g,''))):null);
 return values[0]!==null&&values[0]===values[1]?values[0]:null;
}
export function quantityImageKey(image,box){
 if(!box||!['x','y','width','height'].every(k=>Number.isSafeInteger(box[k]))||box.width<2||box.height<4||box.x<0||box.y<0||box.x+box.width>image.width||box.y+box.height>image.height)return null;
 let hash=2166136261,ink=0;
 for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){const i=(y*image.width+x)*4,r=image.data[i],g=image.data[i+1],b=image.data[i+2];const on=image.data[i+3]>=200&&Math.min(r,g,b)>=145&&Math.max(r,g,b)-Math.min(r,g,b)<100;ink+=Number(on);hash=Math.imul(hash^Number(on),16777619);}
 return ink>=3?`${box.width}x${box.height}:${hash>>>0}`:null;
}
// Position side comes from the marker border. A separate horizontal minus in
// the short quantity cell is a sign, not part of the positive contract count.
export function stripQuantitySigns(mask){
 const {width:w,height:h,data}=mask,seen=new Uint8Array(w*h);
 for(let start=0;start<w*h;start++){
  if(seen[start]||data[start*4]!==0)continue;
  const pending=[start],component=[];seen[start]=1;let left=w,right=0,top=h,bottom=0;
  for(let k=0;k<pending.length;k++){const p=pending[k],x=p%w,y=Math.floor(p/w);component.push(p);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);for(const n of [x>0?p-1:-1,x+1<w?p+1:-1,y>0?p-w:-1,y+1<h?p+w:-1])if(n>=0&&!seen[n]&&data[n*4]===0){seen[n]=1;pending.push(n);}}
  const cw=right-left+1,ch=bottom-top+1;
  if(cw>=3&&cw>=ch*2&&ch<=Math.max(3,Math.round(h*.25)))for(const p of component)data[p*4]=data[p*4+1]=data[p*4+2]=255;
 }
 return mask;
}
export function createPositionQuantityProof({maxAgeMs=2500}={}){
 let identity=null,reads=[];
 const token=m=>`${m.context}|${m.side}|${m.key}`;
 return {
  reset(){identity=null;reads=[];},
  record(meta){const n=quantityFromRead(meta.result);if(n===null||!meta.key||!Number.isFinite(meta.capturedAt)||meta.frameId==null)return false;const id=token(meta);if(id!==identity){identity=id;reads=[];}reads=reads.filter(r=>meta.capturedAt-r.at<=maxAgeMs&&r.at<meta.capturedAt&&r.frameId!==meta.frameId);reads.push({at:meta.capturedAt,frameId:meta.frameId,quantity:n});reads=reads.slice(-2);return true;},
  lookup(meta){const valid=identity===token(meta)&&reads.length===2&&reads[0].at<reads[1].at&&reads[0].quantity===reads[1].quantity&&meta.capturedAt>=reads[1].at&&meta.capturedAt-reads[1].at<=maxAgeMs;return valid?{quantity:reads[1].quantity,quantityVerified:true}:{quantity:null,quantityVerified:false};},
 };
}
