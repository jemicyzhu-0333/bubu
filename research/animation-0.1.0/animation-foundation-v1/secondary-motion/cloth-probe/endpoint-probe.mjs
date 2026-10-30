/** Bounded local-arc experiment. No runtime registration or source-mesh writes. */
import R from '@dimforge/rapier3d-compat';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadGLB, disposeAsset, hybrid } from '../../integration/asset-fixtures.mjs';
import { createThinSurfaceMapper } from './thin-surface-mapper.mjs';
import { cleanupOwned } from '../../integration/cleanup-owned.mjs';
import { createConservativeHull } from './conservative-hull.mjs';
import { createTeaObstacles } from './tea-obstacles.mjs';
import { createTeaClearanceCandidate } from '../../contact/tea-clearance-candidate.mjs';
import { validateCollisionSkin } from './collision-skin.mjs';
import { createLocalBodyProxy } from './local-body-proxy.mjs';
import { createRegionalCollisionSkin } from './regional-collision-skin.mjs';
import { partitionBodyHull } from './body-hull-patches.mjs';
import { resolveCapeAttachment } from './attachment-profile.mjs';
import { createPipingSectionMapper, measureCapeSeams } from './piping-section-mapper.mjs';
import { createEdgeStrainMeasure } from './edge-strain.mjs';
import { createConformingWireCloth } from './conforming-wire-cloth.mjs';
import { clothActionHorizon } from './action-horizon.mjs';
import { createSharedSurfaceCloth, SHARED_SURFACE_UNITS_PER_MODEL_UNIT } from './shared-surface-cloth.mjs';
import { createClothStabilityMeasure } from './cloth-stability.mjs';
const root = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const diag = new URL('../../integration/diagnostics/contact-contract-20261019/', import.meta.url);
const option = name => process.argv[process.argv.indexOf(name) + 1];
const valuedOptions=new Set(['--output','--frames','--obstacle-filter','--collision-skin','--local-body-proxy','--constraint-pgs','--cloth-frequency','--body-patches','--attachment-profile','--cancel-at','--sample-hz']);
const flagOptions=new Set(['--trajectory','--render-envelope','--convex-hands','--trimesh-body','--profile','--bounded-body-hull','--exact-body-hull','--skin-fem','--regional-trim','--mesh-scaled-material','--thin-cloth','--compound-body','--rigid-piping-sections','--body-frame-detail','--joined-piping-sections','--closed-piping','--conforming-wire-piping']);
const seenOptions=new Set();
valuedOptions.add('--shared-surface-cage');
valuedOptions.add('--snapshot-frame');
flagOptions.add('--physics-diagnostics');
flagOptions.add('--particle-centroids');
flagOptions.add('--coupled-contact-stiffness');
flagOptions.add('--transfinite-wire-map');
flagOptions.add('--wire-bending');
flagOptions.add('--framed-front-piping');
flagOptions.add('--resolved-front-piping');
flagOptions.add('--coupled-regional-seams');
flagOptions.add('--collect-failures');
for(let i=2;i<process.argv.length;i++){
  const name=process.argv[i];assert((valuedOptions.has(name)||flagOptions.has(name))&&!seenOptions.has(name),`Unknown or repeated option ${name}`);seenOptions.add(name);
  if(valuedOptions.has(name)){const value=process.argv[++i];assert(value&&!value.startsWith('--'),`Missing value for ${name}`);}
}
if (!process.argv.includes('--output')) throw Error('Required --output NEW_EXTERNAL_DIRECTORY');
const attachment=resolveCapeAttachment(fs.readFileSync(new URL('./cape-coarse.json',import.meta.url)),process.argv.includes('--attachment-profile')?option('--attachment-profile'):undefined);
const requestedOutput = path.resolve(option('--output'));
const output = path.join(fs.realpathSync(path.dirname(requestedOutput)), path.basename(requestedOutput));
if (output === root || output.startsWith(root + path.sep)) throw Error('External output required');
fs.mkdirSync(output, { recursive: false });
const trajectory=process.argv.includes('--trajectory');
const collectFailures=process.argv.includes('--collect-failures');
if(collectFailures)assert(trajectory,'Failure collection requires the complete action trajectory');
const renderEnvelope=process.argv.includes('--render-envelope');
const skinPath=process.argv.includes('--collision-skin')?option('--collision-skin'):null;
const sharedSurfacePath=process.argv.includes('--shared-surface-cage')?option('--shared-surface-cage'):null;
const particleCentroids=process.argv.includes('--particle-centroids');
if(particleCentroids)assert(sharedSurfacePath,'Particle centroids require the shared-surface experiment');
const coupledContactStiffness=process.argv.includes('--coupled-contact-stiffness');
if(coupledContactStiffness)assert(sharedSurfacePath,'Coupled contact stiffness requires the isolated shared-surface world');
const conformingWire=process.argv.includes('--conforming-wire-piping');
const transfiniteWire=process.argv.includes('--transfinite-wire-map');
if(transfiniteWire)assert(conformingWire,'Transfinite correction requires the actual local wire collision candidate');
const wireBending=process.argv.includes('--wire-bending');
if(wireBending)assert(conformingWire,'Wire bending requires the actual local wire collision candidate');
const framedFronts=process.argv.includes('--framed-front-piping');
if(framedFronts)assert(conformingWire&&transfiniteWire&&!wireBending,'Physical front sections require the separate transfinite comparison');
const resolvedFronts=process.argv.includes('--resolved-front-piping');
if(resolvedFronts)assert(conformingWire&&transfiniteWire&&!wireBending&&!framedFronts,'Direct front surfaces require a separate comparison');
const rigidPipingSections=process.argv.includes('--rigid-piping-sections');
const joinClothSeams=process.argv.includes('--joined-piping-sections');
if(joinClothSeams)assert(rigidPipingSections,'Joined sections require the rigid piping comparison');
const bodyFrameDetail=process.argv.includes('--body-frame-detail');
const cancelAt=process.argv.includes('--cancel-at')?Number(option('--cancel-at')):null;
if(cancelAt!==null)assert(trajectory&&Number.isFinite(cancelAt)&&cancelAt>=0&&cancelAt<=9,'Cancellation time must be within the full action');
const sampleOptions=cancelAt===null?{}:{cancelAt};
// The full shared-cage normal/cancel paths remain finite at 1/120 s. Keep
// explicit 60 Hz for the saved failure; no contact/material admission follows.
const sampleHz=process.argv.includes('--sample-hz')?Number(option('--sample-hz')):sharedSurfacePath?120:60;
assert([60,120,240].includes(sampleHz)&&(trajectory||sampleHz===60),'Declared trajectory convergence rates only');
if(rigidPipingSections)assert(!skinPath,'Rigid render sections are a separate thin-mapping comparison');
if(skinPath)assert(trajectory&&!renderEnvelope,'Collision skin requires a trajectory and excludes the rejected uniform envelope');
const skinFem=process.argv.includes('--skin-fem');
if(skinFem)assert(skinPath,'FEM comparison requires the collision skin');
const regionalTrim=process.argv.includes('--regional-trim');
if(regionalTrim)assert(skinPath&&!skinFem,'Regional trim requires the original constraint-solver cage');
const closedPiping=process.argv.includes('--closed-piping');if(closedPiping)assert(regionalTrim,'Closed piping requires explicit regional collision cells');
const meshScaledMaterial=process.argv.includes('--mesh-scaled-material');
const thinCloth=process.argv.includes('--thin-cloth');if(thinCloth)assert(regionalTrim,'Thin regional comparison requires explicit piping');
const coupledRegional=process.argv.includes('--coupled-regional-seams');
if(coupledRegional)assert(regionalTrim&&thinCloth&&bodyFrameDetail&&closedPiping,'Coupled regional seams require full closed piping and body-frame thin cloth');
if(bodyFrameDetail)assert((!skinPath&&rigidPipingSections)||(regionalTrim&&thinCloth),'Body-frame detail requires thin cloth and explicit piping');
if(meshScaledMaterial)assert(regionalTrim,'Material comparison requires explicit regional topology');
const additionalPgsIterations=process.argv.includes('--constraint-pgs')?Number(option('--constraint-pgs')):3;
if(process.argv.includes('--constraint-pgs'))assert((regionalTrim||conformingWire||sharedSurfacePath)&&[3,12].includes(additionalPgsIterations),'Use the declared constraint convergence cases');
const referenceFrequency=process.argv.includes('--cloth-frequency')?Number(option('--cloth-frequency')):30;
if(process.argv.includes('--cloth-frequency'))assert(regionalTrim&&meshScaledMaterial&&[30,60].includes(referenceFrequency),'Use the declared material cases');
if(renderEnvelope)assert(trajectory,'Render envelope requires a rest-initialized trajectory');
const horizon=trajectory?clothActionHorizon({cancelAt,sampleHz}):null;
const frames = process.argv.includes('--frames') ? Number(option('--frames')) : trajectory?horizon.frames:60;
const physicsDiagnostics=process.argv.includes('--physics-diagnostics');
const snapshotFrame=process.argv.includes('--snapshot-frame')?Number(option('--snapshot-frame')):null;
if(physicsDiagnostics||snapshotFrame!==null)assert(sharedSurfacePath&&trajectory,'Native stability diagnostics require the shared-surface trajectory');
if(snapshotFrame!==null)assert(Number.isInteger(snapshotFrame)&&snapshotFrame>=0&&snapshotFrame<frames,'Snapshot frame must be within the requested trajectory');
const convexHands = process.argv.includes('--convex-hands');
const trimeshBody = process.argv.includes('--trimesh-body');
const profile = process.argv.includes('--profile');
const boundedBodyHull = process.argv.includes('--bounded-body-hull');
const exactBodyHull = process.argv.includes('--exact-body-hull');
if(exactBodyHull)assert(skinPath&&!boundedBodyHull,'Exact hull comparison is a separate detailed-skin experiment');
const localBodyPath=process.argv.includes('--local-body-proxy')?option('--local-body-proxy'):null;
if(localBodyPath)assert((skinPath||conformingWire||sharedSurfacePath)&&!boundedBodyHull&&!exactBodyHull,'Choose exactly one detailed-skin body proxy');
if(conformingWire)assert(trajectory&&localBodyPath&&!skinPath&&!renderEnvelope&&!rigidPipingSections&&!bodyFrameDetail,'Conforming wires own their private cloth and piping mapping');
if(sharedSurfacePath)assert(trajectory&&localBodyPath&&!skinPath&&!conformingWire&&!regionalTrim&&!renderEnvelope&&!rigidPipingSections&&!bodyFrameDetail,'Shared native surfaces require a separate full-trajectory comparison');
const bodyPatchCount=process.argv.includes('--body-patches')?Number(option('--body-patches')):0;
if(process.argv.includes('--body-patches'))assert(localBodyPath&&bodyPatchCount===64&&!trimeshBody,'Declared same-volume body partition only');
if(sharedSurfacePath)assert(bodyPatchCount===0,'Shared centimetre world requires the unpartitioned body proxy');
const compoundBody=process.argv.includes('--compound-body');if(compoundBody)assert(bodyPatchCount===64,'Compound comparison requires the same certified patches');
const obstacleFilter = process.argv.includes('--obstacle-filter') ? option('--obstacle-filter') : 'all';
assert(['all','body','hands','cup','none'].includes(obstacleFilter),'Unknown obstacle diagnostic filter');
assert(Number.isInteger(frames) && frames >= 1 && frames <= (trajectory?horizon.frames:180));
if(trajectory)assert(convexHands&&(boundedBodyHull||exactBodyHull||localBodyPath)&&obstacleFilter==='all','Trajectory requires all obstacles and declared proxies');
const sources = {};
function read(url) {
  const bytes = fs.readFileSync(url);
  sources[path.relative(root, fileURLToPath(url))] = createHash('sha256').update(bytes).digest('hex');
  return bytes;
}
const json = url => JSON.parse(read(url));
const report = {
  status: 'running', accepted: false, inputHashes: sources,
  scope: 'Local free upper-border arcs; static sip endpoint; all render pieces checked against actual meshes',
  time: 3.4, frames, sampleHz, horizon, attachment, releasedPins: attachment.releasedPins,
  handCollider: convexHands ? 'convex-hull-diagnostic' : 'actual-trimesh',
  bodyCollider: localBodyPath?'locally-fitted-certified-body-proxy':boundedBodyHull ? (trimeshBody ? 'conservative-bounded-trimesh' : 'conservative-bounded-hull') : trimeshBody ? 'actual-trimesh' : 'exact-source-convex-hull',
  obstacleFilter,
  exactBodyHull,
  localBodyProxy:!!localBodyPath,
  rigidPipingSections, bodyFrameDetail, joinClothSeams, closedPiping, conformingWire, transfiniteWire, wireBending, framedFronts, resolvedFronts, coupledRegional, sharedSurface:!!sharedSurfacePath, collectFailures, sampleOptions,
  declaredLimits: { maximumEdgeStretch: 1.2, minimumEdgeStretch: 0.8, pinError: 1e-5, seamCoincidenceError:1e-5, frameBudgetMs: 16.667 },
  rows: [], limitations: ['Not a continuous tea/cancellation trajectory.', 'Self-contact and containment not established.', 'Body obstacle is Bubu_body; feet and the complete foundation wardrobe are not included.', 'Not production cloth or visual approval.'],
};
const save = () => fs.writeFileSync(path.join(output, 'endpoint-cloth.json'), JSON.stringify(report, null, 2));
if(trajectory){report.scope=`Rest-initialized declared tea path, coherent clearance candidate, ${collectFailures?'retain all contact/pin/strain failures through the requested horizon':'stop at first contact/pin/strain failure'}`;report.time=0;report.limitations[0]=`${sampleHz} Hz samples of this declared path only; all cancellation times and continuous contact not established`;}
save();
let world, bodyAsset, mapper, moving, controller, regionalDisposer, pipingMapper;
const geometries = [];
function geometry(positions, indices) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  geometries.push(g);
  return g;
}
try {
  read(new URL(import.meta.url));
  read(new URL('./edge-strain.mjs',import.meta.url));
  read(new URL('./action-horizon.mjs',import.meta.url));
  read(new URL('./attachment-profile.mjs',import.meta.url));
  read(new URL('./attachment-profiles.json',import.meta.url));
  for(const name of ['./thin-surface-mapper.mjs','./piping-section-mapper.mjs','../../integration/asset-fixtures.mjs','../../integration/asset-resources.mjs','../../integration/cleanup-owned.mjs'])read(new URL(name,import.meta.url));
  read(new URL('./conservative-hull.mjs',import.meta.url));
  read(new URL('../../../package-lock.json', import.meta.url));
  read(pathToFileURL(hybrid));
  const coarse = json(new URL('./cape-coarse.json', import.meta.url));
  if(physicsDiagnostics)read(new URL('./cloth-stability.mjs',import.meta.url));
  const binding = json(new URL('./cape-binding.json', import.meta.url));
  const measuredOffset=Math.max(...binding.bindings.flatMap(b=>Array.from({length:b.records.length/7},(_,i)=>Math.hypot(...b.records.slice(i*7+4,i*7+7)))));
  assert(Math.abs(measuredOffset-binding.maxOffset)<1e-12,'Binding offset metadata mismatch');
  const collisionRadius=skinPath||sharedSurfacePath?0:renderEnvelope?measuredOffset+1e-5:.003;
  report.collisionRadius=collisionRadius;
  report.collisionRadiusBasis=skinPath||sharedSurfacePath?'Explicit candidate surface scope is recorded in collisionSkin; no additional particle dilation':renderEnvelope?'Maximum unchanged render-binding detail offset plus 1e-5 margin':'Original particle radius';
  const frozen = json(new URL('frozen-cape.json', diag));
  assert.equal(frozen.sha256, binding.sourceModelSHA256);
  const modelURL = new URL('../../../wearable-approved-round5/accessory-expansion/models/07-cape.glb', import.meta.url);
  assert.equal(createHash('sha256').update(read(modelURL)).digest('hex'), frozen.sha256);
  assert.equal(sources[path.relative(root, fileURLToPath(new URL('./cape-coarse.json', import.meta.url)))], binding.simulationSHA256);
  const tea = json(new URL('inputs/tea-keyframes.json', diag));
  const frame = tea.frames.find(f => f.time === report.time);
  const obstacles = [];
  bodyAsset = await loadGLB(hybrid);
  if(trajectory){
    for(const name of ['./tea-obstacles.mjs','../../contact/tea-clearance-candidate.mjs','../../integration/tea-sample-boundary.mjs','../../../original-parts-hybrid-v1/tea/src/rigid-tea.mjs','../../../original-parts-hybrid-v1/tea/src/timeline.mjs','../../../original-parts-hybrid-v1/tea/src/scene-resources.mjs','../../../original-parts-hybrid-v1/tea/src/cup-model.mjs'])read(new URL(name,import.meta.url));
    const inputs=Object.fromEntries([['config','rigid-config'],['hold','hold-fit'],['sip','sip-fit']].map(([key,name])=>[key,json(new URL(`../../../original-parts-hybrid-v1/tea/inputs/${name}.json`,import.meta.url))]));
    controller=createTeaClearanceCandidate(inputs);moving=createTeaObstacles(bodyAsset);moving.apply(controller.sample(0,sampleOptions));obstacles.push(...moving.entries);
  }else{
  const bodyGeometry = bodyAsset.getObjectByName('Bubu_body').geometry;
  obstacles.push({ name: 'body', geometry: bodyGeometry, bvh: new MeshBVH(bodyGeometry, { indirect: true }) });
  for (const mesh of frame.meshes) {
    if (mesh.opacity === 0 || mesh.name === 'Sip_tea_surface') continue;
    const bytes = read(new URL(mesh.positionsFile, diag));
    const positions = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const g = geometry(positions, tea.sharedMeshes[mesh.name].indices);
    obstacles.push({ name: mesh.name, geometry: g, bvh: new MeshBVH(g, { indirect: true }) });
  }
  }
  const parts = frozen.parts.map(p => {
    const g = geometry(p.positions, p.indices);
    return { name: p.name, geometry: g, bvh: new MeshBVH(g, { indirect: true }) };
  });
  report.restSeams=measureCapeSeams(parts);
  assert(report.restSeams.maximum<1e-7,'Source seam correspondence changed');
  mapper = createThinSurfaceMapper({ indices: coarse.indices, vertexCount: coarse.positions.length / 3,
    restPositions:bodyFrameDetail?new Float64Array(coarse.positions):null });
  if(bodyFrameDetail)report.limitations.push('Rest detail follows the identity body frame in this fixture; large local bending, seams and matching collision thickness remain unaccepted.');
  const pipingInputs=new Map(rigidPipingSections?parts.filter(p=>p.name!=='cape_cloth'&&p.name!=='cape_clasp').map(p=>[p.name,p.geometry.attributes.position.clone()]):[]);
  for (const b of binding.bindings) mapper.bind(b.records, pipingInputs.get(b.name)??parts.find(p => p.name === b.name).geometry.attributes.position);
  if(rigidPipingSections){
    read(new URL('./piping-section-mapper.mjs',import.meta.url));pipingMapper=createPipingSectionMapper(parts,pipingInputs,{joinClothSeams});
    report.pipingSections=pipingMapper.sectionCount;
    report.limitations.push('Rigid section mapping preserves local cross sections only; no matching piping collision envelope is implemented by this comparison.');
  }
  const edges = new Map(), dihedrals = [];
  for (let i = 0; i < coarse.indices.length; i += 3) {
    const triangle = coarse.indices.slice(i, i + 3);
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3], c = triangle[(j + 2) % 3];
      const key = [Math.min(a, b), Math.max(a, b)].join(',');
      const previous = edges.get(key);
      if (previous) dihedrals.push(previous.a, previous.b, previous.c, c);
      else edges.set(key, { a, b, c, rest: Math.hypot(...[0,1,2].map(k => coarse.positions[a*3+k] - coarse.positions[b*3+k])) });
    }
  }
  const pins = [...attachment.pins];
  assert.equal(pins.length, coarse.pins.length - report.releasedPins.length);
  const sourceCloth=parts.find(p=>p.name==='cape_cloth').geometry.attributes.position;
  report.renderPinWitnesses=[];
  for(const pin of pins){
    let nearest=-1,distance=Infinity;
    for(let i=0;i<sourceCloth.count;i++){const gap=Math.hypot(...[0,1,2].map(k=>sourceCloth.array[i*3+k]-coarse.positions[pin*3+k]));if(gap<distance){distance=gap;nearest=i;}}
    if(distance<=1e-6)report.renderPinWitnesses.push({pin,vertex:nearest,sourceGap:distance,position:Array.from(sourceCloth.array.slice(nearest*3,nearest*3+3))});
  }
  assert(report.renderPinWitnesses.length>0,'No actual render-pin witnesses');
  report.limitations.push('Render-pin witnesses cover matching source vertices only; other attachment locations and seams remain unverified.');
  let skin;
  if(skinPath){
    read(new URL('./collision-skin.mjs',import.meta.url));
    assert(fs.statSync(skinPath).size<=4*1024*1024,'Collision skin exceeds input budget');
    const candidate=json(pathToFileURL(path.resolve(skinPath)));
    const sourceParts=regionalTrim&&candidate.parts.length===1?parts.filter(p=>p.name==='cape_cloth'):parts;
    skin=validateCollisionSkin(candidate,sourceParts,coarse,pins);
    report.collisionSkin=skin.certificate;
  }
  report.initialEnvelopePinSurfaceConflicts=[];
  for(const pin of pins)for(const obstacle of obstacles){
    if(obstacle.visible===false)continue;
    const near=obstacle.bvh.closestPointToPoint(new T.Vector3().fromArray(coarse.positions,pin*3));
    if(near.distance<collisionRadius)report.initialEnvelopePinSurfaceConflicts.push({pin,obstacle:obstacle.name,distance:near.distance,radius:collisionRadius});
  }
  await R.init();
  const physicsUnits=sharedSurfacePath?SHARED_SURFACE_UNITS_PER_MODEL_UNIT:1;
  world = new R.World({ x: 0, y: -9.81*physicsUnits, z: 0 });
  world.integrationParameters.lengthUnit=physicsUnits;
  world.profilerEnabled = profile;
  world.timestep = 1/sampleHz;
  if(localBodyPath){
    // The former default penetration slop (0.001) is comparable with the
    // entire original trim gap. Tighten the solver, not the acceptance test.
    world.integrationParameters.normalizedAllowedLinearError=1e-6;
  }
  report.physicsContactSettings={allowedLinearError:world.integrationParameters.normalizedAllowedLinearError,predictionDistance:world.integrationParameters.normalizedPredictionDistance,lengthUnit:world.integrationParameters.lengthUnit,
    distanceBasis:'model units',nativeAllowedLinearError:world.integrationParameters.normalizedAllowedLinearError*physicsUnits,nativePredictionDistance:world.integrationParameters.normalizedPredictionDistance*physicsUnits};
  let bodyProxyGeometry;
  for (const obstacle of obstacles) {
    if(obstacleFilter!=='all'&&!(obstacleFilter==='body'&&obstacle.name==='body')&&!(obstacleFilter==='hands'&&obstacle.name.startsWith('Bubu_hand'))&&!(obstacleFilter==='cup'&&obstacle.name.startsWith('Sip_')))continue;
    let p = new Float32Array(obstacle.base??obstacle.geometry.attributes.position.array);
    let indices = new Uint32Array(obstacle.geometry.index.array);
    if(boundedBodyHull&&obstacle.name==='body'){
      const proxy=createConservativeHull(p);geometries.push(proxy.geometry);report.bodyHullCertificate=proxy.certificate;
      p=new Float32Array(proxy.geometry.attributes.position.array);
      indices=proxy.geometry.index?new Uint32Array(proxy.geometry.index.array):Uint32Array.from({length:p.length/3},(_,i)=>i);
    }
    if(localBodyPath&&obstacle.name==='body'){
      read(new URL('./local-body-proxy.mjs',import.meta.url));assert(fs.statSync(localBodyPath).size<=1024*1024);
      const proxy=createLocalBodyProxy(json(pathToFileURL(path.resolve(localBodyPath))),p,parts);
      geometries.push(proxy.geometry);report.bodyHullCertificate=proxy.certificate;
      bodyProxyGeometry=proxy.geometry;
      p=new Float32Array(proxy.geometry.attributes.position.array);indices=new Uint32Array(proxy.geometry.index.array);
      if(bodyPatchCount){
        read(new URL('./body-hull-patches.mjs',import.meta.url));const partition=partitionBodyHull(proxy.geometry,bodyPatchCount);report.bodyPatchCertificate=partition.certificate;
        const descriptions=partition.patches.map(patch=>{const description=R.ColliderDesc.convexHull(patch.positions);assert(description);return description;});
        if(compoundBody){world.createCollider(R.ColliderDesc.compound(descriptions.map(d=>d.shape),descriptions.map(()=>({x:0,y:0,z:0})),descriptions.map(()=>({x:0,y:0,z:0,w:1})),R.CompoundFlags.FIX_INTERNAL_EDGES));}
        else for(const description of descriptions)world.createCollider(description);
        report.bodyPatchCertificate.colliderMode=compoundBody?'one compound, internal faces corrected':'separate colliders';continue;
      }
    }
    if(physicsUnits!==1)p=p.map(v=>v*physicsUnits);
    const collider = (!trimeshBody && obstacle.name === 'body') || (convexHands && obstacle.name.startsWith('Bubu_hand')) || (trajectory&&obstacle.kind==='cup')
      ? R.ColliderDesc.convexHull(p)
      : R.ColliderDesc.trimesh(p, indices);
    assert(collider);
    if(trajectory&&obstacle.kind!=='body'){
      obstacle.rigid=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      obstacle.collider=world.createCollider(collider,obstacle.rigid);obstacle.shapeScale=1;
      obstacle.collider.setEnabled(obstacle.visible);obstacle.wasVisible=obstacle.visible;
    }else world.createCollider(collider);
  }
  const description=skin?new R.SoftBodyDesc(skin.positions)
    .setCells(skin.cells).setEdges(skin.edges).setSkin(skin.skinPositions,skin.skinIndices).setSkinCollision(true)
    .setPinnedParticles(skin.pins).setSoftness(30,1).setMasses(skin.masses)
    .setParticleRadius(collisionRadius).setSelfContacts(false).setOriented(false)
    .setSurfaceCollider(R.ColliderDesc.ball(.003).setFriction(.3))
    :new R.SoftBodyDesc(coarse.positions)
    .setEdges([...edges.values()].flatMap(e => [e.a, e.b])).setDihedrals(dihedrals)
    .setSurface(coarse.indices).setPinnedParticles(pins).setSoftness(30, 1)
    .setParticleMass(.001).setParticleRadius(collisionRadius).setSelfContacts(false).setOriented(false)
    .setSurfaceCollider(R.ColliderDesc.ball(.003).setFriction(.3));
  if(skinFem)description.setCellModel(R.SoftBodyCellModel.NeoHookean).setSolver(R.SoftBodySolver.Fem);
  let cloth,readRendered,readParticles,readReference,nativeClothMesh=0;
  if(sharedSurfacePath){
    for(const name of ['shared-surface-cloth','piping-collision-volume','centroid-constraints'])read(new URL(`./${name}.mjs`,import.meta.url));
    assert(fs.statSync(sharedSurfacePath).size<=4*1024*1024,'Shared cage input exceeds budget');
    const coupled=createSharedSurfaceCloth(R,world,json(pathToFileURL(path.resolve(sharedSurfacePath))),parts,coarse,pins,{additionalPgsIterations,particleCentroids,coupledContactStiffness});
    ({cloth,skin,readRendered,readParticles,readReference,nativeClothMesh}=coupled);regionalDisposer=coupled.dispose;report.collisionSkin=skin.certificate;
  }else if(conformingWire){
    for(const name of ['conforming-wire-cloth','conforming-seam-surface','conforming-cloth-binding','wire-section-mapper','transfinite-cloth-mapper','piping-collision-volume'])read(new URL(`./${name}.mjs`,import.meta.url));
    const coupled=createConformingWireCloth(R,world,parts,coarse,pins,{bodyProxy:bodyProxyGeometry,additionalPgsIterations,transfiniteBinding:transfiniteWire?binding:null,wireBending,framedFronts,resolvedFronts});
    ({cloth,skin,readRendered,readParticles}=coupled);regionalDisposer=coupled.dispose;report.collisionSkin=skin.certificate;
  }else if(regionalTrim){
    read(new URL('./regional-collision-skin.mjs',import.meta.url));read(new URL('./conforming-seam-surface.mjs',import.meta.url));read(new URL('./piping-collision-volume.mjs',import.meta.url));read(new URL('./transfinite-cloth-mapper.mjs',import.meta.url));
    const regional=createRegionalCollisionSkin(R,world,skin,parts,coarse,binding,pins,{meshScaledMaterial,additionalPgsIterations,referenceFrequency,thinCloth,bodyFrameDetail,closedPiping,coupledSeams:coupledRegional});cloth=regional.cloth;skin=regional.skin;readRendered=regional.readRendered;regionalDisposer=regional.dispose;
    report.collisionSkin=skin.certificate;
  }else{cloth=world.createSoftBody(description);readRendered=()=>cloth.meshVertices(0);}
  if(skin){
    if(!regionalTrim&&!conformingWire&&!sharedSurfacePath){assert.equal(cloth.numMeshes(),1);assert(cloth.isMeshSkinned(0)&&cloth.meshCollisionEnabled(0));}
    const initial=readRendered();assert.equal(initial.length,skin.skinPositions.length);
    report.collisionSkin.restError=Math.max(...initial.map((v,i)=>Math.abs(v-skin.skinPositions[i])));
    report.collisionSkin.solver=sharedSurfacePath?'shared-volume-edges-and-local-centroid-joints':conformingWire?'surface-edges-and-bilateral-wire-joints':skinFem?'FEM-NeoHookean':'structural-edges-and-volume-constraints';
    assert(report.collisionSkin.restError<=1e-5,'Collision skin does not reconstruct the source');
    if(!regionalTrim&&!conformingWire&&!sharedSurfacePath)assert.deepEqual(cloth.meshIndices(0),skin.skinIndices);
    report.limitations.push('Research pin map and mapping only; exact fixed-particle counts are reported in collisionSkin. No original 65-pin or production admission.');
  }
  const strainCache=new Map();
  const measureEdges=(values,rest,indices,stride)=>{
    if(!strainCache.has(indices))strainCache.set(indices,{rest,stride,measure:createEdgeStrainMeasure(rest,indices,stride)});
    const entry=strainCache.get(indices);assert(entry.rest===rest&&entry.stride===stride,'Immutable strain topology required');
    return entry.measure(values);
  };
  const identity = new T.Matrix4();
  const contactsAtPose=()=>{
    const contacts=[];
    for(const part of parts)for(const obstacle of obstacles){
      if(obstacle.visible===false)continue;
      if(part.bvh.bvhcast(obstacle.bvh,identity,{intersectsTriangles:(a,b)=>a.intersectsTriangle(b)}))contacts.push(`${part.name}/${obstacle.name}`);
    }
    return contacts;
  };
  if(trajectory){report.initialContacts=contactsAtPose();assert.equal(report.initialContacts.length,0,'Initial rendered pose is already intersecting');}
  const position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();
  const measureStability=physicsDiagnostics?createClothStabilityMeasure(skin.positions,skin.cells,skin.masses):null;
  if(physicsDiagnostics)report.stabilityScope='Native kinetic energy, gravitational change and cell orientation in model units; excludes elastic, contact and kinematic-actuator work, not total-energy conservation';
  let lastFiniteParticles=Float32Array.from(skin?.positions??coarse.positions);
  for (let i = 0; i < frames; i++) {
    const begin = performance.now();
    if(trajectory){
      const sample=controller.sample((i+1)/sampleHz,sampleOptions);moving.apply(sample);
      report.lastActionSample={time:(i+1)/sampleHz,phase:sample.phase,done:sample.done};
      for(const obstacle of obstacles){
        if(!obstacle.rigid)continue;
        obstacle.collider.setEnabled(obstacle.visible);if(!obstacle.visible){obstacle.wasVisible=false;continue;}
        obstacle.matrix.decompose(position,rotation,scale);
        position.multiplyScalar(physicsUnits);
        assert(Math.max(Math.abs(scale.x-scale.y),Math.abs(scale.x-scale.z))<1e-6,'Uniform obstacle scale required');
        if(Math.abs(scale.x-obstacle.shapeScale)>1e-12){
          const points=Float32Array.from(obstacle.base,value=>value*scale.x*physicsUnits),description=R.ColliderDesc.convexHull(points);assert(description);
          obstacle.collider.setShape(description.shape);obstacle.shapeScale=scale.x;
        }
        if(!obstacle.wasVisible){obstacle.rigid.setTranslation(position,true);obstacle.rigid.setRotation(rotation,true);}
        obstacle.rigid.setNextKinematicTranslation(position);obstacle.rigid.setNextKinematicRotation(rotation);obstacle.wasVisible=true;
      }
    }
    if(i===snapshotFrame){
      const bytes=world.takeSnapshot(),filename=`before-frame-${i}.bin`;
      fs.writeFileSync(path.join(output,filename),bytes,{flag:'wx'});
      report.nativeSnapshot={filename,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),frame:i,time:(i+1)/sampleHz,clothHandle:cloth.handle,physicsUnits,scope:'All native state after kinematic targets are authored, before the next world.step'};
      fs.writeFileSync(path.join(output,'native-snapshot.json'),JSON.stringify({...report.nativeSnapshot,inputHashes:sources},null,2),{flag:'wx'});
    }
    const physicsBegin=performance.now();
    world.step();
    const physicsMs = performance.now() - physicsBegin;
    const internalTimings = profile ? Object.fromEntries(['Step','CollisionDetection','BroadPhase','NarrowPhase','Solver','VelocityAssembly','VelocityResolution','VelocityUpdate','VelocityWriteback','Ccd','IslandConstruction','UserChanges'].map(name=>[name,world['timing'+name]()])) : null;
    const particles = readParticles?readParticles():cloth.particlePositions();
    const velocities=physicsDiagnostics?cloth.particleVelocities().map(v=>v/physicsUnits):null;
    if(!particles.every(Number.isFinite)||velocities&&!velocities.every(Number.isFinite)){
      const invalid=[];for(let j=0;j<particles.length;j++)if(!Number.isFinite(particles[j]))invalid.push({coordinate:j,value:String(particles[j])});
      const invalidVelocities=[];if(velocities)for(let j=0;j<velocities.length;j++)if(!Number.isFinite(velocities[j]))invalidVelocities.push({coordinate:j,value:String(velocities[j])});
      report.nonFiniteSimulation={frame:i,time:(i+1)/sampleHz,lastFiniteTime:i/sampleHz,invalidCoordinates:invalid.length,examples:invalid.slice(0,32),invalidVelocityCoordinates:invalidVelocities.length,velocityExamples:invalidVelocities.slice(0,32),physicsMs,internalTimings};
      report.stoppedAt={frame:i,time:(i+1)/sampleHz,reason:'non-finite-physical-state'};
      fs.writeFileSync(path.join(output,'failed-native-particles.f32'),Buffer.from(particles.buffer,particles.byteOffset,particles.byteLength));
      if(velocities)fs.writeFileSync(path.join(output,'failed-native-velocities.f32'),Buffer.from(velocities.buffer,velocities.byteOffset,velocities.byteLength));
      fs.writeFileSync(path.join(output,'last-finite-physics-particles.f32'),Buffer.from(lastFiniteParticles.buffer,lastFiniteParticles.byteOffset,lastFiniteParticles.byteLength));
      fs.writeFileSync(path.join(output,'last-finite-render-parts.json'),JSON.stringify(parts.map(part=>({name:part.name,positions:Array.from(part.geometry.attributes.position.array),indices:Array.from(part.geometry.index.array)}))));
      fs.writeFileSync(path.join(output,'failed-physics-topology.json'),JSON.stringify({positions:Array.from(skin?.positions??coarse.positions),edges:skin?Array.from(skin.edges):[...edges.values()].flatMap(e=>[e.a,e.b]),cells:skin?Array.from(skin.cells):[],pins:skin?Array.from(skin.pins):pins,clothIndices:skin?.clothIndices??coarse.indices}));
      throw Error('Non-finite physical state; raw failed and last-finite snapshots retained');
    }
    lastFiniteParticles=particles.slice();
    const stability=measureStability?.({positions:particles,velocities,gravity:{x:world.gravity.x/physicsUnits,y:world.gravity.y/physicsUnits,z:world.gravity.z/physicsUnits}});
    if(stability&&(stability.invertedCells||stability.collapsedCells)&&!report.firstInvalidCell)report.firstInvalidCell={frame:i,time:(i+1)/sampleHz,...stability};
    const vertices = readReference?readReference(particles):skin?(skin.thinCloth?particles.slice(0,coarse.positions.length):Float32Array.from(coarse.positions,(_,i)=>(particles[i]+particles[i+skin.baseLayerOffset])/2)):particles;
    assert(vertices.every(Number.isFinite));
    const pinError = skin?Math.max(...Array.from(skin.pins,p=>Math.hypot(...[0,1,2].map(k=>particles[p*3+k]-skin.positions[p*3+k]))))
      :Math.max(...pins.map(p => Math.hypot(...[0,1,2].map(k => vertices[p*3+k] - coarse.positions[p*3+k]))));
    let ratios = [...edges.values()].map(e => Math.hypot(...[0,1,2].map(k => vertices[e.a*3+k] - vertices[e.b*3+k])) / e.rest);
    const coarseStrain={min:Math.min(...ratios),max:Math.max(...ratios)};
    let cageStrain,renderStrain;
    const mapped = performance.now();
    if(skin){
      const rendered=readRendered();assert(rendered.every(Number.isFinite));
      cageStrain=measureEdges(particles,skin.positions,skin.edges,2);
      renderStrain=measureEdges(rendered,skin.skinPositions,skin.skinIndices,3);
      ratios=[cageStrain.min,cageStrain.max,renderStrain.min,renderStrain.max];
      for(const range of skin.ranges){const attribute=parts.find(p=>p.name===range.name).geometry.attributes.position;attribute.array.set(rendered.subarray(range.start*3,(range.start+range.count)*3));attribute.needsUpdate=true;}
    }else{
      mapper.prepare(vertices); mapper.apply();
      pipingMapper?.apply();
      // Coarse edges do not bound the detailed cloth/trim transported by the
      // mapper. Apply the same original strain limits to every render edge.
      const perPart=parts.filter(p=>p.name!=='cape_clasp').map(part=>({
        part:part.name,...measureEdges(part.geometry.attributes.position.array,
          frozen.parts.find(p=>p.name===part.name).positions,part.geometry.index.array,3),
      }));
      const minimum=perPart.reduce((a,b)=>a.min<b.min?a:b),maximum=perPart.reduce((a,b)=>a.max>b.max?a:b);
      renderStrain={min:minimum.min,max:maximum.max,
        minWitness:{part:minimum.part,...minimum.minWitness},maxWitness:{part:maximum.part,...maximum.maxWitness},parts:perPart};
      ratios.push(renderStrain.min,renderStrain.max);
    }
    for (const part of parts) {
      part.geometry.computeVertexNormals();
      part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere(); part.bvh.refit();
    }
    const renderedCloth=parts.find(p=>p.name==='cape_cloth').geometry.attributes.position.array;
    const renderPinError=Math.max(...report.renderPinWitnesses.map(w=>Math.hypot(...[0,1,2].map(k=>renderedCloth[w.vertex*3+k]-w.position[k]))));
    const seams=measureCapeSeams(parts);
    if(seams.maximum>report.declaredLimits.seamCoincidenceError&&!report.firstSeamFailure)
      report.firstSeamFailure={frame:i,time:(i+1)/sampleHz,...seams};
    if(skin){const rendered=readRendered();report.maximumRenderDisplacement=Math.max(report.maximumRenderDisplacement??0,...Array.from({length:rendered.length/3},(_,i)=>Math.hypot(...[0,1,2].map(k=>rendered[i*3+k]-skin.skinPositions[i*3+k]))));}
    const mapMs = performance.now() - mapped;
    const simulationPipelineMs=performance.now()-begin;
    const contacts = contactsAtPose();
    report.rows.push({ frame: i, physicsMs, internalTimings, mapMs, simulationPipelineMs,totalIncludingContactMs: performance.now()-begin,
      pinError,renderPinError,seams,coarseStrain,cageStrain,renderStrain,stability,maxStretch: Math.max(...ratios), minStretch: Math.min(...ratios), contacts });
    if (i % 10 === 0) { save(); console.log('frame', i, physicsMs.toFixed(2), contacts.length); }
    if(trajectory&&(contacts.length||pinError>1e-5||renderPinError>1e-5||Math.min(...ratios)<.8||Math.max(...ratios)>1.2)){
      report.failedSamples=(report.failedSamples??0)+1;
      if(collectFailures&&report.firstFailure)continue;
      const coarseGeometry=geometry(vertices,coarse.indices),coarseBVH=new MeshBVH(coarseGeometry,{indirect:true});
      const coarseContacts=obstacles.filter(o=>o.visible!==false&&coarseBVH.bvhcast(o.bvh,identity,{intersectsTriangles:(a,b)=>a.intersectsTriangle(b)})).map(o=>o.name);
      const failure={frame:i,time:(i+1)/sampleHz,reason:'first-contact-pin-or-strain-failure',coarseContacts};
      if(collectFailures)report.firstFailure=failure;else report.stoppedAt=failure;
      if(sharedSurfacePath||(skin?.thinCloth&&skin.clothIndices)){
        // The original 444-point reference is not a refined candidate's
        // native collision mesh. Retain and test the actual mesh separately.
        const nativePositions=cloth.meshVertices(nativeClothMesh).map(v=>v/physicsUnits),nativeIndices=cloth.meshIndices(nativeClothMesh),nativeGeometry=geometry(nativePositions,nativeIndices),nativeBVH=new MeshBVH(nativeGeometry,{indirect:true});
        failure.nativeClothContacts=obstacles.filter(o=>o.visible!==false&&nativeBVH.bvhcast(o.bvh,identity,{intersectsTriangles:(a,b)=>a.intersectsTriangle(b)})).map(o=>o.name);
        fs.writeFileSync(path.join(output,'failed-native-cloth.json'),JSON.stringify({positions:Array.from(nativePositions),indices:Array.from(nativeIndices)}));
      }
      fs.writeFileSync(path.join(output,'failed-particles.json'),JSON.stringify(Array.from(vertices)));
      fs.writeFileSync(path.join(output,'failed-render-parts.json'),JSON.stringify(parts.map(part=>({
        name:part.name,positions:Array.from(part.geometry.attributes.position.array),indices:Array.from(part.geometry.index.array),
      }))));
      if(skin){
        fs.writeFileSync(path.join(output,'failed-cage-particles.json'),JSON.stringify(Array.from(particles)));
        fs.writeFileSync(path.join(output,'failed-rendered.json'),JSON.stringify(Array.from(readRendered())));
      }
      report.contactWitnesses=[];
      for(const part of parts)for(const obstacle of obstacles){
        if(obstacle.visible===false)continue;
        part.bvh.bvhcast(obstacle.bvh,identity,{intersectsTriangles:(a,b,ia,ib)=>{
          if(!a.intersectsTriangle(b))return false;
          report.contactWitnesses.push({part:part.name,obstacle:obstacle.name,partTriangle:ia,obstacleTriangle:ib,a:[a.a,a.b,a.c].map(v=>v.toArray()),b:[b.a,b.b,b.c].map(v=>v.toArray())});return true;
        }});
      }
      if(!collectFailures)break;
    }
  }
  const stats = key => {
    const values = report.rows.map(r => r[key]).sort((a,b) => a-b);
    return { p50: values[Math.floor(values.length*.5)], p95: values[Math.floor(values.length*.95)], max: values.at(-1) };
  };
  fs.writeFileSync(path.join(output,'last-render-parts.json'),JSON.stringify(parts.map(part=>({
    name:part.name,positions:Array.from(part.geometry.attributes.position.array),indices:Array.from(part.geometry.index.array),
  }))));
  report.timing = Object.fromEntries(['physicsMs', 'mapMs', 'simulationPipelineMs','totalIncludingContactMs'].map(k => [k, stats(k)]));
  report.completedRequestedSteps=report.rows.length===frames;
  report.lastSampleClear=report.rows.at(-1).contacts.length===0;
  report.reachedActionEndpoint=!trajectory||(frames===horizon.frames&&report.completedRequestedSteps&&report.lastActionSample.done);
  report.finalEndpointClear=report.completedRequestedSteps&&report.reachedActionEndpoint&&report.lastSampleClear;
  report.strainAccepted = report.rows.every(r => r.maxStretch <= 1.2 && r.minStretch >= .8);
  if(physicsDiagnostics)report.cellOrientationAccepted=report.rows.every(r=>r.stability.invertedCells===0&&r.stability.collapsedCells===0);
  report.seamsAccepted = report.rows.every(r=>r.seams.maximum<=report.declaredLimits.seamCoincidenceError);
  // Higher-rate diagnostics have a smaller per-step budget. They cannot
  // certify a 60 Hz frame by comparing each individual substep to 16.667 ms.
  report.realtimeAccepted = report.completedRequestedSteps&&report.reachedActionEndpoint&&report.rows.every(r => r.simulationPipelineMs <= 1000/sampleHz);
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack; process.exitCode = 1;
} finally {
  try {
    cleanupOwned([
      () => mapper?.dispose(), () => pipingMapper?.dispose(), () => regionalDisposer?.(), () => world?.free(),
      () => moving?.dispose(),
      ...geometries.map(g => () => g.dispose()),
      () => { if (bodyAsset) disposeAsset(bodyAsset); },
    ], 'Endpoint probe cleanup');
    report.resourcesReleased = true;
  } catch (error) {
    report.status = 'failed';
    report.cleanupFailure = error.stack;
    report.resourcesReleased = false;
    process.exitCode = 1;
  }
  report.limitations.push(trajectory?'A failed trajectory is a solver/mapping counterexample, not a proof that all private-copy cloth implementations are infeasible.':'Starts with the existing intersecting sip pose; failure does not prove that every collision-free initialized path is infeasible.');
  if(obstacleFilter!=='all')report.limitations.push('Obstacle filtering isolates costs only; it is never a permitted runtime/contact quality reduction. All original render-contact checks remain enabled.');
  save();
  console.log(JSON.stringify({ status: report.status, output, timing: report.timing, finalEndpointClear: report.finalEndpointClear, strainAccepted: report.strainAccepted, failure: report.failure }));
}
