'use strict';

// Presentation Director：把“为什么展示”归一成当前应该展示的表情。
//
// 输入来自五类来源——输入安全态、必要反馈、用户互动、会话转换、Director
// cue，外加长期 base。导演按优先级裁决：高优先级可抢占；同优先级按更新的
// 事实决定，不随机争抢；同一 eventId 重放幂等，不重启动画也不延长 TTL；
// 临时反馈携带最短停留与超时，结束后重新读取最新 base（不保存旧快照）。
//
// 优先级是封闭的六档，严格由来源决定（不接受调用方任意覆写），以保证
// 输入安全态(100) 永远能压过一切、自主 cue(60) 永远压不过必要反馈。
//
// 本模块是纯逻辑：不执行 Canvas、不发 IPC、不写持久化，时间由注入的单调
// 时钟提供。它只决定展示什么，真实像素由 renderer 依据采样结果绘制。

// ---------- 优先级 ----------
// 与ARCHITECTURE「表达呈现」 一致：输入安全态 100 > 必要反馈 90 > 用户互动 80 >
// 会话转换 70 > Director cue 60 > 长期 base 50。
const PRESENTATION_PRIORITY = Object.freeze({
  inputSafe: 100,
  essential: 90,
  interaction: 80,
  session: 70,
  cue: 60,
  base: 50
});

const PRESENTATION_SOURCES = Object.freeze([
  'input-safe', 'essential', 'interaction', 'session', 'cue', 'base'
]);
const PRESENTATION_BASE_SOURCES = Object.freeze(['session', 'base']);
const PRESENTATION_TRANSIENT_SOURCES = Object.freeze([
  'input-safe', 'essential', 'interaction', 'session', 'cue'
]);

const PRIORITY_BY_SOURCE = Object.freeze({
  'input-safe': PRESENTATION_PRIORITY.inputSafe,
  'essential': PRESENTATION_PRIORITY.essential,
  'interaction': PRESENTATION_PRIORITY.interaction,
  'session': PRESENTATION_PRIORITY.session,
  'cue': PRESENTATION_PRIORITY.cue,
  'base': PRESENTATION_PRIORITY.base
});

const DEFAULT_TRANSIENT_TTL_MS = 1500;
// 已消费 eventId 的去重窗口：超过 TTL 后再送达同一 eventId（例如 cue 信封
// 重试）不会重新起动画。窗口 = max(expiresAt, now) + 宽限，并有数量上限。
const DEDUP_GRACE_MS = 5000;
const MAX_RECENT_EVENTS = 64;

function presentationIsFinite(value) {
  return Number.isFinite(value);
}

