'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FOOD_IDS, PET_STATES } = require('../src/platform/persistence/persisted-schema');
const { adaptLegacyPetContent, KNOWN_ANIMATIONS } = require('../src/core/content-pack');
const {
  LINES,
  SCENE_DECORATIONS,
  SCENES,
  SCENE_SCHEDULE,
  SCENE_MANUAL_SCHEDULE,
  SCENE_STATS,
  STATE_SCENES,
  SKIN_SCENES,
  EASTER_EGGS,
  PET_ACTIONS,
  BEHAVIOR_STATS,
  INTERACTIONS,
  INTERACTION_STATS,
  SESSION_ACTIVITIES,
  SESSION_ACTIVITY_ROTATIONS,
  SESSION_ACTIVITY_STATS,
  FOODS,
  PET_APPEARANCE_ITEMS,
  DIALOGUE_STATS,
  dialogueStats,
  getContextualLine,
  getTimePeriod
} = require('../src/pet-content');

// 渲染器契约读整个 surface 目录。之前这份清单被逐字抄在六个测试里：删掉一个模块
// 会让六处同时 ENOENT，新增一个模块则静默漏检。读目录让清单不可能再过期。
const PET_SURFACE_DIR = path.join(__dirname, '../src/surfaces/pet');
const petRendererSource = fs.readdirSync(PET_SURFACE_DIR).filter(file => file.endsWith('.mjs'))
  .map(file => fs.readFileSync(path.join(PET_SURFACE_DIR, file), 'utf8')).join('\n');

// 台词的质量门槛，不是数量门槛。以前这里要求总数 >= 2000、每个池 >= 100 条，结果是靠“开头 × 主句 × 结尾”
// 三段相乘凑数，实际听到的九成以上都是两个分句的散文。现在的规矩是：每一句都是手写的短话。
const REGULAR_POOL_GROUPS = ['time', 'state', 'energy', 'work', 'peek'];
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

function regularPools() {
  const pools = [];
  for (const group of REGULAR_POOL_GROUPS) {
    const value = LINES[group];
    if (Array.isArray(value)) pools.push([group, value]);
    else for (const [id, lines] of Object.entries(value)) pools.push([`${group}.${id}`, lines]);
  }
  return pools;
}

test('dialogue is short hand-written lines: enough variety per pool, one clause, no emoji, no composition', () => {
  const stats = dialogueStats();
  assert.equal(stats.total, DIALOGUE_STATS.total);
  assert.ok(stats.total >= 600, `the library should not be emptied out, got ${stats.total}`);
  assert.equal(stats.unique, stats.total, 'no duplicated lines across pools');
  assert.equal(LINES.streak, undefined, 'there is no consecutive-day counter to celebrate any more');
  assert.ok(Object.keys(LINES.special).length >= 25, 'special moments need broad calendar/time coverage');
  assert.ok(Object.keys(LINES.work).length >= 12, 'work dialogue must cover more than start/end/overtime');

  for (const [name, lines] of regularPools()) {
    assert.ok(lines.length >= 8, `${name} has ${lines.length} lines; a pool under 8 repeats within minutes`);
    for (const line of lines) {
      assert.ok([...line].length <= 20, `${name}: “${line}” is longer than 20 characters`);
      assert.ok((line.match(/[，；：]/g) || []).length <= 1, `${name}: “${line}” strings clauses together`);
      assert.ok(!PICTOGRAPH.test(line), `${name}: “${line}” contains an emoji`);
      assert.ok(!/加油|必须要|一定要|应该要/.test(line), `${name}: “${line}” pushes instead of accompanying`);
    }
  }
  for (const group of ['special']) {
    for (const [id, lines] of Object.entries(LINES[group])) {
      for (const line of lines) assert.ok(!PICTOGRAPH.test(line), `${group}.${id}: “${line}” contains an emoji`);
    }
  }
});

test('contextual dialogue avoids immediate repeats inside the same pool', () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99;
    const lines = Array.from({ length: 12 }, () => getContextualLine({
      hour: 15, state: 'talking', energyLevel: 50, workStart: 9, workEnd: 18
    }));
    assert.equal(new Set(lines).size, lines.length);
  } finally {
    Math.random = originalRandom;
  }
});

