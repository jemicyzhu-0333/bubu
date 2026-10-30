/** Research-only regional cage. Each original piping section has its own
 * shape-matching support, and embeds only in its own garment region. */
import assert from 'node:assert/strict';
import * as T from 'three';
import { createThinSurfaceMapper } from './thin-surface-mapper.mjs';
import { createPipingCollisionVolume } from './piping-collision-volume.mjs';
import { createTransfiniteClothMapper } from './transfinite-cloth-mapper.mjs';
import { createConformingSeamSurface } from './conforming-seam-surface.mjs';

export function createRegionalCollisionSkin(R, world, skin, parts, coarse, binding, retainedPins, { meshScaledMaterial=false, additionalPgsIterations=3, referenceFrequency=30, thinCloth=false, bodyFrameDetail=false, closedPiping=false, coupledSeams=false, supportSections={}, refinementHistory=[] }={}) {
  assert([3,12].includes(additionalPgsIterations),'Bounded solver convergence comparison');
  assert([30,60].includes(referenceFrequency),'Declared material comparison only');
  assert(refinementHistory.length<=26,'Regional refinement budget exceeded');
  const suppliedSkin=skin;
  const baseCount=coarse.positions.length/3;
  const layerCount=skin.baseLayerOffset/3;
  assert.equal(skin.positions.length/3,layerCount*2);
  const compactTrim=skin.ranges.length===1;
  assert(!thinCloth||!compactTrim,'Thin comparison uses the original cloth mapping');
  assert(!bodyFrameDetail||thinCloth,'Body-frame detail requires the thin cloth comparison');
  assert(!coupledSeams||(thinCloth&&bodyFrameDetail&&closedPiping&&!compactTrim),'Coupled regional seams require the full closed-piping thin-cloth comparison');
  if(compactTrim){
    const render=[],indices=[],ranges=[];
    for(const part of parts.filter(p=>p.name!=='cape_clasp')){
      const start=render.length/3;render.push(...part.geometry.attributes.position.array);
      for(const i of part.geometry.index.array)indices.push(start+i);ranges.push({name:part.name,start,count:part.geometry.attributes.position.count});
    }
    skin={...skin,skinPositions:Float32Array.from(render),skinIndices:Uint32Array.from(indices),ranges};
  }
  const clothPart=parts.find(p=>p.name==='cape_cloth');assert(clothPart);
  const surface=coupledSeams?createConformingSeamSurface(coarse,clothPart.geometry,{centroidFans:false,seamNeighbours:false}):coarse;
  const positions=Array.from(thinCloth?surface.positions:skin.positions),cells=thinCloth?[]:Array.from(skin.cells),pins=Array.from(thinCloth?retainedPins:skin.pins),rings=[],links=[],seamBindings=[];
  const regions=[{name:'cape_cloth',start:0,count:thinCloth?surface.positions.length/3:layerCount*2,cellStart:0,cellEnd:cells.length}];
  for(const part of parts.filter(p=>p.name!=='cape_cloth'&&p.name!=='cape_clasp')){
    const source=part.geometry.attributes.position,sectionCount=source.count/13;
    assert(Number.isInteger(sectionCount)&&[19,161].includes(sectionCount),'Expected unchanged 12-sided piping with seam duplicate');
    const region={name:part.name,start:positions.length/3,cellStart:cells.length};
    const records=binding.bindings.find(b=>b.name===part.name).records;
    const selected=supportSections[part.name]??(compactTrim&&sectionCount===161?Array.from({length:65},(_,i)=>Math.round(i*160/64)):Array.from({length:sectionCount},(_,i)=>i));
    assert(selected[0]===0&&selected.at(-1)===sectionCount-1&&selected.every((v,i)=>Number.isInteger(v)&&v>=0&&v<sectionCount&&(!i||v>selected[i-1])));
    region.selected=selected;
    for(let selectedIndex=0;selectedIndex<selected.length;selectedIndex++){
      const section=selected[selectedIndex];
      // The authored seam duplicates vertices 0 and 1. Use all twelve
      // distinct angular samples (1..12), as the render-section mapper does.
      const center=new T.Vector3();for(let j=1;j<=12;j++)center.add(new T.Vector3().fromBufferAttribute(source,section*13+j));center.multiplyScalar(1/12);
      const seamCenter=center.clone();
      const first=new T.Vector3().fromBufferAttribute(source,section*13).sub(center),second=new T.Vector3().fromBufferAttribute(source,section*13+4).sub(center);
      const normal=new T.Vector3().crossVectors(first,second).normalize(),u=first.clone().normalize(),v=new T.Vector3().crossVectors(normal,u);
      let radius=0;for(let j=0;j<13;j++){const delta=new T.Vector3().fromBufferAttribute(source,section*13+j).sub(center);assert(Math.abs(delta.dot(normal))<1e-6);radius=Math.max(radius,delta.length());}
      if(compactTrim){
        const centerAt=index=>{const value=new T.Vector3();for(let j=1;j<=12;j++)value.add(new T.Vector3().fromBufferAttribute(source,index*13+j));return value.multiplyScalar(1/12);};
        for(const interval of [selectedIndex-1,selectedIndex]){
          if(interval<0||interval>=selected.length-1)continue;
          const from=selected[interval],to=selected[interval+1],left=centerAt(from),right=centerAt(to);
          for(let sample=from;sample<=to;sample++){
            const linear=left.clone().lerp(right,(sample-from)/(to-from));
            for(let j=0;j<13;j++)radius=Math.max(radius,new T.Vector3().fromBufferAttribute(source,sample*13+j).distanceTo(linear));
          }
        }
        assert(radius<=.05,'Regional cage exceeds local curvature budget');
      }
      if(section===0||section===sectionCount-1){
        const neighbor=new T.Vector3(),next=section===0?1:section-1;
        for(let j=1;j<=12;j++)neighbor.add(new T.Vector3().fromBufferAttribute(source,next*13+j));neighbor.multiplyScalar(1/12);
        // Enclose the Float32 end ring in the non-colliding cage. This does
        // not move the original render/collision surface or widen its tests.
        center.addScaledVector(center.clone().sub(neighbor).normalize(),1e-5);
      }
      const ids=[];
      for(let j=0;j<3;j++){ids.push(positions.length/3);const angle=j*2*Math.PI/3;positions.push(...center.clone().addScaledVector(u,(2*radius+1e-5)*Math.cos(angle)).addScaledVector(v,(2*radius+1e-5)*Math.sin(angle)).toArray());}
      rings.push(ids);
      let fixed=false;
      if(part.name==='cape_back_edge'){
        const column=section*coarse.grid.cols/(sectionCount-1);
        const a=coarse.pins[Math.floor(column)],b=coarse.pins[Math.ceil(column)];fixed=retainedPins.includes(a)&&retainedPins.includes(b);
      }else if(part.name.startsWith('cape_front_edge')&&section===0)fixed=retainedPins.includes(part.name.endsWith('_0')?coarse.pins[0]:coarse.pins.at(-1));
      if(fixed&&!coupledSeams)pins.push(...ids);
      const clothVertex=part.name==='cape_back_edge'?section*19:part.name==='cape_hem'?section*19+18:part.name==='cape_front_edge_0'?section:3040+section,
        face=coupledSeams?binding.bindings.find(b=>b.name==='cape_cloth').records[clothVertex*7]:records[section*13*7],triangle=coarse.indices.slice(face*3,face*3+3);
      if(coupledSeams){
        const particle=surface.boundaryParticles.get(clothVertex);assert(Number.isInteger(particle));
        seamBindings.push({ids,point:seamCenter,particle,fixed:retainedPins.includes(particle)});
      }
      else for(const id of ids)for(const vertex of triangle){links.push(id,vertex);if(!thinCloth)links.push(id,vertex+layerCount);}
      if(selectedIndex){
        const [A,B,C]=ids,[a,b,c]=ids.map(i=>i-3);cells.push(a,b,c,C,a,b,B,C,a,A,B,C);
      }
    }
    region.count=positions.length/3-region.start;region.cellEnd=cells.length;regions.push(region);
  }
  assert(positions.length/3<=2048&&cells.length/4<=4096&&rings.length<=360);
  const rest=new Float32Array(positions),edgeSet=new Set(),masses=new Float64Array(rest.length/3),frames=[];
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),d=new T.Vector3();let minimumVolume=Infinity;
  for(let i=0;i<cells.length;i+=4){
    const matrix=()=>{a.fromArray(rest,cells[i]*3);b.fromArray(rest,cells[i+1]*3).sub(a);c.fromArray(rest,cells[i+2]*3).sub(a);d.fromArray(rest,cells[i+3]*3).sub(a);return new T.Matrix3().set(b.x,c.x,d.x,b.y,c.y,d.y,b.z,c.z,d.z);};
    let m=matrix();if(m.determinant()<0){[cells[i+1],cells[i+2]]=[cells[i+2],cells[i+1]];m=matrix();}
    const volume=m.determinant()/6;assert(volume>1e-10,'Degenerate regional cell');minimumVolume=Math.min(minimumVolume,volume);
    frames.push({origin:a.clone(),inverse:m.invert()});for(let j=0;j<4;j++)masses[cells[i+j]]+=volume/4;
    for(let j=0;j<4;j++)for(let k=j+1;k<4;k++){const x=cells[i+j],y=cells[i+k];edgeSet.add(`${Math.min(x,y)},${Math.max(x,y)}`);}
  }
  for(let i=0;i<links.length;i+=2){const x=links[i],y=links[i+1];edgeSet.add(`${Math.min(x,y)},${Math.max(x,y)}`);}
  const dihedrals=[],clothEdges=new Map();
  if(thinCloth)for(let i=0;i<surface.indices.length;i+=3){
    const ids=surface.indices.slice(i,i+3);a.fromArray(rest,ids[0]*3);b.fromArray(rest,ids[1]*3).sub(a);c.fromArray(rest,ids[2]*3).sub(a);
    const materialVolume=b.cross(c).length()*.5*.012;for(const id of ids)masses[id]+=materialVolume/3;
    for(let j=0;j<3;j++){
      const x=ids[j],y=ids[(j+1)%3],z=ids[(j+2)%3],key=`${Math.min(x,y)},${Math.max(x,y)}`;edgeSet.add(key);
      if(clothEdges.has(key))dihedrals.push(...clothEdges.get(key),z);else clothEdges.set(key,[x,y,z]);
    }
  }
  let minimumBarycentric=Infinity;const q=new T.Vector3();
  for(const region of regions){
    if(thinCloth&&region.name==='cape_cloth')continue;
    const source=parts.find(p=>p.name===region.name).geometry.attributes.position;
    for(let i=0;i<source.count;i++){
      let best=-Infinity;
      for(let j=region.cellStart/4;j<region.cellEnd/4;j++){
        const f=frames[j];q.fromBufferAttribute(source,i).sub(f.origin).applyMatrix3(f.inverse);
        best=Math.max(best,Math.min(q.x,q.y,q.z,1-q.x-q.y-q.z));if(best>=-1e-6)break;
      }
      if(best< -1e-6&&compactTrim&&region.name!=='cape_cloth'){
        const section=Math.floor(i/13),count=source.count/13;
        const added=[section,section-1,section+1].find(value=>value>0&&value<count-1&&!region.selected.includes(value));
        assert(added!==undefined,'Local coverage needs a different representation');
        assert(rest.length/3+3<=2048,'Coverage refinement exceeds the unchanged particle budget');
        const next=Object.fromEntries(regions.filter(r=>r.selected).map(r=>[r.name,r.selected]));
        next[region.name]=[...region.selected,added].sort((a,b)=>a-b);
        return createRegionalCollisionSkin(R,world,suppliedSkin,parts,coarse,binding,retainedPins,{meshScaledMaterial,additionalPgsIterations,referenceFrequency,thinCloth,bodyFrameDetail,closedPiping,coupledSeams,supportSections:next,
          refinementHistory:[...refinementHistory,{part:region.name,vertex:i,barycentric:best,addedSection:added}]});
      }
      assert(best>=-1e-6,`Regional cage does not cover ${region.name} vertex ${i}; barycentric=${best}`);minimumBarycentric=Math.min(minimumBarycentric,best);
    }
  }
  if(coupledSeams)for(const ids of rings){const mean=ids.reduce((sum,id)=>sum+masses[id],0)/ids.length;for(const id of ids)masses[id]=mean;}
  assert(masses.every(m=>m>0));const total=masses.reduce((s,v)=>s+v,0);for(let i=0;i<masses.length;i++)masses[i]*=baseCount*.001/total;
  const edges=Uint32Array.from([...edgeSet].flatMap(key=>key.split(',').map(Number)));
  const description=new R.SoftBodyDesc(rest).setCells(cells).setEdges(edges).setPinnedParticles(pins)
    .setMasses(Float32Array.from(masses)).setSoftness(30,1).setAdditionalPgsIterations(additionalPgsIterations).setParticleRadius(0).setSelfContacts(false).setOriented(false).setNoSurfaceCollider();
  if(thinCloth){
    description.setSurface(surface.indices).setSurfaceCollider(R.ColliderDesc.ball(.001).setFriction(.3));
    if(coupledSeams)description.setBendEdges(dihedrals.flatMap((_,i)=>i%4===0?[dihedrals[i+2],dihedrals[i+3]]:[]));
    else description.setDihedrals(dihedrals);
  }
  const frequencies=[];
  if(meshScaledMaterial){
    // Preserve the reference grid's axial wave speed when a 0.08 segment is
    // subdivided; constant per-edge frequency otherwise changes the material.
    assert.equal(coarse.grid.targetSpacing,.08);
    for(let i=0;i<edges.length;i+=2){
      const length=a.fromArray(rest,edges[i]*3).distanceTo(b.fromArray(rest,edges[i+1]*3));
      const frequency=referenceFrequency*coarse.grid.targetSpacing/length;assert(frequency>0&&frequency<=2400);frequencies.push(frequency);
    }
    description.setEdgeSoftness(Uint32Array.from({length:frequencies.length},(_,i)=>i),frequencies.map(naturalFrequency=>({naturalFrequency,dampingRatio:1})));
  }
  const cloth=world.createSoftBody(description);
  const ringProxies=new Map();
  for(const ids of rings){const cluster=world.addSoftBodyCluster(cloth,ids);assert(cluster!==null);cloth.enableClusterShapeMatching(cluster,true);assert(cloth.clusterShapeMatchingEnabled(cluster));ringProxies.set(ids,cloth.clusterProxy(cluster));}
  let fixedSeamReferences=0;
  if(coupledSeams){
    const pointProxies=new Map(),localPoint=(proxy,point)=>point.clone().sub(new T.Vector3().copy(proxy.translation())).applyQuaternion(new T.Quaternion().copy(proxy.rotation()).invert());
    for(const seam of seamBindings){
      let support;
      if(seam.fixed){support=world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(seam.point.x,seam.point.y,seam.point.z));fixedSeamReferences++;}
      else{
        if(!pointProxies.has(seam.particle)){const cluster=world.addSoftBodyCluster(cloth,[seam.particle]);assert(cluster!==null);pointProxies.set(seam.particle,cloth.clusterProxy(cluster));}
        support=pointProxies.get(seam.particle);
      }
      const proxy=ringProxies.get(seam.ids),a=localPoint(support,seam.point),b=localPoint(proxy,seam.point);
      support.setAdditionalSolverIterations(additionalPgsIterations);proxy.setAdditionalSolverIterations(additionalPgsIterations);
      assert(world.createImpulseJoint(R.JointData.spherical({x:a.x,y:a.y,z:a.z},{x:b.x,y:b.y,z:b.z}),support,proxy,true));
    }
  }
  for(const region of regions){
    if(thinCloth&&region.name==='cape_cloth'){region.mesh=0;assert(cloth.meshCollisionEnabled(0)&&!cloth.isMeshSkinned(0));continue;}
    const cluster=world.addSoftBodyCluster(cloth,Uint32Array.from({length:region.count},(_,i)=>region.start+i));assert(cluster!==null);
    const parent=cloth.clusterProxy(cluster),inverse=new T.Matrix4().compose(new T.Vector3().copy(parent.translation()),new T.Quaternion().copy(parent.rotation()),new T.Vector3(1,1,1)).invert();
    const source=parts.find(p=>p.name===region.name).geometry;
    const volume=closedPiping&&region.name!=='cape_cloth'?createPipingCollisionVolume(source):null;
    const collisionPositions=volume?.positions??source.attributes.position.array,
      collisionIndices=volume?.indices??new Uint32Array(source.index.array),local=new Float32Array(collisionPositions.length);
    for(let i=0;i<collisionPositions.length/3;i++)new T.Vector3().fromArray(collisionPositions,i*3).applyMatrix4(inverse).toArray(local,i*3);
    const flags=R.TriMeshFlags.DEFORMABLE|(volume?R.TriMeshFlags.ORIENTED:0);
    const collider=world.createDeformableCollider(R.ColliderDesc.trimesh(local,collisionIndices,flags).setFriction(.3),R.SoftMeshBinding.skinned(),parent);
    assert(collider,'Regional collision binding failed');region.mesh=cloth.meshOfCollider(collider);assert(cloth.isMeshSkinned(region.mesh)&&cloth.meshCollisionEnabled(region.mesh));
    assert.deepEqual(cloth.meshIndices(region.mesh),collisionIndices);
    if(volume){assert(cloth.isMeshOriented(region.mesh),'Closed piping must be treated as a solid');region.renderVertexMap=volume.renderVertexMap;region.volumeCertificate=volume.certificate;}
  }
  let mapper,transfinite,thinOutput,closed=false;
  if(coupledSeams)transfinite=createTransfiniteClothMapper(coarse,binding,clothPart.geometry.attributes.position);
  else if(thinCloth){
    thinOutput=new T.Float32BufferAttribute(clothPart.geometry.attributes.position.array,3);
    mapper=createThinSurfaceMapper({indices:coarse.indices,vertexCount:baseCount,restPositions:bodyFrameDetail?new Float64Array(coarse.positions):null});
    mapper.bind(binding.bindings.find(b=>b.name==='cape_cloth').records,thinOutput);
  }
  const readRendered=()=>{
    assert(!closed,'Regional collision skin disposed');
    if(thinCloth&&!coupledSeams){mapper.prepare(cloth.particlePositions().slice(0,coarse.positions.length));mapper.apply();}
    const rendered=new Float32Array(skin.skinPositions.length);
    const piping=new Map();
    for(const range of skin.ranges){
      if(coupledSeams&&range.name==='cape_cloth')continue;
      const region=regions.find(r=>r.name===range.name),values=thinCloth&&region.name==='cape_cloth'?thinOutput.array:cloth.meshVertices(region.mesh);
      if(region.renderVertexMap){for(let i=0;i<range.count;i++)for(let k=0;k<3;k++)rendered[(range.start+i)*3+k]=values[region.renderVertexMap[i]*3+k];}
      else{assert.equal(values.length,range.count*3);rendered.set(values,range.start*3);}
      if(coupledSeams)piping.set(range.name,rendered.subarray(range.start*3,(range.start+range.count)*3));
    }
    if(coupledSeams){const range=skin.ranges.find(r=>r.name==='cape_cloth');rendered.set(transfinite.map(cloth.particlePositions().slice(0,coarse.positions.length),piping),range.start*3);}
    return rendered;
  };
  return {cloth,readRendered,dispose:()=>{if(closed)return;closed=true;mapper?.dispose();transfinite?.dispose();},skin:{...skin,positions:rest,cells:Uint32Array.from(cells),edges,pins:Uint32Array.from(pins),masses:Float32Array.from(masses),baseLayerOffset:layerCount*3,thinCloth,clothIndices:surface.indices,
    certificate:{...skin.certificate,particleCount:rest.length/3,cellCount:cells.length/4,minimumCellVolume:minimumVolume,minimumBarycentric,
      mapping:coupledSeams?'transfinite cloth plus actual regional collision skin with bilateral seam joints':thinCloth?(bodyFrameDetail?'body-frame rest-detail cloth plus regional piping cells':'original thin cloth mapping plus regional piping cells'):'separate cloth and piping cell regions',collisionSurface:coupledSeams?'boundary-refined cloth triangles plus actual detailed piping; transfinite cloth is not the native collision mesh':thinCloth?'original coarse cloth triangles plus actual detailed piping':'actual-detailed-skin',renderCount:skin.skinPositions.length/3,crossSectionClusters:rings.length,fixedParticles:pins.length,additionalPgsIterations,refinementHistory,
      coupledSeams:coupledSeams?{jointCount:seamBindings.length,fixedSeamReferences,additionalJointSolverIterations:additionalPgsIterations,ringMass:'equal corner masses preserving each ring total',boundarySurface:surface.certificate,scope:'Original support particles retained. Each seam attaches to its actual authored border particle; fixed references occur only at retained source pins. Proxy inertia is not a calibrated cloth material.'}:null,
      minimumParticleMass:Math.min(...masses),maximumParticleMass:Math.max(...masses),
      closedPipingVolumes:regions.filter(r=>r.volumeCertificate).map(r=>({part:r.name,...r.volumeCertificate})),
      axialMaterial:meshScaledMaterial?{referenceLength:.08,referenceFrequency,minFrequency:Math.min(...frequencies),maxFrequency:Math.max(...frequencies)}:'uniform-frequency-comparison'}}};
}
