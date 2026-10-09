'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnergyCurveView } = require('../src/application/queries/energy-curve-view');
const { localDayStart, addDaysToKey } = require('../src/core/calendar');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');

const ROOT = path.resolve(__dirname, '..');
const DAY_KEY = '2026-09-20';
const DAY_START = localDayStart(DAY_KEY);
const MINUTE = 60 * 1000;
const at = minute => DAY_START + minute * MINUTE;

const COFFEE = {
  id: 'r-coffee',
  title: '早上那杯咖啡',
  kind: 'stimulant',
  effect: { profileId: 'stimulant-default', amplitude: 14, durationMin: 150 }
};

function view(overrides = {}) {
  const { settings = {}, now = at(10 * 60), dayKey = DAY_KEY, ...snapshot } = overrides;
  return buildEnergyCurveView({
    snapshot: { routines: [COFFEE], routineLog: null, energyCheckIn: null, energyProfile: null, ...snapshot },
    settings: { energyCurveEnabled: true, ...settings },
    now,
    dayKey,
    workStartHour: 9
  });
}

const logDay = (dayKey, entries) => ({ days: [{ dayKey, entries }] });
const done = (minute, extra = {}) => ({
  occurrenceId: `o-${minute}`, routineId: COFFEE.id, status: 'done', at: at(minute), ...extra
});

test('the curve is off until the user turns it on', () => {
  // 开关是 settings.energyCurveEnabled，而面板靠这个字段是不是 null 决定画不画 ——
  // 让渲染进程再读一遍开关,就等于同一个决定有两处实现,两处早晚会不一致。
  assert.equal(view({ settings: { energyCurveEnabled: false } }), null);
  assert.equal(view({ settings: { energyCurveEnabled: undefined } }), null);
  assert.ok(view() !== null);
});

test('only a completed check-in bends the curve', () => {
  // skipped 是明确没做、missed 是过了窗口、notified 只是提醒发出去了。任何一种被
  // 当成 done,画出来的就是「我没喝的那杯咖啡」，用户看着曲线会不认得自己的一天。
  const flat = view({ routineLog: logDay(DAY_KEY, [
    { ...done(8 * 60), status: 'skipped' },
    { ...done(8 * 60 + 10), status: 'missed' },
    { ...done(8 * 60 + 20), status: 'notified' }
  ]) });
  assert.deepEqual(flat.attribution, [], '三种非完成状态都不该留下归因行');
  assert.deepEqual(flat.marks, [], '也不该在时间轴上留刻度');
  const bent = view({ routineLog: logDay(DAY_KEY, [done(9 * 60)]) });
  assert.ok(bent.attribution.some(row => row.source === 'routine'));
});

test("yesterday's late log still lifts this morning, but its tick belongs to yesterday", () => {
  // 一杯 23:00 的咖啡、一次 23:30 的小睡,尾巴是跨零点的 —— routine-schema 把日志
  // 保留两天就是为了这件事。但它的刻度画在今天的轴上会指向一个没发生过的时刻。
  const late = view({
    routineLog: logDay(addDaysToKey(DAY_KEY, -1), [{ ...done(-60), occurrenceId: 'o-late' }]),
    now: at(30)
  });
  assert.ok(late.attribution.some(row => row.source === 'routine'), '昨夜那杯还在起作用');
  assert.deepEqual(late.marks, [], '刻度不属于今天');
  const today = view({ routineLog: logDay(DAY_KEY, [done(9 * 60)]) });
  assert.deepEqual(today.marks, [{ minute: 9 * 60, id: COFFEE.id, kind: 'stimulant' }]);
});

test('an entry the app can no longer explain contributes nothing', () => {
  // 三种「解释不了」:日常已经被删掉、这是一条 custom(content 里 effect 就是 null)、
  // profileId 不在内容表里。默认成某个形状等于在曲线上画一个谁都没设计过的隆起。
  const orphan = view({ routineLog: logDay(DAY_KEY, [{ ...done(9 * 60), routineId: 'r-deleted' }]) });
  assert.deepEqual(orphan.attribution, []);
  const custom = view({
    routines: [{ id: 'r-custom', title: '浇花', kind: 'custom', effect: null }],
    routineLog: logDay(DAY_KEY, [{ ...done(9 * 60), routineId: 'r-custom' }])
  });
  assert.equal(ROUTINE_EFFECT_PROFILES.custom, null, 'custom 在内容表里就是没有形状');
  assert.deepEqual(custom.attribution, []);
  assert.deepEqual(custom.marks, [], '连刻度也不画：没有效果的记录不属于这条曲线');
  const unknown = view({
    routines: [{ id: 'r-x', title: '未知', kind: 'meal', effect: { profileId: 'not-a-profile' } }],
    routineLog: logDay(DAY_KEY, [{ ...done(9 * 60), routineId: 'r-x' }])
  });
  assert.deepEqual(unknown.attribution, []);
});

