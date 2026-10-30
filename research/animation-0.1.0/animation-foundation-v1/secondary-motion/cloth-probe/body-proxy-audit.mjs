/** Compare the existing conservative body proxy with every unchanged cape part. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadGLB, hybrid, disposeAsset } from '../../integration/asset-fixtures.mjs';
import { createConservativeHull } from './conservative-hull.mjs';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
const output=process.argv[2];assert(output&&!fs.existsSync(output),'New output file required');
const frozen=JSON.parse(fs.readFileSync(new URL('../../integration/diagnostics/contact-contract-20261019/frozen-cape.json',import.meta.url)));
const asset=await loadGLB(hybrid),owned=[];
const report={status:'running',accepted:false,parts:[]};
try{
  const body=asset.getObjectByName('Bubu_body').geometry.clone();owned.push(body);
  let proxy;
  if(process.argv.includes('--proxy')){
    const data=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--proxy')+1]));
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(data.positions,3));geometry.setIndex(data.indices);
    proxy={geometry,certificate:data.certificate};
  }else proxy=process.argv.includes('--exact')?{geometry:new ConvexGeometry(Array.from({length:body.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(body.attributes.position,i))),certificate:{kind:'exact-source-convex-hull'}}:createConservativeHull(body.attributes.position.array);
  owned.push(proxy.geometry);
  body.boundsTree=new MeshBVH(body,{indirect:true});proxy.geometry.boundsTree=new MeshBVH(proxy.geometry,{indirect:true});
  const identity=new T.Matrix4();report.certificate=proxy.certificate;
  const exact=new ConvexGeometry(Array.from({length:body.attributes.position.count},(_,i)=>new T.Vector3().fromBufferAttribute(body.attributes.position,i)));owned.push(exact);
  const exactTree=new MeshBVH(exact,{indirect:true}),p=new T.Vector3();let maximumOuterDistance=0;
  report.refinementNormals=[];
  for(let i=0;i<proxy.geometry.attributes.position.count;i++){
    p.fromBufferAttribute(proxy.geometry.attributes.position,i);const near=exactTree.closestPointToPoint(p);maximumOuterDistance=Math.max(maximumOuterDistance,near.distance);
    if(near.distance>.009)report.refinementNormals.push(p.sub(near.point).normalize().toArray());
  }
  report.maximumOuterDistance=maximumOuterDistance;report.globalErrorAccepted=maximumOuterDistance<=.01;
  for(const part of frozen.parts){
    const g=new T.BufferGeometry();owned.push(g);g.setAttribute('position',new T.Float32BufferAttribute(part.positions,3));g.setIndex(part.indices);
    const tree=new MeshBVH(g,{indirect:true});let crossings=0;const witnesses=[];
    tree.bvhcast(proxy.geometry.boundsTree,identity,{intersectsTriangles:(a,b,i,j)=>{
      if(a.intersectsTriangle(b)){crossings++;if(witnesses.length<3)witnesses.push({partTriangle:i,proxyTriangle:j});}return false;
    }});
    const distance=other=>{const a={},b={};tree.closestPointToGeometry(other,identity,a,b);return a.distance;};
    report.parts.push({name:part.name,proxyCrossingTriangles:crossings,actualGap:distance(body),proxyGap:distance(proxy.geometry),witnesses});
    console.log(report.parts.at(-1));
  }
  report.status='completed';
}finally{for(const g of owned)g.dispose();disposeAsset(asset);fs.writeFileSync(output,JSON.stringify(report,null,2));}
