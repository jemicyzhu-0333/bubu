/** Research-only cage admission. The detailed mesh is the collision surface;
 * the enclosing cells are never used as an inflated obstacle envelope. */
import assert from 'node:assert/strict';
import { Matrix3, Vector3 } from 'three';

export function validateCollisionSkin(data, parts, coarse, pins) {
  assert(['bubu-private-shell-proposal/1','bubu-private-shell-proposal/2'].includes(data.schema));
  const finite = values => Array.isArray(values) && values.every(v => Number.isFinite(v) && Math.abs(v) < 10);
  assert(finite(data.positions) && data.positions.length % 3 === 0);
  const count = data.positions.length / 3;
  assert(count >= 4 && count <= 2048);
  assert(Array.isArray(data.cells) && data.cells.length > 0 && data.cells.length % 4 === 0 && data.cells.length <= 4096 * 4);
  assert(data.cells.every(i => Number.isSafeInteger(i) && i >= 0 && i < count));
  assert(Number.isSafeInteger(data.baseCount)&&data.baseCount>=coarse.positions.length/3&&data.baseCount<=1024);
  if(data.schema.endsWith('/1'))assert.equal(data.baseCount, coarse.positions.length / 3);
  assert.equal(count, data.baseCount * 2);
  assert.deepEqual(data.sourcePositions, coarse.positions);
  assert.deepEqual(data.sourceTriangles, coarse.indices);
  const expectedPins=[...pins],boundaryEdges=new Map();
  for(let i=0;i<coarse.indices.length;i+=3)for(let j=0;j<3;j++){
    const a=coarse.indices[i+j],b=coarse.indices[i+(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;boundaryEdges.set(key,(boundaryEdges.get(key)??0)+1);
  }
  if(data.schema.endsWith('/2')){
    assert(Array.isArray(data.extraBoundaryPins)&&data.extraBoundaryPins.length<=512);
    for(const entry of data.extraBoundaryPins){
      assert(Number.isSafeInteger(entry.index)&&entry.index>=coarse.positions.length/3&&entry.index<data.baseCount&&!expectedPins.includes(entry.index));
      assert(Array.isArray(entry.parents)&&entry.parents.length===2&&entry.parents.every(i=>pins.includes(i)));
      const [a,b]=entry.parents;assert.equal(boundaryEdges.get(`${Math.min(a,b)},${Math.max(a,b)}`),1);
      expectedPins.push(entry.index);
    }
  }
  assert.deepEqual(data.centerPins, expectedPins);
  assert.deepEqual(data.pins, [...expectedPins, ...expectedPins.map(i => i + data.baseCount)]);
  const positions = [], indices = [], ranges = [];
  for (const part of parts.filter(p => p.name !== 'cape_clasp')) {
    const start = positions.length / 3, attribute = part.geometry.attributes.position;
    assert(attribute.count > 0 && positions.length / 3 + attribute.count <= 50000);
    positions.push(...attribute.array);
    for (const index of part.geometry.index.array) indices.push(index + start);
    ranges.push({ name: part.name, start, count: attribute.count });
  }
  assert(indices.length <= 100000 * 3);
  assert.deepEqual(data.skinPositions, positions, 'Collision skin must equal every original render vertex');
  assert.deepEqual(data.skinIndices, indices, 'Collision skin topology must equal all render triangles');
  assert.deepEqual(data.parts, ranges);
  const p = new Float32Array(data.positions), cells = [], edgeSet = new Set(), masses=new Float64Array(count);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3();
  let minimumCellVolume = Infinity;
  for (let i = 0; i < data.cells.length; i += 4) {
    for(let x=0;x<4;x++)for(let y=x+1;y<4;y++){
      const u=data.cells[i+x],v=data.cells[i+y];edgeSet.add(`${Math.min(u,v)},${Math.max(u,v)}`);
    }
    a.fromArray(p, data.cells[i] * 3);
    b.fromArray(p, data.cells[i + 1] * 3).sub(a);
    c.fromArray(p, data.cells[i + 2] * 3).sub(a);
    d.fromArray(p, data.cells[i + 3] * 3).sub(a);
    const matrix = new Matrix3().set(b.x,c.x,d.x,b.y,c.y,d.y,b.z,c.z,d.z);
    const volume = matrix.determinant() / 6;
    assert(volume > 1e-10, 'Degenerate or inverted rest cell');
    minimumCellVolume = Math.min(minimumCellVolume, volume);
    for(let j=0;j<4;j++)masses[data.cells[i+j]]+=volume/4;
    cells.push({ origin: a.clone(), inverse: matrix.invert() });
  }
  // Recompute coverage, rather than trusting the author's cell-selection report.
  let minimumBarycentric = Infinity;
  const q = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    let best = -Infinity;
    for (const cell of cells) {
      q.fromArray(positions, i).sub(cell.origin).applyMatrix3(cell.inverse);
      const score = Math.min(q.x,q.y,q.z,1-q.x-q.y-q.z);
      best = Math.max(best, score);
      if (best >= -1e-6) break;
    }
    assert(best >= -1e-6, `Uncovered render vertex ${i / 3}`);
    minimumBarycentric = Math.min(minimumBarycentric, best);
  }
  assert(masses.every(m=>m>0),'Every simulation vertex must belong to a positive-volume cell');
  const volume=masses.reduce((sum,m)=>sum+m,0),totalMass=coarse.positions.length/3*.001;
  for(let i=0;i<masses.length;i++)masses[i]*=totalMass/volume;
  return { positions: p, cells: new Uint32Array(data.cells), masses:Float32Array.from(masses),edges: Uint32Array.from([...edgeSet].flatMap(key=>key.split(',').map(Number))), skinPositions: new Float32Array(positions),
    skinIndices: new Uint32Array(indices), pins: new Uint32Array(data.pins), ranges,baseLayerOffset:data.baseCount*3,
    certificate: { particleCount: count, cellCount: cells.length, renderCount: positions.length / 3,
      minimumCellVolume, minimumBarycentric, sourceRenderUnchanged: true, collisionSurface: 'actual-detailed-skin',
      massModel:'lumped-rest-cell-volume, invariant total garment mass',totalMass,minimumParticleMass:Math.min(...masses),maximumParticleMass:Math.max(...masses) } };
}
