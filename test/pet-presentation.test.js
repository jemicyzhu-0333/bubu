'use strict';

// core/pet-presentation.js 的单测：六档优先级与抢占、幂等、超时、取消、
// 最短停留、临时事件返回最新 base、DND/低刺激/Reduce Motion 门禁，以及
// 不产生责备型状态。

const test = require('node:test');
const assert = require('node:assert/strict');

const presentation = require('../src/core/pet-presentation.mjs');
const expressions = require('../src/content/expressions.mjs');

const { PRESENTATION_PRIORITY, createPresentationDirector } = presentation;

// 可控时钟，避免依赖真实时间。
function manualClock(start = 0) {
  const state = { now: start };
  return {
    clock: { now: () => state.now },
    advance: (ms) => { state.now += ms; return state.now; },
    set: (value) => { state.now = value; return state.now; }
  };
}

test('六档优先级：高优先级抢占，低优先级被拒', () => {
  const { clock, advance } = manualClock(1000);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  // 会话转换（70）成为当前。
  assert.equal(director.presentTransient({ eventId: 's1', expressionId: 'work.focus', source: 'session', ttlMs: 60_000 }).ok, true);
  assert.equal(director.current().expressionId, 'work.focus');

  // Director cue（60）低于会话，不能覆盖。
  const cue = director.presentTransient({ eventId: 'e1', expressionId: 'react.happy', source: 'cue', ttlMs: 5000 });
  assert.equal(cue.ok, false);
  assert.equal(cue.reason, 'lower-priority');
  assert.equal(director.current().expressionId, 'work.focus');

  // 用户互动（80）抢占会话。
  assert.equal(director.presentTransient({ eventId: 'c1', expressionId: 'react.petted', source: 'interaction', ttlMs: 5000 }).ok, true);
  assert.equal(director.current().expressionId, 'react.petted');

  // 输入安全态（100）抢占一切。
  assert.equal(director.presentTransient({ eventId: 'drag1', expressionId: 'react.surprised', source: 'input-safe', ttlMs: 60_000 }).ok, true);
  assert.equal(director.current().expressionId, 'react.surprised');
  assert.equal(director.current().priority, PRESENTATION_PRIORITY.inputSafe);

  // 必要反馈（90）也不能压过输入安全态。
  assert.equal(director.presentTransient({ eventId: 'err1', expressionId: 'system.unavailable', source: 'essential', ttlMs: 5000 }).ok, false);

  advance(70_000);
  assert.equal(director.current().base, true, '全部临时态过期后回到 base');
});

test('同 event 重放幂等：不重启动画、不延长 TTL', () => {
  const { clock, advance } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  const first = director.presentTransient({ eventId: 'tap-1', expressionId: 'react.happy', source: 'interaction', issuedAt: 0, ttlMs: 1000 });
  assert.equal(first.ok, true);

  // 在 TTL 内重放同一 eventId：返回 duplicate，且过期时间不变。
  advance(600);
  const replay = director.presentTransient({ eventId: 'tap-1', expressionId: 'react.happy', source: 'interaction', issuedAt: 600, ttlMs: 5000 });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);

  // 原始 TTL 到期（issuedAt 0 + 1000），即使重放带了更长 ttl 也不延长。
  advance(500); // now = 1100
  assert.equal(director.current().expressionId, 'life.idle', '重放不得延长 TTL');
});

test('最短停留：保护期内同级替换被拒，保护期后按更新事实替换', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  assert.equal(director.presentTransient({ eventId: 'a', expressionId: 'react.happy', source: 'interaction', issuedAt: 0, minHoldMs: 800, ttlMs: 5000 }).ok, true);

  // 800ms 保护期内，同为互动（80）的更新被拒。
  const tooSoon = director.presentTransient({ eventId: 'b', expressionId: 'react.satisfied', source: 'interaction', issuedAt: 300, ttlMs: 5000 });
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.reason, 'min-hold');
  assert.equal(director.current().expressionId, 'react.happy');

  // 保护期后，更新的事实（更晚 issuedAt）替换。
  const later = director.presentTransient({ eventId: 'c', expressionId: 'react.satisfied', source: 'interaction', issuedAt: 900, ttlMs: 5000 });
  assert.equal(later.ok, true);
  assert.equal(director.current().expressionId, 'react.satisfied');

  // 保护期后但 issuedAt 更旧（过期事实）不替换，避免随机争抢。
  const stale = director.presentTransient({ eventId: 'd', expressionId: 'react.happy', source: 'interaction', issuedAt: 100, ttlMs: 5000 });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale');
});