test('pet content covers every validated state and food identifier', () => {
  assert.deepEqual(Object.keys(FOODS).sort(), [...FOOD_IDS].sort());
  for (const state of PET_STATES) {
    assert.ok(Array.isArray(LINES.state[state]), `missing dialogue pool for ${state}`);
    assert.ok(LINES.state[state].length > 0, `empty dialogue pool for ${state}`);
    assert.ok(LINES.state[state].every(line => typeof line === 'string' && line.trim()), `invalid dialogue for ${state}`);
  }
  for (const food of Object.values(FOODS)) {
    assert.ok(Number.isFinite(food.satiation) && food.satiation >= 0);
    assert.equal(Object.prototype.hasOwnProperty.call(food, 'xp'), false,
      'feeding must not smuggle XP rewards through content');
    assert.ok(Array.isArray(food.reactions) && food.reactions.length > 0);
  }
});

test('pet appearance content has bounded slots and milestone thresholds', () => {
  assert.ok(Array.isArray(PET_APPEARANCE_ITEMS));
  assert.ok(PET_APPEARANCE_ITEMS.length >= 12);
  assert.equal(new Set(PET_APPEARANCE_ITEMS.map(item => item.id)).size, PET_APPEARANCE_ITEMS.length);
  assert.ok(PET_APPEARANCE_ITEMS.every(item => ['back', 'front'].includes(item.layer)));
  assert.ok(PET_APPEARANCE_ITEMS.some(item => item.id === 'milestone.sprout' && item.minLevel === 3));
  assert.ok(PET_APPEARANCE_ITEMS.some(item => item.id === 'milestone.satchel' && item.minLevel === 8));
  assert.ok(PET_APPEARANCE_ITEMS.some(item => item.id === 'milestone.halo' && item.minLevel === 12));
});

test('the food catalog stays complete and no food can ever be rejected or lost', () => {
  assert.equal(Object.keys(FOODS).length, 11, 'the catalog is ten inventory foods plus basic; keep FOOD_IDS in step');
  for (const [id, food] of Object.entries(FOODS)) {
    assert.equal(food.id, id, `${id} must key on its own identifier`);
    assert.equal(food.rejectChance, 0, `${id} must never introduce random rejection or loss aversion`);
    assert.ok(typeof food.name === 'string' && food.name.trim(), `${id} needs a display name`);
    assert.ok(typeof food.emoji === 'string' && food.emoji.trim(), `${id} needs an emoji for the affinity list`);
    assert.ok(typeof food.animation === 'string' && food.animation.trim(), `${id} needs a feeding animation`);
  }
  assert.equal('FOOD_REGEN_DAILY' in require('../src/pet-content'), false,
    'daily inventory distribution is replaced by explicit ticket purchases');
});

