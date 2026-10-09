'use strict';

function createPetCommands({ menu, client, state, setState, runAction, report } = {}) {
  if (!menu || typeof menu.open !== 'function' || typeof menu.close !== 'function') {
    throw new TypeError('pet command menu is required');
  }
  if (!client || typeof client.pet_openPanel !== 'function') throw new TypeError('pet command client is required');
  const readState = typeof state === 'function' ? state : () => ({});
  const updateState = typeof setState === 'function' ? setState : () => {};

  function normalize(action) {
    return typeof action === 'string' ? action.trim().toLowerCase() : '';
  }

  async function execute(action) {
    const act = normalize(action);
    await menu.close();
    if (act === 'focus') {
      const result = await client.pet_startFocus();
      const decisionMessage = result && ({
        'awaiting-confirmation': '上轮已经到点，请在面板确认计入完成或放弃本轮',
        'quick-start-decision-pending': '两分钟已经完成，请先在面板选择下一步',
        'focus-landing-pending': '先保存或跳过上一轮的落点，再开始新一轮'
      })[result.reason];
      if (decisionMessage) {
        await client.pet_openPanel();
        return { ok: false, reason: result.reason, message: decisionMessage };
      }
      if (result.ok) updateState({ sessionState: 'focused' });
      return result;
    }
    if (act === 'impulse') return client.pet_openImpulse();
    if (typeof runAction === 'function') return runAction(act, readState());
    if (typeof report === 'function') report(act);
    return { ok: true, action: act };
  }

  return Object.freeze({ execute, normalize });
}

export { createPetCommands };
export default Object.freeze({ createPetCommands });
