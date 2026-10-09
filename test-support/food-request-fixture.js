'use strict';
const { createFoodRequest } = require('../src/capabilities/companion/contract/food-request.mjs');
let sequence = 0;
function foodRequest(foodId, issuedAt) { return createFoodRequest(foodId, issuedAt, `fixture-${++sequence}`); }
module.exports = { foodRequest };
