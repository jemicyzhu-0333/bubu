import * as T from 'three';
import {createRigidFitSnapshot} from './rigid-fit-snapshot.mjs';

const rigid=matrix=>{
  const e=matrix.elements;
  if(!e.every(Number.isFinite)||Math.abs(matrix.determinant()-1)>1e-8||
      [3,7,11].some(i=>Math.abs(e[i])>1e-10)||Math.abs(e[15]-1)>1e-10)
    throw Error('Common proper rigid transform required');
  for(let i=0;i<3;i++)for(let j=i;j<3;j++)
    if(Math.abs(e[i*4]*e[j*4]+e[i*4+1]*e[j*4+1]+e[i*4+2]*e[j*4+2]-(i===j?1:0))>1e-8)
      throw Error('Common proper rigid transform required');
};

/** Conditional geometric certificate, not a sampled-motion extrapolation.
 * If every selected mount is G(t) C_i for one proper rigid G(t), its pairwise
 * distances are invariant for every t, regardless of G's speed or path.
 * assertCurrent checks these premises at runtime samples; it does not prove
 * a spring, a blended bone, or an arbitrary controller is in that domain. */
export function createRigidMountDomain({mounts,body,definitions}) {
  if(!body?.isSkinnedMesh||!(mounts instanceof Map)||mounts.size<2)throw Error('Rigid mount domain inputs required');
  const selected=[...mounts].map(([id,mount])=>{
    const definition=definitions.find(d=>d.id===mount.spec.anchor);
    if(mount.secondary||!definition||definition.part!==body.name||
        definition.skinWeights[0]!==1||definition.skinWeights.slice(1).some(w=>w!==0))
      throw Error('Single common bone and rigid-follow mounts required');
    const vertex=definition.vertex;
    const indices=body.geometry.attributes.skinIndex,weights=body.geometry.attributes.skinWeight;
    if(!indices||!weights||indices.itemSize!==4||weights.itemSize!==4||
        [0,1,2,3].some(k=>indices.array[vertex*4+k]!==definition.skinIndices[k]||weights.array[vertex*4+k]!==definition.skinWeights[k]))
      throw Error('Actual anchor weights differ from the declared rigid domain');
    for(const [name,attributes]of Object.entries(body.geometry.morphAttributes))
      for(const attribute of attributes)for(let k=0;k<3;k++)
        if(attribute.array[vertex*3+k]-(body.geometry.morphTargetsRelative?0:body.geometry.attributes[name].array[vertex*3+k])!==0)
          throw Error('Morphing anchor is outside the rigid domain');
    const geometry=[],nodes=[];
    mount.root.traverse(node=>{
      if(node!==mount.root)nodes.push({node,parent:node.parent,local:node.matrix.clone()});
      if(!node.isMesh)return;
      if(node.isSkinnedMesh||Object.keys(node.geometry.morphAttributes).length)throw Error('Deforming mount is outside the rigid domain');
      geometry.push({node,source:node.geometry,array:node.geometry.attributes.position.array,
        rest:node.geometry.attributes.position.array.slice(),index:node.geometry.index?.array,
        indexRest:node.geometry.index?.array.slice()});
    });
    return {id,mount,definition,geometry,nodes};
  });
  const boneIndex=selected[0].definition.skinIndices[0];
  if(selected.some(s=>s.definition.skinIndices[0]!==boneIndex))throw Error('Different anchor bones are outside the rigid domain');
  function common(){
    const matrix=body.matrixWorld.clone().multiply(body.bindMatrixInverse)
      .multiply(body.skeleton.bones[boneIndex].matrixWorld).multiply(body.skeleton.boneInverses[boneIndex]).multiply(body.bindMatrix);
    rigid(matrix);return matrix;
  }
  const inverse=common().invert();
  for(const s of selected)s.relative=inverse.clone().multiply(s.mount.root.matrixWorld);
  const snapshot=createRigidFitSnapshot(new Map(selected.map(s=>[s.id,s.mount.root]))),pairs=[];
  try{
    for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){
      const a=selected[i].id,b=selected[j].id;
      const closest=snapshot.minimumDistance({}, {includePair:(x,y)=>(x===a&&y===b)||(x===b&&y===a)});
      if(!closest||closest.distance<=1e-6)throw Error('Rigid domains lack the original measurable clearance');
      pairs.push({groups:[a,b],...closest,clearanceAfterNumericalAllowance:closest.distance-1e-6});
    }
  }finally{snapshot.dispose();}
  let samples=0,maximumRelativeDrift=0;
  return {
    assertCurrent(){
      const inverse=common().invert();
      for(const s of selected){
        const relative=inverse.clone().multiply(s.mount.root.matrixWorld),
          drift=Math.max(...relative.elements.map((v,i)=>Math.abs(v-s.relative.elements[i])));
        if(drift>1e-10)throw Error('Mount left the common rigid domain');
        maximumRelativeDrift=Math.max(maximumRelativeDrift,drift);
        let nodeCount=0;s.mount.root.traverse(()=>nodeCount++);
        if(nodeCount!==s.nodes.length+1)throw Error('Rigid mount hierarchy changed');
        for(const n of s.nodes)if(n.node.parent!==n.parent||!n.node.matrix.equals(n.local))throw Error('Rigid mount hierarchy or local pose changed');
        for(const g of s.geometry){
          if(g.node.geometry!==g.source||g.node.geometry.attributes.position.array!==g.array||
              g.array.some((v,i)=>v!==g.rest[i])||g.node.geometry.index?.array!==g.index||
              g.index?.some((v,i)=>v!==g.indexRest[i]))
            throw Error('Rigid mount geometry or local pose changed');
        }
      }
      samples++;
    },
    report:()=>({scope:'Conditional continuous surface separation under a common proper rigid transform',
      proof:'(G C_a)^-1 (G C_b) = C_a^-1 C_b; proper rigid transforms preserve all triangle distances',
      boneIndex,pairs,premiseChecks:samples,maximumRelativeDrift,wholeWardrobeAccepted:false,
      exclusions:['No guarantee for non-rigid common transforms or changed anchors/geometry.',
        'Body, tail, cape and satchel pairs, containment, self-contact and finite material thickness remain outside this certificate.']}),
  };
}
