import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
/** SHA binds the expensive BVH audit to exactly these inputs; current geometry is independently checked. */
export function verifyStaticEvidence(audit,inputBytes,referenceBytes){
 assert.equal(sha256(inputBytes),audit.inputSha256,'Stale mount audit: rerun Blender audit-mounts.py');
 assert.equal(sha256(referenceBytes),audit.referenceSha256,'Stale original-body reference');
 const input=JSON.parse(inputBytes),reference=JSON.parse(referenceBytes);
 const actor=reference.frames[0].meshes.filter(m=>m.name.startsWith('Bubu_')||m.name.startsWith('A_'));
 const current=input.frames[0].meshes;
 assert.equal(actor.length,13);
 for(const m of actor){const matches=current.filter(c=>c.name===m.name);assert.equal(matches.length,1);assert.deepEqual(matches[0].positions,m.positions,'Original actor geometry changed');assert.deepEqual(matches[0].indices,m.indices,'Original actor topology changed');}
 assert.equal(current.filter(m=>m.name.startsWith('Bubu_hand')).length,2);
 const names=new Set(actor.map(m=>m.name));let count=0;const bounds=[[Infinity,-Infinity],[Infinity,-Infinity],[Infinity,-Infinity]];
 for(const mesh of current){assert.ok(mesh.positions.length>0&&mesh.positions.length%3===0);assert.ok(mesh.positions.every(Number.isFinite),'Non-finite mesh');assert.ok(mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.positions.length/3));if(names.has(mesh.name))continue;count++;for(let j=0;j<mesh.positions.length;j++){const axis=j%3,v=mesh.positions[j];bounds[axis][0]=Math.min(bounds[axis][0],v);bounds[axis][1]=Math.max(bounds[axis][1],v);assert.ok(v>=[-2.63,-.04,-2.63][axis]&&v<=[2.63,3.1,2.63][axis],'Current prop outside static envelope');}}
 assert.ok(count>0);
 for(let axis=0;axis<3;axis++)for(let k=0;k<2;k++)assert.ok(Math.abs(bounds[axis][k]-audit.bounds[axis][k])<1e-6,'Current bounds differ from audited bounds');
 assert.equal(audit.staticAuditPass,true);assert.equal(audit.unchanged13ActorMeshes,true);assert.equal(audit.bodyTriangleCrossings,0);assert.equal(audit.faceTriangleCrossings,0);assert.equal(audit.fixedBodyScaleSafeEnvelope,true);
 if(audit.handMinimumSurfaceDistance!==null){assert.ok(audit.handMinimumSurfaceDistance<.012);assert.ok(audit.handMaxInsidePenetration<.025);}else{assert.ok(Math.abs(bounds[1][0]-.006)<1e-5);assert.equal(audit.originalFeetUnmoved,true);}
 return true;
}
