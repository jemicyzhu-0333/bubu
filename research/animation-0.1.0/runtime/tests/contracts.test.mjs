import test from 'node:test';
import assert from 'node:assert/strict';
import {
  file, editGLB, read, pack
}
from './helpers.mjs';
import {
  validateManifest, validateProfile, validateMotion, path, json, LIMITS
}
from '../src/contracts.mjs';
import {
  preflightGLB
}
from '../src/glb-preflight.mjs';
import {
  preparePack, sha256
}
from '../src/pack-loader.mjs';
import {
  createSuite
}
from '../src/suite.mjs';
import {
  ResourceCache
}
from '../src/resource-cache.mjs';
for(const x of ['../x', 'a/../x', '/x', 'https://x', 'a%2fb', 'a\\b', 'a//b', './a', 'a?x', 'a#x'])test('unsafe path rejected '+x, ()=>assert.throws(()=>path(x)));
test('strict version/capabilities/fields/budgets and hashes', async()=> {
  const m=JSON.parse(new TextDecoder().decode(await file('manifest.json')));
  for(const mutate of [x=>x.version='V1', x=>x.legacy=true, x=>x.requiredCapabilities.push('gaze'), x=>x.requiredCapabilities.push(x.requiredCapabilities[0]), x=>x.budgets.vertices=LIMITS.vertices+1, x=>x.assets[0].sha256='bad']) {
    const c=structuredClone(m);
    mutate(c);
    assert.throws(()=>validateManifest(c));
  }
  await assert.rejects(preparePack(async(p, max)=> {
    const b=await read(p, max);
    if(p.endsWith('.glb'))b[b.length-1]^=1;
    return b;
  }), e=>e.code==='INTEGRITY');
});
test('GLB preflight rejects external resources/extensions/default morphs/bad ranges', async()=> {
  const b=await file('mechanical-character.glb');
  for(const mutate of [x=>x.images=[{
    uri:'x.png'
  }], x=>x.extensionsUsed=['X'], x=>x.buffers[0].uri='a.bin', x=>x.meshes[1].weights=[1, 0, 0, 0], x=>x.nodes[8].weights=[1e100], x=>x.buffers[0].byteLength-=.5, x=>x.scenes[0].nodes.push(0), x=>x.nodes[2].name='Body', x=>x.nodes[1].children.push(0), x=>x.accessors[0].sparse= {
  }, x=>x.bufferViews[0].byteStride=5, x=>x.accessors[0].count=300001, x=>x.nodes[8].skin=100])assert.throws(()=>preflightGLB(editGLB(b, mutate)));
});
test('accessor aliases are cost bounded before float scan', async()=> {
  const b=await file('mechanical-character.glb');
  assert.throws(()=>preflightGLB(editGLB(b, x=> {
    const a=x.accessors[0];
    x.accessors=Array.from({
      length:513
    }, ()=>a);
  })), e=>e.code==='LIMIT');
});
test('profile cannot activate art/gaze/overlap or omit affected face mesh', async()=> {
  const p=(await pack()).profile;
  for(const mutate of [x=>x.purpose='bubu-production', x=>x.capabilities.push('gaze'), x=>x.expressions.policy='additive', x=>x.expressions.paths[0].knots[1].targets= {
    Other: {
      Missing:1
    }
  }, x=>x.expressions.paths[0].knots[0].targets.FacePanel= {
    TestA_full:1
  }]) {
    const c=structuredClone(p);
    mutate(c);
    assert.throws(()=>validateProfile(c));
  }
});
test('missing morph target and joint/socket alias reject atomically without leaked leases', async()=> {
  for(const mutate of [p=>p.expressions.paths[0].knots[1].targets.FacePanel= {
    Missing:1
  }, p=>p.sockets[0].node='ArmL']) {
    const p=await pack();
    mutate(p.profile);
    const cache=new ResourceCache();
    await assert.rejects(createSuite(p, cache));
    assert.equal(cache.stats.live, 0);
    assert.equal(cache.retainedReferences, 0);
  }
});
test('joint cap and channel reference reject before runtime', async()=> {
  const p=await pack();
  for(const mutate of [m=>m.segments[0].joints['knee.left']=[0, 0, 0, 1], m=>m.segments[0].joints['arm.left']=[0, 0, Math.sin(.4), Math.cos(.4)], m=>m.segments[0].accessories.x=[0, 0, 0, 1]]) {
    const m=structuredClone(p.motion);
    mutate(m);
    assert.throws(()=>validateMotion(m, p.profile, p.manifest.equipment));
  }
});
test('unbound morph mesh and skinned rigid equipment reject', async()=> {
  const p=await pack(), cache=new ResourceCache();
  p.profile.expressions.meshes=[];
  p.profile.expressions.paths=[];
  await assert.rejects(createSuite(p, cache), e=>e.code==='UNBOUND_MORPH_MESH');
  assert.equal(cache.stats.live, 0);
  const readMutated=async(name, max)=> {
    const b=await read(name, max);
    if(name!=='manifest.json')return b;
    const m=JSON.parse(new TextDecoder().decode(b));
    m.equipment[0].asset='body';
    return new TextEncoder().encode(JSON.stringify(m));
  };
  await assert.rejects(preparePack(readMutated), e=>e.code==='UNSUPPORTED');
});
test('resolved repeated equipment counts against instance budget', async()=> {
  await assert.rejects(preparePack(async(name, max)=> {
    const b=await read(name, max);
    if(name!=='manifest.json')return b;
    const m=JSON.parse(new TextDecoder().decode(b));
    m.budgets.vertices=148;
    m.equipment.push({
      ...m.equipment[0], id:'other'
    });
    return new TextEncoder().encode(JSON.stringify(m));
  }), e=>e.code==='LIMIT');
});
test('mesh reused by many nodes counts render vertices, not definition count', async()=> {
  const b=await file('mechanical-accessory.glb');
  const x=editGLB(b, g=> {
    g.nodes.push({
      name:'ItemMesh2', mesh:0
    });
    g.nodes[0].children.push(2);
  });
  assert.throws(()=>preflightGLB(x, {
    vertices:30, nodes:20
  }), e=>e.code==='LIMIT');
});
test('prototype property cannot masquerade as a morph target', async()=> {
  const p=await pack(), c=new ResourceCache();
  p.profile.expressions.paths[0].knots[1].targets.FacePanel= {
    toString:1
  };
  await assert.rejects(createSuite(p, c), e=>e.code==='BINDING');
  assert.equal(c.stats.live, 0);
});
