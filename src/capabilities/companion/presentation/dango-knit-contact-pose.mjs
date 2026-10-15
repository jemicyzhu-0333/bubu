'use strict';

// PET_VISUAL「手部与动作」: frozen short wrists and round palms follow
// their own original needle shafts. The selector owns atomic pair readiness.
const KNIT_CONTACT_ID='knit-front-round-v2';
const KNIT_CONTACT_KEYS=Object.freeze({left:KNIT_CONTACT_ID+'-left',right:KNIT_CONTACT_ID+'-right'});
const HASHES=Object.freeze({left:'0f517601189a89f42e51f127a53c24202a3e22f02ba0091e0020828e1bde4924',right:'3ad50e8ceae2b854b95bfd774931605027209440ff8874997bd209626fb09d0a'});
const BODY_RECT=[-1.789744,8.533333,69.415385,49.066667];
const same=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const near=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<1e-8);
const unit=v=>Number.isFinite(v)&&v>=0&&v<=1;
const plain=o=>!o.matrix&&!o.transform&&!o.pivot&&(o.scale??1)===1&&(o.rotate??0)===0&&(o.rotation??0)===0;
const smooth=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
const knitContactSpriteKeys=()=>Object.values(KNIT_CONTACT_KEYS);
function knitSourceContactPoseEligible(manifest,pose,view,o={}){
 const a=o.action,c=pose?.contact,b=manifest?.views?.front?.body,ns=manifest?.tools?.needle;
 if(a?.id!=='knit-scarf'||a.motion!=='knit'||a.prop!=='yarn'||view!=='front'||o.state==='dragged'||o.transform||o.matrix||!unit(o.progress)||!unit(a.propOpacity??1)||(a.handoffRecovery!==undefined&&!unit(a.handoffRecovery)))return false;
 if(b?.src!=='views/front/body.png'||!same(b.rect,BODY_RECT)||!plain(b)||b.flip||ns?.src!=='tools/needle.png'||!same(ns.rect,[0,0,17,15])||!plain(ns)||ns.flip)return false;
 if(!c||!unit(c.phase)||c.layer!=='front'||c.hands?.length!==2||!Array.isArray(c.tools))return false;
 const p=c.phase,work=smooth((p-.02)/.15)*(1-smooth((p-.82)/.16)),beat=Math.sin(p*Math.PI*10)*work*3;
 const tools=c.tools.filter(t=>!t.contextAccessory),needles=tools.filter(t=>t.key==='needle'),yarn=tools.find(t=>t.key==='yarn-ball');
 if(tools.length!==3||needles.length!==2||!yarn||!near([yarn.x,yarn.y],[48,48])||!plain(yarn)||yarn.flip)return false;
 for(const [i,s]of ['left','right'].entries()){
  const n=needles[i],h=c.hands.find(h=>h.side===s),sprite=manifest.tools[KNIT_CONTACT_KEYS[s]],m=sprite?.sourceContactPose;
  if(!n||!plain(n)||Boolean(n.flip)!==Boolean(i)||!near([n.x,n.y],[i?30-beat:22+beat,41])||n.coversPaw||!unit(n.opacity??1))return false;
  if(c.hands.filter(h=>h.side===s).length!==1||!h||h.style!=='mitten'||h.layer!=='front'||!plain(h)||h.flip||h.pawSprite||h.pawMatrix||!unit(h.opacity??1)||h.points?.length!==3||!near(h.points[0],[i?58.6:7.4,39.712821])||!near(h.points[2],[n.x+(i?4.875:4.75),i?51.75:45.125]))return false;
  if(sprite?.src!==`action-contact/${KNIT_CONTACT_ID}/${s}-8x.png`||sprite.tint!=='body'||!same(sprite.rect,[0,0,72,72])||!plain(sprite)||sprite.flip||m?.id!==KNIT_CONTACT_ID||m.runtimeReady!==true||m.contractVersion!==1||m.action!=='knit-scarf'||m.view!=='front'||m.side!==s||m.sourceSha256!==HASHES[s]||m.rawSourceSha256!=='d2ed1da73fe39b3654b8adb812717ce47c5f9c5ae41cf385d1bf448e3af3496b'||m.bodySha256!=='9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9'||!same(m.bodyRect,BODY_RECT)||m.uniformSourceScale!==1/18||m.quantizedOnce!==true||m.translationOnly!==true||m.samplesPerArtUnit!==1||m.binaryAlpha!==true||m.exactNearest8x!==true||!same(m.logicalGrip,[i?42.25:26.75,45.125])||!same(m.needleLocalGrip,[4.75,4.125])||m.minimumInkCoverage!==.2||m.minimumFillCoverage!==.5||m.strokePriority!==true)return false;
 }
 return true;
}
function applyKnitSourceContactPose(manifest,pose,o={}){
 if(!knitSourceContactPoseEligible(manifest,pose,'front',o))return pose;
 const needles=pose.contact.tools.filter(t=>t.key==='needle');
 return{...pose,sourceContactPose:KNIT_CONTACT_ID,contact:{...pose.contact,hands:pose.contact.hands.map(h=>{
  const right=h.side==='right',n=needles[right?1:0],dx=n.x-(right?30:22),target=[n.x+(right?12.25:4.75),n.y+4.125];
  return{...h,pawSprite:KNIT_CONTACT_KEYS[h.side],pawMatrix:[1,0,0,1,dx,0],opacity:(h.opacity??1)*(o.action.propOpacity??1),legacyGripPoint:h.gripPoint||h.points.at(-1),gripPoint:target,sourceContact:{kind:'continuous-shaft-grip',sourcePoseId:KNIT_CONTACT_ID,needleIndex:right?1:0,needleLocalGrip:[4.75,4.125],target:[...target]},connector:false,attachedArm:false,integrated:false,limb:false,pawOcclusion:'foreground'};
 })}};
}
export{KNIT_CONTACT_ID,KNIT_CONTACT_KEYS,knitContactSpriteKeys,knitSourceContactPoseEligible,applyKnitSourceContactPose};