function createPresentationDirector(options = {}) {
  const clock = options.clock && typeof options.clock.now === 'function'
    ? options.clock
    : { now: () => 0 };

  let policy = Object.freeze({ dnd: false, reduceMotion: false, lowStimulation: false, menuOpen: false });
  let base = null;      // 长期 base / 会话 base：临时反馈结束后回到的“最新事实”
  let transient = null; // 当前最高优先级的临时展示
  // 已消费 eventId -> 去重截止时间。保证“过期后重放同一事件”也不重启动画。
  const recentEvents = new Map();

  function autonomousAllowed() {
    return !policy.dnd && !policy.lowStimulation && !policy.menuOpen;
  }

  function staticRequested() {
    return policy.reduceMotion || policy.lowStimulation;
  }

  function pruneRecentEvents(now) {
    for (const [id, until] of recentEvents) {
      if (now >= until) recentEvents.delete(id);
    }
    while (recentEvents.size > MAX_RECENT_EVENTS) {
      recentEvents.delete(recentEvents.keys().next().value);
    }
  }

  function rememberEvent(eventId, now, expiresAt) {
    const until = Math.max(presentationIsFinite(expiresAt) ? expiresAt : now, now) + DEDUP_GRACE_MS;
    recentEvents.set(eventId, until);
    pruneRecentEvents(now);
  }

  // 收紧策略必须立刻取消正在运行的自主 transient，而不只是阻止下一次创建。
  function setSensoryPolicy(next = {}) {
    policy = Object.freeze({
      dnd: next.dnd === true,
      reduceMotion: next.reduceMotion === true,
      lowStimulation: next.lowStimulation === true,
      menuOpen: next.menuOpen === true
    });
    if (transient && transient.source === 'cue' && !autonomousAllowed()) {
      const cancelled = transient;
      transient = null;
      return Object.freeze({ cancelled: cancelled.eventId, reason: policy.dnd ? 'dnd' : 'policy-tightened' });
    }
    return Object.freeze({ cancelled: null, reason: null });
  }

  // base 更新永远被接受；它不打断正在播放的临时反馈，但会成为其返回目标。
  function setBase(input = {}) {
    const expressionId = input.expressionId;
    if (typeof expressionId !== 'string' || expressionId.length === 0) {
      return { ok: false, reason: 'invalid-expression' };
    }
    const source = input.source === undefined ? 'base' : input.source;
    if (!PRESENTATION_BASE_SOURCES.includes(source)) {
      return { ok: false, reason: 'invalid-source' };
    }
    if (base && base.expressionId === expressionId && base.source === source) {
      return { ok: true, unchanged: true, cancelled: null };
    }
    base = Object.freeze({
      expressionId,
      source,
      priority: PRIORITY_BY_SOURCE[source],
      updatedAt: clock.now()
    });
    // 稳定 session base 也是带时间的优先级事实。更新的 base 会结束同级旧
    // transition 与更低级 cue；更高级互动仍可短暂覆盖并回到这个最新 base。
    let cancelled = null;
    if (transient && transient.priority <= base.priority) {
      cancelled = transient.eventId;
      transient = null;
    }
    return { ok: true, cancelled };
  }

  // 到期清理（惰性）：在裁决与读取前调用，避免拿已过期的 transient 做判断。
  function update(now = clock.now()) {
    if (transient && now >= transient.expiresAt) {
      transient = null;
    }
  }

  // 抢占裁决：只取决于来源、当前 base、在播 transient 和感官策略，与事件身份
  // 无关。渲染器的状态机（决定 pet state 而非表情）与 presentTransient 共用
  // 这一处实现，否则同一条规则会被抄成两份，base 优先级、最短停留和自主门禁
  // 迟早在两份之间分叉。
  function wouldAdmit(input = {}) {
    const source = input.source;
    const now = presentationIsFinite(input.at) ? input.at : clock.now();

    if (!PRESENTATION_TRANSIENT_SOURCES.includes(source)) return { ok: false, reason: 'invalid-source' };

    // 自主 cue 受感官门禁约束；必要反馈与用户互动不受 DND 影响。
    if (source === 'cue' && !autonomousAllowed()) {
      const reason = policy.dnd ? 'dnd' : policy.menuOpen ? 'menu-open' : 'low-stimulation';
      return { ok: false, reason };
    }

    // 先回收已过期的临时展示，保证裁决不依赖“上次何时调用过 current()”。
    update(now);

    // 优先级严格由来源决定，封闭六档，不接受调用方覆写。
    const priority = PRIORITY_BY_SOURCE[source];
    if (base && priority < base.priority) {
      return { ok: false, reason: 'lower-priority' };
    }
    if (transient) {
      if (priority < transient.priority) {
        return { ok: false, reason: 'lower-priority' };
      }
      if (priority === transient.priority) {
        // 比当前事实更旧的输入（乱序/迟到）直接拒绝，避免随机争抢。
        if (now < transient.issuedAt) {
          return { ok: false, reason: 'stale' };
        }
        // 最短停留内不被同级替换。
        if (now < transient.issuedAt + transient.minHoldMs) {
          return { ok: false, reason: 'min-hold' };
        }
      }
      // priority > transient.priority：抢占。
    }
    return { ok: true, priority };
  }

  function presentTransient(input = {}) {
    const eventId = input.eventId;
    const expressionId = input.expressionId;
    const source = input.source === undefined ? 'cue' : input.source;
    const now = presentationIsFinite(input.issuedAt) ? input.issuedAt : clock.now();

    if (typeof eventId !== 'string' || eventId.length === 0) return { ok: false, reason: 'invalid-event' };
    if (typeof expressionId !== 'string' || expressionId.length === 0) return { ok: false, reason: 'invalid-expression' };

    // 先回收已过期的临时展示，保证裁决不依赖“上次何时调用过 current()”。
    update(now);

    // 幂等先于裁决：同一 eventId 正在播放，或在去重窗口内已被消费——都不重启
    // 动画、不延长 TTL，也不该因为落在自己的最短停留窗口里而被当成抢占失败。
    if (transient && transient.eventId === eventId) {
      return { ok: true, duplicate: true, eventId };
    }
    if (recentEvents.has(eventId) && now < recentEvents.get(eventId)) {
      return { ok: true, duplicate: true, eventId };
    }

    const admission = wouldAdmit({ source, at: now });
    if (!admission.ok) return admission;

    const minHoldMs = presentationIsFinite(input.minHoldMs) && input.minHoldMs >= 0 ? input.minHoldMs : 0;
    const ttlMs = presentationIsFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TRANSIENT_TTL_MS;

    transient = Object.freeze({
      eventId,
      expressionId,
      source,
      priority: admission.priority,
      issuedAt: now,
      minHoldMs,
      // 最短停留是硬下限，不能被配置错误的短 TTL 绕过。
      expiresAt: now + Math.max(ttlMs, minHoldMs)
    });
    rememberEvent(eventId, now, transient.expiresAt);
    return { ok: true, eventId, priority: admission.priority };
  }

  function cancelTransient(eventId, reason = 'cancelled') {
    if (transient && transient.eventId === eventId) {
      const cancelled = transient;
      transient = null;
      return { ok: true, cancelled: cancelled.eventId, reason };
    }
    return { ok: false, reason: 'not-active' };
  }

  function current(now = clock.now()) {
    update(now);
    const staticFlag = staticRequested();
    if (transient) {
      return Object.freeze({
        expressionId: transient.expressionId,
        source: transient.source,
        priority: transient.priority,
        eventId: transient.eventId,
        base: false,
        static: staticFlag
      });
    }
    if (base) {
      return Object.freeze({
        expressionId: base.expressionId,
        source: base.source,
        priority: base.priority,
        eventId: null,
        base: true,
        static: staticFlag
      });
    }
    return null;
  }

  return Object.freeze({
    setSensoryPolicy,
    setBase,
    wouldAdmit,
    presentTransient,
    cancelTransient,
    update,
    current,
    get policy() { return policy; },
    get base() { return base; },
    get transient() { return transient; }
  });
}

const presentationApi = Object.freeze({
  PRESENTATION_PRIORITY,
  PRESENTATION_SOURCES,
  PRESENTATION_BASE_SOURCES,
  PRESENTATION_TRANSIENT_SOURCES,
  PRIORITY_BY_SOURCE,
  DEFAULT_TRANSIENT_TTL_MS,
  createPresentationDirector
});



export default presentationApi;
export { PRESENTATION_PRIORITY, PRESENTATION_SOURCES, PRESENTATION_BASE_SOURCES, PRESENTATION_TRANSIENT_SOURCES, PRIORITY_BY_SOURCE, DEFAULT_TRANSIENT_TTL_MS, createPresentationDirector };
