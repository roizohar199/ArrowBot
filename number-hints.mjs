import {verifiedLabelNumber} from './label-number-policy.mjs';
import {labelTextKey} from './label-image-key.mjs';
import {MAX_CAPTURE_GAP_MS} from './capture-timing.mjs';

const directions=new Set(['UP','DOWN']);
const finitePosition=v=>Number.isFinite(v?.x)&&Number.isFinite(v?.y);
const validBox=b=>b&&['x','y','width','height'].every(k=>Number.isSafeInteger(b[k]))&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0;
const keyOf=v=>typeof v?.key==='string'&&v.key?v.key:typeof v?.appearanceKey==='string'&&v.appearanceKey?v.appearanceKey:null;
const near=(a,b,tolerance)=>Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.y-b.y)<=tolerance;
const sourceFrame=id=>typeof id==='number'?Number.isFinite(id):typeof id==='string'&&id.length>0;

// This is stricter than ordinary arrow detection. Failure only withholds an
// optional number hint; it never rejects a visual arrow or authorizes a key.
export function inspectNumberHintQuality(image,candidate,{bounds,ambiguous=[]}={}){
 const b=candidate?.box,{data,width,height}=image??{},direction=candidate?.direction;
 const fail=reason=>({complete:false,reason,key:null});
 if(!data||data.length!==width*height*4||!directions.has(direction)||!validBox(b)||b.width<15||b.height<16||b.width/b.height<.82||b.width/b.height>1.10)return fail('NUMBER_LABEL_INCOMPLETE');
 const region=bounds??{x:0,y:0,width,height};
 if(!validBox(region)||b.x<=region.x||b.y<=region.y||b.x+b.width>=region.x+region.width||b.y+b.height>=region.y+region.height||region.x+region.width>width||region.y+region.height>height)return fail('NUMBER_LABEL_CLIPPED');
 if(ambiguous.some(a=>validBox(a)&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y))return fail('NUMBER_LABEL_OVERLAPPED');
 const key=labelTextKey(image,b,direction);
 if(!key||keyOf(candidate)&&keyOf(candidate)!==key)return fail('NUMBER_LABEL_KEY_MISMATCH');
 const x0=Math.floor(b.width*.13),x1=Math.ceil(b.width*.87),y0=Math.floor(b.height*(direction==='UP'?.27:.09)),y1=Math.ceil(b.height*(direction==='UP'?.83:.70));
 let ink=0,left=x1,top=y1,right=-1,bottom=-1,foreign=0,body=0;
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=((b.y+y)*width+b.x+x)*4,r=data[p],g=data[p+1],z=data[p+2];
  if(data[p+3]!==255)return fail('NUMBER_LABEL_TRANSPARENT');
  const text=direction==='UP'?r<200&&g<185&&z<110:Math.min(r,g,z)>130&&Math.max(r,g,z)-Math.min(r,g,z)<115;
  if(x>=x0&&x<x1&&y>=y0&&y<y1&&text){ink++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const central=x>=Math.ceil(b.width*.10)&&x<Math.floor(b.width*.90)&&y>=Math.ceil(b.height*(direction==='UP'?.28:.15))&&y<=Math.floor(b.height*(direction==='UP'?.72:.65));
  if(central){
   body++;
   const fill=direction==='UP'?r>90&&g>70&&g>r*.72&&z<150&&r>z*1.4&&g>z*1.3:r>55&&z>70&&g<125&&r>g*1.35&&z>g*1.4;
   if(!fill&&!text)foreign++;
  }
 }
 if(ink<6||right-left<2||bottom-top<3||left<=x0||top<=y0||right>=x1-1||bottom>=y1-1)return fail('NUMBER_GLYPH_INCOMPLETE');
 if(!body||foreign>Math.max(1,Math.floor(body*.01))||ink>(x1-x0)*(y1-y0)*.45)return fail('NUMBER_LABEL_OCCLUDED');
 return {complete:true,reason:'NUMBER_LABEL_COMPLETE',key,appearanceKey:key,glyphHeight:bottom-top+1,inkPixels:ink,foreignPixels:foreign};
}