test('超时与取消：到期自动返回，取消立即返回', () => {
  const { clock, advance } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  director.presentTransient({ eventId: 'x', expressionId: 'react.happy', source: 'interaction', issuedAt: 0, ttlMs: 700 });
  assert.equal(director.current().expressionId, 'react.happy');
  advance(800);
  director.update();
  assert.equal(director.current().expressionId, 'life.idle', '超时应返回 base');

  // 取消
  director.presentTransient({ eventId: 'y', expressionId: 'react.surprised', source: 'interaction', issuedAt: 800, ttlMs: 10_000 });
  assert.equal(director.current().expressionId, 'react.surprised');
  const cancelled = director.cancelTransient('y', 'dragging');
  assert.equal(cancelled.ok, true);
  assert.equal(director.current().expressionId, 'life.idle', '取消应立即返回 base');
  assert.equal(director.cancelTransient('not-there').ok, false);
});

test('临时反馈结束后回到最新 base，而不是旧快照', () => {
  const { clock, advance } = manualClock(0);
  const director = createPresentationDirector({ clock });

  // 起点 base 是 idle。
  director.setBase({ expressionId: 'life.idle', source: 'base' });
  // 专注开始：会话 base 变为 focus（70），不打断任何临时态。
  director.setBase({ expressionId: 'work.focus', source: 'session' });

  // 专注中用户点击：互动临时态覆盖。
  assert.equal(director.presentTransient({ eventId: 'tap', expressionId: 'react.happy', source: 'interaction', issuedAt: 0, ttlMs: 900 }).ok, true);
  assert.equal(director.current().expressionId, 'react.happy');

  // 临时态结束：必须回到“最新”的 work.focus，而不是点击前的 life.idle。
  advance(1000);
  const current = director.current();
  assert.equal(current.expressionId, 'work.focus', '点击结束后应回到最新 focus，而不是旧 idle');
  assert.equal(current.base, true);
});

test('稳定 session base 参与优先级裁决，并会取消更低级的在播 cue', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'work.focus', source: 'session' });

  const blocked = director.presentTransient({
    eventId: 'ambient', expressionId: 'react.encouraging', source: 'cue', ttlMs: 5000
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'lower-priority');
  assert.equal(director.current().expressionId, 'work.focus');

  // base 从 idle 升为 session 事实时，不能让已在播的自主 cue 继续遮住专注状态。
  const second = createPresentationDirector({ clock });
  second.setBase({ expressionId: 'life.idle', source: 'base' });
  assert.equal(second.presentTransient({
    eventId: 'ambient-2', expressionId: 'react.happy', source: 'cue', ttlMs: 5000
  }).ok, true);
  const update = second.setBase({ expressionId: 'work.focus', source: 'session' });
  assert.equal(update.cancelled, 'ambient-2');
  assert.equal(second.current().expressionId, 'work.focus');

  // 用户互动仍高于稳定 session base。
  assert.equal(second.presentTransient({
    eventId: 'tap', expressionId: 'react.happy', source: 'interaction', ttlMs: 1000
  }).ok, true);
  assert.equal(second.current().expressionId, 'react.happy');

  const third = createPresentationDirector({ clock });
  third.setBase({ expressionId: 'work.focus', source: 'session' });
  third.presentTransient({
    eventId: 'starting', expressionId: 'work.starting', source: 'session', ttlMs: 5000
  });
  const paused = third.setBase({ expressionId: 'work.pause', source: 'session' });
  assert.equal(paused.cancelled, 'starting', '更新的同级 session base 应结束旧 transition');
  assert.equal(third.current().expressionId, 'work.pause');
});

test('最短停留不会被更短 TTL 绕过', () => {
  const { clock, advance } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });
  director.presentTransient({
    eventId: 'held', expressionId: 'react.petted', source: 'interaction',
    issuedAt: 0, minHoldMs: 2000, ttlMs: 200
  });

  advance(1000);
  assert.equal(director.current().expressionId, 'react.petted');
  advance(1001);
  assert.equal(director.current().expressionId, 'life.idle');
});

// 渲染器状态机（决定 pet state）与 presentTransient（决定表情）是两个调用方，
// 但抢占规则只实现在 wouldAdmit 一处。这条属性测试遍历全部来源组合，任何一方
// 被改出偏差都会失败——两份规则慢慢分叉正是 0.4.0 之前的实际问题。
test('wouldAdmit 与 presentTransient 对同一事实给出同一裁决', () => {
  const sources = presentation.PRESENTATION_TRANSIENT_SOURCES;
  for (const baseSource of presentation.PRESENTATION_BASE_SOURCES) {
    for (const held of sources) {
      for (const candidate of sources) {
        const { clock } = manualClock(1000);
        const director = createPresentationDirector({ clock });
        director.setBase({ expressionId: 'life.idle', source: baseSource });
        director.presentTransient({
          eventId: 'held', expressionId: 'react.petted', source: held,
          issuedAt: 1000, minHoldMs: 500, ttlMs: 60_000
        });

        const where = `base=${baseSource} held=${held} candidate=${candidate}`;
        const predicted = director.wouldAdmit({ source: candidate, at: 1200 });
        const actual = director.presentTransient({
          eventId: 'candidate', expressionId: 'react.happy', source: candidate, issuedAt: 1200
        });
        assert.equal(actual.ok, predicted.ok, where);
        if (!predicted.ok) assert.equal(actual.reason, predicted.reason, where);
      }
    }
  }
});

