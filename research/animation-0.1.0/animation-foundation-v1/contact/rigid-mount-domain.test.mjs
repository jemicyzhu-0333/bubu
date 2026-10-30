import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createRigidMountDomain} from './rigid-mount-domain.mjs';

function fixture(){
  const root=new T.Group(),bone=new T.Bone();root.add(bone);
  const body=new T.SkinnedMesh(new T.BoxGeometry(.1,.1,.1));body.name='body';root.add(body);
  const count=body.geometry.attributes.position.count,weights=new Float32Array(count*4);
  for(let i=0;i<count;i++)weights[i*4]=1;
  body.geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(count*4),4));
  body.geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
  body.bind(new T.Skeleton([bone]));
  const mounts=new Map(),definitions=[];
  for(const [id,x]of [['a',-.5],['b',.5]]){
    const mountRoot=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(.1,.1,.1));
    mountRoot.position.x=x;mountRoot.add(mesh);bone.add(mountRoot);
    mounts.set(id,{root:mountRoot,spec:{anchor:id}});
    definitions.push({id,part:'body',vertex:0,skinWeights:[1,0,0,0],skinIndices:[0,0,0,0]});
  }
  root.updateMatrixWorld(true);
  return {root,bone,body,mounts,definitions,dispose(){root.traverse(n=>n.geometry?.dispose());}};
}
test('common-rigid separation is invariant for arbitrary path values and rejects independent mount motion',()=>{
  const f=fixture();
  try{
    const domain=createRigidMountDomain(f);
    assert(domain.report().pairs[0].clearanceAfterNumericalAllowance>.89);
    for(let i=0;i<37;i++){
      const t=i*Math.SQRT2;
      f.bone.position.set(Math.sin(t),Math.cos(t*3),t*.1);
      f.bone.rotation.set(t*.4,t*.7,-t*.2);f.root.updateMatrixWorld(true);domain.assertCurrent();
    }
    assert.equal(domain.report().premiseChecks,37);
    assert.equal(domain.report().wholeWardrobeAccepted,false);
    f.mounts.get('b').root.position.y+=.01;f.root.updateMatrixWorld(true);
    assert.throws(()=>domain.assertCurrent(),/left the common rigid domain/);
  }finally{f.dispose();}
});
test('nonrigid common transforms and independent geometry edits cannot borrow a rigid certificate',()=>{
  for(const change of ['scale','geometry']){
    const f=fixture();try{
      const domain=createRigidMountDomain(f);
      if(change==='scale')f.bone.scale.x=1.01;
      else f.mounts.get('a').root.children[0].geometry.attributes.position.array[0]+=.01;
      f.root.updateMatrixWorld(true);
      assert.throws(()=>domain.assertCurrent(),/rigid transform|geometry/);
    }finally{f.dispose();}
  }
});
