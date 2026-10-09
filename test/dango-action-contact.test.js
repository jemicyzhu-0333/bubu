'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { sampleActionContact } = require('../src/core/pet-action-contact.mjs');
const { armPoses } = require('../src/core/pet-anatomy-art.mjs');
const { TOOL_SPRITES } = require('../src/content/companion/dango-tools.mjs');
const { BODY_ANCHORS, VIEW_LAYOUTS } = require('../src/content/companion/dango-body.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { drawActionOverlay, bodyOffset } = require('../src/core/pet-action-art.mjs');

const views = ['front', 'three-quarter', 'profile', 'back'];
const actions = [...Object.values(PET_ACTIONS), ...Object.values(SESSION_ACTIVITIES)];
const location = (tool, anchor) => {
  const sprite = TOOL_SPRITES[tool.key], [x,y] = sprite.anchors[anchor];
  return [tool.x + (tool.flip ? sprite.width - x : x), tool.y + y];
};

test('edited SVG is the exact deterministic source of tool runs and contact anchors', async () => {
  const { compileToolSvg, emitToolModule } = await import('../tools/dango-build/props.mjs');
  const source = fs.readFileSync('assets/companion/dango/tools/dango.tools.svg', 'utf8');
  assert.equal(emitToolModule(compileToolSvg(source)), fs.readFileSync('src/content/companion/dango-tools.mjs', 'utf8'));
  assert.throws(() => compileToolSvg(source.replace('data-width="50"', 'data-width="0"')));
});

test('contextual looking without equipment never grips invisible binoculars', () => {
  assert.deepEqual(armPoses(SESSION_ACTIVITIES['rest-window'], .5), []);
  assert.equal(armPoses(PET_ACTIONS['look-around'], .5).length, 2);
});

test('cup approaches the authored muzzle and both gripping paws follow its own anchors', () => {
  for (const view of views.slice(0, 3)) {
    const action = PET_ACTIONS['sip-tea'];
    const rest = sampleActionContact(action, 0, view), drink = sampleActionContact(action, .5, view);
    const cup = drink.tools[0], mouth = VIEW_LAYOUTS[view].mouthAnchor;
    assert.deepEqual(location(cup, 'rim'), [mouth.gridX * 2 + 7, mouth.gridY * 2 + 3]);
    assert.ok(Math.hypot(rest.tools[0].x - cup.x, rest.tools[0].y - cup.y) > 5);
    for (const hand of drink.hands) assert.deepEqual(hand.points.at(-1), location(cup, hand.side));
    assert.deepEqual(sampleActionContact(action, 1, view).tools, rest.tools, 'recovery returns the held cup');
  }
});

test('writing, browsing, chart tracing and organizing have deliberate visible hand motion', () => {
  for (const id of ['focus-write','focus-browse','focus-charts','focus-notes']) {
    for (const view of views.slice(0, 3)) {
      const locations = new Set();
      for (let i = 0; i <= 40; i++) {
        const contact = sampleActionContact(SESSION_ACTIVITIES[id], i / 40, view);
        for (const pose of contact.hands) locations.add(pose.points.at(-1).map(Math.round).join(':'));
      }
      assert.ok(locations.size > 5, `${id}/${view}: ${locations.size} distinct contact poses`);
    }
  }
});

test('tool, grip and shoulder coordinates stay finite and in stage bounds in every view', () => {
  let covered = 0;
  for (const action of actions) for (const view of views) for (let i = 0; i <= 32; i++) {
    const contact = sampleActionContact(action, i / 32, view); if (!contact) continue;
    covered++;
    for (const tool of contact.tools) {
      const sprite = TOOL_SPRITES[tool.key];
      assert.ok(tool.x >= -40 && tool.y >= -40 && tool.x + sprite.width <= 106 && tool.y + sprite.height <= 106,
        `${action.id}/${view}/${i}: tool exceeds declared stage bleed`);
    }
    for (const pose of contact.hands) {
      assert.ok(pose.points.flat().every(Number.isFinite));
      if (view !== 'back') assert.deepEqual(pose.points[0], Object.values(BODY_ANCHORS[view][`shoulder-${pose.side}`]));
      if (view === 'profile') assert.equal(pose.side, 'right');
    }
  }
  assert.ok(covered > 3000);
});

test('authored side tool views differ, and all contact details freeze in calm mode', () => {
  for (const key of ['keyboard','book','binoculars']) {
    assert.notDeepEqual(TOOL_SPRITES[`${key}-front`].runs, TOOL_SPRITES[`${key}-profile`].runs);
    assert.notDeepEqual(TOOL_SPRITES[`${key}-front`].runs, TOOL_SPRITES[`${key}-three-quarter`].runs);
  }
  for (const action of actions) for (const view of views) {
    const first = sampleActionContact(action, 0, view, { calmVisual: true });
    assert.deepEqual(sampleActionContact(action, .29, view, { calmVisual: true }), first);
    assert.deepEqual(sampleActionContact(action, .88, view, { calmVisual: true }), first);
  }
});

test('mirror is a held bounded reflection and never duplicates the main pet canvas', () => {
  const action = PET_ACTIONS['mirror-meet'];
  const contact = sampleActionContact(action, .4);
  assert.equal(contact.tools[0].key, 'mirror');
  assert.equal(contact.details.filter(d => d.type === 'reflection').length, 1);
  assert.ok(TOOL_SPRITES.mirror.width < 33 && TOOL_SPRITES.mirror.height < 33);
  assert.deepEqual(bodyOffset(action, .5), { x: 0, y: 0 });
  drawActionOverlay({ drawImage() { assert.fail('must not clone canvas'); } }, action, .5);
});


test('story observation retains a real plant across every stage and equipment fade', () => {
  const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
  for (const view of views) for (let index = 0; index <= 100; index++) {
    const sampled = sampleActivityStory(SESSION_ACTIVITIES['rest-plant'], index / 100);
    const contact = sampleActionContact(sampled.action, sampled.progress, view);
    const plant = contact.tools.find(tool => tool.key === 'plant');
    assert.ok(plant?.persistent, `${view}/${index}: the observed plant must remain present`);
    if (sampled.action.motion === 'look') assert.equal(contact.tools.some(tool => tool.key.startsWith('binoculars')), false);
  }
});

test('thinking and reading phases hold tools still; writing uses an attached pen', () => {
  for (const prop of ['keyboard','book','laptop','notes','chart']) {
    for (const view of views.slice(0, 3)) {
      const action = { id:'test-thinking', motion:'daydream', prop };
      assert.deepEqual(sampleActionContact(action,.23,view).hands, sampleActionContact(action,.69,view).hands, `${prop}/${view} should pause`);
    }
  }
  for (const prop of ['document','notes','chart']) {
    const contact = sampleActionContact({ id:'test-writing', motion:'write', prop }, .35);
    const pen = contact.tools.find(tool => tool.key === 'pen');
    assert.ok(pen, `${prop} writing must supply a real pen`);
    assert.deepEqual(contact.hands.find(hand => hand.side === 'right').points.at(-1), location(pen,'right'));
  }
});

test('carrying and cooling tea hold the cup upright until a sipping phase', () => {
  for (const motion of ['carry','breathe','daydream','organize']) {
    const action = { id:'rest-tea', motion, prop:'cup' };
    const start = sampleActionContact(action, .1), later = sampleActionContact(action, .7);
    assert.deepEqual(start.tools, later.tools);
    assert.deepEqual(start.hands, later.hands);
    assert.ok(start.tools[0].y > sampleActionContact({ ...action, motion:'sip' }, .5).tools[0].y);
  }
});

test('pixel paws reach between story tools instead of teleporting at the beat boundary', () => {
  const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
  const action = SESSION_ACTIVITIES['focus-type'];
  const before = sampleActivityStory(action, .38 - .00001), after = sampleActivityStory(action, .38);
  const left = sampleActionContact(before.action, before.progress), right = sampleActionContact(after.action, after.progress);
  for (const pose of right.hands) {
    const prior = left.hands.find(hand => hand.side === pose.side).points.at(-1);
    assert.ok(Math.hypot(...pose.points.at(-1).map((n,i)=>n-prior[i])) < .01);
  }
});

test('hiccup and sneeze impulses recover continuously without reducing their peak', () => {
  for (const id of ['hiccup','sneeze']) {
    let previous = 0, peak = 0;
    for (let i=0;i<=1200;i++) {
      const value = bodyOffset(PET_ACTIONS[id], i/1200).y;
      assert.ok(Math.abs(value-previous)<1, `${id} has a one-frame vertical snap`);
      previous=value; peak=Math.min(peak,value);
    }
    assert.ok(peak <= -5.9);
  }
});


test('entering and leaving doze approaches the five-unit body offset over 240 ms', () => {
  const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
  const { sessionBodyTranslation } = require('../src/core/pet-session-motion.mjs');
  const activity = SESSION_ACTIVITIES['rest-nap'];
  const at = ms => {
    const sampled = sampleActivityStory(activity, ms / activity.durationMs);
    return sessionBodyTranslation(sampled.action, sampled.progress);
  };
  for (const fraction of [.27,.77]) {
    const boundary = activity.durationMs * fraction;
    const before = at(boundary-.001), start = at(boundary);
    assert.ok(Math.hypot(start.x-before.x,start.y-before.y)<.001, 'no boundary teleport');
    let previous=at(boundary-100), maxStep=0;
    for(let ms=boundary-100+1000/60;ms<=boundary+600;ms+=1000/60){
      const value=at(ms);maxStep=Math.max(maxStep,Math.hypot(value.x-previous.x,value.y-previous.y));previous=value;
    }
    assert.ok(maxStep<=1.01, `60fps displacement ${maxStep} art units exceeds one pixel step`);
  }
  assert.equal(at(activity.durationMs*.27+250).y,5,'dozing still settles at the original depth');
  const sample=sampleActivityStory(activity,.3);
  assert.deepEqual(sessionBodyTranslation(sample.action,sample.progress,{calmVisual:true}),{x:0,y:0});
});
