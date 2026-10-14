// Audit-only source-contact pose; never creates or mutates runtime bones.
export function registerSourcePose({side,sourceSize,scale,observedContactBoundary,cutEndpoints,target}) {
  if(!['left','right'].includes(side)||!(scale>0)||!sourceSize.every(Number.isFinite)||![...observedContactBoundary,...cutEndpoints.flat(),...target].every(Number.isFinite))throw Error('Missing source-authored registration');
  const translation=target.map((v,k)=>v-observedContactBoundary[k]*scale);
  const map=p=>p.map((v,k)=>v*scale+translation[k]);
  const cut=cutEndpoints.map(map),P=cut[0].map((v,k)=>(v+cut[1][k])/2),width=Math.hypot(cut[1][0]-cut[0][0],cut[1][1]-cut[0][1]);
  if(!(width>0))throw Error('A real nonzero cut width is required');
  const S=side==='left'?[4.5,45.5]:[61.5,45.5];
  return {side,S,P,cut,width,scale,translation,target,observedWorld:map(observedContactBoundary),bounds:{x:Math.floor(translation[0]),y:Math.floor(translation[1]),w:Math.ceil(translation[0]+sourceSize[0]*scale)-Math.floor(translation[0]),h:Math.ceil(translation[1]+sourceSize[1]*scale)-Math.floor(translation[1])},accepted:false};
}
// One offline nearest-neighbor projection with a single body-relative scale.
// No runtime rotation, stretching, tint substitution or root clipping.
export function projectSourcePixels(pixels,pose) {
 const b=pose.bounds,data=new Uint8ClampedArray(b.w*b.h*4);
 for(let y=0;y<b.h;y++)for(let x=0;x<b.w;x++){
  const sx=Math.floor((b.x+x+.5-pose.translation[0])/pose.scale),sy=Math.floor((b.y+y+.5-pose.translation[1])/pose.scale);
  if(sx<0||sy<0||sx>=pixels.width||sy>=pixels.height)continue;
  const a=(sy*pixels.width+sx)*4,o=(y*b.w+x)*4;data.set(pixels.data.slice(a,a+4),o);
 }
 return {width:b.w,height:b.h,data};
}
export function inspectHiddenMaterial(pose,bodyAlpha){
 const {S,P,width}=pose,dx=P[0]-S[0],dy=P[1]-S[1],len=Math.hypot(dx,dy);
 if(!len)return {valid:false,reason:'zero-length-hidden-link-requires-explicit-source-review'};
 const radius=width/2,margin=radius+Math.SQRT1_2,covered=[],exposed=[],unknown=[];
 // Conservative raster-cell envelope. Proximal halfspace permission only;
 // never removes positive-axis material. Full cut is checked separately.
 for(let y=Math.floor(Math.min(S[1],P[1])-margin);y<=Math.ceil(Math.max(S[1],P[1])+margin);y++)for(let x=Math.floor(Math.min(S[0],P[0])-margin);x<=Math.ceil(Math.max(S[0],P[0])+margin);x++){
  const q=[x+.5,y+.5],t=((q[0]-S[0])*dx+(q[1]-S[1])*dy)/(len*len);if(t<=0)continue;
  const tc=Math.min(1,t),dist=Math.hypot(q[0]-S[0]-tc*dx,q[1]-S[1]-tc*dy);if(dist>margin)continue;
  const value=bodyAlpha(...q);(value===null?unknown:value?covered:exposed).push([x,y]);
 }
 const n=Math.max(2,Math.ceil(width*8)+1),cutSamples=Array.from({length:n},(_,i)=>pose.cut[0].map((v,k)=>v+(pose.cut[1][k]-v)*i/(n-1)));
 const cutOutside=cutSamples.filter(p=>bodyAlpha(...p)!==true);
 return {valid:!exposed.length&&!unknown.length&&!cutOutside.length,length:len,width,radius,covered,exposed,unknown,cutOutside,policy:'conservative positive-axis raster envelope; cut sampled at <=.125 art unit; source visual review still required'};
}
export function inspectSourcePixels(pixels){const colors=new Set(),nonBinary=[];let opaque=0;for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data[i+3];if(a!==0&&a!==255)nonBinary.push(i/4);if(a){opaque++;colors.add([...pixels.data.slice(i,i+3)].join(','));}}return{opaque,colors:[...colors],nonBinary,valid:opaque>0&&nonBinary.length===0&&colors.size<=4};}
export function createSourcePosePainter(plans){return{paint(context,{hand,layer,covered}){const p=plans[hand.side];if(!p)return false;if(layer==='front'&&!covered){context.save();context.imageSmoothingEnabled=false;context.globalAlpha*=hand.opacity??1;context.drawImage(p.surface,p.bounds.x,p.bounds.y);context.restore();}return true;}};}
