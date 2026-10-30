import test from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeStrainMeasure} from './edge-strain.mjs';

test('rest-edge caching retains compression, extension and reversed shared-edge witnesses',()=>{
  const rest=new Float64Array([0,0,0,1,0,0,0,1,0,1,1,0]),indices=[0,1,2,2,1,3],
    measure=createEdgeStrainMeasure(rest,indices),values=rest.slice();
  values[3]=.75;values[10]=1.3;
  const result=measure(values);
  assert.equal(result.min,.75);assert.equal(result.minWitness.a,0);assert.equal(result.minWitness.b,1);
  assert.equal(result.max,Math.hypot(.25,1.3));assert.equal(result.maxWitness.a,1);assert.equal(result.maxWitness.b,3);
  rest.fill(NaN);indices.fill(-1);
  assert.deepEqual(measure(values),result,'Cached rest data must not borrow mutable input');
  values[0]=NaN;assert.throws(()=>measure(values),/Finite matching/);
});
test('coincident seam indices preserve the previous exclusion but invalid topology rejects',()=>{
  const rest=[0,0,0,0,0,0,1,0,0],measure=createEdgeStrainMeasure(rest,[0,1,1,2],2);
  assert.equal(measure([0,0,0,0,0,0,1.3,0,0]).max,1.3);
  assert.throws(()=>createEdgeStrainMeasure(rest,[0,3],2),/Invalid strain index/);
  assert.throws(()=>createEdgeStrainMeasure(rest,[0,1],2),/Nondegenerate/);
});
