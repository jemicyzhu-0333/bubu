import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';

/** Offline diagnostic only. Surface crossings are failure witnesses, while a
 * clear sample says nothing about containment or the interval between samples. */
export function createSurfaceProbe(groups) {
  const entries=[],point=new T.Vector3(),relative=new T.Matrix4();
  for(const [group,root] of groups)root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
    const geometry=new T.BufferGeometry(),source=mesh.geometry;
    geometry.setAttribute('position',source.attributes.position.clone());
    if(source.index)geometry.setIndex(source.index.clone());
    const entry={group,mesh,geometry,bvh:null,worldBounds:new T.Box3(),inverse:new T.Matrix4()};
    entries.push(entry);
  });
  const visible=mesh=>{for(let node=mesh;node;node=node.parent)if(!node.visible)return false;return true;};
  function update(){
    for(const e of entries){
      e.visible=visible(e.mesh);if(!e.visible)continue;
      const positions=e.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){e.mesh.getVertexPosition(i,point);positions.setXYZ(i,point.x,point.y,point.z);}
      e.geometry.computeBoundingBox();e.geometry.computeBoundingSphere();
      if(e.bvh)e.bvh.refit();else {e.bvh=new MeshBVH(e.geometry,{indirect:true});e.geometry.boundsTree=e.bvh;}
      e.inverse.copy(e.mesh.matrixWorld).invert();e.worldBounds.copy(e.geometry.boundingBox).applyMatrix4(e.mesh.matrixWorld);
    }
  }
  return {
    distances(pairs){
      update();
      return pairs.map(pair=>{
        const found=pair.map(name=>entries.find(e=>`${e.group}/${e.mesh.name}`===name));
        if(found.some(e=>!e?.visible))throw Error('Visible named contact parts required');
        const [a,b]=found,e=a.mesh.matrixWorld.elements;
        if(Math.abs(a.mesh.matrixWorld.determinant()-1)>1e-6||[0,4,8].some(i=>Math.abs(Math.hypot(e[i],e[i+1],e[i+2])-1)>1e-6))throw Error('Rigid distance frame required');
        relative.multiplyMatrices(a.inverse,b.mesh.matrixWorld);
        const closest=a.bvh.closestPointToGeometry(b.geometry,relative,{},null,1e-12);
        return {pair,distance:closest.distance};
      });
    },
    roster:()=>entries.map(e=>({group:e.group,name:e.mesh.name,vertices:e.geometry.attributes.position.count,triangles:(e.geometry.index?.count??e.geometry.attributes.position.count)/3})),
    sample(){
      update();const contacts=[];
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const a=entries[i],b=entries[j];
        if(!a.visible||!b.visible||a.group===b.group||!a.worldBounds.intersectsBox(b.worldBounds))continue;
        relative.multiplyMatrices(a.inverse,b.mesh.matrixWorld);let witness;
        a.bvh.bvhcast(b.bvh,relative,{intersectsTriangles:(ta,tb)=>{
          if(!ta.intersectsTriangle(tb))return false;
          witness={a:[ta.a,ta.b,ta.c].map(v=>v.clone().applyMatrix4(a.mesh.matrixWorld).toArray()),b:[tb.a,tb.b,tb.c].map(v=>v.clone().applyMatrix4(a.mesh.matrixWorld).toArray())};
          return true;
        }});
        if(witness)contacts.push({pair:[`${a.group}/${a.mesh.name}`,`${b.group}/${b.mesh.name}`],witness});
      }
      return contacts;
    },
    dispose(){for(const e of entries)e.geometry.dispose();entries.length=0;},
  };
}
