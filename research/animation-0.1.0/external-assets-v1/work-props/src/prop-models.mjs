import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const material = color => new T.MeshStandardMaterial({color, roughness:.7, metalness:0});
function resource(root,sockets) {
 let disposed=false;
 return {root,sockets,dispose() {
  if(disposed) return;
  disposed=true; root.removeFromParent();
  const gs=new Set(),ms=new Set();
  root.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});
  gs.forEach(g=>g.dispose()); ms.forEach(m=>m.dispose()); root.clear();
 }};
}
function box(parent,name,size,pos,mat,radius=.015) {
 const mesh=new T.Mesh(new RoundedBoxGeometry(...size,3,radius),mat);
 mesh.name=name; mesh.position.set(...pos); parent.add(mesh); return mesh;
}
function keys(root,ivory,width=1.08,zOffset=0,y=.13) {
 const pitch=width/7;
 for(let row=0;row<2;row++) for(let col=0;col<7;col++)
  box(root,`Key_${row}_${col}`,[pitch-.018,.05,.115],[(col-3)*pitch,y,zOffset+(row-1)*.14],ivory,.018);
 for(const col of [-3,-2,2,3]) box(root,`Key_bottom_${col}`,[pitch-.018,.05,.115],[col*pitch,y,zOffset+.14],ivory,.018);
 box(root,'Key_space',[pitch*3-.018,.05,.115],[0,y,zOffset+.14],ivory,.018);
}
export function createKeyboard() {
 const root=new T.Group(); root.name='Prop_keyboard';
 const teal=material('#608985'),ivory=material('#fff1d5');
 box(root,'Keyboard_shell',[1.28,.12,.47],[0,.06,0],teal,.055);
 keys(root,ivory);
 return resource(root,{support:new T.Vector3(0,0,0),left:new T.Vector3(-.34,.155,-.06),right:new T.Vector3(.34,.155,-.06)});
}
export function createLaptop() {
 const root=new T.Group(); root.name='Prop_laptop';
 const teal=material('#608985'),ivory=material('#fff1d5'),screen=material('#263b43');
 box(root,'Laptop_base',[1.25,.075,.58],[0,.0375,.05],teal,.035);
 keys(root,ivory,.99,-.06,.09);
 box(root,'Laptop_touchpad',[.32,.008,.12],[0,.08,-.23],ivory,.018);
 // Viewer is +Z, pet is -Z. Outer lid faces viewer; display faces pet.
 const lid=new T.Group();lid.name='Laptop_lid';lid.position.set(0,.075,.34);lid.rotation.x=.20;root.add(lid);
 box(lid,'Laptop_plain_outer_lid',[1.25,.76,.055],[0,.38,0],teal,.035);
 box(lid,'Laptop_inward_screen',[1.10,.61,.009],[0,.395,-.031],screen,.022);
 return resource(root,{support:new T.Vector3(0,0,0),left:new T.Vector3(-.32,.115,-.08),right:new T.Vector3(.32,.115,-.08),hinge:new T.Vector3(0,.075,.34)});
}


function cylinder(root,name,rTop,rBottom,height,y,mat) {
 const mesh=new T.Mesh(new T.CylinderGeometry(rTop,rBottom,height,48),mat);
 mesh.name=name; mesh.position.y=y; root.add(mesh); return mesh;
}
export function createMicrophone() {
 const root=new T.Group();root.name='Prop_microphone';
 const teal=material('#608985'),ivory=material('#fff1d5'),dark=material('#303638');
 const handle=new T.Mesh(new T.CapsuleGeometry(.065,.22,6,24),teal);
 handle.name='Microphone_handle';handle.position.y=.175;root.add(handle);
 cylinder(root,'Microphone_collar',.104,.09,.045,.335,ivory);
 const head=new T.Mesh(new T.SphereGeometry(.14,32,20),dark);
 head.name='Microphone_grille';head.position.y=.46;head.scale.set(1,1.04,1);root.add(head);
 return resource(root,{grip:new T.Vector3(0,.18,0),gripSurface:new T.Vector3(-.065,.18,0),mouthTarget:new T.Vector3(0,.48,-.14),support:new T.Vector3(0,0,0)});
}
export function createDrum() {
 const root=new T.Group();root.name='Prop_drum';
 const teal=material('#608985'),ivory=material('#fff1d5');
 cylinder(root,'Drum_body',.48,.48,.30,.20,teal);
 cylinder(root,'Drum_bottom',.495,.495,.065,.0325,ivory);
 cylinder(root,'Drum_head',.495,.495,.065,.3675,ivory);
 for (const y of [.0325,.3675]) {
  const ring=new T.Mesh(new T.TorusGeometry(.48,.025,10,48),ivory);
  ring.name=y<.1?'Drum_lower_soft_rim':'Drum_upper_soft_rim';ring.rotation.x=Math.PI/2;ring.position.y=y;root.add(ring);
 }
 return resource(root,{support:new T.Vector3(0,0,0),left:new T.Vector3(-.25,.4,-.08),right:new T.Vector3(.25,.4,-.08),strike:new T.Vector3(0,.4,0)});
}
export const factories=Object.freeze({keyboard:createKeyboard,laptop:createLaptop,microphone:createMicrophone,drum:createDrum});
