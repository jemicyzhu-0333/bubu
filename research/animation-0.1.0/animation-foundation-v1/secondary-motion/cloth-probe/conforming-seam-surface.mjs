import assert from 'node:assert/strict';

/** Refine only boundary triangles of the private simulation surface. Every
 * original particle and support ID is retained; every authored render-border
 * vertex gets an actual simulation particle. Original art is never edited. */
export function createConformingSeamSurface(coarse,cloth,{centroidFans=true,seamNeighbours=true}={}) {
  const position=cloth?.attributes.position;
  assert(position?.count===161*19&&coarse.grid.cols===64,'Approved cloth grids required');
  const positions=Array.from(coarse.positions),parameters=[],lookup=new Map(),
    key=(u,v)=>`${u.toFixed(12)},${v.toFixed(12)}`;
  let cursor=0;
  for(let column=0;column<=64;column++)for(let row=0;row<=coarse.grid.rowsPerColumn[column];row++){
    const u=column/64,v=row/coarse.grid.rowsPerColumn[column];
    parameters.push([u,v]);lookup.set(key(u,v),cursor++);
  }
  assert.equal(cursor,positions.length/3);
  const originalCount=cursor,boundaryParticles=new Map(),added=[];
  for(let column=0;column<=160;column++)for(let row=0;row<19;row++){
    if(column!==0&&column!==160&&row!==0&&row!==18)continue;
    const vertex=column*19+row,u=column/160,v=row/18;
    let particle=lookup.get(key(u,v));
    if(particle===undefined){
      particle=positions.length/3;positions.push(...position.array.slice(vertex*3,vertex*3+3));
      parameters.push([u,v]);lookup.set(key(u,v),particle);added.push(particle);
    }else assert(Math.hypot(...[0,1,2].map(k=>positions[particle*3+k]-position.array[vertex*3+k]))<1e-7,'Shared rest boundary changed');
    boundaryParticles.set(vertex,particle);
  }
  const indices=[],triangleColumns=[];let splitTriangles=0;
  for(let face=0;face<coarse.indices.length/3;face++){
    const old=coarse.indices.slice(face*3,face*3+3),polygon=[];
    for(let j=0;j<3;j++){
      const a=old[j],b=old[(j+1)%3],[au,av]=parameters[a],[bu,bv]=parameters[b];polygon.push(a);
      const boundary=(au===bu&&(au===0||au===1))||(av===bv&&(av===0||av===1));
      if(!boundary)continue;
      const alongU=au!==bu,start=alongU?au:av,end=alongU?bu:bv;
      const between=added.filter(id=>{
        const [u,v]=parameters[id];return (alongU?v===av:u===au)&&(alongU?u:v)>Math.min(start,end)&&(alongU?u:v)<Math.max(start,end);
      }).sort((a,b)=>(parameters[a][alongU?0:1]-parameters[b][alongU?0:1])*Math.sign(end-start));
      polygon.push(...between);
    }
    if(polygon.length===3){indices.push(...old);triangleColumns.push(coarse.triangleColumns[face]);continue;}
    if(!centroidFans){
      // Keep collinear authored seam samples. A corner fan or triangulator
      // that discards collinear vertices would silently disconnect them.
      const cross=(a,b,c)=>(parameters[b][0]-parameters[a][0])*(parameters[c][1]-parameters[a][1])-(parameters[b][1]-parameters[a][1])*(parameters[c][0]-parameters[a][0]);
      const orientation=Math.sign(cross(...old)),remaining=[...polygon];
      while(remaining.length>3){
        let ear=-1;
        for(let j=0;j<remaining.length;j++){
          const a=remaining[(j+remaining.length-1)%remaining.length],b=remaining[j],c=remaining[(j+1)%remaining.length];
          if(cross(a,b,c)*orientation<=1e-14)continue;
          if(remaining.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)*orientation>=-1e-14&&cross(b,c,p)*orientation>=-1e-14&&cross(c,a,p)*orientation>=-1e-14))continue;
          indices.push(a,b,c);triangleColumns.push(coarse.triangleColumns[face]);ear=j;break;
        }
        assert(ear>=0,'Cannot triangulate boundary without dropping authored samples');remaining.splice(ear,1);
      }
      assert(cross(...remaining)*orientation>1e-14,'Degenerate final seam triangle');
      indices.push(...remaining);triangleColumns.push(coarse.triangleColumns[face]);continue;
    }
    // An interior fan preserves all boundary samples even when two edges of
    // a corner triangle are refined. No zero-area collinear fan triangles.
    const center=positions.length/3;
    for(let k=0;k<3;k++)positions.push(old.reduce((sum,id)=>sum+coarse.positions[id*3+k],0)/3);
    parameters.push([old.reduce((sum,id)=>sum+parameters[id][0],0)/3,old.reduce((sum,id)=>sum+parameters[id][1],0)/3]);
    for(let j=0;j<polygon.length;j++){indices.push(center,polygon[j],polygon[(j+1)%polygon.length]);triangleColumns.push(coarse.triangleColumns[face]);}
    splitTriangles++;
  }
  assert(positions.length/3+360<=2048&&indices.length/3<=4096,'Combined cloth/wire budget exceeded');
  assert.equal(boundaryParticles.size,356);
  // The first rendered edge inward from each seam is only a few millimetres
  // long. Give its endpoint a real degree of freedom as well: otherwise a
  // contacting border and a coarsely interpolated neighbour can compress that
  // actual render edge while all coarse constraints still pass.
  const renderedParticles=new Map(boundaryParticles);let addedSeamNeighbours=0;
  if(seamNeighbours)for(let column=1;column<160;column++)for(const row of [1,17]){
    const vertex=column*19+row,u=column/160,v=row/18;
    let particle=lookup.get(key(u,v));
    if(particle!==undefined){renderedParticles.set(vertex,particle);continue;}
    particle=positions.length/3;
    const replacements=[];
    for(let face=0;face<indices.length/3;face++){
      const ids=indices.slice(face*3,face*3+3),[a,b,c]=ids.map(i=>parameters[i]);
      const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      const wa=((b[1]-c[1])*(u-c[0])+(c[0]-b[0])*(v-c[1]))/denominator,
        wb=((c[1]-a[1])*(u-c[0])+(a[0]-c[0])*(v-c[1]))/denominator,wc=1-wa-wb;
      if(Math.min(wa,wb,wc)<-1e-10)continue;
      const zero=[wa,wb,wc].findIndex(w=>Math.abs(w)<1e-10);
      if(zero<0)replacements.push({face,triangles:[ids[0],ids[1],particle,ids[1],ids[2],particle,ids[2],ids[0],particle]});
      else{
        const x=ids[(zero+1)%3],y=ids[(zero+2)%3],opposite=ids[zero];
        replacements.push({face,triangles:[x,particle,opposite,particle,y,opposite]});
      }
    }
    assert(replacements.length===1||replacements.length===2,'Local seam-neighbour topology must be unambiguous');
    positions.push(...position.array.slice(vertex*3,vertex*3+3));parameters.push([u,v]);lookup.set(key(u,v),particle);renderedParticles.set(vertex,particle);addedSeamNeighbours++;
    for(const replacement of replacements.sort((a,b)=>b.face-a.face)){
      const provenance=triangleColumns[replacement.face];indices.splice(replacement.face*3,3,...replacement.triangles);
      triangleColumns.splice(replacement.face,1,...Array(replacement.triangles.length/3).fill(provenance));
    }
  }
  assert(positions.length/3+360<=2048&&indices.length/3<=4096,'Refined seam-neighbour budget exceeded');
  const present=new Set(indices);for(const particle of boundaryParticles.values())assert(present.has(particle),'Unconnected authored seam particle');
  return {...coarse,positions,indices,triangleColumns,boundaryParticles,renderedParticles,parameters,
    certificate:{originalParticles:originalCount,clothParticles:positions.length/3,addedBoundaryParticles:added.length,
      addedTriangleCenters:splitTriangles,addedSeamNeighbours,clothTriangles:indices.length/3,authoredBoundaryVertices:356,
      originalParticlesAndPinsPreserved:true,aggregateParticleBudget:2048,wireParticles:360}};
}
