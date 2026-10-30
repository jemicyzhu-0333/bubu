import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {FoundationPool} from '../integration/foundation-host.mjs';
import {createCompleteOutfit} from '../configuration/fixtures/complete-outfit.mjs';
import {ANCHOR_DEFINITIONS} from '../anchors/bubu-d2-profile.mjs';
import {sha256} from '../integration/asset-fixtures.mjs';

const research=fileURLToPath(new URL('../../',import.meta.url)),requested=process.argv[2];
if(!requested||!path.isAbsolute(requested)||fs.existsSync(requested))throw Error('New absolute evidence directory required');
const out=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
if(out.startsWith(research))throw Error('External evidence required');fs.mkdirSync(out);
const report={status:'running',productionAccepted:false,scope:'Rest-pose obstruction of the existing translation-only mount fit; no rotation/deformation exclusion',obstacles:[],rows:[],sourceHashes:{},limitations:['An inside witness proves containment persists; it establishes a surface crossing only when a connected outside witness is also present.','No conclusion about rotations, re-authoring, deformed garments or intended attachment masks.']};
const pool=new FoundationPool(),owned=[];
function capture(mesh){
  const vertices=[],point=new T.Vector3();for(let i=0;i<mesh.geometry.attributes.position.count;i++)vertices.push(mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).toArray());
  return {name:mesh.name,vertices,indices:mesh.geometry.index?[...mesh.geometry.index.array]:vertices.map((_,i)=>i)};
}
function welded(meshes){
  const positions=[],triangles=[],lookup=new Map();
  for(const mesh of meshes){const remap=mesh.vertices.map(p=>{const key=p.join(',');if(!lookup.has(key)){lookup.set(key,positions.length);positions.push(p);}return lookup.get(key);});for(let i=0;i<mesh.indices.length;i+=3)triangles.push(mesh.indices.slice(i,i+3).map(j=>remap[j]));}
  const edges=new Map();let degenerate=0;
  for(const triangle of triangles){if(new Set(triangle).size!==3)degenerate++;for(let i=0;i<3;i++){const a=triangle[i],b=triangle[(i+1)%3],key=a<b?`${a},${b}`:`${b},${a}`,edge=edges.get(key)??{count:0,sign:0};edge.count++;edge.sign+=a<b?1:-1;edges.set(key,edge);}}
  return {positions,triangles,topology:{vertices:positions.length,triangles:triangles.length,degenerate,invalidEdges:[...edges.values()].filter(e=>e.count!==2||e.sign!==0).length}};
}
function winding(point,shape){
  const p=new T.Vector3(...point),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),cross=new T.Vector3();let sum=0;
  for(const tri of shape.triangles){a.fromArray(shape.positions[tri[0]]).sub(p);b.fromArray(shape.positions[tri[1]]).sub(p);c.fromArray(shape.positions[tri[2]]).sub(p);const x=a.length(),y=b.length(),z=c.length();sum+=2*Math.atan2(a.dot(cross.crossVectors(b,c)),x*y*z+a.dot(b)*z+b.dot(c)*x+c.dot(a)*y);}
  return sum/(4*Math.PI);
}
function connected(shape,from,to){
  const graph=shape.positions.map(()=>new Set());for(const t of shape.triangles)for(let i=0;i<3;i++){graph[t[i]].add(t[(i+1)%3]);graph[t[(i+1)%3]].add(t[i]);}
  const seen=new Set([from]),queue=[from];for(let i=0;i<queue.length;i++)for(const next of graph[queue[i]])if(!seen.has(next)){if(next===to)return true;seen.add(next);queue.push(next);}return from===to;
}
try{
  const actor=await pool.create(),configuration=createCompleteOutfit();await actor.equip(configuration);actor.step(0);report.configuration=configuration;
  const body=[];actor.f.h.body.root.traverseVisible(o=>{if(o.isMesh)body.push(capture(o));});
  for(const names of [['Bubu_body','Bubu_foot-left','Bubu_foot-right'],['Bubu_hand-right'],['Bubu_hand-left']]){
    const shape=welded(body.filter(m=>names.includes(m.name))),record={names,topology:shape.topology};report.obstacles.push(record);
    if(shape.topology.invalidEdges||shape.topology.degenerate||!shape.triangles.length){record.status='not-closed';continue;}
    record.status='closed';const geometry=new T.BufferGeometry();owned.push(geometry);geometry.setAttribute('position',new T.BufferAttribute(new Float64Array(shape.positions.flat()),3));geometry.setIndex(shape.triangles.flat());const bvh=new MeshBVH(geometry,{indirect:true}),point=new T.Vector3();
    for(const id of ['sakura','satchel']){
      const mount=configuration.mounts.find(m=>m.id===id),basis=new T.Matrix3().setFromMatrix4(actor.anchors.getTransform(mount.anchor,{poseRevision:actor.revision}));
      const bounds=ANCHOR_DEFINITIONS.find(a=>a.id===mount.anchor).offsetBounds;
      const maxTranslation=Math.max(...bounds[0].flatMap(x=>bounds[1].flatMap(y=>bounds[2].map(z=>new T.Vector3(x,y,z).sub(new T.Vector3(...mount.offset)).applyMatrix3(basis).length()))));
      const meshes=[];actor.mounts.get(id).root.traverseVisible(o=>{if(o.isMesh)meshes.push(capture(o));});
      for(const mesh of meshes){
        const own=welded([mesh]),candidates=[];
        const samples=own.positions.map((position,index)=>({index,position,location:'vertex'}));
        for(let triangle=0;triangle<own.triangles.length;triangle++){
          const ids=own.triangles[triangle],corners=ids.map(i=>own.positions[i]);
          for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]])samples.push({index:ids[0],position:[0,1,2].map(axis=>weights.reduce((sum,w,i)=>sum+w*corners[i][axis],0)),location:{triangle,weights}});
        }
        for(const value of samples){const distance=bvh.closestPointToPoint(point.fromArray(value.position)).distance;if(distance>maxTranslation+1e-8)candidates.push({...value,distance});}
        candidates.sort((a,b)=>b.distance-a.distance);let inside,outside;
        // A necessary witness only. Ray parity cheaply nominates candidates;
        // solid-angle winding independently verifies the reported points.
        const direction=new T.Vector3(.8123,.2317,.5351).normalize();
        for(const candidate of candidates){
          const hits=bvh.raycast(new T.Ray(point.fromArray(candidate.position).clone(),direction),T.DoubleSide).sort((a,b)=>a.distance-b.distance);
          const distinct=hits.filter((hit,i)=>i===0||Math.abs(hit.distance-hits[i-1].distance)>1e-9).length;
          if(distinct%2&&!inside){const w=winding(candidate.position,shape);if(Math.abs(Math.abs(w)-1)<1e-8)inside={...candidate,winding:w};}
          if(!(distinct%2)&&!outside){const w=winding(candidate.position,shape);if(Math.abs(w)<1e-8)outside={...candidate,winding:w};}
          if(inside&&outside)break;
        }
        if(inside)report.rows.push({obstacle:names,mount:id,part:mesh.name,maxTranslation,inside,outside:outside??null,connectedOutside:Boolean(outside&&connected(own,inside.index,outside.index)),necessaryExtraTranslation:inside.distance-maxTranslation});
      }
    }
  }
  for(const name of ['animation-foundation-v1/contact/fit-obstruction.mjs','animation-foundation-v1/configuration/fixtures/complete-outfit.mjs','animation-foundation-v1/integration/binding-provider.mjs','animation-foundation-v1/integration/foundation-runtime.mjs','animation-foundation-v1/integration/sakura-part-fit.mjs','animation-foundation-v1/integration/satchel-part-fit.mjs','animation-foundation-v1/integration/wearable-calibration-fit.mjs','accessories-v1/03-satchel/satchel.glb','runtime-facepath05/fixtures/face-d2/asset.glb','original-parts-hybrid-v1/geometry/bubu-hybrid-binding.glb'])report.sourceHashes[name]=sha256(path.join(research,name));
  report.status='completed';console.log(JSON.stringify({obstacles:report.obstacles,rows:report.rows},null,2));
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{for(const g of owned)g.dispose();pool.dispose();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
