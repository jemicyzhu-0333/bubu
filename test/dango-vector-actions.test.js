'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { sampleVectorAction } = require('../src/core/pet-action-vector.mjs');
const { resolveDangoView } = require('../src/core/dango-view-policy.mjs');
const { TOOL_SPRITES } = require('../src/content/companion/dango-tools.mjs');
const { BODY_ANCHORS, FACE_LAYOUTS } = require('../src/content/companion/dango-vector.mjs');

const sample = (id, p, view = 'auto', options = {}) => {
  const action = PET_ACTIONS[id] || SESSION_ACTIVITIES[id];
  return sampleVectorAction(action,p,resolveDangoView(view,{action}),options);
};
const grip = (tool, side) => {
  const sprite=TOOL_SPRITES[tool.key],[x,y]=sprite.anchors[side];
  return [tool.x+(tool.flip?sprite.width-x:x),tool.y+y];
};

test('carried energy retains both source-authored supporting paws throughout front and side turns', () => {
  for (const view of ['front','three-quarter','profile']) for(let i=0;i<=120;i++) {
    const pose=sample('carry-energy',i/120,view),tool=pose.tools.find(t=>t.key==='energy');
    assert.equal(pose.hands.length,2);
    for(const hand of pose.hands)assert.deepEqual(hand.points.at(-1),grip(tool,hand.side));
    assert.ok(pose.hands[0].points.at(-1)[0] < pose.hands[1].points.at(-1)[0]);
  }
});

test('native contact forearms remain compact and start from the native shoulders', () => {
  for(const action of [...Object.values(PET_ACTIONS),...Object.values(SESSION_ACTIVITIES)]) {
    for(const requested of ['front','three-quarter','profile','back'])for(let i=0;i<=30;i++){
      const view=resolveDangoView(requested,{action}),p=i/30;
      const sampled=sampleActivityStory(action,p),pose=sampleVectorAction(sampled.action,sampled.progress,view);
      for(const hand of pose.hands){
        const [root,elbow,palm]=hand.points;
        assert.deepEqual(root,Object.values(BODY_ANCHORS[view][`shoulder-${hand.side}`]));
        assert.ok(Math.hypot(elbow[0]-palm[0],elbow[1]-palm[1])<=7.51,`${action.id}/${view}: overlong forearm`);
        assert.ok(hand.points.flat().every(Number.isFinite));
      }
    }
  }
});

test('digging grips a real shovel, reveals the chest, and recovers without phantom rods', () => {
  const work=sample('dig-treasure',.315),recover=sample('dig-treasure',.85);
  assert.ok(work.tools.some(t=>t.key==='shovel'));assert.equal(work.hands.length,2);
  assert.equal(recover.tools.some(t=>t.key==='shovel'),false);
  assert.equal(recover.hands.length,0);assert.ok(recover.tools.some(t=>t.key==='treasure-chest'));
});

test('plane is held before release and flies independently while the paw recovers', () => {
  const held=sample('paper-plane',.15),flight=sample('paper-plane',.643);
  assert.deepEqual(held.hands[0].points.at(-1),grip(held.tools[0],'right'));
  assert.ok(flight.tools[0].x > held.tools[0].x+10);
  assert.deepEqual(flight.hands[0].points.at(-1),[62,43]);
});

test('native tea uses its true mouth anchor and visible steam; tiny tail and ground dust stay bounded', () => {
  for(const view of ['front','three-quarter']){
    const pose=sample('sip-tea',.5,view),cup=pose.tools[0],mouth=FACE_LAYOUTS[view].mouth;
    assert.deepEqual(grip(cup,'rim'),[mouth.x,mouth.y]);
    assert.ok(pose.details.some(d=>d.type==='steam'));
  }
  const tail=sample('tail-wiggle',.855).tools.find(t=>t.key==='tail');
  assert.ok(TOOL_SPRITES.tail.width*tail.scale<9);
  assert.ok(sample('chase-butterfly',.4).details.some(d=>d.type==='run-dust'&&d.layer==='back'));
  assert.ok(sample('tail-wiggle',.855).details.some(d=>d.type==='look-back'));
  assert.ok(sample('tiny-chef',.338).details.some(d=>d.type==='steam'));
  assert.ok(sample('sweep',.4).details.some(d=>d.type==='soil'));
  assert.ok(sample('pit-fall',.4).details.some(d=>d.type==='soil'&&d.layer==='back'));
  const {bodyOffset}=require('../src/core/pet-action-art.mjs');
  const hole=sample('pit-fall',.4).details.find(d=>d.type==='hole');
  assert.equal(hole.at[1]+bodyOffset(PET_ACTIONS['pit-fall'],.4).y,63);
  assert.equal(sample('pit-fall',.4,'auto',{calmVisual:true}).details.find(d=>d.type==='hole').at[1],63);
});

test('every referenced native tool is editable raw SVG geometry and calm sampling is fixed', () => {
  for(const action of [...Object.values(PET_ACTIONS),...Object.values(SESSION_ACTIVITIES)]){
    const view=resolveDangoView('auto',{action}),first=sampleVectorAction(action,0,view,{calmVisual:true});
    assert.deepEqual(sampleVectorAction(action,.8,view,{calmVisual:true}),first);
    for(let i=0;i<=20;i++)for(const tool of sampleVectorAction(action,i/20,view).tools){
      assert.ok(TOOL_SPRITES[tool.key].paths.length,`${action.id}/${tool.key}`);
    }
  }
});

test('sleeping holds the actual pillow and picnic retains a mat under the body', () => {
  const action=SESSION_ACTIVITIES['rest-nap'],sampled=sampleActivityStory(action,.5);
  const pose=sampleVectorAction(sampled.action,sampled.progress,'front');
  const pillow=pose.tools.find(t=>t.key==='pillow');assert.ok(pillow.persistent);
  for(const hand of pose.hands)assert.deepEqual(hand.points.at(-1),grip(pillow,hand.side));
  assert.ok(sample('snack-picnic',.4).tools.some(t=>t.key==='picnic-mat'&&t.layer==='back'));
});

test('story paws withdraw continuously when a following phase has no hands', () => {
  const action=SESSION_ACTIVITIES['rest-stretch'],boundary=.43;
  const at=p=>{const a=sampleActivityStory(action,p);return sampleVectorAction(a.action,a.progress,'front');};
  const before=at(boundary-1e-8),after=at(boundary);
  assert.equal(before.hands.length,2);assert.equal(after.hands.length,2);
  for(const hand of after.hands){
    const prior=before.hands.find(h=>h.side===hand.side).points.at(-1);
    assert.ok(Math.hypot(...hand.points.at(-1).map((n,i)=>n-prior[i]))<.001);
  }
  assert.equal(at(boundary+100/action.durationMs).hands.length,2);
  assert.equal(at(boundary+250/action.durationMs).hands.length,0);
});
