// Read-only presentation of the execution projection; never settles a session.
// The headline is always one physical action: a written next action, the next open
// step, or — when neither exists — the universal first step instead of repeating the
// task title (PRODUCT「不可破坏的原则」: 行动小于规划).
const FIRST_STEP = '打开材料，只做第一小步';

function actionPresentation(state, session, task, candidate, { hasOpenTasks = false } = {}) {
  const landing = state.quickStartResolutionPending === true
    || state.focusLandingPrompt?.status === 'pending';
  const phase = landing ? 'landing' : session.paused ? 'paused'
    : session.running ? (session.mode === 'break' ? 'break' : 'focus')
      : task ? 'ready' : 'empty';
  const labels = { empty: '从一件小事开始', ready: '眼前这一步', focus: '正在进行',
    paused: '随时可以接着来', landing: '为下次留个入口', break: '休息一下' };
  const step = candidate?.nextStep || task?.steps?.find(item => !item.done);
  const idle = session.running || session.paused ? '这一段，留给手边的事'
    : hasOpenTasks ? '从任务里换一件来做' : '把脑中的一件事放下来';
  const action = task?.done ? '这件事已经做完了'
    : task ? task.nextAction || step?.title || FIRST_STEP
      : idle;
  return { phase, label: labels[phase], action };
}
export { actionPresentation, FIRST_STEP };
