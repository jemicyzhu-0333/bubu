import * as T from 'three';
/** Model units match approved05. Cup origin is bottom center; +Y up.
 * Own geometry/material resources only. No character or expression writes. */
export function createTeaCup({radius=.27,height=.33}={}) {
 if(!Number.isFinite(radius)||!Number.isFinite(height)||radius<.1||radius>.5||height<.15||height>.6)throw RangeError('Bounded cup dimensions required');
 const root=new T.Group();root.name='Sip_cup';
 const ceramic=new T.MeshStandardMaterial({color:0x9bcdbf,roughness:.52,metalness:0});
 const tea=new T.MeshStandardMaterial({color:0x613220,roughness:.28,metalness:0});
 const profile=[[0,0],[radius*.73,0],[radius*.80,.025],[radius,height-.025],[radius*.99,height],[radius*.88,height],[radius*.86,height-.025],[radius*.70,.05],[0,.05]].map(([x,y])=>new T.Vector2(x,y));
 const shell=new T.Mesh(new T.LatheGeometry(profile,64),ceramic);shell.name='Sip_cup_shell';root.add(shell);
 // C handle lies in the XY plane, with open end touching the vessel wall.
 const curve=new T.CatmullRomCurve3([[radius*.88,height*.80,0],[radius*1.47,height*.85,0],[radius*1.65,height*.53,0],[radius*1.43,height*.23,0],[radius*.82,height*.23,0]].map(p=>new T.Vector3(...p)));
 const handle=new T.Mesh(new T.TubeGeometry(curve,40,.032,12,false),ceramic);handle.name='Sip_cup_handle';root.add(handle);
 const liquid=new T.Mesh(new T.CircleGeometry(radius*.84,64),tea);liquid.name='Sip_tea_surface';liquid.rotation.x=-Math.PI/2;liquid.position.y=height-.045;root.add(liquid);
 const sockets=Object.freeze({rim:new T.Vector3(0,height,-radius*.95),handle:new T.Vector3(radius*1.62,height*.53,0),support:new T.Vector3(-radius*.82,height*.35,0)});
 let disposed=false;
 return {root,sockets,dimensions:Object.freeze({radius,height}),dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});ceramic.dispose();tea.dispose();root.clear();}};
}
