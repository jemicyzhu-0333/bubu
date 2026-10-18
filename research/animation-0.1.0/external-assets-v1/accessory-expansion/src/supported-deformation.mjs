import * as T from 'three';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
/** PET_VISUAL「配饰分层与五条不变式」: fixed supports, free-edge motion only.
 * Research approximation, not a cloth solver. Units: metres, injected seconds.
 * Own geometry, never source meshes/materials; no autonomous idle oscillator.
 */
export class SupportedDeformation {
 constructor(root,kind){
  this.kind=kind;this.parts=[];this.offset=new T.Vector3();this.velocity=new T.Vector3();
  this.lastPosition=new T.Vector3();this.lastVelocity=new T.Vector3();this.time=null;
  root.traverse(m=>{if(m!==root){m.updateMatrix();if(!m.matrix.equals(new T.Matrix4()))throw new Error('Supported asset requires baked identity node transforms');}});
  root.traverse(m=>{
   if(!m.isMesh||m.isSkinnedMesh||kind==='halo'||kind==='boots')return;
   m.updateMatrix();
   if(!m.matrix.equals(new T.Matrix4()))throw new Error('Supported mesh requires baked identity transform');
   const g=m.geometry.clone();m.geometry=g;
   const base=g.attributes.position.array.slice(),weights=new Float32Array(base.length/3);
   for(let i=0;i<weights.length;i++){
    const x=base[3*i],y=base[3*i+1];let w=0;
    if(kind==='cape'||kind==='plum')w=clamp((1.10-y)/.90,0,1)**2;
    if(kind==='wings')w=clamp((Math.abs(x)-.68)/.75,0,1)**2;
    if(kind==='fin')w=clamp((y-.77)/.65,0,1)**2;
    if(kind==='cap'&&m.name.includes('feather'))w=clamp((y-1.80)/.40,0,1)**2;
    if(/root|band|clasp|back_edge/.test(m.name))w=0;
    weights[i]=w;
   }
   this.parts.push({mesh:m,base,weights,active:weights.some(w=>w>0)});
  });
 }
 reset(){this.time=null;this.offset.set(0,0,0);this.velocity.set(0,0,0);this.lastVelocity.set(0,0,0);this.apply();}
 update(matrix,{time,enabled=true,reducedMotion=false,reset=false}={}){
  if(!enabled||reducedMotion||reset||!Number.isFinite(time)){this.reset();return;}
  const position=new T.Vector3().setFromMatrixPosition(matrix);
  const rotation=new T.Quaternion();matrix.decompose(new T.Vector3(),rotation,new T.Vector3());rotation.invert();
  const dt=this.time===null?0:time-this.time;
  if(this.time===null||dt<0||dt>.25){this.reset();this.time=time;this.lastPosition.copy(position);return;}
  if(dt===0)return;
  const speed=position.clone().sub(this.lastPosition).divideScalar(dt);
  const acceleration=speed.clone().sub(this.lastVelocity).divideScalar(dt).clampLength(0,12).applyQuaternion(rotation);
  const gravity=new T.Vector3(0,-1,0).applyQuaternion(rotation);
  const flex=['cape','plum'].includes(this.kind)?1:.38;
  const target=new T.Vector3(gravity.x*.12,(gravity.y+1)*.08,gravity.z*.12).addScaledVector(acceleration,-.006).multiplyScalar(flex).clampLength(0,.16);
  // Stable substeps under ordinary frame spikes; long suspension resets above.
  const steps=Math.ceil(dt/(1/120)),h=dt/steps;
  for(let i=0;i<steps;i++){
   this.velocity.addScaledVector(target.clone().sub(this.offset),95*h).multiplyScalar(Math.exp(-15*h));
   this.offset.addScaledVector(this.velocity,h).clampLength(0,.16);
  }
  this.time=time;this.lastPosition.copy(position);this.lastVelocity.copy(speed);this.apply();
 }
 apply(){for(const {mesh,base,weights,active} of this.parts){if(!active)continue;const a=mesh.geometry.attributes.position;for(let i=0;i<weights.length;i++){
  const w=weights[i];a.setXYZ(i,base[3*i]+this.offset.x*w,base[3*i+1]+this.offset.y*w,base[3*i+2]+this.offset.z*w);
 }a.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}}
 dispose(){for(const p of this.parts)p.mesh.geometry.dispose();this.parts=[];this.reset();}
}
