import * as T from 'three';
// V1 PET_VISUAL「配饰目录」: these three accents belong behind the right ear.
export const SPECS=Object.freeze({
 forest:{id:'skin.forest-leaf',exclusiveGroup:'head-accent',effect:'leaf-shimmer',origin:[.45,1.64,-.02],mount:[.61,1.67,-.13],turn:Math.PI,limit:.10},
 sakura:{id:'skin.sakura-flower',exclusiveGroup:'head-accent',effect:'petal-glint',origin:[0,1.75,0],mount:[.68,1.72,-.12],limit:.065},
 moon:{id:'skin.moon-crescent',exclusiveGroup:'head-accent',effect:'moon-glow',origin:[0,1.64,0],mount:[.66,1.66,-.10],limit:.035},
 flame:{id:'skin.flame-tip',exclusiveGroup:'headwear',effect:'flame-flicker',origin:[0,1.64,0],mount:[0,1.62,0],limit:0},
 crown:{id:'skin.crown',exclusiveGroup:'headwear',effect:'crown-shine',origin:[0,1.64,0],mount:[0,1.61,0],limit:.025},
 antenna:{id:'skin.robot-antenna',exclusiveGroup:'headwear',effect:'signal-pulse',origin:[0,1.65,0],mount:[0,1.62,0],limit:.085},
 pumpkin:{id:'seasonal.pumpkin-beret',exclusiveGroup:'headwear',effect:null,origin:[0,1.65,0],mount:[0,1.62,0],limit:.025}
});
const clamp=(v,limit)=>Math.max(-limit,Math.min(limit,v));
function validMatrix(m){return m.elements.every(Number.isFinite)&&Math.abs(m.determinant())>1e-10;}
/** Actor-owned mounting and secondary dynamics. Time/dt in seconds; acceleration in world units/s². */
export class AccessoryAdapter {
 constructor({kind,sourceSkin,parent,asset,assertSourceCurrent}) {
  if(!SPECS[kind]||!sourceSkin?.isSkinnedMesh||!parent||!asset||typeof assertSourceCurrent!=='function')throw new TypeError('Validated actor, parent, asset and ownership guard required');
  assertSourceCurrent();this.kind=kind;this.spec=SPECS[kind];this.skin=sourceSkin;this.guard=assertSourceCurrent;this.skeleton=sourceSkin.skeleton;this.parent=parent;this.disposed=false;
  this.geometry=sourceSkin.geometry;this.bind=sourceSkin.bindMatrix.clone();this.bindInverse=sourceSkin.bindMatrixInverse.clone();this.bindMode=sourceSkin.bindMode;
  this.root=new T.Group();this.root.name='Accessory_'+kind;this.root.matrixAutoUpdate=false;this.mount=new T.Group();this.swing=new T.Group();this.content=asset.clone(true);this.content.position.fromArray(this.spec.origin).multiplyScalar(-1);this.swing.rotation.y=this.spec.turn||0;this.swing.add(this.content);this.mount.add(this.swing);this.root.add(this.mount);
  this.ownedMaterials=[];this.flames=[];this.parts=[];
  this.content.traverse(o=>{if(!o.isMesh)return;const clone=m=>{const c=m.clone();this.ownedMaterials.push({material:c,color:c.color.clone(),name:o.name});return c;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
   if(kind==='flame'&&o.name!=='flame_mount'){o.geometry=o.geometry.clone();this.flames.push({mesh:o,rest:o.geometry.attributes.position.array.slice()});}
  });
  // A skin-surface sample carries HeadTouch deformation, unlike copying mesh.matrixWorld alone.
  const target=new T.Vector3(...this.spec.mount),p=new T.Vector3();let nearest=Infinity;
  for(let i=0;i<this.geometry.attributes.position.count;i++){p.fromBufferAttribute(this.geometry.attributes.position,i);const d=p.distanceToSquared(target);if(d<nearest){nearest=d;this.anchorVertex=i;}}
  this.restAnchor=new T.Vector3().fromBufferAttribute(this.geometry.attributes.position,this.anchorVertex);this.anchorOffset=target.clone().sub(this.restAnchor);
  this.angle=0;this.velocity=0;this.time=0;this.enabled=true;parent.add(this.root);this.update();
 }
 reset(){if(this.disposed)throw new Error('Accessory disposed');this.angle=0;this.velocity=0;this.time=0;this.previousPosition=null;this.previousVelocity=null;return this;}
 update({enabled=true,time=this.time,dt=Math.max(0,time-this.time),acceleration=null,reducedMotion=false}={}) {
  if(this.disposed)throw new Error('Accessory disposed');
  if(!Number.isFinite(time)||!Number.isFinite(dt)||dt<0||(acceleration!==null&&(acceleration.length!==3||!acceleration.every(Number.isFinite))))throw new TypeError('Finite injected time, nonnegative dt and acceleration required');
  try{this.guard();if(this.skin.geometry!==this.geometry||this.skin.skeleton!==this.skeleton||!this.skin.bindMatrix.equals(this.bind)||this.skin.bindMode!==this.bindMode)throw new Error('Actor identity changed');
   this.skin.updateWorldMatrix(true,false);this.parent.updateWorldMatrix(true,false);if(!validMatrix(this.skin.matrixWorld)||!validMatrix(this.parent.matrixWorld))throw new Error('Invalid actor transform');
  }catch(e){this.dispose();throw e;}
  if(!enabled||!this.enabled||reducedMotion||time<this.time||dt>.25)this.reset();
  this.skin.skeleton.update();
  // Exact weighted skin transform at the mount sample carries its position AND local frame.
  const deformation=new T.Matrix4().elements.fill(0),weights=this.geometry.attributes.skinWeight,indices=this.geometry.attributes.skinIndex;
  for(let k=0;k<4;k++){const w=weights.getComponent(this.anchorVertex,k),bone=new T.Matrix4().fromArray(this.skeleton.boneMatrices,indices.getComponent(this.anchorVertex,k)*16);for(let j=0;j<16;j++)deformation[j]+=w*bone.elements[j];}
  const frame=new T.Matrix4().fromArray(deformation).premultiply(this.skin.bindMatrixInverse).multiply(this.bind);
  this.mount.position.fromArray(this.spec.mount).applyMatrix4(frame);frame.decompose(new T.Vector3(),this.mount.quaternion,this.mount.scale);
  const world=this.mount.position.clone().applyMatrix4(this.skin.matrixWorld);
  let inertial=new T.Vector3(...(acceleration||[0,0,0]));
  if(acceleration===null&&dt>0&&dt<=.25&&this.previousPosition){const v=world.clone().sub(this.previousPosition).divideScalar(dt);if(this.previousVelocity)inertial.copy(v).sub(this.previousVelocity).divideScalar(dt);this.previousVelocity=v;}
  if(dt>0)this.previousPosition=world;
  if(enabled&&!reducedMotion&&dt>0){const elapsed=Math.min(dt,.10),steps=Math.ceil(elapsed/(1/120)),h=elapsed/steps;const rotation=this.skin.getWorldQuaternion(new T.Quaternion()).multiply(this.mount.quaternion).invert();
   const local=inertial.applyQuaternion(rotation),gravity=new T.Vector3(0,-9.81,0).applyQuaternion(rotation);
   // Elastic clip restoring torque, gravity lean, damping, and acceleration lag.
   for(let i=0;i<steps;i++){this.velocity+=(-85*this.angle-15*this.velocity-clamp(local.x,20)*.45+gravity.x*.25)*h;this.angle=clamp(this.angle+this.velocity*h,this.spec.limit);if(Math.abs(this.angle)>=this.spec.limit)this.velocity=0;}
  }
  this.time=time;this.enabled=enabled;this.root.matrix.copy(this.parent.matrixWorld).invert().multiply(this.skin.matrixWorld);
  this.swing.rotation.z=reducedMotion?0:this.angle;
  const t=reducedMotion?0:time;this.applyEffects(t,reducedMotion);
  this.root.visible=enabled;this.root.updateMatrixWorld(true);return this;
 }
 applyEffects(t,reduced){
  for(const {material,color,name}of this.ownedMaterials){material.color.copy(color);let strength=0;
   if(!reduced){if(this.kind==='forest')strength=.035*(.5+.5*Math.sin(t*1.7));if(this.kind==='sakura')strength=.045*Math.pow(Math.max(0,Math.sin(t*1.8)),8);if(this.kind==='moon')strength=.08*(.5+.5*Math.sin(t*1.3));if(this.kind==='crown'&&name.includes('jewel'))strength=.1*Math.pow(Math.max(0,Math.sin(t*1.1)),10);if(this.kind==='antenna'&&name.includes('tip'))strength=.14*(.5+.5*Math.sin(t*2.4));}
   material.color.lerp(new T.Color(1,1,1),strength);if(material.emissive){material.emissive.copy(color);material.emissiveIntensity=strength;}
  }
  // Magical crest: base stays seated; only height-weighted local flame geometry flickers.
  for(const {mesh,rest}of this.flames){const a=mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2],h=Math.max(0,y-1.69);a.setXYZ(i,x+(reduced?0:.045*Math.sin(t*5.2+h*8)*h),y+(reduced?0:.035*Math.sin(t*4.1+h*7)*h),z);}a.needsUpdate=true;mesh.geometry.computeVertexNormals();}
 }
 dispose(){if(this.disposed)return;this.root.removeFromParent();this.root.clear();for(const {material}of this.ownedMaterials)material.dispose();for(const {mesh}of this.flames)mesh.geometry.dispose();this.parts=[];this.disposed=true;}
}
export function disposeAsset(asset){const gs=new Set(),ms=new Set(),ts=new Set();asset.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});for(const t of ts)t.dispose();for(const m of ms)m.dispose();for(const g of gs)g.dispose();return{geometries:gs.size,materials:ms.size,textures:ts.size};}
