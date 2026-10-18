import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import  {
  GLTFLoader
}
from 'three/addons/loaders/GLTFLoader.js';
import  {
  AccessoryAdapter,disposeAsset
}
from './accessory-adapter.mjs';
import {paths} from '../../shared/paths.mjs';
const cfg=paths(),assetRoot=path.resolve(new URL('..',import.meta.url).pathname),P=path.join(cfg.cache,'accessory');
for(const d of ['review','reports'])fs.mkdirSync(path.join(P,d),{recursive:true});
const  {
  fixture
}
=await import(cfg.research+'/petting-continuous-r2/tools/fixture.mjs');
const  {
  createContractCheckedMixedBindingAdapter
}
=await import(cfg.pkg+'/runtime/mixed-binding-contract.mjs');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function load(p) {
  const b=fs.readFileSync(p);
  return(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}
const source=cfg.source,hybrid=cfg.hybrid,contract=JSON.parse(fs.readFileSync(cfg.pkg+'/geometry/binding-manifest.json')),parts=await load(hybrid),assets= {
}
;
for(const [k,file]of Object.entries( {
  halo:'05-halo',boots:'06-boots',cape:'07-cape'
}
))assets[k]=await load(assetRoot+'/models/'+file+'.glb');
const f=await fixture(),skin=f.h.body.skin,owner=createContractCheckedMixedBindingAdapter( {
  THREE:T,sourceSkin:skin,parts,assertSourceCurrent:()=>f.h.owner.assertCurrent(),contract,admittedSourceSHA256:hash(source),candidateSHA256:hash(hybrid)
}
),adapters=Object.fromEntries(Object.entries(assets).map(([kind,asset])=>[kind,new AccessoryAdapter( {
  kind,occludedFeet:kind==='boots'?owner.nativeMeshes.filter(m=>m.name.startsWith('Bubu_foot-')):[],sourceSkin:skin,parent:f.h.body.root,asset,assertSourceCurrent:()=>f.h.owner.assertCurrent()
}
)]));
const bodyHash=crypto.createHash('sha256').update(Buffer.from(skin.geometry.attributes.position.array.buffer)).digest('hex');
const report= {
  sourceSHA256:hash(source),hybridSHA256:hash(hybrid),scope:'Approved source actor plus native/rigid hybrid; accessory host replay, CPU only; no production wardrobe integration',scenarios: {
  }
  ,lifecycle: {
  }
  ,bodyHash
}
;
const p=new T.Vector3(),n=new T.Vector3(),v=new T.Vector4();
function exportMeshes(root) {
  const result=[];
  root.updateMatrixWorld(true);
  root.traverseVisible(m=> {
    if(!m.isMesh)return;
    const g=m.geometry,positions=[],normals=[],nm=new T.Matrix3().getNormalMatrix(m.matrixWorld);
    for(let i=0;
    i<g.attributes.position.count;
    i++) {
      m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite));
      positions.push(...p.toArray());
      n.fromBufferAttribute(g.attributes.normal,i);
      if(m.isSkinnedMesh) {
        v.set(n.x,n.y,n.z,0);
        m.applyBoneTransform(i,v);
        n.set(v.x,v.y,v.z);
      }
      n.applyMatrix3(nm).normalize();
      normals.push(...n.toArray());
    }
    const c=g.attributes.color;
    result.push( {
      name:m.name,positions,indices:Array.from(g.index?.array??Array.from( {
        length:g.attributes.position.count
      }
      ,(_,i)=>i)),colors:c?Array.from( {
        length:c.count
      }
      ,(_,i)=>[c.getX(i),c.getY(i),c.getZ(i),c.itemSize>3?c.getW(i):1]).flat():null,materialColor:m.material.color?.toArray(),opacity:m.material.opacity
    }
    );
  }
  );
  return result;
}
function bodyMeshes() {
  const feet=owner.nativeMeshes.filter(m=>m.name.startsWith('Bubu_foot-'));
  const visibility=feet.map(m=>m.visible);
  feet.forEach(m=>m.visible=true);
  const result=exportMeshes(owner.root);
  feet.forEach((m,i)=>m.visible=visibility[i]);
  return result;
}
const withoutFeet=meshes=>meshes.filter(m=>!m.name.startsWith('Bubu_foot-'));
const selected=[];
for(const kind of (cfg.staticOnly?[]:['drag','longpress'])) {
  const records=JSON.parse(fs.readFileSync(cfg.reference+'/pointer/'+kind+'/trajectory.json'));
  let count=0,maxShoeOffset=0,minShoeRelativeGround=Infinity,minShoeMinusFoot=Infinity;
  for(let i=0;
  i<records.length;
  i++) {
    const r=records[i];
    f.h.body.root.position.fromArray(r.body.root);
    f.h.body.pivot.quaternion.fromArray(r.body.pivot);
    for(const [name,q]of Object.entries(r.body.jointQuaternions))f.h.body.bones[name].quaternion.fromArray(q);
    f.h.body.root.updateMatrixWorld(true);
    owner.update();
    for(const a of Object.values(adapters))a.update();
    f.h.owner.assertCurrent();
    assert.equal(crypto.createHash('sha256').update(Buffer.from(skin.geometry.attributes.position.array.buffer)).digest('hex'),bodyHash);
    for(const shoe of adapters.boots.parts) {
      const foot=owner.root.getObjectByName('Bubu_foot-'+shoe.name.split('_')[1]);
      let shoeMin=Infinity,footMin=Infinity;
      for(let k=0;
      k<foot.geometry.attributes.position.count;
      k+=(Number(process.env.VERTEX_STRIDE)||1)) {
        shoe.getVertexPosition(k,p).applyMatrix4(shoe.matrixWorld);
        foot.getVertexPosition(k,n).applyMatrix4(foot.matrixWorld);
        maxShoeOffset=Math.max(maxShoeOffset,p.distanceTo(n));
        shoeMin=Math.min(shoeMin,p.y);
        footMin=Math.min(footMin,n.y);
      }
      for(let k=foot.geometry.attributes.position.count;k<shoe.geometry.attributes.position.count;k++){shoe.getVertexPosition(k,p).applyMatrix4(shoe.matrixWorld);shoeMin=Math.min(shoeMin,p.y);}
      minShoeRelativeGround=Math.min(minShoeRelativeGround,shoeMin-f.h.body.initialGround);
      minShoeMinusFoot=Math.min(minShoeMinusFoot,shoeMin-footMin);
    }
    if((kind==='drag'&&[0,90,105].includes(i))||(kind==='longpress'&&[390,990,1806].includes(i))) {
      const body=bodyMeshes();
      for(const k of Object.keys(adapters)) {
        selected.push( {
          time:r.time,label:kind+'-'+i+'-'+k,meshes:[...(k==='boots'?withoutFeet(body):body),...exportMeshes(adapters[k].root)]
        }
        );
      }
      selected.push( {
        time:r.time,label:kind+'-'+i+'-combined',meshes:[...withoutFeet(body),...Object.values(adapters).flatMap(a=>exportMeshes(a.root))]
      }
      );
    }
    count++;
  }
  report.scenarios[kind]= {
    frames:count,bodyUnchanged:true,maxShoeOffset,minShoeRelativeGround,minShoeMinusFoot,allFootVerticesChecked:!process.env.VERTEX_STRIDE
  }
  ;
  assert.ok(maxShoeOffset<.0201);
}
// Scene-neutral render of unchanged source face meshes and hybrid body, plus actual adapters.
f.h.body.root.position.set(0,0,0);
f.h.body.pivot.quaternion.identity();
const rest=JSON.parse(fs.readFileSync(cfg.reference+'/pointer/drag/trajectory.json'))[0];
for(const [name,q]of Object.entries(rest.body.jointQuaternions))f.h.body.bones[name].quaternion.fromArray(q);
f.h.body.root.updateMatrixWorld(true);
owner.update();
for(const a of Object.values(adapters))a.update();
const body=bodyMeshes(),face=[];
f.h.owner.root?.traverse?.(()=> {
}
);
// Export all visible source face objects through actor tree, omitting accessory copies and hybrid duplicates.
const actual=exportMeshes(f.h.body.root);
const faces=actual.filter(m=>m.name.startsWith('A_')&&m.name!=='A_mochi_skin');
for(const kind of Object.keys(adapters)) {
  fs.writeFileSync(P+'/review/'+kind+'-static.json',JSON.stringify( {
    sourceGLB:source,sourceToWorld:skin.matrixWorld.toArray(),frames:[ {
      time:0,label:kind+' static actual hybrid and source face',meshes:[...(kind==='boots'?withoutFeet(body):body),...faces,...exportMeshes(adapters[kind].root)]
    }
    ]
  }
  ));
}
fs.writeFileSync(P+'/review/combined-static.json',JSON.stringify( {
  sourceGLB:source,sourceToWorld:skin.matrixWorld.toArray(),frames:[ {
    time:0,label:'combined',meshes:[...withoutFeet(body),...faces,...Object.values(adapters).flatMap(a=>exportMeshes(a.root))]
  }
  ]
}
));
fs.writeFileSync(P+'/review/trajectory-keyframes.json',JSON.stringify( {
  sourceGLB:source,sourceToWorld:skin.matrixWorld.toArray(),frames:selected
}
));
for(const [kind,a]of Object.entries(adapters)) {
  let borrowedDisposals=0;
  assets[kind].traverse(o=>o.geometry?.addEventListener('dispose',()=>borrowedDisposals++));
  a.update( {
    enabled:false
  }
  );
  assert.equal(a.root.visible,false);
  a.update();
  a.dispose();
  a.dispose();
  assert.equal(a.root.parent,null);
  assert.equal(borrowedDisposals,0);
  assert.throws(()=>a.update());
  report.lifecycle[kind]= {
    detach:true,idempotent:true,borrowedNotDisposed:true,explicitRelease:disposeAsset(assets[kind])
  }
  ;
}
owner.dispose();
f.h.dispose();
assert.equal(f.h.pool.stats.actors,0);
report.resources=f.h.pool.stats;
fs.writeFileSync(P+'/reports/host-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
