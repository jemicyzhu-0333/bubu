import assert from 'node:assert/strict';

/** Collision-only closure of the unchanged authored tube. Weld only its exact
 * duplicated seam vertices; retain every exterior triangle and add the two
 * planar end disks. The render buffer/topology is never rewritten. */
export function createPipingCollisionVolume(geometry) {
  const source=geometry?.attributes.position,index=geometry?.index;
  assert(source?.itemSize===3&&[19*13,161*13].includes(source.count)&&index,'Authored piping sections required');
  const rings=source.count/13,positions=[],renderVertexMap=new Uint32Array(source.count),indices=[];
  for(let ring=0;ring<rings;ring++){
    for(let axis=0;axis<3;axis++)assert.equal(source.array[(ring*13)*3+axis],source.array[(ring*13+1)*3+axis],'Only exact seam duplicates can be welded');
    for(let j=1;j<=12;j++)for(let axis=0;axis<3;axis++)positions.push(source.array[(ring*13+j)*3+axis]);
    for(let j=0;j<13;j++)renderVertexMap[ring*13+j]=ring*12+Math.max(0,j-1);
  }
  for(const id of index.array){assert(Number.isSafeInteger(id)&&id>=0&&id<source.count);indices.push(renderVertexMap[id]);}
  function edges(){
    const result=new Map();
    for(let i=0;i<indices.length;i+=3){
      const t=indices.slice(i,i+3);assert(new Set(t).size===3,'Welding cannot delete a source face');
      for(let j=0;j<3;j++){
        const a=t[j],b=t[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`,
          e=result.get(key)??{a,b,count:0,balance:0};
        e.count++;e.balance+=a<b?1:-1;result.set(key,e);
      }
    }
    return result;
  }
  const boundary=[...edges().values()].filter(e=>e.count===1);
  assert.equal(boundary.length,24,'Exactly two open end loops required');
  for(const e of edges().values())assert(e.count===1||(e.count===2&&e.balance===0),'Nonmanifold authored piping');
  for(const ring of [0,rings-1]){
    const end=boundary.filter(e=>Math.floor(e.a/12)===ring&&Math.floor(e.b/12)===ring);
    assert.equal(end.length,12,'Boundary must be an authored end ring');
    const center=positions.length/3;
    for(let axis=0;axis<3;axis++)positions.push(Array.from({length:12},(_,j)=>source.array[(ring*13+j+1)*3+axis]).reduce((a,b)=>a+b,0)/12);
    for(const {a,b}of end)indices.push(b,a,center);
  }
  for(const e of edges().values())assert(e.count===2&&e.balance===0,'Collision volume is not closed and consistently oriented');
  const p=Float32Array.from(positions);let signedVolume=0;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    signedVolume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;
  }
  assert(Number.isFinite(signedVolume)&&Math.abs(signedVolume)>1e-10,'Finite piping volume required');
  if(signedVolume<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  for(let i=0;i<source.count;i++)for(let axis=0;axis<3;axis++)assert.equal(p[renderVertexMap[i]*3+axis],source.array[i*3+axis]);
  return {positions:p,indices:Uint32Array.from(indices),renderVertexMap,
    certificate:{sourceVertices:source.count,collisionVertices:p.length/3,sourceTriangles:index.count/3,
      collisionTriangles:indices.length/3,addedEndCapTriangles:24,sourceExteriorTrianglesPreserved:true,
      exactRenderReconstruction:true,closedOrientedTopology:true,volume:Math.abs(signedVolume),radiusInflation:0}};
}
