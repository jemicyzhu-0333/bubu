import {
  Group, Quaternion
}
from 'three';
import {
  clone
}
from 'three/addons/utils/SkeletonUtils.js';
import {
  acquireGLB
}
from './pack-loader.mjs';
import {
  QuaternionLane, FaceLane, Timeline
}
from './timeline.mjs';
import {
  fail
}
from './contracts.mjs';
function uniqueNodes(root) {
  const map=new Map();
  root.traverse(o=> {
    if(!o.name)return;
    if(map.has(o.name))fail('AMBIGUOUS_NODE', o.name);
    map.set(o.name, o);
  });
  return map;
}
function ownSkeletons(root) {
  const set=new Set();
  root.traverse(o=> {
    if(o.skeleton)set.add(o.skeleton);
  });
  return set;
}
export async function createSuite(pack, cache, {
  signal
}
= {
}) {
  const leases=[], clones=[];
  let disposed=false, actorRoot=null;
  const dispose=()=> {
    if(disposed)return;
    disposed=true;
    actorRoot?.removeFromParent();
    actorRoot?.clear();
    const skeletons=new Set();
    for(const c of clones)for(const s of ownSkeletons(c))skeletons.add(s);
    for(const s of skeletons)s.dispose();
    for(const l of leases)l.release();
    clones.length=0;
    leases.length=0;
  };
  try {
    const bodyLease=await acquireGLB(pack, pack.manifest.character.asset, cache, {
      signal
    });
    leases.push(bodyLease);
    const model=clone(bodyLease.value.gltf.scene);
    clones.push(model);
    const nodes=uniqueNodes(model), p=pack.profile, root=new Group();
    actorRoot=root;
    root.name='Suite_actor';
    root.add(model);
    const lanes=new Map(), usedNodes=new Set();
    for(const b of p.joints) {
      const node=nodes.get(b.node);
      if(!node?.isBone)fail('BINDING', 'Joint missing/not bone: '+b.node);
      if(usedNodes.has(node))fail('BINDING', 'Duplicate joint/socket binding');
      usedNodes.add(node);
      lanes.set('joint:'+b.id, new QuaternionLane(node, node.quaternion));
    }
    const sockets=new Map();
    for(const s of p.sockets) {
      const node=nodes.get(s.node);
      if(!node)fail('BINDING', 'Socket missing: '+s.node);
      if(usedNodes.has(node))fail('BINDING', 'Duplicate joint/socket binding');
      usedNodes.add(node);
      sockets.set(s.id, node);
    }
    const roster=new Set(p.expressions.meshes);
    model.traverse(o=> {
      if(o.isMesh&&o.morphTargetInfluences?.length&&!roster.has(o.name))fail('UNBOUND_MORPH_MESH', o.name);
    });
    const faceMeshes=p.expressions.meshes.map(name=> {
      const n=nodes.get(name);
      if(!n?.isMesh||!n.morphTargetDictionary||!n.morphTargetInfluences)fail('BINDING', 'Face mesh targets missing: '+name);
      return n;
    });
    const paths=new Map();
    for(const path of p.expressions.paths) {
      const knots=path.knots.map(k=>({
        at:k.at, weights:faceMeshes.map(mesh=> {
          const values=new Float64Array(mesh.morphTargetInfluences.length);
          for(const[name, value]of Object.entries(k.targets[mesh.name])) {
            const index=mesh.morphTargetDictionary[name];
            if(!Object.hasOwn(mesh.morphTargetDictionary, name)||!Number.isInteger(index)||index<0||index>=values.length)fail('BINDING', 'Missing face target '+mesh.name+':'+name);
            values[index]=value;
          }
          return values;
        })
      }));
      paths.set(path.id, knots);
    }
    if(p.capabilities.includes('skeletal-delta')&&!p.joints.length)fail('UNBOUND_CAPABILITY', 'No skeleton binding');
    if(p.capabilities.includes('expression-single-path')&&(!paths.size||!faceMeshes.length))fail('UNBOUND_CAPABILITY', 'No face binding');
    if(p.capabilities.includes('rigid-socket')&&!sockets.size)fail('UNBOUND_CAPABILITY', 'No socket binding');
    let lastPath=Symbol(), lastAmount=-1;
    const applyFace=(id, amount)=> {
      if(lastPath===id&&lastAmount===amount)return;
      lastPath=id;
      lastAmount=amount;
      for(const m of faceMeshes)m.morphTargetInfluences.fill(0);
      if(id===null||amount===0)return;
      const knots=paths.get(id);
      if(!knots)fail('BINDING', 'Unknown active face');
      let hi=1;
      while(hi<knots.length-1&&amount>knots[hi].at)hi++;
      const lo=knots[hi-1], up=knots[hi], u=(amount-lo.at)/(up.at-lo.at);
      for(let i=0;
      i<faceMeshes.length;
      i++) {
        const out=faceMeshes[i].morphTargetInfluences, a=lo.weights[i], b=up.weights[i];
        for(let j=0;
        j<out.length;
        j++)out[j]=a[j]+(b[j]-a[j])*u;
      }
    };
    for(const item of pack.manifest.equipment) {
      if(pack.audits.get(item.asset)?.document.skins?.length)fail('UNSUPPORTED', 'Skinned equipment requires an unimplemented adapter');
      const socket=sockets.get(item.slot);
      if(!socket)fail('BINDING', 'Unknown equipment slot');
      const l=await acquireGLB(pack, item.asset, cache, {
        signal
      });
      leases.push(l);
      const object=clone(l.value.gltf.scene);
      clones.push(object);
      const fit=new Group(), local=new Group();
      fit.name='Fit_'+item.id;
      fit.position.fromArray(item.fit.position);
      fit.quaternion.fromArray(item.fit.rotation);
      fit.scale.setScalar(item.fit.scale);
      fit.add(local);
      local.add(object);
      socket.add(fit);
      lanes.set('accessory:'+item.id, new QuaternionLane(local, new Quaternion()));
    }
    if(signal?.aborted)throw signal.reason??Error('Aborted');
    const face=new FaceLane(), timeline=new Timeline(lanes, face, pack.motion.segments, applyFace);
    timeline.advance(0);
    root.updateMatrixWorld(true);
    return {
      root, model, lanes, face, timeline, pack, budget:pack.budget, dispose, enqueue(event) {
        if(disposed)fail('DISPOSED', 'Suite');
        timeline.enqueue(event);
      }, advance(t) {
        if(disposed)fail('DISPOSED', 'Suite');
        const changed=timeline.advance(t);
        if(changed)root.updateMatrixWorld(true);
        return changed;
      }, isAnimating(t) {
        return timeline.isAnimating(t);
      }, nextDeadline() {
        return timeline.nextDeadline();
      }, get disposed() {
        return disposed;
      }
    };
  }
  catch(error) {
    dispose();
    throw error;
  }
}