test('contextual dialogue remains total across every state and energy boundary', () => {
  const originalRandom = Math.random;
  try {
    for (const roll of [0, 0.13, 0.2, 0.3, 0.39, 0.99]) {
      Math.random = () => roll;
      for (const state of PET_STATES) {
        for (const energyLevel of [0, 14, 15, 34, 35, 59, 60, 79, 80, 100]) {
          const line = getContextualLine({
            hour: 16,
            state,
            energyLevel,
            hoursIdle: 1,
            workStart: 9,
            workEnd: 18
          });
          assert.equal(typeof line, 'string');
          assert.ok(line.trim());
        }
      }
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('time periods honor configurable work boundaries including midnight', () => {
  assert.equal(getTimePeriod(4, 9, 18), 'lateNight');
  assert.equal(getTimePeriod(8, 9, 18), 'morning');
  assert.equal(getTimePeriod(9, 9, 18), 'forenoon');
  assert.equal(getTimePeriod(23, 10, 24), 'evening');
  assert.equal(getTimePeriod(24, 10, 24), 'evening');
});

test('pet reward metadata agrees with the main-process daily reward contract', () => {
  assert.equal(INTERACTIONS.clickCount[50].xp || 0, 0);
  assert.doesNotMatch(INTERACTIONS.clickCount[50].text, /\+\s*50\s*XP/i);
  assert.ok(Object.values(FOODS).every(food => food.rejectChance === 0));
  assert.equal(FOODS.coffee.bonus, undefined);
  assert.ok(Array.isArray(EASTER_EGGS) && EASTER_EGGS.length > 0);
  assert.ok(Object.keys(SCENE_DECORATIONS).length > 0);
  assert.ok(Object.keys(STATE_SCENES).length > 0);
  assert.ok(Object.keys(SKIN_SCENES).length > 0);
});

test('every long-lived easter egg has a paired pet action and dialogue set', () => {
  assert.ok(BEHAVIOR_STATS.actionCount >= 40);
  assert.ok(BEHAVIOR_STATS.minimumDurationMs >= 6_000);
  assert.equal(EASTER_EGGS.length, Object.keys(PET_ACTIONS).length);
  for (const egg of EASTER_EGGS) {
    const action = PET_ACTIONS[egg.id];
    assert.ok(action, `${egg.id} needs a paired action`);
    assert.ok(action.lines.length >= 3, `${egg.id} needs paired dialogue variants`);
    assert.equal(action.duration, egg.duration);
    assert.ok(KNOWN_ANIMATIONS.has(egg.id), `${egg.id} must be accepted by the manifest`);
  }
});

test('interaction registry keeps click combos while the primary command menu stays focused', () => {
  assert.ok(INTERACTION_STATS.milestoneCount >= 10);
  assert.equal(INTERACTION_STATS.commandCount, 5);
  assert.ok(Object.values(INTERACTIONS.clickCount).every(item => PET_ACTIONS[item.action]));
  assert.equal(INTERACTIONS.longPress.duration >= 6_000, true);
  assert.equal(INTERACTIONS.clickCount[5].action, 'high-five');
  assert.deepEqual(
    [PET_ACTIONS['high-five'].motion, PET_ACTIONS['high-five'].prop],
    ['high-five', 'high-five']
  );
  assert.deepEqual([PET_ACTIONS.dance.motion, PET_ACTIONS.dance.prop], ['dance', 'music-notes']);
  assert.deepEqual(INTERACTIONS.commands.map(item => item.id), ['focus', 'impulse', 'panel', 'dnd', 'hide']);
  const markup = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet.html'), 'utf8');
  const renderedCommands = [...markup.matchAll(/class="command-item[^"]*"[^>]*data-act="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(renderedCommands, INTERACTIONS.commands.map(item => item.id));
});

test('scene registry provides at least twenty reachable backgrounds with layered particles', () => {
  assert.ok(SCENE_STATS.sceneCount >= 20);
  assert.equal(SCENE_STATS.sceneCount, Object.keys(SCENES).length);
  const reachable = new Set(Object.values(SCENE_MANUAL_SCHEDULE).flat());
  assert.deepEqual([...reachable].filter(id => !SCENES[id]), []);
  assert.ok(Object.keys(SCENES).every(id => reachable.has(id)), 'every scene must appear in the manual rotation');
  assert.ok(Object.values(SCENE_SCHEDULE).every(ids => !ids.includes('summer-storm')),
    'lightning must never appear in the automatic schedule');
  assert.ok(Object.values(SCENE_MANUAL_SCHEDULE).some(ids => ids.includes('summer-storm')),
    'the storm scene remains available after an explicit scene change');
  assert.ok(Object.values(SCENES).every(scene => scene.emitters.length >= 2));
  assert.ok(new Set(Object.values(SCENES).flatMap(scene => scene.emitters.map(item => item.type))).size >= 15,
    'particles should have meaningful visual variety');
});

test('focus and rest each provide a complete, state-specific activity rotation', () => {
  assert.equal(SESSION_ACTIVITY_STATS.focusCount, 6);
  assert.equal(SESSION_ACTIVITY_STATS.restCount, 6);
  assert.equal(SESSION_ACTIVITY_STATS.totalCount, 12);
  for (const state of ['focused', 'resting']) {
    for (const id of SESSION_ACTIVITY_ROTATIONS[state]) {
      const activity = SESSION_ACTIVITIES[id];
      assert.equal(activity.state, state);
      assert.ok(activity.durationMs >= 20_000);
      assert.ok(activity.label && activity.motion && activity.prop);
    }
  }
  assert.deepEqual(
    SESSION_ACTIVITY_ROTATIONS.focused.map(id => SESSION_ACTIVITIES[id].label),
    ['写文档', '打字', '读书', '浏览网页', '整理便签', '看行情']
  );
  assert.deepEqual(
    SESSION_ACTIVITY_ROTATIONS.resting.map(id => SESSION_ACTIVITIES[id].label),
    ['放空发呆', '慢慢喝茶', '看看窗外', '打个小盹', '伸展一下', '照料小苗']
  );
});

test('pet scene is feathered into the desktop and docking removes the ambient chrome', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet.html'), 'utf8');
  assert.match(markup, /class="scene-frame"[^>]*><canvas id="sceneCanvas"/);
  assert.match(markup, /\.scene-frame\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(markup, /\.scene-frame\s*\{[\s\S]*?background:\s*rgba\(/i);
  assert.match(markup, /\.scene-frame\s*\{[\s\S]*?border:\s*0/);
  assert.match(markup, /\.scene-frame\s*\{[\s\S]*?-webkit-mask-image:\s*radial-gradient/);
  assert.match(markup, /\.stage\.is-docked \.scene-frame,[\s\S]*?visibility:\s*hidden/);
  assert.match(markup, /#petCanvas\s*\{[^}]*?pointer-events:\s*none/);
  // 宠物的交互足迹仍是 105×105，与 main.js 的 PET_VISUAL_SIZE 和吸附计算同一口径；
  // 画布为了容纳四肢与道具已扩容，它的几何契约由 pet-stage.test.js 守。
  assert.match(markup, /\.pet-hit\s*\{[^}]*?width:\s*105px;\s*height:\s*105px/);
  assert.match(markup, /class="activity-bar"/);
  assert.doesNotMatch(markup, /data-stimulation="low"\]\s+#sceneCanvas\s*\{\s*visibility:\s*hidden/);
});

test('coffee is ordinary food without timed bonus plumbing or user energy mutation', () => {
  const renderer = petRendererSource;
  const feedStart = renderer.indexOf('async function feedPet(foodId)');
  const feedEnd = renderer.indexOf('function showFoodDropIntoMouth', feedStart);
  assert.ok(feedStart >= 0 && feedEnd > feedStart, 'feedPet implementation must remain auditable');
  const feedImplementation = renderer.slice(feedStart, feedEnd);

  assert.doesNotMatch(renderer, /coffeeBonusUntil/);
  assert.doesNotMatch(feedImplementation, /energyLevel\s*[+\-*/]?=/);
});

test('passive treasure is played only as a Director cue and never invokes the reward IPC', () => {
  const renderer = petRendererSource;
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const manifest = adaptLegacyPetContent({ EASTER_EGGS });
  const treasure = manifest.cues.find(cue => cue.id === 'egg.dig-treasure');

  assert.equal(treasure.discoveryId, 'builtin-core.dig-treasure');
  assert.match(renderer, /onPetCue|presentCue/);
  assert.doesNotMatch(renderer, /pet_interaction\(['"]dig-treasure['"]\)/);
  assert.doesNotMatch(main, /interactionId === ['"]dig-treasure['"]/);
});

test('pet focus shortcut hands every pending session decision back to the panel', () => {
  const renderer = petRendererSource;
  const focusStart = renderer.indexOf("if (act === 'focus')");
  const focusEnd = renderer.indexOf("else if (act === 'impulse')", focusStart);
  assert.ok(focusStart >= 0 && focusEnd > focusStart, 'pet focus action must remain auditable');
  const focusAction = renderer.slice(focusStart, focusEnd);
  const decisionStart = focusAction.indexOf('const decisionMessage =');
  const decisionEnd = focusAction.indexOf('const active =', decisionStart);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart,
    'pending decisions must be handled before generic start failures');
  const decisionBranch = focusAction.slice(decisionStart, decisionEnd);

  assert.match(decisionBranch, /'awaiting-confirmation'/);
  assert.match(decisionBranch, /'quick-start-decision-pending'/);
  assert.match(decisionBranch, /'focus-landing-pending'/);
  assert.match(decisionBranch, /确认计入完成或放弃本轮/);
  assert.match(decisionBranch, /两分钟已经完成/);
  assert.match(decisionBranch, /保存或跳过上一轮的落点/);
  assert.match(decisionBranch, /pet_openPanel/);
  assert.match(decisionBranch, /return;/);
  assert.doesNotMatch(decisionBranch, /setSessionState\('focused'\)/);
});

test('low-stimulation and reduced-motion profiles keep status cues static and suppress overlay rewards', () => {
  const renderer = petRendererSource;
  const overlayStart = renderer.indexOf('function drawOverlay()');
  const overlayEnd = renderer.indexOf('\nfunction drawEggOverlay()', overlayStart);
  assert.ok(overlayStart >= 0 && overlayEnd > overlayStart, 'drawOverlay implementation must remain auditable');
  const overlay = renderer.slice(overlayStart, overlayEnd);

  assert.match(overlay, /calmVisual/);
  assert.doesNotMatch(overlay, /state === 'focused'/);
  assert.doesNotMatch(overlay, /state === 'resting'/);
  assert.doesNotMatch(overlay, /drawExpressionAccent\(/,
    '困倦辅助符号不能继续绘制在独立 overlay 上');
  const petDrawStart = renderer.indexOf('function drawPet()');
  const petDrawEnd = renderer.indexOf('\nfunction drawCraving(', petDrawStart);
  assert.ok(petDrawStart >= 0 && petDrawEnd > petDrawStart, 'drawPet implementation must remain auditable');
  const petDraw = renderer.slice(petDrawStart, petDrawEnd);
  assert.match(petDraw, /drawExpressionAccent\(pctx[\s\S]*?offX[\s\S]*?offY/,
    '困倦辅助符号必须跟随宠物画布的真实身体偏移');
  assert.match(overlay, /react\.celebrate/);
  assert.match(overlay, /if \(calmVisual\) \{[\s\S]*?runtimeState\.overlayParticles = \[\]/);
  assert.match(overlay, /currentEgg && !calmVisual/);

  assert.match(renderer, /if \(calmVisual\) \{[\s\S]*?petals = \[\];[\s\S]*?\} else \{/);
  assert.match(renderer, /function drawScene\(\) \{[\s\S]*?runtimeState\.sessionState === 'focused' \|\| runtimeState\.sessionState === 'resting'[\s\S]*?runtimeState\.sceneParticles = \[\];[\s\S]*?return;/);
  assert.match(renderer, /function drawScene\(\) \{[\s\S]*?if \(currentFrame\.policy\.calmVisual\) \{[\s\S]*?runtimeState\.sceneParticles = \[\];[\s\S]*?return;/);
  const clearStart = renderer.indexOf('function clearDecorativeParticles()');
  const clearEnd = renderer.indexOf('\nfunction sceneEmitterAccumulators', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart,
    'decorative particle cleanup must remain auditable');
  const clearImplementation = renderer.slice(clearStart, clearEnd);
  assert.match(clearImplementation, /resetSceneParticles\(\)/);
  assert.match(clearImplementation, /runtimeState\.overlayParticles = \[\]/);
  assert.match(clearImplementation, /runtimeState\.petals = \[\]/);
  assert.match(clearImplementation, /petalEmitter\.reset\(\)/);
  assert.match(clearImplementation, /resetPetActionEmitters\(\)/);
  assert.match(renderer, /clearDecorativeParticles|clear\(\)/);
});

test('renderer has no autonomous walk or easter-egg lottery outside the Director', () => {
  const renderer = petRendererSource;
  assert.doesNotMatch(renderer, /function (?:startWalk|tryTriggerEgg)\(/);
  assert.doesNotMatch(renderer, /pet_getDisplayBounds/);
  assert.match(renderer, /onCue:\s*presentCue/);
});

test('all built-in animation IDs use the data-driven pet action renderer', () => {
  const renderer = petRendererSource;
  assert.match(renderer, /PET_ACTIONS/);
  assert.match(renderer, /formArt\.applyMotionTransform/);
  assert.match(renderer, /formArt\.drawActionLayer/);
  assert.ok(EASTER_EGGS.every(egg => KNOWN_ANIMATIONS.has(egg.id)));
});