test('a routine without its own effect falls back to the shape for its kind', () => {
  // normalizeRoutines 会给非 custom 的日常补上 effect,但一条从旧版本迁上来的记录
  // 可能没有。按 kind 回查内容表是有定义的行为,丢掉它不是。
  const bare = view({
    routines: [{ id: 'r-meal', title: '午饭', kind: 'meal' }],
    routineLog: logDay(DAY_KEY, [{ ...done(12 * 60), routineId: 'r-meal' }]),
    now: at(12 * 60 + 30)
  });
  assert.ok(bare.attribution.some(row => row.id === 'r-meal'));
});

test('no routine title is ever copied into the curve', () => {
  // ARCHITECTURE「日常与能量」：标题只存在 routines.items 一处,面板按 routineId 回查。复制进来的那一份会
  // 在用户改名之后继续显示旧名字,而这是一条没人会去想起来同步的路径。
  const curve = view({ routineLog: logDay(DAY_KEY, [done(9 * 60)]) });
  const blob = JSON.stringify(curve);
  assert.doesNotMatch(blob, /早上那杯咖啡/);
  assert.ok(blob.includes(COFFEE.id), '回查要用的 routineId 必须在');
  for (const row of curve.attribution) assert.equal('label' in row, false);
});

test('what crosses the wire is a sparkline, not the model', () => {
  // core 那份每个采样点都挂着 attribution/baseline/slope/clampedBy。96 点整份随每次
  // delta 推过去是几十 KB,而 ARCHITECTURE「日常与能量」 画的是一条 sparkline —— 每点只要一个数。
  const curve = view({ routineLog: logDay(DAY_KEY, [done(9 * 60)]) });
  assert.equal('samples' in curve, false);
  assert.equal(curve.levels.length, 24 * 60 / curve.sampleMinutes);
  for (const level of curve.levels) {
    assert.ok(Number.isInteger(level) && level >= 10 && level <= 90);
  }
  assert.ok(JSON.stringify(curve).length < 2000, `投影 ${JSON.stringify(curve).length} 字节,应当在 2KB 内`);
});

test('the attribution rows a surface would render as "+0" are dropped', () => {
  // 一行写着「咖啡 +0」读起来像 bug,它真实的意思是「这件事此刻已经没影响了」。
  const stale = view({ routineLog: logDay(DAY_KEY, [done(2 * 60)]), now: at(20 * 60) });
  assert.deepEqual(stale.attribution, []);
  const fresh = view({ routineLog: logDay(DAY_KEY, [done(9 * 60 + 30)]), now: at(10 * 60) });
  assert.ok(fresh.attribution.length >= 1);
  for (const row of fresh.attribution) assert.notEqual(row.delta, 0);
  // 影响最大的排在最前:这一行是给人读的,而人只会读第一条。
  const deltas = fresh.attribution.map(row => Math.abs(row.delta));
  assert.deepEqual(deltas, [...deltas].sort((left, right) => right - left));
});

test('modelLevel is the reading before the self-report, which is what the bar needs', () => {
  // ARCHITECTURE「日常与能量」：头部那条能量条拿 modelLevel 当 prior,再自己把自评按半衰期折进去。传已经
  // 含了自评的 nowLevel 过去会把同一次自评算两遍,条上的数字会比曲线更极端。
  const noCheckIn = view({ routineLog: logDay(DAY_KEY, [done(9 * 60)]) });
  assert.equal(noCheckIn.modelLevel, noCheckIn.nowLevel, '没有自评时两者就是同一个数');
  const reported = view({
    routineLog: logDay(DAY_KEY, [done(9 * 60)]),
    energyCheckIn: { level: 95, state: 'high', timestamp: at(9 * 60 + 50) },
    now: at(10 * 60)
  });
  assert.ok(reported.nowLevel > reported.modelLevel, '自评把曲线抬上去了');
  assert.equal(reported.modelLevel, noCheckIn.modelLevel, '但模型那半边一点没动');
  const correction = reported.attribution.find(row => row.source === 'check-in');
  assert.ok(correction && correction.delta > 0);
});

