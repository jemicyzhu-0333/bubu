import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {createTeaSceneResources,teaLimbOverrides} from '../../../original-parts-hybrid-v1/tea/src/scene-resources.mjs';

/** Isolated diagnostic snapshots. Owns copies only; one caller samples tea and
 * passes the same pose to collider targets and exact rendered-surface checks. */
export function createTeaObstacles(asset){
  const names=['Bubu_body','Bubu_hand-left','Bubu_hand-right'];
  for(const name of names)if(!asset?.getObjectByName(name)?.geometry?.attributes.position)throw Error('Missing tea obstacle '+name);
  const cup=createTeaSceneResources(),entries=[],point=new T.Vector3();
  let disposed=false;
  asset.updateMatrixWorld(true);cup.root.updateMatrixWorld(true);
  function add(name,source,kind,mesh=null){
    const geometry=source.clone(),base=new Float32Array(source.attributes.position.array);
    entries.push({name,geometry,base,kind,mesh,matrix:new T.Matrix4(),visible:true,bvh:new MeshBVH(geometry,{indirect:true})});
  }
  const dispose=()=>{if(disposed)return;disposed=true;for(const entry of entries)entry.geometry.dispose();cup.dispose();};
  try{
  for(const name of names){
    const mesh=asset.getObjectByName(name);if(!mesh)throw Error('Missing tea obstacle '+name);
    const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    add(name==='Bubu_body'?'body':name,geometry,name==='Bubu_body'?'body':'hand');geometry.dispose();
  }
  cup.root.traverse(mesh=>{if(mesh.isMesh)add(mesh.name,mesh.geometry,'cup',mesh);});
  }catch(error){dispose();throw error;}
  return {
    entries,
    apply(sample){
      if(disposed)throw Error('Tea obstacle snapshots disposed');
      const hands=teaLimbOverrides(sample);cup.apply(sample);cup.root.updateMatrixWorld(true);
      for(const entry of entries){
        if(entry.kind==='hand')entry.matrix.copy(hands[entry.name]);
        if(entry.kind==='cup'){entry.matrix.copy(entry.mesh.matrixWorld);entry.visible=cup.root.visible;}
        if(!entry.visible)continue;
        const attribute=entry.geometry.attributes.position;
        for(let i=0;i<attribute.count;i++){point.fromArray(entry.base,i*3).applyMatrix4(entry.matrix);attribute.setXYZ(i,point.x,point.y,point.z);}
        entry.geometry.computeBoundingBox();entry.bvh.refit();
      }
    },
    dispose,
  };
}
