import * as T from 'three';

export function measureCapeSeams(parts) {
  const cloth=parts.find(p=>p.name==='cape_cloth')?.geometry?.attributes.position;
  if(cloth?.count!==161*19)throw Error('Authored cloth seam grid required');
  const center=new T.Vector3(),point=new T.Vector3();let maximum=0,witness=null;
  for(const name of ['cape_back_edge','cape_hem','cape_front_edge_0','cape_front_edge_1']){
    const values=parts.find(p=>p.name===name)?.geometry?.attributes.position;
    const count=name.startsWith('cape_front')?19:161;
    if(values?.count!==count*13)throw Error('Authored piping seam grid required');
    for(let section=0;section<count;section++){
      center.set(0,0,0);
      for(let j=1;j<=12;j++)center.add(point.fromBufferAttribute(values,section*13+j));center.multiplyScalar(1/12);
      const vertex=name==='cape_back_edge'?section*19:name==='cape_hem'?section*19+18:name==='cape_front_edge_0'?section:160*19+section;
      const gap=center.distanceTo(point.fromBufferAttribute(cloth,vertex));
      if(!Number.isFinite(gap))throw Error('Nonfinite rendered seam');
      if(gap>maximum){maximum=gap;witness={part:name,section,clothVertex:vertex,gap};}
    }
  }
  return {maximum,witness};
}

/** Private render mapping: retain each authored circular piping section's
 * shape while its center/orientation follow the thin mapper. This is not a
 * collision envelope or a whole-garment rigidification. */
export function createPipingSectionMapper(parts,mappedAttributes,{joinClothSeams=false}={}) {
  if(!(mappedAttributes instanceof Map))throw Error('Private mapped inputs required');
  const sections=[],outputs=[];let disposed=false;
  const cloth=parts.find(p=>p.name==='cape_cloth')?.geometry?.attributes.position;
  if(joinClothSeams&&cloth?.count!==161*19)throw Error('Authored cloth grid required for joined piping');
  const point=new T.Vector3(),center=new T.Vector3(),x=new T.Vector3(),y=new T.Vector3(),z=new T.Vector3();
  function frame(values,start){
    for(let i=start*3;i<(start+13)*3;i++)if(!Number.isFinite(values[i]))throw Error('Nonfinite piping section');
    center.set(0,0,0);x.set(0,0,0);y.set(0,0,0);
    // GLB seam duplication is at indices 0 and 1; 1..12 are the twelve
    // distinct angular samples. Counting 0..11 biases the section center.
    for(let j=0;j<12;j++)center.add(point.fromArray(values,(start+j+1)*3));center.multiplyScalar(1/12);
    for(let j=0;j<12;j++){
      point.fromArray(values,(start+j+1)*3).sub(center);
      x.addScaledVector(point,Math.cos(j*Math.PI/6));y.addScaledVector(point,Math.sin(j*Math.PI/6));
    }
    if(x.length()<1e-8||y.length()<1e-8)throw Error('Degenerate piping section');
    x.normalize();y.addScaledVector(x,-y.dot(x));
    if(y.length()<1e-8)throw Error('Collapsed piping section frame');
    y.normalize();z.crossVectors(x,y);
    return new T.Matrix4().makeBasis(x,y,z).setPosition(center);
  }
  for(const part of parts.filter(p=>p.name!=='cape_cloth'&&p.name!=='cape_clasp')){
    if(!/^cape_(back_edge|hem|front_edge_[01])$/.test(part.name))throw Error('Unknown piping part');
    const attribute=part.geometry?.attributes.position;
    if(!attribute||attribute.itemSize!==3||attribute.count%13||attribute.count<26)throw Error('Authored 13-vertex piping sections required');
    const rest=new Float64Array(attribute.array),output=new Float32Array(attribute.array);outputs.push({attribute,output});
    const input=mappedAttributes.get(part.name);
    if(!input||input===attribute||input.array===attribute.array||input.itemSize!==3||input.count!==attribute.count)throw Error('Independent piping input buffer required');
    for(let start=0;start<attribute.count;start+=13){
      if(new T.Vector3().fromArray(rest,start*3).distanceTo(new T.Vector3().fromArray(rest,(start+1)*3))>1e-7)throw Error('Open piping section');
      const inverse=frame(rest,start).invert(),local=new Float64Array(39);
      for(let j=0;j<13;j++){point.fromArray(rest,(start+j)*3).applyMatrix4(inverse);local.set(point.toArray(),j*3);}
      const section=start/13;
      const clothVertex=part.name==='cape_back_edge'?section*19:part.name==='cape_hem'?section*19+18:part.name==='cape_front_edge_0'?section:160*19+section;
      if(joinClothSeams&&center.distanceTo(point.fromBufferAttribute(cloth,clothVertex))>1e-7)throw Error('Source piping seam does not match the cloth border');
      sections.push({start,input,output,local,clothVertex});
    }
  }
  if(!sections.length)throw Error('Piping required');
  return {
    sectionCount:sections.length,
    apply(){
      if(disposed)throw Error('Piping mapper disposed');
      // Prepare all output first, so a collapsed final section cannot leave
      // earlier parts partially rewritten.
      for(const section of sections){
        const matrix=frame(section.input.array,section.start);
        if(joinClothSeams){
          point.fromBufferAttribute(cloth,section.clothVertex);
          if(!point.toArray().every(Number.isFinite))throw Error('Nonfinite cloth seam');
          matrix.setPosition(point);
        }
        for(let j=0;j<13;j++)section.output.set(point.fromArray(section.local,j*3).applyMatrix4(matrix).toArray(),(section.start+j)*3);
      }
      for(const {attribute,output}of outputs){attribute.array.set(output);attribute.needsUpdate=true;}
    },
    dispose(){if(disposed)return;disposed=true;sections.length=0;outputs.length=0;},
  };
}