// A bounded evidence cache, not a list of numbers which may or may not trade.
// It is keyed by current pixels/scope, never by the displayed 01–99 number.
export function createNumberHints({minConfidence=85,limit=128,maxGapMs=MAX_CAPTURE_GAP_MS,tolerance=4}={}){
 let proofGeneration=0,scope=null;
 const entries=new Map();
 const sameScope=m=>!!scope&&m?.context===scope.context&&m?.geometry===scope.geometry;
 const validScope=m=>typeof m?.context==='string'&&m.context&&typeof m?.geometry==='string'&&m.geometry;
 function reset(binding){proofGeneration++;scope=validScope(binding)?{context:binding.context,geometry:binding.geometry}:null;entries.clear();}
 function metadata(m){
  const key=keyOf(m);
  if(!sameScope(m)||!key||m.key&&m.appearanceKey&&m.key!==m.appearanceKey||!directions.has(m.direction)||!finitePosition(m)||!validBox(m.box)||Math.abs(m.x-(m.box.x+m.box.width/2))>2||Math.abs(m.y-(m.box.y+m.box.height/2))>2)return null;
  return {key,mapKey:m.direction+':'+key};
 }
 const quality=(m,key)=>m?.quality?.complete===true&&m.quality.key===key;
 function entryFor(m,decoded,create=false){
  let value=entries.get(decoded.mapKey);
  if(!value&&create){value={floor:-Infinity,samples:[],proof:null};entries.set(decoded.mapKey,value);if(entries.size>limit)entries.delete(entries.keys().next().value);}
  if(value&&Number.isFinite(m.minCapturedAt)&&m.minCapturedAt>value.floor){
   value.floor=m.minCapturedAt;
   if(value.proof&&value.proof.firstCapturedAt<value.floor)value.proof=null;
   value.samples=value.samples.filter(sample=>sample.capturedAt>=value.floor);
  }
  return value;
 }
 function lookup(m){
  const decoded=metadata(m);if(!decoded||!quality(m,decoded.key))return null;
  const value=entryFor(m,decoded),hint=value?.proof;
  if(!hint||!near(hint,m,tolerance)||Number.isFinite(m.capturedAt)&&hint.confirmedAt>m.capturedAt)return null;
  return hint;
 }
 function needsRead(m){
  if(!scope&&validScope(m))reset(m);
  const decoded=metadata(m);if(!decoded||!quality(m,decoded.key)||!Number.isFinite(m.capturedAt)||!sourceFrame(m.frameId))return false;
  const value=entryFor(m,decoded,true);
  if(value.proof&&!near(value.proof,m,tolerance)){value.proof=null;value.samples=[];}
  if(lookup(m))return false;
  return !value.samples.some(sample=>sample.frameId===m.frameId);
 }
 function record(m){
  const decoded=metadata(m);if(!decoded||m.proofGeneration!==proofGeneration||!quality(m,decoded.key)||!Number.isFinite(m.capturedAt)||!sourceFrame(m.frameId))return null;
  const value=entryFor(m,decoded,true);
  if(m.capturedAt<value.floor||Number.isFinite(m.minCapturedAt)&&m.minCapturedAt<value.floor)return null;
  const result=m.result,number=verifiedLabelNumber(result?.first,result?.second,minConfidence);
  if(!number||result.number!==number||result.fresh!==true||result.cached===true)return null;
  const previous=value.samples.at(-1);
  if(previous&&(m.capturedAt<=previous.capturedAt||m.frameId===previous.frameId))return null;
  if(previous&&(previous.number!==number||m.capturedAt-previous.capturedAt>maxGapMs||!near(previous,m,tolerance))){value.samples=[];value.proof=null;}
  const sample={number,capturedAt:m.capturedAt,frameId:m.frameId,x:m.x,y:m.y,confidence:Math.min(result.first.confidence,result.second.confidence)};
  value.samples.push(sample);if(value.samples.length>2)value.samples.shift();
  if(value.samples.length<2)return null;
  const [first,last]=value.samples;
  value.proof=Object.freeze({number,key:decoded.key,appearanceKey:decoded.key,direction:m.direction,context:m.context,geometry:m.geometry,firstCapturedAt:first.capturedAt,confirmedAt:last.capturedAt,firstFrameId:first.frameId,lastFrameId:last.frameId,frameIds:Object.freeze([first.frameId,last.frameId]),confidence:Math.min(first.confidence,last.confidence),complete:true,fresh:true,proofGeneration,x:m.x,y:m.y,box:Object.freeze({...m.box})});
  return value.proof;
 }
 return {reset,needsRead,record,lookup,snapshot:()=>({proofGeneration,generation:proofGeneration,context:scope?.context??null,geometry:scope?.geometry??null,entries:entries.size,confirmed:[...entries.values()].filter(value=>!!value.proof).length})};
}