test('a single-object check-in is accepted, because that is how the snapshot stores it', () => {
  // 缺少已留存历史的旧快照仍兼容单个 latest 对象，不从它补造更早的自评。
  assert.ok(view({ energyCheckIn: { level: 20, state: 'low', timestamp: at(9 * 60 + 55) } }).nowLevel < 45);
  for (const broken of [null, {}, { level: 50 }, { timestamp: at(500) }, { level: 'high', timestamp: at(500) }]) {
    const curve = view({ energyCheckIn: broken });
    assert.ok(curve && curve.attribution.every(row => row.source !== 'check-in'), JSON.stringify(broken));
  }
});

test('a large calibration error is reported rather than hidden', () => {
  // ARCHITECTURE「日常与能量」：误差大的时候面板要把曲线画得更淡、把置信度写出来。悄悄照常画一条实线,
  // 等于拿一个已知不准的推算去要求用户信任。
  const profile = mae => ({ baseline: null, effectScale: null, observations: 20, lastResidualMae: mae });
  const fresh = { level: 70, state: 'medium', timestamp: at(9 * 60 + 55) };
  assert.equal(view({ energyProfile: profile(3), energyCheckIn: fresh }).confidence, 'high');
  assert.equal(view({ energyProfile: profile(12), energyCheckIn: fresh }).confidence, 'medium');
  const shaky = view({ energyProfile: profile(30), energyCheckIn: fresh });
  assert.equal(shaky.confidence, 'low', '刚说过自己此刻的状态,也救不了一个持续偏 30 点的模型');
  assert.equal(shaky.calibrated, true);
  assert.equal(shaky.observations, 20);
  // 两条轴取更差的那个:没有近期自评时,校准得再好也只是推算。
  assert.equal(view({ energyProfile: profile(3) }).confidence, 'low');
  const raw = view();
  assert.equal(raw.calibrated, false, '还没校准过就要说自己没校准过');
  assert.equal(raw.observations, 0);
});

test('a broken snapshot produces null instead of throwing', () => {
  // 它在 state:get 的路径上:抛出去就是整个面板打不开,而不是少一条曲线。
  assert.equal(buildEnergyCurveView(), null);
  assert.equal(buildEnergyCurveView({ snapshot: null, settings: { energyCurveEnabled: true }, dayKey: DAY_KEY }), null);
  assert.equal(buildEnergyCurveView({ snapshot: {}, settings: null, dayKey: DAY_KEY }), null);
  assert.equal(view({ dayKey: '' }), null);
  for (const routineLog of [undefined, 'nope', { days: 'nope' }, { days: [null, { entries: null }] }]) {
    assert.ok(view({ routineLog }) !== null, JSON.stringify(routineLog));
  }
  assert.ok(view({ routines: 'nope' }) !== null);
});

test('the same day rebuilt from the same state gives the same curve', () => {
  // 曲线是每次请求重算、从不存盘的(ARCHITECTURE「日常与能量」)。两次重算出现差异,就意味着历史某一天的
  // 形状取决于什么时候去看它。
  const input = {
    routineLog: logDay(DAY_KEY, [done(9 * 60), done(9 * 60), done(13 * 60, { routineId: COFFEE.id })]),
    energyCheckIn: { level: 62, state: 'medium', timestamp: at(14 * 60) },
    now: at(15 * 60)
  };
  assert.deepEqual(view(input), view(input));
  // 输入顺序反过来也一样:同种效应的递减折扣按时间先后分配,不按数组下标。
  const reversed = { ...input, routineLog: { days: [{ dayKey: DAY_KEY, entries: [...input.routineLog.days[0].entries].reverse() }] } };
  assert.deepEqual(view(reversed).levels, view(input).levels);
});

test('a past day has no now marker and no suggested windows', () => {
  // 在历史曲线上标一个「现在」,只能标到某一条边上 —— 那是个假的位置。
  const past = view({ dayKey: addDaysToKey(DAY_KEY, -1), now: at(15 * 60) });
  assert.equal(past.nowMinute, null);
  assert.equal(past.nowLevel, null);
  assert.equal(past.modelLevel, null);
  assert.equal(past.trend, null);
  assert.deepEqual(past.attribution, []);
  assert.deepEqual(past.windows, []);
  assert.equal(past.levels.length, 96, '但整天的形状照画');
});

test('the view stays a view and keeps its comments in Chinese', () => {
  const source = fs.readFileSync(ROOT + '/src/application/queries/energy-curve-view.js', 'utf8');
  // 查询层不许写状态。它算一遍、投影出去,写入走命令通道。
  assert.doesNotMatch(source, /\brequire\(['"][^'"]*platform\//);
  assert.doesNotMatch(source, /Date\.now\s*\(/, 'now 由调用方给,否则同一次投影里会有两个当前时刻');
  assert.match(source, /ARCHITECTURE「日常与能量」/);
});
