'use strict';
// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: one authored quarter hold
// group. Far pixels are the source-visible contour only, with its unobserved
// upper/back anatomy absent; the unchanged cup/handle occludes them.
const QUARTER_HICCUP_CONTACT_ID='hiccup-quarter-pair-v1';
const KEYS=Object.freeze({left:'hiccup-quarter-near-v1',right:'hiccup-quarter-far-v1'});
const BODY_HASH='8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450';
const BODY_RECT=Object.freeze([-2.117949,8.533333,70.4,49.066667]);
const HASHES=Object.freeze({left:'0461dcbfafcc6e865e8934c41165b9c0d8650213cd50df468d0303915f390e33',right:'9ff52618fb087e3c00825e4238da2560eee323dfbe5235a5e4079f05b4e29444'});
const same=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((n,i)=>n===b[i]);
const quarterHiccupContactSpriteKeys=()=>Object.values(KEYS);
function quarterHiccupSourceContactPoseEligible(manifest,pose,view,options={}){
 const a=options.action;if(a?.id!=='hiccup'||a.motion!=='hiccup'||a.prop!=='cup'||view!=='three-quarter'||options.state==='dragged'||options.transform||options.matrix)return false;
 const body=manifest.views?.['three-quarter']?.body;if(body?.src!=='views/three-quarter-right/body.png'||!same(body.rect,BODY_RECT))return false;
 const cup=pose.contact?.tools?.find(t=>t.key==='cup');if(!cup||cup.x!==34||cup.y!==38||!same(manifest.tools?.cup?.rect,[0,0,22,19])||(cup.scale??1)!==1||(cup.rotate??0)!==0||cup.flip||cup.pivot||cup.matrix)return false;
 const hands=pose.contact?.hands||[];if(hands.length!==2)return false;
 return ['left','right'].every(side=>{const near=side==='left',h=hands.find(h=>h.side===side),s=manifest.tools?.[KEYS[side]],c=s?.sourceContactPose;
  return hands.filter(h=>h.side===side).length===1&&same(h?.gripPoint,[near?34.875:54.5,48.375])&&h.layer==='front'&&!h.integrated
   &&s?.src===`action-contact/hiccup-quarter-pair-v1/${near?'near':'far'}-8x.png`&&s.tint==='body'&&same(s.rect,[0,0,66,72])
   &&c?.id===QUARTER_HICCUP_CONTACT_ID&&c.contractVersion===1&&c.runtimeReady===true&&c.action==='hiccup'&&c.view==='three-quarter'&&c.side===side
   &&c.sourceSha256===HASHES[side]&&c.bodySha256===BODY_HASH&&same(c.bodyRect,BODY_RECT)&&same(c.contact,[near?34.875:54.5,48.375])
   &&c.layer===(near?'front':'before-tools')&&c.translationOnly===true&&c.quantizedOnce===true&&c.samplesPerArtUnit===1;
 });
}
function applyQuarterHiccupSourceContactPose(manifest,pose){return {...pose,sourceContactPose:QUARTER_HICCUP_CONTACT_ID,contact:{...pose.contact,hands:pose.contact.hands.map(h=>({...h,pawSprite:KEYS[h.side],pawMatrix:[1,0,0,1,0,0],sourceContact:{kind:'continuous-hold',sourcePoseId:QUARTER_HICCUP_CONTACT_ID,target:[...h.gripPoint],visibleFarOnly:h.side==='right'},connector:false,attachedArm:false,integrated:false,limb:false,pawOcclusion:h.side==='right'?'behind-tool':'foreground'}))}};}
export {QUARTER_HICCUP_CONTACT_ID,quarterHiccupContactSpriteKeys,quarterHiccupSourceContactPoseEligible,applyQuarterHiccupSourceContactPose};
