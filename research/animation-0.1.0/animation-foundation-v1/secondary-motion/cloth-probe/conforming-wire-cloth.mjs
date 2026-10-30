import assert from 'node:assert/strict';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {createConformingSeamSurface} from './conforming-seam-surface.mjs';
import {createConformingClothBinding} from './conforming-cloth-binding.mjs';
import {createThinSurfaceMapper} from './thin-surface-mapper.mjs';
import {createWireSectionMapper} from './wire-section-mapper.mjs';
import {createTransfiniteClothMapper} from './transfinite-cloth-mapper.mjs';
import {createPipingCollisionVolume} from './piping-collision-volume.mjs';

/** Isolated research: one cloth surface and four local wire bodies, stepped
 * together in the caller's world. Bilateral joints sew the actual border
 * particles; no one-way particle attachment or independent render seam snap. */
export function createConformingWireCloth(R,world,parts,coarse,pins,{bodyProxy,additionalPgsIterations=12,transfiniteBinding=null,wireBending=false,framedFronts=false,resolvedFronts=false}={}) {
  assert(bodyProxy?.isBufferGeometry,'Certified local body proxy required');
  assert([3,12].includes(additionalPgsIterations));
  assert(!framedFronts||(transfiniteBinding&&!wireBending),'Physical front-section frames require their own explicit mapping comparison');
  assert(!resolvedFronts||(transfiniteBinding&&!wireBending&&!framedFronts),'Direct front surfaces require a separate explicit comparison');
  const clothPart=parts.find(p=>p.name==='cape_cloth'),surface=createConformingSeamSurface(coarse,clothPart.geometry),
    binding=createConformingClothBinding(surface,clothPart.geometry.attributes.position),
    restCloth=Float32Array.from(surface.positions),clothMass=new Float64Array(restCloth.length/3),
    clothEdges=new Map(),dihedrals=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),wire=[];
  let mapper,transfinite,closed=false;
  try{
    for(let i=0;i<surface.indices.length;i+=3){
      const ids=surface.indices.slice(i,i+3);
      a.fromArray(restCloth,ids[0]*3);b.fromArray(restCloth,ids[1]*3).sub(a);c.fromArray(restCloth,ids[2]*3).sub(a);
      const volume=b.cross(c).length()*.5*.012;assert(volume>1e-12);
      for(const id of ids)clothMass[id]+=volume/3;
      for(let j=0;j<3;j++){
        const x=ids[j],y=ids[(j+1)%3],z=ids[(j+2)%3],key=[Math.min(x,y),Math.max(x,y)].join(',');
        if(clothEdges.has(key))dihedrals.push(...clothEdges.get(key),z);else clothEdges.set(key,[x,y,z]);
      }
    }
    const allRest=Array.from(restCloth),allEdges=[...clothEdges.values()].flatMap(e=>e.slice(0,2)),
      totalClothMass=clothMass.reduce((sum,m)=>sum+m,0);
    let totalVolume=totalClothMass;
    for(const part of parts.filter(p=>!['cape_cloth','cape_clasp'].includes(p.name))){
      const count=part.geometry.attributes.position.count/13,centers=new Float32Array(count*3),border=[],segments=[];
      for(let i=0;i<count;i++){
        const vertex=part.name==='cape_back_edge'?i*19:part.name==='cape_hem'?i*19+18:part.name==='cape_front_edge_0'?i:3040+i,
          particle=surface.boundaryParticles.get(vertex);
        assert(particle!==undefined);border.push(particle);centers.set(restCloth.subarray(particle*3,particle*3+3),i*3);
        if(i)segments.push(i-1,i);
      }
      const resolved=resolvedFronts&&part.name.startsWith('cape_front_edge_'),framed=(framedFronts||resolvedFronts)&&part.name.startsWith('cape_front_edge_'),
        markerCount=resolved?12:framed?4:0,framePoints=framed?new Float32Array(count*6):null;
      if(framed)for(let i=0;i<count;i++)for(const [j,sample]of [1,4].entries())
        framePoints.set(part.geometry.attributes.position.array.subarray((i*13+sample)*3,(i*13+sample)*3+3),i*6+j*3);
      const sectionMapper=createWireSectionMapper(part.geometry,centers,{restFramePoints:framePoints}),masses=new Float64Array(count),offset=allRest.length/3;
      for(let i=1;i<count;i++){
        const volume=Math.PI*sectionMapper.radius**2*a.fromArray(centers,(i-1)*3).distanceTo(b.fromArray(centers,i*3));
        masses[i-1]+=volume/2;masses[i]+=volume/2;totalVolume+=volume;allEdges.push(offset+i-1,offset+i);
      }
      const physical=new Float32Array(count*3*(markerCount+1)),physicalMass=new Float64Array(count*(markerCount+1)),physicalEdges=[...segments];physical.set(centers);
      for(let i=0;i<count;i++){
        physicalMass[i]=masses[i]*(framed?.5:1);
        if(framed){
          // Symmetric solid-circle mass quadrature: half at the center,
          // the other half shared by the source radial samples. The COM stays
          // on the original seam and polar inertia is m*r^2/2. An asymmetric
          // two-marker mass layout introduces a false gravity torque at pins.
          for(let marker=0;marker<markerCount;marker++){
            const id=(marker+1)*count+i,sample=1+(12/markerCount)*marker;
            physical.set(part.geometry.attributes.position.array.subarray((i*13+sample)*3,(i*13+sample)*3+3),id*3);physicalMass[id]=masses[i]/(2*markerCount);
            physicalEdges.push(i,id);if(i)physicalEdges.push(id-1,id);
            const next=((marker+1)%markerCount+1)*count+i;physicalEdges.push(id,next);
            if(i)physicalEdges.push(id-1,next);
          }
        }
      }
      let collisionVolume,collisionIndices,renderPhysicalMap;
      if(resolved){
        collisionVolume=createPipingCollisionVolume(part.geometry);
        const map=id=>id<count*12?(id%12+1)*count+Math.floor(id/12):id===count*12?0:count-1;
        collisionIndices=Uint32Array.from(collisionVolume.indices,map);
        renderPhysicalMap=Uint32Array.from(collisionVolume.renderVertexMap,map);
        const seen=new Set();for(let i=0;i<physicalEdges.length;i+=2)seen.add([Math.min(physicalEdges[i],physicalEdges[i+1]),Math.max(physicalEdges[i],physicalEdges[i+1])].join(','));
        for(let i=0;i<collisionIndices.length;i+=3)for(let j=0;j<3;j++){
          const a=collisionIndices[i+j],b=collisionIndices[i+(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
          if(!seen.has(key)){physicalEdges.push(a,b);seen.add(key);}
        }
      }
      for(let i=segments.length;i<physicalEdges.length;i++)allEdges.push(offset+physicalEdges[i]);
      wire.push({name:part.name,centers,border,segments,sectionMapper,masses:physicalMass,physical,physicalEdges,framed,resolved,markerCount,collisionVolume,collisionIndices,renderPhysicalMap,offset});
      allRest.push(...physical);
    }
    assert.equal(allRest.length/3,restCloth.length/3+360+(resolvedFronts?456:framedFronts?152:0));assert(allRest.length/3<=2048);
    const density=(coarse.positions.length/3*.001)/totalVolume;
    for(let i=0;i<clothMass.length;i++)clothMass[i]*=density;
    for(const piece of wire)for(let i=0;i<piece.masses.length;i++)piece.masses[i]*=density;
    assert(clothMass.every(m=>m>0)&&wire.every(w=>w.masses.every(m=>m>0)));
    const tree=new MeshBVH(bodyProxy,{indirect:true}),segment=new T.Line3(),box=new T.Box3();
    const restGaps=[];
    for(const piece of wire){
      let minimumGap=Infinity,worst=-1;
      for(let i=1;i<piece.centers.length/3;i++){
        segment.start.fromArray(piece.centers,(i-1)*3);segment.end.fromArray(piece.centers,i*3);
        box.setFromPoints([segment.start,segment.end]).expandByScalar(piece.sectionMapper.radius+.03);
        let distance=Infinity;
        tree.shapecast({intersectsBounds:b=>box.intersectsBox(b),intersectsTriangle:t=>{
          distance=Math.min(distance,t.closestPointToSegment(segment,a,b));return false;
        }});
        const gap=distance-piece.sectionMapper.radius;if(gap<minimumGap){minimumGap=gap;worst=i-1;}
      }
      assert(minimumGap>1e-5,'Actual local piping capsule overlaps the certified rest body proxy');
      restGaps.push({part:piece.name,minimumGap,worstSegment:worst});
    }
    const setMaterial=(description,positions,edges,bending=null)=>{
      const softness=[];
      for(let i=0;i<edges.length;i+=2){
        const length=a.fromArray(positions,edges[i]*3).distanceTo(b.fromArray(positions,edges[i+1]*3)),
          naturalFrequency=bending&&i/2>=bending.firstEdge?30*.08*bending.radius/(2*(length/2)**2):30*.08/length;
        assert(naturalFrequency>0&&naturalFrequency<=2400,'Existing axial material bound exceeded');
        softness.push({naturalFrequency,dampingRatio:1});
      }
      description.setEdgeSoftness(Uint32Array.from({length:softness.length},(_,i)=>i),softness);
    };
    // The former single-body prototype had self contact disabled. Preserve
    // that scope for these sewn components, while retaining all body/hand/cup
    // collisions. Every external obstacle keeps the default all-groups mask.
    const garmentGroups=(1<<16)|2,edges=[...clothEdges.values()].flatMap(e=>e.slice(0,2));
    // Near-coplanar refined hinges show a nonzero resting impulse with the
    // native angle constraint (isolated zero-force reproduction retained).
    // Preserve bending resistance with the opposite-vertex rest distances;
    // do not remove bending constraints or suppress free particle motion.
    const bendEdges=dihedrals.flatMap((_,i)=>i%4===0?[dihedrals[i+2],dihedrals[i+3]]:[]);
    const description=new R.SoftBodyDesc(restCloth).setEdges(edges).setBendEdges(bendEdges).setSurface(surface.indices)
      .setPinnedParticles(pins).setMasses(Float32Array.from(clothMass)).setSoftness(30,1)
      .setAdditionalPgsIterations(additionalPgsIterations).setParticleRadius(.003).setSelfContacts(false).setOriented(false)
      .setSurfaceCollider(R.ColliderDesc.ball(.003).setFriction(.3).setCollisionGroups(garmentGroups));
    setMaterial(description,restCloth,edges);
    const cloth=world.createSoftBody(description),clothProxies=new Map(),pinSet=new Set(pins);let jointCount=0,coincidentWirePins=0,fixedRingReferences=0;
    const clothProxy=particle=>{
      if(!clothProxies.has(particle)){
        const cluster=world.addSoftBodyCluster(cloth,[particle]);assert(cluster!==null);
        clothProxies.set(particle,cloth.clusterProxy(cluster));
      }
      return clothProxies.get(particle);
    };
    for(const piece of wire){
      const desc=new R.SoftBodyDesc(piece.physical).setEdges(piece.physicalEdges)
        .setMasses(Float32Array.from(piece.masses)).setSoftness(30,1).setAdditionalPgsIterations(additionalPgsIterations)
        // A cluster containing only a pinned Rapier particle loses its
        // world transform in the joint solver. Reuse the identical physical
        // support at this duplicate wire particle, without adding a support
        // location or constraining any previously free cloth point.
        .setPinnedParticles(piece.border.flatMap((particle,i)=>pinSet.has(particle)?[i]:[]))
        .setParticleRadius(piece.resolved?0:piece.sectionMapper.radius).setSelfContacts(false).setOriented(piece.resolved)
        .setSurfaceCollider(R.ColliderDesc.ball(piece.sectionMapper.radius).setFriction(.3).setCollisionGroups(garmentGroups));
      if(piece.resolved)desc.setSurface(piece.collisionIndices);else desc.setWire(piece.segments);
      const localBends=wireBending?Array.from({length:piece.centers.length/3-2},(_,i)=>[i,i+2]).flat():[];
      if(wireBending)desc.setBendEdges(localBends);
      // With the same axial wave scale c=f*L, a circular rod has
      // sqrt(I/A)=radius/2. Its local bending frequency scales as
      // c*radius/(2*L^2), rather than a mesh-independent 30 Hz.
      setMaterial(desc,piece.physical,[...piece.physicalEdges,...localBends],wireBending?{firstEdge:piece.physicalEdges.length/2,radius:piece.sectionMapper.certificate.maximumSourceRadius}:null);
      piece.body=world.createSoftBody(desc);
      assert.equal(piece.body.numMeshes(),1);assert(piece.body.meshCollisionEnabled(0));
      if(piece.framed)for(let i=0;i<piece.border.length;i++){
        const cluster=world.addSoftBodyCluster(piece.body,Array.from({length:piece.markerCount+1},(_,j)=>j*piece.border.length+i));assert(cluster!==null);
        piece.body.enableClusterShapeMatching(cluster,true);
      }
      for(let i=0;i<piece.border.length;i++){
        const pinned=pinSet.has(piece.border[i]);
        if(pinned){coincidentWirePins++;if(!piece.resolved)continue;}
        if(piece.resolved){
          // The displayed seam is the average of the twelve UNIQUE exterior
          // samples, not an internal center particle connected by soft spokes.
          // Equal masses make this ring cluster's COM that exact average.
          const cluster=world.addSoftBodyCluster(piece.body,Array.from({length:12},(_,j)=>(j+1)*piece.border.length+i));assert(cluster!==null);
          const proxy=piece.body.clusterProxy(cluster),point=new T.Vector3().fromArray(piece.centers,i*3),
            local=point.clone().sub(new T.Vector3().copy(proxy.translation())).applyQuaternion(new T.Quaternion().copy(proxy.rotation()).invert());
          const support=pinned?world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(point.x,point.y,point.z)):clothProxy(piece.border[i]);
          // SoftBodyDesc.setAdditionalPgsIterations does not configure these
          // rigid joint proxies (both report zero by default). Give the
          // coupled joint the same declared extra solver budget explicitly.
          proxy.setAdditionalSolverIterations(additionalPgsIterations);
          support.setAdditionalSolverIterations(additionalPgsIterations);
          if(pinned)fixedRingReferences++;
          // A spherical connection fixes only the original support point;
          // it leaves the whole finite section free to rotate and deform.
          const joint=world.createImpulseJoint(R.JointData.spherical({x:0,y:0,z:0},{x:local.x,y:local.y,z:local.z}),support,proxy,true);assert(joint);jointCount++;continue;
        }
        const cluster=world.addSoftBodyCluster(piece.body,[i]);assert(cluster!==null);
        const proxy=piece.body.clusterProxy(cluster);
        const joint=world.createImpulseJoint(R.JointData.spherical({x:0,y:0,z:0},{x:0,y:0,z:0}),clothProxy(piece.border[i]),proxy,true);
        assert(joint);jointCount++;
      }
    }
    const output=clothPart.geometry.attributes.position.clone();
    if(transfiniteBinding)transfinite=createTransfiniteClothMapper(coarse,transfiniteBinding,clothPart.geometry.attributes.position);
    else{
      mapper=createThinSurfaceMapper({indices:surface.indices,vertexCount:restCloth.length/3,restPositions:restCloth});
      mapper.bind(binding.records,output);
    }
    const renderPositions=[],renderIndices=[],ranges=[];
    for(const part of parts.filter(p=>p.name!=='cape_clasp')){
      const start=renderPositions.length/3;renderPositions.push(...part.geometry.attributes.position.array);
      for(const id of part.geometry.index.array)renderIndices.push(start+id);
      ranges.push({name:part.name,start,count:part.geometry.attributes.position.count});
    }
    return {cloth,
      readParticles(){assert(!closed,'Conforming cloth disposed');const values=new Float32Array(allRest.length);values.set(cloth.particlePositions());for(const p of wire)values.set(p.body.particlePositions(),p.offset*3);return values;},
      readRendered(){
        assert(!closed,'Conforming cloth disposed');
        const wireOutput=new Map(wire.map(p=>{
          const values=p.body.particlePositions();
          if(p.resolved){const output=new Float32Array(p.renderPhysicalMap.length*3);for(let i=0;i<p.renderPhysicalMap.length;i++)output.set(values.subarray(p.renderPhysicalMap[i]*3,p.renderPhysicalMap[i]*3+3),i*3);return [p.name,output];}
          const centers=values.subarray(0,p.centers.length),frames=p.framed?new Float32Array(p.border.length*6):null;
          if(frames)for(let i=0;i<p.border.length;i++)for(let j=0;j<2;j++)frames.set(values.subarray(((j+1)*p.border.length+i)*3,((j+1)*p.border.length+i)*3+3),i*6+j*3);
          return [p.name,p.sectionMapper.map(centers,[0,0,0,1],frames)];
        }));
        let clothOutput;
        if(transfinite)clothOutput=transfinite.map(cloth.particlePositions().slice(0,coarse.positions.length),wireOutput);
        else{mapper.prepare(cloth.particlePositions());mapper.apply();clothOutput=output.array;}
        const values=new Float32Array(renderPositions.length);
        for(const range of ranges){
          const source=wireOutput.get(range.name)??clothOutput;
          assert.equal(source.length,range.count*3);values.set(source,range.start*3);
        }
        return values;
      },
      dispose(){if(closed)return;closed=true;mapper?.dispose();transfinite?.dispose();for(const p of wire)p.sectionMapper.dispose();},
      skin:{positions:Float32Array.from(allRest),edges:Uint32Array.from(allEdges),pins:Uint32Array.from(pins),
        cells:new Uint32Array(0),skinPositions:Float32Array.from(renderPositions),skinIndices:Uint32Array.from(renderIndices),ranges,
        thinCloth:true,baseLayerOffset:coarse.positions.length,clothIndices:surface.indices,
        certificate:{...surface.certificate,particleCount:allRest.length/3,cellCount:0,renderCount:renderPositions.length/3,
          fixedParticles:pins.length,jointCount,coincidentWirePins,originalTotalMass:coarse.positions.length/3*.001,
          fixedRingReferences,totalWireParticles:wire.reduce((sum,w)=>sum+w.physical.length/3,0),
          additionalJointSolverIterations:resolvedFronts?additionalPgsIterations:0,
          physicalFrontSections:framedFronts?{sections:38,additionalParticles:152,sourceSamples:[1,4,7,10],massQuadrature:[.5,.125,.125,.125,.125],role:'local orientation, longitudinal and diagonal surface constraints; no whole-garment shape matching'}:null,
          directFrontSurfaces:resolvedFronts?{sections:38,additionalParticles:456,massQuadrature:'center 1/2, twelve source samples 1/24 each',mapping:'every original exterior render vertex follows its own physical particle; collision-only caps close the tubes',parts:wire.filter(w=>w.resolved).map(w=>({name:w.name,...w.collisionVolume.certificate}))}:null,
          clothMass:clothMass.reduce((s,v)=>s+v,0),wireMass:wire.reduce((s,w)=>s+w.masses.reduce((n,v)=>n+v,0),0),
          additionalPgsIterations,mapping:transfiniteBinding?'four-boundary displacement correction from actual collision-enclosed wire sections':'exact cloth-border particles with bilateral wire joints; body-frame free-cloth detail',
          bending:{representation:'opposite-vertex rest-distance hinges',constraints:bendEdges.length/2,naturalFrequency:30,dampingRatio:1},
          wireBending:wireBending?{representation:'next-neighbour rest-distance hinges',frequency:'c*sourceRadius/(2*L^2), c=30*.08, L=half next-neighbour chord',dampingRatio:1,scope:'geometry-scaled rod comparison; no calibrated material or acceptance claim'}:null,
          collisionSurface:resolvedFronts?'refined cloth, back/hem capsule wires, and exact exterior-preserving closed front tubes':'refined cloth triangles plus local capsule wires enclosing every rendered piping triangle',
          restGaps,binding:binding.certificate,wire:wire.map(w=>w.resolved?
            {part:w.name,sections:w.border.length,collisionSurface:'actual closed exterior triangles',mapping:'direct native particles',sectionShape:'deformable local sections',restCapsuleEnclosure:w.sectionMapper.certificate,dynamicCapsuleEnclosure:false}:
            {part:w.name,...w.sectionMapper.certificate}),
          selfContact:'unestablished; sewn components preserve the prior no-self-contact scope',
          collisionGroups:garmentGroups,allExternalObstacleGroups:'default-all'}}};
  }catch(error){mapper?.dispose();transfinite?.dispose();for(const p of wire)p.sectionMapper.dispose();throw error;}
}
