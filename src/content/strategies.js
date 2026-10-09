'use strict';

// This is reviewed product copy, not model output. Every line is deliberately
// framed as a reversible experiment and avoids diagnosing the person.
const STRATEGIES = Object.freeze([
  {
    id: 'start-visible-action', familyId: 'activation.first-action', phase: 'pre-start',
    text: '要不要试试只做眼前能看见的第一个动作？',
    detail: '把目标缩成“打开文件、写下标题”这类可以立刻观察到的动作，做完再决定下一步。',
    actionId: 'type-keyboard', staticFallback: '先写下一个能立刻动手的动作。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 30 * 60 * 1000, weight: 120,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['unclear', 'too-big'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: false }
  },
  {
    id: 'start-two-minute-door', familyId: 'activation.timebox', phase: 'pre-start',
    text: '要不要试试只投入两分钟，到点可以停？',
    detail: '先约定一个很短的出口，重点是启动，不要求把整件事做完。',
    actionId: 'wave', staticFallback: '只做两分钟，到点可以停。',
    motionLevel: 'gentle', focusAllowed: false, cooldownMs: 45 * 60 * 1000, weight: 105,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['too-big', 'boring', 'anxious'], energyBands: ['low', 'medium'], minEstimateMinutes: 10, hasNextAction: true }
  },
  {
    id: 'start-body-double', familyId: 'activation.companion', phase: 'pre-start',
    text: '要不要试试让伙伴安静陪你完成第一步？',
    detail: '把陪伴当作环境提示，不需要汇报，也不需要证明效率。',
    actionId: 'read-book', staticFallback: '让伙伴安静陪你完成第一步。',
    motionLevel: 'gentle', focusAllowed: true, cooldownMs: 60 * 60 * 1000, weight: 85,
    sourceTier: 'community',
    triggers: { blockers: ['anxious', 'interrupted'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: true }
  },
  {
    id: 'distraction-capture', familyId: 'attention.capture', phase: 'distraction',
    text: '要不要试试把冒出来的事先放进收件箱？',
    detail: '只记一句，不展开处理；记下之后回到刚才留下的下一步。',
    actionId: 'paper-plane', staticFallback: '记下一句，再回到刚才的下一步。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 30 * 60 * 1000, weight: 120,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['interrupted', 'unclear'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: true }
  },
  {
    id: 'distraction-reset-surface', familyId: 'attention.environment', phase: 'distraction',
    text: '要不要试试只清出眼前这一小块工作区？',
    detail: '不用整理整个环境，只移开当前动作不需要的东西。',
    actionId: 'sweep', staticFallback: '只清出眼前这一小块工作区。',
    motionLevel: 'gentle', focusAllowed: false, cooldownMs: 90 * 60 * 1000, weight: 75,
    sourceTier: 'product-hypothesis',
    triggers: { blockers: ['interrupted'], energyBands: ['medium', 'high'], minEstimateMinutes: 0, hasNextAction: true }
  },
  {
    id: 'memory-one-line', familyId: 'memory.externalize', phase: 'working-memory',
    text: '要不要试试留一句“下次先做什么”？',
    detail: '在切走前写下一个具体落点，回来时就不用重新回忆整段上下文。',
    actionId: 'read-book', staticFallback: '留一句“下次先做什么”。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 20 * 60 * 1000, weight: 130,
    sourceTier: 'research',
    triggers: { blockers: ['interrupted', 'unclear'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: false }
  },
  {
    id: 'memory-three-items', familyId: 'memory.externalize', phase: 'working-memory',
    text: '要不要试试把脑中的事项缩成最多三条？',
    detail: '先把其余内容放进收件箱，只让当前动作和两个候选留在眼前。',
    actionId: 'build-blocks', staticFallback: '把眼前内容缩成最多三条。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 45 * 60 * 1000, weight: 90,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['too-big', 'unclear'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: true }
  },
  {
    id: 'time-visible-finish', familyId: 'time.visibility', phase: 'time-visibility',
    text: '要不要试试先选一个看得见的停止点？',
    detail: '可以用一轮时长或一个具体步骤作为边界，到点再决定继续还是停下。',
    actionId: 'telescope', staticFallback: '先选一个看得见的停止点。',
    motionLevel: 'gentle', focusAllowed: true, cooldownMs: 45 * 60 * 1000, weight: 110,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['too-big', 'anxious'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 15, hasNextAction: true }
  },
  {
    id: 'time-halfway-check', familyId: 'time.visibility', phase: 'time-visibility',
    text: '要不要试试只在中点看一次剩余时间？',
    detail: '减少反复看钟，同时保留一次调整范围或落点的机会。',
    actionId: 'look-around', staticFallback: '只在中点看一次剩余时间。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 60 * 60 * 1000, weight: 80,
    sourceTier: 'product-hypothesis',
    triggers: { blockers: ['anxious'], energyBands: ['medium', 'high'], minEstimateMinutes: 25, hasNextAction: true }
  },
  {
    id: 'recovery-return-marker', familyId: 'recovery.return', phase: 'recovery',
    text: '要不要试试从上次的落点继续，而不是重新规划？',
    detail: '先照着留下的那一句做；如果已经不合适，再把它改成更小的动作。',
    actionId: 'stretch', staticFallback: '从上次留下的落点继续。',
    motionLevel: 'gentle', focusAllowed: true, cooldownMs: 30 * 60 * 1000, weight: 125,
    sourceTier: 'clinical-practice',
    triggers: { blockers: ['interrupted'], energyBands: ['low', 'medium', 'high'], minEstimateMinutes: 0, hasNextAction: true }
  },
  {
    id: 'recovery-lower-bar', familyId: 'recovery.return', phase: 'recovery',
    text: '要不要试试把这次回来只算一次重新启动？',
    detail: '不补偿离开的时间，也不要求追平原计划；重新碰一下任务就算进展。',
    actionId: 'meditate', staticFallback: '这次回来只做一次重新启动。',
    motionLevel: 'static', focusAllowed: true, cooldownMs: 60 * 60 * 1000, weight: 100,
    sourceTier: 'community',
    triggers: { blockers: ['interrupted', 'anxious', 'low-energy'], energyBands: ['low', 'medium'], minEstimateMinutes: 0, hasNextAction: false }
  }
]);

module.exports = { STRATEGIES };
