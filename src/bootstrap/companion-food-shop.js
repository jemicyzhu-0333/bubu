'use strict';

const { createBuyCompanionFoodWorkflow } = require('../application');

function createCompanionFoodShop({
  unitOfWork,
  foods,
  clock,
  publish,
  reportEffectError
} = {}) {
  const workflow = createBuyCompanionFoodWorkflow({
    unitOfWork,
    foods,
    clock,
    publish,
    reportEffectError: error => reportEffectError(error, 'pet:buy-food')
  });

  function register(registerIpc) {
    if (typeof registerIpc !== 'function') throw new TypeError('companion food shop requires an IPC registrar');
    registerIpc('pet:buy-food', (_event, payload) => workflow.execute(payload));
  }

  return Object.freeze({ register });
}

module.exports = { createCompanionFoodShop };
