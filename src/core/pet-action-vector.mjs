import { TOOL_SPRITES } from '../content/companion/dango-tools.mjs';
import { BODY_ANCHORS, FACE_LAYOUTS } from '../content/companion/dango-vector.mjs';
import { COMPANION_ACTIVITY_STORIES } from '../content/companion/activity-stories.mjs';
import { sampleActionContact } from './pet-action-contact.mjs';
import { sampleFreeVectorAction } from './pet-action-vector-poses.mjs';
import { drawVectorActionDetails } from './pet-action-vector-details.mjs';
import { paintVectorShapes } from './pet-vector-paint.mjs';

const PAW = Object.freeze([
  { d:'M-4.2 .5C-4.5 -2.3 -2.2 -4 0 -3.8C2.8 -4 4.6 -1.8 4.2 .7C4 3.1 2.2 4.3 -.2 4C-2.8 4.1 -4 2.7 -4.2 .5Z', fillToken:'body', strokeToken:'ink', width: .85, material:'paw' },
  { d:'M-2.5 -1.5Q-1.2 -2.8 .8 -2.2', strokeToken:'highlight', width: .7, opacity:.6 },
  { d:'M-2 2.1Q.2 3 2.2 1.9', strokeToken:'shadow', width: .65, opacity:.35 }
]);
const MATERIALS = Object.freeze({ paw:{type:'radial',coords:[-1,-2,0,0,0,5],stops:[
  {offset:0,color:{from:'body',to:'white',amount:.18}}, {offset:.7,color:'body'}, {offset:1,color:'shadow'}
]}});

function sampleVectorAction(action, progress, view = 'front', options = {}) {
  if (!action) return null;
  const v = view === 'profile' ? 'three-quarter' : view;
  const anchors = options.anchors || BODY_ANCHORS[v] || BODY_ANCHORS.front;
  const muzzle = options.muzzle || FACE_LAYOUTS[v]?.mouth || FACE_LAYOUTS.front.mouth;
  const p = options.calmVisual ? action.staticProgress ?? .5 : Math.max(0, Math.min(1, Number(progress) || 0));
  const contact = sampleActionContact(action, p, v, { ...options, soft:true, anchors, muzzle, skipStoryBlend:true })
    || sampleFreeVectorAction(action, p, v, anchors, options);
  blendVectorStoryHands(contact, action, v, options);
  return contact;
}

function blendVectorStoryHands(contact, action, view, options) {
  const phase = action.sequencePhase, timeline = COMPANION_ACTIVITY_STORIES[action.id];
  if (!phase?.index || !timeline || options.calmVisual) return;
  const stage=timeline.stages[phase.index], previous=timeline.stages[phase.index-1];
  const elapsed=phase.progress*(stage.until-previous.until)*(action.durationMs||action.duration||30000);
  const t=Math.min(1,elapsed/240), amount=t*t*(3-2*t);if(amount>=1)return;
  const before=sampleVectorAction({...action,motion:previous.motion,prop:previous.prop,sequencePhase:null},1,view,options);
  const mix=(a,b)=>a.map((n,i)=>n+(b[i]-n)*amount);
  for(const hand of contact.hands){
    const prior=before.hands.find(pose=>pose.side===hand.side);
    hand.points=hand.points.map((xy,i)=>mix(prior?.points[i]||hand.points[0],xy));
    if(!prior)hand.opacity=amount;
  }
  for(const prior of before.hands){
    if(contact.hands.some(hand=>hand.side===prior.side))continue;
    contact.hands.push({...prior,points:prior.points.map(xy=>mix(xy,prior.points[0])),opacity:1-amount});
  }
}

function paintTool(context, item, palette) {
  const sprite = TOOL_SPRITES[item.key];
  if (!sprite?.paths) throw new TypeError(`missing native tool paths: ${item.key}`);
  context.save();context.translate(item.x, item.y);
  if (item.scale) context.scale(item.scale,item.scale);
  if (item.pivot) { context.translate(...item.pivot);context.rotate(item.rotate || 0);context.translate(-item.pivot[0],-item.pivot[1]); }
  if (item.flip) { context.translate(sprite.width,0);context.scale(-1,1); }
  if (Number.isFinite(item.opacity)) context.globalAlpha *= item.opacity;
  const shapes = item.bodyColor ? sprite.paths.map(shape => ({ ...shape,
    ...(shape.fill === '#f7768e' ? {fillToken:'body'} : {}),
    ...(shape.stroke === '#ff9dae' ? {strokeToken:'highlight'} : {}) }))
    : item.tint ? sprite.paths.map(shape => ({...shape,...(shape.fill==='#a7cddd'?{fill:item.tint}:{})})) : sprite.paths;
  const count = paintVectorShapes(context, shapes, palette);
  context.restore();return count;
}

function paintPaw(context, pose, palette) {
  context.save();
  if(Number.isFinite(pose.opacity))context.globalAlpha*=pose.opacity;
  const [x,y] = pose.points.at(-1), [sx,sy] = pose.points.at(-2);
  // Only the short curved forearm emerges from the round torso. The torso
  // occludes the upper arm, so no dark shoulder strap crosses the belly.
  const sleeve = [{ d:`M${sx} ${sy}Q${sx} ${y+2} ${x} ${y}`,strokeToken:'body',width:4.3 }];
  paintVectorShapes(context,sleeve,palette);
  context.save();context.translate(x,y);
  if (pose.integrated) {
    // The tiny closed paw sits across the lower flank's silhouette. An open
    // U-shaped stroke inside the cheek would be mistaken for a second smile.
    paintVectorShapes(context,[
      {d:'M-2.7 -.8C-2.8 -2.5 -.4 -3 1.7 -1.8C3.4 -.2 2.7 2.4 .6 2.8C-1.4 3.2 -3 1.2 -2.7 -.8Z',
        fillToken:'body',strokeToken:'ink',width:.8,material:'paw'}
    ],palette,{materials:MATERIALS});
  } else paintVectorShapes(context,PAW,palette,{materials:MATERIALS});
  context.restore();
  context.restore();
}

function drawVectorAction(context, { action, progress = 0, palette, view = 'front', layer = 'front', calmVisual = false, artwork = null } = {}) {
  const contact = sampleVectorAction(action, progress, view, { calmVisual, anchors:artwork?.anchors, muzzle:artwork?.muzzle });
  if (!contact) return false;
  const tools = contact.tools.filter(item => (item.layer || contact.layer) === layer);
  context.save();
  for (const item of tools.filter(item => item.persistent)) paintTool(context,item,palette);
  context.globalAlpha *= Number.isFinite(action.propOpacity) ? action.propOpacity : 1;
  for (const item of tools.filter(item => !item.persistent)) paintTool(context,item,palette);
  drawVectorActionDetails(context,contact,palette,layer);
  context.restore();
  const covered = new Set(tools.map(item => item.coversPaw).filter(Boolean));
  for (const pose of contact.hands) if (pose.layer === layer && !covered.has(pose.side)) paintPaw(context,pose,palette);
  return tools.length > 0 || contact.hands.some(pose => pose.layer === layer) || contact.details.some(detail => (detail.layer || 'front') === layer);
}

export { sampleVectorAction, drawVectorAction };
