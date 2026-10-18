import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createTeaCup} from './cup-model.mjs';
const material=(color,roughness=.65)=>new T.MeshStandardMaterial({color,roughness,metalness:0});
function resource(root,sockets){let disposed=false;return {root,sockets,dispose(){if(disposed)return;disposed=true;root.removeFromParent();const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.isMesh){gs.add(o.geometry);for(const m of [].concat(o.material))ms.add(m);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());root.clear();}};}
function box(parent,name,size,pos,mat,radius=.015){const mesh=new T.Mesh(new RoundedBoxGeometry(...size,3,radius),mat);mesh.name=name;mesh.position.set(...pos);parent.add(mesh);return mesh;}
export function createBook(){const root=new T.Group();root.name='Prop_open_book';const teal=material('#608985'),ivory=material('#fff1d5'),edge=material('#e5d5b8');
for(const s of [-1,1]){const wing=new T.Group();wing.name=s<0?'Book_left_leaf':'Book_right_leaf';wing.rotation.y=s*.52;root.add(wing);box(wing,wing.name+'_cover',[.48,.65,.045],[s*.245,.325,.02],teal,.02);box(wing,wing.name+'_pages',[.45,.65,.065],[s*.242,.36,-.031],ivory,.012);for(let i=0;i<3;i++){box(wing,wing.name+'_page_edge_'+i,[.446,.004,.003],[s*.242,.675-i*.009,-.066],edge,.001);box(wing,wing.name+'_fanned_leaf_'+i,[.44,.65,.004],[s*.242,.38+i*.01,-.07-i*.008],ivory,.0015);}}
box(root,'Book_spine',[.055,.65,.08],[0,.325,.02],teal,.018);
return resource(root,{left:new T.Vector3(-.41,.50,-.26),right:new T.Vector3(.41,.50,-.26),support:new T.Vector3(0,0,0),page:new T.Vector3(.22,.43,-.11)});}
export function createPaperBoard(){const root=new T.Group();root.name='Prop_paper_board';const teal=material('#608985'),ivory=material('#fff1d5');box(root,'Paper_board',[.84,.045,.54],[0,.0225,0],teal,.02);for(let i=0;i<3;i++)box(root,'Paper_sheet_'+i,[.77-i*.012,.009,.47-i*.012],[i*.006,.05+i*.011,-i*.006],ivory,.004);return resource(root,{support:new T.Vector3(.40,.024,0),writeSurface:new T.Vector3(0,.076,0),left:new T.Vector3(-.40,.024,0)});}
export function createPencil(){const root=new T.Group();root.name='Prop_pencil';const yellow=material('#efc76d'),teal=material('#608985'),wood=material('#d4b08a'),black=material('#27272b');
function cyl(name,r1,r2,h,y,mat,n=12){const o=new T.Mesh(new T.CylinderGeometry(r1,r2,h,n),mat);o.name=name;o.position.y=y;root.add(o);}
cyl('Pencil_painted_shaft',.037,.037,.28,.24,yellow,6);cyl('Pencil_wood_tip',.037,.009,.07,.065,wood,6);cyl('Pencil_graphite',.009,0,.03,.015,black,6);cyl('Pencil_endcap',.039,.039,.05,.405,teal,16);
return resource(root,{tip:new T.Vector3(0,0,0),grip:new T.Vector3(0,.17,0),end:new T.Vector3(0,.43,0)});}
export const factories=Object.freeze({'cup':()=>createTeaCup({radius:.23081978518525692,height:.3091484835864778}),'open-book':createBook,'paper-board':createPaperBoard,'pencil':createPencil});
