import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const run=promisify(execFile),script=fileURLToPath(new URL('./endpoint-probe.mjs',import.meta.url));

test('short trajectory diagnostics cannot certify the final action endpoint or realtime budget',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-cloth-endpoint-'));
  try{
    const output=path.join(temporary,'evidence');
    await run(process.execPath,[script,'--trajectory','--convex-hands','--bounded-body-hull','--frames','1','--output',output],{timeout:30000});
    const report=JSON.parse(fs.readFileSync(path.join(output,'endpoint-cloth.json')));
    assert.equal(report.status,'completed');assert.equal(report.rows.length,1);
    assert.equal(report.completedRequestedSteps,true);assert.equal(report.reachedActionEndpoint,false);
    assert.equal(report.finalEndpointClear,false);assert.equal(report.realtimeAccepted,false);
    assert.equal(report.accepted,false);assert.equal(report.resourcesReleased,true);
    assert(report.renderPinWitnesses.length>0&&Number.isFinite(report.rows[0].renderPinError));
    assert.equal(report.attachment.profile,'tea-swept-51-v1');assert.equal(report.attachment.pins.length,51);
    assert.equal(report.rows[0].renderStrain.parts.length,5,'Thin mapping must check the actual cloth and every piping part');
    assert(report.rows[0].maxStretch>=report.rows[0].renderStrain.max);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('unknown and duplicate diagnostic options reject before creating evidence',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-cloth-cli-'));
  try{
    for(const args of [['--regional-trmi'],['--profile','--profile']]){
      const output=path.join(temporary,'must-not-exist');
      await assert.rejects(run(process.execPath,[script,'--output',output,...args],{timeout:30000}),/Unknown or repeated option/);
      assert.equal(fs.existsSync(output),false);
    }
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('actual hem compression fails despite clear coarse strain, while rigid sections remove that specific failure',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-cloth-render-strain-'));
  try{
    const reports=[];
    for(const variant of ['original-map','rigid-sections']){
      const output=path.join(temporary,variant);
      await run(process.execPath,[script,'--trajectory','--convex-hands','--bounded-body-hull','--frames','4','--output',output,...(variant==='rigid-sections'?['--rigid-piping-sections']:[])],{timeout:30000});
      reports.push(JSON.parse(fs.readFileSync(path.join(output,'endpoint-cloth.json'))));
    }
    const [before,after]=reports,row=before.rows.at(-1);
    assert.equal(before.stoppedAt.time,4/60);assert.equal(row.contacts.length,0);
    assert(row.coarseStrain.min>=.8&&row.coarseStrain.max<=1.2);
    assert(row.renderStrain.min<.8);assert.equal(row.renderStrain.minWitness.part,'cape_hem');
    assert.equal(after.stoppedAt,undefined);assert.equal(after.rows.length,4);
    assert(after.rows.every(r=>r.minStretch>=.8&&r.maxStretch<=1.2));
    assert.equal(after.accepted,false);assert.equal(after.finalEndpointClear,false);
    assert(reports.every(r=>r.resourcesReleased));
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('joined rest-detail mapping clears the saved 0.5167 s strain but retains the following real contact failure',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-cloth-joined-'));
  try{
    const output=path.join(temporary,'evidence');
    await run(process.execPath,[script,'--trajectory','--convex-hands','--bounded-body-hull',
      '--rigid-piping-sections','--body-frame-detail','--joined-piping-sections','--output',output],{timeout:60000});
    const report=JSON.parse(fs.readFileSync(path.join(output,'endpoint-cloth.json')));
    assert.equal(report.stoppedAt.time,32/60);
    assert(report.rows.slice(0,31).every(r=>!r.contacts.length&&r.minStretch>=.8&&r.maxStretch<=1.2));
    assert.deepEqual(report.rows.at(-1).contacts,['cape_back_edge/body']);
    assert.equal(report.seamsAccepted,true);assert.equal(report.firstSeamFailure,undefined);
    assert.equal(report.completedRequestedSteps,false);assert.equal(report.accepted,false);
    assert.equal(report.finalEndpointClear,false);assert.equal(report.resourcesReleased,true);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('the explicit coupled-wire candidate retains its actual render and seam failure despite clear physical edges',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bubu-cloth-coupled-wire-'));
  try{
    const output=path.join(temporary,'evidence'),proxy=fileURLToPath(new URL('./fixtures/wire-local-body-proxy-v2.json',import.meta.url));
    await run(process.execPath,[script,'--trajectory','--convex-hands','--local-body-proxy',proxy,
      '--conforming-wire-piping','--constraint-pgs','12','--output',output],{timeout:60000});
    const report=JSON.parse(fs.readFileSync(path.join(output,'endpoint-cloth.json'))),row=report.rows.at(-1);
    assert.equal(report.stoppedAt.time,1/60);assert.equal(row.contacts.length,0);
    assert(row.cageStrain.min>=.8&&row.cageStrain.max<=1.2);
    assert(row.renderStrain.min<.8||row.renderStrain.max>1.2);
    assert.equal(report.seamsAccepted,false);assert.equal(report.strainAccepted,false);
    assert.equal(report.accepted,false);assert.equal(report.finalEndpointClear,false);
    assert.equal(report.resourcesReleased,true);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('full failure collection retains the first rejected state and never admits a failed prefix', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-cloth-failures-'));
  try {
    const output = path.join(temporary, 'evidence');
    await run(process.execPath, [script, '--trajectory', '--convex-hands', '--bounded-body-hull',
      '--frames', '8', '--collect-failures', '--output', output], {timeout: 30000});
    const report = JSON.parse(fs.readFileSync(path.join(output, 'endpoint-cloth.json')));
    assert.equal(report.rows.length, 8);
    assert.equal(report.collectFailures, true);
    assert.match(report.scope, /retain all/);
    assert.equal(report.firstFailure.time, 4 / 60);
    assert.equal(report.stoppedAt, undefined);
    assert(report.failedSamples > 1);
    assert.equal(report.strainAccepted, false);
    assert.equal(report.accepted, false);
    assert.equal(report.reachedActionEndpoint, false);
    assert.equal(report.finalEndpointClear, false);
    assert.equal(report.realtimeAccepted, false);
    assert.equal(report.resourcesReleased, true);
    const first = JSON.parse(fs.readFileSync(path.join(output, 'failed-render-parts.json')));
    const last = JSON.parse(fs.readFileSync(path.join(output, 'last-render-parts.json')));
    assert.notDeepEqual(first, last, 'First failure evidence cannot be overwritten by later frames');
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('shared native units cannot silently mix with the older body-patch comparison', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-cloth-units-'));
  try {
    await assert.rejects(run(process.execPath, [script, '--trajectory', '--convex-hands',
      '--shared-surface-cage', 'unused.json', '--local-body-proxy', 'unused.json',
      '--body-patches', '64', '--output', path.join(temporary, 'evidence')], {timeout: 30000}),
    /Shared centimetre world requires the unpartitioned body proxy/);
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});
