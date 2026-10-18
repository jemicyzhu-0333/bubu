import {factories} from './prop-models.mjs';
/** Ref-counted immutable geometry; per-instance transforms and cloned materials. */
export function createSharedPropPool(id){
 if(!['ball','building-block'].includes(id))throw new TypeError('Only repeatable ball/block families');
 const template=factories[id]();let refs=0,closed=false,released=false;
 function release(){if(closed&&refs===0&&!released){released=true;template.dispose();}}
 return {acquire(){if(closed)throw Error('Closed pool');refs++;const root=template.root.clone(true),materials=new Set();root.traverse(o=>{if(o.isMesh){o.material=o.material.clone();materials.add(o.material);}});let disposed=false;return {root,sockets:Object.fromEntries(Object.entries(template.sockets).map(([k,v])=>[k,v.clone()])),dispose(){if(disposed)return;disposed=true;root.removeFromParent();materials.forEach(m=>m.dispose());root.clear();refs--;release();}};},dispose(){closed=true;release();},get active(){return refs;},get released(){return released;}};
}