test('输入安全态不可被任何来源抢占，包括必要反馈', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'work.focus', source: 'session' });
  director.presentTransient({
    eventId: 'drag', expressionId: 'react.surprised', source: 'input-safe', ttlMs: 600_000
  });

  for (const source of presentation.PRESENTATION_TRANSIENT_SOURCES) {
    if (source === 'input-safe') continue;
    assert.deepEqual(
      director.wouldAdmit({ source, at: 5000 }),
      { ok: false, reason: 'lower-priority' },
      `${source} 不能压过正在进行的输入安全态`
    );
  }
  assert.equal(director.current(5000).expressionId, 'react.surprised');
});

test('状态机来源集闭合：长期 base 不能被当成临时来源', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  assert.deepEqual(director.wouldAdmit({ source: 'base' }), { ok: false, reason: 'invalid-source' });
  assert.deepEqual(director.wouldAdmit({ source: undefined }), { ok: false, reason: 'invalid-source' });
  assert.deepEqual(director.wouldAdmit({ source: 'urgent' }), { ok: false, reason: 'invalid-source' });
});

test('base/transient 来源角色闭合，重复 base 更新保持幂等', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  assert.deepEqual(director.setBase({ expressionId: 'life.idle', source: 'cue' }), {
    ok: false, reason: 'invalid-source'
  });
  assert.deepEqual(director.presentTransient({
    eventId: 'bad', expressionId: 'react.happy', source: 'base'
  }), { ok: false, reason: 'invalid-source' });

  director.setBase({ expressionId: 'work.focus', source: 'session' });
  director.presentTransient({
    eventId: 'starting', expressionId: 'work.starting', source: 'session', ttlMs: 1000
  });
  const replay = director.setBase({ expressionId: 'work.focus', source: 'session' });
  assert.equal(replay.unchanged, true);
  assert.equal(director.current().expressionId, 'work.starting',
    '重复同步同一个 base 不能误取消当前 transition');
});

test('DND 只取消未请求的自主 cue，主动与必要反馈保留', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  // DND 下，自主 cue 被拒。
  director.setSensoryPolicy({ dnd: true });
  const cue = director.presentTransient({ eventId: 'auto', expressionId: 'react.happy', source: 'cue', issuedAt: 0 });
  assert.equal(cue.ok, false);
  assert.equal(cue.reason, 'dnd');

  // 用户主动互动仍可展示。
  assert.equal(director.presentTransient({ eventId: 'tap', expressionId: 'react.happy', source: 'interaction', issuedAt: 0 }).ok, true);
  director.cancelTransient('tap');

  // 必要反馈仍可展示。
  assert.equal(director.presentTransient({ eventId: 'done', expressionId: 'react.celebrate', source: 'essential', issuedAt: 0 }).ok, true);

  // 正在播放的自主 cue，DND 收紧时被立即取消。
  director.cancelTransient('done');
  director.setSensoryPolicy({ dnd: false });
  assert.equal(director.presentTransient({ eventId: 'ambient', expressionId: 'react.encouraging', source: 'cue', issuedAt: 0, ttlMs: 60_000 }).ok, true);
  const tightened = director.setSensoryPolicy({ dnd: true });
  assert.equal(tightened.cancelled, 'ambient', 'DND 收紧应立即取消正在播放的自主 cue');
  assert.equal(director.current().expressionId, 'life.idle');
});

test('低刺激与 Reduce Motion：自主被门禁，展示降级为静态', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  // 低刺激：自主 cue 被拒，展示为静态。
  director.setSensoryPolicy({ lowStimulation: true });
  assert.equal(director.presentTransient({ eventId: 'a', expressionId: 'react.happy', source: 'cue', issuedAt: 0 }).ok, false);
  assert.equal(director.current().static, true, '低刺激应返回静态展示');

  // 用户互动仍可展示，但降级为静态位姿。
  assert.equal(director.presentTransient({ eventId: 'b', expressionId: 'react.happy', source: 'interaction', issuedAt: 0 }).ok, true);
  assert.equal(director.current().static, true);
  director.cancelTransient('b');

  // Reduce Motion（非低刺激）：自主 cue 仍允许（allowAutonomousCues 不受影响），但展示静态。
  director.setSensoryPolicy({ reduceMotion: true, lowStimulation: false });
  assert.equal(director.presentTransient({ eventId: 'c', expressionId: 'react.encouraging', source: 'cue', issuedAt: 0 }).ok, true);
  assert.equal(director.current().static, true, 'Reduce Motion 应返回静态展示');
  director.cancelTransient('c');

  // 菜单打开时不启动新的自主内容。
  director.setSensoryPolicy({ reduceMotion: false, menuOpen: true });
  const blocked = director.presentTransient({ eventId: 'd', expressionId: 'react.encouraging', source: 'cue', issuedAt: 0 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'menu-open');
});

