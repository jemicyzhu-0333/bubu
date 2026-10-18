import * as T from 'three';
const mat=(color,roughness=.65)=>new T.MeshStandardMaterial({
  color,roughness
});
function res(root,sockets){
  let disposed=false;
  return{
    root,sockets:Object.fromEntries(Object.entries(sockets).map(([k,p])=>[k,new T.Vector3(...p)])),dispose(){
      if(disposed)return;
      disposed=true;
      root.removeFromParent();
      const gs=new Set(),ms=new Set();
      root.traverse(o=>{
        if(o.isMesh){
          gs.add(o.geometry);
          ms.add(o.material);
        }
      });
      gs.forEach(g=>g.dispose());
      ms.forEach(m=>m.dispose());
      root.clear();
    }
  };
} function mesh(root,name,g,m,p=[0,0,0],s=[1,1,1]){
  const o=new T.Mesh(g,m);
  o.name=name;
  o.position.fromArray(p);
  o.scale.fromArray(s);
  root.add(o);
  return o;
} function ell(root,n,m,p,s){
  return mesh(root,n,new T.SphereGeometry(1,24,16),m,p,s);
} function rod(root,n,a,b,r,m){
  const av=new T.Vector3(...a),bv=new T.Vector3(...b);
  const o=mesh(root,n,new T.CylinderGeometry(r,r,av.distanceTo(bv),16),m,av.clone().add(bv).multiplyScalar(.5).toArray());
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),bv.sub(av).normalize());
  return o;
} function tube(root,n,points,r,m,closed=false){
  return mesh(root,n,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),closed),40,r,8,closed),m);
} export function createButterfly(){
  const root=new T.Group();
  root.name='Creature_butterfly';
  const plum=mat('#8c5a76'),lav=mat('#bf99dc');
  ell(root,'Butterfly_body',plum,[0,.23,0],[.045,.15,.045]);
  for(const side of [-1,1]){
    const wing=new T.Group();
    wing.name='Butterfly_wing_'+(side<0?'left':'right');
    wing.position.set(side*.025,.24,0);
    root.add(wing);
    const upper=ell(wing,'Butterfly_upper_'+side,lav,[side*.13,.09,0],[.14,.19,.045]);
    upper.rotation.z=-side*.5;
    const lower=ell(wing,'Butterfly_lower_'+side,lav,[side*.10,-.12,0],[.105,.10,.04]);
    lower.rotation.z=side*.4;
    tube(root,'Butterfly_antenna_'+side,[[side*.015,.35,0],[side*.04,.43,0],[side*.075,.46,0]],.008,plum);
    ell(root,'Butterfly_antenna_tip_'+side,plum,[side*.075,.46,0],[.017,.017,.017]);
  }return res(root,{
    flightOrigin:[0,.24,0],wingLeft:[-.025,.24,0],wingRight:[.025,.24,0]
  });
} export function createGroundHole(){
  const root=new T.Group();
  root.name='Environment_ground_hole';
  root.userData={
    kind:'environment-opening',portable:false,requires:'ground mesh oval cutout and actor clipping when falling; no timeline provided',openingRadius:[.47,.34],groundY:0
  };
  const earth=mat('#a27a50',1),dark=mat('#302319',1);
  const rim=mesh(root,'Hole_soil_rim',new T.TorusGeometry(.5,.035,10,48),earth,[0,.006,0],[1, .72,1]);
  rim.rotation.x=-Math.PI/2;
  const ground=new T.Shape();
  ground.moveTo(-.68,-.51);
  ground.lineTo(.68,-.51);
  ground.lineTo(.68,.51);
  ground.lineTo(-.68,.51);
  ground.closePath();
  const opening=new T.Path();
  opening.absellipse(0,0,.47,.3384,0,Math.PI*2,true);
  ground.holes.push(opening);
  const terrain=mesh(root,'Hole_surrounding_ground',new T.ExtrudeGeometry(ground,{
    depth:.34,bevelEnabled:false,steps:1,curveSegments:48
  }),earth);
  terrain.rotation.x=Math.PI/2;
  const p=[[.47,0],[.46,-.12],[.39,-.25],[.30,-.32],[0,-.34]];
  const g=new T.LatheGeometry(p.map(p=>new T.Vector2(...p)),48);
  g.scale(1,1,.72);
  const wall=mesh(root,'Hole_descending_interior',g,dark);
  wall.material.side=T.DoubleSide;
  return res(root,{
    opening:[0,0,0],clipPlane:[0,0,0],depthLimit:[0,-.34,0]
  });
} export function createWand(){
  const root=new T.Group();
  root.name='Prop_bubble_wand';
  const lav=mat('#b89ad8'),plum=mat('#8c70a6');
  mesh(root,'Wand_handle',new T.CapsuleGeometry(.038,.38,5,16),lav,[0,.23,0]);
  mesh(root,'Wand_collar',new T.CylinderGeometry(.052,.052,.055,24),plum,[0,.44,0]);
  mesh(root,'Wand_ring',new T.TorusGeometry(.175,.032,12,48),lav,[0,.645,0]);
  return res(root,{
    grip:[0,.23,0],bubbleOrigin:[0,.645,0]
  });
} export function createHat(){
  const root=new T.Group();
  root.name='Prop_magic_hat';
  const lavender=mat('#b998d4'),gold=mat('#e2bd6d'),dark=mat('#604775');
  mesh(root,'Hat_brim',new T.CylinderGeometry(.43,.43,.055,48),lavender,[0,.03,0]);
  const profile=[[.28,.055],[.28,.44],[.27,.46],[.24,.46],[.235,.44],[.235,.09],[0,.09],[0,.055]];
  mesh(root,'Hat_hollow_crown',new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),48),lavender);
  mesh(root,'Hat_inner_floor',new T.CylinderGeometry(.234,.234,.01,40),dark,[0,.092,0]);
  mesh(root,'Hat_band',new T.CylinderGeometry(.283,.283,.055,48,1,true),gold,[0,.11,0]);
  return res(root,{
    support:[0,0,0],opening:[0,.46,0],rim:[.27,.46,0]
  });
} export function createStar(){
  const root=new T.Group();
  root.name='Effect_star';
  const shape=new T.Shape();
  for(let i=0;
  i<10;
  i++){
    const a=Math.PI/2+i*Math.PI/5,r=i%2?.11:.23,x=r*Math.cos(a),y=.23+r*Math.sin(a);
    if(i===0)shape.moveTo(x,y);
    else shape.lineTo(x,y);
  }shape.closePath();
  mesh(root,'Star_beveled_body',new T.ExtrudeGeometry(shape,{
    depth:.065,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.026,bevelThickness:.025
  }),mat('#f3cf70'),[0,0,-.0325]);
  return res(root,{
    origin:[0,.23,0]
  });
} export function createYarn(){
  const root=new T.Group();
  root.name='Prop_yarn';
  const lav=mat('#b89bd0'),thread=mat('#a98bc5');
  ell(root,'Yarn_ball_core',lav,[0,.245,0],[.23,.23,.23]);
  const rotations=[[.35,.4,.65],[1.45,.2,-.5],[.6,1.2,.1]];
  for(let group=0;
  group<3;
  group++)for(let band=-2;
  band<=2;
  band++){
    const q=new T.Quaternion().setFromEuler(new T.Euler(...rotations[group])),offset=band*.033,normal=new T.Vector3(0,0,1).applyQuaternion(q),center=new T.Vector3(0,.245,0).addScaledVector(normal,offset);
    const o=mesh(root,'Yarn_wrap_'+group+'_'+band,new T.TorusGeometry(Math.sqrt(.225**2-offset**2),.018,8,48),thread,center.toArray());
    o.quaternion.copy(q);
  }const swatch=mesh(root,'Yarn_swatch',new T.BoxGeometry(.28,.034,.32),lav,[-.17,.024,.38]);
  const stitchgeo=new T.TorusGeometry(.018,.006,5,8,Math.PI*1.6);
  for(let x=0;
  x<7;
  x++)for(let z=0;
  z<8;
  z++){
    const o=mesh(root,'Yarn_stitch_'+x+'_'+z,stitchgeo,thread,[-.29+x*.04,.048,.24+z*.04]);
    o.rotation.x=-Math.PI/2;
  }tube(root,'Yarn_tail',[[.12,.07,.15],[.17,.03,.27],[.08,.026,.38],[-.035,.04,.37]],.012,thread);
  return res(root,{
    support:[0,0,0],tail:[-.035,.04,.37],swatch:[-.17,.04,.38]
  });
} export function createNeedles(){
  const root=new T.Group();
  root.name='Prop_knitting_needles';
  const wood=mat('#dbbb84'),lav=mat('#b89bd0');
  const shaft=new T.CylinderGeometry(.028,.028,.62,16),tip=new T.ConeGeometry(.028,.12,16),stop=new T.SphereGeometry(.047,16,10);
  for(const [side,x]of [['left',-.085],['right',.085]]){
    const group=new T.Group();
    group.name='Needle_'+side;
    group.position.x=x;
    root.add(group);
    mesh(group,'Needle_shaft_'+side,shaft,wood,[0,.37,0]);
    mesh(group,'Needle_tip_'+side,tip,wood,[0,.74,0]);
    mesh(group,'Needle_stop_'+side,stop,lav,[0,.047,0]);
  }return res(root,{
    leftGrip:[-.085,.23,0],rightGrip:[.085,.23,0],leftTip:[-.085,.8,0],rightTip:[.085,.8,0]
  });
} export function createPumpkin(){
  const root=new T.Group();
  root.name='Prop_pumpkin_lantern';
  const orange=mat('#e59a43'),green=mat('#60844a'),brown=mat('#654637');
  const g=new T.SphereGeometry(1,64,32);
  const pos=g.attributes.position;
  for(let i=0;
  i<pos.count;
  i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),a=Math.atan2(z,x),rib=1+.055*Math.cos(a*10);
    pos.setXYZ(i,x*.32*rib,.29+y*.28,z*.32*rib);
  }g.computeVertexNormals();
  mesh(root,'Pumpkin_ribbed_shell',g,orange);
  tube(root,'Pumpkin_stem',[[0,.55,0],[.012,.61,0],[.043,.635,0]],.035,green);
  const handle=new T.Group();
  handle.name='Pumpkin_handle_pivot';
  handle.position.set(0,.34,0);
  root.add(handle);
  const pts=[];
  for(let i=0;
  i<=24;
  i++){
    const a=Math.PI*i/24;
    pts.push([.35*Math.cos(a),.48*Math.sin(a),0]);
  }tube(handle,'Pumpkin_handle_arch',pts,.023,brown);
  for(const side of [-1,1])ell(root,'Pumpkin_handle_hinge_'+side,brown,[side*.335,.34,0],[.025,.05,.05]);
  for(const side of [-1,1]){
    const sh=new T.Shape();
    sh.moveTo(-.045,0);
    sh.quadraticCurveTo(-.055,.008,-.035,.04);
    sh.lineTo(0,.09);
    sh.quadraticCurveTo(.009,.10,.025,.065);
    sh.lineTo(.05,.01);
    sh.quadraticCurveTo(.05,0,.03,0);
    sh.closePath();
    mesh(root,'Pumpkin_eye_'+side,new T.ExtrudeGeometry(sh,{
      depth:.012,bevelEnabled:true,bevelSize:.006,bevelThickness:.004,bevelSegments:2
    }),brown,[side*.115,.32,.29]);
  }tube(root,'Pumpkin_smile',[[-.052,.26,.319],[-.035,.23,.327],[0,.22,.331],[.035,.23,.327],[.052,.26,.319]],.012,brown);
  return res(root,{
    support:[0,.01,0],handleGrip:[0,.82,0],handlePivot:[0,.34,0]
  });
} export function createGhost(){
  const root=new T.Group();
  root.name='Creature_ghost';
  const ivory=mat('#f5ecd8'),black=mat('#282627');
  const profile=[[0,.57],[.07,.56],[.14,.52],[.19,.45],[.21,.35],[.22,.22],[.26,.09],[.25,.055],[.22,.045],[.18,.06],[0,.09]];
  const g=new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),64);
  const pos=g.attributes.position;
  for(let i=0;
  i<pos.count;
  i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),a=Math.atan2(z,x),w=Math.max(0,1-y/.22);
    pos.setY(i,y+.025*Math.cos(a*6)*w);
  }g.computeVertexNormals();
  mesh(root,'Ghost_scalloped_body',g,ivory);
  for(const side of [-1,1])ell(root,'Ghost_eye_'+side,black,[side*.075,.36,.195],[.025,.03,.014]);
  mesh(root,'Ghost_mouth',new T.TorusGeometry(.014,.005,8,20),black,[0,.29,.217]);
  return res(root,{
    floatOrigin:[0,.28,0],hem:[0,.045,0]
  });
} export const factories={
  butterfly:createButterfly,'ground-hole':createGroundHole,'bubble-wand':createWand,'magic-hat':createHat,star:createStar,yarn:createYarn,'knitting-needle':createNeedles,'pumpkin-lantern':createPumpkin,ghost:createGhost
};
