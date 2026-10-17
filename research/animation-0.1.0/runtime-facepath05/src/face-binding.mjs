import {fail,num} from './contracts.mjs';
/** Bounded immutable mapping, compiled once. One path, max two adjacent knots.
 * All eight layer influence arrays are reset when changed; no geometry writes. */
export function bindFacePaths(model,profile) {
  const meshes=profile.faceMeshes.map(name=>{
    const mesh=model.getObjectByName(name);
    if(!mesh?.isMesh||!mesh.morphTargetInfluences||!mesh.morphTargetDictionary)fail('BINDING','Missing face layer '+name);
    return mesh;
  });
  const paths=new Map(profile.paths.map(path=>[path.id,meshes.map(mesh=>path.knots.map(k=>{
    const index=mesh.morphTargetDictionary[k.target];
    if(!Number.isInteger(index)||index<0||index>=mesh.morphTargetInfluences.length)fail('BINDING','Missing '+k.target+' on '+mesh.name);
    return index;
  }))]));
  let lastPath=Symbol(),lastAmount=-1,disposed=false;
  return {
    apply(path,amount) {
      if(disposed)fail('DISPOSED','Face binding');num(amount,0,1,'Face intensity');
      if(path!==null&&!paths.has(path))fail('REFERENCE','Unknown semantic face');
      if(path===null&&amount!==0)fail('BINDING','Nonzero Basis');
      if(path===lastPath&&amount===lastAmount)return false;
      for(const mesh of meshes)mesh.morphTargetInfluences.fill(0);
      if(path!==null&&amount>0) {
        const scaled=amount*8,upper=Math.ceil(scaled)-1,u=scaled-upper,indices=paths.get(path);
        for(let m=0;m<meshes.length;m++) {
          const weights=meshes[m].morphTargetInfluences,slots=indices[m];
          if(upper>0)weights[slots[upper-1]]=1-u;
          weights[slots[upper]]=u;
        }
      }
      lastPath=path;lastAmount=amount;return true;
    },
    assertCurrent(path,amount) {
      if(disposed)fail('DISPOSED','Face binding');num(amount,0,1,'Face intensity');
      if(path!==null&&!paths.has(path))fail('REFERENCE','Unknown semantic face');
      if(path===null&&amount!==0)fail('BINDING','Nonzero Basis');
      const indices=path===null?null:paths.get(path),scaled=amount*8,upper=Math.ceil(scaled)-1,u=scaled-upper;
      if(amount>0&&!indices)fail('REFERENCE','Unknown semantic face');
      for(let m=0;m<meshes.length;m++)for(let i=0;i<meshes[m].morphTargetInfluences.length;i++) {
        let expected=0;
        if(amount>0){if(i===indices[m][upper])expected=u;else if(upper>0&&i===indices[m][upper-1])expected=1-u;}
        if(meshes[m].morphTargetInfluences[i]!==expected)fail('FACE_INVARIANT','Unexpected active layer/target');
      }
      return true;
    },
    dispose(){if(disposed)return;disposed=true;meshes.length=0;paths.clear();}
  };
}
