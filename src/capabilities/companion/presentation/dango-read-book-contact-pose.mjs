'use strict';

// PET_VISUAL「手部与动作」: two original round palm sources use the
// reviewed 0.5-art exception. Complete source-owned roots stay behind the body.
// The existing source selector owns atomic readiness for all four resources.
import { READ_BOOK_SPRITES } from './read-book-contact-sprites.mjs';
import { SOURCE_GRIPS, PAGE_SOURCE_CONTACT, sampleReadBookTargets } from './read-book-targets.mjs';

const READ_BOOK_CONTACT_ID = 'read-book-front-halfgrid-v1';
const READ_BOOK_CONTACT_KEYS = Object.freeze(Object.fromEntries(['left','right'].map(side =>
  [side,Object.freeze({front:`${READ_BOOK_CONTACT_ID}-${side}-front`,root:`${READ_BOOK_CONTACT_ID}-${side}-root`})])));
const BODY_RECT = [-1.789744,8.533333,69.415385,49.066667];
const same = (a,b) => Array.isArray(a) && a.length === b.length && a.every((v,i) => v === b[i]);
const near = (a,b) => Array.isArray(a) && a.length === b.length && a.every((v,i) => Number.isFinite(v) && Math.abs(v-b[i]) < 1e-8);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const smooth=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
const plain = value => value && !value.matrix && !value.transform && !value.flip && !value.pivot
  && (value.scale ?? 1) === 1 && (value.rotate ?? 0) === 0 && (value.rotation ?? 0) === 0;
function exact(actual,expected) {
  if(expected === null || typeof expected !== 'object')return actual === expected;
  if(Array.isArray(expected))return same(actual,expected);
  return actual && Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every(key => exact(actual[key],expected[key]));
}
const readBookContactSpriteKeys = () => Object.values(READ_BOOK_CONTACT_KEYS).flatMap(keys => [keys.front,keys.root]);

function readBookSourceContactPoseEligible(manifest,pose,view,o={}) {
  const action=o.action,contact=pose?.contact,body=manifest.views?.front?.body;
  if(action?.id !== 'read-book' || action.motion !== 'read' || action.prop !== 'book' || view !== 'front'
    || o.state === 'dragged' || o.transform || o.matrix || !unit(o.progress)
    || action.handoffRecovery !== undefined || (action.propOpacity ?? 1) !== 1)return false;
  if(body?.src !== 'views/front/body.png' || !same(body.rect,BODY_RECT) || body.tint !== 'body' || !plain(body))return false;
  const book=manifest.tools?.['book-front'],page=manifest.effects?.page;
  if(book?.src !== 'tools/book-front.png' || !same(book.rect,[0,0,48,20]) || !plain(book)
    || !same(book.anchors?.left,[6.875,12.5]) || !same(book.anchors?.right,[41,12.5]) || !same(book.anchors?.page,[23.875,5.625])
    || page?.src !== 'effects/page.png' || !same(page.rect,[-4.5,-6,9,12]) || !same(page.pivot,[0,0]) || !plain({...page,pivot:undefined}))return false;
  if(!contact || !unit(contact.phase) || contact.layer !== 'front' || contact.hands?.length !== 2
    || !Array.isArray(contact.tools) || contact.details?.length !== 1)return false;
  const expectedTurn=smooth((contact.phase-.22)/.16)*(1-smooth((contact.phase-.56)/.16));
  const originalTools=contact.tools.filter(tool => !tool.contextAccessory),tool=originalTools[0],detail=contact.details[0];
  if(originalTools.length !== 1 || tool.key !== 'book-front' || !near([tool.x,tool.y],[9,46])
    || !plain(tool) || tool.coversPaw || (tool.opacity ?? 1) !== 1)return false;
  if(detail.type !== 'page' || !near(detail.at,[32.875,51.625]) || detail.width !== 19
    || !unit(detail.amount) || Math.abs(detail.amount-expectedTurn)>1e-8 || (detail.opacity ?? 1) !== 1 || detail.layer && detail.layer !== 'front')return false;
  for(const side of ['left','right']) {
    const hand=contact.hands.find(value => value.side === side);
    if(contact.hands.filter(value => value.side === side).length !== 1 || !plain(hand)
      || hand.style !== 'mitten' || hand.layer !== 'front' || hand.pawSprite || hand.pawMatrix
      || (hand.opacity ?? 1) !== 1 || hand.points?.length !== 3
      || !near(hand.points[0],[side === 'left' ? 7.4 : 58.6,39.712821]))return false;
    for(const key of Object.values(READ_BOOK_CONTACT_KEYS[side])) {
      const sprite=manifest.tools?.[key],expected=READ_BOOK_SPRITES[key];
      if(!sprite || sprite.src !== expected.src || sprite.tint !== 'body' || !same(sprite.rect,expected.rect)
        || !plain(sprite) || !exact(sprite.sourceContactPose,expected.sourceContactPose))return false;
    }
  }
  return true;
}

function applyReadBookSourceContactPose(manifest,pose,o={}) {
  if(!readBookSourceContactPoseEligible(manifest,pose,'front',o))return pose;
  const p=o.calmVisual || o.reducedMotion ? o.action.staticProgress ?? .5 : o.progress;
  const targets=sampleReadBookTargets(pose.contact,p);
  const rootTools=['left','right'].map(side => {
    const delta=targets[side].map((v,i) => v-SOURCE_GRIPS[side][i]);
    return {key:READ_BOOK_CONTACT_KEYS[side].root,x:delta[0],y:delta[1],layer:'back',sourceHandRoot:true};
  });
  return {...pose,sourceContactPose:READ_BOOK_CONTACT_ID,contact:{...pose.contact,
    tools:[...pose.contact.tools,...rootTools],hands:pose.contact.hands.map(hand => {
      const target=targets[hand.side],delta=target.map((v,i) => v-SOURCE_GRIPS[hand.side][i]);
      return {...hand,pawSprite:READ_BOOK_CONTACT_KEYS[hand.side].front,pawMatrix:[1,0,0,1,...delta],
        legacyGripPoint:hand.gripPoint || hand.points.at(-1),gripPoint:[...target],
        sourceContact:{kind:hand.side === 'left' ? 'book-edge' : targets.rightRole,target:[...target],
          sourcePoseId:READ_BOOK_CONTACT_ID,pageVisible:targets.pageVisible,
          pageSourcePoint:hand.side === 'right' ? [...PAGE_SOURCE_CONTACT] : null},
        connector:false,attachedArm:false,integrated:false,limb:false,pawOcclusion:'foreground'};
    })}};
}
export { READ_BOOK_CONTACT_ID, READ_BOOK_CONTACT_KEYS, readBookContactSpriteKeys,
  readBookSourceContactPoseEligible, applyReadBookSourceContactPose };
