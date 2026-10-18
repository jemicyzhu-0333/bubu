import {candidatePaths} from '../../shared/work-garden-paths.mjs';
const portable=candidatePaths('work-props');
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {factories} from './prop-models.mjs';
const P=new URL('..',import.meta.url);
const baseline=JSON.parse(fs.readFileSync(portable.baseline));
const original=baseline.frames[0].meshes.filter(m=>m.name.startsWith('Bubu_')||m.name.startsWith('A_'));
const rawHands=JSON.parse(fs.readFileSync(new URL('reports/source-hands.json',portable.root)));
const finalHands=JSON.parse(fs.readFileSync(new URL('final-hand-transforms.json',import.meta.url)));
const bodyHash=crypto.createHash('sha256').update(JSON.stringify(original.filter(m=>!m.name.startsWith('Bubu_hand')))).digest('hex');
const placements={keyboard:{p:[0,.223,.96],yaw:.16,hands:[[-.40,.527,.77],[.40,.531,.70]],support:'Reserved tabletop plane y=0.223. No new desk asset; physical support integration pending.'},laptop:{p:[0,.24,.91],yaw:.16,scale:.7,hands:[[-.30,.4725,.75],[.30,.4765,.70]],support:'Reserved low tabletop plane y=0.24, diagnostic proxy only.'},microphone:{p:[-.12,.22,.95],hands:[[-.25,.53,.795],null],support:'Single hand grip candidate; no floor support required.'},drum:{p:[0,.006,1.24],hands:[[-.25,.558,.80],[.25,.559,.76]],support:'Floor y=0.006. Direct palm top contacts, no drumsticks.'}};
for(const id of ['keyboard','laptop','drum']){placements[id].p[2]-=id==='drum'?.038:.08;for(const hand of placements[id].hands)if(hand){hand[2]-=id==='drum'?.074:.08;if(id==='drum')hand[1]-=.015;}}
fs.mkdirSync(new URL('review/',portable.root),{recursive:true});
const reports=[];
for(const [id,f] of Object.entries(factories)){
 const r=f(),cfg=placements[id];r.root.position.fromArray(cfg.p);r.root.scale.setScalar(cfg.scale??1);r.root.rotation.y=cfg.yaw??0;r.root.updateMatrixWorld(true);
 const meshes=structuredClone(original),transforms=[];
 for(const [j,name] of ['Bubu_hand-left','Bubu_hand-right'].entries()){
  const m=meshes.find(m=>m.name===name),target=cfg.hands?.[j];
  if(!target) continue;
  const raw=rawHands.find(h=>h.name===name),transform=structuredClone(finalHands[id].find(h=>h.mesh===name));
  const rotation=new T.Matrix3().set(...transform.matrix3.flat()),delta=new T.Vector3(...transform.translation);
  m.positions=[];for(let i=0;i<raw.positions.length;i+=3)m.positions.push(...new T.Vector3(...raw.positions.slice(i,i+3)).applyMatrix3(rotation).add(delta).toArray());
  m.indices=raw.indices;transforms.push(transform);
 }
 const propMeshes=[];r.root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,p=new T.Vector3(),pos=[];for(let i=0;i<g.attributes.position.count;i++){p.fromBufferAttribute(g.attributes.position,i).applyMatrix4(o.matrixWorld);pos.push(...p.toArray());}propMeshes.push({name:o.name,positions:pos,indices:g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),materialColor:o.material.color.toArray(),opacity:1});});
 if(id==='keyboard'||id==='laptop'){const g=new T.BoxGeometry(1.6,.04,id==='keyboard'?.66:.68),p=g.attributes.position,pos=[];for(let i=0;i<p.count;i++)pos.push(p.getX(i),p.getY(i)+cfg.p[1]-.02,p.getZ(i)+cfg.p[2]);propMeshes.push({name:'Diagnostic_support_proxy_NOT_BACKGROUND',positions:pos,indices:Array.from(g.index.array),materialColor:[.5,.5,.5],opacity:1});g.dispose();}
 const contacts=Object.fromEntries(Object.entries(r.sockets).map(([k,v])=>[k,v.clone().applyMatrix4(r.root.matrixWorld).toArray()]));
 const b=new T.Box3().setFromObject(r.root);
 const report={id,propPosition:cfg.p,propRotation:[0,cfg.yaw??0,0],handTransforms:transforms,socketsWorld:contacts,worldBounds:{min:b.min.toArray(),max:b.max.toArray()},support:cfg.support,bodyAndFaceUnchangedHash:bodyHash,status:'Static candidate only. Body continuity, garment clearance and action range not admitted; inspect actual render.',orientation:id==='laptop'?'Outer lid +Z toward viewer, screen -Z toward pet, opening angle 101.46 degrees':null};
 fs.writeFileSync(new URL('review/'+id+'-static.json',portable.root),JSON.stringify({sourceGLB:baseline.sourceGLB,frames:[{time:0,label:id+' original body + rigid original hands candidate',meshes:[...meshes,...propMeshes]}]}));reports.push(report);r.dispose();
}
fs.writeFileSync(new URL('reports/static-placements.json',portable.root),JSON.stringify(reports,null,2));
