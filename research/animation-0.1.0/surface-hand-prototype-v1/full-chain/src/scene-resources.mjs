import * as T from 'three';
import {createTeaCup} from '../../../sip-tea-prototype-v1/src/cup-model.mjs';
/** Owns only prop/effect resources. Host supplies pose, visibility and its time.
 * Isolated experiment; never mutates approved body, face, owner or source GLB. */
export function createSceneResources({radius=.23081978518525692,height=.3091484835864778}={}){
 const cup=createTeaCup({radius,height}),root=new T.Group();root.name='Isolated_sip_resources';root.add(cup.root);const steams=[];const seg=14,radial=6,indices=[];
 for(let i=0;i<seg;i++)for(let k=0;k<radial;k++){const a=i*radial+k,b=i*radial+(k+1)%radial,c=(i+1)*radial+k,d=(i+1)*radial+(k+1)%radial;indices.push(a,b,c,b,d,c);}
 for(let k=0;k<3;k++){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array((seg+1)*radial*3),3));g.setIndex(indices);const m=new T.MeshStandardMaterial({color:0xf3faff,transparent:true,opacity:0,depthWrite:false,roughness:1});const mesh=new T.Mesh(g,m);mesh.name='Steam_'+k;mesh.castShadow=false;mesh.receiveShadow=false;mesh.visible=false;root.add(mesh);steams.push(mesh);}
 cup.root.traverse(o=>{if(o.isMesh){o.material.transparent=true;o.material.depthWrite=true;}});let disposed=false;
 function apply({time,center,quaternion,scale=1,opacity=scale,reducedMotion=false,steamEnabled=false}){
  if(disposed)throw Error('disposed scene resources');if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||!Array.isArray(quaternion)||quaternion.length!==4||!quaternion.every(Number.isFinite)||Math.abs(Math.hypot(...quaternion)-1)>1e-5||typeof reducedMotion!=='boolean')throw RangeError('finite position and unit quaternion');if(!Number.isFinite(time)||!Number.isFinite(scale)||!Number.isFinite(opacity)||scale<0||scale>1||opacity<0||opacity>1)throw RangeError('bounded supplied scene sample');
  const c=new T.Vector3(...center),q=new T.Quaternion(...quaternion);cup.root.position.copy(c);cup.root.quaternion.copy(q);cup.root.scale.setScalar(scale);cup.root.visible=!reducedMotion&&scale>1e-6;cup.root.traverse(o=>{if(o.isMesh)o.material.opacity=opacity;});
  const phase=time*2.1,appear=Math.max(0,Math.min(1,(scale-.8)/.2))**2;
  for(let k=0;k<steams.length;k++){const mesh=steams[k],origin=new T.Vector3([-.045,.012,.05][k],height-.04,0).applyQuaternion(q).add(c),length=.17+.03*Math.sin(phase+k*1.3),p=mesh.geometry.attributes.position;mesh.material.opacity=.16*opacity*(.70+.30*Math.sin(phase+k))*appear;mesh.visible=steamEnabled&&!reducedMotion&&mesh.material.opacity>1e-6;
   for(let i=0;i<=seg;i++){const u=i/seg,r=.006*(1-u*.65),x=origin.x+.014*Math.sin(phase+k+u*5)*u,y=origin.y+length*u,z=origin.z+.03*u;for(let j=0;j<radial;j++){const a=2*Math.PI*j/radial;p.setXYZ(i*radial+j,x+r*Math.cos(a),y,z+r*Math.sin(a));}}
   p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
  }
 }
 function dispose(){if(disposed)return;disposed=true;cup.dispose();for(const mesh of steams){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}root.removeFromParent();root.clear();}
 return{root,apply,dispose,get disposed(){return disposed;},get resourceCounts(){return disposed?{geometries:0,materials:0}:{geometries:6,materials:5};}};
}
