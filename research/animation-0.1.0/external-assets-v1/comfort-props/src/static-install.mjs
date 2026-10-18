import {hangTissue,settleOnWorldPlane,setWorldMatrix} from '../../prop-expansion/src/support-geometry.mjs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export const placements=Object.freeze(Object.fromEntries(Object.entries({'tissue-sheet':[1.264,.67,-.20],'telescope-handheld':[1.34,.40,-.20],mirror:[1.23,.55,-.20],tissue:[1.65,.006,.35],cushion:[1.80,-.019,.35],binoculars:[1.475,.54,-.20],telescope:[1.75,.006,.35],pillow:[1.80,.006,.35]}).map(([k,v])=>[k,Object.freeze(v)])));
const safeMin=new T.Vector3(-2.63,-.04,-2.63),safeMax=new T.Vector3(2.63,3.1,2.63);
function release(root){if(!root?.isObject3D)return;root.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.clear();}
function finite(values){return values.every(Number.isFinite);}
function validateAsset(root){
 if(!root?.isObject3D||root.parent)throw new Error('Unowned or missing prop root');
 // The loader container is identity; fixed placements are applied only after validation.
 if(root.position.lengthSq()!==0||root.scale.distanceTo(new T.Vector3(1,1,1))>1e-7||root.quaternion.angleTo(new T.Quaternion())>1e-7)throw new Error('Unexpected prop root transform');
 let count=0;
 root.traverse(o=>{
  if(!finite([...o.position,...o.scale,...o.quaternion,...o.matrix.elements]))throw new Error('Non-finite prop transform');
  if(o.scale.toArray().some(v=>v<.001||v>4)||Math.abs(o.quaternion.lengthSq()-1)>1e-5)throw new Error('Invalid prop scale or rotation');
  const expected=new T.Matrix4().compose(o.position,o.quaternion,o.scale);
  if(!o.matrixAutoUpdate&&o.matrix.elements.some((v,i)=>Math.abs(v-expected.elements[i])>1e-6))throw new Error('Noncanonical manual prop matrix');
  if(expected.determinant()<1e-10)throw new Error('Singular prop transform');
  if(!o.isMesh)return;
  count++;
  const p=o.geometry?.attributes.position;
  if(!p||!p.count||p.count>20000||!finite(Array.from(p.array)))throw new Error('Invalid prop vertices');
  // Discard cached bounds so corrupt geometry cannot hide behind stale boxes.
  o.geometry.boundingBox=null;o.geometry.boundingSphere=null;
 });
 if(!count||count>100||!root.getObjectByName('socket_support'))throw new Error('Incomplete prop');
}
function validateWorld(root){
 root.updateMatrixWorld(true);
 root.traverse(o=>{if(!finite(o.matrixWorld.elements)||Math.abs(o.matrixWorld.determinant())<1e-10)throw new Error('Invalid prop world matrix');});
 const box=new T.Box3().setFromObject(root,true);
 if(box.isEmpty()||!finite([...box.min,...box.max])||['x','y','z'].some(axis=>box.min[axis]<safeMin[axis]||box.max[axis]>safeMax[axis]))throw new Error('Outside static envelope');
}
/** Isolated static preview lifecycle, not application integration. Owns loaded prop only. */
export class StaticPropInstallation {
 constructor(parent,{parse=buffer=>new GLTFLoader().parseAsync(buffer,'')}={}){if(!parent?.isObject3D)throw new TypeError('Parent required');this.parent=parent;this.parse=parse;this.generation=0;this.root=null;this.disposed=false;this.status='empty';}
 async install(id,buffer){
  if(this.disposed)throw new Error('Disposed installation');if(!Object.hasOwn(placements,id))throw new Error('Unknown prop');
  const generation=++this.generation;this.status='loading';let root;
  try{
   const result=await this.parse(buffer);root=result?.scene;
   if(this.disposed||generation!==this.generation){release(root);return false;}
   validateAsset(root);root.position.set(...placements[id]);if(id==='tissue-sheet')hangTissue(root);root.updateMatrix();const desired=root.matrix.clone();this.parent.add(root);setWorldMatrix(root,desired);if(['tissue','cushion','telescope','pillow'].includes(id))settleOnWorldPlane(root,.006);validateWorld(root);
  }catch(error){release(root);if(generation===this.generation)this.status='failed';throw error;}
  if(this.root)release(this.root);this.root=root;this.parent.add(root);this.status='ready';return true;
 }
 clear(){++this.generation;if(this.root)release(this.root);this.root=null;this.status='empty';}
 dispose(){if(this.disposed)return;this.clear();this.disposed=true;this.status='disposed';}
}