test('多标志感官组合：DND+ReduceMotion、ReduceMotion+低刺激、收紧取消在播 cue', () => {
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  // DND + Reduce Motion：自主 cue 以 dnd 为由被拒，展示为静态。
  director.setSensoryPolicy({ dnd: true, reduceMotion: true });
  const a = director.presentTransient({ eventId: 'a', expressionId: 'react.happy', source: 'cue', issuedAt: 0 });
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'dnd');
  assert.equal(director.current().static, true);

  // Reduce Motion + 低刺激：自主 cue 以 low-stimulation 为由被拒，展示为静态。
  director.setSensoryPolicy({ reduceMotion: true, lowStimulation: true });
  const b = director.presentTransient({ eventId: 'b', expressionId: 'react.happy', source: 'cue', issuedAt: 0 });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'low-stimulation');
  assert.equal(director.current().static, true);

  // 组合收紧时，正在播放的自主 cue 也要被立即取消。
  director.setSensoryPolicy({});
  assert.equal(director.presentTransient({ eventId: 'c', expressionId: 'react.encouraging', source: 'cue', issuedAt: 0, ttlMs: 60_000 }).ok, true);
  director.setSensoryPolicy({ dnd: true, reduceMotion: true });
  assert.equal(director.current().expressionId, 'life.idle', 'DND+RM 组合收紧应立即取消在播自主 cue');
});

test('过期后重放同一 eventId 不重启动画（去重窗口）', () => {
  const { clock, advance } = manualClock(0);
  const director = createPresentationDirector({ clock });
  director.setBase({ expressionId: 'life.idle', source: 'base' });

  // TTL 1000：0–1000 播放，1000 后过期回到 base。
  assert.equal(director.presentTransient({ eventId: 'tap-x', expressionId: 'react.happy', source: 'interaction', issuedAt: 0, ttlMs: 1000 }).ok, true);
  advance(2000); // now = 2000，早已过期
  assert.equal(director.current().expressionId, 'life.idle');

  // 过期后重放同一 eventId：不重新起动画（返回 duplicate，不回到 react.happy）。
  const replay = director.presentTransient({ eventId: 'tap-x', expressionId: 'react.happy', source: 'interaction', issuedAt: 2000, ttlMs: 1000 });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(director.current().expressionId, 'life.idle', '过期重放不得重启动画');

  // 裁决不能被“是否刚好调用过 current()”影响：过期后到来的低优先级事件正常生效。
  const { clock: c2 } = manualClock(0);
  const d2 = createPresentationDirector({ clock: c2 });
  d2.setBase({ expressionId: 'life.idle', source: 'base' });
  d2.presentTransient({ eventId: 'e', expressionId: 'react.celebrate', source: 'essential', issuedAt: 0, ttlMs: 500 });
  // 不调用 current()，直接在 2000（已过期）呈现互动事件：必须先回收过期项再裁决。
  const after = d2.presentTransient({ eventId: 'tap-y', expressionId: 'react.happy', source: 'interaction', issuedAt: 2000, ttlMs: 1000 });
  assert.equal(after.ok, true, '过期临时项不得继续以 lower-priority 吞掉新事件');
  assert.equal(d2.current().expressionId, 'react.happy');
});

test('表达库不含责备/愤怒/失落语义，导演不凭空制造表情', () => {
  const blamePattern = /(angry|anger|down|blame|disappoint|sad|punish|怒|责备|失望|惩罚|失落)/i;
  for (const config of expressions.EXPRESSIONS) {
    assert.ok(!blamePattern.test(config.id), `表达 ${config.id} 含责备语义`);
    assert.ok(!blamePattern.test(config.label), `表达 ${config.label} 含责备语义`);
  }

  // 导演只会回显给定的 expressionId，从不自己发明新表情。
  const { clock } = manualClock(0);
  const director = createPresentationDirector({ clock });
  const known = new Set(expressions.EXPRESSIONS.map(e => e.id));
  director.setBase({ expressionId: 'life.idle', source: 'base' });
  director.presentTransient({ eventId: 't', expressionId: 'react.happy', source: 'interaction', issuedAt: 0 });
  assert.ok(known.has(director.current().expressionId), '导演产出的表情必须来自给定输入');
});
