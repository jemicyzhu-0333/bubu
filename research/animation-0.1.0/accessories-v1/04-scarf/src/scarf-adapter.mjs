import * as T from 'three';
import {SproutAdapter} from '../../01-sprout/src/sprout-adapter.mjs';
export const SCARF_SPEC=Object.freeze({id:'milestone.scarf',exclusiveGroup:'neckwear',minLevel:10,priority:50,effect:'scarf-flutter',period:2.8,maxTailX:.025,maxTailZ:.018,tailTop:.88,tailBottom:.32});
/** Bounded cloth-only adapter: no new clock, no body/face writes.
 * Collar shares immutable source geometry; each adapter owns only cloned tail
 * geometry/rest buffers. Source material ownership remains with the loader. */
export class ScarfAdapter extends SproutAdapter {
 constructor(options){
  super(options);this.root.name='Accessory_milestone.scarf';this.tailParts=[];
  const tail=this.root.getObjectByName('scarf_tail');if(!tail){this.dispose();throw new Error('Missing scarf tail');}
  tail.traverse(o=>{if(!o.isMesh)return;o.geometry=o.geometry.clone();this.tailParts.push({mesh:o,rest:o.geometry.attributes.position.array.slice(),normals:o.geometry.attributes.normal.array.slice()});});
  this.update(0,{reducedMotion:true});
 }
 update(time,{enabled=true,reducedMotion=false}={}){
  super.update(time,{reducedMotion:true,enabled});if(!this.tailParts)return 0;
  const phase=2*Math.PI*time/SCARF_SPEC.period,dx=enabled&&!reducedMotion?SCARF_SPEC.maxTailX*Math.sin(phase):0,dz=enabled&&!reducedMotion?SCARF_SPEC.maxTailZ*Math.sin(phase+Math.PI/3):0;
  for(const {mesh,rest,normals} of this.tailParts){const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
   if(dx===0&&dz===0){p.array.set(rest);n.array.set(normals);}else for(let i=0;i<p.count;i++){
    const k=i*3,u=T.MathUtils.clamp((SCARF_SPEC.tailTop-rest[k+1])/(SCARF_SPEC.tailTop-SCARF_SPEC.tailBottom),0,1),w=u*u,dw=-2*u/(SCARF_SPEC.tailTop-SCARF_SPEC.tailBottom);
    p.array[k]=rest[k]+dx*w;p.array[k+1]=rest[k+1];p.array[k+2]=rest[k+2]+dz*w;
    const nx=normals[k],ny=normals[k+1]-dx*dw*normals[k]-dz*dw*normals[k+2],nz=normals[k+2],len=Math.hypot(nx,ny,nz);n.array[k]=nx/len;n.array[k+1]=ny/len;n.array[k+2]=nz/len;
   }
   p.needsUpdate=true;n.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  }
  return Math.hypot(dx,dz);
 }
 dispose(){if(this.disposed)return;for(const p of this.tailParts??[])p.mesh.geometry.dispose();this.tailParts=[];super.dispose();}
}
