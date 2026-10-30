import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [variant,output,research='/workspace/bubu/research/animation-0.1.0']=process.argv.slice(2);
assert(['baseline','candidate','integrated'].includes(variant)&&path.isAbsolute(output)&&!fs.existsSync(output));
const sourceRoot=fs.realpathSync(research),resolved=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
assert(resolved!==sourceRoot&&!resolved.startsWith(sourceRoot+path.sep),'External evidence directory required');fs.mkdirSync(resolved);
const load=name=>import(pathToFileURL(path.join(sourceRoot,name)));
const [T,{MeshBVH},{FoundationPool},{createCompleteOutfit},{createSurfaceProbe},{fitSakuraParts}]=await Promise.all([
 load('node_modules/three/build/three.module.js'),load('node_modules/three-mesh-bvh/src/index.js'),
 load('animation-foundation-v1/integration/foundation-host.mjs'),load('animation-foundation-v1/configuration/fixtures/complete-outfit.mjs'),
 load('animation-foundation-v1/contact/surface-probe.mjs'),load('animation-foundation-v1/integration/sakura-part-fit.mjs')]);
const pool=new FoundationPool(),owned=[],names=['sakura_petal_1','sakura_petal_2','sakura_leaf_-019'];let probe;
const report={status:'running',productionAccepted:false,variant,hz:60,samples:0,phases:{},pairs:{},targets:Object.fromEntries(names.map(n=>[n,{crossingFrames:0,maximumTrianglePairs:0,deepestVertex:{depth:0},minimumTriangleGap:Infinity}])),rows:[],corrections:[],limitations:['Full 60 Hz action samples; continuous-time separation requires separate relative-pose evidence.','Penetration depth is the deepest tested original vertex, not a maximum over every point of a triangle.','This is actual rendered geometry, not a proxy; no hardware performance claim.']};
report.inputHashes=Object.fromEntries(['animation-foundation-v1/integration/binding-provider.mjs','animation-foundation-v1/integration/sakura-part-fit.mjs','animation-foundation-v1/configuration/fixtures/complete-outfit.mjs','runtime-facepath05/fixtures/face-d2/asset.glb','original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb','external-assets-v1/headwear-expansion/models/09-sakura-flower.glb'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,name))).digest('hex')]));
report.baselineControl='For baseline only, restore the three actor-owned part frames to identity after normal equip; source geometry and all original mount offsets/motion remain unchanged. This reproduces the pre-fit private frames, not a production contact identity.';
const digest=mesh=>createHash('sha256').update(Buffer.from(mesh.geometry.attributes.position.array.buffer)).digest('hex');
try{
 const actor=await pool.create();await actor.equip(createCompleteOutfit());actor.step(0);
 const flower=actor.mounts.get('sakura').root;let body;actor.f.h.body.root.traverse(m=>{if(m.name==='Bubu_body')body=m;});assert(body);
 const target=names.map(name=>flower.getObjectByName(name));report.sourceGeometry=Object.fromEntries(target.map(m=>[m.name,digest(m)]));
 if(variant!=='integrated')for(const mesh of target){mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);mesh.updateMatrix();}
 if(variant==='candidate'){
  fitSakuraParts(target[0].parent);
  for(const mesh of target){const pivot=new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,mesh.name.startsWith('sakura_leaf')?185:0);report.corrections.push({name:mesh.name,matrix:mesh.matrix.toArray(),pinError:pivot.clone().applyMatrix4(mesh.matrix).distanceTo(pivot),determinant:mesh.matrix.determinant()});}
 }
 const groups=new Map([['body',actor.f.h.body.root],...[...actor.mounts].map(([id,m])=>[id,m.root])]);if(actor.tail?.root)groups.set('tail',actor.tail.root);probe=createSurfaceProbe(groups);
 function geometry(mesh){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float64Array(mesh.geometry.attributes.position.count*3),3));g.setIndex(mesh.geometry.index.clone());owned.push(g);return g;}
 const bg=geometry(body),tg=target.map(geometry),point=actor.f.point(0,1.4),p=new T.Vector3(),direction=new T.Vector3(.8123,.2317,.5351).normalize(),identity=new T.Matrix4();
 function update(mesh,g){for(let i=0;i<g.attributes.position.count;i++)mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld).toArray(g.attributes.position.array,i*3);if(g.boundsTree)g.boundsTree.refit();else g.boundsTree=new MeshBVH(g,{indirect:true});}
 report.maximumSecondaryDisplacement={};
 for(let frame=0;frame<=480;frame++){
  const time=frame/60;if(frame===60||frame===180)actor.f.emit('pointerdown',time,point);if(frame===150||frame===270)actor.f.emit('pointerup',time,point);if(frame>180&&frame<270)actor.f.emit('pointermove',time,{clientX:point.clientX+(frame-180)*.6,clientY:point.clientY-(frame-180)*.45});actor.step(time);
  const phase=actor.f.h.state.mode;report.phases[phase]=(report.phases[phase]??0)+1;report.samples++;const contacts=probe.sample();for(const c of contacts){const key=c.pair.join(' <> ');report.pairs[key]=(report.pairs[key]??0)+1;}
  update(body,bg);const row={frame,time,phase,targets:[]};
  for(let j=0;j<target.length;j++){
   const mesh=target[j],g=tg[j],result=report.targets[mesh.name];update(mesh,g);let trianglePairs=0;bg.boundsTree.bvhcast(g.boundsTree,identity,{intersectsTriangles:(a,b)=>{if(a.intersectsTriangle(b))trianglePairs++;return false;}});
   if(trianglePairs){result.crossingFrames++;if(trianglePairs>result.maximumTrianglePairs){result.maximumTrianglePairs=trianglePairs;result.worstCrossingFrame={frame,time,phase};}}
   const closest=bg.boundsTree.closestPointToGeometry(g,identity,{},null,1e-12);result.minimumTriangleGap=Math.min(result.minimumTriangleGap,closest.distance);
   let deepest={depth:0};for(let i=0;i<g.attributes.position.count;i++){
    p.fromBufferAttribute(g.attributes.position,i);const near=bg.boundsTree.closestPointToPoint(p),hits=bg.boundsTree.raycast(new T.Ray(p.clone(),direction),T.DoubleSide).sort((a,b)=>a.distance-b.distance),count=hits.filter((h,k)=>!k||Math.abs(h.distance-hits[k-1].distance)>1e-8).length;
    if(count%2&&near.distance>deepest.depth)deepest={vertex:i,depth:near.distance,position:p.toArray(),nearest:near.point.toArray()};
   }
   if(deepest.depth>result.deepestVertex.depth)result.deepestVertex={...deepest,frame,time,phase};row.targets.push({name:mesh.name,trianglePairs,gap:closest.distance,deepest});
  }
  for(const[id,m]of actor.mounts)if(m.secondary){let maximum=report.maximumSecondaryDisplacement[id]??0;for(const part of m.secondary.parts){const a=part.mesh.geometry.attributes.position.array;for(let i=0;i<a.length;i+=3)maximum=Math.max(maximum,Math.hypot(...[0,1,2].map(k=>a[i+k]-part.rest[i+k])));}report.maximumSecondaryDisplacement[id]=maximum;}
  report.rows.push(row);if(frame%60===0){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(frame,phase,contacts.length,row.targets.map(t=>t.trianglePairs));}
 }
 assert.deepEqual(Object.keys(report.phases).sort(),['drag','idle','landing','pending','petting']);
 for(const m of target)assert.equal(digest(m),report.sourceGeometry[m.name]);report.sourceGeometryUnchanged=true;report.status='completed';
}catch(error){report.status='failed';report.failure=error.stack;throw error;}finally{probe?.dispose();for(const g of owned)g.dispose();pool.dispose();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
