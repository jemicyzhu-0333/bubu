/** Every distinct source edge is retained. Cache only immutable rest lengths;
 * deformed lengths and the original acceptance thresholds remain per-frame. */
export function createEdgeStrainMeasure(rest,indices,stride=3) {
  if(![2,3].includes(stride)||!Number.isSafeInteger(rest?.length)||rest.length<9||rest.length>150000||rest.length%3||
      !Number.isSafeInteger(indices?.length)||!indices.length||indices.length>500000||indices.length%stride)
    throw Error('Bounded strain topology required');
  if(!rest.every(Number.isFinite))throw Error('Finite rest positions required');
  const count=rest.length/3,seen=new Set(),edges=[];
  for(let i=0;i<indices.length;i+=stride)for(let j=0;j<(stride===2?1:3);j++){
    const a=indices[i+j],b=indices[i+(j+1)%stride];
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0||a>=count||b>=count)throw Error('Invalid strain index');
    const key=Math.min(a,b)*count+Math.max(a,b);
    if(seen.has(key))continue;seen.add(key);
    const length=Math.hypot(rest[a*3]-rest[b*3],rest[a*3+1]-rest[b*3+1],rest[a*3+2]-rest[b*3+2]);
    // Preserve the existing treatment of source seam duplicates.
    if(length>=1e-8)edges.push(a*3,b*3,length);
  }
  if(!edges.length)throw Error('Nondegenerate source edges required');
  const data=Float64Array.from(edges);
  return values=>{
    if(values?.length!==count*3||!values.every(Number.isFinite))throw Error('Finite matching deformation required');
    let min=Infinity,max=-Infinity,minimum=-1,maximum=-1;
    for(let i=0;i<data.length;i+=3){
      const a=data[i],b=data[i+1],ratio=Math.hypot(values[a]-values[b],values[a+1]-values[b+1],values[a+2]-values[b+2])/data[i+2];
      if(ratio<min){min=ratio;minimum=i;}if(ratio>max){max=ratio;maximum=i;}
    }
    const witness=(i,ratio)=>({a:data[i]/3,b:data[i+1]/3,restLength:data[i+2],ratio});
    return {min,max,minWitness:witness(minimum,min),maxWitness:witness(maximum,max)};
  };
}
