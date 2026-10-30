import assert from 'node:assert/strict';
import * as T from 'three';
import {createPipingCollisionVolume} from './piping-collision-volume.mjs';
import {createCentroidConstraints} from './centroid-constraints.mjs';

// The isolated native probe loses support response at the source's small-cell
// scale. Express the world in centimetres; callers scale gravity, colliders and
// lengthUnit too. This fixes embedding, not the failed dynamic material model.
// Public geometry, thresholds, masses, frequencies and time remain unchanged.
export const SHARED_SURFACE_UNITS_PER_MODEL_UNIT = 100;

/** Isolated native cage experiment. Every displayed vertex is read from its
 * actual collision mesh; no independently deformed display surface exists.
 * The caller owns the world/time and frees all native bodies and colliders. */
export function createSharedSurfaceCloth(R,world,data,parts,coarse,retainedPins,{additionalPgsIterations=12,particleCentroids=false,coupledContactStiffness=false}={}) {
  const units=SHARED_SURFACE_UNITS_PER_MODEL_UNIT;
  assert.equal(world.integrationParameters.lengthUnit,units,'Shared world units must match');
  assert.equal(data.schema,'bubu-shared-surface-cage/1');
  assert([3,12].includes(additionalPgsIterations));
  assert.equal(typeof coupledContactStiffness,'boolean');
  assert(Array.isArray(data.positions)&&data.positions.length%3===0&&data.positions.length/3<=2048);
  assert(data.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<10));
  const rest=Float32Array.from(data.positions),count=rest.length/3;
  assert(count>0);
  assert(data.cells.length%4===0&&data.cells.length/4<=4096);
  assert(data.cells.every(i=>Number.isSafeInteger(i)&&i>=0&&i<count));
  assert.deepEqual(data.pinRecords.map(p=>p.original),Array.from(retainedPins));
  assert.equal(new Set(data.pins).size,retainedPins.length);
  for(const pin of data.pinRecords){
    assert(data.pins.includes(pin.particle));
    assert.deepEqual(pin.position,coarse.positions.slice(pin.original*3,pin.original*3+3));
    assert(Math.hypot(...[0,1,2].map(k=>rest[pin.particle*3+k]-pin.position[k]))<1e-7,'Original support moved');
  }
  assert.deepEqual(data.sourceParts.map(p=>p.name).sort(),['cape_back_edge','cape_cloth','cape_hem']);
  assert.deepEqual(Object.keys(data.fronts).sort(),['cape_front_edge_0','cape_front_edge_1']);
  assert.equal(data.sections.length,163);
  assert.equal(data.backCenters.length,161);
  for(const part of data.sourceParts){
    const source=parts.find(p=>p.name===part.name)?.geometry;assert(source);
    assert.deepEqual(part.positions,Array.from(source.attributes.position.array));
    assert.deepEqual(part.indices,Array.from(source.index.array));
  }
  const cells=Uint32Array.from(data.cells),masses=new Float64Array(count),edges=new Set(),frames=[];
  const point=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let minimumVolume=Infinity;
  const edge=(x,y)=>{assert(x!==y);edges.add([Math.min(x,y),Math.max(x,y)].join(','));};
  for(let i=0;i<cells.length;i+=4){
    const ids=Array.from(cells.subarray(i,i+4)),origin=new T.Vector3().fromArray(rest,ids[0]*3);
    a.fromArray(rest,ids[1]*3).sub(origin);b.fromArray(rest,ids[2]*3).sub(origin);c.fromArray(rest,ids[3]*3).sub(origin);
    const matrix=new T.Matrix3().set(a.x,b.x,c.x,a.y,b.y,c.y,a.z,b.z,c.z),volume=matrix.determinant()/6;
    assert(volume>1e-10,'Degenerate shared cell');minimumVolume=Math.min(minimumVolume,volume);
    frames.push({ids,origin,inverse:matrix.invert(),bounds:new T.Box3().setFromPoints(ids.map(id=>new T.Vector3().fromArray(rest,id*3))).expandByScalar(1e-7)});
    for(const id of ids)masses[id]+=volume/4;
    for(let j=0;j<4;j++)for(let k=j+1;k<4;k++)edge(ids[j],ids[k]);
  }
  let minimumBarycentric=Infinity;
  for(const part of data.sourceParts)for(let i=0;i<part.positions.length;i+=3){
    point.fromArray(part.positions,i);let best=-Infinity;
    // Centroid-nearest pruning is invalid for elongated cells. Check every
    // AABB candidate, then the actual tetrahedral containment predicate.
    for(const frame of frames){
      if(!frame.bounds.containsPoint(point))continue;
      a.copy(point).sub(frame.origin).applyMatrix3(frame.inverse);
      best=Math.max(best,Math.min(a.x,a.y,a.z,1-a.x-a.y-a.z));
    }
    assert(best>=-1e-6,`Uncovered native source ${part.name}:${i/3}`);minimumBarycentric=Math.min(minimumBarycentric,best);
  }
  assert.equal(data.referenceBinding.cells.length,coarse.positions.length/3);
  for(let i=0;i<data.referenceBinding.cells.length;i++){
    const frame=frames[data.referenceBinding.cells[i]],w=data.referenceBinding.weights[i];assert(frame&&w.length===4&&w.every(v=>Number.isFinite(v)&&v>=-1e-6)&&Math.abs(w.reduce((s,v)=>s+v,0)-1)<1e-8);
    a.set(0,0,0);for(let j=0;j<4;j++)a.addScaledVector(b.fromArray(rest,frame.ids[j]*3),w[j]);
    assert(a.distanceTo(b.fromArray(coarse.positions,i*3))<1e-7,'Reference point binding changed');
  }
  const fronts=[];
  for(const [name,front]of Object.entries(data.fronts)){
    const source=parts.find(p=>p.name===name).geometry,volume=createPipingCollisionVolume(source);
    assert.equal(front.centers.length,19);assert.equal(front.radial.length,19);
    const collisionMap=Uint32Array.from({length:volume.positions.length/3},(_,i)=>i<228?front.radial[Math.floor(i/12)][i%12]:front.centers[i===228?0:18]);
    for(let i=0;i<collisionMap.length;i++)assert(Math.hypot(...[0,1,2].map(k=>rest[collisionMap[i]*3+k]-volume.positions[i*3+k]))<1e-7);
    const indices=Uint32Array.from(volume.indices,i=>collisionMap[i]);
    for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++)edge(indices[i+j],indices[i+(j+1)%3]);
    for(let section=0;section<19;section++){
      const ids=front.radial[section];assert.equal(ids.length,12);
      for(const id of ids){assert(Number.isInteger(id)&&id<count&&masses[id]===0);edge(front.centers[section],id);}
      const radius=a.fromArray(rest,ids[0]*3).distanceTo(b.fromArray(rest,front.centers[section]*3));
      let length=0;
      for(const next of [section-1,section+1])if(next>=0&&next<19)length+=a.fromArray(rest,front.centers[section]*3).distanceTo(b.fromArray(rest,front.centers[next]*3))/2;
      for(const id of ids)masses[id]=Math.PI*radius**2*length/12;
    }
    fronts.push({name,...front,volume,collisionMap});
  }
  // Equal ring-corner masses make the triangle proxy's COM the real local
  // section center. Keep the ring's total mass and total garment mass.
  for(const section of data.sections)for(const ids of [section.backIds,section.backIds.map(id=>id+5)]){
    const mean=ids.reduce((sum,id)=>sum+masses[id],0)/3;for(const id of ids)masses[id]=mean;
  }
  assert(masses.every(m=>m>0));const scale=.444/masses.reduce((s,v)=>s+v,0);for(let i=0;i<count;i++)masses[i]*=scale;
  const edgeIndices=Uint32Array.from([...edges].flatMap(e=>e.split(',').map(Number))),softness=[];
  for(let i=0;i<edgeIndices.length;i+=2){
    const length=a.fromArray(rest,edgeIndices[i]*3).distanceTo(b.fromArray(rest,edgeIndices[i+1]*3)),naturalFrequency=30*.08/length;
    assert(naturalFrequency>0&&naturalFrequency<=2400,'Original axial material bound exceeded');softness.push({naturalFrequency,dampingRatio:1});
  }
  // This factory is used only by the isolated shared-cage world. Its axial
  // constraints scale with edge length, while native contact softness starts
  // from the body's 30 Hz. Match their declared upper bound in this opt-in
  // comparison; keep geometry, contact margin and acceptance limits unchanged.
  // A stiffer contact alone cannot admit the failed material/seam system.
  if(coupledContactStiffness)world.integrationParameters.softBodiesContactStiffening=Math.max(
    world.integrationParameters.softBodiesContactStiffening,2400/30);
  const description=new R.SoftBodyDesc(Float32Array.from(rest,v=>v*units)).setCells(cells).setEdges(edgeIndices).setMasses(Float32Array.from(masses)).setPinnedParticles(data.pins)
    .setSoftness(30,1).setAdditionalPgsIterations(additionalPgsIterations).setParticleRadius(0).setSelfContacts(false).setOriented(false).setNoSurfaceCollider();
  description.setEdgeSoftness(Uint32Array.from({length:softness.length},(_,i)=>i),softness);
  const cloth=world.createSoftBody(description),pinSet=new Set(data.pins);let closed=false;
  const centroids=createCentroidConstraints(R,world,cloth,{additionalPgsIterations,particleCentroids});
  const proxyFor=ids=>{const id=world.addSoftBodyCluster(cloth,ids);assert(id!==null);return {id,proxy:cloth.clusterProxy(id)};};
  function connectCenter(ids,center){
    const {proxy}=proxyFor(ids),p=new T.Vector3().fromArray(rest,center*3).multiplyScalar(units);
    centroids.connect(proxy,center,p,pinSet.has(center));
  }
  for(const [i,section]of data.sections.entries()){
    for(const ids of [section.backIds,section.backIds.map(id=>id+5)]){const {id}=proxyFor(ids);cloth.enableClusterShapeMatching(id,true);}
    if(i>0&&i<data.sections.length-1)connectCenter(section.backIds,data.backCenters[i-1]);
  }
  for(const front of fronts){
    for(let i=0;i<19;i++){
      const {id}=proxyFor([...front.radial[i],front.centers[i]]);cloth.enableClusterShapeMatching(id,true);
      connectCenter(front.radial[i],front.centers[i]);
    }
    const column=front.name.endsWith('_0')?1:data.sections.length-2;
    connectCenter(data.sections[column].backIds.map(id=>id+5),front.centers[18]);
  }
  const {proxy:parent}=proxyFor(Uint32Array.from({length:count},(_,i)=>i)),inverse=new T.Matrix4().compose(new T.Vector3().copy(parent.translation()),new T.Quaternion().copy(parent.rotation()),new T.Vector3(1,1,1)).invert();
  const nativeParts=[];
  for(const part of parts.filter(p=>p.name!=='cape_clasp')){
    const front=fronts.find(p=>p.name===part.name),volume=part.name==='cape_cloth'?null:front?.volume??createPipingCollisionVolume(part.geometry),
      positions=volume?.positions??part.geometry.attributes.position.array,indices=volume?.indices??Uint32Array.from(part.geometry.index.array),relative=new Float32Array(positions.length);
    for(let i=0;i<positions.length;i+=3)a.fromArray(positions,i).multiplyScalar(units).applyMatrix4(inverse).toArray(relative,i);
    const binding=front?R.SoftMeshBinding.direct(front.collisionMap):R.SoftMeshBinding.skinned(),flags=R.TriMeshFlags.DEFORMABLE|(volume?R.TriMeshFlags.ORIENTED:0);
    const collider=world.createDeformableCollider(R.ColliderDesc.trimesh(relative,indices,flags).setFriction(.3),binding,parent);assert(collider,'Shared native collision binding failed');
    const mesh=cloth.meshOfCollider(collider);assert(cloth.meshCollisionEnabled(mesh));assert.equal(cloth.isMeshSkinned(mesh),!front);assert.equal(cloth.isMeshOriented(mesh),!!volume);assert.deepEqual(cloth.meshIndices(mesh),indices);
    nativeParts.push({name:part.name,mesh,renderVertexMap:volume?.renderVertexMap??null,source:part.geometry.attributes.position.array,volume:volume?.certificate});
  }
  const skinPositions=[],skinIndices=[],ranges=[];
  for(const part of parts.filter(p=>p.name!=='cape_clasp')){
    const start=skinPositions.length/3;skinPositions.push(...part.geometry.attributes.position.array);for(const id of part.geometry.index.array)skinIndices.push(start+id);
    ranges.push({name:part.name,start,count:part.geometry.attributes.position.count});
  }
  return {cloth,nativeClothMesh:nativeParts.find(p=>p.name==='cape_cloth').mesh,
    readParticles(){assert(!closed,'Shared surface disposed');return cloth.particlePositions().map(v=>v/units);},
    readRendered(){assert(!closed,'Shared surface disposed');const out=new Float32Array(skinPositions.length);for(const range of ranges){const p=nativeParts.find(p=>p.name===range.name),values=cloth.meshVertices(p.mesh);for(let i=0;i<range.count;i++)for(let k=0;k<3;k++)out[(range.start+i)*3+k]=values[(p.renderVertexMap?.[i]??i)*3+k]/units;}return out;},
    readReference(particles){assert(!closed,'Shared surface disposed');const out=new Float32Array(coarse.positions.length);for(let i=0;i<data.referenceBinding.cells.length;i++){const f=frames[data.referenceBinding.cells[i]],w=data.referenceBinding.weights[i];a.set(0,0,0);for(let j=0;j<4;j++)a.addScaledVector(b.fromArray(particles,f.ids[j]*3),w[j]);a.toArray(out,i*3);}return out;},
    dispose(){closed=true;},
    skin:{positions:rest,cells,edges:edgeIndices,pins:Uint32Array.from(data.pins),masses:Float32Array.from(masses),skinPositions:Float32Array.from(skinPositions),skinIndices:Uint32Array.from(skinIndices),ranges,
      certificate:{particleCount:count,cellCount:cells.length/4,fixedParticles:pinSet.size,minimumCellVolume:minimumVolume,minimumBarycentric,renderCount:skinPositions.length/3,
        mapping:'actual native collision vertices are the only rendered deformation',collisionSurface:'all original cloth and piping exterior triangles; collision-only tube end caps',...centroids.certificate(),additionalPgsIterations,physicsUnitsPerModelUnit:units,
        coupledContactStiffness,contactStiffening:world.integrationParameters.softBodiesContactStiffening,maximumAxialFrequency:Math.max(...softness.map(s=>s.naturalFrequency)),
        sourceGeometryUnchanged:true,coarseReference:'diagnostic embedded reference only; not the collision surface',nativeParts:nativeParts.map(p=>({name:p.name,mesh:p.mesh,closedVolume:p.volume??null})),
        productionAccepted:false,selfContact:'unestablished; prior no-self-contact research scope retained'}}};
}
